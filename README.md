# SlackNotifyJB: Slack notifications from Journey Builder

A custom Journey Builder activity for Salesforce Marketing Cloud (SFMC). Drop it on a journey path, pick a Slack channel and write a message. Each contact who reaches that step triggers a Slack post, such as:

> New VIP Ana (0031x00000AbCdE) reached *VIP alert*

It runs as one Cloudflare Worker. The Worker serves the configuration UI and handles Journey Builder's calls.

## Features

- **Channel picker.** Lists the Slack channels the bot has been invited to. If listing isn't set up, you can enter a channel ID instead.
- **Message templates.** Write the message with `{{Field}}` tokens and insert Entry Event fields with one click. The built-in tokens are `{{JourneyName}}`, `{{ActivityName}}` and `{{ContactKey}}`. A preview shows the result as you type. Slack formatting (`*bold*`, links) works in the template.
- **Safe values.** Contact data is escaped before posting, so a field containing `<!channel>` or a link can't ping a channel or disguise a URL.
- **Flood control.** Messages are spaced about one second apart, which is Slack's per-channel limit. Each activity sends up to a set number of individual messages per hour (60 by default). After that, contacts are counted and posted as a single summary every 5 minutes, for example "…and 1,240 more contacts reached *VIP alert* in Welcome Journey".
- **Never blocks a journey.** Once a request is verified as coming from Journey Builder, the activity always answers `200`. A Slack outage or a wrong channel is logged, and the contact carries on.
- **Signed requests only.** Every Journey Builder call is verified against the installed package's JWT signing secret. The bot token stays in the Worker and never appears in the journey.

## How it works

```
Journey Builder ──(config modal)──▶ Worker: index.html (React + Postmonger)
       │                                  └─ GET /api/channels (checks your SFMC session)
       └──(per contact, signed JWT)──▶ Worker: POST /activity/execute
                                            └─▶ ChannelGate Durable Object (one per channel)
                                                   └─▶ Slack chat.postMessage
```

- **Saving the activity.** The UI writes everything the runtime needs into flat `inArguments`: the channel ID, the template (base64-encoded, so Journey Builder doesn't try to resolve its `{{...}}` tokens), the hourly limit, the journey and activity names, and one `{{Event.<key>.<field>}}` binding per field the template uses. Journey Builder resolves those bindings for each contact. A copy of the settings is also kept in `metaData.slackNotify` so the form reopens as you left it.
- **Execute.** The Worker verifies the JWT, fills in the template and passes the message to the channel's `ChannelGate` Durable Object. The gate reserves a send slot, enforces the hourly limit, and either posts the message or adds the contact to the summary count. The summary is posted by a Durable Object alarm. If Slack returns `429`, the gate honours `Retry-After` and counts the message into the summary.
- **Channel list.** The UI asks Journey Builder for your session token (`requestTokens`) and sends it with the list request. The Worker checks the token with your tenant's `/v2/userinfo` endpoint, and optionally checks the enterprise ID, before returning channel names.

## Setup

You need a Cloudflare account, a Slack workspace where you can create apps, and SFMC admin access to create installed packages.

### 1. Slack app

1. At https://api.slack.com/apps, create an app from scratch.
2. Under **OAuth & Permissions**, add these bot token scopes:
   - `chat:write`, to post messages;
   - `channels:read` and `groups:read`, for the channel picker (public and private channels).
3. Install the app to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
4. In each channel you want to post to, type `/invite @your-bot`.

### 2. Deploy the Worker

```sh
npm ci
npx wrangler login
npx wrangler secret put SLACK_BOT_TOKEN        # the xoxb- token
npm run deploy
```

Note the Worker URL, for example `https://sfmc-slack-notify.<you>.workers.dev`.

### 3. SFMC installed package

1. In **Setup → Apps → Installed Packages**, create a package.
2. Add a **Journey Builder Activity** component:
   - **Category:** Messages.
   - **Endpoint URL:** the Worker URL.
3. Copy the package's **JWT Signing Secret** and the activity's **Unique Key** (the application extension key).

### 4. Finish configuring the Worker

```sh
npx wrangler secret put JWT_SIGNING_SECRET     # from the installed package
```

In the Cloudflare dashboard (Worker → Settings → Variables), add these text variables. `npm run deploy` keeps them.

| Variable | Required | What it is |
|---|---|---|
| `APPLICATION_EXTENSION_KEY` | Yes | The Journey Builder activity's unique key from the installed package |
| `SFMC_SUBDOMAIN` | For the channel picker | Your tenant subdomain, the part before `.auth.marketingcloudapis.com` |
| `SFMC_ENTERPRISE_ID` | Optional | Only allow channel listing for this enterprise (EID) |

Without `SFMC_SUBDOMAIN`, the channel list stays off and people enter a channel ID instead. To find a channel's ID in Slack: click the channel name, then **About**, and it's at the bottom.

Check `https://<worker>/health`. All four flags should be `true`, or `channelListing` `false` if you skipped it.

### 5. Use it

Open a journey. **Slack Notify** is under Messages. Drag it onto a path, then pick the channel, write the message, set the hourly limit and click **Done**. Save the journey, then activate it.

## Local development

```sh
npm ci
npm test           # unit tests (Node)
npm run dev        # UI at http://127.0.0.1:5173/?demo=1
```

The demo uses made-up journey fields and channels, and **Done** saves to the browser's localStorage, so you can reload to test reopening. The demo is switched off inside an iframe.

To run the Worker locally, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `npm run preview`. For offline testing, set `SLACK_API_BASE` to point Slack calls at a mock server.

## Project structure

```
public/config.json      Journey Builder activity definition (URLs and key are filled in by the Worker)
src/shared/             Template tokens, escaping, Entry Event field discovery, save/load of the activity
src/web/                Configuration UI: React + SLDS, Postmonger session, local demo
src/worker/app.ts       Routes: /config.json, /health, /api/channels, /activity/*
src/worker/gate.ts      ChannelGate Durable Object: pacing, hourly limit, summaries
src/worker/jwt.ts       HS256 verification of Journey Builder requests
src/worker/slack.ts     chat.postMessage and conversations.list
src/worker/sfmc.ts      Checks the SFMC session token before listing channels
tests/                  Node test runner tests for all of the above
```

## Known limitations

- **Not yet tested inside a real SFMC org.** Two things are unconfirmed:
  - that `requestTokens` returns a `fuel2token` that `/v2/userinfo` accepts. If it doesn't, the picker falls back to manual channel IDs.
  - the exact shape of the Entry Event schema. Field discovery reads the places a schema has been seen. When none is supplied, the built-in tokens still work.
- **Names are copied at save time.** The journey and activity names in messages are the ones from when the activity was last saved.
- **Channel access isn't checked on publish.** Journey Builder's publish and validate calls don't include the activity's settings, so the Worker can't check that the bot is in the channel before activation. A missing invite shows up as `channel_not_found` in the Worker logs.
- **Hourly counts can reset.** They live in the Durable Object and reset if the object is evicted. That's rare, and the effect is at most one extra batch of individual messages.

## History

Versions before 2.0 were a Postmonger learning experiment that posted to a hardcoded incoming webhook. That code is still in the git history.
