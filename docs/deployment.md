# Deployment

The site is a static Astro build deployed to **Cloudflare Pages** as a **Direct Upload**
project: Cloudflare does not build from Git. Every deploy is produced by GitHub Actions,
which builds the site and uploads it with `wrangler pages deploy`.

That single fact drives every decision below, so it is worth stating plainly:

- **A `git push` does not deploy anything.** Cloudflare is not watching the repository.
- **Pages Deploy Hooks do not exist for this project.** They are a Git-integration feature.
- **The Facebook credentials only need to live in GitHub Actions secrets**, because the
  Actions runner is the only thing that ever builds the site.

Canonical origin: **https://faithfullycrafted.pages.dev**. There is no custom domain.

## The two paths

| Path                               | Trigger                                        | Runs on            | Role                                                       |
| ---------------------------------- | ---------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| **`.github/workflows/deploy.yml`** | cron `0 0 */3 * *` UTC, or `workflow_dispatch` | GitHub Actions     | **The only thing that builds and deploys.**                |
| **`cron-worker/`** (optional)      | cron `0 18 */3 * *` UTC (02:00 Asia/Manila)    | Cloudflare Workers | Backup trigger. Enables and dispatches the workflow above. |

`.github/workflows/ci.yml` is a quality gate only — it never deploys.

### Why there is a backup trigger at all

GitHub **silently disables cron-triggered workflows after 60 days of repository
inactivity**, and that is not hypothetical here: the scheduled rebuild stopped in April
2026 and the live gallery sat 111 days stale, showing 90 of Faith's 291 pieces, until the
workflow was re-enabled by hand.

A workflow cannot recover from that state on its own. Being disabled also disables
`workflow_dispatch`, so there is no way for it to run code that re-enables itself. Only
something outside GitHub can do it.

So `cron-worker/` calls the GitHub API to **enable** the workflow (idempotent, and the
step that actually performs the recovery) and then **dispatch** it. It deliberately does
not try to make Cloudflare build anything, because a Cloudflare-side build would have no
Facebook credentials and could not run `wrangler pages deploy` on its own.

### Do you need the Worker?

Not strictly. `deploy.yml` already contains a keepalive: when the newest commit is 40+
days old it refreshes `.github/last-rebuild.txt`, which is real repository activity and
keeps the 60-day clock from ever expiring. As long as the schedule keeps firing, it
sustains itself.

The Worker covers the one case the keepalive cannot: the schedule being **already**
disabled. If that happens without it, the fix is manual — see Troubleshooting.

## Secrets and variables

### 1. GitHub repository secrets

Settings → Secrets and variables → Actions.

| Secret                  | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `FB_PAGE_ID`            | Facebook Page id the gallery is pulled from     |
| `FB_ACCESS_TOKEN`       | Long-lived Page access token, build-time only   |
| `CLOUDFLARE_API_TOKEN`  | Needs the **Cloudflare Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Target account for the Pages project            |

`GITHUB_TOKEN` is provided automatically. `deploy.yml` grants it `contents: write` (to
commit the refreshed manifest), `deployments: write`, and `issues: write` (for the failure
canary).

### 2. Cloudflare Pages project

**Nothing is required here.** This is a Direct Upload project, so Cloudflare never runs a
build and never needs `FB_*`. If you ever convert the project to a Git integration, the
Facebook variables must be added on the Pages side too — Cloudflare cannot read GitHub
secrets, and a credential-less build would publish an empty gallery.

### 3. Cloudflare Worker secret (only if using the backup trigger)

| Secret         | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN` | A **fine-grained** PAT scoped to this repository only, with **Actions: read and write** |

Nothing else needs to be granted. Create it at
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.

The owner, repo, workflow filename and branch are plain `vars` in
`cron-worker/wrangler.jsonc` — they are not secret.

## Deploying the cron Worker

```bash
cd cron-worker

# 1. Create the Worker and register its cron trigger.
npx wrangler deploy

# 2. Store the PAT. Paste it at the prompt; it is not echoed, and it is never
#    written to disk or into wrangler.jsonc.
npx wrangler secret put GITHUB_TOKEN

# 3. Confirm the binding exists (prints names only, never values).
npx wrangler secret list
```

Deploying the Worker needs a Cloudflare API token with **Workers Scripts: Edit**.

### Testing it

```bash
# Type-check and bundle without deploying.
npx wrangler deploy --dry-run --outdir=/tmp/cron-build

# Fire the scheduled handler for real. This WILL start a production deploy.
npx wrangler dev --test-scheduled
# then, in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+18+*/3+*+*"
```

## Manual deploys

The everyday way to publish is the Actions tab:

**Actions → Scheduled Rebuild and Deploy → Run workflow.**

That fetches the gallery, prunes orphaned images, builds, and uploads. Use it after
merging anything, since pushing to `main` does **not** deploy on its own.

## Local commands

```bash
npm run verify        # check + lint + format + build + unit tests + e2e
npm run build         # fetch gallery, then build
npm run build:only    # build from the existing manifest, no Facebook call
npm run fetch-gallery # refresh images and _manifest.json
npm run prune-gallery # delete images no longer in the manifest (--dry-run supported)
```

## Troubleshooting

### The gallery is stale and no workflow has run in weeks

Almost certainly the 60-day inactivity disable. Check the Actions tab: a disabled
scheduled workflow shows a banner saying so, with an **Enable workflow** button.

Pushing commits does **not** re-enable it. Either click the button, or:

```bash
gh api -X PUT repos/0xt4cs/faithfullycrafted/actions/workflows/deploy.yml/enable
```

Then run the workflow manually to publish immediately. Deploying `cron-worker/` prevents
a recurrence.

### The site did not change after a merge

Expected. Cloudflare is not connected to Git, so nothing deploys on push. Run the deploy
workflow.

### The Facebook token expired or was revoked

`scripts/fetch-gallery.mjs` exits non-zero and the canary opens a `Scheduled rebuild
failed` issue. Reissue a long-lived Page token and update the `FB_ACCESS_TOKEN` secret.
To verify a token without deploying:

```bash
curl "https://graph.facebook.com/v25.0/<PAGE_ID>/posts?fields=id&limit=1&access_token=<TOKEN>"
```

A valid token returns a `data` array; a dead one returns an `error` object naming the
reason.

### Build aborts with "Aborting build"

Deliberate. `fetch-gallery.mjs` refuses to continue when the API returns no posts with
images, when every image fails to process, or when duplicate entries survive
deduplication. Publishing an empty or duplicated gallery is worse than not publishing.

Note that the Graph API's cursor is not guaranteed to return disjoint pages — one
observed run returned each post twice — so the script deduplicates by post id and stops
paginating when a page contributes nothing new.

### The manifest commit fails to push

The workflow commits `public/gallery/_manifest.json` back when it changes. If someone
pushed in the meantime, the step rebases with `--autostash` and retries. A persistent
failure usually means a branch protection rule now blocks the `GITHUB_TOKEN` push.

### The Worker throws "Could not enable deploy.yml"

The PAT is missing, expired, or lacks **Actions: write** on this repository. Fine-grained
tokens are also per-repository — a token scoped to a different repo returns 404 rather
than 403, which reads confusingly.

## CI

`ci.yml` runs on every push and pull request: `astro check`, `eslint`, `prettier --check`,
a build, the unit gates, and the axe-core accessibility and standards suites. It builds
without Facebook credentials on purpose, which proves the site builds without that
dependency; the suites resolve their targets at run time and skip gallery-dependent specs
with a stated reason rather than failing.
