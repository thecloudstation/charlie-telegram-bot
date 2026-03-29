import type { Config } from "./config.js";

interface SendMessageResponse {
  status: string;
  adw_id: string;
  conversation_id: string;
  message_id: string;
}

interface ThreadOutput {
  event_type: string;
  event_category: string;
  content: string | null;
  timestamp: number;
  [key: string]: unknown;
}

interface ThreadOutputsResponse {
  outputs: ThreadOutput[];
  total: number;
  has_more: boolean;
}

/** Content block for images sent to the Project API */
export interface ImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/** Content block for documents sent to the Project API */
export interface DocumentContentBlock {
  type: "document";
  source: {
    type: "base64";
    media_type: string;
    data: string;
    filename?: string;
  };
}

/** Union type for all content blocks */
export type ContentBlock = ImageContentBlock | DocumentContentBlock;

/**
 * HTTP client for Charlie's Project API.
 *
 * The API is async: send a message -> get adw_id -> poll with since_timestamp
 * to get only NEW responses. Uses Bearer token auth for thread outputs.
 *
 * The Project API supports content_blocks directly for images and documents,
 * so files are sent as base64 in the same /api/message request.
 */
export class CharlieClient {
  private readonly apiUrl: string;
  private readonly projectId: string;
  private readonly apiKey: string;
  private readonly clientId: string;
  private readonly userToken: string;
  private readonly agentTemplateId?: string;
  private readonly maxPollMs: number;

  constructor(config: Config) {
    this.apiUrl = config.charlieApiUrl.replace(/\/+$/, "");
    this.projectId = config.charlieProjectId;
    this.apiKey = config.charlieApiKey;
    this.clientId = config.charlieClientId;
    this.userToken = config.charlieUserToken;
    this.agentTemplateId = config.charlieAgentTemplateId;
    this.maxPollMs = 120_000;
  }

  async sendMessage(
    conversationId: string,
    message: string,
    sender?: { id: string; name: string }
  ): Promise<string> {
    // Record timestamp BEFORE sending so we only get outputs after this point
    // API uses millisecond timestamps
    const sinceTimestamp = Date.now();

    const adwId = await this.postMessage(conversationId, message, sender);

    return this.pollForReply(adwId, sinceTimestamp);
  }

  /**
   * Send a message with file content_blocks to the Project API.
   *
   * The content_blocks are included directly in the /api/message request body,
   * allowing the AI to see images and document contents.
   */
  async sendMessageWithFiles(
    conversationId: string,
    message: string,
    contentBlocks: ContentBlock[],
    sender?: { id: string; name: string }
  ): Promise<string> {
    const sinceTimestamp = Date.now();

    const adwId = await this.postMessage(
      conversationId,
      message,
      sender,
      contentBlocks
    );

    return this.pollForReply(adwId, sinceTimestamp);
  }

  private async postMessage(
    conversationId: string,
    message: string,
    sender?: { id: string; name: string },
    contentBlocks?: ContentBlock[]
  ): Promise<string> {
    const url = `${this.apiUrl}/v1/projects/${this.projectId}/api/message`;

    const body: Record<string, unknown> = {
      conversation_id: conversationId,
      message,
      platform: "telegram",
    };

    if (this.agentTemplateId) {
      body.agent_template_id = this.agentTemplateId;
    }

    if (sender) {
      body.sender = sender;
    }

    if (contentBlocks && contentBlocks.length > 0) {
      body.content_blocks = contentBlocks;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "x-client-id": this.clientId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Charlie API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SendMessageResponse;

    if (!data.adw_id) {
      throw new Error(`No adw_id in response: ${JSON.stringify(data)}`);
    }

    console.log(`[API] Sent message -> adw_id: ${data.adw_id}`);

    return data.adw_id;
  }

  private async pollForReply(
    adwId: string,
    sinceTimestamp: number
  ): Promise<string> {
    const start = Date.now();
    let lastAssistantCount = 0;
    let stableSinceFirstAssistant = 0;

    while (Date.now() - start < this.maxPollMs) {
      const url = `${this.apiUrl}/threads/${adwId}/outputs?limit=100&since_timestamp=${sinceTimestamp}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.userToken}`,
        },
      });

      if (!response.ok) {
        await this.sleep(2000);
        continue;
      }

      const data = (await response.json()) as ThreadOutputsResponse;

      const assistantMessages = data.outputs.filter(
        (o) => o.event_type === "assistant" && o.content
      );

      console.log(`[POLL] total=${data.total} assistant=${assistantMessages.length}`);

      if (assistantMessages.length > 0) {
        // We have at least one assistant message
        if (assistantMessages.length === lastAssistantCount) {
          // No NEW assistant messages since last poll
          stableSinceFirstAssistant++;
          if (stableSinceFirstAssistant >= 3) {
            // No new assistant messages for 3 polls (~6s) — collect all and return
            const allReplies = assistantMessages
              .map((m) => m.content!)
              .join("\n\n");
            console.log(`[POLL] Done (${assistantMessages.length} messages, stable)`);
            return allReplies;
          }
        } else {
          // New assistant message arrived — reset stability counter
          stableSinceFirstAssistant = 0;
          lastAssistantCount = assistantMessages.length;
        }
      }

      await this.sleep(2000);
    }

    return "Sorry, the response took too long. Please try again.";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
