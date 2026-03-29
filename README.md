# Charlie Telegram Bot

A Telegram bot powered by AI. Send messages, photos, documents, voice notes, or videos — the bot forwards them to Charlie and sends back the response.

No AI SDKs needed. No API keys for AI providers. Charlie handles everything.

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

Inside the sandbox, `USER_TOKEN` is already available in the environment. Set only what's needed:

```env
TELEGRAM_BOT_TOKEN=paste_your_bot_token_here
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_USER_TOKEN=${USER_TOKEN}
CHARLIE_API_KEY=not_needed_locally
CHARLIE_CLIENT_ID=not_needed_locally
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
- **API Key** — authenticates the bot to send messages
- **Client ID** — identifies your bot

### 2. Set environment variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_API_KEY=your_api_key
CHARLIE_CLIENT_ID=your_client_id
CHARLIE_USER_TOKEN=your_user_token
```

### 3. Deploy

Deploy as a CloudStation service 

```bash
npm install
npm start
```

The bot runs in polling mode — no webhook setup needed.

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
  charlie-client.ts   — Project API client (send message + poll for response)
  bot.ts              — grammY bot with all message handlers
  main.ts             — Entry point with graceful shutdown
```
