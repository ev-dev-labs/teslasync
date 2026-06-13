// Pure, framework-free model + projection + diagnostics for the FreshnessIndicator shared surface — the
// native analogue of every decision the web component makes (web/src/components/data-display/
// FreshnessIndicator.tsx) before it paints. No Compose, no Android framework, no platform clock, no HTTP:
// every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions (the accepted sibling-surface contract).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive that reports the age of a SPECIFIC DATA POINT. The parent owns the
//     `timestamp` of the underlying datum and passes it in as a prop; the component's only hooks are an
//     internal 10s re-render ticker and `useState`. So there is NO data port to bind (no P1/S8 state
//     holder, no Source/ViewModel) — modelling one would invent a fetch the web spec does not have
//     (honesty covenant: no scope narrowing, no silent drift). The sibling presentational ports
//     BatteryDelta / AnimatedNumber / VisuallyHidden document the same rationale (composable + model, no
//     Source). The prompt's single listed data source, `useIsStale`, is itself defined IN the same web
//     file as a pure time-math hook (no network); it is reproduced here as [freshnessStaleness] and bound
//     by the composable's [rememberFreshnessStaleness] clock — that IS the state-holder for this surface.
//   • `computeAge` → seconds since the timestamp, floored at 0, or `null` when absent ([freshnessAgeSeconds]).
//   • `getStatus` → fresh (< staleThreshold) / stale (< offlineThreshold) / offline / unknown (no timestamp)
//     ([FreshnessStatus] via [freshnessStatus]). The dot paints success / warning / danger / muted from this.
//   • `formatAge` → "—" (unknown) / "just now" (< 10s) / "Ns ago" (< 60s) / "Nm ago" (< 1h) / "Nh ago"
//     ([FreshnessAgeLabel] via [freshnessAgeLabel]). Because the web hardcodes these English strings (no
//     `t()` call — the prompt extracts ZERO i18n keys), the pure model carries only the i18n-FRIENDLY
//     descriptor and the render layer resolves the localized text from the shared P1/S10 catalog, so no
//     English microcopy lives here (the em-dash is a typographic symbol, not a word — a constant, exactly
//     like the BatteryDelta dash).
//   • `useIsStale(timestamp, staleThreshold = 120)` → `{ isStale, isOffline, ageLabel }` where `isOffline`
//     is keyed off a HARDCODED 600s in the web source (not the caller threshold). Reproduced verbatim by
//     [freshnessStaleness] + [FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS].
//
// The surface's reproduced STATES are the four FreshnessStatus branches: fresh (the live state), stale and
// offline (genuine web branches, surfaced amber / red), and unknown — the "no value" / pre-first-data
// branch that doubles as the empty AND loading state (a parent that has not yet resolved a timestamp passes
// `null`, exactly as the web `!timestamp` path renders the muted dot + em-dash). The generic error /
// in-flight-fetch lifecycle is intentionally absent: this surface fetches nothing, so an error or a loading
// spinner would fabricate behaviour the web spec does not have. Each branch is reduced here and asserted in
// the off-device test, which therefore doubles as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/FreshnessIndicator — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.freshnessindicator

import io.teslasync.shared.core.diagnostics.Logger

/** The em-dash shown when there is no timestamp to age (web `formatAge(null) = '—'`). A symbol, not a word. */
const val FRESHNESS_INDICATOR_DASH: String = "\u2014"

/**
 * Age tier of the single data point — the native mirror of the web `FreshnessStatus`
 * (`'fresh' | 'stale' | 'offline' | 'unknown'`). The render boundary maps this onto the dot colour
 * (success / warning / danger / muted) and decides whether the dot pulses.
 */
enum class FreshnessStatus {
    /** Younger than the stale threshold — web `'fresh'` (green, pulsing). */
    Fresh,

    /** At/after the stale threshold but before offline — web `'stale'` (amber). */
    Stale,

    /** At/after the offline threshold — web `'offline'` (red). */
    Offline,

    /** No timestamp available — web `'unknown'` (muted dot, em-dash label). */
    Unknown,
}

/**
 * Size variant — the native tag for the web `size` prop (`'sm' | 'md'`). Drives the dot diameter and the
 * label type ramp at the render boundary; carries no behaviour, so it lives purely as a tag.
 */
enum class FreshnessIndicatorSize {
    /** Web `size="sm"` (default) — 6dp dot, label-small text. */
    Sm,

    /** Web `size="md"` — 8dp dot, label-medium text. */
    Md,
}

/**
 * The i18n-friendly relative-age bucket — which localized catalog string the render layer resolves and with
 * what numeric argument. Kept framework-free (no Compose, no English microcopy) so the off-device test
 * verifies the web `formatAge` cutoffs without a Compose host; the composable maps each bucket to a P1/S10
 * key (`freshness.justNow` / `freshness.seconds` / `freshness.minutes` / `freshness.hours`).
 */
sealed interface FreshnessAgeLabel {
    /** Web `formatAge(null) = '—'`: no timestamp → the em-dash, no localized word. */
    data object Unknown : FreshnessAgeLabel

    /** Web `age < 10 → 'just now'`. */
    data object JustNow : FreshnessAgeLabel

    /** Web `age < 60 → '${age}s ago'`; [value] is the raw age in seconds. */
    data class Seconds(
        val value: Long,
    ) : FreshnessAgeLabel

    /** Web `age < 3600 → '${floor(age / 60)}m ago'`; [value] is whole minutes. */
    data class Minutes(
        val value: Long,
    ) : FreshnessAgeLabel

    /** Web `else → '${floor(age / 3600)}h ago'`; [value] is whole hours. */
    data class Hours(
        val value: Long,
    ) : FreshnessAgeLabel
}

/**
 * The accessible-description descriptor — which localized string the render layer resolves for the surface's
 * single semantics node. The web source carries no `aria-label` (only a `title` tooltip with the raw
 * timestamp + a colour-only dot), so the native port lifts the spoken description to convey the same meaning
 * accessibly: the recency for a present datum, and a friendly "never updated" instead of a meaningless
 * em-dash for the unknown / empty branch (the prompt's "never a blank box" rule). Both keys resolve through
 * the shared P1/S10 catalog.
 */
sealed interface FreshnessA11y {
    /** Unknown / empty branch: `a11y = neverUpdated` ("Never updated") rather than the visible em-dash. */
    data object NeverUpdated : FreshnessA11y

    /** Present datum: `a11y = a11y.dataFreshness` ("Data freshness: {ageLabel}") carrying the [ageLabel]. */
    data class Freshness(
        val ageLabel: FreshnessAgeLabel,
    ) : FreshnessA11y
}

/**
 * The result of the web `useIsStale` hook — `{ isStale, isOffline, ageLabel }`. The native composable
 * exposes this through [rememberFreshnessStaleness]; callers (e.g. warning banners) read it to decide
 * whether to surface a "data may be stale" affordance, exactly as the web hook is used.
 *
 * @property isStale the datum is at/after the caller's stale threshold (web `age >= staleThreshold`).
 * @property isOffline the datum is at/after the fixed offline window (web `age >= 600`, NOT the caller value).
 * @property ageLabel the relative-age bucket to render (web `formatAge(age)`).
 */
data class FreshnessStaleness(
    val isStale: Boolean,
    val isOffline: Boolean,
    val ageLabel: FreshnessAgeLabel,
)

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs, derived
 * purely so every branch is covered off-device. The view only resolves the dot colour, the localized label,
 * and the accessible string, then lays out the dot + label.
 *
 * @property status the age tier (web `getStatus`), driving the dot colour and the pulse.
 * @property ageLabel the relative-age bucket for the visible label (web `formatAge`).
 * @property a11y which localized accessible description to resolve, and its argument.
 */
data class FreshnessIndicatorProjection(
    val status: FreshnessStatus,
    val ageLabel: FreshnessAgeLabel,
    val a11y: FreshnessA11y,
)

/**
 * The web-default knobs, kept as named constants so the composable and the unit gate agree on one source of
 * truth — no loose numerals drift between the render layer and its tests.
 */
object FreshnessIndicatorDefaults {
    /** Seconds before the datum is "stale" — web `staleThreshold = 120`. */
    const val STALE_THRESHOLD_SECONDS: Long = 120

    /** Seconds before the datum is "offline" — web `offlineThreshold = 600` (also the hardcoded `useIsStale` window). */
    const val OFFLINE_THRESHOLD_SECONDS: Long = 600

    /** Re-render cadence that keeps the relative label fresh — web `setInterval(…, 10_000)`. */
    const val TICK_INTERVAL_MS: Long = 10_000
}

private const val JUST_NOW_SECONDS: Long = 10
private const val SECONDS_PER_MINUTE: Long = 60
private const val SECONDS_PER_HOUR: Long = 3_600

/**
 * Seconds between [timestampMillis] and [nowMillis], floored at 0 — the native mirror of the web
 * `computeAge` (`Math.max(0, Math.floor((Date.now() - new Date(timestamp)) / 1000))`). Returns `null` when
 * there is no timestamp (web `!timestamp`); a future timestamp (negative delta) clamps to 0, exactly as the
 * web `Math.max(0, …)` does. Takes epoch millis rather than an ISO string — the idiomatic native
 * parse-at-the-boundary adaptation the sibling `FreshnessIndicator` atom also uses.
 */
fun freshnessAgeSeconds(
    timestampMillis: Long?,
    nowMillis: Long,
): Long? {
    if (timestampMillis == null) return null
    val deltaMs = nowMillis - timestampMillis
    return if (deltaMs <= 0L) 0L else deltaMs / 1_000L
}

/**
 * Classifies an [ageSeconds] into fresh / stale / offline / unknown — the native mirror of the web
 * `getStatus` ternary. A `null` age (no timestamp) is [FreshnessStatus.Unknown]; otherwise the thresholds
 * select Fresh (`< staleThreshold`), Stale (`< offlineThreshold`), or Offline.
 */
fun freshnessStatus(
    ageSeconds: Long?,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
    offlineThresholdSeconds: Long = FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS,
): FreshnessStatus {
    if (ageSeconds == null) return FreshnessStatus.Unknown
    return when {
        ageSeconds < staleThresholdSeconds -> FreshnessStatus.Fresh
        ageSeconds < offlineThresholdSeconds -> FreshnessStatus.Stale
        else -> FreshnessStatus.Offline
    }
}

/**
 * Buckets an [ageSeconds] into the relative-age label — the native mirror of the web `formatAge` cutoffs
 * (`null → '—'`, `< 10 → 'just now'`, `< 60 → 'Ns ago'`, `< 3600 → 'Nm ago'`, else `'Nh ago'`). Integer
 * division floors for the non-negative age, matching the web `Math.floor`.
 */
fun freshnessAgeLabel(ageSeconds: Long?): FreshnessAgeLabel {
    if (ageSeconds == null) return FreshnessAgeLabel.Unknown
    return when {
        ageSeconds < JUST_NOW_SECONDS -> FreshnessAgeLabel.JustNow
        ageSeconds < SECONDS_PER_MINUTE -> FreshnessAgeLabel.Seconds(ageSeconds)
        ageSeconds < SECONDS_PER_HOUR -> FreshnessAgeLabel.Minutes(ageSeconds / SECONDS_PER_MINUTE)
        else -> FreshnessAgeLabel.Hours(ageSeconds / SECONDS_PER_HOUR)
    }
}

/**
 * The accessible-description descriptor for a [status] + [ageLabel] — the unknown branch resolves to
 * [FreshnessA11y.NeverUpdated] (a friendly spoken empty-state instead of the visible em-dash); any present
 * datum resolves to [FreshnessA11y.Freshness] carrying the age bucket for the "Data freshness: …" template.
 */
fun freshnessA11y(
    status: FreshnessStatus,
    ageLabel: FreshnessAgeLabel,
): FreshnessA11y =
    if (status == FreshnessStatus.Unknown) {
        FreshnessA11y.NeverUpdated
    } else {
        FreshnessA11y.Freshness(ageLabel)
    }

/**
 * The native port of the web `useIsStale(timestamp, staleThreshold = 120)` — the pure half (the composable
 * [rememberFreshnessStaleness] adds the 10s clock). `isStale` uses the caller [staleThresholdSeconds];
 * `isOffline` uses the FIXED [FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS] (600), reproducing the
 * web hook's hardcoded `age >= 600` rather than the caller threshold. A `null` timestamp yields both flags
 * `false` and an [FreshnessAgeLabel.Unknown] label (web `age !== null && …`).
 */
fun freshnessStaleness(
    timestampMillis: Long?,
    nowMillis: Long,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
): FreshnessStaleness {
    val ageSeconds = freshnessAgeSeconds(timestampMillis, nowMillis)
    return FreshnessStaleness(
        isStale = ageSeconds != null && ageSeconds >= staleThresholdSeconds,
        isOffline = ageSeconds != null && ageSeconds >= FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS,
        ageLabel = freshnessAgeLabel(ageSeconds),
    )
}

/**
 * Reduce a [timestampMillis] (relative to [nowMillis]) + thresholds into the render-ready
 * [FreshnessIndicatorProjection]. Pure (no Compose), so every state — fresh / stale / offline / unknown — is
 * covered by the off-device gate and the composable stays a thin render layer.
 */
fun projectFreshnessIndicator(
    timestampMillis: Long?,
    nowMillis: Long,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
    offlineThresholdSeconds: Long = FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS,
): FreshnessIndicatorProjection {
    val ageSeconds = freshnessAgeSeconds(timestampMillis, nowMillis)
    val status = freshnessStatus(ageSeconds, staleThresholdSeconds, offlineThresholdSeconds)
    val ageLabel = freshnessAgeLabel(ageSeconds)
    return FreshnessIndicatorProjection(
        status = status,
        ageLabel = ageLabel,
        a11y = freshnessA11y(status, ageLabel),
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * timestamp, age, or status — so a diagnostics line can never leak when a vehicle last reported a signal or
 * whether its data is stale. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it once per surface open.
 */
object FreshnessIndicatorDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "FreshnessIndicator"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
