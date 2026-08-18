/**
 * Accessibility audit with axe-core, against WCAG 2.0/2.1 A and AA.
 *
 * `tests/contrast.test.mjs` proves the *palette* is sound in the abstract; this
 * proves the rendered pages actually are. They catch different things: the
 * palette test cannot see a missing label, a broken heading order, or a control
 * whose accessible name is empty, and axe cannot see that a token defined but
 * not yet used would fail if someone reached for it.
 *
 * Every violation is reported with its rule id, impact, help URL and the
 * offending selectors, so a failure is actionable without opening this file.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import {
  startServer,
  stopServer,
  BASE,
  resolvePages,
  galleryItemCount,
} from './helpers/server.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Top-level await so the page list is known before `describe` runs and each page
// still gets its own named test rather than being folded into one.
const server = await startServer();
const browser = await chromium.launch();
const PAGES = await resolvePages();
const GALLERY_ITEMS = await galleryItemCount();

after(async () => {
  await browser?.close();
  await stopServer(server);
});

function format(violations) {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 4)
        .map((n) => `        ${n.target.join(' ')}`)
        .join('\n');
      const more = v.nodes.length > 4 ? `\n        ... and ${v.nodes.length - 4} more` : '';
      return `  [${v.impact}] ${v.id}: ${v.help}\n      ${v.helpUrl}\n${targets}${more}`;
    })
    .join('\n\n');
}

describe('axe-core WCAG 2.1 AA', () => {
  for (const page of PAGES) {
    test(`${page.name} has no violations`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(BASE + page.path, { waitUntil: 'load' });

      // Reveal everything before auditing. Scroll-reveal leaves below-fold
      // sections at opacity 0, and axe skips what it considers hidden, so an
      // un-scrolled audit would silently exempt most of the page.
      await p.evaluate(() => {
        document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('revealed'));
      });
      await p.waitForTimeout(350);

      const { violations } = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      await ctx.close();

      assert.equal(
        violations.length,
        0,
        `${violations.length} accessibility violation(s) on ${page.path}:\n\n${format(violations)}\n`,
      );
    });
  }

  test(
    'mobile viewport has no violations on the gallery',
    { skip: GALLERY_ITEMS === 0 && 'gallery is empty in this build' },
    async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/gallery/`, { waitUntil: 'load' });
      await p.evaluate(() => {
        document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('revealed'));
      });
      await p.waitForTimeout(350);

      const { violations } = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      await ctx.close();

      assert.equal(
        violations.length,
        0,
        `${violations.length} violation(s) on the gallery at 390px:\n\n${format(violations)}\n`,
      );
    },
  );

  test('the open mobile menu has no violations', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.click('#mobile-menu-btn');
    await p.waitForTimeout(500);

    const { violations } = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
    await ctx.close();

    assert.equal(
      violations.length,
      0,
      `${violations.length} violation(s) with the menu open:\n\n${format(violations)}\n`,
    );
  });

  test(
    'the open lightbox has no violations',
    { skip: GALLERY_ITEMS === 0 && 'gallery is empty in this build' },
    async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/gallery/`, { waitUntil: 'load' });
      await p.click('[data-lightbox-trigger]');
      await p.waitForTimeout(600);

      const { violations } = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      await ctx.close();

      assert.equal(
        violations.length,
        0,
        `${violations.length} violation(s) with the lightbox open:\n\n${format(violations)}\n`,
      );
    },
  );
});
