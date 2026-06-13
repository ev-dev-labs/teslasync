// Pure, framework-free model + formatters + diagnostics for the ChartTooltip shared surface — the native
// analogue of every decision the web component makes (web/src/components/charts/ChartTooltip.tsx) before it
// paints the floating tooltip body. No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL Recharts custom-tooltip body. Its only inputs are the chart's hover payload
//     (the active flag, the per-series rows, the axis label) plus two optional formatter overrides; its only
//     module deps are the app-wide `fmtNumber` (locale-aware numbers) and `formatDateTime` (locale + zone
//     aware ISO labels). There is no data port to bind (no P1/S8 state holder, no Source/ViewModel) — the
//     parent chart owns the payload; modelling a fetch would invent one the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The sibling presentational precedents are the equally
//     port-free ChartExportMenu / AiLimitBanner / RouteAnnouncer surfaces (composable + model only).
//   • Visibility gate: `!active || !payload?.length` → renders nothing. Native mirror: [isTooltipVisible].
//   • Label: `null` → empty; an ISO-8601-looking string (matching the `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}`
//     heuristic) → locale + zone formatted like `formatDateTime`; anything else → passed through verbatim
//     (preserving the existing "HH:MM" string labels). Native mirror: [isIsoTimestamp] + [formatTooltipLabel].
//   • Value: a number → `fmtNumber` (locale grouping at the global precision); absent → empty; anything else →
//     its string form; then the optional unit is appended (dimmed). Native mirror: [formatTooltipValue].
//   • Two override hooks (`valueFormatter` / `labelFormatter`) let a chart swap either formatter; the view
//     wires those lambdas and falls back to the model defaults here.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is the hover readout for a chart whose data already loaded. Its real, fully
// reproduced states are the hidden surface (inactive / no rows) and the active body's per-row branches
// (numeric / textual / absent value, with / without a unit, ISO / passthrough / absent label), each reduced
// here and asserted in the off-device test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ChartTooltip — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charttooltip

import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). A constant identifier carrying no
 * series name, value, or axis label, so a diagnostics line can never leak what the operator was hovering.
 */
const val CHART_TOOLTIP_SLUG: String = "ChartTooltip"

/**
 * Default fraction-digit precision for numeric values — the native mirror of the web `numberFormat` module's
 * global default of `2`. The view threads the user's configured precision in; this is the fallback when none
 * is supplied.
 */
const val CHART_TOOLTIP_DEFAULT_PRECISION: Int = 2

/**
 * The em-dash the web `formatDateTime` returns for an unrenderable timestamp (its universal fallback marker).
 * Reproduced so an ISO-looking but unparseable label degrades exactly like the web source.
 */
const val CHART_TOOLTIP_INVALID_LABEL: String = "\u2014"

private const val MAX_PRECISION: Int = 20

/**
 * Heuristic mirror of the web `ISO_TS_RE`: at least `YYYY-MM-DDTHH:MM` so plain date strings ("Apr 4") and
 * pre-formatted "HH:MM" axis labels never trip the datetime formatter.
 */
private val ISO_TIMESTAMP_REGEX = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}""")

private val DATE_TIME_STYLE: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/**
 * Whether the tooltip body is shown — a 1:1 port of the web `!(!active || !payload?.length)` guard: the cursor
 * is over the plot ([active]) AND at least one series row is present ([seriesCount] greater than zero).
 */
fun isTooltipVisible(
    active: Boolean,
    seriesCount: Int,
): Boolean = active && seriesCount > 0

/**
 * Heuristic mirror of the web `ISO_TS_RE.test(...)`: does [value] look like an ISO-8601 timestamp? Only strings
 * qualify, so numeric labels and plain "HH:MM" / "Apr 4" labels are passed through verbatim by the view.
 */
fun isIsoTimestamp(value: Any?): Boolean = value is String && ISO_TIMESTAMP_REGEX.containsMatchIn(value)

/**
 * The localized tooltip label — a 1:1 port of the web `defaultLabelFormatter`: a `null` label → empty; an
 * ISO-looking string → [formatIsoDateTime] (locale + zone aware); anything else → its verbatim string form.
 * [locale] and [zone] default to the device locale / zone, mirroring the web "browser locale + browser
 * timezone" default.
 */
fun formatTooltipLabel(
    label: Any?,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
): String =
    when {
        label == null -> ""
        label is String && isIsoTimestamp(label) -> formatIsoDateTime(label, locale, zone)
        else -> label.toString()
    }

/**
 * Render an ISO-8601 [iso] timestamp as a localized "medium date + short time" string in [zone] — the native
 * analogue of the web `formatDateTime` (`{ year, month: 'short', day, hour: '2-digit', minute: '2-digit' }`).
 * Returns [CHART_TOOLTIP_INVALID_LABEL] when the value cannot be parsed, mirroring the web '—' fallback.
 */
private fun formatIsoDateTime(
    iso: String,
    locale: Locale,
    zone: ZoneId,
): String =
    parseTimestamp(iso, zone)
        ?.let { DATE_TIME_STYLE.withLocale(locale).withZone(zone).format(it) }
        ?: CHART_TOOLTIP_INVALID_LABEL

/**
 * Tolerant ISO parser: an explicit offset / `Z` is honored (the web `new Date('…Z')` path); a zone-less local
 * timestamp is anchored to [zone] (the web `new Date('…')` local-time path). Returns `null` when no form parses
 * so the caller can fall back to the em-dash marker.
 */
private fun parseTimestamp(
    iso: String,
    zone: ZoneId,
): Instant? =
    runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(iso) }.getOrNull()
        ?: runCatching { LocalDateTime.parse(iso).atZone(zone).toInstant() }.getOrNull()

/**
 * One series row's render-ready value — the formatted [text] plus the optional [unit] the view renders dimmed
 * after it (the web `<span className="ml-0.5 opacity-60">`). Kept free of Compose so it is unit-tested.
 */
data class TooltipValueParts(
    val text: String,
    val unit: String?,
)

/**
 * The default value projection — a 1:1 port of the web `defaultValueFormatter`: a [Number] → [formatNumber]
 * (locale grouping at [precision] fraction digits); an absent value → empty; anything else → its string form.
 * The non-blank [unit] is carried alongside for the dimmed suffix (the web appends it for any value).
 */
fun formatTooltipValue(
    value: Any?,
    unit: String?,
    precision: Int = CHART_TOOLTIP_DEFAULT_PRECISION,
    locale: Locale = Locale.getDefault(),
): TooltipValueParts =
    TooltipValueParts(
        text =
            when (value) {
                is Number -> formatNumber(value, precision, locale)
                null -> ""
                else -> value.toString()
            },
        unit = unit?.takeIf { it.isNotBlank() },
    )

/**
 * Locale-aware number formatting — the native mirror of the web `fmtNumber` (`safeNumber` then `toLocaleString`
 * with min == max fraction digits and locale grouping). A non-finite [value] collapses to `0` exactly like the
 * web `safeNumber`, so a sparse series never renders `NaN`; [precision] is clamped to a sane `0..20`. Accepts a
 * [Number] (formatted at full double/long precision) so the caller never narrows the raw payload value.
 */
fun formatNumber(
    value: Number,
    precision: Int = CHART_TOOLTIP_DEFAULT_PRECISION,
    locale: Locale = Locale.getDefault(),
): String {
    val finite: Number =
        when (value) {
            is Double -> if (value.isFinite()) value else 0.0
            is Float -> if (value.isFinite()) value else 0.0f
            else -> value
        }
    val digits = precision.coerceIn(0, MAX_PRECISION)
    val format =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = digits
            maximumFractionDigits = digits
        }
    return format.format(finite)
}

/**
 * One already-localized tooltip row for the merged accessibility announcement: the series [name], its formatted
 * [value], and the optional [unit]. Built by the view from the resolved strings.
 */
data class TooltipRowText(
    val name: String,
    val value: String,
    val unit: String?,
)

/**
 * Build the merged TalkBack announcement for the tooltip from already-localized parts — the native analogue of
 * the web `aria-live="polite"` region reading its label + rows. The optional [label] leads (when non-empty),
 * then each row as "name: value unit", comma-separated. Pure so label presence is asserted off-device.
 */
fun tooltipAccessibilityLabel(
    label: String,
    rows: List<TooltipRowText>,
): String =
    buildString {
        if (label.isNotEmpty()) {
            append(label)
            if (rows.isNotEmpty()) append(". ")
        }
        rows.forEachIndexed { index, row ->
            append(row.name)
            append(": ")
            append(row.value)
            if (!row.unit.isNullOrBlank()) {
                append(' ')
                append(row.unit)
            }
            if (index < rows.lastIndex) append(", ")
        }
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a series
 * name, value, or axis label — so a diagnostics line can never leak what the operator was hovering.
 */
object ChartTooltipDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = CHART_TOOLTIP_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
