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
  /** Charlie API key for authentication (optional if USER_TOKEN is set) */
  charlieApiKey?: string;
  /** Charlie client ID for authentication (optional if USER_TOKEN is set) */
  charlieClientId?: string;
  /** User token for local testing — bypasses API key auth */
  charlieUserToken?: string;
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
  const userToken = process.env.CHARLIE_USER_TOKEN || process.env.USER_TOKEN;
  const apiKey = process.env.CHARLIE_API_KEY;
  const clientId = process.env.CHARLIE_CLIENT_ID;

  // Either USER_TOKEN or API_KEY+CLIENT_ID must be provided
  if (!userToken && (!apiKey || !clientId)) {
    throw new Error(
      "Authentication required: set CHARLIE_USER_TOKEN (for local testing) or CHARLIE_API_KEY + CHARLIE_CLIENT_ID (for production)"
    );
  }

  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookPort: port,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || `http://localhost:${port}`,
    charlieApiUrl: requireEnv("CHARLIE_API_URL"),
    charlieProjectId: requireEnv("CHARLIE_PROJECT_ID"),
    charlieApiKey: apiKey,
    charlieClientId: clientId,
    charlieUserToken: userToken,
    charlieAgentTemplateId: process.env.CHARLIE_AGENT_TEMPLATE_ID || undefined,
  };
}

export const config = loadConfig();
