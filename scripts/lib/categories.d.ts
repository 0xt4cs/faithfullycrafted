/**
 * Type declarations for the category table.
 *
 * The table itself lives in `categories.mjs` as plain JavaScript so that both
 * consumers can share one definition: `scripts/fetch-gallery.mjs` runs in bare
 * Node before the Astro build and cannot import TypeScript, while
 * `src/lib/constants.ts` needs the same labels at render time. Duplicating the
 * table in both languages would guarantee it drifts.
 */

export interface CategoryDefinition {
  id: string;
  label: string;
  blurb: string;
  keywords: Array<[string, number]>;
}

export interface CategoryFallback {
  id: string;
  label: string;
  blurb: string;
}

export const CATEGORIES: CategoryDefinition[];
export const FALLBACK_CATEGORY: CategoryFallback;

export function categoryById(id: string): CategoryDefinition | CategoryFallback;

export function categorise(
  caption: string,
  tags?: string[],
): { category: string; categoryLabel: string; score: number };
