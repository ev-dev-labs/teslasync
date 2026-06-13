// Pure, framework-free model + projection + diagnostics for the MetricCard shared surface — the native
// analogue of web/src/components/data-display/MetricCard.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions (the accepted sibling-surface contract).
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): the
// web `MetricCard` is a PURELY PRESENTATIONAL compact metric tile, not a data-fetching view. It takes a
// caller-supplied `label`, a `value` that is either a number or an already-formatted string, an optional
// neon `color`, an optional `icon`, an optional `subtitle`, an optional legacy `change` pill, an optional
// direction-aware `delta`, and an optional `help` tooltip. Its real, fully-reproduced render branches are:
//   * the base label + value (always rendered — a value is always supplied);
//   * the optional subtitle line;
//   * the optional inline help affordance next to the label;
//   * the optional neon accent icon box;
//   * the FOOTER, which is exactly one of: nothing, the legacy `change` pill (web shows it only when there
//     is no `delta`), or the `delta` indicator. The delta itself is the web `<Delta>` component, so its
//     own loading / no-comparison / resolved branches are owned by the embedded Delta surface — this card
//     forwards the delta parameters and the derived `current` to it (web `current={deltaCurrent}`).
// The web `deltaCurrent = delta?.current ?? (Number.isFinite(numericValue) ? numericValue : null)` is
// reproduced by [MetricCardValue.numericOrNull] + [MetricCardProjection.project]: an explicit override
// wins, otherwise the card's own numeric value (finite) is used, otherwise the comparison is absent.
//
// Why the generic data-surface states (error / stale / offline) are intentionally absent: `MetricCard`
// fetches nothing — it is handed a finished value — so it never errors, goes stale or goes offline.
// Modelling those would fabricate behaviour the web spec does not have (Honesty Covenant: no scope
// narrowing, no silent drift), exactly as the accepted VisuallyHidden / AnimatedNumber / Delta
// presentational ports document. The one "loading" notion the surface has belongs to the embedded delta
// (web `delta.loading`), carried verbatim on [MetricCardDeltaSpec.loading] and forwarded to the Delta
// surface. The card renders no static copy of its own — label / value / subtitle / help text are all
// caller-supplied — so the only i18n key it owns is the help trigger's accessible label, resolved at the
// render boundary from the shared P1/S10 catalog (`translation_help_tooltip_iconLabel`, the web
// `help.tooltip.iconLabel`); none is invented here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MetricCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metriccard

import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.sharedsurfaces.delta.DeltaSize
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.floor

/**
 * Canonical registry metadata for the MetricCard surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`MetricCard`).
 */
object MetricCardRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "metric-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "MetricCard"
}

/**
 * The neon accent a [MetricCard] is tinted with — the native tag for the web `color: NeonColor`
 * (`'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue'`, default `cyan`). The render boundary maps
 * each variant onto a theme token (never a raw hex), so light / dark / high-contrast stay correct.
 */
enum class MetricCardAccent {
    /** Web `color="cyan"` (the default) — maps to the info token. */
    Cyan,

    /** Web `color="green"` — maps to the success token. */
    Green,

    /** Web `color="red"` — maps to the danger token. */
    Red,

    /** Web `color="purple"` — maps to the chart power series token. */
    Purple,

    /** Web `color="amber"` — maps to the warning token. */
    Amber,

    /** Web `color="blue"` — maps to the chart speed series token. */
    Blue,
}

/** Upper bound below which a finite double is rendered as a bare integer (web `String(number)` parity). */
private const val MAX_INTEGRAL_MAGNITUDE: Double = 1.0e15

/**
 * The card's value — the native analogue of the web `value: string | number`. A [Numeric] renders the
 * number the way JavaScript `String(number)` does (an integral magnitude drops its trailing `.0`); a
 * [Text] renders the caller's already-formatted string verbatim. [numericOrNull] reproduces the web
 * `Number.isFinite(numericValue) ? numericValue : null`, used to derive the embedded delta's `current`.
 */
sealed interface MetricCardValue {
    /** Web `value` passed as a number — rendered with `String(number)` semantics. */
    data class Numeric(
        val value: Double,
    ) : MetricCardValue

    /** Web `value` passed as an already-formatted string — rendered verbatim. */
    data class Text(
        val value: String,
    ) : MetricCardValue

    /** The text the card paints (web `{value}`): a number via [jsNumberToString], a string verbatim. */
    fun displayText(): String =
        when (this) {
            is Numeric -> jsNumberToString(value)
            is Text -> value
        }

    /**
     * The finite numeric value used to derive the embedded delta's `current` (web
     * `Number.isFinite(numericValue) ? numericValue : null`). A number is taken when finite; a string is
     * parsed with JavaScript `Number(string)` semantics ([jsParseNumber]) and kept only when finite.
     */
    fun numericOrNull(): Double? =
        when (this) {
            is Numeric -> value.takeIf { it.isFinite() }
            is Text -> jsParseNumber(value)?.takeIf { it.isFinite() }
        }
}

/**
 * Renders [value] the way JavaScript `String(number)` does: a non-finite value keeps its JS spelling
 * (`NaN` / `Infinity` / `-Infinity`), an integral magnitude is printed without a trailing `.0`, and every
 * other value uses the platform shortest decimal. This is what React paints for a numeric `{value}`.
 */
internal fun jsNumberToString(value: Double): String =
    when {
        value.isNaN() -> "NaN"
        value.isInfinite() -> if (value > 0.0) "Infinity" else "-Infinity"
        value == floor(value) && abs(value) < MAX_INTEGRAL_MAGNITUDE -> value.toLong().toString()
        else -> value.toString()
    }

/**
 * Parses [raw] with JavaScript `Number(string)` semantics for the delta-current derivation: surrounding
 * whitespace is ignored, an empty / whitespace-only string is `0`, and anything that is not a number is
 * `null` (the web `Number("abc")` is `NaN`, which [MetricCardValue.numericOrNull] then drops).
 */
internal fun jsParseNumber(raw: String): Double? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return 0.0
    return trimmed.toDoubleOrNull() // parity:allow kotlin stdlib numeric parse; the scanner match is a substring false-positive
}

/**
 * The legacy ad-hoc change pill — the native analogue of the web `change?: { value; positive }`. [value]
 * is the already-formatted change text; [positive] picks the up/down glyph and the good/bad tint. The web
 * renders it only when no [MetricCardDeltaSpec] is supplied; [MetricCardProjection.project] enforces that.
 */
data class MetricCardChange(
    val value: String,
    val positive: Boolean,
)

/**
 * The card's contextual help affordance — the native analogue of the web `help?: HelpTooltipProps`.
 * [helpText] is the already-resolved tooltip body (the caller localizes it, exactly as the web call site
 * passes `text` / a resolved `i18nKey`); [contentDescription] optionally overrides the help trigger's
 * accessible label, which otherwise resolves from the shared `translation_help_tooltip_iconLabel` key.
 */
data class MetricCardHelp(
    val helpText: String,
    val contentDescription: String? = null,
)

/**
 * The embedded delta's parameters — the native analogue of the web `MetricCardDelta`
 * (`Omit<DeltaProps, 'current'> & { current? }`): everything the card forwards to `<Delta>` except the
 * `current` it derives itself. [currentOverride] is the web `delta.current` (it wins over the card's own
 * numeric value when present and finite). The card hands these to the shipped Delta surface, which binds
 * the user's unit preferences through the shared settings state holder (P1/S8).
 *
 * @property previous the previous-period value (web `previous`); `null` renders the no-comparison em dash.
 * @property metric the metric semantic — its direction colors the delta, its unit picks the label.
 * @property display percent (default), absolute, or both (web `display`).
 * @property comparedTo the trailing compare-window label (web `comparedTo`).
 * @property size the compact or larger chip (web `size`).
 * @property hideArrow hides the directional arrow (web `hideArrow`).
 * @property loading forces the delta's loading skeleton (web `loading`).
 * @property precision overrides the delta's decimal precision (web `precision`).
 * @property currentOverride the web `delta.current` override; `null` falls back to the card's value.
 */
data class MetricCardDeltaSpec(
    val previous: Double?,
    val metric: MetricSemantic,
    val display: DeltaDisplay = DeltaDisplay.Percent,
    val comparedTo: String? = null,
    val size: DeltaSize = DeltaSize.Sm,
    val hideArrow: Boolean = false,
    val loading: Boolean = false,
    val precision: Int? = null,
    val currentOverride: Double? = null,
)

/**
 * The caller-supplied inputs a [MetricCard] renders — the native analogue of the web `MetricCardProps`
 * value fields. The icon is a render-layer concern (an `ImageVector`, supplied to the composable), so it
 * is not part of this pure projection, mirroring how the sibling card surfaces keep vector art out of the
 * model.
 */
data class MetricCardInput(
    val label: String,
    val value: MetricCardValue,
    val accent: MetricCardAccent = MetricCardAccent.Cyan,
    val subtitle: String? = null,
    val change: MetricCardChange? = null,
    val delta: MetricCardDeltaSpec? = null,
    val help: MetricCardHelp? = null,
)

/**
 * The card's footer slot — the native analogue of the web mutually-exclusive change/delta region. Exactly
 * one variant renders: [None] when neither is supplied, [ChangePill] for the legacy change (web `change &&
 * !delta`), or [DeltaFooter] carrying the forwarded spec and the derived `current` (web `<Delta
 * current={deltaCurrent}>`).
 */
sealed interface MetricCardFooter {
    /** No footer — web renders nothing when neither `change` nor `delta` is supplied. */
    data object None : MetricCardFooter

    /** The legacy change pill (web `change && !delta`): formatted [text] tinted by [positive]. */
    data class ChangePill(
        val text: String,
        val positive: Boolean,
    ) : MetricCardFooter

    /** The direction-aware delta (web `delta`): the forwarded [spec] plus the derived [current]. */
    data class DeltaFooter(
        val spec: MetricCardDeltaSpec,
        val current: Double?,
    ) : MetricCardFooter
}

/**
 * The projected render state a [MetricCard] paints — the pure data the composable renders. Framework-free
 * so the whole contract is covered by the off-device unit gate; the composable only applies typography,
 * the accent token, and the embedded Delta.
 */
data class MetricCardProjection(
    val label: String,
    val displayValue: String,
    val accent: MetricCardAccent,
    val subtitle: String?,
    val help: MetricCardHelp?,
    val footer: MetricCardFooter,
) {
    companion object {
        /**
         * Projects [input] into the branch the composable paints — the native mirror of everything the web
         * `MetricCard` decides before its returned JSX: the displayed value text, the accent, the optional
         * subtitle / help, and the mutually-exclusive footer (delta wins over the legacy change pill, web
         * `change && !delta`), with the delta's `current` derived exactly as web `deltaCurrent`.
         */
        fun project(input: MetricCardInput): MetricCardProjection =
            MetricCardProjection(
                label = input.label,
                displayValue = input.value.displayText(),
                accent = input.accent,
                subtitle = input.subtitle,
                help = input.help,
                footer = projectFooter(input),
            )

        private fun projectFooter(input: MetricCardInput): MetricCardFooter {
            val delta = input.delta
            val change = input.change
            val deltaCurrent = delta?.let { it.currentOverride ?: input.value.numericOrNull() }
            return when {
                delta != null -> MetricCardFooter.DeltaFooter(spec = delta, current = deltaCurrent)
                change != null -> MetricCardFooter.ChangePill(text = change.value, positive = change.positive)
                else -> MetricCardFooter.None
            }
        }
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [MetricCardRegistration.SLUG] — never the rendered label, value, subtitle, or
 * comparison, so a diagnostics line can never leak what the card displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per surface open.
 */
object MetricCardDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to MetricCardRegistration.SLUG))
    }
}
