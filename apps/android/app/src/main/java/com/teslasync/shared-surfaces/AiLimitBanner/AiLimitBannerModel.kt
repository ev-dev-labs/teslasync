// Pure, framework-free model + reason taxonomy + countdown reducer + surface classifier for the AiLimitBanner
// shared surface — the native analogue of every decision the web component makes
// (web/src/components/ai/AiLimitBanner.tsx) before it paints its alert. No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL banner. The parent owns the data (the `limit` field of useAiStream) and supplies
//     the callbacks ("Use baseline" / "Retry" / dismiss); the banner's only hook is useTranslation. So there
//     is no data port to bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a
//     fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The closest
//     sibling precedent is the equally presentational RouteAnnouncer (composable + model, no Source/ViewModel).
//   • `info == null` → the web returns `null` (renders nothing). Native mirror: [BannerSurface.Hidden].
//   • `info != null` → the alert is shown. Its severity is chosen from `bannerLevel`
//     (`warn`→warning, `critical`→danger, `''`→info); its heading + body are chosen from the `reason`
//     taxonomy (a closed set of copy buckets with a forward-compatible generic fallback, ADR-015 §I9); a live
//     countdown ticks once per second while `retryAfterS > 0`; the "Retry" action appears only once the
//     countdown reaches zero (or none was set); the "Use baseline" action appears only when
//     `baselineAvailable` and a handler was supplied. All of that is reduced here in [classify].
//
// Why the generic data-surface states (loading / stale / offline) are intentionally absent: this surface
// fetches nothing — it IS the terminal notice shown when an AI call was already rejected. Its real, fully
// reproduced states are the Hidden surface and the Active surface's branches (severity × reason × counting-
// down/retry-ready × which actions are offered), each reduced here and asserted in the off-device test. The
// one state the surface owns over time, the countdown, is reduced by [decrementSeconds] so the per-tick
// transition is verified without a Compose clock.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AiLimitBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling RouteAnnouncer / AIDriveCoaching surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailimitbanner

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no reason, message, retry
 * timing, or any other payload, so a diagnostics line can never leak the operator's AI usage state.
 */
const val AI_LIMIT_BANNER_SLUG: String = "AiLimitBanner"

/**
 * The structured rate-limit / cost-cap info the parent hands the banner — the native mirror of the web
 * `AiLimitInfo` (web/src/hooks/useAiStream.ts) parsed from a terminal `error` SSE frame. Carried verbatim from
 * the owning screen; the banner never fetches it.
 *
 * @property reason the backend Decision.Reason taxonomy token (e.g. `cost_cap`, `per_minute`); drives the
 *   localized heading + body via [reasonCopy]. Unknown tokens fall back to [LimitReasonCopy.Generic].
 * @property retryAfterS seconds until a retry could succeed; `> 0` shows a live countdown and hides Retry until
 *   it elapses. Clamped to `>= 0` by [clampRetrySeconds].
 * @property bannerLevel the backend-suggested severity; maps to a [BannerSeverity] via [severityFor].
 * @property baselineAvailable whether the page can fall back to its non-AI baseline (ADR-015 §I3); gates the
 *   "Use baseline" action.
 * @property message the raw human-readable provider message. Carried for parity but deliberately NOT rendered:
 *   the stable, searchable [reason] copy is shown instead (ADR-015 §I9), and the raw message is kept out of UI
 *   and diagnostics so a provider string can never leak.
 */
data class AiLimitInfo(
    val reason: String,
    val retryAfterS: Int,
    val bannerLevel: BannerLevel,
    val baselineAvailable: Boolean,
    val message: String = "",
)

/** The backend-suggested banner severity — the native mirror of the web `bannerLevel: 'warn' | 'critical' | ''`. */
enum class BannerLevel {
    /** `warn` — an amber, recoverable limit (e.g. a per-minute window that resets shortly). */
    Warn,

    /** `critical` — a red, hard stop (e.g. the daily cost cap). */
    Critical,

    /** `''` — no explicit level; the banner falls back to the informational treatment. */
    None,
}

/**
 * Parse the wire value into a [BannerLevel] (web `bannerLevel` narrowing). Any unrecognized or absent value
 * collapses to [BannerLevel.None] — the informational default — so a forward-compatible client never crashes
 * on a new backend level.
 */
fun bannerLevelFromWire(raw: String?): BannerLevel =
    when (raw) {
        "warn" -> BannerLevel.Warn
        "critical" -> BannerLevel.Critical
        else -> BannerLevel.None
    }

/** The render-ready severity the banner paints with — the native mirror of the web AlertBanner `variant`. */
enum class BannerSeverity {
    /** Cyan informational treatment (web `variant="info"`). */
    Info,

    /** Amber warning treatment (web `variant="warning"`). */
    Warning,

    /** Red danger treatment (web `variant="danger"`). */
    Danger,
}

/**
 * Map a [BannerLevel] to its render [BannerSeverity] — a 1:1 port of the web variant selection
 * (`critical` → danger, `warn` → warning, otherwise → info).
 */
fun severityFor(level: BannerLevel): BannerSeverity =
    when (level) {
        BannerLevel.Critical -> BannerSeverity.Danger
        BannerLevel.Warn -> BannerSeverity.Warning
        BannerLevel.None -> BannerSeverity.Info
    }

/**
 * The closed set of heading/body copy buckets keyed off the backend `reason` — the native mirror of the web
 * `titleForReason` / `descriptionForReason` switches. The view maps each bucket to its i18n string pair
 * (P1/S10); new backend reasons MUST get a bucket here AND a catalog row, and an unknown reason resolves to
 * [Generic] so a forward-compatible client still renders something sane.
 */
enum class LimitReasonCopy {
    /** `cost_cap` — the daily cost cap was reached. */
    CostCap,

    /** `cost_cap_unavailable` — the usage history could not be read; failing closed. */
    CostCapUnavailable,

    /** `settings_unavailable` — the AI settings could not be loaded; AI paused. */
    SettingsUnavailable,

    /** `burst` — too many concurrent requests in flight. */
    Burst,

    /** `per_minute` — the per-minute request window was exceeded. */
    PerMinute,

    /** `per_day` — the daily request budget was exhausted. */
    PerDay,

    /** `input_tokens` / `output_tokens` — the per-minute token quota was exhausted. */
    Tokens,

    /** `provider_unavailable` — the AI provider is not responding. */
    ProviderUnavailable,

    /** `missing_feature_id` / `unknown_feature_id` — the page's AI feature registration is misconfigured. */
    FeatureMisconfigured,

    /** Any other / absent reason — the generic temporarily-unavailable fallback. */
    Generic,
}

/**
 * Map a backend `reason` token to its [LimitReasonCopy] bucket — a 1:1 port of the web `titleForReason` switch
 * (including the shared `input_tokens`/`output_tokens` and `missing_feature_id`/`unknown_feature_id` buckets
 * and the `default` → [LimitReasonCopy.Generic] fallback).
 */
fun reasonCopy(reason: String): LimitReasonCopy =
    when (reason) {
        "cost_cap" -> LimitReasonCopy.CostCap
        "cost_cap_unavailable" -> LimitReasonCopy.CostCapUnavailable
        "settings_unavailable" -> LimitReasonCopy.SettingsUnavailable
        "burst" -> LimitReasonCopy.Burst
        "per_minute" -> LimitReasonCopy.PerMinute
        "per_day" -> LimitReasonCopy.PerDay
        "input_tokens", "output_tokens" -> LimitReasonCopy.Tokens
        "provider_unavailable" -> LimitReasonCopy.ProviderUnavailable
        "missing_feature_id", "unknown_feature_id" -> LimitReasonCopy.FeatureMisconfigured
        else -> LimitReasonCopy.Generic
    }

/** Clamp a raw `retryAfterS` to a non-negative countdown start (a negative wire value is treated as ready). */
fun clampRetrySeconds(seconds: Int): Int = seconds.coerceAtLeast(0)

/**
 * Reduce one countdown tick — the native mirror of the web `setSecondsLeft((s) => (s > 0 ? s - 1 : 0))` that
 * runs once per second. Saturates at zero so the timer never goes negative.
 */
fun decrementSeconds(seconds: Int): Int = if (seconds > 0) seconds - 1 else 0

/** True once the countdown has elapsed — the web `retryReady = secondsLeft <= 0`; the gate for the Retry action. */
fun isRetryReady(seconds: Int): Boolean = seconds <= 0

/**
 * Which optional affordances the Active banner offers, derived purely from the countdown + parent intent — the
 * native mirror of the web conditional renders.
 *
 * @property showCountdown the "Try again in Ns" line — shown while the countdown is running (web `!retryReady`).
 * @property showBaseline the "Use baseline" action — shown when the page can fall back AND supplied a handler
 *   (web `onUseBaseline && info.baselineAvailable`).
 * @property showRetry the "Retry" action — shown when a handler was supplied AND the countdown has elapsed
 *   (web `onRetry && retryReady`).
 */
data class BannerActions(
    val showCountdown: Boolean,
    val showBaseline: Boolean,
    val showRetry: Boolean,
)

/**
 * Resolve the [BannerActions] for the current countdown + parent intent. Pure (no Compose): [hasRetry] /
 * [hasBaseline] are whether the parent supplied the respective handler, mirroring the web truthiness checks on
 * `onRetry` / `onUseBaseline`.
 */
fun resolveActions(
    secondsLeft: Int,
    baselineAvailable: Boolean,
    hasRetry: Boolean,
    hasBaseline: Boolean,
): BannerActions =
    BannerActions(
        showCountdown = clampRetrySeconds(secondsLeft) > 0,
        showBaseline = hasBaseline && baselineAvailable,
        showRetry = hasRetry && isRetryReady(secondsLeft),
    )

/**
 * The render-ready classification of the banner — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface BannerSurface {
    /** `info == null` → the banner renders nothing (web returns `null`). */
    data object Hidden : BannerSurface

    /**
     * `info != null` → the alert is shown. Carries everything the render layer needs: the [severity] tint, the
     * [reason] copy bucket, the live [secondsLeft], and the resolved [actions].
     */
    data class Active(
        val severity: BannerSeverity,
        val reason: LimitReasonCopy,
        val secondsLeft: Int,
        val actions: BannerActions,
    ) : BannerSurface
}

/**
 * Select the render-ready [BannerSurface] for [info] at the current [secondsLeft]. Pure (no Compose/clock): the
 * composable supplies the live countdown and whether each handler is present ([hasRetry] / [hasBaseline]). A
 * `null` [info] collapses to [BannerSurface.Hidden] (web `null`); otherwise the severity, reason copy, clamped
 * countdown, and actions are reduced into [BannerSurface.Active].
 */
fun classify(
    info: AiLimitInfo?,
    secondsLeft: Int,
    hasRetry: Boolean,
    hasBaseline: Boolean,
): BannerSurface {
    if (info == null) return BannerSurface.Hidden
    val clamped = clampRetrySeconds(secondsLeft)
    return BannerSurface.Active(
        severity = severityFor(info.bannerLevel),
        reason = reasonCopy(info.reason),
        secondsLeft = clamped,
        actions = resolveActions(clamped, info.baselineAvailable, hasRetry, hasBaseline),
    )
}

/**
 * Build the merged accessibility announcement for the alert from already-localized parts (the view resolves
 * the heading, body, and optional countdown line through i18n). Kept pure so TalkBack-label presence is unit-
 * tested without a Compose host. [countdown] is `null` when the timer has elapsed (no countdown line shown).
 */
fun bannerAccessibilityLabel(
    title: String,
    description: String,
    countdown: String?,
): String =
    buildString {
        append(title)
        append(". ")
        append(description)
        if (!countdown.isNullOrBlank()) {
            append(" ")
            append(countdown)
        }
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the reason,
 * the provider message, or the retry timing — so a diagnostics line can never leak the operator's AI state.
 */
object AiLimitBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = AI_LIMIT_BANNER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
