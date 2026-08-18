/**
 * Dead-utility gate.
 *
 * Why this file exists
 * -------------------
 * Four class names shipped to production that were not real Tailwind v4
 * utilities, so each one emitted ZERO CSS and silently did nothing:
 *
 *   font-700          Tailwind has font-bold, not font-700.
 *   font-600          Meant to make link labels semibold. It never did.
 *   bg-body           There is no `body` colour token; the utility does not exist.
 *   perspective-1000  Tailwind v4 spells this perspective-distant / perspective-[1000px].
 *
 * `font-700` on the FAQ `<dt>` elements meant the questions rendered
 * identically to their answers. Nothing errored, nothing warned. A dead
 * utility is invisible in review and invisible in the browser devtools
 * (the class is on the element; it simply has no rule).
 *
 * How this test works
 * ------------------
 *   1. Read every class selector actually present in the compiled stylesheet.
 *   2. Read every statically-resolvable class token used in `src/`.
 *   3. Anything used-but-not-compiled that looks like a Tailwind utility fails.
 *
 * Precision over recall, deliberately
 * ----------------------------------
 * A test that cries wolf gets deleted, and then the bug class comes back. So
 * every ambiguous case is SKIPPED rather than reported:
 *
 *   - Dynamically composed classes (`class={base}`, `` `text-${size}` ``) are
 *     not resolvable, so they are skipped.
 *   - A class is only reported if it "looks like Tailwind" (see
 *     `looksLikeTailwindUtility`). Project class names such as `gallery-item`
 *     are skipped automatically because nothing in the compiled CSS and
 *     nothing in the utility-namespace list claims that prefix.
 *   - Classes defined by the project's own hand-written CSS or `<style>`
 *     blocks are harvested automatically, which keeps the manual allowlist
 *     small and honest.
 *
 * Run: npm run build, then node --test tests/no-dead-classes.test.mjs
 * Debug: DEBUG_DEAD_CLASSES=1 node --test tests/no-dead-classes.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const DEBUG = process.env.DEBUG_DEAD_CLASSES === '1';

const BUILD_HINT =
  'Run `npm run build` first — this test reads the compiled stylesheet from dist/ ' +
  'and deliberately does not shell out to a build itself.';

/* ==========================================================================
 * ALLOWLIST
 *
 * Classes that legitimately never appear in the compiled stylesheet. Keep
 * this list as short as the truth allows: most project-owned class names are
 * already handled automatically, either because they appear in the compiled
 * CSS (Astro `<style>` blocks and `src/styles/*.css` are bundled into it) or
 * because their prefix is not a Tailwind namespace.
 *
 * Every entry needs a reason. An entry without one is a bug being hidden.
 * ========================================================================== */
const ALLOWLIST = new Map([
  // Applied in markup, then queried and toggled from JavaScript
  // (`document.querySelectorAll('.gallery-item.hidden')` in GalleryGrid.astro).
  // It is a JS hook, never styled, so no rule is ever emitted for it. It sits
  // in a `gallery-*` namespace that Tailwind does not own, so it would be
  // skipped anyway — listed here so the intent is explicit rather than
  // accidental.
  ['gallery-item', 'JS-only hook, queried in GalleryGrid.astro; never styled'],
]);

/* ==========================================================================
 * Tailwind v4 utility namespaces.
 *
 * Purpose: catch a dead utility in a family that has NO live member in the
 * compiled CSS. `perspective-1000` is the motivating case — nothing else in
 * this project uses `perspective-*`, so the "does this family exist in the
 * output?" heuristic alone cannot see it.
 *
 * This list only ever ADDS detections. A prefix missing from it just means a
 * dead class in that family is caught only when a sibling utility in the same
 * family did compile. It never creates a false positive on its own, because a
 * class that compiled is checked for membership before we get here.
 * ========================================================================== */
const TAILWIND_NAMESPACES = new Set([
  // layout / box
  'aspect-',
  'columns-',
  'break-after-',
  'break-before-',
  'break-inside-',
  'box-decoration-',
  'object-',
  'overflow-',
  'overscroll-',
  'inset-',
  'start-',
  'end-',
  'top-',
  'right-',
  'bottom-',
  'left-',
  'z-',
  // flex / grid
  'basis-',
  'flex-',
  'grow-',
  'shrink-',
  'order-',
  'grid-cols-',
  'col-',
  'grid-rows-',
  'row-',
  'grid-flow-',
  'auto-cols-',
  'auto-rows-',
  'gap-',
  'gap-x-',
  'gap-y-',
  'justify-',
  'justify-items-',
  'justify-self-',
  'content-',
  'items-',
  'self-',
  'place-content-',
  'place-items-',
  'place-self-',
  // spacing / sizing
  'p-',
  'px-',
  'py-',
  'pt-',
  'pr-',
  'pb-',
  'pl-',
  'ps-',
  'pe-',
  'm-',
  'mx-',
  'my-',
  'mt-',
  'mr-',
  'mb-',
  'ml-',
  'ms-',
  'me-',
  'space-x-',
  'space-y-',
  'w-',
  'min-w-',
  'max-w-',
  'h-',
  'min-h-',
  'max-h-',
  'size-',
  // typography
  'font-',
  'text-',
  'antialiased-',
  'tracking-',
  'leading-',
  'list-',
  'decoration-',
  'underline-',
  'indent-',
  'align-',
  'whitespace-',
  'break-',
  'hyphens-',
  'line-clamp-',
  // backgrounds / borders / effects
  'bg-',
  'from-',
  'via-',
  'to-',
  'rounded-',
  'border-',
  'divide-',
  'outline-',
  'ring-',
  'ring-offset-',
  'shadow-',
  'inset-shadow-',
  'opacity-',
  'mix-blend-',
  'bg-blend-',
  'mask-',
  // filters
  'blur-',
  'brightness-',
  'contrast-',
  'drop-shadow-',
  'grayscale-',
  'hue-rotate-',
  'invert-',
  'saturate-',
  'sepia-',
  'backdrop-blur-',
  'backdrop-brightness-',
  'backdrop-contrast-',
  'backdrop-grayscale-',
  'backdrop-opacity-',
  'backdrop-saturate-',
  // tables
  'border-spacing-',
  'table-',
  'caption-',
  // transitions / animation
  'transition-',
  'duration-',
  'ease-',
  'delay-',
  'animate-',
  'will-change-',
  // transforms — `perspective-` is the one that motivated this list
  'scale-',
  'scale-x-',
  'scale-y-',
  'scale-z-',
  'rotate-',
  'rotate-x-',
  'rotate-y-',
  'rotate-z-',
  'translate-',
  'translate-x-',
  'translate-y-',
  'translate-z-',
  'skew-',
  'skew-x-',
  'skew-y-',
  'transform-',
  'origin-',
  'perspective-',
  'perspective-origin-',
  'backface-',
  // interactivity
  'accent-',
  'appearance-',
  'caret-',
  'cursor-',
  'field-sizing-',
  'pointer-events-',
  'resize-',
  'scroll-',
  'scroll-m-',
  'scroll-p-',
  'snap-',
  'touch-',
  'select-',
  // svg
  'fill-',
  'stroke-',
  // misc
  'sr-',
  'forced-color-',
  // first-party plugin namespaces. `prose-*` only exists when
  // @tailwindcss/typography is installed AND loaded with `@plugin`; without
  // it these compile to nothing, which is the same bug as font-700.
  'prose-',
]);

/**
 * Utility names with no `-` that must still be held to account.
 *
 * Deliberately tiny. A dash-less utility that is genuinely in use normally
 * shows up in the compiled CSS, so it never reaches this check — the only
 * reason to list a name here is that it can be dead *and* invisible.
 *
 * `group` and `peer` must NEVER go in here: they are marker classes that
 * legitimately emit no rule of their own, so listing them would produce
 * false positives.
 */
const TAILWIND_BARE_UTILITIES = new Set([
  // Same story as the `prose-` namespace above: no typography plugin, no CSS.
  'prose',
]);

/* ==========================================================================
 * Compiled-CSS side: harvest every class selector
 * ========================================================================== */

/**
 * A class selector in compiled CSS. The first character may not be an
 * unescaped digit, which is what keeps this from matching decimal values
 * such as the `.35s` in `transition: opacity .35s ease`.
 */
const CSS_CLASS_RE = new RegExp(
  '\\.(' +
    '(?:\\\\[0-9a-fA-F]{1,6} ?|\\\\[^\\n]|[A-Za-z_\\-\\u00A0-\\uFFFF])' +
    '(?:\\\\[0-9a-fA-F]{1,6} ?|\\\\[^\\n]|[A-Za-z0-9_\\-\\u00A0-\\uFFFF])*' +
    ')',
  'g',
);

/** Undo CSS ident escaping: `\:` -> `:`, `\/` -> `/`, `\32 x` -> `2x`. */
function unescapeCssIdent(ident) {
  return ident.replace(/\\([0-9a-fA-F]{1,6}) ?|\\([^\n])/g, (_, hex, ch) =>
    hex !== undefined ? String.fromCodePoint(parseInt(hex, 16)) : ch,
  );
}

function classSelectorsIn(css) {
  const out = new Set();
  for (const m of css.matchAll(CSS_CLASS_RE)) out.add(unescapeCssIdent(m[1]));
  return out;
}

function walk(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(entry)) out.push(full);
  }
  return out;
}

const rel = (p) =>
  p
    .slice(ROOT.length + 1)
    .split(sep)
    .join(posix.sep);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* ==========================================================================
 * Source side: a small JS-aware string scanner
 *
 * Regexes alone cannot tell `'a b'` inside a template literal from a nested
 * interpolation, so this walks characters instead. Interpolations are
 * replaced with \u0000 so any token touching one can be recognised as
 * dynamic and dropped.
 * ========================================================================== */

const DYN = '\u0000';

function skipQuoted(text, i) {
  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i += 1;
  }
  return i;
}

/** Index just past the `}` matching the `{` at openIdx, or -1. */
function matchBraces(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === '`') {
      i = readTemplate(text, i).end;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** Read a template literal at backtickIdx. Interpolations become \u0000. */
function readTemplate(text, backtickIdx) {
  let out = '';
  let i = backtickIdx + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      out += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (text[i] === '`') return { value: out, end: i + 1 };
    if (text[i] === '$' && text[i + 1] === '{') {
      const close = matchBraces(text, i + 1);
      out += DYN;
      i = close === -1 ? text.length : close;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return { value: out, end: i };
}

/**
 * Every string literal in a JS-ish region, with its span.
 * Comments are skipped. Regex literals are not modelled; a mis-parse there
 * yields junk strings, which the qualification rules below discard.
 */
function stringLiterals(code, baseOffset = 0) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close === -1 ? code.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipQuoted(code, i);
      out.push({ value: code.slice(i + 1, end - 1), index: baseOffset + i, from: i, to: end });
      i = end;
      continue;
    }
    if (ch === '`') {
      const t = readTemplate(code, i);
      out.push({ value: t.value, index: baseOffset + i, from: i, to: t.end });
      i = t.end;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Blank out every string literal, so a regex can inspect only real code. */
function maskStrings(code) {
  let masked = code;
  for (const lit of stringLiterals(code)) {
    masked = masked.slice(0, lit.from) + ' '.repeat(lit.to - lit.from) + masked.slice(lit.to);
  }
  return masked;
}

/** Split a class string into tokens, dropping anything dynamically composed. */
function staticTokens(value) {
  return value
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !t.includes(DYN));
}

/* ==========================================================================
 * Is this token something Tailwind was supposed to compile?
 * ========================================================================== */

/** Strip variants (`hover:`, `sm:`) respecting `[...]`, then a leading `-`. */
function baseUtility(token) {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    else if (ch === ':' && depth === 0) lastColon = i;
  }
  return token
    .slice(lastColon + 1)
    .replace(/^!/, '')
    .replace(/^-/, '');
}

/** `bg-primary/10` -> `bg-`, `flex` -> `flex`. */
function familyOf(token) {
  const base = baseUtility(token);
  const dash = base.indexOf('-');
  return dash === -1 ? base : base.slice(0, dash + 1);
}

/* ==========================================================================
 * Load the compiled stylesheet
 * ========================================================================== */

const distMissing = !existsSync(DIST);
const distCssFiles = distMissing ? [] : walk(join(DIST, '_astro'), (f) => f.endsWith('.css'));

let cssText = '';
for (const f of distCssFiles) cssText += `\n${readFileSync(f, 'utf8')}`;

// Astro can inline a small amount of CSS into the page `<style>` tags (view
// transitions, for one). Including it can only ever REMOVE a false positive,
// never add one, so it is folded in.
if (!distMissing) {
  for (const html of walk(DIST, (f) => f.endsWith('.html'))) {
    const source = readFileSync(html, 'utf8');
    for (const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) cssText += `\n${m[1]}`;
  }
}

const compiledClasses = classSelectorsIn(cssText);
const compiledFamilies = new Set([...compiledClasses].map(familyOf));

/* ==========================================================================
 * Harvest the project's own hand-written class names
 *
 * `src/styles/*.css` and every Astro `<style>` block. These end up in the
 * compiled CSS too, so this is a second line of defence for the case where a
 * stylesheet is split or scoped in a way that hides the selector.
 * ========================================================================== */

const astroFiles = walk(SRC, (f) => f.endsWith('.astro'));
const cssSourceFiles = walk(SRC, (f) => f.endsWith('.css'));
const scriptFiles = walk(SRC, (f) => /\.(ts|js|mjs|mts)$/.test(f) && !f.endsWith('.d.ts'));

const projectClasses = new Set();
for (const f of cssSourceFiles) {
  for (const c of classSelectorsIn(readFileSync(f, 'utf8'))) projectClasses.add(c);
}
for (const f of astroFiles) {
  const source = readFileSync(f, 'utf8');
  for (const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const c of classSelectorsIn(m[1])) projectClasses.add(c);
  }
}

/**
 * A token "qualifies" as a Tailwind utility we can hold to account.
 * Checked only after we already know it is not in the compiled CSS.
 */
function looksLikeTailwindUtility(token) {
  if (/[<>{}$\u0000]/.test(token)) return false;
  if (!/^-?[A-Za-z]/.test(token)) return false;
  const family = familyOf(token);
  return (
    compiledFamilies.has(family) ||
    TAILWIND_NAMESPACES.has(family) ||
    TAILWIND_BARE_UTILITIES.has(baseUtility(token))
  );
}

/** Present in the output, or owned by the project, or explicitly excused. */
function isAccountedFor(token) {
  return (
    compiledClasses.has(token) ||
    compiledClasses.has(baseUtility(token)) ||
    projectClasses.has(token) ||
    projectClasses.has(baseUtility(token)) ||
    ALLOWLIST.has(token) ||
    ALLOWLIST.has(baseUtility(token))
  );
}

/* ==========================================================================
 * Extract used classes
 * ========================================================================== */

/** class="..." / class='...' — unambiguous, so tokens are trusted one by one. */
function fromQuotedAttributes(source) {
  const found = [];
  for (const m of source.matchAll(/(?<![\w-])class\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[1] ?? m[2];
    for (const token of staticTokens(value)) found.push({ token, index: m.index });
  }
  return found;
}

/**
 * class={...} and class:list={...} — the expression is a class context, so
 * every string literal in it is a class list and tokens are trusted one by
 * one. Object keys (`{ hidden: cond }`) are class names too.
 */
function fromClassExpressions(source) {
  const found = [];
  for (const m of source.matchAll(/(?<![\w-])class(?::list)?\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBraces(source, open);
    if (close === -1) continue;
    const expr = source.slice(open + 1, close - 1);

    for (const lit of stringLiterals(expr, open + 1)) {
      for (const token of staticTokens(lit.value)) found.push({ token, index: lit.index });
    }
    // Object keys: `class:list={[..., { hidden: cond }]}`. Run against the
    // string-masked expression so a variant prefix inside a literal
    // ('sm:mb-5') is not mistaken for an object key.
    for (const k of maskStrings(expr).matchAll(/([A-Za-z_$][\w$-]*)\s*:/g)) {
      found.push({ token: k[1], index: open + 1 + k.index });
    }
  }
  return found;
}

/** classList.add/remove/toggle/replace('a', 'b') — also a class context. */
function fromClassList(source) {
  const found = [];
  const re = /classList\s*\.\s*(?:add|remove|toggle|replace)\s*\(([^)]*)\)/g;
  for (const m of source.matchAll(re)) {
    const argsAt = m.index + m[0].indexOf('(') + 1;
    for (const lit of stringLiterals(m[1], argsAt)) {
      for (const token of staticTokens(lit.value)) found.push({ token, index: lit.index });
    }
  }
  return found;
}

/**
 * Loose string literals in a JS region (Astro frontmatter, `<script>`, `.ts`).
 * Ambiguous, so the rule is all-or-nothing: the string is only read as a
 * class list when EVERY static token qualifies AND at least one of them is
 * genuinely present in the compiled CSS. That second condition is what stops
 * `getElementById('mobile-menu')` from being mistaken for a utility just
 * because `.mobile-nav-item` gave the `mobile-` family a foothold.
 */
function fromLooseStrings(code, baseOffset) {
  const found = [];
  for (const lit of stringLiterals(code, baseOffset)) {
    const tokens = staticTokens(lit.value);
    if (tokens.length === 0) continue;
    if (!tokens.every((t) => compiledClasses.has(t) || looksLikeTailwindUtility(t))) continue;
    if (!tokens.some((t) => compiledClasses.has(t))) continue;
    for (const token of tokens) found.push({ token, index: lit.index });
  }
  return found;
}

function splitAstro(source) {
  let frontmatter = '';
  let body = source;
  if (source.startsWith('---')) {
    const end = source.indexOf('\n---', 3);
    if (end !== -1) {
      frontmatter = source.slice(3, end);
      body = source.slice(end + 4);
    }
  }
  return { frontmatter, frontmatterOffset: 3, body, bodyOffset: source.length - body.length };
}

/** @returns {Array<{token: string, file: string, line: number}>} */
function collectUsedClasses() {
  const used = [];
  const push = (file, source, hits) => {
    for (const h of hits) used.push({ token: h.token, file, line: lineOf(source, h.index) });
  };

  for (const file of astroFiles) {
    const source = readFileSync(file, 'utf8');
    const { frontmatter, frontmatterOffset, body, bodyOffset } = splitAstro(source);

    // Markup: strip <style> (selectors, not usages) but KEEP <script>, whose
    // classList calls are handled below and whose offsets must stay valid.
    const markup = body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, (m) => ' '.repeat(m.length));

    push(file, source, shift(fromQuotedAttributes(markup), bodyOffset));
    push(file, source, shift(fromClassExpressions(markup), bodyOffset));
    push(file, source, shift(fromClassList(markup), bodyOffset));
    push(file, source, fromLooseStrings(frontmatter, frontmatterOffset));

    for (const m of body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      const at = bodyOffset + m.index + m[0].indexOf('>') + 1;
      push(file, source, fromLooseStrings(m[1], at));
    }
  }

  for (const file of scriptFiles) {
    const source = readFileSync(file, 'utf8');
    push(file, source, fromQuotedAttributes(source));
    push(file, source, fromClassList(source));
    push(file, source, fromLooseStrings(source, 0));
  }

  return used;
}

function shift(hits, offset) {
  return hits.map((h) => ({ ...h, index: h.index + offset }));
}

/* ==========================================================================
 * Tests
 * ========================================================================== */

test('the production build exists and is readable', () => {
  assert.ok(!distMissing, `dist/ does not exist. ${BUILD_HINT}`);
  assert.ok(distCssFiles.length > 0, `No stylesheet found under dist/_astro/*.css. ${BUILD_HINT}`);
  assert.ok(
    compiledClasses.size > 100,
    `Only ${compiledClasses.size} class selectors were found in the compiled CSS, ` +
      `which is too few to be a real build. ${BUILD_HINT}`,
  );
});

/**
 * A stale dist/ is the single biggest source of false positives: a utility
 * added to src/ after the last build has not been compiled yet, so it looks
 * dead when it is merely unbuilt. Detect that and SKIP the real check rather
 * than print a list nobody should act on.
 */
const staleSources = distMissing
  ? []
  : (() => {
      const newestCss = Math.max(...distCssFiles.map((f) => statSync(f).mtimeMs));
      return [...astroFiles, ...cssSourceFiles, ...scriptFiles, join(ROOT, 'astro.config.mjs')]
        .filter((f) => existsSync(f))
        .filter((f) => statSync(f).mtimeMs > newestCss);
    })();

test('the production build is not stale', { skip: distMissing ? BUILD_HINT : undefined }, () => {
  assert.equal(
    staleSources.length,
    0,
    `dist/ is older than ${staleSources.length} source file(s), so the compiled CSS no ` +
      'longer matches src/ and the dead-class check would report false positives:\n\n' +
      `${staleSources
        .slice(0, 10)
        .map((f) => `  ${rel(f)}`)
        .join('\n')}` +
      `${staleSources.length > 10 ? `\n  ...and ${staleSources.length - 10} more` : ''}\n\n` +
      `${BUILD_HINT}`,
  );
});

const deadClassSkip = distMissing
  ? BUILD_HINT
  : staleSources.length > 0
    ? `dist/ is stale (${staleSources.length} source file(s) newer than the compiled CSS). ${BUILD_HINT}`
    : undefined;

test(
  'every statically-resolvable utility class used in src/ compiles to CSS',
  { skip: deadClassSkip },
  () => {
    const used = collectUsedClasses();

    /** token -> Set<"path:line"> */
    const dead = new Map();
    const skipped = new Map();

    for (const { token, file, line } of used) {
      if (isAccountedFor(token)) continue;
      const bucket = looksLikeTailwindUtility(token) ? dead : skipped;
      if (!bucket.has(token)) bucket.set(token, new Set());
      bucket.get(token).add(`${rel(file)}:${line}`);
    }

    if (DEBUG) {
      const total = new Set(used.map((u) => u.token)).size;
      console.error(`\n[debug] ${used.length} usages, ${total} distinct tokens`);
      console.error(`[debug] ${compiledClasses.size} class selectors in compiled CSS`);
      console.error(
        `[debug] ${skipped.size} token(s) skipped as not-Tailwind-looking:\n` +
          [...skipped.keys()]
            .sort()
            .map((t) => `  ${t}`)
            .join('\n'),
      );
    }

    if (dead.size > 0) {
      const rows = [...dead.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([token, where]) => {
          const locations = [...where].sort();
          const shown = locations.slice(0, 6);
          const more = locations.length - shown.length;
          return (
            `  ${token}\n` +
            shown.map((l) => `      ${l}`).join('\n') +
            (more > 0 ? `\n      ...and ${more} more` : '')
          );
        })
        .join('\n\n');

      assert.fail(
        `${dead.size} class name(s) used in src/ emit no CSS. They look like Tailwind ` +
          'utilities but Tailwind did not generate a rule for them, which means they ' +
          'silently do nothing — exactly the failure mode of font-700 / font-600 / ' +
          'bg-body / perspective-1000.\n\n' +
          `${rows}\n\n` +
          'Each one is one of:\n' +
          '  - a typo or an invented utility          -> use the real utility ' +
          '(font-bold, not font-700)\n' +
          '  - a token that no longer exists in the @theme block of src/styles/global.css\n' +
          '  - a project-owned class name that needs a rule written for it, or an entry ' +
          'in ALLOWLIST at the top of tests/no-dead-classes.test.mjs with a reason.\n\n' +
          'If dist/ is out of date the report is meaningless — re-run `npm run build`.',
      );
    }
  },
);
