# tests

Two regression gates, written against Node's built-in test runner. No test
framework, no extra dependencies — only `node:test`, `node:assert/strict`,
`node:fs` and `node:path`.

Both tests exist because of bugs that reached production and that nothing in
the toolchain complained about.

## Running

```sh
npm run build                      # required: no-dead-classes.test.mjs reads dist/
node --test "tests/**/*.test.mjs"  # both gates
```

Individually:

```sh
node --test tests/contrast.test.mjs
node --test tests/no-dead-classes.test.mjs

# see which source tokens were extracted and which were skipped as
# not-Tailwind-looking (useful when tuning the extractor)
DEBUG_DEAD_CLASSES=1 node --test tests/no-dead-classes.test.mjs
```

`contrast.test.mjs` needs no build. `no-dead-classes.test.mjs` compares source
against the compiled stylesheet, so it needs `dist/` and refuses to run
against a stale one.

---

## `contrast.test.mjs` — WCAG contrast gate

### The bugs it guards

1. `a:hover { color: var(--color-lavender) }` rendered link labels at
   **1.92:1** against the page background. Links became nearly invisible on
   hover, and only on hover, so it survived every static review.
2. The brand accent `#e8669a` was used for body-size type. It is **3.09:1** on
   white and **2.65:1** on the cream surface — it fails the 4.5:1 body-text
   bar and also fails the 3:1 large-text/UI bar. There is no size at which it
   was legible enough.

### What it asserts

- Every token with role `text` clears **4.5:1** against **every** surface it
  is permitted to sit on. There is no `large-text-only` tier: the rule is
  binary, which is both stronger and easier to keep honest.
- `#ffffff` clears 4.5:1 on `--color-rose-text`, because that is the primary
  button's label sitting on its own fill.
- Every token with role `non-text` is **exempt from contrast maths** but is
  asserted to never appear in a text context anywhere in `src/`. The exemption
  has to be paid for: a colour that is allowed to be illegible must be
  prevented from ever being read.

### How it reads the palette

The palette is parsed out of the `@theme { ... }` block in
`src/styles/global.css` at runtime. Nothing is hardcoded, so the test measures
the colours the site actually ships. Tailwind v4 has no `tailwind.config.js` in
this project; `@theme` is the token layer.

Declarations whose adjacent comment contains `DEPRECATED` are ignored. That
covers both forms:

```css
--color-text: #4a3347; /* DEPRECATED -> --color-ink-body */

/* ==== DEPRECATED ALIASES ==== */
--color-background: #fff5f7;
--color-primary: #f9d2de;
```

A trailing comment on the same line wins; otherwise the nearest preceding
comment applies, until the next comment. Migration scaffolding therefore does
not have to satisfy the table.

`var(--color-x)` indirection is resolved, so an alias measures as its target.

### Failure modes, and what they mean

| Failing test                                           | Meaning                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `every token in the contrast table is declared`        | The table expects a token that `@theme` does not define, or defines but marks DEPRECATED. The message names exactly which. The contrast assertions are **skipped** in this state rather than crashing. |
| `every declared token has a contrast-measurable value` | A token's value is not an opaque hex. Contrast is undefined for a colour with alpha.                                                                                                                   |
| `text tokens meet WCAG AA…`                            | Prints a table of token, surface, hex pair, actual ratio to 2 dp, and required ratio. Fixable from the output alone.                                                                                   |
| `literal foreground pairs meet WCAG AA`                | White-on-fill, currently just the primary button.                                                                                                                                                      |
| `non-text tokens are never used as a text colour`      | Names the file, the line, the offending utility, and why that token is barred.                                                                                                                         |

### Extending the table when you add a colour token

Everything is driven by the `TOKENS` object at the top of the file. Add one
entry; nothing else changes.

```js
// A background that text may sit on. NOTE: adding a surface immediately
// tightens every text token, because text is asserted against ALL_SURFACES.
'--color-panel': { role: 'surface' },

// A foreground used on type.
'--color-ink-quiet': { role: 'text', on: ALL_SURFACES, min: 4.5 },

// Decoration or structure. Exempt from contrast, banned from text.
// `why` is printed verbatim to whoever trips the ban, so write it for them.
'--color-decor-sky': {
  role: 'non-text',
  why: 'Decoration at low opacity only. As type it is 1.7:1. Use --color-ink-muted.',
},
```

Rules of thumb:

- **Do not lower `min`.** If a colour cannot reach 4.5:1, darken the colour or
  reclassify it as `non-text`. `min` exists so a future large-text-only tier
  can be added deliberately, not as an escape hatch.
- If a text token genuinely never appears on a given surface, shorten its `on`
  list rather than weakening `min` — and say why in a comment.
- A new `non-text` token is automatically added to the usage ban. The banned
  utility name is derived from the token name (`--color-decor-sky` →
  `text-decor-sky`), so there is no second list to keep in sync.
- Adding an entry to `EXTRA_PAIRS` covers a foreground that is a literal
  rather than a token (white text on a coloured fill, for instance).

### What the usage ban does and does not match

The rule being enforced is: **decoration sets `fill-*` or `stroke-*`; it never
sets `text-*`.**

|        |                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fails  | `text-decor-mint`, `text-decor-mint/30`, `hover:text-decor-gold`, `md:group-hover:text-rose-tint`                                                       |
| Fails  | `color: var(--color-decor-lavender)` in a `.css` file or an Astro `<style>` block                                                                       |
| Passes | `fill-decor-mint`, `fill-decor-mint/30`, `stroke-rose-brand`, `bg-decor-gold`, `border-rose-tint`                                                       |
| Passes | `fill: var(--color-decor-mint)`, `stroke: var(--color-rose-brand)`, `background-color: var(--color-decor-gold)`, `border-color: var(--color-rose-tint)` |

Decorative SVGs colouring themselves through `currentColor` are the reason the
ban is on `text-*` specifically and not on the tokens in general.

---

## `no-dead-classes.test.mjs` — dead-utility gate

### The bugs it guards

Four class names in the markup were not real Tailwind v4 utilities, so each
compiled to **zero CSS** and silently did nothing:

| Used               | Reality                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `font-700`         | Tailwind has `font-bold`. `font-700` does not exist.                    |
| `font-600`         | Meant to make link labels semibold. It never did.                       |
| `bg-body`          | There is no `body` colour token.                                        |
| `perspective-1000` | Tailwind v4 spells this `perspective-distant` / `perspective-[1000px]`. |

`font-700` sat on the FAQ `<dt>` elements, so the questions rendered
identically to their answers. Nothing errored. Nothing warned. The class is
present on the element in devtools; it simply has no rule behind it. This is
the most invisible failure mode in a utility-CSS codebase.

### How it works

1. Harvest every class selector present in `dist/_astro/*.css` (plus any
   inline `<style>` in the built HTML), unescaping CSS ident escapes so
   `.sm\:text-4xl` reads back as `sm:text-4xl` and `.bg-primary\/10` as
   `bg-primary/10`.
2. Harvest every statically-resolvable class token used in `src/**/*.astro`
   and `src/**/*.{ts,js,mjs}`.
3. Anything used but not compiled, that looks like a Tailwind utility, fails.

### Precision over recall, deliberately

A test that cries wolf gets deleted, and then the bug class comes back. So
every ambiguous case is skipped rather than reported:

- **Dynamic composition is dropped.** `class={base}` is unresolvable. In a
  template literal, each `${...}` becomes a sentinel and any token touching it
  is discarded, so `` `text-${size}` `` never reports the utility `text-`.
- **Class contexts are trusted token by token.** `class="…"`,
  `class={…}`, `class:list={[…]}` (including its object keys) and
  `classList.add(…)` are unambiguous, so a single bad token in them is
  reported.
- **Loose string literals are all-or-nothing.** In Astro frontmatter, in
  `<script>` blocks and in `.ts` files, a string is only read as a class list
  when _every_ static token qualifies **and** at least one is genuinely
  present in the compiled CSS. That second condition is what stops
  `getElementById('mobile-menu')` being mistaken for a utility. It is also
  what lets `Button.astro`'s `variants` map be checked even though the markup
  only ever sees `class={base}`.
- **"Looks like Tailwind" is mostly self-calibrating.** A token is held to
  account if its family prefix (`bg-`, `font-`, `text-`…) appears anywhere in
  the compiled CSS. `gallery-item` is skipped automatically, because nothing
  in the output claims a `gallery-` prefix. A curated
  `TAILWIND_NAMESPACES` list backs this up for families with no live member in
  the output at all — `perspective-1000` is the case that requires it.
- **A stale `dist/` skips the check.** A utility added after the last build
  has not been compiled yet, so it would look dead when it is merely unbuilt.
  Source mtimes are compared against the compiled stylesheet and the check is
  skipped, with an instruction to rebuild, rather than printing a list nobody
  should act on.

### The allowlist

`ALLOWLIST` at the top of the file. It is a `Map` from class name to reason,
and it is intended to stay nearly empty, because most project-owned names are
handled automatically:

- Classes written in `src/styles/*.css` or in an Astro `<style>` block end up
  in the compiled stylesheet, so they are found there. `nav-island`,
  `nav-brand`, `hamburger-bar`, `mobile-nav-item`, `menu-open`,
  `skeleton-shimmer`, `revealed`, `shimmer-gold`, `scrollbar-hide`,
  `touch-only`, `mouse-only` and the `animate-*` family all need no entry.
  They are also harvested a second time directly from source, as a fallback
  for a stylesheet that gets split or scoped in a way that hides the selector.
- Names in a namespace Tailwind does not own are skipped by the
  "looks like Tailwind" rule.

Only add an entry when a class genuinely can never appear in the stylesheet —
in practice, a JavaScript-only hook. Give a reason. An entry without one is a
bug being hidden.

### When it fails

The message groups by class name and lists `path:line` for each use. Each
finding is one of:

- a typo or an invented utility — use the real one;
- a reference to a design token that no longer exists in `@theme`;
- a project-owned class that needs a rule written for it, or an `ALLOWLIST`
  entry with a reason.

If `dist/` is out of date, rebuild before believing any of it — though the
staleness gate should have skipped the check in that case.
