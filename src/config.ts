import "dotenv/config";

export interface Config {
  /** Telegram bot token from @BotFather */
  telegramBotToken: string;
  /** Charlie Project API base URL */
  charlieApiUrl: string;
  /** Charlie project ID */
  charlieProjectId: string;
  /** Charlie API key for authentication */
  charlieApiKey: string;
  /** Charlie client ID for authentication */
  charlieClientId: string;
  /** User token for polling thread outputs (Bearer auth) */
  charlieUserToken: string;
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
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    charlieApiUrl: requireEnv("CHARLIE_API_URL"),
    charlieProjectId: requireEnv("CHARLIE_PROJECT_ID"),
    charlieApiKey: requireEnv("CHARLIE_API_KEY"),
    charlieClientId: requireEnv("CHARLIE_CLIENT_ID"),
    charlieUserToken: requireEnv("CHARLIE_USER_TOKEN"),
    charlieAgentTemplateId: process.env.CHARLIE_AGENT_TEMPLATE_ID || undefined,
  };
}

export const config = loadConfig();
