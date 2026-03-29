#!/usr/bin/env node

import process from "node:process";
import express from "express";
import { config } from "./config.js";
import { createBot } from "./bot.js";

const TELEGRAM_MAX_LENGTH = 4096;

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

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/charlie-webhook", async (req, res) => {
    res.sendStatus(200);

    const payload = req.body;
    const conversationId: string | undefined = payload?.conversation_id;
    const content: string | undefined = payload?.message?.content;

    if (!conversationId || !content) return;

    // Extract chatId from conversation_id format "telegram-{chatId}"
    const chatIdStr = conversationId.replace(/^telegram-/, "");
    const chatId = Number(chatIdStr);
    if (!chatId || isNaN(chatId)) return;

    console.log(`[CHARLIE] Response for chat ${chatId}: ${content.substring(0, 100)}...`);

    const htmlContent = markdownToHtml(content.trim());
    if (!htmlContent) return;

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

  // --- Start grammY polling ---
  await bot.api.deleteWebhook();

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running (polling mode)`);
      console.log(`Charlie API: ${config.charlieApiUrl}`);
      console.log(`Project ID: ${config.charlieProjectId}`);
      console.log(`Charlie webhook: ${config.webhookBaseUrl}/charlie-webhook`);
    },
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
