# Office Hours - GitHub Actions, April 2026 highlights

**Date:** 2026-05-12  &middot;  **Length:** ~35 min (25 walkthrough + 10 Q&A)  &middot;  **Audience:** internal devs already using Actions

Two features released in the last quarter that quietly remove pain in
real workflows:

1. **Service container `entrypoint` and `command` overrides** (early April 2026)
2. **`deployment: false` for environments**

---

## Repo layout

```
curly-engine/
├── DEMO_SCRIPT.md                            <- this file
├── README.md
├── requirements.txt
├── src/app.py                                <- sample app exercised by demo 1
├── tests/test_app.py                         <- pytest run inside demo 1 workflow
├── .github/workflows/
│   ├── demo-service-containers.yml           <- demo 1 (3 jobs: before / after / postgres)
│   └── demo-deployment-flag.yml              <- demo 2 (ship-it / audit / rotate)
├── slides/
│   ├── index.html                            <- projector deck
│   └── notes.html                            <- presenter window with notes + pacing
└── webhook-harness/
    ├── server.js                             <- zero-dep Node server
    ├── package.json
    ├── public/index.html                     <- live dashboard
    └── test/harness.test.js                  <- self-test (`npm test`)
```

---

## Pre-flight (do this ~15 min before the session)

1. **Pull the branch** and open three terminals.
2. **Repo settings on github.com/seandorsett/curly-engine:**
   - Environments: create `staging`, `production`, `ops-readonly`.
     - On `production`: add a required reviewer (yourself), 0 min wait timer.
     - Add a fake secret `API_TOKEN=demo-token-prod` on `production`, `staging`.
     - Add `ROTATION_TOKEN=demo-rotation` on `production`.
   - Repo secrets: `REDIS_PASSWORD=office-hours-demo`, `WEBHOOK_TOKEN=office-hours-demo`.
   - Repo variables: `WEBHOOK_URL=https://<your-tunnel>.trycloudflare.com`
     (set this after step 4).
3. **Terminal 1 - harness:**
   ```bash
   cd webhook-harness
   WEBHOOK_TOKEN=office-hours-demo node server.js
   ```
   Confirm it started: `http://localhost:4317/healthz` should return `{"ok":true}`.

4. **Terminal 2 - local smoke test** (no tunnel needed — this confirms the harness works):
   ```bash
   curl -sS -X POST "http://localhost:4317/events" \
     -H "content-type: application/json" \
     -H "x-demo-token: office-hours-demo" \
     -d '{"demo":"smoke","run_id":"0","sha":"0000000","jobs":{"smoke":"success"}}'
   ```
   You should get `{"accepted":true}` and see the row appear in the dashboard at `http://localhost:4317`.

5. **Terminal 2 - tunnel** (only needed so GitHub-hosted runners can reach the harness):
   ```bash
   # cloudflared (no account needed)
   cloudflared tunnel --url http://localhost:4317

   # or ngrok (free account + authtoken required)
   ngrok http 4317

   # or localtunnel (no install, no account)
   npx localtunnel --port 4317
   ```
   Copy the public URL, then:
   ```bash
   # Export it locally so you can verify the tunnel end-to-end
   export WEBHOOK_URL="https://<your-tunnel-url>"
   curl -sS -X POST "$WEBHOOK_URL/events" \
     -H "content-type: application/json" \
     -H "x-demo-token: office-hours-demo" \
     -d '{"demo":"tunnel-check","run_id":"0","sha":"0000000","jobs":{"tunnel":"success"}}'
   ```
   Then paste the same URL into the `WEBHOOK_URL` **repo variable** on GitHub
   (Settings → Variables → Actions → New repository variable).
6. **Browser windows arranged left-to-right on the projector:**
   - Window A: `slides/index.html`  (projector view)
   - Window B: `slides/notes.html`  (presenter laptop screen only)
   - Window C: harness dashboard (`http://localhost:4317`)
   - Window D: GitHub Actions tab for the repo
7. Press `p` on the slide window to pop notes if you haven't already.
   Press `f` for fullscreen on the projector.

---

## Run sheet

Cumulative time in the right column. The presenter notes window shows a live
drift indicator so you can tell if you're ahead or behind.

| t (cum) | dur | slide | what happens |
| ------- | --- | ----- | ------------ |
| 00:00   | 1:00 | 1 Title       | Welcome, scope (2 features), mention the harness window. |
| 01:00   | 1:30 | 2 Agenda      | Walk the timetable; tell them notes are mirrored to your screen. |
| 02:30   | 1:30 | 3 TL;DR       | One-sentence pitch per feature. Don't open YAML yet. |
| 04:00   | 2:00 | 4 Demo1 pain  | Show-of-hands: who maintains a custom service image? |
| 06:00   | 2:30 | 5 Before/After| Read the diff aloud, point at `entrypoint:` and `command:`. |
| 08:30   | 3:30 | 6 Demo1 live  | **See "Demo 1 actions" below.** |
| 12:00   | 1:30 | 7 Demo1 wrap  | Three use cases + the "entrypoint replaces" gotcha. |
| 13:30   | 2:00 | 8 Demo2 pain  | "Environments bundle three things; sometimes you only want two." |
| 15:30   | 2:30 | 9 5-line diff | The whole feature on one slide. Stress the four bullets at the bottom. |
| 18:00   | 3:30 | 10 Demo2 live | **See "Demo 2 actions" below.** |
| 21:30   | 1:30 | 11 Demo2 wrap | Concrete use cases (audits, rotations, smoke tests). |
| 23:00   | 1:00 | 12 Harness    | Show the dashboard, mention `npm test`. |
| 24:00   | 1:00 | 13 Gotchas    | Four bullets. Don't dwell, just plant the flags. |
| 25:00   | 10:00 | 14 Recap     | Q&A. Leave the harness up; people often ask to run it themselves. |

### Demo 1 actions (slide 6, ~3:30)

1. Switch to Window D (Actions tab). Workflow: `demo-1 service container overrides`.
2. Click **Run workflow** &rarr; **Run workflow** (defaults are fine).
3. While waiting (~60s), flip back to slide 5 and re-read the right column.
4. When jobs go green:
   - Click `with-entrypoint-override` &rarr; expand `Initialize containers`. Point at the line that shows
     `docker create ... --entrypoint redis-server ... redis:7-alpine --requirepass *** --maxmemory 64mb`.
     Say: "*That's the new shape - entrypoint and command land where you'd expect.*"
   - Click `postgres-bootstrap` &rarr; `confirm the seed table exists`. The `\dt` output shows the seeded `pings` table.
5. Flip to Window C (harness). Three rows from `service-container-overrides` should be visible with `success` everywhere.

### Demo 2 actions (slide 10, ~3:30)

1. Window D, workflow `demo-2 deployment-false environments`. Click **Run workflow**.
2. **First run:** set `target=staging`. Click run.
   - `ship-it` will wait if you put protection rules on staging - approve it.
   - When it goes green, click into the run &rarr; left sidebar shows a **Deployment** entry; the SHA in the Code tab has a green bubble.
3. **Second run:** click **Run workflow** again, set `target=ops-readonly`. Click run.
   - `audit-prod-config` runs. The `production` env still gates it (approve if prompted), but **no deployment row appears**.
4. Flip to Window C (harness). Filter `kind = deployment-false`. Both runs are there. Now flip the filter to `source = github`; only the staging run produced a `deployment` event - that's the headline.
5. Optional: open the SHA in the Code tab. Only one green bubble next to the commit.

---

## Talking points cheat-sheet (in case you go off-script)

**Service container overrides**
- It maps to `docker run --entrypoint X image Y Z`. Same mental model.
- `entrypoint` replaces the image's default. `command` is appended after it.
- If you only want to pass args, set `command:` alone - the image's entrypoint still runs.
- Secrets work in both fields; they're masked in logs.
- Doesn't replace the need for a custom image when you actually need extra binaries or files baked in.

**`deployment: false`**
- The environment object in the repo still has to exist; approvals/wait-timers still apply.
- Scoped secrets and variables behave identically to a normal environment.
- Tradeoff: any downstream automation that listened for `deployment`/`deployment_status` webhooks will not see these runs. That's the point, but audit your listeners.
- The Environments UI shows the env as "in use" but does not list a deployment.

**Webhook harness**
- It accepts both the workflow's own status pings (`/events`) and real GitHub webhooks (`/github`, HMAC-verified).
- Useful for the demo because the audience can see *what GitHub sent and what we sent* side by side.
- `npm test` inside `webhook-harness/` runs an end-to-end smoke test (boots server, posts events, asserts SSE replay).

---

## If something goes sideways

- **Workflow won't trigger / says "no permissions":** check that the branch has the workflow files at the path GitHub expects. The repo default branch must contain the file for `workflow_dispatch` to appear.
- **Harness shows no rows during a run:** verify `WEBHOOK_URL` is set as a *repo variable* (not a secret), and that the tunnel is still alive. `curl $WEBHOOK_URL/healthz` from your laptop.
- **`production` environment doesn't gate:** you forgot to add yourself as a required reviewer. Repo settings -> environments -> production.
- **Audience asks "can I see the diff?"**: the repo URL is on the recap slide. The two YAML files are short enough to read on screen.
