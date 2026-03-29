import "dotenv/config";

export interface Config {
  /** Telegram bot token from @BotFather */
  telegramBotToken: string;
  /** Port for the webhook server (default: 3000) */
  webhookPort: number;
  /** Public base URL of this bot (for Charlie to call back) */
  webhookBaseUrl: string;
  /** Charlie Project API base URL */
  charlieApiUrl: string;
  /** Charlie project ID */
  charlieProjectId: string;
  /** Charlie API key for authentication */
  charlieApiKey: string;
  /** Charlie client ID for authentication */
  charlieClientId: string;
  /** Optional agent template ID */
  charlieAgentTemplateId?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.WEBHOOK_PORT || "3000", 10);
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookPort: port,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || `http://localhost:${port}`,
    charlieApiUrl: requireEnv("CHARLIE_API_URL"),
    charlieProjectId: requireEnv("CHARLIE_PROJECT_ID"),
    charlieApiKey: requireEnv("CHARLIE_API_KEY"),
    charlieClientId: requireEnv("CHARLIE_CLIENT_ID"),
    charlieAgentTemplateId: process.env.CHARLIE_AGENT_TEMPLATE_ID || undefined,
  };
}

export const config = loadConfig();
