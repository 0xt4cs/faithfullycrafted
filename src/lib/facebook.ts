import type { GalleryItem } from '@typedefs/index';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GALLERY_DIR = 'public/gallery';
const MANIFEST_PATH = join(GALLERY_DIR, '_manifest.json');

interface ManifestEntry {
  id: string;
  filename: string;
  caption: string;
  date: string;
  permalink: string;
  width: number | null;
  height: number | null;
}

function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function readManifest(): ManifestEntry[] {
  try {
    if (!existsSync(MANIFEST_PATH)) return [];
    const raw = readFileSync(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw) as ManifestEntry[];
  } catch {
    return [];
  }
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
  const manifest = readManifest();

  if (manifest.length === 0) {
    console.warn(
      'No gallery manifest found — using placeholder gallery. Run "node scripts/fetch-gallery.mjs" first.',
    );
    return getFallbackGallery();
  }

  // Validate that the actual image files exist on disk.
  // Protects against stale manifest pointing to missing JPGs after a failed FB fetch.
  const validEntries = manifest.filter((entry) =>
    existsSync(join(GALLERY_DIR, entry.filename)),
  );

  if (validEntries.length === 0) {
    console.warn(
      `Manifest has ${manifest.length} entries but none of the referenced JPGs exist on disk — falling back to placeholder gallery.`,
    );
    return getFallbackGallery();
  }

  if (validEntries.length < manifest.length) {
    console.warn(
      `Skipping ${manifest.length - validEntries.length} manifest entries with missing JPG files.`,
    );
  }

  return validEntries.map((entry) => ({
    id: entry.id,
    imageUrl: `/gallery/${entry.filename}`,
    caption: sanitizeText(entry.caption),
    date: new Date(entry.date).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    permalink: entry.permalink,
    width: entry.width ?? undefined,
    height: entry.height ?? undefined,
  }));
}
