# curly-engine

Materials for the **GitHub Actions office hours** session on 2026-05-12.

Two features released over the past quarter, demoed end-to-end:

1. **Service container `entrypoint` and `command` overrides** (released early April 2026)
   &mdash; see [`.github/workflows/demo-service-containers.yml`](.github/workflows/demo-service-containers.yml)
2. **`deployment: false` for environments**
   &mdash; see [`.github/workflows/demo-deployment-flag.yml`](.github/workflows/demo-deployment-flag.yml)

## What's in here

| Path | Purpose |
| ---- | ------- |
| [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) | Full run sheet with timing, pre-flight, and recovery steps. |
| [`slides/index.html`](slides/index.html) | Projector deck. Open in a browser. |
| [`slides/notes.html`](slides/notes.html) | Presenter view (auto-syncs via `BroadcastChannel`). |
| [`webhook-harness/`](webhook-harness/) | Zero-dep Node monitor for workflow + GitHub events. |
| [`src/`](src/), [`tests/`](tests/) | Trivial sample app that demo 1 exercises. |

## Quick start

```bash
# 1. start the webhook harness (terminal A)
cd webhook-harness && node server.js
#    -> dashboard at http://localhost:4317

# 2. expose it so workflow runs can post to it (terminal B)
cloudflared tunnel --url http://localhost:4317
#    -> copy the public URL into the repo variable WEBHOOK_URL

# 3. open the slide deck (terminal C, or just double-click)
open slides/index.html        # press `p` for presenter view, `f` for fullscreen
```

## Presenter view

The deck and the notes page talk to each other through the
[`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) API.
Open `slides/index.html` on the projector, then either press `p` or click
**open presenter view** to pop `notes.html` into a second window on the
laptop screen. Arrow keys / page-up-down in either window navigate both.

The presenter window shows:
- the title of the current slide
- the talking points / cues for it
- the title and first line of the **next** slide
- a live timer and a pacing indicator (`+30s`, `-12s`, &hellip;)
  measured against the targets in `DEMO_SCRIPT.md`

## Webhook harness

A small Node http server, no dependencies. It accepts:

| Endpoint | Source | Notes |
| -------- | ------ | ----- |
| `POST /events` | the demo workflows | requires `x-demo-token: $WEBHOOK_TOKEN` |
| `POST /github` | real GitHub webhooks | HMAC-verifies `x-hub-signature-256` against `GITHUB_WEBHOOK_SECRET` |
| `GET /stream` | the dashboard | Server-Sent Events feed |
| `GET /api/events` | scripts | flat JSON of every recorded event |
| `GET /healthz` | uptime checks | |

Test it without booting the workflows:

```bash
cd webhook-harness
npm test          # boots on a random port, runs 7 assertions, exits 0/1
```

## Branch

All of this lives on `claude/github-actions-features-71S3r`.
