/**
 * Document-level standards: semantics, metadata, structured data, and the
 * privacy guarantees the README claims.
 *
 * These are the checks a reviewer would otherwise have to do by hand on every
 * page, and several of them encode bugs this codebase actually shipped: a
 * discarded noindex meta, alt text taken verbatim from hashtag-laden captions,
 * and structured data that vanished when a page supplied its own.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  startServer,
  stopServer,
  BASE,
  resolvePages,
  galleryItemCount,
} from './helpers/server.mjs';

const server = await startServer();
const browser = await chromium.launch();
const PAGES = await resolvePages();
const GALLERY_ITEMS = await galleryItemCount();
const PIECE = PAGES.find((p) => p.name === 'piece')?.path ?? null;
const skipWithoutGallery = { skip: GALLERY_ITEMS === 0 && 'gallery is empty in this build' };

after(async () => {
  await browser?.close();
  await stopServer(server);
});

async function load(path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(r.url());
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return { ctx, page, external };
}

describe('semantics', () => {
  for (const p of PAGES) {
    test(`${p.name}: one h1, no skipped heading levels, single main`, async () => {
      const { ctx, page } = await load(p.path);
      const levels = await page.$$eval('h1,h2,h3,h4,h5,h6', (els) =>
        els.map((e) => Number(e.tagName[1])),
      );
      const counts = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        main: document.querySelectorAll('main').length,
        header: document.querySelectorAll('body > header, body > * > header').length,
        footer: document.querySelectorAll('footer').length,
      }));
      await ctx.close();

      assert.equal(counts.h1, 1, `expected exactly one h1, found ${counts.h1}`);
      assert.equal(counts.main, 1, 'expected exactly one <main>');
      assert.ok(counts.footer >= 1, 'expected a <footer>');

      let previous = levels[0];
      for (const level of levels.slice(1)) {
        assert.ok(
          level <= previous + 1,
          `heading order jumps from h${previous} to h${level} on ${p.path}`,
        );
        previous = level;
      }
    });
  }

  test('no duplicate element ids anywhere', async () => {
    for (const p of PAGES) {
      const { ctx, page } = await load(p.path);
      const dupes = await page.evaluate(() => {
        const seen = new Map();
        for (const el of document.querySelectorAll('[id]')) {
          seen.set(el.id, (seen.get(el.id) || 0) + 1);
        }
        return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
      });
      await ctx.close();
      assert.deepEqual(dupes, [], `duplicate ids on ${p.path}`);
    }
  });

  test('every image has meaningful, emoji-free alt text', async () => {
    for (const path of ['/', '/gallery/', PIECE].filter(Boolean)) {
      const { ctx, page } = await load(path);
      const bad = await page.$$eval('img', (els) =>
        els
          // Skip hidden subtrees: the lightbox template image is not presented
          // to anyone until JavaScript populates it.
          .filter((el) => !el.closest('[aria-hidden="true"]') && !el.closest('[hidden]'))
          .map((el) => ({ src: el.currentSrc || el.src, alt: el.getAttribute('alt') }))
          .filter(
            (i) =>
              i.alt === null ||
              i.alt.trim().length < 4 ||
              /^(image|photo|picture|img)$/i.test(i.alt.trim()) ||
              /#\w/.test(i.alt) ||
              /\p{Extended_Pictographic}/u.test(i.alt),
          ),
      );
      await ctx.close();
      assert.deepEqual(
        bad,
        [],
        `weak alt text on ${path} (hashtags and emoji are disallowed): ${JSON.stringify(bad, null, 2)}`,
      );
    }
  });

  test('every image declares intrinsic dimensions', skipWithoutGallery, async () => {
    const { ctx, page } = await load('/gallery/');
    const missing = await page.$$eval('img', (els) =>
      els
        .filter((el) => !el.hasAttribute('width') || !el.hasAttribute('height'))
        .map((el) => el.currentSrc || el.src),
    );
    await ctx.close();
    assert.deepEqual(missing, [], 'images without width/height reintroduce layout shift');
  });
});

describe('metadata', () => {
  for (const p of PAGES) {
    test(`${p.name}: title, description, canonical and Open Graph`, async () => {
      const { ctx, page } = await load(p.path);
      const meta = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content ?? '',
        canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
        robots: document.querySelector('meta[name="robots"]')?.content ?? '',
        ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? '',
        ogImage: document.querySelector('meta[property="og:image"]')?.content ?? '',
        ogType: document.querySelector('meta[property="og:type"]')?.content ?? '',
        viewport: document.querySelector('meta[name="viewport"]')?.content ?? '',
      }));
      await ctx.close();

      assert.match(meta.lang, /^en/, 'html lang must be set');
      assert.ok(meta.title.length > 10 && meta.title.length < 70, `title length: ${meta.title}`);
      assert.ok(
        meta.description.length > 50 && meta.description.length <= 180,
        `description length ${meta.description.length}: ${meta.description}`,
      );
      assert.match(meta.canonical, /^https:\/\/faithfullycrafted\.pages\.dev\//);
      assert.ok(meta.ogTitle.length > 0 && meta.ogImage.startsWith('https://'));
      assert.ok(meta.ogType.length > 0);
      assert.match(meta.viewport, /width=device-width/);
      assert.match(meta.robots, p.name === '404' ? /noindex/ : /^index/);
    });
  }

  test('no reference to the domain that was never registered', async () => {
    for (const p of PAGES) {
      const { ctx, page } = await load(p.path);
      const html = await page.content();
      await ctx.close();
      assert.ok(
        !html.includes('faithfullycrafted.ph'),
        `${p.path} still references the unregistered domain`,
      );
      assert.ok(!/mailto:/.test(html), `${p.path} has a mailto: but no mailbox exists`);
    }
  });
});

describe('structured data', () => {
  test('every page emits valid JSON-LD including LocalBusiness', async () => {
    for (const p of PAGES) {
      const { ctx, page } = await load(p.path);
      const blocks = await page.$$eval('script[type="application/ld+json"]', (els) =>
        els.map((e) => e.textContent),
      );
      await ctx.close();

      assert.ok(blocks.length > 0, `${p.path} has no structured data`);
      const types = blocks.map((raw) => {
        let parsed;
        assert.doesNotThrow(() => {
          parsed = JSON.parse(raw);
        }, `invalid JSON-LD on ${p.path}`);
        return parsed['@type'];
      });
      assert.ok(
        types.includes('LocalBusiness'),
        `${p.path} lost its LocalBusiness schema (types: ${types.join(', ')})`,
      );
    }
  });

  test(
    'a piece page describes the piece as a made-to-order product',
    { skip: !PIECE && 'no piece pages in this build' },
    async () => {
      const { ctx, page } = await load(PIECE);
      const blocks = await page.$$eval('script[type="application/ld+json"]', (els) =>
        els.map((e) => JSON.parse(e.textContent)),
      );
      await ctx.close();

      const product = blocks.find((b) => b['@type'] === 'Product');
      assert.ok(product, 'expected a Product schema');
      assert.ok(product.name?.length > 3 && !/#\w/.test(product.name), 'name should be clean');
      assert.match(product.offers.availability, /MadeToOrder/);
      assert.ok(product.image.startsWith('https://'));
      assert.ok(
        blocks.some((b) => b['@type'] === 'BreadcrumbList'),
        'expected breadcrumbs',
      );
    },
  );

  test('the contact page keeps both its FAQ and the business schema', async () => {
    const { ctx, page } = await load('/contact/');
    const types = await page.$$eval('script[type="application/ld+json"]', (els) =>
      els.map((e) => JSON.parse(e.textContent)['@type']),
    );
    await ctx.close();
    assert.ok(types.includes('FAQPage'), `types: ${types.join(', ')}`);
    assert.ok(types.includes('LocalBusiness'), `types: ${types.join(', ')}`);
  });
});

describe('privacy and safety', () => {
  test('no third-party requests are made', async () => {
    for (const p of PAGES) {
      const { ctx, external } = await load(p.path);
      await ctx.close();
      assert.deepEqual(
        [...new Set(external)],
        [],
        `${p.path} reached off-origin; fonts and images are meant to be self-hosted`,
      );
    }
  });

  test('every external link is rel="noopener noreferrer"', async () => {
    for (const p of PAGES) {
      const { ctx, page } = await load(p.path);
      const unsafe = await page.$$eval('a[target="_blank"]', (els) =>
        els
          .filter((el) => {
            const rel = (el.getAttribute('rel') || '').toLowerCase();
            return !rel.includes('noopener') || !rel.includes('noreferrer');
          })
          .map((el) => el.href),
      );
      await ctx.close();
      assert.deepEqual(unsafe, [], `unsafe target="_blank" links on ${p.path}`);
    }
  });
});
