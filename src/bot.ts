import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Bot } from "grammy";
import type { Config } from "./config.js";
import { CharlieClient, type ContentBlock } from "./charlie-client.js";

/** Telegram message length limit */
const TELEGRAM_MAX_LENGTH = 4096;

/** Max file size for base64 encoding (20 MB). Larger files get text-only description. */
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Temp directory for downloaded media */
const TEMP_DIR = path.join(os.tmpdir(), "charlie-telegram-bot");

/**
 * Ensure the temp directory exists.
 */
function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Clean up a temporary file silently.
 */
function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Format a file size in bytes to a human-readable string.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert markdown to Telegram HTML.
 *
 * Handles bold, italic, inline code, and fenced code blocks.
 * Falls back to plain text if HTML parsing fails on send.
 */
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

/**
 * Split a long message into chunks that fit within Telegram's 4096-char limit.
 * Splits on newlines first, then on spaces, then hard-cuts as a last resort.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitIndex <= 0) {
      splitIndex = TELEGRAM_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Send Charlie's response back to the user.
 *
 * Converts markdown to HTML, splits long messages, and sends them.
 */
async function sendCharlieResponse(
  ctx: { reply: Function; chat: { id: number } },
  response: string
): Promise<void> {
  const htmlContent = markdownToHtml(response.trim());
  if (!htmlContent) return;

  const chunks = splitMessage(htmlContent);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch {
      // If HTML fails, fall back to plain text (strip tags)
      const plain = chunk.replace(/<[^>]+>/g, "");
      try {
        await ctx.reply(plain);
      } catch {
        // Last resort -- skip this chunk
      }
    }
  }
}

/**
 * Start a typing indicator that stays alive until cleared.
 * Returns the interval ID so callers can clear it.
 */
function startTypingIndicator(ctx: { replyWithChatAction: Function }): ReturnType<typeof setInterval> {
  ctx.replyWithChatAction("typing").catch(() => {});
  return setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);
}

/**
 * Download a Telegram file and return both the local path and the raw Buffer.
 */
async function downloadTelegramFile(
  bot: Bot,
  fileId: string,
  filename: string
): Promise<{ localPath: string; buffer: Buffer }> {
  ensureTempDir();

  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path;

  if (!filePath) {
    throw new Error("Telegram did not return a file_path for the file.");
  }

  const downloadUrl = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download file from Telegram: ${response.status}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const localPath = path.join(TEMP_DIR, `${Date.now()}-${filename}`);
  fs.writeFileSync(localPath, buffer);

  return { localPath, buffer };
}

/**
 * Determine the MIME type from a filename extension.
 */
function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  return mimeMap[ext] || "application/octet-stream";
}

/**
 * Build a content_block for an image.
 */
function buildImageBlock(buffer: Buffer, mediaType: string): ContentBlock {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: buffer.toString("base64"),
    },
  };
}

/**
 * Build a content_block for a document.
 */
function buildDocumentBlock(
  buffer: Buffer,
  mediaType: string,
  filename?: string
): ContentBlock {
  const block: ContentBlock = {
    type: "document",
    source: {
      type: "base64",
      media_type: mediaType,
      data: buffer.toString("base64"),
    },
  };
  if (filename) {
    (block.source as { filename?: string }).filename = filename;
  }
  return block;
}

/**
 * Create and configure the grammY bot.
 *
 * The bot acts as a messenger: it receives Telegram messages,
 * forwards them to Charlie's Project API, and sends the response back.
 *
 * Supports: text, photos, voice messages, documents, videos, stickers, and locations.
 *
 * File handling: Photos and documents are sent as base64 content_blocks
 * directly in the Project API request. Files larger than 20 MB are described in text only.
 */
export function createBot(config: Config): Bot {
  const bot = new Bot(config.telegramBotToken);
  const charlie = new CharlieClient(config);

  // Ensure temp dir exists on startup
  ensureTempDir();

  // --- Commands ---

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hello! I'm your AI assistant on Telegram.\n\n" +
        "Send me text, photos, voice messages, documents, or videos and I'll help you out."
    );
  });

  // --- Text message handler ---

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const userMessage = ctx.message.text;
    const userName = ctx.from?.first_name || "Unknown";

    console.log(`[MSG] ${userName} (${chatId}): ${userMessage.substring(0, 100)}`);

    const typingInterval = startTypingIndicator(ctx);

    try {
      const response = await charlie.sendMessage(
        conversationId,
        userMessage,
        { id: String(chatId), name: userName }
      );
      clearInterval(typingInterval);
      console.log(`[REPLY] -> ${response.substring(0, 100)}...`);
      await sendCharlieResponse(ctx, response);
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your message. Please try again."
      );
    }
  });

  // --- Photo handler ---

  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const caption = ctx.message.caption || "";
    const userName = ctx.from?.first_name || "Unknown";

    const typingInterval = startTypingIndicator(ctx);
    let localPath: string | undefined;

    try {
      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];

      const filename = `photo-${bestPhoto.file_unique_id}.jpg`;
      const { localPath: downloadedPath, buffer } =
        await downloadTelegramFile(bot, bestPhoto.file_id, filename);
      localPath = downloadedPath;

      let commandText = caption
        ? `User sent a photo with caption: ${caption}`
        : "User sent a photo";

      if (buffer.length <= MAX_FILE_SIZE_BYTES) {
        const contentBlock = buildImageBlock(buffer, "image/jpeg");
        console.log(
          `[PHOTO] Sending as content_block (${formatFileSize(buffer.length)})`
        );

        const response = await charlie.sendMessageWithFiles(
          conversationId,
          commandText,
          [contentBlock],
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      } else {
        commandText += ` (${formatFileSize(buffer.length)}, too large to process)`;
        const response = await charlie.sendMessage(
          conversationId,
          commandText,
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] photo from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your photo. Please try again."
      );
    } finally {
      if (localPath) cleanupFile(localPath);
    }
  });

  // --- Voice message handler ---

  bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const voice = ctx.message.voice;
    const duration = voice.duration;
    const userName = ctx.from?.first_name || "Unknown";

    const typingInterval = startTypingIndicator(ctx);
    let localPath: string | undefined;

    try {
      const filename = `voice-${voice.file_unique_id}.ogg`;
      const { localPath: downloadedPath, buffer } =
        await downloadTelegramFile(bot, voice.file_id, filename);
      localPath = downloadedPath;

      const commandText = `User sent a voice message (duration: ${duration}s)`;

      if (buffer.length <= MAX_FILE_SIZE_BYTES) {
        const contentBlock = buildDocumentBlock(
          buffer,
          "audio/ogg",
          filename
        );
        console.log(
          `[VOICE] Sending as content_block (${formatFileSize(buffer.length)})`
        );

        const response = await charlie.sendMessageWithFiles(
          conversationId,
          commandText,
          [contentBlock],
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      } else {
        const response = await charlie.sendMessage(
          conversationId,
          commandText,
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] voice from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your voice message. Please try again."
      );
    } finally {
      if (localPath) cleanupFile(localPath);
    }
  });

  // --- Document handler ---

  bot.on("message:document", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const doc = ctx.message.document;
    const caption = ctx.message.caption || "";
    const fileName = doc.file_name || "unknown-file";
    const fileSize = doc.file_size || 0;
    const userName = ctx.from?.first_name || "Unknown";

    const typingInterval = startTypingIndicator(ctx);
    let localPath: string | undefined;

    try {
      const { localPath: downloadedPath, buffer } =
        await downloadTelegramFile(bot, doc.file_id, fileName);
      localPath = downloadedPath;

      let commandText = `User sent a document: ${fileName} (${formatFileSize(fileSize)})`;
      if (caption) {
        commandText += `\nCaption: ${caption}`;
      }

      const mimeType = doc.mime_type || mimeFromFilename(fileName);
      const isImage = mimeType.startsWith("image/");

      if (buffer.length <= MAX_FILE_SIZE_BYTES) {
        const contentBlock = isImage
          ? buildImageBlock(buffer, mimeType)
          : buildDocumentBlock(buffer, mimeType, fileName);

        console.log(
          `[DOC] Sending ${fileName} as ${isImage ? "image" : "document"} content_block (${formatFileSize(buffer.length)})`
        );

        const response = await charlie.sendMessageWithFiles(
          conversationId,
          commandText,
          [contentBlock],
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      } else {
        commandText += ` -- file too large to process inline`;
        const response = await charlie.sendMessage(
          conversationId,
          commandText,
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] document from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your document. Please try again."
      );
    } finally {
      if (localPath) cleanupFile(localPath);
    }
  });

  // --- Video handler ---

  bot.on("message:video", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const video = ctx.message.video;
    const caption = ctx.message.caption || "";
    const duration = video.duration;
    const userName = ctx.from?.first_name || "Unknown";

    const typingInterval = startTypingIndicator(ctx);
    let localPath: string | undefined;

    try {
      const filename = `video-${video.file_unique_id}.mp4`;
      const { localPath: downloadedPath, buffer } =
        await downloadTelegramFile(bot, video.file_id, filename);
      localPath = downloadedPath;

      let commandText = `User sent a video (duration: ${duration}s)`;
      if (caption) {
        commandText += `\nCaption: ${caption}`;
      }

      if (buffer.length <= MAX_FILE_SIZE_BYTES) {
        const contentBlock = buildDocumentBlock(
          buffer,
          "video/mp4",
          filename
        );
        console.log(
          `[VIDEO] Sending as document content_block (${formatFileSize(buffer.length)})`
        );

        const response = await charlie.sendMessageWithFiles(
          conversationId,
          commandText,
          [contentBlock],
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      } else {
        commandText += ` (${formatFileSize(buffer.length)}, too large to process)`;
        const response = await charlie.sendMessage(
          conversationId,
          commandText,
          { id: String(chatId), name: userName }
        );
        clearInterval(typingInterval);
        await sendCharlieResponse(ctx, response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] video from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your video. Please try again."
      );
    } finally {
      if (localPath) cleanupFile(localPath);
    }
  });

  // --- Sticker handler ---

  bot.on("message:sticker", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const sticker = ctx.message.sticker;
    const emoji = sticker.emoji || "unknown";

    const typingInterval = startTypingIndicator(ctx);

    try {
      const message = `User sent a sticker: ${emoji}`;
      const response = await charlie.sendMessage(conversationId, message);
      clearInterval(typingInterval);
      await sendCharlieResponse(ctx, response);
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] sticker from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your sticker. Please try again."
      );
    }
  });

  // --- Location handler ---

  bot.on("message:location", async (ctx) => {
    const chatId = ctx.chat.id;
    const conversationId = `telegram-${chatId}`;
    const location = ctx.message.location;

    const typingInterval = startTypingIndicator(ctx);

    try {
      const message = `User shared location: lat=${location.latitude}, lng=${location.longitude}`;
      const response = await charlie.sendMessage(conversationId, message);
      clearInterval(typingInterval);
      await sendCharlieResponse(ctx, response);
    } catch (error) {
      clearInterval(typingInterval);
      console.error(
        `[ERROR] location from chat ${chatId}:`,
        error instanceof Error ? error.message : error
      );
      await ctx.reply(
        "Something went wrong while processing your location. Please try again."
      );
    }
  });

  // --- Catch-all for unsupported message types ---

  bot.on("message", async (ctx) => {
    await ctx.reply(
      "I don't support this message type yet. " +
        "Try sending text, photos, voice messages, documents, videos, stickers, or locations."
    );
  });

  // --- Error handler ---

  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  return bot;
}
