#!/usr/bin/env node

import process from "node:process";
import express from "express";
import { config } from "./config.js";
import { createBot } from "./bot.js";

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Match an [ESCALATE: <summary>] marker the agent emits to request human handoff.
 * Anchored to end-of-message; agent is instructed to put it on its own line at the end.
 */
const ESCALATION_MARKER_RE = /\[ESCALATE:\s*([^\]]+?)\]\s*$/m;

/**
 * Extract an escalation marker from agent content.
 * Returns the cleaned content (with marker stripped) and the summary, if present.
 */
function extractEscalation(content: string): { content: string; summary?: string } {
  const match = content.match(ESCALATION_MARKER_RE);
  if (!match) return { content };
  const summary = match[1].trim();
  const cleaned = content.replace(ESCALATION_MARKER_RE, "").trimEnd();
  return { content: cleaned, summary };
}

function markdownToHtml(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => {
      const code = m.replace(/```\w*\n?/g, "").replace(/```$/g, "");
      return `<pre>${code}</pre>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>");
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    if (splitIndex <= 0) splitIndex = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    if (splitIndex <= 0) splitIndex = TELEGRAM_MAX_LENGTH;
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }
  return chunks;
}

async function main() {
  console.log("Starting Charlie Telegram Bot...");

  const bot = createBot(config);

  // --- Express server for Charlie webhook callbacks ---
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/charlie-webhook", async (req, res) => {
    res.sendStatus(200);

    const payload = req.body;
    console.log(`[WEBHOOK] Received POST /charlie-webhook — conversation_id: ${payload?.conversation_id}, event_type: ${payload?.message?.event_type}`);

    const conversationId: string | undefined = payload?.conversation_id;
    const content: string | undefined = payload?.message?.content;

    if (!conversationId || !content) return;

    // Extract chatId from conversation_id format "telegram-{chatId}"
    const chatIdStr = conversationId.replace(/^telegram-/, "");
    const chatId = Number(chatIdStr);
    if (!chatId || isNaN(chatId)) {
      console.warn(`[CHARLIE] Could not extract chatId from conversation_id: ${conversationId}`);
      return;
    }

    console.log(`[CHARLIE] Response for chat ${chatId}: ${content.substring(0, 100)}...`);

    // Parse out the [ESCALATE: ...] marker (if any) BEFORE sending to the customer
    const { content: customerContent, summary: escalationSummary } = extractEscalation(content.trim());

    const htmlContent = markdownToHtml(customerContent);
    if (htmlContent) {
      const chunks = splitMessage(htmlContent);
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk, { parse_mode: "HTML" });
        } catch {
          const plain = chunk.replace(/<[^>]+>/g, "");
          try {
            await bot.api.sendMessage(chatId, plain);
          } catch {
            // Skip chunk
          }
        }
      }
    }

    // If the agent escalated, forward a one-message summary to the escalation chat
    if (escalationSummary) {
      if (!config.escalationChatId) {
        console.warn(
          `[ESCALATION] Agent emitted [ESCALATE: ${escalationSummary}] but ESCALATION_CHAT_ID is not set — dropping forward.`
        );
      } else {
        const forwardMsg =
          `🔔 Escalation from chat ${chatId}\n\n` +
          `Summary: ${escalationSummary}\n\n` +
          `Conversation ID: ${conversationId}`;
        try {
          await bot.api.sendMessage(config.escalationChatId, forwardMsg);
          console.log(
            `[ESCALATION] Forwarded chat ${chatId} → ${config.escalationChatId}: ${escalationSummary.substring(0, 80)}`
          );
        } catch (err) {
          console.error(
            `[ESCALATION] Failed to forward to chat ${config.escalationChatId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  });

  const server = app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  // --- Graceful shutdown ---
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("Shutting down...");
    server.close(() => {});
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- Start grammY polling with retry on 409 conflict ---
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await bot.api.deleteWebhook();
      await bot.start({
        onStart: (botInfo) => {
          console.log(`Bot @${botInfo.username} is running (polling mode)`);
          console.log(`Charlie API: ${config.charlieApiUrl}`);
          console.log(`Project ID: ${config.charlieProjectId}`);
          console.log(`Charlie webhook: ${config.webhookBaseUrl}/charlie-webhook`);
        },
      });
      break; // If bot.start() resolves cleanly, exit loop
    } catch (error: unknown) {
      const is409 =
        error instanceof Error &&
        (error.message.includes("409") || error.message.includes("Conflict"));
      if (is409 && attempt < MAX_RETRIES) {
        const delay = attempt * 5;
        console.warn(
          `[RETRY] 409 Conflict on attempt ${attempt}/${MAX_RETRIES}. Waiting ${delay}s before retry...`
        );
        await new Promise((r) => setTimeout(r, delay * 1000));
      } else {
        throw error;
      }
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
