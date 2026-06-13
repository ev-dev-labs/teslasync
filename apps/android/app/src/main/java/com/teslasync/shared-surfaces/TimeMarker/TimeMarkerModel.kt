// Pure, framework-free model + projection + diagnostics for the TimeMarker shared surface — the native
// analogue of every decision the web component makes (web/src/components/charts/TimeMarker.tsx) before it
// draws its point-in-time marker. No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A vertical reference line on a time-series chart marking the timestamp of an alert (or any
//     point-in-time event). It is PURELY presentational — its only inputs are props: the x value the caller
//     already converted from the alert moment, the severity (drives the color), and a label. There is no
//     data fetch: the consuming page reads the alert drill-through context from the URL (`useAlertContext()`
//     → vehicle_id / t / signal) and converts the timestamp to the chart's x value; TimeMarker only paints.
//     So there is no network lifecycle to model (no loading/error/stale/offline), exactly as the sibling
//     presentational surfaces (ChartExportMenu, RouteAnnouncer) document — modelling one would invent a
//     fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift).
//   • `if (x == null || x === '') return null` — the marker renders NOTHING when there is no moment to
//     mark. That early-return is the surface's "empty" state, reproduced by [timeMarkerPlacement] returning
//     an invisible placement.
//   • `normalizeSeverity(severity ?? 'warn')` — the severity defaults to warn and is normalized (folding
//     the legacy 'warning'/'error'/'fatal'/'ok' aliases) onto the canonical info/warn/critical/success set.
//     Ported verbatim in [normalizeTimeMarkerSeverity] + [timeMarkerSeverity].
//   • The only real consumer (web BatteryHealthPage) passes `severity={alertCtx.signal ? 'critical' :
//     undefined}` — a present drill-through signal escalates the marker to critical, otherwise it stays
//     warn. Ported in [severityForContext].
//
// Why the native marker is an index on a rail rather than a recharts `<ReferenceLine>`: Vico 2.0 has no
// public vertical-line decoration, so the atomic chart layer renders point-in-time markers as a
// severity-colored pin rail aligned by x-fraction (see components/charts/SURVEY.md + ChartAnnotationLayer).
// This surface therefore resolves the alert moment to an x-INDEX on that rail; the recharts-only props
// (strokeWidth, strokeDasharray, yAxisId) have no rail analogue, while the behavioural `ifOverflow` prop is
// reproduced by [TimeMarkerOverflow].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TimeMarker — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemarker

import io.teslasync.shared.core.diagnostics.Logger
import java.time.OffsetDateTime
import kotlin.math.abs

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val TIME_MARKER_SLUG: String = "TimeMarker"

/** Half-width of the alert drill-through window in millis (web `ALERT_WINDOW_MS = 30 * 60_000`). */
const val ALERT_WINDOW_MS: Long = 30L * 60_000L

/**
 * The canonical severity of the marked moment — the native mirror of the web `Severity` union
 * (`'info' | 'warn' | 'critical' | 'success'`, web/src/lib/tokens.ts). Drives the marker color through the
 * per-theme status palette (resolved in the composable, never a raw hex literal).
 */
enum class TimeMarkerSeverity { Info, Warn, Critical, Success }

/**
 * Port of the web `normalizeSeverity` (web/src/lib/tokens.ts): folds any incoming string — including the
 * legacy `warning` / `error` / `fatal` / `ok` aliases — onto the canonical [TimeMarkerSeverity], defaulting
 * to [TimeMarkerSeverity.Info] for a null / empty / unknown value. Case-insensitive and (like the web) does
 * not trim, so a stray-whitespace value falls through to Info exactly as `normalizeSeverity` does.
 */
fun normalizeTimeMarkerSeverity(raw: String?): TimeMarkerSeverity =
    when (raw?.lowercase()) {
        null -> TimeMarkerSeverity.Info
        "warning", "warn" -> TimeMarkerSeverity.Warn
        "error", "fatal", "critical" -> TimeMarkerSeverity.Critical
        "ok", "success" -> TimeMarkerSeverity.Success
        "info" -> TimeMarkerSeverity.Info
        else -> TimeMarkerSeverity.Info
    }

/**
 * The marker's effective severity for a raw value — the native mirror of the web component's
 * `normalizeSeverity(severity ?? 'warn')`: a null severity defaults to **warn** (not the general normalize
 * default of info) before normalization, so an unspecified marker is a warning.
 */
fun timeMarkerSeverity(raw: String?): TimeMarkerSeverity = normalizeTimeMarkerSeverity(raw ?: "warn")

/** A `[t-30min, t+30min]` epoch-millis window centered on the alert moment (web `timeWindow`). */
data class AlertTimeWindow(
    val fromMillis: Long,
    val toMillis: Long,
)

/**
 * The drill-through context a page reads from the URL to center its chart on an alert — the native mirror of
 * the web `AlertContext` (web/src/hooks/useAlertContext.ts). [timestampMillis] is the parsed epoch-millis of
 * the raw [timestamp] (null when absent / unparseable); the marker is placed from it.
 */
data class AlertMarkerContext(
    val vehicleId: Long?,
    val timestamp: String?,
    val timestampMillis: Long?,
    val signal: String?,
    val timeWindow: AlertTimeWindow?,
    val hasContext: Boolean,
)

/**
 * Parse an RFC3339 / ISO-8601 instant to epoch millis, or null when absent / unparseable — the native
 * mirror of the web `new Date(t)` + `Number.isNaN(getTime())` guard. The drill-through `t` originates from
 * an alert's `created_at` (RFC3339 with a `Z` or numeric offset), which [OffsetDateTime.parse] accepts.
 */
fun parseAlertTimestampMillis(timestamp: String?): Long? {
    val raw = timestamp?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
}

/**
 * Port of the web `useAlertContext` projection: parse the drill-through params (`vehicle_id` / `t` /
 * `signal`) into the typed [AlertMarkerContext], compute the ±30-min [AlertTimeWindow] when a timestamp is
 * present and parseable, and set [AlertMarkerContext.hasContext] when any param is present (web truthiness).
 */
fun resolveAlertMarkerContext(
    vehicleIdRaw: String?,
    timestamp: String?,
    signal: String?,
): AlertMarkerContext {
    val vehicleId = vehicleIdRaw?.takeIf { it.isNotEmpty() }?.toLongOrNull()
    val millis = parseAlertTimestampMillis(timestamp)
    val window = millis?.let { AlertTimeWindow(it - ALERT_WINDOW_MS, it + ALERT_WINDOW_MS) }
    val hasContext = vehicleId != null || timestamp != null || signal != null
    return AlertMarkerContext(
        vehicleId = vehicleId,
        timestamp = timestamp,
        timestampMillis = millis,
        signal = signal,
        timeWindow = window,
        hasContext = hasContext,
    )
}

/**
 * Recharts `ifOverflow` behaviour for a marker whose moment falls outside the current chart window — the
 * native mirror of the web prop. The web default is [ExtendDomain] (keep the marker visible by clamping to
 * the nearest edge); [Discard] / [Hidden] drop it.
 */
enum class TimeMarkerOverflow { Discard, Hidden, Visible, ExtendDomain }

/**
 * A fully-resolved marker placement on the rail: whether it is [visible], the x-[index] it pins to (null
 * when hidden), the rail's [pointCount], and the [severity] tint. The composable renders [index] of
 * [pointCount] when [visible], and nothing otherwise (the web `return null`).
 */
data class TimeMarkerPlacement(
    val visible: Boolean,
    val index: Int?,
    val pointCount: Int,
    val severity: TimeMarkerSeverity,
)

/**
 * The marker severity derived from the drill-through context — a port of the only real consumer's
 * `severity={alertCtx.signal ? 'critical' : undefined}` (web BatteryHealthPage): a present signal escalates
 * to [TimeMarkerSeverity.Critical], otherwise the marker stays a [TimeMarkerSeverity.Warn].
 */
fun severityForContext(context: AlertMarkerContext): TimeMarkerSeverity =
    if (context.signal != null) TimeMarkerSeverity.Critical else TimeMarkerSeverity.Warn

/**
 * Resolve the alert moment to a marker placement on a rail whose x-axis is [axisEpochMillis] (ascending
 * sample times). Faithful to the web `if (x == null || x === '') return null`: with no timestamp or an empty
 * axis the placement is invisible. Otherwise the nearest sample index is chosen; when the moment falls
 * outside the axis domain the [overflow] policy decides — [TimeMarkerOverflow.ExtendDomain] / [Visible]
 * clamp to the nearest edge (the web default keeps the marker visible), [Discard] / [Hidden] drop it.
 */
fun timeMarkerPlacement(
    context: AlertMarkerContext,
    axisEpochMillis: List<Long>,
    severity: TimeMarkerSeverity = severityForContext(context),
    overflow: TimeMarkerOverflow = TimeMarkerOverflow.ExtendDomain,
): TimeMarkerPlacement {
    val pointCount = axisEpochMillis.size
    val moment = context.timestampMillis
    if (moment == null || pointCount == 0) {
        return TimeMarkerPlacement(visible = false, index = null, pointCount = pointCount, severity = severity)
    }
    val nearest = axisEpochMillis.indices.minByOrNull { abs(axisEpochMillis[it] - moment) } ?: 0
    val low = axisEpochMillis.minOrNull() ?: moment
    val high = axisEpochMillis.maxOrNull() ?: moment
    val inDomain = moment in low..high
    val keepWhenOutside = overflow == TimeMarkerOverflow.Visible || overflow == TimeMarkerOverflow.ExtendDomain
    val visible = inDomain || keepWhenOutside
    return TimeMarkerPlacement(
        visible = visible,
        index = if (visible) nearest else null,
        pointCount = pointCount,
        severity = severity,
    )
}

/**
 * The marker's accessible label — the [custom] label when the caller supplies a non-blank one, otherwise
 * the localized [default] ("Alert"). The web default label is the literal `'Alert'`; the composable supplies
 * the i18n catalog string instead so no English literal ships in native code.
 */
fun markerLabel(
    custom: String?,
    default: String,
): String = custom?.trim()?.takeIf { it.isNotEmpty() } ?: default

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * vehicle id, timestamp, or signal name — so a diagnostics line can never leak which alert a user opened.
 */
object TimeMarkerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TIME_MARKER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
