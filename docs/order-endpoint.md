# `POST /api/order` — custom order endpoint

The contract the order form on `/order` is built against.

Implementation: [`functions/api/order.ts`](../functions/api/order.ts).

The site stays `output: 'static'`. This endpoint is a **Cloudflare Pages Function**: Pages picks
up the top-level `functions/` directory during deploy and routes `functions/api/order.ts` at
`/api/order`. No Astro adapter, no SSR, no npm dependencies.

Request flow, in order. The first check that fails ends the request:

1. method is `POST`
2. `Content-Type` contains `application/json`
3. body is at most 16 KiB
4. body parses as a JSON object
5. every field validates
6. the caller's IP is under the rate limit
7. the Turnstile token verifies
8. delivery succeeds (email, or the KV fallback)

---

## Request

`POST /api/order`, `Content-Type: application/json`, body at most **16384 bytes**.

```ts
interface OrderRequest {
  name: string; // required
  contact: string; // required — email address or Facebook name/link
  pieceType: PieceType; // required — one of the literals below
  colors: string; // required — free text
  deadline?: string; // optional — 'YYYY-MM-DD'
  budget: Budget; // required — one of the literals below
  referenceUrl?: string; // optional — http/https link only
  message: string; // required — free text
  turnstileToken: string; // required — the cf-turnstile-response value
}
```

| Field            | Type           | Required | Constraints                                                                                                                            |
| ---------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | string         | yes      | 2 to 80 characters after trimming                                                                                                      |
| `contact`        | string         | yes      | 3 to 120 characters. If it contains `@` it must look like an email address; otherwise letters, digits, space and `. _ - / : ? = & + #` |
| `pieceType`      | string literal | yes      | exactly one of the seven `PieceType` values                                                                                            |
| `colors`         | string         | yes      | 2 to 200 characters                                                                                                                    |
| `deadline`       | string         | no       | `YYYY-MM-DD`, a real calendar date, from yesterday (UTC) to two years out. Send `""` or omit for none                                  |
| `budget`         | string literal | yes      | exactly one of the six `Budget` values                                                                                                 |
| `referenceUrl`   | string         | no       | at most 500 characters, parses as a URL, scheme `http:` or `https:` only, hostname must contain a dot. Send `""` or omit for none      |
| `message`        | string         | yes      | 5 to 2000 characters. Newlines are kept, runs of three or more collapse to a blank line                                                |
| `turnstileToken` | string         | yes      | 1 to 2048 characters                                                                                                                   |

Notes on how input is treated:

- Every string is normalised before validation: control characters are replaced with a space,
  and runs of whitespace collapse to one. `message` is the only field that keeps newlines. So
  lengths are measured **after** normalisation — a value of `"  a  "` is 1 character, not 5.
- Unknown extra properties in the body are ignored.
- A non-string value (number, `null`, object) in a string field is treated as empty, so it
  produces the same "this is missing" error as an empty string.
- `referenceUrl` is stored in its normalised form (`new URL(value).href`), so
  `https://example.com` comes through as `https://example.com/`.

### `PieceType` values

```ts
type PieceType =
  | 'amigurumi' // Amigurumi or stuffed toy
  | 'keychain' // Keychain or small charm
  | 'bouquet' // Crochet flower bouquet
  | 'bag' // Bag or pouch
  | 'apparel' // Apparel or wearable
  | 'home' // Home decor
  | 'custom'; // Something else
```

The comments are the labels used in the email to Faith. The form is free to show different
wording, but must submit these exact keys.

### `Budget` values

```ts
type Budget =
  | 'under-500' // Under PHP 500
  | '500-1000' // PHP 500 to 1,000
  | '1000-2500' // PHP 1,000 to 2,500
  | '2500-5000' // PHP 2,500 to 5,000
  | 'over-5000' // Over PHP 5,000
  | 'not-sure'; // Not sure yet
```

Same rule: display whatever reads best (the peso sign is fine in the UI), submit these keys.

---

## Responses

Every response is `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

Two shapes only:

```ts
type OrderResponse =
  | { ok: true }
  | {
      ok: false;
      error: string; // always present on failure — safe to show as-is
      errors?: Record<string, string>; // present when specific fields need attention
    };
```

`error` is always a finished sentence written for a visitor, so it can go straight into a banner.
`errors` maps a request field name to a message for that field. Nothing internal ever reaches the
client: no stack traces, no binding names, no secret, no Cloudflare error codes.

| Status  | When                                                                | Body                                               | Extra headers            |
| ------- | ------------------------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| **200** | delivered (by email, or stored in the KV fallback)                  | `{ "ok": true }`                                   | —                        |
| **400** | one or more fields invalid                                          | `{ ok: false, error, errors }`                     | —                        |
| **400** | body is not valid JSON, or is not a JSON object                     | `{ ok: false, error }` — no `errors`               | —                        |
| **403** | Turnstile said no                                                   | `{ ok: false, error, errors: { turnstileToken } }` | —                        |
| **405** | method is not POST                                                  | `{ ok: false, error }`                             | `Allow: POST`            |
| **413** | `Content-Length` over 16384, or the body itself is                  | `{ ok: false, error }`                             | —                        |
| **415** | `Content-Type` does not contain `application/json`                  | `{ ok: false, error }`                             | —                        |
| **429** | rate limited                                                        | `{ ok: false, error }`                             | `Retry-After: <seconds>` |
| **500** | Turnstile unreachable, misconfigured server, or delivery impossible | `{ ok: false, error }`                             | —                        |

A form only has to branch on three things: `200` is success, any response carrying `errors`
renders inline, anything else renders `error` in a banner. `403` carries both, so treating
"has `errors`" as inline handles it correctly.

### Field keys in `errors`

`name`, `contact`, `pieceType`, `colors`, `deadline`, `budget`, `referenceUrl`, `message`,
`turnstileToken`. Only the fields with a problem are present. Every message is plain language,
for example:

- `name`: "Add your name so Faith knows who she is writing back to."
- `contact`: "Add an email or Facebook name so Faith can reply."
- `contact`: "That email looks incomplete — check the part before and after the @."
- `pieceType`: "Choose the kind of piece you have in mind."
- `colors`: "Describe the colours you would like, even roughly."
- `deadline`: "That date has already gone by — choose today or a later date."
- `budget`: "Pick a budget range so Faith can suggest what fits."
- `referenceUrl`: "Reference links need to start with http:// or https://."
- `message`: "Tell Faith a little about what you would like made."
- `turnstileToken`: "The check that confirms you are a person did not finish — reload the page
  and try again."

The full wording lives in `validate()` in `functions/api/order.ts`. Render the strings the
endpoint returns rather than copying them into the form, so the two never drift apart.

### 500 wording, and what it means

Three different causes, three different messages, all of them safe to display:

- Turnstile could not be reached: "The security check could not be reached just now. Please try
  again in a moment." Retrying is worth it.
- `TURNSTILE_SECRET_KEY` is not configured, or nothing could accept the submission: "Something
  went wrong on our side, so this was not sent. Please try again in a moment, or message Faith on
  Facebook." Retrying will not help until the bindings are fixed.

Both are logged server-side with a `[order]` prefix and are visible in
`wrangler pages deployment tail`.

---

## Turnstile on the client

The widget script and the widget iframe both come from `https://challenges.cloudflare.com`, which
is why that origin is in `script-src` and `frame-src` in [`public/_headers`](../public/_headers).
Nothing else was widened.

Load the script once in the page head, and render a widget inside the form:

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

```html
<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY" data-action="order"></div>
```

Use the site key from `import.meta.env.PUBLIC_TURNSTILE_SITE_KEY`. It is public — it ships in the
HTML by design.

Turnstile injects a hidden input **named `cf-turnstile-response`** into that `div`. Read the value
and send it as `turnstileToken`:

```ts
const widgetInput = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');

const payload = {
  name: /* ... */ '',
  contact: '',
  pieceType: 'amigurumi',
  colors: '',
  deadline: '', // '' when the visitor leaves it blank
  budget: 'not-sure',
  referenceUrl: '',
  message: '',
  turnstileToken: widgetInput?.value ?? '',
};

const response = await fetch('/api/order', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const result = await response.json();
// result.ok === true            -> show the thank-you state
// result.errors                 -> render inline, keyed by field name
// else                          -> show result.error in a banner
```

Two things that will bite otherwise:

- **Tokens are single-use and expire after 300 seconds.** After any failed submit, call
  `window.turnstile.reset()` before letting the visitor try again, or the next attempt comes back
  `403` with "That security check has expired." The endpoint distinguishes an expired or reused
  token (`timeout-or-duplicate`) from a genuine rejection, so that message is a reliable signal to
  reset the widget.
- Do not disable the submit button until the widget has produced a token; check that
  `widgetInput.value` is non-empty and, if it is empty, reset the widget rather than posting.

---

## Bindings, secrets, and how to create them

Declared in [`wrangler.jsonc`](../wrangler.jsonc). Every binding is optional in `Env` and the code
degrades instead of throwing, but the table says what breaks if one is missing.

| Name                   | Kind       | Required    | Missing means                                                                         |
| ---------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | secret     | yes         | endpoint fails closed with `500` on every request — no bot check, no submissions      |
| `ORDER_INBOX`          | KV         | in practice | with no email binding available it is the only delivery path, so every request `500`s |
| `ORDER_RATELIMIT`      | KV         | no          | rate limiting is skipped, everything else works                                       |
| `SEND_EMAIL`           | send_email | no          | delivery falls back to `ORDER_INBOX` (see the caveat below)                           |
| `ORDER_TO_EMAIL`       | plain var  | no          | defaults to `faith@faithfullycrafted.ph`                                              |
| `ORDER_FROM_EMAIL`     | plain var  | no          | defaults to `orders@faithfullycrafted.ph`                                             |

### Turnstile keys

1. Cloudflare dashboard, **Turnstile**, add a widget for `faithfullycrafted.ph` (add `localhost`
   as a hostname too, for local work). Widget mode "Managed" is the right default.
2. Copy the **site key** into `PUBLIC_TURNSTILE_SITE_KEY` wherever the site is built: your local
   `.env`, and the build environment in CI. It is needed at build time because Astro inlines
   `PUBLIC_*` values into the generated HTML.
3. Put the **secret key** in as a Pages secret. Never in `wrangler.jsonc`, never in `.env.example`:

```bash
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=faithfullycrafted
```

### KV namespaces

```bash
npx wrangler kv namespace create ORDER_RATELIMIT
npx wrangler kv namespace create ORDER_INBOX
```

Each command prints an `id`. Paste both over the `PLACEHOLDER_...` values in `wrangler.jsonc`.
**Do this before the next deploy** — placeholder ids leave the bindings broken and can fail
`wrangler pages deploy` outright.

Reading the fallback inbox:

```bash
npx wrangler kv key list --binding ORDER_INBOX --remote
npx wrangler kv key get "order:2026-08-18T09:12:00.000Z:1a2b3c4d" --binding ORDER_INBOX --remote
```

Keys are `order:<ISO timestamp>:<8 random hex>`, so listing them is chronological. Records carry
the parsed submission, the rendered email text, the reason the fallback was used, and the client
IP and country. Nothing expires; these are the record of an order.

### Email delivery, and the caveat

`deliverOrder()` in `functions/api/order.ts` is the only place that touches email. It tries the
Cloudflare Email Service `SEND_EMAIL` binding first, and writes to `ORDER_INBOX` if the binding is
absent or the send throws. Either way the visitor gets `200`; the path taken is logged.

**`send_email` is not currently a supported binding for Pages projects.** It is absent from
wrangler's `supportedPagesConfigFields` list (checked in the installed wrangler 4.73.0) and from
the Pages wrangler-configuration docs, and `wrangler pages dev` has no flag for it. Declaring it
makes `wrangler pages deploy` fail with `Configuration file for Pages projects does not support
"send_email"`. So the block is present but commented out in `wrangler.jsonc`, and **in practice
every submission lands in `ORDER_INBOX` today.**

Two ways to get real email later:

1. Move this endpoint to a standalone Worker on a route such as
   `faithfullycrafted.ph/api/order`. The commented `send_email` block in `wrangler.jsonc` is valid
   as written for a Worker, and the function code needs no changes.
2. If Cloudflare adds the binding to the Pages dashboard, attach it there under the name
   `SEND_EMAIL`. Note that once a Pages project has a wrangler config file, that file is the
   source of truth for bindings, so verify a dashboard-attached binding actually reaches the
   function before relying on it.

Either way the sending domain has to be onboarded first, or the send throws
`E_SENDER_NOT_VERIFIED`:

```bash
npx wrangler email sending enable faithfullycrafted.ph
npx wrangler email sending dns get faithfullycrafted.ph   # confirm SPF and DKIM
```

The message the binding is called with:

```ts
{
  to: 'faith@faithfullycrafted.ph',
  from: { email: 'orders@faithfullycrafted.ph', name: 'Faithfully Crafted website' },
  subject: 'New custom order: Amigurumi or stuffed toy for Ana Reyes',
  text: '...plain text...',
  replyTo: { email: 'ana@example.com', name: 'Ana Reyes' }, // only when contact is an email
}
```

Plain text only — no HTML body, so there is no markup for user input to escape into. `subject` is
built from already-normalised values, truncated to 150 characters, and cannot contain a newline.
`replyTo` is set only when `contact` passed the email pattern, which forbids whitespace and
therefore CR and LF. The free-text `message` is indented by two spaces in the body so it cannot
imitate the header rows above it.

---

## Rate limiting

Best effort, KV-backed, per client IP from `CF-Connecting-IP`: **5 accepted submissions per
10 minutes**. State lives at `rl:<ip>` as `{ count, resetAt }` with a KV TTL matching the window.

- The counter is **read** before the Turnstile call, so a flood is cheap to refuse, but only
  **incremented** for submissions that got past validation. Fixing a typo and resubmitting does
  not eat the allowance.
- Every KV error fails open: the request proceeds and the failure is logged. A KV outage will
  never take the form down.
- KV is eventually consistent, so a burst spread across regions can exceed the nominal limit.
  This is a spam speed bump, not a quota. Turnstile is the real bot defence.
- When the limit is hit the response carries `Retry-After` in seconds — use it for the countdown
  in the UI rather than guessing.

---

## Testing locally

`wrangler pages dev` serves the built static output and the `functions/` directory together.

```bash
# 1. Build the static site (writes dist/)
npx astro build          # or `npm run build`, which also refreshes the gallery

# 2. Serve dist/ plus the functions, with local bindings
npx wrangler pages dev dist \
  --binding TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
  --kv ORDER_RATELIMIT \
  --kv ORDER_INBOX
```

`--kv NAME` gives you a local, simulated namespace, so the placeholder ids in `wrangler.jsonc` do
not matter for local work. There is no way to bind `SEND_EMAIL` locally, so local runs always take
the KV fallback path — expect `[order] email binding unavailable, falling back to KV` followed by
`[order] stored in KV inbox order:...` in the dev server output.

### Turnstile test keys

Cloudflare publishes dummy keys. Pair a dummy site key with a dummy secret key; a real secret key
rejects dummy tokens and vice versa.

| Key                                   | Behaviour                                 |
| ------------------------------------- | ----------------------------------------- |
| `1x00000000000000000000AA`            | site key, always passes, visible widget   |
| `2x00000000000000000000AB`            | site key, always fails, visible widget    |
| `3x00000000000000000000FF`            | site key, forces an interactive challenge |
| `1x0000000000000000000000000000000AA` | secret key, always passes                 |
| `2x0000000000000000000000000000000AA` | secret key, always fails                  |
| `3x0000000000000000000000000000000AA` | secret key, returns "token already spent" |

A dummy site key produces the token `XXXX.DUMMY.TOKEN.XXXX`, which is what to send as
`turnstileToken` in curl tests.

### Curl checks

Happy path — expect `200 {"ok":true}`:

```bash
curl -i http://localhost:8788/api/order \
  -H 'content-type: application/json' \
  -d '{"name":"Ana Reyes","contact":"ana@example.com","pieceType":"amigurumi","colors":"soft pink and cream","deadline":"2026-12-01","budget":"1000-2500","referenceUrl":"https://example.com/inspo","message":"A small bunny holding a heart, about 20cm tall.","turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}'
```

Validation — expect `400` with an `errors` map holding `name`, `contact`, `pieceType`, `colors`,
`budget` and `message`:

```bash
curl -i http://localhost:8788/api/order \
  -H 'content-type: application/json' \
  -d '{"turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}'
```

Wrong method — expect `405` and `Allow: POST`:

```bash
curl -i http://localhost:8788/api/order
```

Wrong content type — expect `415`:

```bash
curl -i http://localhost:8788/api/order -H 'content-type: text/plain' -d 'hello'
```

Oversized body — expect `413`:

```bash
curl -i http://localhost:8788/api/order \
  -H 'content-type: application/json' \
  --data-binary @<(python -c "print('{\"message\":\"' + 'x'*20000 + '\"}')")
```

Turnstile rejection — restart `pages dev` with
`--binding TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA` and repeat the happy path.
Expect `403` with `errors.turnstileToken`.

Rate limiting — run the happy path six times in a row. The sixth returns `429` with `Retry-After`.

### Deployed logs

```bash
npx wrangler pages deployment tail --project-name=faithfullycrafted
```

Every log line from this endpoint starts with `[order]`. Personal details are deliberately kept
out of the logs; only the delivery path, piece type, message id or KV key, and error codes are
recorded.
