/**
 * Category derivation.
 *
 * These categories were not invented — they were read out of the actual
 * caption corpus. Counting hashtags and product nouns across all 291 posts
 * gave: keychain/keychains/customkeychains (31 hits), stars (a recurring
 * series), flower/flowers/sunflower/sunflowers (14), named characters
 * (capybara, Stitch, Baby Yoda, Squid Game, Star Wars), personalized minis
 * and dolls, and an aviation line for cabin crew (#pal, #cabincrew,
 * #pnumanila). So the taxonomy reflects what Faith actually sells.
 *
 * Scoring is additive rather than first-match: a caption reading "flower
 * keychain" hits both, and the higher-weighted, more specific signal wins.
 * `other` is the honest fallback rather than forcing a bad label.
 */

/**
 * weight 3 = names the product form (what it IS)
 * weight 2 = names the subject (what it DEPICTS)
 * weight 1 = a weak or incidental hint
 */
export const CATEGORIES = [
  {
    id: 'keychains',
    label: 'Keychains',
    blurb: 'Clip-on pieces for bags and keys.',
    keywords: [
      ['keychain', 3],
      ['keychains', 3],
      ['customkeychains', 3],
      ['keyring', 3],
      ['bagcharm', 3],
      ['charm', 1],
    ],
  },
  {
    id: 'flowers',
    label: 'Flowers',
    blurb: 'Blooms and bouquets that never wilt.',
    keywords: [
      ['bouquet', 3],
      ['flower', 2],
      ['flowers', 2],
      ['sunflower', 2],
      ['sunflowers', 2],
      ['tulip', 2],
      ['rose', 2],
      ['daisy', 2],
      ['bloom', 1],
      ['petal', 1],
    ],
  },
  {
    id: 'stars',
    label: 'Stars',
    blurb: 'The star series, in every colour.',
    keywords: [
      ['starseverywhere', 3],
      ['star', 2],
      ['stars', 2],
      ['twinkling', 1],
      ['constellation', 1],
    ],
  },
  {
    id: 'characters',
    label: 'Characters',
    blurb: 'Amigurumi of favourite faces.',
    keywords: [
      ['amigurumi', 3],
      ['capybara', 2],
      ['yoda', 2],
      ['starwars', 2],
      ['squidgame', 2],
      ['stitch', 2],
      ['pokemon', 2],
      ['sanrio', 2],
      ['hellokitty', 2],
      ['bear', 2],
      ['bee', 2],
      ['bunny', 2],
      ['cat', 2],
      ['frog', 2],
      ['plush', 2],
      ['plushie', 2],
      ['animals', 2],
      ['animal', 2],
      ['lion', 2],
      ['lions', 2],
      ['penguin', 2],
      ['penguins', 2],
      ['stoat', 2],
      ['chick', 2],
      ['chicks', 2],
      ['octopus', 2],
      ['totoro', 2],
      ['smiski', 2],
      ['onepiece', 2],
      ['luffy', 2],
      ['strawhat', 2],
      ['chopper', 2],
      ['dinosaur', 2],
      ['anime', 1],
      ['doll', 1],
      ['dolls', 1],
    ],
  },
  {
    id: 'studio',
    label: 'Behind the scenes',
    blurb: 'Work in progress, market stalls, and the odd 2am update.',
    keywords: [
      ['workinprogress', 3],
      ['progress', 3],
      ['throwback', 3],
      ['bazaar', 3],
      ['booth', 3],
      ['booths', 3],
      ['restock', 2],
      ['ayalamallsthe30th', 3],
      ['popup', 2],
      ['behindthescenes', 3],
    ],
  },
  {
    id: 'minis',
    label: 'Personalised minis',
    blurb: 'Little crocheted portraits, made to order.',
    keywords: [
      ['personalized', 3],
      ['personalised', 3],
      ['mini', 2],
      ['minis', 2],
      ['miniature', 2],
      ['pocketsize', 2],
      ['lookalike', 2],
      ['cabincrew', 2],
      ['pal', 1],
      ['pnumanila', 1],
      ['teachers', 1],
      ['graduation', 1],
    ],
  },
  {
    id: 'gifts',
    label: 'Gifts',
    blurb: 'Made for an occasion.',
    keywords: [
      ['giftideas', 2],
      ['gift', 2],
      ['valentinesday', 2],
      ['valentine', 2],
      ['anniversary', 2],
      ['birthday', 2],
      ['christmas', 2],
      ['mothersday', 2],
      ['bundle', 1],
    ],
  },
];

export const FALLBACK_CATEGORY = {
  id: 'other',
  label: 'Other pieces',
  blurb: 'Everything else from the hook.',
};

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || FALLBACK_CATEGORY;
}

/**
 * Score a caption against every category and return the winner.
 *
 * Two matching modes, because the corpus needs both:
 *
 *  - Caption text is matched on word boundaries, so "star" does not fire on
 *    "start" and "cat" does not fire on "category".
 *  - Hashtags are compound words. Faith writes #amigurumiph, #crochetkeychain,
 *    #squidgamevibes and #animevibes, none of which equal their root token, so
 *    exact comparison missed all of them. Tags therefore allow substring
 *    matching — but only for keywords of 5+ characters, so short roots like
 *    "cat", "bee" and "pal" cannot fire inside an unrelated compound.
 */
const MIN_SUBSTRING_LENGTH = 5;

export function categorise(caption, tags = []) {
  const haystack = ` ${(caption || '').toLowerCase()} `;
  let best = null;
  let bestScore = 0;

  for (const category of CATEGORIES) {
    let score = 0;

    for (const [word, weight] of category.keywords) {
      if (tags.includes(word)) {
        score += weight;
        continue;
      }

      if (word.length >= MIN_SUBSTRING_LENGTH && tags.some((tag) => tag.includes(word))) {
        score += weight;
        continue;
      }

      const pattern = new RegExp(`[^\\p{L}\\p{N}]${word}[^\\p{L}\\p{N}]`, 'u');
      if (pattern.test(haystack)) score += weight;
    }

    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }

  return {
    category: best ? best.id : FALLBACK_CATEGORY.id,
    categoryLabel: best ? best.label : FALLBACK_CATEGORY.label,
    score: bestScore,
  };
}
