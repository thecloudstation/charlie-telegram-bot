# Charlie Telegram Bot

A Telegram bot powered by AI. Send messages, photos, documents, voice notes, or videos — the bot forwards them to Charlie and sends back the response.

No AI SDKs needed. No API keys for AI providers. Charlie handles everything.

## How It Works

1. A user sends a Telegram message to the bot
2. The bot receives it via grammY polling
3. The message is forwarded to Charlie's Project API with a `response_webhook` URL
4. Charlie processes the message and POSTs the AI response back to `/charlie-webhook`
5. The bot sends the response to the user via Telegram Bot API

No polling for AI responses. No extra tokens. Just two API credentials: **API Key** + **Client ID**.

## Quick Start (Local / Sandbox)

If you're running this inside a CloudStation sandbox where Charlie is already running, most environment variables are already set. You only need to add the Telegram bot token.

### 1. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Configure

```bash
cp .env.example .env
```

Set what's needed:

```env
TELEGRAM_BOT_TOKEN=paste_your_bot_token_here
WEBHOOK_PORT=3000
WEBHOOK_BASE_URL=http://localhost:3000
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_API_KEY=your_api_key
CHARLIE_CLIENT_ID=your_client_id
```

### 3. Run

```bash
npm install
npm run dev
```

Send a message to your bot on Telegram. It should respond with Charlie's reply.

### 4. Test

- Send text messages — bot should reply
- Send a photo — bot should describe what it sees
- Send a document — bot should process it

Once everything works, you're ready to deploy.

---

## Deploy to CloudStation

When you're ready to run the bot permanently outside the sandbox, you'll need proper API credentials.

### 1. Get API credentials

Go to your CloudStation project settings and create a Project API key. You'll get:
- **API Key** — authenticates the bot
- **Client ID** — identifies your bot

### 2. Set environment variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
WEBHOOK_PORT=3000
WEBHOOK_BASE_URL=https://your-bot.cloud-station.io
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_API_KEY=your_api_key
CHARLIE_CLIENT_ID=your_client_id
```

`WEBHOOK_BASE_URL` must be the public URL where Charlie can reach your bot. This is your deployed service URL.

### 3. Deploy

Deploy as a CloudStation service.

```bash
npm install
npm start
```

The bot uses grammY polling for Telegram messages (no Telegram webhook setup needed) and runs an HTTP server on `WEBHOOK_PORT` to receive Charlie's response callbacks.

---

## Supported Message Types

| Type | What happens |
|------|-------------|
| Text | Forwarded to Charlie as-is |
| Photos | Downloaded, sent as base64 so Charlie can see the image |
| Documents | Downloaded, sent as base64 so Charlie can read the content |
| Voice | Downloaded, sent as base64 |
| Videos | Downloaded, sent as base64 |
| Stickers | Emoji description sent to Charlie |
| Location | Coordinates sent to Charlie |

Files larger than 20 MB are described in text only.

## Project Structure

```
src/
  config.ts           — Environment variable loading
  charlie-client.ts   — Project API client (fire-and-forget with response_webhook)
  bot.ts              — grammY bot with all message handlers
  main.ts             — Entry point: grammY polling + Express webhook server
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `WEBHOOK_PORT` | No | Port for the webhook server (default: 3000) |
| `WEBHOOK_BASE_URL` | No | Public URL of the bot (default: `http://localhost:{port}`) |
| `CHARLIE_API_URL` | Yes | Charlie backend URL |
| `CHARLIE_PROJECT_ID` | Yes | Your project ID |
| `CHARLIE_API_KEY` | Yes | Project API key |
| `CHARLIE_CLIENT_ID` | Yes | Project API client ID |
| `CHARLIE_AGENT_TEMPLATE_ID` | No | Agent template to use (default: Charlie) |
