/**
 * faithfullycrafted-rebuild-cron
 *
 * Backup scheduler for the gallery rebuild.
 *
 * Why this exists at all: GitHub silently disables cron-triggered Actions
 * workflows after 60 days of repository inactivity, and that is exactly what
 * happened here -- the scheduled rebuild stopped in April and the live gallery
 * sat 111 days stale. A workflow cannot dig itself out of that state, because
 * being disabled also disables `workflow_dispatch`. Only something outside
 * GitHub can re-enable it.
 *
 * Why it triggers the Action rather than Cloudflare: this Pages project is
 * Direct Upload, not Git-connected. Two consequences follow, and both rule out
 * the more obvious design of POSTing to a Pages Deploy Hook:
 *
 *   1. Deploy Hooks are a Git-integration feature. Direct Upload projects do
 *      not have them.
 *   2. Even on a Git-connected project, a Cloudflare-side build would need
 *      FB_PAGE_ID and FB_ACCESS_TOKEN in the Pages environment. The Facebook
 *      credentials live in GitHub Actions secrets, and the Action is what runs
 *      `wrangler pages deploy`.
 *
 * So the only build that can actually produce a correct deploy is the GitHub
 * Actions one. This Worker's job is to make sure that workflow is enabled and
 * then start it.
 *
 * No npm dependencies; the handful of runtime types are declared locally so it
 * compiles without @cloudflare/workers-types.
 */

interface Env {
  /**
   * Fine-grained GitHub personal access token, scoped to this repository only,
   * with Actions: read and write. Nothing else is needed.
   *
   * Set with: npx wrangler secret put GITHUB_TOKEN
   * Never commit this value.
   */
  GITHUB_TOKEN: string;

  /** e.g. "0xt4cs" — plain var, set in wrangler.jsonc. */
  GITHUB_OWNER: string;
  /** e.g. "faithfullycrafted" — plain var. */
  GITHUB_REPO: string;
  /** Workflow filename, e.g. "deploy.yml" — plain var. */
  GITHUB_WORKFLOW: string;
  /** Branch to build, e.g. "main" — plain var. */
  GITHUB_REF: string;
}

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

const API = 'https://api.github.com';

function headers(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API requests without a User-Agent.
    'User-Agent': 'faithfullycrafted-rebuild-cron',
    'Content-Type': 'application/json',
  };
}

async function describe(response: Response): Promise<string> {
  const body = await response.text().catch(() => '<unreadable body>');
  return `${response.status} ${response.statusText}: ${body.slice(0, 400)}`;
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const token = env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN secret is not set. Run: npx wrangler secret put GITHUB_TOKEN');
    }

    const owner = env.GITHUB_OWNER;
    const repo = env.GITHUB_REPO;
    const workflow = env.GITHUB_WORKFLOW || 'deploy.yml';
    const ref = env.GITHUB_REF || 'main';

    if (!owner || !repo) {
      throw new Error('GITHUB_OWNER and GITHUB_REPO must be set in wrangler.jsonc vars.');
    }

    const base = `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}`;
    const firedAt = new Date(controller.scheduledTime).toISOString();
    console.log(`Cron ${controller.cron} fired at ${firedAt}; ensuring ${workflow} is enabled.`);

    /*
     * Enable first, unconditionally. It is idempotent on an already-enabled
     * workflow, and it is the step that recovers from the 60-day inactivity
     * disable -- which is the entire reason this Worker exists. Skipping it
     * when the workflow looks fine would mean the one situation we are guarding
     * against is the one situation we do not handle.
     */
    const enable = await fetch(`${base}/enable`, { method: 'PUT', headers: headers(token) });
    if (!enable.ok) {
      throw new Error(`Could not enable ${workflow}: ${await describe(enable)}`);
    }
    console.log(`${workflow} is enabled (HTTP ${enable.status}).`);

    const dispatch = await fetch(`${base}/dispatches`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ ref }),
    });

    if (!dispatch.ok) {
      // Throw so the failure lands as an errored invocation in Workers
      // observability rather than passing silently.
      throw new Error(`Could not dispatch ${workflow} on ${ref}: ${await describe(dispatch)}`);
    }

    console.log(`Dispatched ${workflow} on ${ref} (HTTP ${dispatch.status}).`);
  },
};
