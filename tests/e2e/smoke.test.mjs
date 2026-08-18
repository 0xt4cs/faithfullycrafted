/**
 * Behaviour tests for the interactive parts of the site.
 *
 * Scoped to things that would silently rot: the gallery filters, the lightbox,
 * the order form's validation and its Messenger handoff, focus management in the
 * two overlays, and the progressive-enhancement guarantees. Each of these has
 * already broken once during this rebuild, which is why they are here.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer, BASE, galleryItemCount } from './helpers/server.mjs';

const server = await startServer();
const browser = await chromium.launch();
const GALLERY_ITEMS = await galleryItemCount();

/**
 * The gallery, lightbox and piece-page specs need real content. CI builds
 * without Facebook credentials on purpose, so there the gallery renders its
 * empty state and these skip with a reason rather than failing for something
 * unrelated to the code.
 */
const needsGallery = { skip: GALLERY_ITEMS === 0 && 'gallery is empty in this build' };

after(async () => {
  await browser?.close();
  await stopServer(server);
});

async function open(path, viewport = { width: 1280, height: 900 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return { ctx, page, errors };
}

describe('navigation', () => {
  test('marks the current page and only the current page', async () => {
    const { ctx, page } = await open('/gallery/');
    const current = await page.$$eval('nav [aria-current="page"]', (els) =>
      els.map((e) => e.textContent.trim()),
    );
    await ctx.close();
    assert.deepEqual(current, ['Gallery'], 'exactly one nav item should be aria-current');
  });

  test('mobile menu opens, traps focus, closes on Escape and returns focus', async () => {
    const { ctx, page } = await open('/', { width: 390, height: 844 });
    const btn = page.locator('#mobile-menu-btn');

    await btn.click();
    assert.equal(await btn.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#mobile-menu').getAttribute('aria-hidden'), 'false');

    // Focus must be inside the overlay, not behind it.
    const insideAfterOpen = await page.evaluate(() =>
      document.getElementById('mobile-menu').contains(document.activeElement),
    );
    assert.ok(insideAfterOpen, 'focus should move into the open menu');

    await page.keyboard.press('Escape');
    assert.equal(await btn.getAttribute('aria-expanded'), 'false');
    const focusReturned = await page.evaluate(
      () => document.activeElement?.id === 'mobile-menu-btn',
    );
    await ctx.close();
    assert.ok(focusReturned, 'focus should return to the toggle that opened it');
  });

  test('the skip link moves focus to main', async () => {
    const { ctx, page } = await open('/');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.className || '');
    assert.match(focused, /skip-link/, 'the skip link should be the first tab stop');
    await page.keyboard.press('Enter');
    const hash = await page.evaluate(() => location.hash);
    await ctx.close();
    assert.equal(hash, '#main');
  });
});

describe('gallery', () => {
  test('category filter narrows the grid and updates the count', needsGallery, async () => {
    const { ctx, page } = await open('/gallery/');
    const total = Number(await page.locator('#gallery-total').textContent());

    await page.click('[data-filter="stars"]');
    await page.waitForTimeout(300);

    const shownTotal = Number(await page.locator('#gallery-total').textContent());
    const visible = await page.locator('.gallery-item:not([hidden])').count();

    assert.ok(shownTotal < total, `filtered total (${shownTotal}) should be below ${total}`);
    assert.equal(visible, shownTotal, 'visible cards should match the reported count');
    assert.equal(await page.locator('[data-filter="stars"]').getAttribute('aria-pressed'), 'true');

    // Every visible card really is in that category.
    const categories = await page.$$eval('.gallery-item:not([hidden])', (els) => [
      ...new Set(els.map((e) => e.dataset.category)),
    ]);
    await ctx.close();
    assert.deepEqual(categories, ['stars']);
  });

  test('search filters, and an impossible query shows the empty state', needsGallery, async () => {
    const { ctx, page } = await open('/gallery/');

    await page.fill('#gallery-search', 'totoro');
    await page.waitForTimeout(400);
    const hits = await page.locator('.gallery-item:not([hidden])').count();
    assert.ok(hits > 0, 'a term present in the corpus should return matches');

    await page.fill('#gallery-search', 'zzzzzznotathing');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.gallery-item:not([hidden])').count(), 0);
    const emptyVisible = await page.locator('#gallery-no-results').isVisible();
    await ctx.close();
    assert.ok(emptyVisible, 'the no-results state should appear');
  });

  test(
    'every piece is in the HTML, so filtering works without JavaScript',
    needsGallery,
    async () => {
      const { ctx, page } = await open(
        '/gallery/',
        { width: 1280, height: 900 },
        {
          javaScriptEnabled: false,
        },
      );
      const rendered = await page.locator('.gallery-item').count();
      const links = await page.locator('.gallery-item a[href^="/piece/"]').count();
      await ctx.close();
      assert.ok(rendered > 200, `expected the full collection in static HTML, got ${rendered}`);
      assert.equal(links, rendered, 'every card should link to its piece page');
    },
  );

  test('cards link to piece pages that exist', needsGallery, async () => {
    const { ctx, page } = await open('/gallery/');
    const href = await page
      .locator('.gallery-item a[href^="/piece/"]')
      .first()
      .getAttribute('href');
    const res = await page.request.get(BASE + href);
    await ctx.close();
    assert.equal(res.status(), 200, `${href} should resolve`);
  });
});

describe('lightbox', () => {
  test(
    'opens from a card, advances, closes on Escape and restores focus',
    needsGallery,
    async () => {
      const { ctx, page } = await open('/gallery/');
      const trigger = page.locator('[data-lightbox-trigger]').first();

      await trigger.click();
      await page.waitForTimeout(400);
      assert.ok(await page.locator('#lightbox').isVisible(), 'lightbox should open');

      const first = await page.locator('#lightbox-image').getAttribute('src');
      await page.click('#lightbox-next');
      await page.waitForTimeout(300);
      const second = await page.locator('#lightbox-image').getAttribute('src');
      assert.notEqual(first, second, 'next should change the image');

      // Alt text must follow the image, not go stale.
      const alt = await page.locator('#lightbox-image').getAttribute('alt');
      assert.ok(alt && alt.length > 5, 'the lightbox image needs alt text');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      assert.ok(!(await page.locator('#lightbox').isVisible()), 'Escape should close it');
      const restored = await page.evaluate(
        () => document.activeElement?.hasAttribute('data-lightbox-trigger') ?? false,
      );
      await ctx.close();
      assert.ok(restored, 'focus should return to the trigger');
    },
  );

  test('the slideshow does not start on its own', needsGallery, async () => {
    const { ctx, page } = await open('/gallery/');
    await page.locator('[data-lightbox-trigger]').first().click();
    await page.waitForTimeout(400);
    const src = await page.locator('#lightbox-image').getAttribute('src');
    const pressed = await page.locator('#lightbox-play').getAttribute('aria-pressed');
    await page.waitForTimeout(4200);
    const later = await page.locator('#lightbox-image').getAttribute('src');
    await ctx.close();
    assert.equal(pressed, 'false', 'play should be off until asked for');
    assert.equal(src, later, 'the image must not advance without user action');
  });
});

describe('order form', () => {
  test('an empty submit reports every required field inline', async () => {
    const { ctx, page } = await open('/order/');
    await page.click('#order-submit');
    await page.waitForTimeout(300);

    assert.ok(await page.locator('#order-summary').isVisible(), 'error summary should appear');
    for (const field of ['name', 'contact', 'pieceType', 'budget', 'colors', 'message']) {
      assert.ok(
        await page.locator(`#${field}-error`).isVisible(),
        `${field} should report an inline error`,
      );
      assert.equal(
        await page.locator(`#${field}`).getAttribute('aria-invalid'),
        'true',
        `${field} should be marked aria-invalid`,
      );
    }
    // Error copy must help, not blame.
    const text = await page.locator('#order-summary').innerText();
    await ctx.close();
    assert.ok(
      !/invalid|error occurred|failed/i.test(text),
      `copy should not be system-speak: ${text}`,
    );
  });

  test('a bad email and a past date are caught', async () => {
    const { ctx, page } = await open('/order/');
    await page.fill('#name', 'Rina Alcantara');
    await page.fill('#contact', 'rina@nope');
    await page.fill('#deadline', '2020-01-01');
    await page.click('#order-submit');
    await page.waitForTimeout(300);
    assert.ok(await page.locator('#contact-error').isVisible());
    assert.ok(await page.locator('#deadline-error').isVisible());
    await ctx.close();
  });

  test('a valid request copies the details and confirms', async () => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/order/`, { waitUntil: 'load' });

    // The handoff opens Messenger in a new tab; keep it from actually loading.
    await page.route('**m.me/**', (route) => route.abort());

    await page.fill('#name', 'Rina Alcantara');
    await page.fill('#contact', 'rina@example.com');
    await page.selectOption('#pieceType', 'keychains');
    await page.selectOption('#budget', '300-600');
    await page.fill('#colors', 'sage green and cream');
    await page.fill('#message', 'A pair of keychains for my sister, roughly palm sized.');
    await page.click('#order-submit');
    await page.waitForTimeout(900);

    assert.ok(await page.locator('#order-success').isVisible(), 'success panel should show');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    await ctx.close();

    assert.match(clip, /Rina Alcantara/, 'the copied request should include the name');
    assert.match(clip, /Keychain or bag charm/, 'and the human label for the piece type');
    assert.match(clip, /sage green and cream/);
  });
});

describe('progressive enhancement and motion', () => {
  test('content is visible with JavaScript disabled', async () => {
    const { ctx, page } = await open(
      '/',
      { width: 1280, height: 900 },
      {
        javaScriptEnabled: false,
      },
    );
    // The reveal targets must not be left at opacity 0 when no script runs.
    const hidden = await page.$$eval(
      '[data-reveal]',
      (els) => els.filter((el) => Number(getComputedStyle(el).opacity) === 0).length,
    );
    const aboutVisible = await page.locator('text=Meet').first().isVisible();
    await ctx.close();
    assert.equal(hidden, 0, `${hidden} sections would be invisible without JavaScript`);
    assert.ok(aboutVisible);
  });

  test('reduced motion shows everything immediately', async () => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const hidden = await page.$$eval(
      '[data-reveal]',
      (els) => els.filter((el) => Number(getComputedStyle(el).opacity) === 0).length,
    );
    await ctx.close();
    assert.equal(hidden, 0, 'reduced motion must not leave content hidden');
  });
});

describe('404', () => {
  test('is not indexable and offers a way back', async () => {
    const { ctx, page } = await open('/404.html');
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    const links = await page.locator('main a[href="/"], main a[href="/gallery/"]').count();
    await ctx.close();
    assert.match(robots, /noindex/);
    assert.ok(links >= 2, 'the 404 should not be a dead end');
  });
});
