import {
  CATEGORIES,
  FALLBACK_CATEGORY as SCRIPT_FALLBACK_CATEGORY,
} from '../../scripts/lib/categories.mjs';

export const SITE = {
  name: 'Faithfully Crafted',
  tagline: 'Handcrafted with love, one stitch at a time',
  description:
    'Faithfully Crafted by Faith — beautiful handmade crochet creations from Caloocan, Philippines. Custom amigurumi, keychains, and gifts made with faith and love.',
  url: 'https://faithfullycrafted.pages.dev',
  /**
   * There is deliberately no `email` here. faithfullycrafted.ph was never
   * registered and faith@faithfullycrafted.ph never existed, so every
   * mailto: and every LocalBusiness.email pointing at it was dead. Faith's
   * real channel is Messenger; see SOCIALS below.
   */
  location: 'South Caloocan / Malabon, Philippines',
  crafter: 'Faith',
} as const;

export const SOCIALS = {
  facebook: {
    url: 'https://www.facebook.com/gingerchets/',
    label: 'Facebook',
    messenger: 'https://m.me/gingerchets',
  },
  instagram: {
    url: 'https://www.instagram.com/faithfully_crafted04',
    label: 'Instagram',
  },
} as const;

export const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Gallery', href: '/gallery/' },
  { label: 'About', href: '/about/' },
  { label: 'Order', href: '/order/' },
  { label: 'Contact', href: '/contact/' },
] as const;

/**
 * Category labels, keyed by id, re-exported from the single definition in
 * `scripts/lib/categories.mjs`. The build script derives each piece's category
 * from its caption using that same table, so the labels shown on the gallery
 * can never disagree with the data in the manifest.
 */
export const CATEGORY_META: Record<string, { label: string; blurb: string }> = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, { label: category.label, blurb: category.blurb }]),
);

export const FALLBACK_CATEGORY = SCRIPT_FALLBACK_CATEGORY;

/** Order form option lists, kept here so the form and its validator agree. */
export const PIECE_TYPES = [
  { value: 'keychains', label: 'Keychain or bag charm' },
  { value: 'flowers', label: 'Flowers or a bouquet' },
  { value: 'characters', label: 'Character amigurumi' },
  { value: 'stars', label: 'Stars' },
  { value: 'minis', label: 'Personalised mini' },
  { value: 'gifts', label: 'A gift for an occasion' },
  { value: 'custom', label: 'Something else entirely' },
] as const;

export const BUDGET_RANGES = [
  { value: 'under-300', label: 'Under ₱300' },
  { value: '300-600', label: '₱300 to ₱600' },
  { value: '600-1200', label: '₱600 to ₱1,200' },
  { value: 'over-1200', label: 'Over ₱1,200' },
  { value: 'unsure', label: 'Not sure yet' },
] as const;
