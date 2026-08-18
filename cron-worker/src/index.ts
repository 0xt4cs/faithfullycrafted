/**
 * faithfullycrafted-rebuild-cron
 *
 * Primary rebuild schedule for faithfullycrafted.pages.dev.
 *
 * Cloudflare Pages does not have a built-in "rebuild on a schedule" feature and
 * GitHub silently disables cron-triggered Actions workflows after 60 days of
 * repository inactivity. This Worker owns the schedule instead: on each tick it
 * POSTs to a Pages Deploy Hook, which starts a normal production build of the
 * connected Git branch. That build runs scripts/fetch-gallery.mjs and picks up
 * any new Facebook posts.
 *
 * Deliberately has no `fetch` handler: the deploy hook URL is a bearer-style
 * secret, so there must be no HTTP surface that could leak it or let anyone
 * trigger builds. Deploy with `workers_dev: false` (see wrangler.jsonc).
 *
 * No npm dependencies. Types for the two values the runtime passes in are
 * declared locally so this compiles without @cloudflare/workers-types.
 */

interface Env {
  /**
   * Cloudflare Pages Deploy Hook URL, e.g.
   * https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<uuid>
   *
   * Set with: npx wrangler secret put PAGES_DEPLOY_HOOK
   * Never commit this value.
   */
  PAGES_DEPLOY_HOOK: string;
}

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const hook = env.PAGES_DEPLOY_HOOK;

    if (!hook) {
      throw new Error(
        'PAGES_DEPLOY_HOOK secret is not set. Run: npx wrangler secret put PAGES_DEPLOY_HOOK',
      );
    }

    const firedAt = new Date(controller.scheduledTime).toISOString();
    console.log(`Cron ${controller.cron} fired at ${firedAt}; triggering Pages rebuild.`);

    const response = await fetch(hook, { method: 'POST' });

    if (!response.ok) {
      // Read the body for context, then throw so the failure is recorded as an
      // errored invocation in Workers observability rather than a silent no-op.
      const detail = await response.text().catch(() => '<unreadable body>');
      throw new Error(
        `Pages Deploy Hook returned ${response.status} ${response.statusText}: ${detail.slice(0, 500)}`,
      );
    }

    console.log(`Pages Deploy Hook accepted the rebuild request (HTTP ${response.status}).`);
  },
};
