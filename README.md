# Faithfully Crafted

A static portfolio for **Faithfully Crafted**, Faith's handmade crochet business in
South Caloocan, Philippines. Built with Astro and Tailwind CSS v4. Gallery content is
pulled from her Facebook Page via the Graph API at build time, processed into
responsive AVIF/WebP locally, and deployed to Cloudflare Pages.

Live at **https://faithfullycrafted.pages.dev**. There is no custom domain, and
therefore no email address — Faith's contact channel is Facebook Messenger.

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

### Verify

```bash
npm run verify     # astro check + eslint + prettier + build + tests
npm test           # contrast and dead-class gates only
```

### Build

```bash
npm run build      # fetch gallery, then build
npm run build:only # build from the existing manifest, no Facebook call
```

> [!IMPORTANT]
> **`FB_PAGE_ID` and `FB_ACCESS_TOKEN` must be set in the Cloudflare Pages project**,
> not only in GitHub Actions secrets. Generated gallery images are gitignored, so a
> Cloudflare-side build without credentials produces a site whose gallery falls back to
> its empty state and whose 291 piece pages are not generated. Cloudflare cannot read
> GitHub secrets. See `docs/deployment.md`.

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
    ui/            Button, Card, Chip, Divider, EmptyState, GalleryImage, SocialIcon
    layout/        Header (nav island), Footer, SEOHead
    sections/      Hero, FeaturedWorks, GalleryGrid, AboutSnippet, ContactCard, CTABanner
    interactive/   Lightbox, ScrollReveal
  layouts/         Base HTML layout with View Transitions
  pages/           index, gallery, piece/[slug], order, about, contact, privacy, terms, 404
  lib/             gallery data access, schema generators, site constants
  types/           TypeScript interfaces
  styles/          global.css (design tokens), texture.css, animations.css, cursor.css
scripts/
  fetch-gallery.mjs      Facebook fetch + responsive image pipeline
  prune-gallery.mjs      removes images no longer in the manifest
  lib/caption.mjs        derives title/alt/body from social captions
  lib/categories.mjs     category taxonomy, shared with src/
functions/
  api/order.ts     Cloudflare Pages Function for order submissions
cron-worker/       Cloudflare Worker that fires the Pages deploy hook on a schedule
tests/             contrast and dead-class gates (node:test, no framework)
public/
  fonts/           Self-hosted WOFF2 (Quicksand, DM Sans, Dancing Script)
  gallery/         Generated images (gitignored) + _manifest.json (tracked)
  _headers         Security headers
  _redirects       URL redirects and social shortlinks
```

## Features

- 291 per-piece pages generated from the Facebook manifest, each with Product schema,
  breadcrumbs, prev/next and related pieces
- Gallery with category filters and search, built as progressive enhancement: every
  piece renders as static HTML, so it works with JavaScript disabled
- Custom order form that copies the request and hands off to Messenger, upgrading to a
  verified API path when Turnstile and KV are configured
- Responsive AVIF/WebP/JPEG at the widths each original can honestly support, with
  inline low-quality placeholders and explicit dimensions (CLS measures ~0.0003)
- Design tokens where every text/surface pair is verified against WCAG AA by a test
- Nav island that morphs to stitched glass on scroll, with a dashed running-stitch edge
- Lightbox with opt-in slideshow, focus trap and swipe
- Self-hosted fonts, no third-party requests

## Design system

Tokens live in a single `@theme` block in `src/styles/global.css`. Two rules matter:

1. **One accent.** `--color-rose-text` (#bf2f62) is the only rose permitted on type; it
   is the deepest candidate that clears 4.5:1 on every surface including cream. Faith's
   original brand pink (#e8669a) scores 2.65:1 there — it fails even the 3:1 large-text
   bar — so it lives on as a decorative fill.
2. **Decoration never sets `text-*`.** Decorative tokens use `fill-*` or `stroke-*`.
   `npm test` fails the build if that is violated.

Radii are concentric (inner = outer − padding), elevation is one rose-tinted layered
family, and type comes from a fluid modular scale. Craft texture comes from material —
a crochet V-stitch field, paper grain, thread rails — rather than from rotation.

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

Three pipelines, described in full in [`docs/deployment.md`](docs/deployment.md):

- **Cloudflare Pages (auto)** -- builds and deploys on every push to `main`. Handles code changes.
- **Cloudflare cron Worker** (`cron-worker/`) -- the primary scheduled rebuild. Every 3 days it fires a Pages Deploy Hook to pick up new Facebook posts. Lives on Cloudflare because GitHub disables cron-triggered workflows after 60 days of repository inactivity.
- **GitHub Actions** (`.github/workflows/deploy.yml`) -- escape hatch with a manual "Run workflow" button, plus its own 3-day schedule. Caches downloaded gallery images and commits the refreshed manifest back to the repo.

Repository secrets required by `.github/workflows/deploy.yml`:

- `FB_PAGE_ID`
- `FB_ACCESS_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`FB_PAGE_ID` and `FB_ACCESS_TOKEN` must **also** be set as environment variables on the Cloudflare Pages project, otherwise deploy-hook rebuilds publish the placeholder gallery. The cron Worker needs one secret of its own, `PAGES_DEPLOY_HOOK`.

`.github/workflows/ci.yml` runs `astro check`, `npm run lint`, `prettier --check .`, and `npm run build` on every push and pull request, with no Facebook credentials.

## SEO

- JSON-LD structured data (LocalBusiness schema) on every page
- Open Graph and Twitter Card meta tags
- Auto-generated sitemap via `@astrojs/sitemap`
- Canonical URLs, meta descriptions, robots directives
- Proper HTML semantics (`nav`, `article`, `address`, `dl`, `aria-label` attributes)
- Web app manifest with theme colors

## Security

- Content Security Policy, HSTS, X-Frame-Options and Permissions-Policy via `_headers`;
  the CSP allows `challenges.cloudflare.com` only, for Turnstile
- The Facebook token is used at build time only and never reaches the browser
- Facebook CDN URLs are discarded — images are downloaded and re-encoded locally, so no
  third-party tracking parameters appear in the HTML
- Order submissions are validated server-side, rate limited, and neutralised against
  header injection before rendering
- Self-hosted fonts, no third-party requests
- All external links carry `rel="noopener noreferrer"`
- No source maps in production

## Accessibility

Enforced by `tests/contrast.test.mjs` rather than by review:

- Every text token clears WCAG AA 4.5:1 against every surface it may sit on
- Decorative tokens can never be used as a text colour
- Link hover raises contrast rather than lowering it

Also: skip link, `aria-current` on navigation, visible focus rings, focus trapped in the
mobile menu and lightbox, `prefers-reduced-motion` honoured throughout, no autoplaying
content, and scroll-reveal gated on JavaScript being present so a failed script cannot
leave the page blank.

## License

[MIT](LICENSE)
