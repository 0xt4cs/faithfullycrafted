export const SITE = {
  name: 'Faithfully Crafted',
  tagline: 'Handcrafted with love, one stitch at a time',
  description:
    'Faithfully Crafted by Faith — beautiful handmade crochet creations from Caloocan, Philippines. Custom amigurumi, keychains, and gifts made with faith and love.',
  url: 'https://faithfullycrafted.shop',
  email: 'faithlrr.admin@faithfullycrafted.shop',
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
  { label: 'Contact', href: '/contact/' },
] as const;
