# Runbook — Frontend RUM metrics and SLOs

Owner: `frontend` · Metrics namespace: `teslasync_frontend_*` · Ingest:
`POST /api/v1/web-vitals`

This runbook covers the Real-User-Monitoring (RUM) pipeline that backs the
`frontend_*` entries in [`slo/catalog.yaml`](../../slo/catalog.yaml): what is
collected, what is deliberately *not* collected, how cardinality is bounded,
how to wire the one optional integration point, and what to do when an alert
fires.

---

## 1. Pipeline

```
Browser (web/src/lib/webVitalsReporter.ts)
  ├─ web-vitals lib ─────────► LCP · INP · CLS · FCP · TTFB
  ├─ history instrumentation ► RouteChange (route-transition duration)
  ├─ markContentReady() ─────► TTUC (time to usable content)
  └─ reportUxEvent() ────────► bounded UX events
        │  batched ≤2s, sendBeacon (fetch fallback), consent-gated
        ▼
POST /api/v1/web-vitals   (public, per-IP rate limited 120/min, no auth)
        │
internal/api/webvitals
  ├─ normalize.go  route templating + privacy redaction + closed label sets
  ├─ metrics.go    SI histograms, bounded dimension counters, release gauges
  └─ handler.go    payload validation, batch caps, rejection accounting
        ▼
Prometheus  ──►  slo/catalog.yaml  ──►  cmd/slogen  ──►  recording rules,
                                                          burn alerts,
                                                          Grafana dashboards
```

## 2. Metric contract

### Histograms (label: `route` only)

| Metric | Unit | Good threshold | SLO |
| --- | --- | --- | --- |
| `teslasync_frontend_web_vitals_lcp_seconds` | seconds | 2.5 | `frontend_lcp` |
| `teslasync_frontend_web_vitals_inp_seconds` | seconds | 0.2 | `frontend_inp` |
| `teslasync_frontend_web_vitals_cls_ratio` | unitless score | 0.1 | `frontend_cls` |
| `teslasync_frontend_web_vitals_fcp_seconds` | seconds | 1.8 | `frontend_fcp` |
| `teslasync_frontend_web_vitals_ttfb_seconds` | seconds | 0.8 | `frontend_ttfb` |
| `teslasync_frontend_route_transition_seconds` | seconds | 0.5 | `frontend_route_transition` |
| `teslasync_frontend_time_to_usable_content_seconds` | seconds | 2.5 | **none — gated, see §5.3** |

`route_transition_seconds` is a route **paint** signal: navigation start to the
first paint after the new route committed. The route may have painted
skeletons, so it measures responsiveness, not usability. Usability is TTUC,
which is opt-in and has no automatic completion.

The browser reports Web Vitals in **milliseconds**. The handler divides by
1000 so the exported series really is seconds and the `le="…"` thresholds in
the catalogue are directly comparable. `TestTimeMetricsUseSecondsUnit` and
`TestFrontendSLOThresholdsUseCorrectUnits` pin this — a millisecond threshold
against a `_seconds` histogram silently reports 100% success forever, which is
the single most damaging failure mode for these SLOs.

FCP's SLO threshold is the industry-standard "good" boundary of 1.8s. The
tighter internal budget in `.github/copilot-instructions.md` (FCP < 1.5s on 4G)
is a target, not the error-budget boundary.

### Dimension counter (no `route` label)

`teslasync_frontend_web_vitals_samples_total{name, rating, device, connection, theme}`

Route is deliberately absent: cross-producting the route template with four
more dimensions would multiply the series count by ~240× for no analytical
gain. SLOs need per-route latency; product analytics needs per-device rates;
neither needs both at once.

| Label | Closed set |
| --- | --- |
| `name` | LCP, INP, CLS, FCP, TTFB, RouteChange, TTUC |
| `rating` | good, needs-improvement, poor, unknown |
| `device` | mobile, tablet, desktop, unknown (viewport width only — **never** UA parsing) |
| `connection` | slow-2g, 2g, 3g, 4g, 5g, unknown (Network Information API `effectiveType`) |
| `theme` | dark, light, unknown |

Series ceiling: 7 × 4 × 4 × 6 × 3 = **2016**.

### UX events

`teslasync_frontend_ux_events_total{kind, outcome, route}`

| Label | Closed set |
| --- | --- |
| `kind` | error, resource, query, retry, cache, cancellation, user_action |
| `outcome` | success, failure, hit, miss, timeout, cancelled, blocked, retried |

Unknown kinds/outcomes are **rejected**, not bucketed — an "unknown" UX kind
carries no analytical value and would only mask a client bug. Rejections are
counted on `teslasync_web_vitals_samples_rejected_total{reason}`.

### Release / deployment metadata

- `teslasync_frontend_release_info{release}` — always `1`, one series per
  observed frontend release.
- `teslasync_frontend_release_first_seen_timestamp_seconds{release}` — Unix
  timestamp of the first RUM sample from that release.

`release` comes from `VITE_APP_VERSION` (build metadata inlined by Vite, see
`web/vite.config.ts`), charset-validated, length-capped at 32 and folded
through a 12-entry registry.

Every frontend Grafana dashboard carries a release annotation built from these
gauges, so a burn-rate cliff can be read against the deploy that caused it:

```promql
changes(teslasync_frontend_release_first_seen_timestamp_seconds[$__rate_interval]) > 0
```

### Ingest health

| Metric | Meaning |
| --- | --- |
| `teslasync_web_vitals_batches_ingested_total` | batches accepted |
| `teslasync_web_vitals_samples_ingested_total` | individual samples observed |
| `teslasync_web_vitals_samples_rejected_total{reason}` | dropped before observation |
| `teslasync_web_vitals_batches_rejected_total` | whole batches refused (400) because nothing validated |
| `teslasync_frontend_label_overflow_total{label}` | a label hit a cardinality cap |

`label_overflow_total` distinguishes three causes:

| `label` value | Cause |
| --- | --- |
| `route` | the global 80-template cap is full |
| `route_batch_budget` | one request tried to introduce more than 4 new templates |
| `route_shape` | the template does not look like an app route (see §4) |
| `release` / `release_batch_budget` | the release registry equivalents |

`teslasync_web_vitals_value{name,rating,route}` (milliseconds) is the
**deprecated** pre-SI aggregate. It is retained only for the admin
observability copy in `web/src/i18n`. Do not build new SLOs or dashboards on
it.

---

## 3. Privacy contract

Nothing that can identify a user, a vehicle or a location may reach a
Prometheus label **or a buffered diagnostic payload**. Normalisation is applied
**twice** — once in the browser so the raw value never travels, and again
server-side so a compromised or hand-rolled client cannot bypass it.

### 3.0 One route templater, two implementations, one source of truth

`web/src/lib/routeTemplate.ts` is a pure, side-effect-free module shared by
**both** client-boundary surfaces (`webVitalsReporter` and `errorReporter`).
Its only import is the autogenerated `routeRegistry`, which is a frozen data
array with no imports of its own — no cycle, and nothing runs at load time
(the registry index is built lazily).

The backend gets the **same table**, generated rather than imported:

```
web/src/App.tsx
  └─ web/scripts/generate-route-registry.mjs      [--check gate]
       └─ web/src/lib/routeRegistry.ts      ← canonical
            ├─ (TS, direct import)  web/src/lib/routeTemplate.ts
            └─ cmd/routetemplategen                [--check gate]
                 └─ internal/api/webvitals/routetemplates_gen.go   (committed)
```

Regenerate both links with:

```bash
cd web && node scripts/generate-route-registry.mjs
cd ..  && go generate ./internal/api/webvitals
```

`cmd/routetemplategen` locates the module root by walking up for `go.mod`, so
its default paths resolve identically whether it runs from the repository root
or from the package directory `go generate` uses.

**Both links are gated in CI**, in the `contract` job of
`.github/workflows/frontend-quality.yml` (which runs on `main` *and*
`revamped-ui`):

```yaml
- run: node scripts/generate-route-registry.mjs --check
- run: go run ./cmd/routetemplategen --check      # working-directory: .
```

Freshness matters because the chain is only as good as its first link. A
`:param` route added to `App.tsx` and never regenerated is not templated
anywhere — the opaque value lands verbatim in a Prometheus label and in
buffered browser-error payloads. Both gates are proven to catch that:
`web/src/lib/__tests__/routeRegistryFreshness.test.ts` drives the real CLI as a
subprocess with a synthetic `:param` route injected into `App.tsx` and asserts
a non-zero exit, and `cmd/routetemplategen`
`TestSyntheticParamRouteBreaksTheDriftGate` does the same for the Go artifact.

`NormalizeRoute` is shared verbatim by **both** public ingest surfaces —
`/api/v1/web-vitals` and `/api/v1/web-errors` — and
`internal/api/weberrors/route_parity_test.go` pins that so a divergence cannot
redact a slug on one endpoint and preserve it on the other.

### 3.0.1 Bounded route admission per surface

Normalising is not enough on an anonymous endpoint: a caller can mint an
unbounded number of *different* well-formed, safe-word templates, each a new
Prometheus series. Both surfaces therefore fold routes through a capped
admission registry (`RouteAdmitter`, exported from `internal/api/webvitals`):

| Surface | Global cap | New templates per request | Overflow labels |
| --- | --- | --- | --- |
| `/api/v1/web-vitals` | 80 | 4 | `route`, `route_batch_budget`, `route_shape` |
| `/api/v1/web-errors` | 80 | 1 | `weberrors_route`, `weberrors_route_batch_budget`, `weberrors_route_shape` |

Overflow always folds into the closed constant `OverflowRoute` (`/__other__`),
never a client-derived value.

The registries are **deliberately separate**. Sharing one would be simpler, but
it would let a burst of junk on one anonymous endpoint consume the cardinality
budget the other needs for its real routes. The normalisation rules, caps and
overflow semantics are identical — only the accounting is separate, and the
overflow counters are labelled per surface so the split is observable. Per-IP
abuse is bounded independently by the `httprate` limiters in
`internal/api/router.go` (120/min for web-vitals, 50/min for web-errors).

A segment becomes `:id` when **either**:

1. **The canonical route table says that position is a `:param`.** This is not
   optional and a short pin list is not enough. `/s/share-token-abc`,
   `/year-review/private-share-slug`, `/trips/customer-private-slug`,
   `/automations/private-name/edit`, `/charging/private-slug` and
   `/system-status/incidents/private-slug` are all opaque, digit-free,
   hyphenated words — byte-for-byte the same *shape* as a real page name like
   `battery-degradation`. Heuristics alone preserve every one of them.
   `TestEveryParameterisedRouteIsTemplated` probes **every** `:param` position
   in the table with an opaque slug.
2. **The segment's shape is identifier-like** — see §3.1.

Literal registry routes are preferred over parameterised ones of the same
length, so `/automations/new` and `/vehicles/list/state` stay readable
(`TestLiteralRoutePrecedence`).

Percent-encoding is decoded **before** matching so `/year%2Dreview/2024` still
resolves to its canonical route. A segment whose encoding is malformed (`%zz`,
`%2`) or which decodes to a structural character (`%2F` → `/`) is opaque by
definition and is redacted outright. Both implementations share this rule
(`safeDecodeSegment`), and no template ever contains a `%`.

### 3.1 Shape heuristics

Redacted to `:id`:

- integer segments (`/drives/48291` → `/drives/:id`)
- UUIDs, with or without dashes
- hex blobs ≥ 20 chars (share tokens)
- 17-character VINs (ISO 3779 alphabet, at least one digit)
- decimal coordinates and `lat,lng` pairs
- anything containing `@`, `%`, `:` or `=` (e-mails, percent-encoded payloads)
- opaque tokens ≥ 12 chars mixing digits with other characters
- anything outside the conservative `[a-z0-9][._-]` allow-list (unicode,
  spaces, free text)

Also dropped: query strings, fragments, and the scheme + authority of an
absolute URL (a host can encode a tenant).

### 3.2 Buffered diagnostic fields

An error payload can be buffered for an arbitrarily long time (offline, or the
consent policy unresolved) and is then POSTed verbatim, so every field is
scrubbed **before the payload is constructed**:

| Field | Treatment |
| --- | --- |
| `route` | shared registry-aware templater; query and hash never retained |
| `message`, `stack` | current-URL templating **then** generic secret redaction |
| `userAgent` | no URL content |
| `occurredAt` | timestamp only |
| `name` | closed set, bucketed server-side |

`redactLocationInText` runs two passes:

1. **`redactUrlsInText` — every URL-like value, not just the current page.** A
   static page can legitimately reference a *different* share link
   (`https://host/s/another-token`), and a failed fetch puts a root-relative
   path in the message. Templating only `location` left those opaque paths
   intact all the way to the wire. The pass handles absolute
   (`https://host/…`), protocol-relative (`//host/…`) and root-relative
   (`/…`) forms, always drops query and fragment, and trims trailing sentence
   punctuation so `…/edit;` still matches its canonical route.
2. **Current-location sweep** for the rarer case where the pathname appears
   without a URL boundary in front of it (concatenated into a sentence).

Two deliberate carve-outs keep reports actionable:

- **Build-artifact FILENAMES survive verbatim — their directories do not.** A
  final segment with a code/asset extension (`.js`, `.mjs`, `.css`, `.map`,
  `.wasm`, fonts, images…) is not user data, so `index-abc123.js` is preserved,
  as is its `:line:col` suffix. Every segment *above* it is templated like any
  other path, because a token sits there perfectly happily:
  `/share/SECRETTOKENVALUE/index.html` → `/share/:id/index.html` and
  `/s/tok-private-abc/main.js:1:2` → `/s/:id/main.js:1:2`. A short structural
  directory (`/assets/js/…`) still survives.
- **Unknown paths are redacted conservatively.** When no canonical route
  declares a path's parameters, free-text scrubbing errs towards `:id` for any
  segment ≥ 12 chars, or ≥ 8 chars containing `-`/`_`/`.`. So
  `/api/v1/vehicles/42` → `/api/v1/vehicles/:id` (the failing surface is still
  identifiable) while `/unknown-root/customer-private-slug` → `/:id/:id`.
  This applies **only** to free text — the route *label* keeps full fidelity,
  because a label must distinguish `/analytics/tco` from `/analytics/carbon`.

Query and fragment are removed from the **whole token before anything is
parsed**. Splitting the authority first is a trap: `https://host?code=abc/x`
reads as authority `host?code=abc` plus path `/x`, silently keeping the
parameter. Stripping first means an authority-only URL such as
`https://host?code=abc/x` or `//host#share=aa/bb` collapses to `https://host` /
`//host` with nothing retained, whatever the parameter is named — the scrubber
does not depend on `redactSensitiveText`'s fixed list of known secret
parameter names. An authority port (`https://host:8080`) round-trips intact.

The regex intentionally uses a captured leading boundary rather than a
lookbehind: Safari < 16.4 throws a `SyntaxError` at parse time on lookbehind,
which would take the whole bundle down.

Ordering matters and is pinned by test: URL scrubbing runs **before**
`redactSensitiveText`, because a `[REDACTED]` marker injected into a query
string breaks URL boundary detection and leaves `?secret=…#frag` behind.

The in-app feedback ring gets the same scrubbed payload, so nothing sensitive
is retained in memory either — and neither reporter writes diagnostics to
`localStorage`/`sessionStorage`.

Not collected at all: user-agent-derived device classification, IP-derived
data, geolocation, screen fingerprints, session identifiers, VINs in any field.

The ingest handler logs at DEBUG only, and logs **counts and bounded
dimensions** — never a raw route, VIN, user agent or metric ID.

Reporting is consent-gated with a **fail-closed tri-state** — see §3.3.

### 3.3 Consent gate (fail closed)

`web/src/lib/webVitalsConsent.ts` models the deployment policy as a tri-state,
mirroring the tri-state user decision in `cookieConsent.ts`. A boolean cannot
express "we have not asked yet", and a boolean default of `false` silently
means "consent is not required" during the window in which a new visitor has
consented to nothing.

**The live policy starts `unknown` on every page load.** Nothing is ever
transmitted before `/system/version` resolves.

| Live policy | User consent | Decision |
| --- | --- | --- |
| any (resolved or not) | `declined` | **drop** |
| `not-required` | `accepted` / `unknown` | send |
| `required` | `accepted` | send |
| `required` | `unknown` | **drop** |
| `unknown` + cached `required` hint | `unknown` | **drop** |
| `unknown` (all other cases) | `accepted` / `unknown` | **hold** |

An explicit `declined` is honoured in **every** state, resolved or not — the
user said no, and no deployment policy overrides that.

- **hold** — nothing leaves the browser, but the queue is *retained*. Once the
  policy resolves the reporters flush via a subscription
  (`subscribeVitalsConsentPolicy`), so the early — and most valuable —
  LCP/FCP/TTFB samples and boot-time errors survive on installs where consent
  is not required. Reporting is never permanently disabled by a slow config
  load.
- **drop** — the queue is emptied so a later Accept cannot back-flush samples
  that pre-date the lawful basis (GDPR "lawful basis at time of collection").

#### No sample may cross a consent transition

Gating on the *decision* alone leaves a race. With `required` + `unknown`
consent, samples sit in the queue until the 2 s flush timer fires; if the user
clicks **Accept** inside that window the decision flips to `send` and those
**pre-consent** samples would ship.

Both reporters therefore subscribe to `subscribeConsent` as well as to the
policy, and **synchronously discard everything queued on any transition of the
user's decision** — in both directions:

| Transition | Effect |
| --- | --- |
| hold → accept | queue discarded; only post-accept samples ever ship |
| declined → accept (before the timer) | queue discarded |
| accept → decline | queue discarded |
| accept → accept (no change) | queue kept |

The discard runs inside `setConsent()`'s synchronous `cookie-consent-changed`
dispatch, so the queue is gone before any later code path can observe the new
(possibly permissive) decision and flush. `pagehide` / `visibilitychange`
flushes re-evaluate the decision, so an unload during `hold` or `drop` sends
nothing.

Consent changes are rare (a few per session at most) and samples are
re-collected continuously, so the cost is negligible next to the risk.

#### The cache is restrictive-only

The last resolved policy is cached in `localStorage` under
`teslasync:consent-policy:v1` with a timestamp and a 24h TTL, and is honoured
in **one direction only**:

| Cached value | Effect before the live policy resolves |
| --- | --- |
| `required` | may keep the gate closed (drop) |
| `not-required` | **ignored** — never authorises a send |

A permissive cache must never authorise, because an operator may have flipped
`require_cookie_consent` **on** since the last visit and the first page load
after that flip is exactly when the user has consented to nothing. A cached
`required` cannot authorise either: an already-accepted user still HOLDS (and
loses nothing) until the live policy lands. Both values are persisted so the
hint tracks the last known truth — a live `not-required` clears the restrictive
hint immediately. `unknown` is never persisted; corrupt/expired hints fall back
to no hint.

#### One publisher, mounted at the App root

`web/src/components/feedback/VitalsConsentPolicyGate.tsx` is the **only**
production caller of `setVitalsConsentPolicy` / `setVitalsConsentRequirement`.
It is mounted in `App` **above `<Routes>`**:

```tsx
<OnboardingGate />
<VitalsConsentPolicyGate />
<ScrollRestoration />
...
<Routes> … </Routes>
```

That placement matters. The publish used to live in `<CookieConsentBanner>`,
which only mounts under `<Layout>` — so on the standalone routes rendered
outside the shell (`/s/:token` public share links, `/watch`, `/onboarding`,
`/glance`, `/quick-stats`, `/year-review/:year`) the policy never resolved at
all. Those are precisely the surfaces handed to anonymous visitors.

The gate publishes `undefined` (→ `unknown` → hold) whenever `data` is
undefined, which covers both "query in flight" and "query failed with no
cached response". It publishes **explicitly to both reporters**:

```tsx
setVitalsConsentRequirement(resolved)      // resolved: boolean | undefined
setErrorReporterConsentRequirement(resolved)
```

`useVersionInfo()` is keyed `['version']`, so sharing it with the banner and
the status bar costs no extra request — TanStack Query dedupes by key, and the
banner no longer publishes anything.

#### The error reporter shares the same gate

`web/src/lib/errorReporter.ts` reads the **same store**, so the two gates
cannot drift apart:

| Decision | Error reporter behaviour |
| --- | --- |
| `hold` | buffer the report, transmit nothing, and do **not** drain the offline buffer — not even on an `online` event |
| `drop` | transmit nothing **and** destroy the buffer |
| `send` | POST, and drain anything buffered |

Holding rather than discarding matters here: `installGlobalErrorReporting()`
runs in `main.tsx` long before React mounts or the version query resolves, so
boot-time crashes — the most valuable reports there are — would otherwise be
lost. They wait in the buffer and are drained the moment the policy resolves to
a state that permits sending, or destroyed if it resolves to one that does not.

The in-app feedback ring (`getRecentReportsForFeedback`) is unaffected by all
of this: it never leaves the browser.

`__setErrorReporterEnabledForTests(true)` simulates a *production build*; it
does not bypass the consent gate.

---

## 4. Cardinality budget

| Label | Cap | Overflow value |
| --- | --- | --- |
| `route` | 80 distinct templates globally | `/__other__` |
| `route` | 4 **new** templates per request | `/__other__` |
| `release` | 12 distinct releases globally | `other` |
| `release` | 1 **new** release per request | `other` |
| route depth | 6 segments | truncated |
| route length | 50 chars | truncated at a segment boundary |

Admission is **sticky**: once a route is admitted it keeps its own series for
the process lifetime, so a route never flaps between its identity and the
overflow bucket.

### 4.1 Validate before admitting (anonymous-abuse control)

`POST /api/v1/web-vitals` is unauthenticated, so admission to the capped
registries is strictly two-phase (`internal/api/webvitals/handler.go`):

1. **Pass 1 — validate only.** Every metric is checked against the closed name
   set and the finite/non-negative/in-range value rules; every event against
   the closed kind/outcome sets. Nothing is admitted, no gauge is published,
   and no client-controlled label moves.
2. **Batch gate.** If nothing survived pass 1, the request is a **400
   `no valid samples`** and increments
   `teslasync_web_vitals_batches_rejected_total`. It consumes **zero** route or
   release capacity and mints **no** release/deployment annotation.
3. **Pass 2 — spend bounded budget.** Only now are routes admitted (max 4 new
   per request) and the release admitted (max 1 new per request, which is what
   publishes `teslasync_frontend_release_*`).

Route **shape** is checked before admission: a real SPA route always starts
with a word segment (`/dashboard`, `/drives/:id`). A template whose first
segment is an identifier (`/:id/...`) is a client bug or a probe, is never
given its own series, and is counted under `label_overflow_total{label="route_shape"}`.

**If `teslasync_frontend_label_overflow_total` is non-zero**, do NOT simply
raise the cap. It almost always means an identifier is escaping redaction —
check `frontend-rum-overview` → "Label cardinality overflow", then add the
missing pattern to `normalizeSegment` in **both**
`internal/api/webvitals/normalize.go` and
`web/src/lib/webVitalsReporter.ts`, and extend the parity test tables.

Client-side ceilings: 500 queued metrics, 500 queued events, batches chunked to
100 metrics + 100 events per request (matching the server's per-request caps).

---

## 5. Integration points

### 5.1 Mandatory (already wired)

`startWebVitalsReporter()` is called exactly once from `web/src/main.tsx`
(ADR-008 lock #6: RUM bootstraps in `main.tsx` only, never in pages). It
self-installs SPA navigation instrumentation by wrapping `history.pushState` /
`history.replaceState` and listening for `popstate`, so **no router, layout or
page file needs to change** to get `RouteChange` (route paint).

### 5.2 Navigation measurements are tokenized and immutable

Every navigation mints a frozen `NavigationToken { id, route, startedAt }`.
Measurements carry the token they started with and are **discarded, never
reattributed**, if a newer navigation has begun:

- A route-paint sample whose navigation was superseded before it painted is
  dropped — the elapsed time no longer describes a completed transition and the
  live route is not that token's route.
- `markContentReady(token)` returns `false` and records nothing when `token` is
  not the live navigation, or when this navigation already reported TTUC.

A rapid A→B→C navigation therefore produces exactly one route-paint sample,
attributed to C.

### 5.3 Gated: TTUC readiness

**`TTUC` has no automatic completion, and deliberately no SLO.**

Two animation frames after a URL change say nothing about whether the route's
primary data has rendered — auto-completing TTUC would fabricate the metric it
claims to measure. So `teslasync_frontend_time_to_usable_content_seconds` is
populated only by pages that opt in:

```tsx
import { currentNavigationToken, markContentReady } from '@/lib/webVitalsReporter'

const token = useRef(currentNavigationToken())
useEffect(() => {
  if (!isLoading && data) markContentReady(token.current)
}, [isLoading, data])
```

Capture the token when the page mounts (a `ref`, not a render-time read) so it
pins the measurement to the navigation that brought the user here.

Until pages are wired the histogram has no samples. slogen's ratio expression
falls back to `vector(1)` for an empty denominator, so an SLO over it would
report a permanent 100% success and a full error budget — a dishonest green
light. `cmd/slogen` `TestNoTTUCSLOUntilPagesAreWired` enforces its absence.

**Readiness gate — add the SLO only when all of these hold:**

1. `markContentReady(token)` is wired into at least the top 5 routes by
   traffic.
2. `sum(rate(teslasync_frontend_time_to_usable_content_seconds_count[1h])) > 0`
   in production for 7 consecutive days.
3. The observed p75 has been used to pick an objective, rather than copying
   LCP's 2.5s.

Then add the entry to `slo/catalog.yaml` (tags `[frontend, rum, navigation,
loading]`), regenerate, and delete `TestNoTTUCSLOUntilPagesAreWired`.

### 5.4 Automatic — resource load failures

`startWebVitalsReporter()` also attaches a capture-phase `error` listener that
records failed sub-resource loads (script, stylesheet, image, font) as
`{kind: 'resource', outcome: 'failure', route}`. The failing **URL is never
sent** — only the bounded triple — so a signed asset URL or CDN token can never
reach a Prometheus label.

### 5.5 Optional — UX events

```ts
import { reportUxEvent } from '@/lib/webVitalsReporter'

reportUxEvent({ kind: 'query', outcome: 'failure', route: window.location.pathname })
reportUxEvent({ kind: 'cache', outcome: 'hit', route: '/dashboard' })
reportUxEvent({ kind: 'cancellation', outcome: 'cancelled', route: '/drives/42' })
```

Values outside the closed sets are dropped client-side, so a typo costs a
metric, never a cardinality incident.

---

## 6. Dashboards

| Dashboard | UID | Source |
| --- | --- | --- |
| Frontend: RUM overview | `frontend-rum-overview` | hand-maintained JSON |
| Frontend: synthetic journeys | `frontend-synthetic-journeys` | hand-maintained JSON |
| SLO: frontend_* (one per SLO) | `slo-frontend_*` | generated by `cmd/slogen` |
| SLO: overview | `slo-overview` | generated by `cmd/slogen` |

All live in `helm/teslasync/files/grafana/dashboards/` and are rendered into
the `…-grafana-dashboards-slo` ConfigMap. The generated ones are regenerated
by:

```bash
go run ./cmd/slogen validate slo/catalog.yaml
go run ./cmd/slogen generate recording
go run ./cmd/slogen generate alerts
go run ./cmd/slogen generate dashboards
```

Never hand-edit a `slo-*.json` file — edit `slo/catalog.yaml` and regenerate.
The two `frontend-*.json` dashboards are NOT generated and are safe to edit.

> The dashboards ConfigMap is ~300 KB rendered. Kubernetes caps a ConfigMap at
> 1 MB; if that ceiling is approached, split the provider into a second
> ConfigMap rather than deleting dashboards.

### Synthetic journeys — metric contract, no credentials

`frontend-synthetic-journeys.json` contains **no probe targets, cookies,
bearer tokens or basic-auth material**. Dashboards are checked into git and
rendered into a ConfigMap; credentials belong in the prober's own Kubernetes
Secret. The dashboard only reads this contract, which any prober
(blackbox_exporter, k6, a Playwright exporter) can publish:

```
probe_success{journey,step,env}                            gauge   1 = pass
probe_duration_seconds{journey,step,env}                   gauge   SECONDS
probe_http_status_code{journey,step,env}                   gauge
teslasync_synthetic_journey_runs_total{journey,env,result} counter result=success|failure
```

`journey`, `step` and `env` must be closed, kebab-case sets. Never label a
probe series with a VIN, user id, session id, coordinate or raw URL.

Until a prober publishing this contract is deployed the panels render
"No data" — that is the intended contract-first state.

---

## 7. Responding to an alert

Burn-rate alerts are generated per SLO by `cmd/slogen generate alerts`
(multi-window multi-burn-rate, Google SRE Workbook ch. 5). The generic
procedure is in
[`phase-44-respond-to-burn-alert.md`](phase-44-respond-to-burn-alert.md). RUM
specifics:

1. **Check the ingest first.** `frontend-rum-overview` → "RUM samples/s". If it
   is zero, no user experience regressed — the telemetry did. Look at
   `teslasync_web_vitals_samples_rejected_total{reason}` and
   `teslasync_web_vitals_batches_rejected_total`:
   - `invalid_payload` / `unknown_name` → client and server contracts drifted
     (usually a reporter change deployed without the handler change).
   - `value_out_of_range` / `non_finite_value` → broken client clock.
   - `unknown_ux_kind` / `unknown_ux_outcome` → a caller invented a label.
   - a rising `batches_rejected_total` with flat ingest → someone is POSTing
     junk at the public endpoint; it consumes no cardinality, but confirm the
     per-IP rate limit is doing its job.
   If samples are zero and rejections are ALSO zero, suspect the consent gate:
   the policy may be stuck at `unknown` because `/system/version` is failing,
   which holds every batch by design (§3.3). Note this is now visible on
   standalone routes too — `<VitalsConsentPolicyGate>` mounts at the App root,
   so a `/s/:token` or `/watch` session resolves the same policy as the shell.
   Also check the `frontend_rum_ingest_availability` SLO — a 5xx on the ingest
   route blinds every other frontend SLO.
2. **Attribute to a release.** Every frontend dashboard annotates deploys. If
   the regression starts exactly at an annotation, you have your change.
3. **Attribute to a route.** Each `slo-frontend_*` dashboard has a "p75 by
   route template" panel. A single route regressing points at a page; all
   routes regressing points at the shell, a shared bundle, or the API.
4. **Attribute to a segment.** "good share by device class" and
   "good share by effective connection" separate "the app got slower" from
   "our traffic mix shifted to slower devices/networks". A shifting mix is not
   an error-budget event — note it and consider re-baselining the objective.
5. **INP specifically**: check `teslasync_frontend_ux_events_total{kind="query"}`
   and `{kind="retry"}` — main-thread contention from retry storms is the most
   common cause of an INP regression that no code change explains.
6. **TTFB specifically**: this is a backend signal wearing a frontend hat.
   Cross-check `api_availability` and `api_latency_p99_500ms` before
   investigating the SPA at all.

---

## 8. Tests that pin this contract

| Test | What it prevents |
| --- | --- |
| `internal/api/webvitals` `TestGeneratedRoutePathsMatchWebRegistry` | the backend route table drifting from `web/src/lib/routeRegistry.ts` |
| `cmd/routetemplategen` `TestSyntheticParamRouteBreaksTheDriftGate` | the Go drift gate silently passing when a `:param` route is added |
| `cmd/routetemplategen` `TestFindModuleRoot`, `TestResolvePath` | `go generate` resolving paths against the wrong working directory |
| `web/src/lib/__tests__/routeRegistryFreshness.test.ts` | the App.tsx → routeRegistry.ts gate silently passing on drift (drives the real CLI) |
| `internal/api/weberrors` `TestRouteLabelIsCardinalityBounded`, `TestPerRequestAdmissionBudget`, `TestSurfacesDoNotStarveEachOther`, `TestOverflowLabelIsClosed` | unbounded `{route}` cardinality on web-errors; one surface starving the other |
| `internal/api/webvitals` `TestEveryParameterisedRouteIsTemplated` | ANY `:param` position leaking an opaque slug into a label |
| `internal/api/webvitals` `TestLiteralRoutePrecedence`, `TestNormalizeRoute_PercentEncoding`, `TestNormalizeRoute_ProtocolRelative` | literal routes resolving through a param shape; encoded/malformed/authority smuggling |
| `internal/api/weberrors` `TestWebErrorsUsesSharedRouteNormalizer`, `TestIngestTemplatesTheRouteLabel` | the two ingest surfaces normalising differently |
| `cmd/routetemplategen` | a non-deterministic or malformed generated artifact |
| `internal/api/webvitals` `TestSLOCatalogReferencesRegisteredMetrics` | an SLO pointing at a metric that does not exist |
| `internal/api/webvitals` `TestTimeMetricsUseSecondsUnit` | ms values landing in a `_seconds` histogram |
| `internal/api/webvitals` `TestNormalizeRoute_PrivacyRedaction` / `…_NeverLeaksRawIdentifiers` | VIN / ID / coordinate / e-mail leakage |
| `internal/api/webvitals` `TestIngest_RouteCardinalityIsBounded`, `TestBoundedRegistry_CapsDistinctValues` | cardinality explosion |
| `internal/api/webvitals` `TestBoundedRegistry_PerRequestBudget`, `TestIngest_SingleBatchCannotAdmitManyRoutes` | one request burning the global cap |
| `internal/api/webvitals` `TestIngest_InvalidBatchConsumesNoRouteCapacity` | an anonymous junk batch consuming capacity |
| `internal/api/webvitals` `TestIngest_ReleaseAdmittedOnlyAfterAcceptedContent` | a junk batch minting a deploy annotation |
| `internal/api/webvitals` `TestIngest_IdentifierOnlyRoutesNeverAdmitted`, `TestIsAdmissibleRouteTemplate` | probe paths taking real series |
| `internal/api/webvitals` `TestAllRUMMetricsAreRegistered` | a metric silently dropped from the registry |
| `internal/api/webvitals` `TestIngestPayloadRoundTripsWireContract` | a renamed JSON field silently dropping telemetry |
| `cmd/slogen` `TestFrontendSLOThresholdsUseCorrectUnits` | a threshold in the wrong unit |
| `cmd/slogen` `TestNoTTUCSLOUntilPagesAreWired` | a dishonest SLO over an empty denominator |
| `cmd/slogen` `TestFrontendDashboardHasReleaseAnnotationAndRUMPanels` | losing deploy annotations / charting the wrong histogram |
| `cmd/slogen` `TestNonFrontendDashboardsUnchanged` | frontend specialisation churning unrelated dashboards |
| `cmd/slogen` `TestReleaseAnnotationCarriesNoCredentials` | credentials in a checked-in dashboard |
| `web/src/lib/__tests__/routeTemplate.test.ts` | a registry `:param` (share token, year, entity id) surviving into a label or a buffered payload; URL query/hash residue in free text |
| `web/src/lib/__tests__/webVitalsConsent.test.ts` | consent failing open before the policy resolves; a permissive cache authorising a send; corrupt/stale hints |
| `web/src/lib/__tests__/webVitalsRum.test.ts` (`consent transition races`) | a sample crossing hold→accept, declined→accept before the timer, accept→decline, or a `pagehide` unload |
| `web/src/lib/__tests__/errorReporterConsent.test.ts` | early boot errors sending before the policy resolves; the offline buffer draining while unresolved; buffered reports crossing a consent transition; a raw share token / query / hash reaching memory, web storage or the wire |
| `web/src/components/feedback/__tests__/VitalsConsentPolicyGate.test.tsx` | loading/error not holding; not publishing `unknown` to both reporters; not republishing a mid-session flip |
| `web/src/App.consent.test.tsx` | the policy never resolving on `/s/:token` and `/watch` (standalone, no `<Layout>`) |
| `web/src/lib/__tests__/webVitalsRum.test.ts` (`rapid navigation`) | route/TTUC misattribution across fast navigations |
| `web/src/lib/__tests__/webVitalsRum.test.ts` | client/server normalisation parity, closed sets, batch chunking |

Run them with:

```bash
go run ./cmd/routetemplategen --check          # route-table drift gate
go test ./internal/api/webvitals/ ./internal/api/weberrors/ ./cmd/routetemplategen/ ./cmd/slogen/
cd web && npx vitest run \
  src/lib/__tests__/routeTemplate.test.ts \
  src/lib/__tests__/webVitalsRum.test.ts \
  src/lib/__tests__/webVitalsReporter.test.ts \
  src/lib/__tests__/webVitalsConsent.test.ts \
  src/lib/__tests__/errorReporter.test.ts \
  src/lib/__tests__/errorReporterConsent.test.ts \
  src/components/feedback/__tests__/VitalsConsentPolicyGate.test.tsx \
  src/App.consent.test.tsx
helm lint helm/teslasync && helm template test helm/teslasync --set grafana.enabled=true >/dev/null
```

---

## 9. Adding a new RUM metric

1. Add the spec to `vitalsSpecs` in `internal/api/webvitals/metrics.go` (name,
   histogram, divisor, sanity ceiling). The map is the *only* allow-list — the
   accepted-name set and the histogram set cannot drift apart.
2. Emit it from `web/src/lib/webVitalsReporter.ts` through `pushMetric`.
3. Add the SLO to `slo/catalog.yaml` with the `frontend` and `rum` tags and a
   threshold in the histogram's unit.
4. Regenerate (§6) and extend the test tables in §8.

## 10. Adding a new SPA route

If the route has a `:param`, the backend route table MUST be regenerated or the
parameter will land in a Prometheus label:

```bash
cd web && node scripts/generate-route-registry.mjs   # App.tsx -> routeRegistry.ts
cd ..  && go generate ./internal/api/webvitals       # routeRegistry.ts -> Go artifact
go test ./internal/api/webvitals/                    # drift gate + param coverage
```

Both `--check` gates run in the `contract` job of `frontend-quality.yml` on
`main` and `revamped-ui`, so forgetting either step fails the build.

Related: [`phase-44-add-new-slo.md`](phase-44-add-new-slo.md),
[`phase-44-metrics-conventions.md`](phase-44-metrics-conventions.md).
