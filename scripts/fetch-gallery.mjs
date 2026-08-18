/**
 * Build-time gallery fetch.
 *
 * Pulls Faith's Facebook Page posts, caches the original image, derives a
 * responsive image set, and writes a manifest that the site reads at build
 * time. The access token is only ever used here — it never reaches the
 * browser, and the Facebook CDN URLs are discarded so no third-party
 * tracking parameters end up in the HTML.
 *
 * What changed from the previous version, and why:
 *
 *  - It emitted a single 1200px JPEG and served it to every viewport, on a
 *    site whose audience is overwhelmingly on phones. Now AVIF and WebP at
 *    480/800/1200 with a JPEG fallback.
 *  - It recorded Facebook's *reported* dimensions, which are frequently
 *    absent, and the templates ignored them anyway, so every image shipped
 *    without width/height and the gallery had a real CLS problem. Dimensions
 *    now come from sharp reading the actual file, and are always present.
 *  - Captions went straight to `alt` text and to the visible card caption.
 *    They are social copy full of emoji and hashtag spam. See lib/caption.mjs.
 *  - There was no category data, so 90 pieces were browsable only by paging
 *    through them eight at a time.
 */
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { deriveTitle, deriveAlt, deriveBody, extractTags, slugify } from './lib/caption.mjs';
import { categorise } from './lib/categories.mjs';

const FB_API_BASE = 'https://graph.facebook.com/v25.0';
const GALLERY_DIR = 'public/gallery';
const MANIFEST_PATH = join(GALLERY_DIR, '_manifest.json');

/** Widths to emit. 480 covers phones at 1x-2x, 1200 covers the lightbox. */
const WIDTHS = [480, 800, 1200];
/** JPEG is the fallback only; one mid width is enough. */
const JPEG_FALLBACK_WIDTH = 800;
/** How many images to process at once. Sharp is CPU-bound; this keeps CI sane. */
const CONCURRENCY = 4;

async function loadEnv() {
  try {
    if (!existsSync('.env')) return;
    const content = await readFile('.env', 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* a missing or unreadable .env is fine; CI supplies real env vars */
  }
}

function stableHash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Fetch every page of posts rather than only the first 100. Faith is at 91
 * images already and posts most days, so the old single-request version was
 * months away from silently truncating the gallery.
 */
async function fetchAllPosts(pageId, accessToken) {
  const fields = 'message,full_picture,created_time,permalink_url';
  let url = `${FB_API_BASE}/${pageId}/posts?fields=${fields}&limit=100&access_token=${encodeURIComponent(accessToken)}`;

  const posts = [];
  const seen = new Set();
  let pages = 0;
  let duplicates = 0;

  /**
   * Deduplicate by post id while paginating.
   *
   * This is not defensive padding — it caught a real bug. Two consecutive
   * runs against the same Page returned 317 and then 634 post objects, an
   * exact doubling, and every id appeared twice in the second result. Cursor
   * pagination over a live feed is not guaranteed to return disjoint pages,
   * so the only safe assumption is that pages can overlap or repeat.
   *
   * Stopping when a page contributes nothing new also makes a looping cursor
   * terminate, which a fixed page cap alone would not do correctly.
   */
  while (url && pages < 40) {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Graph API returned ${response.status}. ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(`Graph API error: ${data.error.message}`);

    const batch = Array.isArray(data.data) ? data.data : [];
    if (batch.length === 0) break;

    let added = 0;
    for (const post of batch) {
      if (!post?.id) continue;
      if (seen.has(post.id)) {
        duplicates++;
        continue;
      }
      seen.add(post.id);
      posts.push(post);
      added++;
    }

    pages++;

    if (added === 0) {
      console.warn(
        `[fetch-gallery] Page ${pages} returned ${batch.length} posts, none new. Stopping pagination.`,
      );
      break;
    }

    url = data.paging?.next || null;
  }

  if (duplicates > 0) {
    console.warn(
      `[fetch-gallery] Graph API returned ${duplicates} duplicate posts across ${pages} pages; deduplicated by id.`,
    );
  }

  return posts;
}

/** Download the original once; subsequent builds reuse it from cache. */
async function ensureOriginal(url, hash) {
  const filename = `${hash}.jpg`;
  const localPath = join(GALLERY_DIR, filename);

  if (existsSync(localPath)) return { filename, localPath, cached: true };

  const response = await fetch(url);
  if (!response.ok) return null;

  const raw = Buffer.from(await response.arrayBuffer());

  try {
    await sharp(raw)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(localPath);
  } catch {
    await writeFile(localPath, raw);
  }

  return { filename, localPath, cached: false };
}

/**
 * Emit AVIF + WebP at every width, plus one JPEG fallback, and a tiny
 * inline placeholder. Skips anything already on disk so a warm cache costs
 * nothing.
 */
async function buildDerivatives(localPath, hash) {
  const image = sharp(localPath, { failOn: 'none' });
  const meta = await image.metadata();

  const intrinsicWidth = meta.width || null;
  const intrinsicHeight = meta.height || null;
  if (!intrinsicWidth || !intrinsicHeight) {
    throw new Error(`could not read dimensions from ${localPath}`);
  }

  const emitted = { avif: [], webp: [], jpg: [] };

  /**
   * Never upscale — a srcset must not advertise detail the original does not
   * have. But do not simply drop the larger steps either: Facebook serves a
   * lot of 720x720 images, and skipping every step above 720 left them with a
   * single 480px variant, so a desktop viewport downloaded a 480px file and
   * rendered it soft.
   *
   * So: take every step at or below the original, and if the original sits
   * between two steps, add one variant at its native width.
   */
  const targetWidths = WIDTHS.filter((w) => w <= intrinsicWidth);
  const largestStep = targetWidths[targetWidths.length - 1];
  if (!largestStep) {
    targetWidths.push(intrinsicWidth);
  } else if (intrinsicWidth > largestStep && largestStep !== WIDTHS[WIDTHS.length - 1]) {
    targetWidths.push(intrinsicWidth);
  }

  for (const width of targetWidths) {
    const targetWidth = Math.min(width, intrinsicWidth);

    const avifPath = join(GALLERY_DIR, `${hash}-${width}.avif`);
    if (!existsSync(avifPath)) {
      await sharp(localPath)
        .resize({ width: targetWidth, withoutEnlargement: true })
        .avif({ quality: 52, effort: 4 })
        .toFile(avifPath);
    }
    emitted.avif.push(width);

    const webpPath = join(GALLERY_DIR, `${hash}-${width}.webp`);
    if (!existsSync(webpPath)) {
      await sharp(localPath)
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: 74 })
        .toFile(webpPath);
    }
    emitted.webp.push(width);
  }

  const jpegWidth = Math.min(JPEG_FALLBACK_WIDTH, intrinsicWidth);
  const jpegPath = join(GALLERY_DIR, `${hash}-${JPEG_FALLBACK_WIDTH}.jpg`);
  if (!existsSync(jpegPath)) {
    await sharp(localPath)
      .resize({ width: jpegWidth, withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toFile(jpegPath);
  }
  emitted.jpg.push(JPEG_FALLBACK_WIDTH);

  // Low-quality image placeholder, inlined into the HTML so the shimmer has
  // the piece's real colours behind it instead of a grey box.
  const lqipBuffer = await sharp(localPath).resize({ width: 20 }).webp({ quality: 30 }).toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuffer.toString('base64')}`;

  return { intrinsicWidth, intrinsicHeight, emitted, lqip };
}

/** Run an async mapper over items with a bounded number in flight. */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  await loadEnv();

  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.log(
      '[fetch-gallery] No FB credentials set. Leaving the existing manifest alone; the site will use it, or fall back to the empty state.',
    );
    return;
  }

  console.log('[fetch-gallery] Fetching posts from Facebook...');

  let posts;
  try {
    posts = await fetchAllPosts(pageId, accessToken);
  } catch (err) {
    console.error(`[fetch-gallery] ${err.message}`);
    process.exit(1);
  }

  const withImages = posts.filter((p) => p.full_picture);
  console.log(`[fetch-gallery] ${posts.length} posts, ${withImages.length} with images.`);

  if (withImages.length === 0) {
    console.error(
      '[fetch-gallery] No posts with images. Aborting rather than publishing an empty gallery.',
    );
    process.exit(1);
  }

  await mkdir(GALLERY_DIR, { recursive: true });

  let downloaded = 0;
  let cached = 0;
  let failed = 0;

  const entries = await mapLimit(withImages, CONCURRENCY, async (post) => {
    const hash = stableHash(post.id);

    let original;
    try {
      original = await ensureOriginal(post.full_picture, hash);
    } catch (err) {
      console.warn(`[fetch-gallery] download failed for ${post.id}: ${err.message}`);
      failed++;
      return null;
    }
    if (!original) {
      failed++;
      return null;
    }

    if (original.cached) {
      cached++;
    } else {
      downloaded++;
    }

    let derived;
    try {
      derived = await buildDerivatives(original.localPath, hash);
    } catch (err) {
      console.warn(`[fetch-gallery] image processing failed for ${post.id}: ${err.message}`);
      failed++;
      return null;
    }

    const caption = post.message || '';
    const tags = extractTags(caption);
    const { category, categoryLabel } = categorise(caption, tags);
    const title = deriveTitle(caption);

    return {
      id: post.id,
      hash,
      filename: original.filename,
      title,
      alt: deriveAlt(title, categoryLabel),
      body: deriveBody(caption),
      date: post.created_time,
      permalink: post.permalink_url,
      width: derived.intrinsicWidth,
      height: derived.intrinsicHeight,
      category,
      tags,
      lqip: derived.lqip,
      variants: derived.emitted,
    };
  });

  const manifest = entries.filter(Boolean);

  // Slugs are derived from the title, so two similar captions can collide.
  // Extend the hash suffix until unique, keeping slugs stable across builds
  // for any post whose caption has not changed.
  const used = new Set();
  for (const entry of manifest) {
    const base = slugify(entry.title) || 'piece';
    let suffixLength = 6;
    let slug = `${base}-${entry.hash.slice(0, suffixLength)}`;
    while (used.has(slug) && suffixLength < entry.hash.length) {
      suffixLength += 2;
      slug = `${base}-${entry.hash.slice(0, suffixLength)}`;
    }
    used.add(slug);
    entry.slug = slug;
  }

  if (manifest.length === 0) {
    console.error(
      '[fetch-gallery] Every image failed to process. Aborting rather than publishing an empty gallery.',
    );
    process.exit(1);
  }

  // Belt and braces on top of the dedupe in fetchAllPosts: a duplicated piece
  // would ship as two gallery cards and two indexable pages for one photo,
  // which is worse than a failed build.
  const uniqueIds = new Set(manifest.map((entry) => entry.id));
  if (uniqueIds.size !== manifest.length) {
    console.error(
      `[fetch-gallery] ${manifest.length - uniqueIds.size} duplicate entries survived deduplication. Aborting.`,
    );
    process.exit(1);
  }

  // Newest first.
  manifest.sort((a, b) => new Date(b.date) - new Date(a.date));

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  const files = await readdir(GALLERY_DIR);
  const byCategory = manifest.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {});

  console.log(
    `[fetch-gallery] Done. ${downloaded} downloaded, ${cached} cached, ${failed} failed.`,
  );
  console.log(
    `[fetch-gallery] ${manifest.length} pieces, ${files.length} files in ${GALLERY_DIR}.`,
  );
  console.log(
    `[fetch-gallery] Categories: ${Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
}

main().catch((err) => {
  console.error('[fetch-gallery] Fatal:', err.message);
  process.exit(1);
});
