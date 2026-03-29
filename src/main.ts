#!/usr/bin/env node

import process from "node:process";
import { config } from "./config.js";
import { createBot } from "./bot.js";

async function main() {
  console.log("Starting Charlie Telegram Bot...");

  const bot = createBot(config);

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("Shutting down...");
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Delete any existing webhook so polling works
  await bot.api.deleteWebhook();

  // Start polling
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running (polling mode)`);
      console.log(`Charlie API: ${config.charlieApiUrl}`);
      console.log(`Project ID: ${config.charlieProjectId}`);
    },
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
