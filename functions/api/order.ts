/**
 * POST /api/order — custom order intake for faithfullycrafted.pages.dev
 *
 * This runs as a Cloudflare Pages Function next to the static Astro build. The
 * site stays `output: 'static'`; Pages picks this file up from the top-level
 * `functions/` directory and routes it at `/api/order`.
 *
 * Flow: method check -> content-type -> body size -> JSON parse -> field
 * validation -> rate limit -> Turnstile -> delivery.
 *
 * Full request/response contract, bindings, secrets and local testing:
 * docs/order-endpoint.md
 */

/* ── Runtime type shims ──────────────────────────────────────────────────────
 * This project has no `@cloudflare/workers-types` dependency, so the few
 * runtime types needed here are declared locally. They are module-scoped (not
 * global), so if that package is installed later these just shadow the real
 * types inside this file and nothing breaks — at that point this block can be
 * deleted.
 * ------------------------------------------------------------------------- */

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: Record<string, unknown> },
  ): Promise<void>;
}

interface EmailAddress {
  email: string;
  name?: string;
}

/** Shape accepted by the Cloudflare Email Service `send_email` binding. */
interface SendEmailMessage {
  to: string | EmailAddress | Array<string | EmailAddress>;
  from: string | EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | EmailAddress;
  headers?: Record<string, string>;
}

interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<{ messageId: string }>;
}

interface EventContext<E> {
  request: Request;
  env: E;
  waitUntil(promise: Promise<unknown>): void;
}

type PagesFunction<E> = (context: EventContext<E>) => Response | Promise<Response>;

/**
 * Every binding is optional on purpose. A missing binding degrades behaviour
 * (skip rate limiting, fall back to KV storage) rather than throwing. The one
 * exception is TURNSTILE_SECRET_KEY: without it there is no way to tell a
 * person from a bot, so the endpoint fails closed with a 500.
 */
interface Env {
  /** Turnstile secret key. Set with `wrangler pages secret put`. Never sent to the client. */
  TURNSTILE_SECRET_KEY?: string;
  /** Optional override for the recipient. Defaults to ORDER_TO_FALLBACK. */
  ORDER_TO_EMAIL?: string;
  /** Optional override for the sender. Must be a domain onboarded to Email Sending. */
  ORDER_FROM_EMAIL?: string;
  /** Cloudflare Email Service binding. Absent -> submissions are stored in ORDER_INBOX. */
  SEND_EMAIL?: SendEmailBinding;
  /** KV namespace used for per-IP rate limiting. Absent -> rate limiting is skipped. */
  ORDER_RATELIMIT?: KVNamespace;
  /** KV namespace used as the delivery fallback so a submission is never lost. */
  ORDER_INBOX?: KVNamespace;
}

/* ── Configuration ───────────────────────────────────────────────────────── */

// No mailbox exists yet (the site is on pages.dev with no zone), so these
// are only meaningful once a domain and a verified sender are set up. Until
// then delivery falls through to ORDER_INBOX and the front end uses its
// Messenger handoff instead.
const ORDER_TO_FALLBACK = '';
const ORDER_FROM_FALLBACK = '';
const ORDER_FROM_NAME = 'Faithfully Crafted website';

const MAX_BODY_BYTES = 16 * 1024;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 10_000;
const TURNSTILE_TOKEN_MAX = 2048;

/** Best effort: 5 accepted submissions per IP per 10 minutes. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600;

const LIMITS = {
  name: { min: 2, max: 80 },
  contact: { min: 3, max: 120 },
  colors: { min: 2, max: 200 },
  referenceUrl: { max: 500 },
  message: { min: 5, max: 2000 },
} as const;

/**
 * These ids mirror the gallery categories in `scripts/lib/categories.mjs`,
 * which were derived by counting product nouns and hashtags across all 291 of
 * Faith's posts. Keeping them identical means an order names the same kind of
 * thing the gallery filters by, and `src/lib/constants.ts` renders the same
 * option list this validates against.
 */
const PIECE_TYPES = {
  keychains: 'Keychain or bag charm',
  flowers: 'Flowers or a bouquet',
  characters: 'Character amigurumi',
  stars: 'Stars',
  minis: 'Personalised mini',
  gifts: 'A gift for an occasion',
  custom: 'Something else entirely',
} as const;

/**
 * Bands calibrated to what Faith actually charges. Her own posts advertise
 * flower keychains at PHP 100, so bands starting at "under 500" would have put
 * almost every real order in the bottom bucket and told her nothing.
 */
const BUDGETS = {
  'under-300': 'Under PHP 300',
  '300-600': 'PHP 300 to 600',
  '600-1200': 'PHP 600 to 1,200',
  'over-1200': 'Over PHP 1,200',
  unsure: 'Not sure yet',
} as const;

type PieceType = keyof typeof PIECE_TYPES;
type Budget = keyof typeof BUDGETS;

const EMAIL_RE = /^[^\s@,;:<>"']+@[^\s@,;:<>"'.]+(?:\.[^\s@,;:<>"'.]+)+$/;
const HANDLE_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/:?=&+#]*$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ── Small helpers ───────────────────────────────────────────────────────── */

type FieldErrors = Record<string, string>;

function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/** True for C0 and C1 control characters, which never belong in a form field. */
function isControlCode(code: number): boolean {
  return code < 32 || (code >= 127 && code <= 159);
}

/** Collapses a value to one safe line: no control characters, no runs of whitespace. */
function toLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += isControlCode(code) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Keeps paragraph breaks but strips every other control character. */
function toBlock(value: unknown): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0) ?? 0;
    out += !isControlCode(code) || code === 10 ? ch : ' ';
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function todayUtcMidnight(): number {
  return Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

/* ── Validation ──────────────────────────────────────────────────────────── */

interface Order {
  name: string;
  contact: string;
  contactIsEmail: boolean;
  pieceType: PieceType;
  colors: string;
  deadline: string | null;
  budget: Budget;
  referenceUrl: string | null;
  message: string;
}

type ValidationResult = { order: Order; errors: null } | { order: null; errors: FieldErrors };

function validate(body: Record<string, unknown>): ValidationResult {
  const errors: FieldErrors = {};

  const name = toLine(body.name);
  if (name.length === 0) {
    errors.name = 'Add your name so Faith knows who she is writing back to.';
  } else if (name.length < LIMITS.name.min) {
    errors.name = 'That is a bit short for a name — add a couple more characters.';
  } else if (name.length > LIMITS.name.max) {
    errors.name = 'That name is longer than 80 characters — a shorter version is fine.';
  }

  const contact = toLine(body.contact);
  const contactIsEmail = contact.includes('@');
  if (contact.length === 0) {
    errors.contact = 'Add an email or Facebook name so Faith can reply.';
  } else if (contact.length > LIMITS.contact.max) {
    errors.contact = 'That is over 120 characters — a shorter contact detail works better.';
  } else if (contactIsEmail && !EMAIL_RE.test(contact)) {
    errors.contact = 'That email looks incomplete — check the part before and after the @.';
  } else if (!contactIsEmail && contact.length < LIMITS.contact.min) {
    errors.contact = 'That is a bit short — use an email, a Facebook name, or a profile link.';
  } else if (!contactIsEmail && !HANDLE_RE.test(contact)) {
    errors.contact = 'Use an email address, your Facebook name, or a link to your profile.';
  }

  const pieceTypeRaw = toLine(body.pieceType);
  const pieceTypeValid = Object.prototype.hasOwnProperty.call(PIECE_TYPES, pieceTypeRaw);
  if (!pieceTypeValid) {
    errors.pieceType = 'Choose the kind of piece you have in mind.';
  }

  const colors = toLine(body.colors);
  if (colors.length === 0) {
    errors.colors = 'Describe the colours you would like, even roughly.';
  } else if (colors.length < LIMITS.colors.min) {
    errors.colors = 'Add a little more about the colours.';
  } else if (colors.length > LIMITS.colors.max) {
    errors.colors = 'Keep colour notes under 200 characters — the message box has more room.';
  }

  const deadlineRaw = toLine(body.deadline);
  let deadline: string | null = null;
  if (deadlineRaw.length > 0) {
    if (!DATE_RE.test(deadlineRaw)) {
      errors.deadline = 'Use a date written like 2026-09-30.';
    } else {
      const parsed = new Date(`${deadlineRaw}T00:00:00Z`);
      const isRealDate =
        !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === deadlineRaw;
      if (!isRealDate) {
        errors.deadline = 'That is not a date on the calendar — check the month and day.';
      } else {
        // Manila runs ahead of UTC, so allow one day of slack behind "today".
        const midnight = todayUtcMidnight();
        const floor = midnight - 24 * 60 * 60 * 1000;
        const ceiling = midnight + 730 * 24 * 60 * 60 * 1000;
        if (parsed.getTime() < floor) {
          errors.deadline = 'That date has already gone by — choose today or a later date.';
        } else if (parsed.getTime() > ceiling) {
          errors.deadline = 'That date is more than two years out — pick something closer.';
        } else {
          deadline = deadlineRaw;
        }
      }
    }
  }

  const budgetRaw = toLine(body.budget);
  const budgetValid = Object.prototype.hasOwnProperty.call(BUDGETS, budgetRaw);
  if (!budgetValid) {
    errors.budget = 'Pick a budget range so Faith can suggest what fits.';
  }

  const referenceRaw = toLine(body.referenceUrl);
  let referenceUrl: string | null = null;
  if (referenceRaw.length > 0) {
    if (referenceRaw.length > LIMITS.referenceUrl.max) {
      errors.referenceUrl = 'That link is over 500 characters — a shorter one will do.';
    } else {
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(referenceRaw);
      } catch {
        parsedUrl = null;
      }
      if (parsedUrl === null) {
        errors.referenceUrl =
          'That does not look like a web address — paste the full link, starting with https://.';
      } else if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        errors.referenceUrl = 'Reference links need to start with http:// or https://.';
      } else if (!parsedUrl.hostname.includes('.')) {
        errors.referenceUrl = 'That link is missing a website name — check it and paste it again.';
      } else {
        referenceUrl = toLine(parsedUrl.href);
      }
    }
  }

  const message = toBlock(body.message);
  if (message.length === 0) {
    errors.message = 'Tell Faith a little about what you would like made.';
  } else if (message.length < LIMITS.message.min) {
    errors.message = 'Add a bit more detail so Faith can picture it.';
  } else if (message.length > LIMITS.message.max) {
    errors.message = 'That is over the 2,000 character limit — trim it a little.';
  }

  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : '';
  if (token.length === 0 || token.length > TURNSTILE_TOKEN_MAX) {
    errors.turnstileToken =
      'The check that confirms you are a person did not finish — reload the page and try again.';
  }

  if (Object.keys(errors).length > 0) {
    return { order: null, errors };
  }

  return {
    order: {
      name,
      contact,
      contactIsEmail,
      pieceType: pieceTypeRaw as PieceType,
      colors,
      deadline,
      budget: budgetRaw as Budget,
      referenceUrl,
      message,
    },
    errors: null,
  };
}

/* ── Turnstile ───────────────────────────────────────────────────────────── */

interface TurnstileVerdict {
  outcome: 'pass' | 'fail' | 'unavailable';
  codes: string[];
}

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

async function verifyTurnstile(
  token: string,
  secret: string,
  clientIp: string | null,
): Promise<TurnstileVerdict> {
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (clientIp !== null && clientIp.length > 0) {
    form.set('remoteip', clientIp);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('[order] turnstile siteverify http error', response.status);
      return { outcome: 'unavailable', codes: [] };
    }

    const result = (await response.json()) as SiteverifyResponse;
    const codes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];
    return { outcome: result.success === true ? 'pass' : 'fail', codes };
  } catch (error) {
    console.error(
      '[order] turnstile siteverify unreachable',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { outcome: 'unavailable', codes: [] };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Rate limiting (KV, best effort, fails open) ─────────────────────────── */

interface RateState {
  count: number;
  resetAt: number;
}

async function readRateState(kv: KVNamespace, key: string, nowSeconds: number): Promise<RateState> {
  const fresh: RateState = { count: 0, resetAt: nowSeconds + RATE_LIMIT_WINDOW_SECONDS };
  try {
    const stored = await kv.get(key);
    if (stored === null) return fresh;
    const parsed = JSON.parse(stored) as Partial<RateState>;
    const count = typeof parsed.count === 'number' && parsed.count > 0 ? parsed.count : 0;
    const resetAt = typeof parsed.resetAt === 'number' ? parsed.resetAt : 0;
    if (resetAt <= nowSeconds) return fresh;
    return { count, resetAt };
  } catch (error) {
    console.error(
      '[order] rate limit read failed, allowing request',
      error instanceof Error ? error.message : 'unknown error',
    );
    return fresh;
  }
}

async function bumpRateState(kv: KVNamespace, key: string, state: RateState): Promise<void> {
  const next: RateState = { count: state.count + 1, resetAt: state.resetAt };
  // KV refuses a TTL under 60 seconds, so never ask for less than that.
  const ttl = Math.max(60, Math.ceil(next.resetAt - Date.now() / 1000));
  try {
    await kv.put(key, JSON.stringify(next), { expirationTtl: ttl });
  } catch (error) {
    console.error(
      '[order] rate limit write failed, continuing',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

/* ── Delivery ────────────────────────────────────────────────────────────── */

interface SubmissionMeta {
  receivedAt: string;
  clientIp: string | null;
  country: string | null;
}

type DeliveryPath = 'email' | 'kv' | 'none';

function buildSubject(order: Order): string {
  return toLine(`New custom order: ${PIECE_TYPES[order.pieceType]} for ${order.name}`).slice(
    0,
    150,
  );
}

function buildEmailText(order: Order, meta: SubmissionMeta): string {
  const rows: Array<[string, string]> = [
    ['Name', order.name],
    ['Contact', `${order.contact} (${order.contactIsEmail ? 'email' : 'Facebook'})`],
    ['Piece', PIECE_TYPES[order.pieceType]],
    ['Colours', order.colors],
    ['Deadline', order.deadline ?? 'No date given'],
    ['Budget', BUDGETS[order.budget]],
    ['Reference', order.referenceUrl ?? 'None'],
  ];

  const table = rows.map(([label, value]) => `${(label + ':').padEnd(11, ' ')}${value}`).join('\n');

  // Indent the free text so it can never imitate the header rows above it.
  const quoted = order.message
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    'A custom order request came in through faithfullycrafted.pages.dev.',
    '',
    table,
    '',
    'Their message',
    '------------------------------------------------------------',
    quoted,
    '------------------------------------------------------------',
    '',
    order.contactIsEmail
      ? 'Replying to this email goes straight back to them.'
      : 'They left a Facebook contact, so reply through Messenger.',
    '',
    `Received:  ${meta.receivedAt}`,
    `IP:        ${meta.clientIp ?? 'unknown'}`,
    `Country:   ${meta.country ?? 'unknown'}`,
  ].join('\n');
}

/**
 * Sends the order to Faith, with a fallback so a submission is never lost.
 *
 * Path 1 — Cloudflare Email Service through the SEND_EMAIL binding.
 * Path 2 — if that binding is absent or the send throws, write the whole
 *          submission to the ORDER_INBOX KV namespace under a timestamped key.
 * Path 3 — neither is available: return 'none' so the caller answers 500.
 *
 * Deliberately small and self-contained: this is the only place that touches
 * the email API, so it is the only place to change if that API moves.
 */
async function deliverOrder(env: Env, order: Order, meta: SubmissionMeta): Promise<DeliveryPath> {
  const subject = buildSubject(order);
  const text = buildEmailText(order, meta);
  const to = toLine(env.ORDER_TO_EMAIL ?? ORDER_TO_FALLBACK);
  const from = toLine(env.ORDER_FROM_EMAIL ?? ORDER_FROM_FALLBACK);
  let fallbackReason = 'send-email-binding-missing';

  if (env.SEND_EMAIL !== undefined && typeof env.SEND_EMAIL.send === 'function') {
    const message: SendEmailMessage = {
      to,
      from: { email: from, name: ORDER_FROM_NAME },
      subject,
      text,
    };
    // Only a validated address can reach a header, so no CR/LF can slip in.
    if (order.contactIsEmail && EMAIL_RE.test(order.contact)) {
      message.replyTo = { email: order.contact, name: order.name };
    }
    try {
      const result = await env.SEND_EMAIL.send(message);
      console.log('[order] delivered by email', order.pieceType, result.messageId);
      return 'email';
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'unknown';
      console.error('[order] email send failed, falling back to KV', code);
      fallbackReason = `send-email-failed:${code}`;
    }
  } else {
    console.warn('[order] email binding unavailable, falling back to KV');
  }

  if (env.ORDER_INBOX !== undefined) {
    const key = `order:${meta.receivedAt}:${crypto.randomUUID().slice(0, 8)}`;
    try {
      await env.ORDER_INBOX.put(
        key,
        JSON.stringify({
          receivedAt: meta.receivedAt,
          reason: fallbackReason,
          clientIp: meta.clientIp,
          country: meta.country,
          order,
          email: { to, from, subject, text },
        }),
      );
      console.log('[order] stored in KV inbox', key);
      return 'kv';
    } catch (error) {
      console.error(
        '[order] KV inbox write failed',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  } else {
    console.error('[order] no KV inbox binding, submission could not be stored');
  }

  return 'none';
}

/* ── Handler ─────────────────────────────────────────────────────────────── */

const GENERIC_ERROR =
  'Something went wrong on our side, so this was not sent. Please try again in a moment, or message Faith on Facebook.';

const OVERSIZE_ERROR =
  'That request is bigger than this form accepts — please shorten the message.';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonResponse(
      405,
      { ok: false, error: 'This address only takes POST requests.' },
      { allow: 'POST' },
    );
  }

  try {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return jsonResponse(415, { ok: false, error: 'Send this request as JSON.' });
    }

    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
        return jsonResponse(413, { ok: false, error: OVERSIZE_ERROR });
      }
    }

    const raw = await request.text();
    if (byteLength(raw) > MAX_BODY_BYTES) {
      return jsonResponse(413, { ok: false, error: OVERSIZE_ERROR });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { ok: false, error: 'The request body was not readable as JSON.' });
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return jsonResponse(400, {
        ok: false,
        error: 'The request body needs to be a JSON object of form fields.',
      });
    }

    const body = parsed as Record<string, unknown>;
    const { order, errors } = validate(body);
    if (errors !== null || order === null) {
      return jsonResponse(400, {
        ok: false,
        error: 'A few details need a second look.',
        errors: errors ?? {},
      });
    }

    const clientIp = request.headers.get('CF-Connecting-IP');
    const country = request.headers.get('CF-IPCountry');
    const rateKey = `rl:${clientIp ?? 'unknown'}`;
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Read the counter before the Turnstile subrequest so a flood is cheap to
    // refuse, but only increment it further down for submissions that got this
    // far — a visitor fixing a typo should not burn through their allowance.
    let rateState: RateState | null = null;
    if (env.ORDER_RATELIMIT !== undefined) {
      rateState = await readRateState(env.ORDER_RATELIMIT, rateKey, nowSeconds);
      if (rateState.count >= RATE_LIMIT_MAX) {
        const retryAfter = Math.max(1, rateState.resetAt - nowSeconds);
        return jsonResponse(
          429,
          {
            ok: false,
            error:
              'A few requests have already come through from here. Please try again in a few minutes.',
          },
          { 'retry-after': String(retryAfter) },
        );
      }
    }

    const secret = env.TURNSTILE_SECRET_KEY;
    if (secret === undefined || secret.length === 0) {
      // Fail closed: without the secret there is no way to tell a person from a bot.
      console.error('[order] turnstile secret is not configured');
      return jsonResponse(500, { ok: false, error: GENERIC_ERROR });
    }

    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : '';
    const verdict = await verifyTurnstile(token, secret, clientIp);

    if (verdict.outcome === 'unavailable') {
      return jsonResponse(500, {
        ok: false,
        error: 'The security check could not be reached just now. Please try again in a moment.',
      });
    }

    if (verdict.outcome === 'fail') {
      console.warn('[order] turnstile rejected', verdict.codes.join(','));
      const expired = verdict.codes.includes('timeout-or-duplicate');
      const failMessage = expired
        ? 'That security check has expired. Reload the page and send the form again.'
        : 'The check that confirms you are a person did not pass. Reload the page and try once more.';
      return jsonResponse(403, {
        ok: false,
        error: failMessage,
        errors: { turnstileToken: failMessage },
      });
    }

    if (env.ORDER_RATELIMIT !== undefined && rateState !== null) {
      await bumpRateState(env.ORDER_RATELIMIT, rateKey, rateState);
    }

    const meta: SubmissionMeta = {
      receivedAt: new Date().toISOString(),
      clientIp,
      country,
    };

    const path = await deliverOrder(env, order, meta);
    if (path === 'none') {
      return jsonResponse(500, { ok: false, error: GENERIC_ERROR });
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error(
      '[order] unhandled failure',
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error',
    );
    return jsonResponse(500, { ok: false, error: GENERIC_ERROR });
  }
};
