import { SITE } from './constants';

export function generateLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: SITE.name,
    description: SITE.description,
    url: SITE.url,
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

/**
 * FAQPage structured data.
 *
 * Takes the same array the page renders its <dl> from, so the visible
 * questions and the structured data cannot drift apart.
 */
export function generateFaqSchema(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
