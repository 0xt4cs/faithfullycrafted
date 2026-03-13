import type { FacebookPost, GalleryItem } from '@typedefs/index';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const FB_API_BASE = 'https://graph.facebook.com/v25.0';
const GALLERY_DIR = 'public/gallery';

interface FetchOptions {
  pageId: string;
  accessToken: string;
  limit?: number;
}

function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

async function downloadImage(url: string): Promise<string | null> {
  try {
    const hash = hashUrl(url);
    const filename = `${hash}.jpg`;
    const localPath = join(GALLERY_DIR, filename);

    if (existsSync(localPath)) {
      return `/gallery/${filename}`;
    }

    const response = await fetch(url);
    if (!response.ok) return null;

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    await mkdir(GALLERY_DIR, { recursive: true });

    await sharp(rawBuffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true })
      .toFile(localPath);

    return `/gallery/${filename}`;
  } catch {
    return null;
  }
}

export async function fetchPagePosts({
  pageId,
  accessToken,
  limit = 100,
}: FetchOptions): Promise<GalleryItem[]> {
  const fields = 'message,full_picture,created_time,permalink_url,attachments{media,subattachments}';
  const url = `${FB_API_BASE}/${pageId}/posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Facebook API request failed');
      return getFallbackGallery();
    }

    const data = (await response.json()) as { data: FacebookPost[] };
    return transformPosts(data.data);
  } catch {
    console.error('Facebook API request failed');
    return getFallbackGallery();
  }
}

async function transformPosts(posts: FacebookPost[]): Promise<GalleryItem[]> {
  const postsWithImages = posts.filter((post) => post.full_picture);

  const items = await Promise.all(
    postsWithImages.map(async (post) => {
      const attachment = post.attachments?.data?.[0];
      const media = attachment?.media?.image;

      const localImageUrl = await downloadImage(post.full_picture!);

      return {
        id: post.id,
        imageUrl: localImageUrl || post.full_picture!,
        caption: sanitizeText(post.message?.slice(0, 200) ?? ''),
        date: new Date(post.created_time).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        permalink: post.permalink_url,
        width: media?.width,
        height: media?.height,
      };
    }),
  );

  return items;
}

function getFallbackGallery(): GalleryItem[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `placeholder-${i + 1}`,
    imageUrl: `https://placehold.co/600x${400 + (i % 3) * 100}/FDE8EE/E8669A?text=Crochet+${i + 1}`,
    caption: 'Beautiful handmade crochet creation by Faithfully Crafted',
    date: 'Coming soon',
    permalink: 'https://www.facebook.com/gingerchets/',
  }));
}

export async function getGalleryItems(): Promise<GalleryItem[]> {
  const pageId = import.meta.env.FB_PAGE_ID;
  const accessToken = import.meta.env.FB_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.warn('FB_PAGE_ID or FB_ACCESS_TOKEN not set — using placeholder gallery');
    return getFallbackGallery();
  }

  return fetchPagePosts({ pageId, accessToken });
}
