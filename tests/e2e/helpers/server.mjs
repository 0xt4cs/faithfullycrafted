/**
 * Starts `astro preview` against the existing `dist/` build and tears it down.
 *
 * Deliberately previews the real production output rather than running the dev
 * server: the things these tests guard — emitted meta tags, compiled CSS,
 * bundled scripts, image derivatives — only exist after a build. A dev-server
 * pass would be testing something the visitor never receives.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Not 4321, so a preview server left running by hand does not collide. */
export const PORT = 4329;
export const BASE = `http://127.0.0.1:${PORT}`;

async function reachable() {
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startServer() {
  if (!existsSync('dist/index.html')) {
    throw new Error('dist/ is missing or incomplete. Run `npm run build` first.');
  }

  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['astro', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await reachable()) return child;
    await new Promise((r) => setTimeout(r, 400));
  }

  child.kill();
  throw new Error(`preview server did not come up on ${BASE} within 45s`);
}

export async function stopServer(child) {
  if (!child) return;
  child.kill();
  // Give the port a moment to free up so a following suite can bind it.
  await new Promise((r) => setTimeout(r, 300));
}

/** Routes that exist regardless of whether the gallery has content. */
const STATIC_PAGES = [
  { name: 'home', path: '/' },
  { name: 'gallery', path: '/gallery/' },
  { name: 'order', path: '/order/' },
  { name: 'about', path: '/about/' },
  { name: 'contact', path: '/contact/' },
  { name: 'privacy', path: '/privacy/' },
  { name: 'terms', path: '/terms/' },
  { name: '404', path: '/404.html' },
];

/**
 * Resolve the pages to assert against at run time rather than hardcoding a
 * slug.
 *
 * This matters because the gallery is only populated when Facebook credentials
 * were available at build time. CI deliberately builds without them, so there
 * are no piece pages there at all — a hardcoded `/piece/<slug>/` would 404 and
 * fail for a reason that has nothing to do with the code under test. Reading a
 * real slug out of the sitemap keeps one suite honest in both environments.
 *
 * One representative of the piece template is enough: all 291 come from the
 * same component, so a second proves nothing the first did not.
 */
export async function resolvePages() {
  const pages = [...STATIC_PAGES];
  const piece = await firstPieceUrl();
  if (piece) pages.push({ name: 'piece', path: piece });
  return pages;
}

async function firstPieceUrl() {
  try {
    const res = await fetch(`${BASE}/sitemap-0.xml`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const match = xml.match(/<loc>[^<]*(\/piece\/[^<]+?)<\/loc>/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** How many pieces the built gallery actually contains. */
export async function galleryItemCount() {
  try {
    const res = await fetch(`${BASE}/gallery/`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 0;
    const html = await res.text();
    return (html.match(/class="gallery-item"/g) || []).length;
  } catch {
    return 0;
  }
}

export { STATIC_PAGES };
