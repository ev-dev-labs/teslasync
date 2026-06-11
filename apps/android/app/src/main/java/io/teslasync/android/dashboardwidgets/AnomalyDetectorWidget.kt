// File named after its primary @Composable; the co-located spec / adapter / pure helpers are
// supporting declarations that ship in the one allowed widget file.
@file:Suppress("MatchingDeclarationName", "TooManyFunctions")

package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Telemetry
import io.teslasync.shared.core.diagnostics.TelemetryEvent
import io.teslasync.shared.core.presentation.anomalies.AnomaliesStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

// ─────────────────────────────────────────────────────────────────────────────
// Registry descriptor — mirrors web/src/features/dashboard/widgets/registry/analytics.ts
// (id `anomaly-detector`, category `analytics`, default 2x4, min 1x2, max 4x40). A future
// dashboard grid host registers this surface with the same id and honours these constraints.
// ─────────────────────────────────────────────────────────────────────────────

/** A dashboard grid footprint in (cols x rows) cells. */
data class DashboardWidgetGridSize(
    val cols: Int,
    val rows: Int,
)

/** Static registry metadata for a draggable dashboard panel (the native registry-entry analogue). */
data class DashboardWidgetSpec(
    val id: String,
    val category: String,
    val defaultSize: DashboardWidgetGridSize,
    val minSize: DashboardWidgetGridSize,
    val maxSize: DashboardWidgetGridSize,
) {
    /** Clamps an arbitrary host-requested [size] into this widget's [minSize]..[maxSize] envelope. */
    fun clamp(size: DashboardWidgetGridSize): DashboardWidgetGridSize =
        DashboardWidgetGridSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /** Compact (single-column) layout, mirroring the web `size.cols <= 1` branch. */
    fun isCompact(size: DashboardWidgetGridSize): Boolean = clamp(size).cols <= 1
}

/** Canonical registry entry for the Anomaly Detector dashboard widget. */
val AnomalyDetectorWidgetSpec: DashboardWidgetSpec =
    DashboardWidgetSpec(
        id = "anomaly-detector",
        category = "analytics",
        defaultSize = DashboardWidgetGridSize(cols = 2, rows = 4),
        minSize = DashboardWidgetGridSize(cols = 1, rows = 2),
        maxSize = DashboardWidgetGridSize(cols = 4, rows = 40),
    )

/** Stable diagnostics surface slug emitted on first composition (P1/S11 contract). */
const val ANOMALY_DETECTOR_SURFACE_SLUG: String = "AnomalyDetectorWidget"

// ─────────────────────────────────────────────────────────────────────────────
// Domain model + pure adapter — the JsonElement → typed projection the view renders.
// Framework-free so it is fully unit-tested off-device (the web hook applies no select()).
// ─────────────────────────────────────────────────────────────────────────────

/** Statistical-anomaly severity tier (web SEVERITY_ORDER: critical &lt; warning &lt; info). */
enum class AnomalySeverity(
    val wire: String,
    val order: Int,
) {
    Critical("critical", 0),
    Warning("warning", 1),
    Info("info", 2),
    ;

    companion object {
        /** Maps a wire severity string to a tier, defaulting to [Info] (the web default rank). */
        fun fromWire(value: String?): AnomalySeverity = entries.firstOrNull { it.wire.equals(value?.trim(), ignoreCase = true) } ?: Info
    }
}

/** One detected anomaly row; every field is nullable because the wire payload is best-effort. */
data class AnomalyEntry(
    val signal: String?,
    val zScore: Double?,
    val detectedAtIso: String?,
    val message: String?,
    val severity: AnomalySeverity,
)

/** The projected anomaly read-model: severity-sorted rows plus the derived count / worst tier. */
data class AnomalyProjection(
    val entries: List<AnomalyEntry>,
) {
    val count: Int get() = entries.size

    /** Highest-severity (lowest-rank) tier present, defaulting to [AnomalySeverity.Info] when empty. */
    val maxSeverity: AnomalySeverity
        get() = entries.minByOrNull { it.severity.order }?.severity ?: AnomalySeverity.Info
}

/**
 * Projects the `{anomalies:[{signal,severity,z_score,detected_at,message,...}]}` SI envelope into a
 * severity-sorted [AnomalyProjection]. Null / malformed payloads collapse to an empty projection
 * rather than throwing, so the view always has something to render.
 */
internal fun projectAnomalies(json: JsonElement?): AnomalyProjection {
    val rows =
        (json as? JsonObject)?.get("anomalies") as? JsonArray
            ?: return AnomalyProjection(emptyList())
    val entries =
        rows
            .mapNotNull { element ->
                val obj = element as? JsonObject ?: return@mapNotNull null
                AnomalyEntry(
                    signal = obj.stringField("signal"),
                    zScore = obj.doubleField("z_score"),
                    detectedAtIso = obj.stringField("detected_at"),
                    message = obj.stringField("message"),
                    severity = AnomalySeverity.fromWire(obj.stringField("severity")),
                )
            }.sortedBy { it.severity.order }
    return AnomalyProjection(entries)
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Relative-time bucket, mapped to the freshness i18n keys at the render boundary. */
enum class RelativeUnit { JustNow, Minutes, Hours, Days }

/** A bucketed elapsed-time amount (`value` is unused for [RelativeUnit.JustNow]). */
data class RelativeTime(
    val unit: RelativeUnit,
    val value: Long,
)

/**
 * Buckets the elapsed time between [detectedAtMs] and [nowMs] exactly like the web
 * `formatRelativeTime` (&lt;1m ⇒ just now, &lt;60m ⇒ Nm, &lt;24h ⇒ Nh, else Nd). Future / null
 * timestamps clamp to "just now" / `null`.
 */
internal fun relativeTimeOf(
    detectedAtMs: Long?,
    nowMs: Long,
): RelativeTime? {
    if (detectedAtMs == null) return null
    val diffMinutes = (nowMs - detectedAtMs).coerceAtLeast(0) / MILLIS_PER_MINUTE
    return when {
        diffMinutes < 1 -> RelativeTime(RelativeUnit.JustNow, 0)
        diffMinutes < MINUTES_PER_HOUR -> RelativeTime(RelativeUnit.Minutes, diffMinutes)
        else -> {
            val hours = diffMinutes / MINUTES_PER_HOUR
            if (hours < HOURS_PER_DAY) {
                RelativeTime(RelativeUnit.Hours, hours)
            } else {
                RelativeTime(RelativeUnit.Days, hours / HOURS_PER_DAY)
            }
        }
    }
}

/** Lenient ISO-8601 → epoch-millis parse (offset, `Z`, or zoneless-as-UTC), `null` on failure. */
internal fun parseIsoToEpochMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .getOrNull()
}

/** Formats a z-score to one decimal (web `fmtNumber(z ?? 0, 1)`); null ⇒ "0.0". */
internal fun formatZScore(zScore: Double?): String = String.format(Locale.US, "%.1f", zScore ?: 0.0)

/** Maps the Android [ErrorKind] taxonomy onto the recovery-oriented [QueryErrorKind] copy bucket. */
internal fun queryErrorKindFor(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    when (errorKind) {
        ErrorKind.Timeout, ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network -> QueryErrorKind.Offline
        else -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
    }

/** Builds the TalkBack description for one tip row from already-localized parts (no English here). */
internal fun anomalyRowAccessibilityLabel(
    signal: String?,
    severityLabel: String,
    zScoreLabel: String,
    relativeLabel: String?,
    message: String?,
): String =
    listOfNotNull(
        severityLabel.takeIf { it.isNotBlank() },
        signal?.takeIf { it.isNotBlank() },
        zScoreLabel.takeIf { it.isNotBlank() },
        relativeLabel?.takeIf { it.isNotBlank() },
        message?.takeIf { it.isNotBlank() },
    ).joinToString(separator = ", ")

/** Builds the compact-tile TalkBack description from already-localized parts. */
internal fun compactAccessibilityLabel(
    count: Int,
    severityLabel: String?,
    activeCountLabel: String,
    noAnomaliesLabel: String,
): String =
    if (count > 0) {
        listOfNotNull(activeCountLabel, severityLabel?.takeIf { it.isNotBlank() }).joinToString(separator = ", ")
    } else {
        noAnomaliesLabel
    }

// ─────────────────────────────────────────────────────────────────────────────
// Composable — binds the shared S8 state holders and renders every state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Native Anomaly Detector dashboard panel — the Jetpack Compose / Material 3 parity port of web
 * `features/dashboard/widgets/AnomalyDetectorWidget.tsx`.
 *
 * It binds two shared (S8) state holders — [AnomaliesStore] and [VehiclesStore] — and never reaches
 * the network itself. The active vehicle follows the web rule `vehicleId ?? vehicles[0].id`, and the
 * anomalies feed stays disabled (a never-fetching Loading slot) until a vehicle resolves, exactly
 * like the web `enabled: vehicleId !== null` gate. Every surface the web renders is reproduced:
 * loading, content, empty ("No anomalies"), error (with retry), stale, and offline (cached + chip).
 *
 * @param size the host-assigned grid footprint; `cols <= 1` selects the compact count tile.
 * @param vehicleId optional explicit vehicle (string id); when null the first enrolled vehicle wins.
 * @param telemetry optional diagnostics emitter; a [TelemetryEvent.ScreenView] fires once on open.
 */
@Composable
fun AnomalyDetectorWidget(
    anomaliesStore: AnomaliesStore,
    vehiclesStore: VehiclesStore,
    size: DashboardWidgetGridSize,
    modifier: Modifier = Modifier,
    vehicleId: String? = null,
    telemetry: Telemetry? = null,
    appVersion: String = DEFAULT_APP_VERSION,
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    LaunchedEffect(Unit) {
        telemetry?.track(
            TelemetryEvent.ScreenView(
                screen = ANOMALY_DETECTOR_SURFACE_SLUG,
                platform = "android",
                appVersion = appVersion,
            ),
        )
    }

    val vehiclesResource by remember { vehiclesStore.vehicles() }.collectAsStateWithLifecycle()
    val vehiclesState = vehiclesResource.toUiState()
    val resolvedVehicleId =
        vehicleId ?: vehiclesState.data
            ?.firstOrNull()
            ?.id
            ?.toString()

    val anomaliesFlow = remember(resolvedVehicleId) { anomaliesStore.anomalies(resolvedVehicleId) }
    val anomaliesResource by anomaliesFlow.collectAsStateWithLifecycle()
    val state = anomaliesResource.toUiState { projectAnomalies(it).entries.isEmpty() }
    val projection = projectAnomalies(state.data)

    val compact = AnomalyDetectorWidgetSpec.isCompact(size)

    AnomalyDetectorWidgetContent(
        state = state,
        projection = projection,
        compact = compact,
        onRefresh = { anomaliesStore.refreshAnomalies(resolvedVehicleId) },
        modifier = modifier,
        nowMs = nowMs,
    )
}

/**
 * Stateless render half of [AnomalyDetectorWidget]: given an already-projected [state] +
 * [projection] it draws the panel chrome and the matching surface. Hoisting the state keeps the
 * store wiring in the public entry point and makes every visual state directly renderable from tests.
 */
@Composable
internal fun AnomalyDetectorWidgetContent(
    state: UiState<JsonElement>,
    projection: AnomalyProjection,
    compact: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        WidgetHeader(
            title = stringResource(R.string.translation_widget_anomalyDetector_title),
            showTitle = !compact,
            state = state,
            onRefresh = onRefresh,
        )
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_BODY_HEIGHT)
                    .padding(top = Spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            WidgetBody(
                state = state,
                projection = projection,
                compact = compact,
                nowMs = nowMs,
                onRetry = onRefresh,
            )
        }
    }
}

@Composable
private fun WidgetHeader(
    title: String,
    showTitle: Boolean,
    state: UiState<JsonElement>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showTitle) {
            Icon(
                imageVector = TeslaGlyphs.Warning,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(text = title, modifier = Modifier.weight(1f))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        FreshnessChip(state = state)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.isLoading,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun FreshnessChip(state: UiState<JsonElement>) {
    when {
        state.isOffline ->
            Badge(text = stringResource(R.string.translation_common_offline), variant = BadgeVariant.Warning, dot = true)

        state.stale ->
            Badge(text = stringResource(R.string.translation_mqtt_stale), variant = BadgeVariant.Warning, dot = true)

        state.refreshing ->
            Badge(text = stringResource(R.string.translation_freshness_updating), variant = BadgeVariant.Neutral)
    }
}

@Composable
private fun WidgetBody(
    state: UiState<JsonElement>,
    projection: AnomalyProjection,
    compact: Boolean,
    nowMs: () -> Long,
    onRetry: () -> Unit,
) {
    when {
        state.isLoading ->
            Spinner(size = SpinnerSize.Sm, label = stringResource(R.string.translation_freshness_updating))

        state.isError ->
            QueryError(
                kind = queryErrorKindFor(state.errorKind, state.httpStatus),
                onRetry = onRetry,
            )

        projection.entries.isEmpty() ->
            EmptyState(
                message = stringResource(R.string.translation_widget_anomalyDetector_noAnomalies),
                icon = TeslaGlyphs.Warning,
            )

        compact -> CompactSummary(projection = projection)
        else -> AnomalyTipList(entries = projection.entries, nowMs = nowMs)
    }
}

@Composable
private fun CompactSummary(projection: AnomalyProjection) {
    val severityLabel = severityLabel(projection.maxSeverity)
    val activeLabel = stringResource(R.string.translation_widget_anomalyDetector_activeCount, projection.count)
    val noAnomalies = stringResource(R.string.translation_widget_anomalyDetector_noAnomalies)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics {
                    contentDescription =
                        compactAccessibilityLabel(projection.count, severityLabel, activeLabel, noAnomalies)
                },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(text = projection.count.toString())
        Badge(text = activeLabel, variant = severityBadgeVariant(projection.maxSeverity))
    }
}

@Composable
private fun AnomalyTipList(
    entries: List<AnomalyEntry>,
    nowMs: () -> Long,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        entries.forEach { entry ->
            AnomalyTipCard(entry = entry, nowMs = nowMs)
        }
    }
}

@Composable
private fun AnomalyTipCard(
    entry: AnomalyEntry,
    nowMs: () -> Long,
) {
    val severityLabel = severityLabel(entry.severity)
    val zScoreLabel = "z=" + formatZScore(entry.zScore)
    val relativeLabel = relativeLabel(relativeTimeOf(parseIsoToEpochMillis(entry.detectedAtIso), nowMs()))
    val signal = entry.signal?.takeIf { it.isNotBlank() } ?: EM_DASH
    val message = entry.message?.takeIf { it.isNotBlank() } ?: EM_DASH
    val titleLine = listOf(signal, zScoreLabel, relativeLabel ?: "").filter { it.isNotBlank() }.joinToString(SEPARATOR)

    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier.fillMaxWidth().semantics {
                    contentDescription =
                        anomalyRowAccessibilityLabel(entry.signal, severityLabel, zScoreLabel, relativeLabel, entry.message)
                },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = severityIcon(entry.severity),
                contentDescription = null,
                size = IconSize.Md,
                tint = severityTint(entry.severity),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    BodyText(text = titleLine, modifier = Modifier.weight(1f))
                    Badge(text = severityLabel, variant = severityBadgeVariant(entry.severity))
                }
                Caption(text = message)
            }
        }
    }
}

// ── State-free → Compose mapping helpers ─────────────────────────────────────

@Composable
private fun severityLabel(severity: AnomalySeverity): String =
    when (severity) {
        AnomalySeverity.Critical -> stringResource(R.string.translation_quietHours_severity_critical)
        AnomalySeverity.Warning -> stringResource(R.string.translation_quietHours_severity_warn)
        AnomalySeverity.Info -> stringResource(R.string.translation_quietHours_severity_info)
    }

@Composable
private fun relativeLabel(relativeTime: RelativeTime?): String? =
    when (relativeTime?.unit) {
        null -> null
        RelativeUnit.JustNow -> stringResource(R.string.translation_freshness_justNow)
        RelativeUnit.Minutes -> stringResource(R.string.translation_freshness_minutes, relativeTime.value)
        RelativeUnit.Hours -> stringResource(R.string.translation_freshness_hours, relativeTime.value)
        RelativeUnit.Days -> stringResource(R.string.translation_freshness_days, relativeTime.value)
    }

private fun severityIcon(severity: AnomalySeverity): ImageVector =
    when (severity) {
        AnomalySeverity.Critical -> TeslaGlyphs.Octagon
        AnomalySeverity.Warning -> TeslaGlyphs.Warning
        AnomalySeverity.Info -> TeslaGlyphs.Info
    }

@Composable
private fun severityTint(severity: AnomalySeverity): Color =
    when (severity) {
        AnomalySeverity.Critical -> TeslaTokens.status.danger
        AnomalySeverity.Warning -> TeslaTokens.status.warning
        AnomalySeverity.Info -> TeslaTokens.status.info
    }

private fun severityBadgeVariant(severity: AnomalySeverity): BadgeVariant =
    when (severity) {
        AnomalySeverity.Critical -> BadgeVariant.Danger
        AnomalySeverity.Warning -> BadgeVariant.Warning
        AnomalySeverity.Info -> BadgeVariant.Neutral
    }

// ── Internal constants ───────────────────────────────────────────────────────

private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val DEFAULT_APP_VERSION = "0.1.0"
private const val EM_DASH = "—"
private const val SEPARATOR = " · "
private val MIN_BODY_HEIGHT = 44.dp
