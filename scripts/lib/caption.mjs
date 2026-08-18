/**
 * Caption processing.
 *
 * Facebook captions are social copy, not web copy. A representative one:
 *
 *   "Serving redlicious energy all day 🍓✨ #FaithfullyCrafted
 *    #fypシ゚viralシfypシ゚ #strawberry #crochet"
 *
 * The previous build passed that string straight through to three places
 * where it does real damage:
 *   - `alt` text, so a screen reader announces the hashtag spam aloud
 *   - the visible card caption, where it truncates mid-hashtag
 *   - and it would become the <title> of a per-piece page
 *
 * So captions get split into purpose-built fields here: a short human
 * `title`, a descriptive emoji-free `alt`, and a readable `body`.
 */

/* Emoji, variation selectors and ZWJ.
   Alternation rather than one character class: ZWJ (200D) and the combining
   enclosing keycap (20E3) are combining marks, and grouping them alongside
   base characters in a single class is the misleading-character-class trap. */
const EMOJI = /\p{Extended_Pictographic}|\uFE0F|\uFE0E|\u200D|\u20E3/gu;

/** Hashtags, including the full-width and katakana characters Faith's tags use. */
const HASHTAG = /#[\p{L}\p{N}_぀-ヿ＀-￯]+/gu;

/**
 * Reach-farming tags carry no information about the piece, and the brand tag
 * is redundant on the brand's own site.
 */
const TAG_STOPLIST = new Set([
  'faithfullycrafted',
  'trendingpost',
  'foryou',
  'foryoupage',
  'explore',
  'explorepage',
  'reels',
  'reel',
]);

/**
 * Reach-farming tags mutate constantly, so an exact-match stoplist alone
 * leaks. "#fypシ゚viralシfypシ゚" strips its katakana down to "fypviralfyp",
 * which no fixed list would have caught. Match on substring instead.
 */
const TAG_STOP_PATTERN = /fyp|viral|trending|foryoupage|explorepage/;

/**
 * Call-to-action clauses. These are stripped from the point of the match to
 * the end of the line, rather than discarding the whole line, because Faith
 * routinely puts real description and a CTA in one breath:
 *
 *   "Purple stars available now 💜⭐ DM to get yours! 💌"
 *
 * Dropping that entire line lost the only description of the piece and sent
 * the title to the generic fallback. Keeping the prefix yields the correct
 * title, "Purple stars available now".
 *
 * Note "available now" and "shop now" are deliberately NOT here — they carry
 * stock information, they are not pure CTA.
 */
const CTA_CLAUSE =
  /\b(?:slide into (?:my|the) dms?|dm (?:me|us|to|for)\b|pm (?:me|us|to|for)\b|send (?:me )?a (?:dm|pm)|link in bio|order now|message me to|inquiries?\b|comment\s+["“]?mine)/i;

/** A line that is nothing BUT a call to action, once the clause is removed. */
function isSubstantive(line) {
  return line.replace(/[^\p{L}\p{N}]/gu, '').length > 1;
}

/** Remove a trailing CTA clause and anything after it. */
function stripCta(line) {
  const match = line.match(CTA_CLAUSE);
  if (!match) return line;
  return line.slice(0, match.index).trim();
}

export function stripEmoji(text) {
  return text.replace(EMOJI, '');
}

export function stripHashtags(text) {
  return text.replace(HASHTAG, '');
}

function collapse(text) {
  return text.replace(/[ \t\u00a0\u2007\u202f]+/g, ' ').trim();
}

/**
 * Meaningful hashtags, lowercased and de-duplicated, with the reach-farming
 * ones dropped. These become the searchable tags on the gallery.
 */
export function extractTags(caption) {
  const raw = caption.match(HASHTAG) || [];
  const seen = new Set();
  const tags = [];

  for (const token of raw) {
    // Strip the leading # and any decorative katakana suffix (the "シ゚" in
    // "#starseverywhereシ" is styling, not part of the word).
    const cleaned = token
      .slice(1)
      .replace(/[぀-ヿ＀-￯]+/g, '')
      .toLowerCase()
      .trim();

    if (cleaned.length < 3) continue;
    if (TAG_STOPLIST.has(cleaned)) continue;
    if (TAG_STOP_PATTERN.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;

    seen.add(cleaned);
    tags.push(cleaned);
  }

  return tags;
}

/**
 * A short human title. First real sentence, emoji and hashtags removed.
 * Used for card captions, the piece page <h1>, and the <title> tag.
 */
export function deriveTitle(caption, fallback = 'Handmade crochet piece') {
  const cleaned = collapse(stripEmoji(stripHashtags(caption || '')));
  if (!cleaned) return fallback;

  const lines = cleaned
    .split('\n')
    .map((l) => collapse(stripCta(collapse(l))))
    .filter((l) => l && isSubstantive(l));

  if (lines.length === 0) return fallback;

  // First sentence of the first substantive line.
  const sentence = lines[0].split(/(?<=[.!?])\s+/)[0] || lines[0];
  // Trim trailing sentence punctuation: a card caption and an <h1> read
  // better without it, and it avoids the ". —" collision in alt text.
  let title = collapse(sentence)
    .replace(/[\s—–-]+$/, '')
    .replace(/[.。]+$/, '');

  // A title should be a phrase, not a paragraph.
  if (title.length > 72) {
    const cut = title.slice(0, 72);
    const lastSpace = cut.lastIndexOf(' ');
    title = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '') + '…';
  }

  // If stripping left only punctuation or a stray word, fall back.
  if (title.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return fallback;

  return title;
}

/**
 * Alt text. Describes the image for someone who cannot see it, which the
 * raw caption never did. Deliberately emoji-free and hashtag-free.
 */
export function deriveAlt(title, categoryLabel, fallback = 'Handmade crochet piece by Faith') {
  const clean = collapse(stripEmoji(title || ''));
  if (!clean || clean === 'Handmade crochet piece') {
    return categoryLabel ? `Handmade crochet ${categoryLabel.toLowerCase()} by Faith` : fallback;
  }
  // Alt should say what the thing IS, so anchor the caption in the craft.
  const suffix = categoryLabel
    ? `handmade crochet ${categoryLabel.toLowerCase()}`
    : 'handmade crochet';
  return `${clean.replace(/…$/, '')} — ${suffix} by Faith`;
}

/**
 * Readable body copy for the piece page. Keeps Faith's actual sentences,
 * drops the trailing hashtag block and pure-CTA lines, keeps emoji because
 * on the page body they are part of her voice.
 */
export function deriveBody(caption) {
  if (!caption) return '';

  return caption
    .split('\n')
    .map((line) => collapse(stripCta(collapse(stripHashtags(line)))))
    .filter((line) => line && isSubstantive(line))
    .join('\n')
    .trim();
}

/** URL-safe slug fragment from a title. */
export function slugify(text) {
  return stripEmoji(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
