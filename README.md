# Faithfully Crafted

A static portfolio website for Ny Girlfriend "faith" a handmade crochet business, built with Astro and Tailwind CSS. Pulls gallery content from a Facebook Page via the Graph API at build time, compresses images locally, and deploys to Cloudflare Pages.

## Tech Stack

- **Astro** -- Static site generation with View Transitions
- **Tailwind CSS v4** -- Utility-first styling with custom design tokens
- **TypeScript** -- Strict mode throughout
- **Facebook Graph API v25.0** -- Build-time content fetching
- **Sharp** -- Image compression at build time
- **Cloudflare Pages** -- Edge deployment with global CDN

## Getting Started

### Prerequisites

- Node.js 22+
- npm 9+

### Install

```bash
npm install
```

### Environment Variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable          | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `FB_PAGE_ID`      | Your Facebook Page ID (numeric)                       |
| `FB_ACCESS_TOKEN` | A never-expiring Page Access Token from the Graph API |

Without these variables, the gallery uses placeholder content.

### Development

```bash
npm run dev
```

Opens at `http://localhost:4321`.

### Build

```bash
npm run build
```

Outputs static files to `dist/`. The build runs a pre-build script that fetches Facebook posts and downloads/compresses images to `public/gallery/`, then Astro copies everything to `dist/` and pre-renders all pages as static HTML.

### Preview

```bash
npm run preview
```

Previews the production build locally.

## Project Structure

```
src/
  components/
    ui/            Reusable atoms (Button, Card, SocialIcon, Divider)
    layout/        Header (Dynamic Island navbar), Footer, SEOHead
    sections/      Page sections (Hero, GalleryGrid, FeaturedWorks, ContactCard, CTABanner)
    interactive/   Client-side JS islands (Lightbox with autoplay, ScrollReveal)
  layouts/         Base HTML layout with View Transitions
  pages/           File-based routing (index, gallery, about, contact, 404)
  lib/             Facebook API client, SEO schema generators, site constants
  types/           TypeScript interfaces
  styles/          Global CSS, animations, custom cursors
public/
  fonts/           Self-hosted WOFF2 fonts (Quicksand, DM Sans, Dancing Script)
  gallery/         Downloaded and compressed Facebook post images (gitignored)
  _headers         Cloudflare Pages security headers
  _redirects       URL redirects and social shortlinks
```

## Features

- Dynamic Island navbar that morphs from transparent to a floating glassmorphism pill on scroll
- Masonry gallery with direction-aware scroll animations and Load More pagination
- Lightbox with autoplay slideshow, Instagram Stories-style progress bar, pause/play, touch swipe
- Skeleton shimmer loading states for gallery images
- Custom crochet-hook cursor on pointer devices
- Responsive design with touch vs mouse differentiation
- Facebook Graph API integration with local image downloading and compression
- Self-hosted fonts (no third-party CDN requests)

## Facebook API Setup

1. Create a Facebook Developer account at https://developers.facebook.com
2. Create a new app (type: Business)
3. In the Graph API Explorer, select your app and generate a User Access Token with permissions `pages_show_list` and `pages_read_engagement`
4. Use the Access Token Debugger to extend it to a long-lived token
5. Query `/me/accounts` with the long-lived token to get a never-expiring Page Access Token
6. Add `FB_PAGE_ID` and `FB_ACCESS_TOKEN` to your `.env` file

## Deployment

### Cloudflare Pages (CLI)

```bash
npm run build
npx wrangler pages deploy dist
```

### Cloudflare Pages (GitHub Integration)

1. Push the repo to GitHub
2. In the Cloudflare dashboard, go to Workers and Pages, create a new Pages project
3. Connect the GitHub repository
4. Set build command to `npm run build` and output directory to `dist`
5. Add `FB_PAGE_ID` and `FB_ACCESS_TOKEN` as environment variables

### CI/CD

Two deployment pipelines work together without overlap:

- **Cloudflare Pages (auto)** -- builds and deploys on every push to `main`. Handles code changes.
- **GitHub Actions (scheduled)** -- rebuilds every 3 days to pick up new Facebook posts. Also has a manual "Run workflow" button for instant refresh.

The GitHub Actions workflow at `.github/workflows/deploy.yml` requires these repository secrets:

- `FB_PAGE_ID`
- `FB_ACCESS_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## SEO

- JSON-LD structured data (LocalBusiness schema) on every page
- Open Graph and Twitter Card meta tags
- Auto-generated sitemap via `@astrojs/sitemap`
- Canonical URLs, meta descriptions, robots directives
- Proper HTML semantics (`nav`, `article`, `address`, `dl`, `aria-label` attributes)
- Web app manifest with theme colors

## Security

- Content Security Policy, HSTS, X-Frame-Options, Permissions-Policy via `_headers`
- Facebook API token used only at build time, never exposed in client output
- Facebook CDN image URLs stripped -- images downloaded locally, no external tracking params in HTML
- Post content sanitized with HTML entity escaping before rendering
- Self-hosted fonts eliminate third-party tracking
- All external links use `rel="noopener noreferrer"`
- No source maps in production build

## License

[MIT](LICENSE)
