/**
 * Delete gallery images that are no longer referenced by _manifest.json.
 *
 * CI restores public/gallery from a persistent cache so unchanged images are
 * not re-downloaded. Without pruning, images from deleted Facebook posts would
 * survive in that cache forever and keep shipping in dist/.
 *
 * Only files matching the fetch-gallery.mjs naming scheme are ever removed, so
 * hand-placed assets in public/gallery are safe. That scheme is:
 *
 *   <16 hex>.jpg              the cached original
 *   <16 hex>-<width>.avif     responsive derivative
 *   <16 hex>-<width>.webp     responsive derivative
 *   <16 hex>-<width>.jpg      JPEG fallback
 *
 * Matching is by hash rather than by exact filename: a manifest entry names
 * only its original, so keying off `entry.filename` alone would treat every
 * derivative as unrecognised and leave orphans in the cache indefinitely.
 *
 * Usage: node scripts/prune-gallery.mjs [--dry-run]
 */
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GALLERY_DIR = 'public/gallery';
const MANIFEST_PATH = join(GALLERY_DIR, '_manifest.json');
const GENERATED_NAME = /^([0-9a-f]{16})(?:-\d+)?\.(?:jpg|png|webp|avif)$/;

const dryRun = process.argv.includes('--dry-run');

if (!existsSync(MANIFEST_PATH)) {
  console.log('[prune-gallery] No manifest found, nothing to prune.');
  process.exit(0);
}

let referenced;
try {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  // Key on the hash so a piece's original and all of its derivatives are
  // recognised together.
  referenced = new Set(
    manifest.map((entry) => entry.hash).filter((hash) => typeof hash === 'string' && hash),
  );
} catch (err) {
  console.error('[prune-gallery] Could not read manifest:', err.message);
  process.exit(1);
}

if (referenced.size === 0) {
  console.error('[prune-gallery] Manifest is empty; refusing to prune.');
  process.exit(1);
}

let removed = 0;
let kept = 0;

for (const name of readdirSync(GALLERY_DIR)) {
  const match = GENERATED_NAME.exec(name);
  if (!match) continue;
  if (referenced.has(match[1])) {
    kept++;
    continue;
  }
  if (!dryRun) unlinkSync(join(GALLERY_DIR, name));
  removed++;
  console.log(`[prune-gallery] ${dryRun ? 'would remove' : 'removed'} ${name}`);
}

console.log(`[prune-gallery] Done. ${kept} kept, ${removed} orphaned file(s).`);
