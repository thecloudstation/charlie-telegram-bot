import type { Config } from "./config.js";

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
 * Fire-and-forget: sends a message with a response_webhook URL.
 * Charlie will POST the AI response back to the webhook when ready.
 * No polling needed.
 */
export class CharlieClient {
  private readonly apiUrl: string;
  private readonly projectId: string;
  private readonly apiKey?: string;
  private readonly clientId?: string;
  private readonly userToken?: string;
  private readonly agentTemplateId?: string;
  private readonly responseWebhookUrl: string;

  constructor(config: Config) {
    this.apiUrl = config.charlieApiUrl.replace(/\/+$/, "");
    this.projectId = config.charlieProjectId;
    this.apiKey = config.charlieApiKey;
    this.clientId = config.charlieClientId;
    this.userToken = config.charlieUserToken;
    this.agentTemplateId = config.charlieAgentTemplateId;
    this.responseWebhookUrl = `${config.webhookBaseUrl.replace(/\/+$/, "")}/charlie-webhook`;
  }

  /** Build auth headers — USER_TOKEN for local testing, API keys for production */
  private getAuthHeaders(): Record<string, string> {
    if (this.userToken) {
      return { Authorization: `Bearer ${this.userToken}` };
    }
    return {
      "x-api-key": this.apiKey || "",
      "x-client-id": this.clientId || "",
    };
  }

  /** Send a text message to Charlie. Response comes via webhook callback. */
  async sendMessage(
    conversationId: string,
    message: string,
    sender?: { id: string; name: string }
  ): Promise<void> {
    await this.postMessage(conversationId, message, sender);
  }

  /** Send a message with file content_blocks. Response comes via webhook callback. */
  async sendMessageWithFiles(
    conversationId: string,
    message: string,
    contentBlocks: ContentBlock[],
    sender?: { id: string; name: string }
  ): Promise<void> {
    await this.postMessage(conversationId, message, sender, contentBlocks);
  }

  private async postMessage(
    conversationId: string,
    message: string,
    sender?: { id: string; name: string },
    contentBlocks?: ContentBlock[]
  ): Promise<void> {
    const url = `${this.apiUrl}/v1/projects/${this.projectId}/api/message`;

    const body: Record<string, unknown> = {
      conversation_id: conversationId,
      message,
      platform: "telegram",
      response_webhook: this.responseWebhookUrl,
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
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Charlie API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { adw_id: string };
    console.log(`[API] Sent message -> adw_id: ${data.adw_id}`);
  }
}
