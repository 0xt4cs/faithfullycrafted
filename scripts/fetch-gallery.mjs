import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const FB_API_BASE = 'https://graph.facebook.com/v25.0';
const GALLERY_DIR = 'public/gallery';
const MANIFEST_PATH = join(GALLERY_DIR, '_manifest.json');

// Load .env for local dev (CI has env vars natively)
async function loadEnv() {
  try {
    if (existsSync('.env')) {
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
    }
  } catch {
    /* ignore */
  }
}

function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

async function downloadImage(url) {
  const hash = hashUrl(url);
  const filename = `${hash}.jpg`;
  const localPath = join(GALLERY_DIR, filename);

  if (existsSync(localPath)) return filename;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const rawBuffer = Buffer.from(await response.arrayBuffer());

    try {
      await sharp(rawBuffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 75, progressive: true })
        .toFile(localPath);
    } catch {
      await writeFile(localPath, rawBuffer);
    }

    return filename;
  } catch {
    return null;
  }
}

async function main() {
  await loadEnv();

  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.log('[fetch-gallery] No FB credentials set, skipping image download.');
    return;
  }

  console.log('[fetch-gallery] Fetching posts from Facebook...');

  const fields =
    'message,full_picture,created_time,permalink_url,attachments{media,subattachments}';
  const url = `${FB_API_BASE}/${pageId}/posts?fields=${fields}&limit=100&access_token=${accessToken}`;

  let posts;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('[fetch-gallery] Facebook API request failed:', response.status);
      return;
    }
    const data = await response.json();
    posts = data.data || [];
  } catch (err) {
    console.error('[fetch-gallery] Failed to fetch:', err.message);
    return;
  }

  const postsWithImages = posts.filter((p) => p.full_picture);
  console.log(`[fetch-gallery] Found ${postsWithImages.length} posts with images.`);

  await mkdir(GALLERY_DIR, { recursive: true });

  const manifest = [];
  let downloaded = 0;
  let cached = 0;

  for (const post of postsWithImages) {
    const filename = await downloadImage(post.full_picture);
    if (!filename) continue;

    const existed = existsSync(join(GALLERY_DIR, filename));
    if (existed) cached++;
    else downloaded++;

    const attachment = post.attachments?.data?.[0];
    const media = attachment?.media?.image;

    manifest.push({
      id: post.id,
      filename,
      caption: (post.message || '').slice(0, 200),
      date: post.created_time,
      permalink: post.permalink_url,
      width: media?.width || null,
      height: media?.height || null,
    });
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(
    `[fetch-gallery] Done. ${downloaded} downloaded, ${cached} cached. ${manifest.length} total images.`,
  );
}

main().catch((err) => {
  console.error('[fetch-gallery] Fatal error:', err.message);
  process.exit(1);
});
