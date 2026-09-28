# SlackNotifyJB: Slack notification activity for Journey Builder (experiment)

A Journey Builder custom activity for Salesforce Marketing Cloud (SFMC), meant to send a notification to a Slack channel (through a Slack incoming webhook) when a contact reaches the activity. This repo holds the activity's configuration UI and `config.json`. The execute handler that would actually post to Slack is not in this repo: `config.json` points to an SFMC Code Resource hosted elsewhere.

It is best read as a learning project for the Journey Builder / Postmonger lifecycle. Most of the code logs events rather than doing real work (see Known limitations).

## How it works

### Activity definition (`config.json`)

- Name "Slack Notify", description "Send notification to a channel", category `message`, type `REST`.
- One wizard step, "API Details", in a 600x400 config modal.
- `inArguments`: `emailAddress` bound to `{{InteractionDefaults.Email}}`.
- `outArguments`: `slackEndpoint` (text).
- `execute.url`: an SFMC Code Resource (`pub.sfmc-content.com`) in one specific account.
- `save` (with `useJwt: true`), `publish`, `validate` and `stop` point to `pipedream.net` request bins, which were used to inspect the calls Journey Builder makes.

### Configuration UI (`index.html`, `customActivity.js`)

`index.html` shows one text input for a Slack webhook URL (`https://hooks.slack.com/services/...`). RequireJS loads `customActivity.js`, which uses Postmonger:

- **On render**: triggers `ready`, `requestTokens` and `requestEndpoints`.
- **`initActivity`**: stores the payload Journey Builder sends.
- **`clickedNext`**: builds the webhook URL and checks that its host is `hooks.slack.com`. If it is, it:
  - sets `outArguments` to `[{ slackEndpoint: url }]`,
  - sets `metaData.isConfigured = true`,
  - triggers `updateActivity`.
  Otherwise it shows "Validation Error. URL incorrect".
- **`gotoStep`, `clickedBack`, `requestedTokens`, `requestedEndpoints`, `requestedInteraction*`, `requestedTriggerEventDefinition`**: handlers that mostly log.

Most handlers also call `sendDataToPipedream()`, which posts a short message to a `pipedream.net` URL so you can trace the lifecycle from outside the browser.

## Hosting

The UI files must be on an HTTPS host that SFMC can reach. The repo has two options:

- **PHP**: `index.php` just includes `index.html`.
- **Node**: `index.js` is a small static file server on `process.env.PORT` or `8080` (`node index.js`). Note that `npm start` in `package.json` runs `./bin/start`, which does not exist, and none of the listed dependencies (Express, `fuel-rest`, `jsonwebtoken` and others) are used. There is no Procfile.

## Register it in SFMC

1. Host the files on an HTTPS URL.
2. Edit `config.json`: replace the `execute` URL with your own handler, and replace the `pipedream.net` URLs in `save`, `publish`, `validate` and `stop` with your own endpoints that return HTTP 200. Also remove or change the `pipedream.net` URL in `sendDataToPipedream()` in `customActivity.js`.
3. In SFMC go to **Setup → Apps → Installed Packages**, create a package (or open an existing one), add a **Journey Builder Activity** component, and set its endpoint URL to the hosted folder that contains `config.json`.
4. The activity then appears in the Journey Builder canvas.

You also need an execute endpoint that reads `slackEndpoint` (and the contact data) from the request and posts to Slack. That part is not in this repo.

## Project structure

- `config.json`: Journey Builder activity definition.
- `index.html`: configuration screen (webhook URL input).
- `customActivity.js`: Postmonger lifecycle handlers.
- `postmonger.js`, `js/require.js`, `js/jquery.min.js`: vendored libraries.
- `css/`: a few vendored SLDS component stylesheets.
- `images/icon.png`: activity icon.
- `execute.html`: placeholder that only logs "ok".
- `index.php`, `index.js`: hosting options (see above).
- `package.json`: leftover from a Node/Express template, not used by the code.

## Known limitations

- **The URL you type is ignored.** `clickedNext` overwrites the input with a hardcoded webhook URL (marked `//hardcoded`). Every configured activity uses that same URL.
- The execute handler is not included, so the repo cannot send Slack messages by itself.
- `payload.name` is set to the literal text "Send Message to Channel <Channel Name>".
- `initialize` does not restore a saved webhook URL, and it appends the input's value to itself.
- `save()` and `getMessage()` are unused, and `save()` refers to a `#select1` element that does not exist.
- Debug output is added into the config screen (`clickedNext` and `gotoStep` append text to the step).
- Calls to `pipedream.net` send lifecycle messages to a third-party endpoint on every step.
- `package.json` scripts and dependencies do not match the code.
- No tests.

## Ideas

- Use the URL entered by the user, store it in `inArguments`, and restore it on `initActivity`.
- Add a small execute endpoint (Node or SSJS Code Resource) that posts the message to Slack, and add a message text field to the UI.
- Remove the Pipedream tracing and the unused Node template bits.
