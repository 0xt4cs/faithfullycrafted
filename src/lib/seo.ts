import { SITE } from './constants';

export function generateLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: SITE.name,
    description: SITE.description,
    url: SITE.url,
    email: SITE.email,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Caloocan',
      addressRegion: 'Metro Manila',
      addressCountry: 'PH',
    },
    priceRange: '$$',
    image: `${SITE.url}/og-image.png`,
    sameAs: [
      'https://www.facebook.com/gingerchets/',
      'https://www.instagram.com/faithfully_crafted04',
    ],
  };
}

export function generateCreativeWorkSchema(item: {
  name: string;
  image: string;
  description: string;
  datePublished: string;
  url: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: item.name,
    image: item.image,
    description: item.description,
    datePublished: item.datePublished,
    url: item.url,
    creator: {
      '@type': 'Person',
      name: SITE.crafter,
    },
    provider: {
      '@type': 'LocalBusiness',
      name: SITE.name,
    },
  };
}
