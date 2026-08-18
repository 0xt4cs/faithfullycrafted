# Deployment

The site is a static Astro build published to Cloudflare Pages (project `faithfullycrafted`).
The only thing that changes between rebuilds is the gallery: `scripts/fetch-gallery.mjs` reads the
Facebook Page via the Graph API at build time, downloads and compresses new images into
`public/gallery/`, and rewrites `public/gallery/_manifest.json`.

So "deployment" is really two questions: what publishes the site, and what makes it rebuild on a
schedule so new Facebook posts appear.

## The three paths

| Path                                            | Trigger                                             | Runs where             | Role                                                                  |
| ----------------------------------------------- | --------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| Cloudflare Pages Git integration                | every push to `main`                                | Cloudflare build image | Ships code changes. Always on, nothing to maintain.                   |
| **Cloudflare cron Worker** (`cron-worker/`)     | cron `0 18 */3 * *` UTC (02:00 Asia/Manila)         | Cloudflare Workers     | **Primary scheduled rebuild.** Fires a Pages Deploy Hook.             |
| GitHub Actions (`.github/workflows/deploy.yml`) | cron `0 0 */3 * *` UTC + manual `workflow_dispatch` | GitHub-hosted runner   | Escape hatch and the only path that commits the manifest back to git. |

### Why the cron lives on Cloudflare

GitHub automatically disables cron-triggered workflows after 60 days of repository inactivity. That
is exactly what happened between 2026-04-29 and 2026-08-18: the schedule stopped silently, nobody
was notified in a way anyone noticed, and the gallery went stale for 111 days. Cloudflare Workers
crons have no such rule, so the schedule was moved there.

### What the GitHub path still gives you

- A **manual rebuild button** (Actions tab, "Scheduled Rebuild and Deploy", "Run workflow") that
  works even if Cloudflare's build queue or the deploy hook is broken.
- A **cached gallery**: `actions/cache` keeps `public/gallery` between runs, so a warm run only
  downloads genuinely new images instead of all ~90. `downloadImage()` skips files already on disk.
- It **commits the refreshed `_manifest.json` back to `main`** when it changed, with `[skip ci]` so
  neither GitHub Actions nor the Cloudflare Git integration rebuilds what it just deployed. That
  commit doubles as real repository activity, which keeps its own cron trigger alive.
- A **failure canary**: on any failure it opens (or comments on) a single issue titled
  "Scheduled rebuild failed", labelled `scheduled-rebuild-failure`, containing the run URL and the
  name of the step that failed.

### Honest tradeoffs

- **Both schedules are active**, 18 hours apart, so a normal 3-day cycle produces two production
  builds. That is harmless but redundant. If you want exactly one, delete the `schedule:` block from
  `.github/workflows/deploy.yml` and keep `workflow_dispatch:`.
- `*/3` in the day-of-month field restarts each month, so the gap between the last rebuild of one
  month and the first of the next can be 1 day instead of 3. Not worth fixing.
- **The Cloudflare path does not cache `public/gallery`.** Cloudflare Pages build caching covers
  `node_modules`, not arbitrary directories, so a deploy-hook rebuild re-downloads every image from
  the Facebook CDN. It also does not push the manifest back to git. This is why the GitHub path is
  kept rather than deleted.

## Secrets and variables

Nothing below is committed. Three separate stores, and `FB_ACCESS_TOKEN` has to be updated in **two**
of them when it is rotated.

### 1. GitHub repository secrets

Repository -> Settings -> Secrets and variables -> Actions -> Repository secrets.

| Name                    | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| `FB_PAGE_ID`            | Numeric Facebook Page ID                                              |
| `FB_ACCESS_TOKEN`       | Never-expiring Page Access Token (see README, "Facebook API Setup")   |
| `CLOUDFLARE_API_TOKEN`  | API token with the **Cloudflare Pages: Edit** permission              |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (Workers & Pages sidebar, or `wrangler whoami`) |

`GITHUB_TOKEN` is injected automatically and must **not** be added. The workflow grants it
`contents: write` (manifest commit), `deployments: write` (Pages deployment status) and
`issues: write` (failure canary).

### 2. Cloudflare Pages project environment variables

Used by builds triggered by a git push **and** by the deploy hook. Without them, deploy-hook
rebuilds succeed but publish the placeholder gallery.

Cloudflare dashboard -> Workers & Pages -> `faithfullycrafted` -> Settings -> Variables and
Secrets (older UI: "Environment variables") -> Production:

| Name              | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| `FB_PAGE_ID`      | same as above                                           |
| `FB_ACCESS_TOKEN` | same as above (mark as **Secret**, not plain text)      |
| `NODE_VERSION`    | `22` — pin it; `sharp` is sensitive to the Node version |

### 3. Cloudflare Worker secret

Bound to the `faithfullycrafted-rebuild-cron` Worker only.

| Name                | Value                                        |
| ------------------- | -------------------------------------------- |
| `PAGES_DEPLOY_HOOK` | The Pages Deploy Hook URL created just below |

## Creating the Pages Deploy Hook

A deploy hook is an unauthenticated URL: anyone who has it can trigger a production build. Treat it
like a password. It only works on a Pages project connected to a git repository — Direct Upload
projects do not support deploy hooks.

1. Go to <https://dash.cloudflare.com> and select your account.
2. Open **Workers & Pages** in the sidebar, then click the **`faithfullycrafted`** Pages project.
3. Open the **Settings** tab.
4. Find the **Builds** section (labelled "Builds & deployments" in older versions of the dashboard).
5. Scroll to **Deploy hooks** and click **Add deploy hook**.
6. Fill in:
   - **Deploy hook name**: `scheduled-gallery-rebuild`
   - **Branch to build**: `main`
7. Click **Save**.
8. Copy the generated URL. It looks like
   `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<uuid>`.

There is no public API for creating deploy hooks; step 5 has to be done in the dashboard. If you
ever suspect the URL leaked, delete the hook here, create a new one, and re-run
`wrangler secret put` below.

## Deploying the cron Worker

Requires a Cloudflare login (`npx wrangler login`) or a `CLOUDFLARE_API_TOKEN` with
**Workers Scripts: Edit**. All commands run from the `cron-worker/` directory.

```bash
cd cron-worker

# 1. Create the Worker and register its cron trigger.
npx wrangler deploy

# 2. Store the deploy hook URL. Paste it at the prompt; it is not echoed and is
#    never written to disk or to wrangler.jsonc.
npx wrangler secret put PAGES_DEPLOY_HOOK

# 3. Confirm the secret is bound (prints names only, never values).
npx wrangler secret list
```

Deploy in that order — `wrangler secret put` needs the Worker to exist. The gap is safe: the Worker
throws a descriptive error instead of silently doing nothing if the secret is missing when a cron
fires.

To verify without waiting for the schedule:

```bash
# Fire the scheduled handler locally against the real deploy hook.
npx wrangler dev --test-scheduled
# then, in another terminal:
curl 'http://localhost:8787/__scheduled?cron=0+18+*/3+*+*'
```

That triggers a real production build. Alternatively, just check the Worker's logs after the next
tick: Workers & Pages -> `faithfullycrafted-rebuild-cron` -> Logs. Observability is enabled in
`cron-worker/wrangler.jsonc`, and a non-2xx response from the hook throws, so failed triggers show
up as errored invocations rather than as nothing at all.

The Worker deliberately has **no `fetch` handler** and is deployed with `workers_dev: false`, so
there is no HTTP surface that could leak the hook URL or let anyone trigger arbitrary builds.

## Local commands

```bash
npm run dev              # dev server on http://localhost:4321
npm run fetch-gallery    # refresh public/gallery from Facebook only
npm run build            # fetch-gallery + astro build
npx wrangler pages deploy dist --project-name=faithfullycrafted --branch=main
```

`node scripts/prune-gallery.mjs [--dry-run]` deletes images in `public/gallery` that
`_manifest.json` no longer references. CI runs it after every fetch so that images from deleted
Facebook posts do not survive in the Actions cache and keep shipping in `dist/`.

## Troubleshooting

### The gallery is stale and no workflow has run in weeks

GitHub disabled the cron trigger after 60 days of repository inactivity. The workflow is still in the
repo; it is just switched off, and the `workflow_dispatch` button is disabled with it.

- **Check**: Actions -> "Scheduled Rebuild and Deploy". A disabled scheduled workflow shows a banner
  saying it was disabled because there has been no activity for at least 60 days.
- **Fix**: click **Enable workflow** on that banner. Or, with a token that has the `workflow` scope:
  `gh api -X PUT /repos/<owner>/<repo>/actions/workflows/deploy.yml/enable`
- **Why it should not recur**: the workflow now commits `_manifest.json` whenever the gallery
  changed, and if it did not change and the newest commit is 40+ days old it writes a fresh UTC
  timestamp to `.github/last-rebuild.txt` and commits that instead. Either way the repository sees a
  push at least every 40 days, inside the 60-day window. Both commits carry `[skip ci]`.
- **Note**: this failure mode cannot self-heal, because a disabled workflow cannot run code to
  re-enable itself. That is the whole reason the Cloudflare cron Worker is the primary path — while
  GitHub's schedule is off, the site still rebuilds every 3 days.

### The Facebook token expired or was revoked

Symptoms: the run fails at the "Fetch gallery from Facebook" step with
`[fetch-gallery] Facebook API request failed: 400` (or `190`), and an issue titled
"Scheduled rebuild failed" appears. Deploy-hook builds fail the same way in the Cloudflare build log.

1. Re-issue a Page Access Token following README -> "Facebook API Setup" (steps 1-5). Page tokens
   derived from a long-lived user token do not expire on a timer, but they are invalidated by a
   password change, a revoked app, or a permissions change on the Page.
2. Update it in **both** places:
   - GitHub -> Settings -> Secrets and variables -> Actions -> `FB_ACCESS_TOKEN`
   - Cloudflare -> Pages project -> Settings -> Variables and Secrets -> Production ->
     `FB_ACCESS_TOKEN`
3. Also update your local `.env` if you build locally.
4. Re-run: Actions -> "Scheduled Rebuild and Deploy" -> **Run workflow**.

Missing the Cloudflare copy is the usual mistake — the Actions run goes green while every
deploy-hook rebuild keeps failing.

### Build aborts with "Aborting build"

`scripts/fetch-gallery.mjs` exits non-zero in two cases, both deliberate:

- `Facebook API returned no posts. Aborting build.` — the Graph API responded but with an empty
  `data` array.
- `No images could be downloaded. Aborting build to avoid deploying an empty gallery.` — posts were
  found but every image download failed.

This is a guard, not a bug: it stops a build that would publish a site with no gallery. The live site
stays on the last good deployment because the deploy step never runs.

Check, in order:

1. Is the token valid, and does it still carry `pages_show_list` and `pages_read_engagement`? Paste
   it into the Graph API Explorer and request
   `/<PAGE_ID>/posts?fields=full_picture&limit=5`.
2. Is the Page still published and visible to the app?
3. Do the recent posts actually contain images? Text-only posts have no `full_picture` and are
   filtered out.
4. Transient Facebook CDN failures: just re-run the workflow.

To confirm the site itself is fine, build without credentials: `FB_PAGE_ID= FB_ACCESS_TOKEN= npm run build`
skips the fetch entirely and renders the placeholder gallery. That is exactly what CI does.

### The manifest commit fails to push

The step runs `git pull --rebase --autostash` before pushing, so this only happens on a genuine
conflict in `_manifest.json` — normally because someone pushed a manifest edit by hand while the
workflow was mid-run. The deploy has already succeeded at that point; only the commit-back failed.
Re-run the workflow and it will regenerate and push cleanly.

### The deploy hook returns 404 or 5xx

The Worker throws on any non-2xx, so check Workers & Pages -> `faithfullycrafted-rebuild-cron` ->
Logs for the exact status.

- `404` — the hook was deleted, or the Pages project was recreated. Create a new hook (see above) and
  run `npx wrangler secret put PAGES_DEPLOY_HOOK` again.
- `PAGES_DEPLOY_HOOK secret is not set` — the Worker was deployed but the secret was never stored.
- 5xx — Cloudflare-side. Check <https://www.cloudflarestatus.com>, then trigger a manual rebuild via
  the GitHub Actions "Run workflow" button.

## CI

`.github/workflows/ci.yml` runs on every push and pull request and is intentionally separate from
deployment: `astro check`, `npm run lint`, `prettier --check .`, and `npm run build`, each as its own
step so a failure names itself. It runs with `cancel-in-progress: true`, since a superseded CI run
has no value. No Facebook secrets are exposed to it — the build must pass without them.
