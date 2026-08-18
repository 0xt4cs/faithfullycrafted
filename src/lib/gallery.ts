/**
 * Gallery data access.
 *
 * Reads the manifest written by `scripts/fetch-gallery.mjs` at build time.
 * Nothing here talks to Facebook — the network call happens in the pre-build
 * script so the token never enters the Astro build and no request is made per
 * page render.
 *
 * Note on escaping: the previous version ran captions through an HTML-entity
 * escaper before handing them to the templates. Astro already escapes
 * interpolated values, so every caption containing `&`, `"` or `'` was
 * double-escaped and rendered as literal `&amp;` on the page. Five of the 90
 * captions were affected. Escaping is now left entirely to Astro, which is
 * the only layer that knows the output context.
 */
import type { CategoryFacet, GalleryItem, ManifestEntry } from '@typedefs/index';
import { CATEGORY_META, FALLBACK_CATEGORY } from '@lib/constants';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GALLERY_DIR = 'public/gallery';
const MANIFEST_PATH = join(GALLERY_DIR, '_manifest.json');

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

function readManifest(): ManifestEntry[] {
  try {
    if (!existsSync(MANIFEST_PATH)) return [];
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as ManifestEntry[]) : [];
  } catch (err) {
    console.warn(
      `[gallery] Could not parse ${MANIFEST_PATH}: ${(err as Error).message}. Falling back to the empty state.`,
    );
    return [];
  }
}

function categoryLabelFor(id: string): string {
  return CATEGORY_META[id]?.label ?? FALLBACK_CATEGORY.label;
}

function toGalleryItem(entry: ManifestEntry): GalleryItem {
  const parsedDate = new Date(entry.date);
  const dateLabel = Number.isNaN(parsedDate.getTime()) ? '' : dateFormatter.format(parsedDate);

  return {
    ...entry,
    categoryLabel: categoryLabelFor(entry.category),
    dateLabel,
    src: `/gallery/${entry.hash}-800.jpg`,
    href: `/piece/${entry.slug}/`,
  };
}

/**
 * Every piece, newest first.
 *
 * Entries whose image files are missing from disk are dropped rather than
 * rendered as broken images — this guards against a manifest that survived a
 * failed image fetch, which is exactly what a warm CI cache can produce.
 */
let cache: GalleryItem[] | null = null;

export function getGalleryItems(): GalleryItem[] {
  if (cache) return cache;

  const manifest = readManifest();

  if (manifest.length === 0) {
    console.warn(
      '[gallery] No manifest entries. The gallery will render its empty state. Run `npm run fetch-gallery` with FB credentials to populate it.',
    );
    cache = [];
    return cache;
  }

  const valid = manifest.filter((entry) => {
    // The JPEG fallback is the one file every template needs.
    const fallback = join(GALLERY_DIR, `${entry.hash}-800.jpg`);
    return existsSync(fallback);
  });

  const skipped = manifest.length - valid.length;
  if (skipped > 0) {
    console.warn(
      `[gallery] Skipping ${skipped} of ${manifest.length} entries with missing image files. Run \`npm run fetch-gallery\` to regenerate.`,
    );
  }

  cache = valid.map(toGalleryItem);
  return cache;
}

export function getGalleryItem(slug: string): GalleryItem | undefined {
  return getGalleryItems().find((item) => item.slug === slug);
}

/** Categories that actually have pieces in them, largest first. */
export function getCategoryFacets(items: GalleryItem[]): CategoryFacet[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, count]) => {
      const meta = CATEGORY_META[id] ?? FALLBACK_CATEGORY;
      return { id, label: meta.label, blurb: meta.blurb, count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Neighbours for prev/next on a piece page, wrapping at both ends so the
 * navigation is never a dead end.
 */
export function getNeighbours(slug: string): {
  previous: GalleryItem | null;
  next: GalleryItem | null;
} {
  const items = getGalleryItems();
  const index = items.findIndex((item) => item.slug === slug);
  if (index === -1 || items.length < 2) return { previous: null, next: null };

  return {
    previous: items[(index - 1 + items.length) % items.length],
    next: items[(index + 1) % items.length],
  };
}

/** Other pieces in the same category, for the related strip. */
export function getRelated(item: GalleryItem, limit = 4): GalleryItem[] {
  const sameCategory = getGalleryItems().filter(
    (candidate) => candidate.slug !== item.slug && candidate.category === item.category,
  );

  if (sameCategory.length >= limit) return sameCategory.slice(0, limit);

  // Top up with the newest other pieces so the strip is never half-empty.
  const filler = getGalleryItems().filter(
    (candidate) =>
      candidate.slug !== item.slug && !sameCategory.some((s) => s.slug === candidate.slug),
  );

  return [...sameCategory, ...filler].slice(0, limit);
}
