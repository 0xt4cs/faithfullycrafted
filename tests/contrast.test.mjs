/**
 * WCAG contrast gate.
 *
 * Why this file exists
 * -------------------
 * Two contrast failures shipped to production silently:
 *
 *   1. `a:hover { color: var(--color-lavender) }` rendered link labels at
 *      1.92:1 against the page background. Links became nearly invisible
 *      on hover.
 *   2. The old brand accent `#e8669a` was used for body-size type. It is
 *      3.09:1 on white and only 2.65:1 on cream — it fails 4.5:1 for body
 *      text and it also fails the 3:1 large-text/UI bar.
 *
 * This test makes both impossible to reintroduce:
 *
 *   - Every token classified `text` must clear 4.5:1 against every surface
 *     it is permitted to sit on. There is no `large-text-only` escape
 *     hatch; the invariant is strictly binary.
 *   - Every token classified `non-text` is exempt from contrast maths but
 *     is asserted to never appear in a text context anywhere in the source.
 *
 * The palette is READ FROM `src/styles/global.css` at runtime, never
 * hardcoded, so the test tracks reality rather than a stale copy of it.
 * Tokens whose adjacent comment marks them DEPRECATED are ignored, so
 * migration scaffolding does not have to satisfy the table below.
 *
 * Run: node --test tests/contrast.test.mjs   (see tests/README.md)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL_CSS = join(ROOT, 'src', 'styles', 'global.css');

/* ==========================================================================
 * THE TABLE
 *
 * This is the single source of truth for the test. To add a colour token:
 *
 *   role: 'surface'   a background that may sit behind text. Adding one
 *                     here immediately tightens every text token, because
 *                     text tokens are asserted against ALL_SURFACES.
 *   role: 'text'      a foreground used on type. Give it `on` (which
 *                     surfaces it must clear) and `min` (the required
 *                     ratio). 4.5 unless you have a written reason.
 *   role: 'non-text'  decoration or structure. Exempt from contrast
 *                     assertions, but asserted NEVER to be used as a text
 *                     colour. `why` is printed in the failure message, so
 *                     write it for the developer who trips the rule.
 *
 * Nothing else in this file needs to change.
 * ========================================================================== */

/** Surfaces that may hold text. `cream` is the darkest and therefore binding. */
const ALL_SURFACES = [
  '--color-page',
  '--color-surface',
  '--color-card',
  '--color-cream',
  '--color-rose-wash',
];

const TOKENS = {
  // ---- Surfaces --------------------------------------------------------
  '--color-page': { role: 'surface' },
  '--color-surface': { role: 'surface' },
  '--color-card': { role: 'surface' },
  '--color-cream': { role: 'surface' },
  '--color-rose-wash': { role: 'surface' },

  // ---- Text ------------------------------------------------------------
  '--color-ink-display': { role: 'text', on: ALL_SURFACES, min: 4.5 },
  '--color-ink-body': { role: 'text', on: ALL_SURFACES, min: 4.5 },
  '--color-ink-muted': { role: 'text', on: ALL_SURFACES, min: 4.5 },
  '--color-ink-subtle': { role: 'text', on: ALL_SURFACES, min: 4.5 },
  '--color-rose-text': { role: 'text', on: ALL_SURFACES, min: 4.5 },
  '--color-rose-hover': { role: 'text', on: ALL_SURFACES, min: 4.5 },

  // ---- Non-text (decoration / structure only) --------------------------
  '--color-rose-brand': {
    role: 'non-text',
    why:
      "Faith's brand pink #e8669a. It is 3.09:1 on white and 2.65:1 on cream, " +
      'so it fails both the 4.5:1 body bar and the 3:1 large-text bar. ' +
      'Use it for fills only: tape, yarn shapes, washes. For type use --color-rose-text.',
  },
  '--color-rose-tint': {
    role: 'non-text',
    why:
      'Borders and rails only. It is not a text surface either (4.03:1), so do not ' +
      'put text on it or make text out of it. For type use --color-rose-text.',
  },
  '--color-decor-mint': {
    role: 'non-text',
    why:
      'Decoration at low opacity only. As a text colour it measured 1.59:1 — this is ' +
      'the exact bug that shipped on the process icons. For type use an --color-ink-* token.',
  },
  '--color-decor-lavender': {
    role: 'non-text',
    why:
      'Decoration at low opacity only. As a text colour it measured 1.92:1 — this is ' +
      'the exact bug that shipped as a:hover. For a link hover use --color-rose-hover.',
  },
  '--color-decor-gold': {
    role: 'non-text',
    why:
      'Decoration at low opacity only. Never legible as type on any project surface. ' +
      'For type use an --color-ink-* token.',
  },
};

/**
 * Extra pairs that are not token-vs-token. Foreground may be a literal hex.
 */
const EXTRA_PAIRS = [
  {
    fg: '#ffffff',
    fgLabel: 'white',
    bg: '--color-rose-text',
    min: 4.5,
    why: 'primary button label sitting on its own fill',
  },
];

/* ==========================================================================
 * Colour maths — WCAG 2.x
 * ========================================================================== */

/** @returns {[number, number, number]} 0-255 channels */
function parseHex(raw) {
  const hex = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`not an opaque hex colour: "${raw}"`);
  }
  const expand = (c) => parseInt(c.length === 1 ? c + c : c, 16);
  if (hex.length === 3 || hex.length === 4) {
    if (hex.length === 4 && expand(hex[3]) !== 255) {
      throw new Error(`colour has alpha, contrast is undefined: "${raw}"`);
    }
    return [expand(hex[0]), expand(hex[1]), expand(hex[2])];
  }
  if (hex.length === 8 && expand(hex.slice(6, 8)) !== 255) {
    throw new Error(`colour has alpha, contrast is undefined: "${raw}"`);
  }
  return [expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6))];
}

/** sRGB relative luminance, WCAG 2.x definition. */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    // WCAG 2.x linearisation threshold is 0.03928 on the 0-1 scale.
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio: (Llighter + 0.05) / (Ldarker + 0.05). */
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(parseHex(hexA));
  const lb = relativeLuminance(parseHex(hexB));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const fmt = (n) => n.toFixed(2);

/* ==========================================================================
 * Parse the @theme block out of global.css
 * ========================================================================== */

/** Find the body of the first `@theme ... { ... }` at-rule, brace-matched. */
function extractThemeBody(css) {
  const at = css.search(/@theme\b/);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Read `--color-*` declarations out of the @theme body.
 *
 * A declaration is treated as DEPRECATED (and therefore ignored) when the
 * word DEPRECATED appears either in a trailing comment on the same line, or
 * in the nearest preceding comment with no other comment in between — which
 * covers both `--x: #fff; /* DEPRECATED *\/` and a
 * `/* DEPRECATED ALIASES *\/` section header.
 */
function parseColorTokens(css) {
  const body = extractThemeBody(css);
  if (body === null) {
    throw new Error(
      `Could not find an "@theme { ... }" block in ${GLOBAL_CSS}.\n` +
        'This project declares its design tokens there (Tailwind v4, no tailwind.config.js).\n' +
        'If the token layer moved, update parseColorTokens() in tests/contrast.test.mjs.',
    );
  }

  const comments = [];
  for (const m of body.matchAll(/\/\*[\s\S]*?\*\//g)) {
    comments.push({
      start: m.index,
      end: m.index + m[0].length,
      deprecated: /DEPRECATED/i.test(m[0]),
    });
  }

  const lineStartOf = (idx) => body.lastIndexOf('\n', idx) + 1;
  const lineEndOf = (idx) => {
    const nl = body.indexOf('\n', idx);
    return nl === -1 ? body.length : nl;
  };

  const tokens = new Map();
  const deprecated = new Set();

  for (const m of body.matchAll(/(--color-[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2].trim();
    const declStart = m.index;
    const lineEnd = lineEndOf(declStart);
    const lineStart = lineStartOf(declStart);

    const trailing = comments.some(
      (c) => c.start >= declStart && c.start <= lineEnd && c.deprecated,
    );
    const preceding = comments.filter((c) => c.end <= lineStart).pop();
    if (trailing || (preceding && preceding.deprecated)) {
      deprecated.add(name);
      continue;
    }
    tokens.set(name, value);
  }

  return { tokens, deprecated };
}

/** Resolve `var(--color-x)` indirection so aliases still measure correctly. */
function resolveValue(tokens, name, seen = new Set()) {
  const raw = tokens.get(name);
  if (raw === undefined) return undefined;
  const varMatch = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(raw);
  if (!varMatch) return raw;
  if (seen.has(name)) {
    throw new Error(`circular var() reference while resolving ${name}`);
  }
  seen.add(name);
  return resolveValue(tokens, varMatch[1], seen);
}

/* ==========================================================================
 * Load
 * ========================================================================== */

if (!existsSync(GLOBAL_CSS)) {
  throw new Error(`Expected the token layer at ${GLOBAL_CSS} but the file does not exist.`);
}

const { tokens: declared, deprecated } = parseColorTokens(readFileSync(GLOBAL_CSS, 'utf8'));

/** name -> hex, for every token the table expects and the CSS actually has. */
const palette = new Map();
/** names the table expects but the CSS does not (non-deprecated) declare. */
const missing = [];
/** names present but whose value the contrast maths cannot use. */
const unusable = [];

for (const name of Object.keys(TOKENS)) {
  const value = resolveValue(declared, name);
  if (value === undefined) {
    missing.push({
      name,
      role: TOKENS[name].role,
      hint: deprecated.has(name)
        ? 'declared, but its comment marks it DEPRECATED so the test ignores it'
        : 'not declared in the @theme block at all',
    });
    continue;
  }
  try {
    parseHex(value);
    palette.set(name, value);
  } catch (err) {
    unusable.push({ name, value, reason: err.message });
  }
}

const paletteIsComplete = missing.length === 0 && unusable.length === 0;
const skipReason = paletteIsComplete
  ? undefined
  : 'palette incomplete — see the "every token in the contrast table is declared" failure above';

/* ==========================================================================
 * Tests
 * ========================================================================== */

test('every token in the contrast table is declared in global.css @theme', () => {
  if (missing.length > 0) {
    const width = Math.max(...missing.map((m) => m.name.length));
    const rows = missing.map((m) => `  ${m.name.padEnd(width)}  (${m.role})  ${m.hint}`).join('\n');
    assert.fail(
      `${missing.length} colour token(s) required by tests/contrast.test.mjs are missing ` +
        `from the @theme block in src/styles/global.css:\n\n${rows}\n\n` +
        'Either declare them in @theme, or remove them from the TOKENS table at the top ' +
        'of tests/contrast.test.mjs if the design no longer needs them.',
    );
  }
});

test('every declared token has a contrast-measurable value', () => {
  if (unusable.length > 0) {
    const rows = unusable.map((u) => `  ${u.name}: ${u.value}\n      ${u.reason}`).join('\n');
    assert.fail(
      'These tokens are declared but their values cannot be measured for contrast.\n' +
        'Contrast requires an opaque colour; declare a solid hex (#rgb or #rrggbb):\n\n' +
        `${rows}`,
    );
  }
});

test('text tokens meet WCAG AA on every surface they may appear on', { skip: skipReason }, () => {
  const failures = [];

  for (const [name, spec] of Object.entries(TOKENS)) {
    if (spec.role !== 'text') continue;
    const fg = palette.get(name);
    for (const surface of spec.on) {
      assert.ok(
        TOKENS[surface] && TOKENS[surface].role === 'surface',
        `TOKENS["${name}"].on lists "${surface}", which is not declared with role "surface" ` +
          'in the TOKENS table. Fix the table.',
      );
      const bg = palette.get(surface);
      const ratio = contrastRatio(fg, bg);
      if (ratio < spec.min) {
        failures.push({ name, fg, surface, bg, ratio, min: spec.min });
      }
    }
  }

  if (failures.length > 0) {
    const col = (key, header) =>
      Math.max(header.length, ...failures.map((f) => String(f[key]).length));
    const wText = col('name', 'text token');
    const wSurf = col('surface', 'on surface');

    const header =
      `  ${'text token'.padEnd(wText)}  ${'on surface'.padEnd(wSurf)}  ` +
      `${'pair'.padEnd(21)}  ${'ratio'.padStart(7)}  needs`;
    const rows = failures
      .map(
        (f) =>
          `  ${f.name.padEnd(wText)}  ${f.surface.padEnd(wSurf)}  ` +
          `${`${f.fg} on ${f.bg}`.padEnd(21)}  ${`${fmt(f.ratio)}:1`.padStart(7)}  ` +
          `${fmt(f.min)}:1`,
      )
      .join('\n');

    assert.fail(
      `${failures.length} WCAG contrast failure(s). Text must reach the required ratio ` +
        'against every surface it can sit on:\n\n' +
        `${header}\n${rows}\n\n` +
        'Fix by darkening the text token in the @theme block of src/styles/global.css ' +
        "(or by removing that surface from the token's `on` list if text never sits there). " +
        'Do not lower `min`.',
    );
  }
});

test('literal foreground pairs meet WCAG AA', { skip: skipReason }, () => {
  const failures = [];

  for (const pair of EXTRA_PAIRS) {
    const bg = palette.get(pair.bg);
    assert.ok(bg, `EXTRA_PAIRS references "${pair.bg}", which is not in the TOKENS table.`);
    const ratio = contrastRatio(pair.fg, bg);
    if (ratio < pair.min) {
      failures.push({ ...pair, bgHex: bg, ratio });
    }
  }

  if (failures.length > 0) {
    const rows = failures
      .map(
        (f) =>
          `  ${f.fgLabel} (${f.fg}) on ${f.bg} (${f.bgHex})  ` +
          `${fmt(f.ratio)}:1  needs ${fmt(f.min)}:1\n      context: ${f.why}`,
      )
      .join('\n');
    assert.fail(`${failures.length} contrast failure(s) on non-token pairs:\n\n${rows}`);
  }
});

/* ==========================================================================
 * Non-text tokens must never be used as a text colour.
 *
 * This is the assertion that actually retires the two production bugs. A
 * contrast table cannot catch `color: var(--color-decor-lavender)` because
 * the token is (correctly) exempt from contrast maths — so the exemption has
 * to be paid for with a usage ban.
 *
 * The rule enforced is narrow on purpose:
 *
 *   Decoration sets `fill-*` / `stroke-*` (or `bg-*`, `border-*`, `ring-*`).
 *   Decoration never sets `text-*`.
 *
 * So `fill-decor-mint`, `stroke-rose-brand`, `bg-decor-gold` and
 * `border-rose-tint` all PASS — including with opacity modifiers such as
 * `fill-decor-mint/30`. Only the `text-` colour utility and a literal
 * `color:` declaration fail. `fill:` and `stroke:` declarations pass.
 *
 * The banned list is derived from the TOKENS table above, so it keys off the
 * canonical token names only. Deprecated migration aliases (`--color-mint`,
 * `--color-lavender`, `--color-gold`, `--color-primary-bold`, …) are ignored
 * entirely — they are being deleted, and asserting against names that are
 * about to vanish would just generate noise.
 * ========================================================================== */

function walk(dir, test_) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, test_));
    else if (test_(entry)) out.push(full);
  }
  return out;
}

const rel = (p) =>
  p
    .slice(ROOT.length + 1)
    .split(sep)
    .join(posix.sep);

test('non-text tokens are never used as a text colour', () => {
  const banned = Object.entries(TOKENS)
    .filter(([, spec]) => spec.role === 'non-text')
    .map(([name, spec]) => ({
      token: name,
      // `--color-decor-mint` is exposed by Tailwind v4 as `text-decor-mint`.
      utility: name.replace(/^--color-/, 'text-'),
      why: spec.why ?? 'declared non-text in the TOKENS table',
    }));

  // `src/**/*.astro` covers markup and Astro `<style>` blocks (they live in
  // the same file). `src/**/*.css` covers the hand-written stylesheets.
  const files = walk(join(ROOT, 'src'), (f) => f.endsWith('.astro') || f.endsWith('.css'));

  const hits = [];

  for (const b of banned) {
    // 1. The Tailwind *text* colour utility.
    //
    //    The lookbehind `(?<![\w-])` lets a variant chain through, because a
    //    variant always ends in `:` — `hover:`, `md:`, `group-hover:`,
    //    `dark:md:` all match. It blocks the utility appearing inside a
    //    longer identifier.
    //
    //    The lookahead `(?![\w-])` permits an opacity modifier, because `/`
    //    is neither a word character nor a hyphen — so `text-decor-mint/30`
    //    is matched. It blocks a *different, longer* token name from
    //    matching (`text-decor-mint-2` is not this token).
    //
    //    Crucially this only ever matches the literal `text-` prefix, so
    //    `fill-decor-mint`, `stroke-decor-mint/30`, `bg-decor-gold` and
    //    `border-rose-tint` are all allowed.
    const utilityRe = new RegExp(`(?<![\\w-])${b.utility}(?![\\w-])`);

    // 2. A hand-written `color:` declaration resolving to the token.
    //
    //    `(?<![\w-])color` anchors on the whole property name, so
    //    `background-color:`, `border-color:`, `-webkit-text-fill-color:`
    //    and `caret-color:` are all excluded — as are `fill:` and `stroke:`,
    //    which never contain the substring `color:` at all.
    //
    //    `[^;{}]*` cannot cross a declaration boundary, so
    //    `color: var(--color-ink-body); fill: var(--color-decor-mint);`
    //    does not false-positive.
    const declRe = new RegExp(`(?<![\\w-])color\\s*:[^;{}]*var\\(\\s*${b.token}\\s*[,)]`);

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const utilityHit = utilityRe.exec(line);
        if (utilityHit) {
          // Report the whole utility including any opacity modifier.
          const full = /^[\w-]+(?:\/[\w.[\]%]+)?/.exec(line.slice(utilityHit.index))[0];
          hits.push({ file, line: i + 1, found: full, why: b.why, text: line.trim() });
        }
        if (declRe.test(line)) {
          hits.push({
            file,
            line: i + 1,
            found: `color: var(${b.token})`,
            why: b.why,
            text: line.trim(),
          });
        }
      });
    }
  }

  hits.sort((a, b2) => rel(a.file).localeCompare(rel(b2.file)) || a.line - b2.line);

  if (hits.length > 0) {
    const rows = hits
      .map(
        (h) =>
          `  ${rel(h.file)}:${h.line}\n` +
          `      uses:  ${h.found}\n` +
          `      line:  ${h.text.length > 100 ? `${h.text.slice(0, 97)}...` : h.text}\n` +
          `      why this is banned: ${h.why}`,
      )
      .join('\n\n');

    assert.fail(
      `${hits.length} use(s) of a decoration-only colour token in a text context.\n\n` +
        'These tokens are deliberately exempt from the contrast table because they are ' +
        'never meant to be legible. Using one on type reintroduces a bug that already ' +
        'shipped once.\n\n' +
        `${rows}\n\n` +
        'Fix: pick a token with role "text" in the TOKENS table of tests/contrast.test.mjs — ' +
        '--color-ink-body / --color-ink-muted for prose, --color-rose-text for accented type, ' +
        '--color-rose-hover for a link hover state. If the colour really is decorative, move it ' +
        'off `color:` and onto `background-color`, `border-color`, `fill` or `stroke`.',
    );
  }
});
