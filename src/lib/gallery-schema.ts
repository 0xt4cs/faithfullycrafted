/**
 * Structured data for the gallery and the per-piece pages.
 *
 * Kept separate from `seo.ts` (which holds the site-wide LocalBusiness and FAQ
 * schemas) because these need the gallery types and are only used by the two
 * gallery routes.
 */
import type { GalleryItem } from '@typedefs/index';
import { SITE, SOCIALS } from '@lib/constants';

const absolute = (path: string) => new URL(path, SITE.url).href;

/**
 * ItemList for the gallery index. Gives search engines the collection
 * structure and a route to each piece page, which is the point of generating
 * them at all.
 */
export function generateCollectionSchema(items: GalleryItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Gallery — ${SITE.name}`,
    description: `Handmade crochet pieces by ${SITE.crafter}.`,
    url: absolute('/gallery/'),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE.name,
      url: SITE.url,
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.slice(0, 100).map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absolute(item.href),
        name: item.title,
      })),
    },
  };
}

/**
 * One piece. Modelled as a Product with an offer rather than a CreativeWork,
 * because these are made to order and that is what a shopper's search results
 * should reflect. Price is deliberately omitted — Faith quotes per piece, and
 * inventing a number would be worse than leaving it out.
 */
export function generatePieceSchema(item: GalleryItem) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.title,
    description: item.body || item.alt,
    image: absolute(`/gallery/${item.hash}-800.jpg`),
    url: absolute(item.href),
    category: item.categoryLabel,
    keywords: item.tags.join(', '),
    releaseDate: item.date,
    brand: {
      '@type': 'Brand',
      name: SITE.name,
    },
    creator: {
      '@type': 'Person',
      name: SITE.crafter,
    },
    isHandmade: true,
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/MadeToOrder',
      itemCondition: 'https://schema.org/NewCondition',
      priceCurrency: 'PHP',
      url: absolute('/order/'),
      seller: {
        '@type': 'LocalBusiness',
        name: SITE.name,
        url: SITE.url,
        sameAs: [SOCIALS.facebook.url, SOCIALS.instagram.url],
      },
    },
  };
}

/** Breadcrumbs so a piece page shows its place in search results. */
export function generateBreadcrumbSchema(item: GalleryItem) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: 'Gallery', item: absolute('/gallery/') },
      { '@type': 'ListItem', position: 3, name: item.title, item: absolute(item.href) },
    ],
  };
}
