// Pure, framework-free model + projection + diagnostics for the BatteryDelta shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/BatteryDelta.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive. The parent owns the two state-of-charge endpoints (start / end) and
//     passes them in as props; the component's only hook is useTranslation. So there is no data port to
//     bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a fetch the web spec
//     does not have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational
//     ports AiLimitBanner / VisuallyHidden document the same rationale (composable + model, no Source).
//   • `!hasData` (either endpoint missing or non-finite) → the muted "unknown" branch: an em-dash visible
//     label and the localized `battery.delta.unknown` accessible label. Native mirror: [BatteryDeltaTone]
//     `Unknown` + [BatteryDeltaA11y] `Unknown`.
//   • `hasData` → the signed delta is shown. A rise (charging) renders the success accent, a drop (driving)
//     the warning accent, and an exactly-zero/missing change renders muted — the in-app convention the web
//     encodes as emerald / amber / muted. The visible label is either the compact delta ("+12%", "−1%", or
//     the em-dash when zero) or the legacy "79% → 78%" pair; the accessible label is the localized
//     `battery.delta.aria` carrying the start/end percentages.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders two numbers the parent already holds. Its real, fully reproduced
// states are the Unknown branch and the data branches (Positive / Negative / Neutral) across the Compact and
// Pair variants, each reduced here and asserted in the off-device test. The visible labels and the
// percentage formatting are reduced by the pure helpers so they are verified without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/BatteryDelta — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AiLimitBanner / VisuallyHidden surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.batterydelta

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.roundToInt

/** The em-dash shown when there is no delta to render (web `dash = '—'`). */
const val BATTERY_DELTA_DASH: String = "\u2014"

/** The unicode minus sign used for a negative delta (web `'−'`, not the ASCII hyphen). */
private const val BATTERY_DELTA_MINUS: String = "\u2212"

/** The rightwards arrow joining the two endpoints in the pair variant (web `'→'`). */
private const val BATTERY_DELTA_ARROW: String = "\u2192"

/**
 * Display variant — the native tag for the web `variant` prop.
 * [Compact] (web default) shows just the change ("−1%", "+12%", "—"); [Pair] shows the legacy
 * charging-card "79% → 78%" form.
 */
enum class BatteryDeltaVariant {
    /** Web `variant="compact"` — the signed delta, or the em-dash when zero / missing. */
    Compact,

    /** Web `variant="pair"` — the "start% → end%" pair (always shown when data is present). */
    Pair,
}

/**
 * The render-ready tone the delta paints with — the native mirror of the web colour rules
 * (`delta > 0 → emerald`, `delta < 0 → amber`, otherwise muted). The render boundary maps this onto a
 * per-theme [androidx.compose.ui.graphics.Color]; keeping it an enum lets the off-device test assert the
 * choice without a Compose host.
 */
enum class BatteryDeltaTone {
    /** A rise in state-of-charge (charging) — web `text-emerald-300`. */
    Positive,

    /** A drop in state-of-charge (driving) — web `text-amber-300`. */
    Negative,

    /** An exactly-zero change — web `text-[var(--text-muted)]`. */
    Neutral,

    /** No / partial / non-finite data — web `!hasData` muted branch. */
    Unknown,
}

/**
 * The accessible-label descriptor — which localized string the render layer resolves and with what
 * arguments. Kept framework-free so the off-device test verifies the web `aria-label` selection
 * (`battery.delta.unknown` vs `battery.delta.aria`) without a Compose host.
 */
sealed interface BatteryDeltaA11y {
    /** The web `!hasData` branch: `aria-label = t('battery.delta.unknown', 'Battery delta unknown')`. */
    data object Unknown : BatteryDeltaA11y

    /**
     * The web data branch: `aria-label = t('battery.delta.aria', 'Battery {{from}}% to {{to}}%', …)`.
     * Carries the rounded start ([fromPct]) and end ([toPct]) percentages the catalog string interpolates.
     */
    data class Known(
        val fromPct: Int,
        val toPct: Int,
    ) : BatteryDeltaA11y
}

/**
 * True when both endpoints are present and finite — the native mirror of the web `hasData` guard
 * (`startPct != null && endPct != null && Number.isFinite(startPct) && Number.isFinite(endPct)`). A
 * `NaN` / infinite endpoint (e.g. a divide-by-zero upstream) is treated as missing, exactly as the web does.
 */
fun hasBatteryDeltaData(
    startPct: Double?,
    endPct: Double?,
): Boolean = startPct != null && endPct != null && startPct.isFinite() && endPct.isFinite()

/** The signed state-of-charge change `end − start`, or `null` when [hasBatteryDeltaData] is false (web `delta`). */
fun batteryDeltaValue(
    startPct: Double?,
    endPct: Double?,
): Double? = if (hasBatteryDeltaData(startPct, endPct)) endPct!! - startPct!! else null

/**
 * The render tone for the endpoints — the native mirror of the web colour ternary. Missing data is
 * [BatteryDeltaTone.Unknown]; otherwise the signed delta selects Positive / Negative / Neutral.
 */
fun batteryDeltaTone(
    startPct: Double?,
    endPct: Double?,
): BatteryDeltaTone {
    val delta = batteryDeltaValue(startPct, endPct) ?: return BatteryDeltaTone.Unknown
    return when {
        delta > 0.0 -> BatteryDeltaTone.Positive
        delta < 0.0 -> BatteryDeltaTone.Negative
        else -> BatteryDeltaTone.Neutral
    }
}

/**
 * The compact visible label — the native mirror of the web `compactLabel`
 * (`delta === 0 ? dash : ${sign}${magnitude}%`). Missing data and an exactly-zero change both render the
 * em-dash; otherwise the rounded magnitude is prefixed with `+` (rise) or the unicode minus `−` (drop).
 */
fun batteryDeltaCompactLabel(
    startPct: Double?,
    endPct: Double?,
): String {
    val delta = batteryDeltaValue(startPct, endPct)
    if (delta == null || delta == 0.0) return BATTERY_DELTA_DASH
    val magnitude = abs(delta).roundToInt()
    val sign = if (delta > 0.0) "+" else BATTERY_DELTA_MINUS
    return "$sign$magnitude%"
}

/**
 * The pair visible label — the native mirror of the web `pairLabel` (`${startPct}% → ${endPct}%`). Always
 * shows the "start% → end%" pair when data is present (even for an equal pair, "80% → 80%"); falls back to
 * the em-dash when data is missing, matching the web `!hasData` early return that precedes the variant split.
 */
fun batteryDeltaPairLabel(
    startPct: Double?,
    endPct: Double?,
): String {
    if (!hasBatteryDeltaData(startPct, endPct)) return BATTERY_DELTA_DASH
    return "${startPct!!.roundToInt()}% $BATTERY_DELTA_ARROW ${endPct!!.roundToInt()}%"
}

/** The visible label for the chosen [variant] — the native mirror of the web `visible` selection. */
fun batteryDeltaVisibleLabel(
    startPct: Double?,
    endPct: Double?,
    variant: BatteryDeltaVariant,
): String =
    when (variant) {
        BatteryDeltaVariant.Pair -> batteryDeltaPairLabel(startPct, endPct)
        BatteryDeltaVariant.Compact -> batteryDeltaCompactLabel(startPct, endPct)
    }

/**
 * The accessible-label descriptor for the endpoints — the native mirror of the web `aria-label` selection.
 * Missing data resolves to [BatteryDeltaA11y.Unknown] (`battery.delta.unknown`); otherwise the rounded
 * start / end percentages are carried for the `battery.delta.aria` interpolation.
 */
fun batteryDeltaA11y(
    startPct: Double?,
    endPct: Double?,
): BatteryDeltaA11y =
    if (hasBatteryDeltaData(startPct, endPct)) {
        BatteryDeltaA11y.Known(fromPct = startPct!!.roundToInt(), toPct = endPct!!.roundToInt())
    } else {
        BatteryDeltaA11y.Unknown
    }

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs, derived
 * purely so every branch is covered off-device. The view only resolves the tone colour and the accessible
 * string and lays out the icon + label.
 *
 * @property hasData whether both endpoints were present and finite (web `hasData`).
 * @property tone the render tone (web colour ternary).
 * @property visibleLabel the visible text for the chosen variant (web `visible`).
 * @property a11y which localized accessible label to resolve, and its arguments (web `aria-label`).
 */
data class BatteryDeltaProjection(
    val hasData: Boolean,
    val tone: BatteryDeltaTone,
    val visibleLabel: String,
    val a11y: BatteryDeltaA11y,
)

/** Reduce the endpoints + [variant] into the render-ready [BatteryDeltaProjection]. Pure (no Compose). */
fun projectBatteryDelta(
    startPct: Double?,
    endPct: Double?,
    variant: BatteryDeltaVariant,
): BatteryDeltaProjection =
    BatteryDeltaProjection(
        hasData = hasBatteryDeltaData(startPct, endPct),
        tone = batteryDeltaTone(startPct, endPct),
        visibleLabel = batteryDeltaVisibleLabel(startPct, endPct, variant),
        a11y = batteryDeltaA11y(startPct, endPct),
    )

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * state-of-charge endpoints — so a diagnostics line can never leak a vehicle's battery level or movement.
 */
object BatteryDeltaDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "BatteryDelta"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
