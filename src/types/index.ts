/** Widths emitted by scripts/fetch-gallery.mjs. */
export type ImageWidth = 480 | 800 | 1200;

export interface ImageVariants {
  avif: number[];
  webp: number[];
  jpg: number[];
}

/**
 * One entry in `public/gallery/_manifest.json`, as written by
 * scripts/fetch-gallery.mjs. This is the on-disk contract; if you change the
 * script, change this too.
 */
export interface ManifestEntry {
  id: string;
  /** Stable 16-char hash of the Facebook post id; the image filename stem. */
  hash: string;
  slug: string;
  filename: string;
  /** Short human title, hashtags and emoji stripped. */
  title: string;
  /** Descriptive, emoji-free alt text. */
  alt: string;
  /** Readable caption body with the hashtag block and CTAs removed. */
  body: string;
  /** Raw ISO timestamp from the Graph API. */
  date: string;
  permalink: string;
  width: number;
  height: number;
  category: string;
  tags: string[];
  /** Inline base64 WebP placeholder, ~20px wide. */
  lqip: string;
  variants: ImageVariants;
}

/**
 * A gallery entry as the templates consume it: manifest data plus the derived
 * display fields.
 */
export interface GalleryItem extends ManifestEntry {
  /** Human category name, resolved from the category id. */
  categoryLabel: string;
  /** Localised date for display, e.g. "18 August 2026". */
  dateLabel: string;
  /** The JPEG fallback path, used as <img src>. */
  src: string;
  /** Route to this piece's own page. */
  href: string;
}

export interface CategoryFacet {
  id: string;
  label: string;
  blurb: string;
  count: number;
}

export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  type?: 'website' | 'article';
  canonicalUrl?: string;
  /** Emits <meta name="robots" content="noindex, follow">. */
  noindex?: boolean;
  /**
   * Intrinsic size of `image`. Defaults to the 1200x630 og-image. Piece pages
   * pass their own square photo, and a wrong og:image:width makes some
   * scrapers crop or letterbox the preview.
   */
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
}

export type NavItem = {
  label: string;
  href: string;
};

export type RevealDirection = 'up' | 'left' | 'right' | 'scale' | 'fade';
