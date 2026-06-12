// The native Jetpack Compose + Material 3 AnomalyInlineRow feature view — a parity port of
// web/src/features/system/components/status/AnomalyInlineRow.tsx and the `@/components/status` HealthRow it
// renders. The web component surfaces the most recent anomaly for the first vehicle as a single Health row
// (a colored status dot, an Activity glyph, the "Anomalies" label, a right-aligned severity-colored summary,
// and a click-through chevron to `/anomaly-detection`), and returns `null` when there is no data, no anomaly
// in the 24h window, or no top entry.
//
// There is no native `@/components/status` HealthRow atom (atomic shared components are the P3
// component-library bundle's scope, not this surface's), so the row is composed here from the shared atoms
// (status dot + the locally-authored Activity glyph + typography + a chevron) — the same approach the sibling
// StatusHeader port takes for the one lucide glyph it needs. All data flows through the shared
// [AnomalyInlineRowViewModel] (P1/S8); the view performs NO HTTP. Every visible string resolves through the
// i18n catalog (P1/S10) and the actionable row carries a merged TalkBack label (web `aria-label`).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web component returns `null` in its
// loading / error / no-anomaly branches, but the P3 contract requires every state to render (never a blank
// box). So this surface renders the row in EVERY state — a skeleton summary while loading, a danger row with
// a Retry control on a hard error, a benign "No anomalies" row for the empty/no-vehicle case, and a freshness
// chip + auto-refresh for stale/offline — folding the web's three null branches into the empty row. The
// count segment reuses the sibling Anomaly-Detector widget's `activeCount` ("N active") catalog phrase rather
// than the web's literal "N in 24h" (there is no "in 24h" catalog key); the row is the 24h surface by design.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AnomalyInlineRow) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.anomalyinlinerow

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant

// ── Geometry (web `h-2.5 w-2.5` dot, `min-h-[44px]` row, `h-4 w-4` icon) ────────────────────────────────
private val DOT_SIZE: Dp = 10.dp
private val ROW_MIN_HEIGHT: Dp = 44.dp
private val SUMMARY_SKELETON_WIDTH: Dp = 96.dp
private val SUMMARY_SKELETON_HEIGHT: Dp = 12.dp

/**
 * Stateful entry point. Binds the shared vehicles + anomalies feeds via [source] into an
 * [AnomalyInlineRowViewModel], records the one-shot `view.opened` diagnostic, collects the live anomaly
 * state, and renders the row. A host supplies [source] (an adapter over the shared S8 vehicles + anomalies
 * data layer) and an [onOpen] callback for the web `to="/anomaly-detection"` click-through; [logger] defaults
 * to the process logger and [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun AnomalyInlineRow(
    source: AnomalyInlineRowSource,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ANOMALY_INLINE_ROW_SLUG,
) {
    val viewModel: AnomalyInlineRowViewModel =
        viewModel(key = instanceKey, factory = AnomalyInlineRowViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AnomalyInlineRowContent(
        state = state,
        modifier = modifier,
        onOpen = onOpen,
        onRetry = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Renders the single
 * Health row: a skeleton summary while loading, a danger row with a Retry control on a hard failure with no
 * cache, and otherwise the resolved row (the web HealthRow when an anomaly exists, the benign "No anomalies"
 * row when not), with a freshness chip + a one-shot auto-refresh when the cached value is stale/offline.
 *
 * @param nowMs wall-clock seam for the relative-time summary (web `Date.now()`); injectable for tests.
 */
@Composable
fun AnomalyInlineRowContent(
    state: UiState<JsonElement>,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRetry()
    }
    val display = remember(state.data) { AnomalyInlineRowProjection.project(state.data) }
    val label = stringResource(R.string.translation_anomaly_count)

    when {
        state.isLoading -> LoadingRow(label = label, modifier = modifier)
        state.isError && !state.hasData -> ErrorRow(label = label, onRetry = onRetry, modifier = modifier)
        else ->
            ResolvedRow(
                state = state,
                display = display,
                label = label,
                onOpen = onOpen,
                nowMs = nowMs,
                modifier = modifier,
            )
    }
}

/** First-load row: the status dot + glyph + label with a shimmering summary skeleton (never a blank box). */
@Composable
private fun LoadingRow(
    label: String,
    modifier: Modifier = Modifier,
) {
    val description = "$label$DESCRIPTION_SEPARATOR${stringResource(R.string.translation_common_loading)}"
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HealthStatusDot(HealthRowStatus.Unknown)
        ActivityIcon()
        BodyText(text = label, modifier = Modifier.weight(1f), maxLines = 1)
        Box(modifier = Modifier.width(SUMMARY_SKELETON_WIDTH)) {
            Skeleton(height = SUMMARY_SKELETON_HEIGHT, rounded = true)
        }
    }
}

/** Hard-failure row (no cached value): a danger dot + label + short error text + a Retry control. */
@Composable
private fun ErrorRow(
    label: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HealthStatusDot(HealthRowStatus.Unhealthy)
        ActivityIcon()
        BodyText(text = label, modifier = Modifier.weight(1f), maxLines = 1)
        Text(
            text = stringResource(R.string.translation_queryError_title),
            style = MaterialTheme.typography.labelMedium,
            color = TeslaTokens.status.danger,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            size = IconSize.Sm,
        )
    }
}

/**
 * The resolved row — the web HealthRow when an anomaly exists, otherwise the benign "No anomalies" row. It is
 * click-through (web `to`) only when an anomaly is present, mirroring the web row that appears only then; the
 * empty row is informational. A freshness chip flags stale/offline cached values.
 */
@Composable
private fun ResolvedRow(
    state: UiState<JsonElement>,
    display: AnomalyInlineDisplay,
    label: String,
    onOpen: () -> Unit,
    nowMs: () -> Long,
    modifier: Modifier = Modifier,
) {
    val summary =
        if (display.hasAnomaly) {
            anomalySummary(display = display, nowMs = nowMs)
        } else {
            stringResource(R.string.translation_widget_anomalyDetector_noAnomalies)
        }
    val description = "$label$DESCRIPTION_SEPARATOR$summary"
    val summaryColor =
        if (display.hasAnomaly) healthStatusColor(display.status) else MaterialTheme.colorScheme.onSurfaceVariant

    val rowModifier =
        modifier
            .fillMaxWidth()
            .heightIn(min = ROW_MIN_HEIGHT)
            .then(if (display.hasAnomaly) Modifier.clickable(role = Role.Button, onClick = onOpen) else Modifier)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm)
            .semantics { contentDescription = description }

    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HealthStatusDot(display.status)
        ActivityIcon()
        BodyText(text = label, modifier = Modifier.weight(1f), maxLines = 1)
        FreshnessChip(state)
        Text(
            text = summary,
            style = MaterialTheme.typography.labelMedium,
            color = summaryColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (display.hasAnomaly) {
            Icon(
                imageVector = TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The web freshness affordance: an offline / stale / updating chip, or nothing while fresh. */
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

/** The 10dp status dot — the web `bg-{status}-400` indicator, tinted from the per-theme status palette. */
@Composable
private fun HealthStatusDot(status: HealthRowStatus) {
    Box(
        modifier =
            Modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(healthStatusColor(status)),
    )
}

/** The web `<Activity className="h-4 w-4" />` glyph, in the secondary content color (web `text-secondary`). */
@Composable
private fun ActivityIcon() {
    Icon(
        imageVector = AnomalyInlineGlyphs.Activity,
        contentDescription = null,
        size = IconSize.Sm,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The web summary `${count} active · ${signal} ${relative}` from already-localized, catalog-resolved parts. */
@Composable
private fun anomalySummary(
    display: AnomalyInlineDisplay,
    nowMs: () -> Long,
): String {
    val count = stringResource(R.string.translation_widget_anomalyDetector_activeCount, display.count)
    val signal = display.topSignal ?: EM_DASH
    val relative = relativeLabel(relativeTimeOf(parseIsoToEpochMillis(display.detectedAtIso), nowMs()))
    return "$count$SUMMARY_SEPARATOR$signal $relative"
}

/** Maps a [RelativeTime] bucket onto its freshness i18n key (web `formatRelative`). */
@Composable
private fun relativeLabel(relativeTime: RelativeTime): String =
    when (relativeTime.unit) {
        RelativeUnit.JustNow -> stringResource(R.string.translation_freshness_justNow)
        RelativeUnit.Seconds -> stringResource(R.string.translation_widget_signalHealth_secAgo, relativeTime.value)
        RelativeUnit.Minutes -> stringResource(R.string.translation_freshness_minutes, relativeTime.value)
        RelativeUnit.Hours -> stringResource(R.string.translation_freshness_hours, relativeTime.value)
        RelativeUnit.Days -> stringResource(R.string.translation_freshness_days, relativeTime.value)
    }

/** Maps a [HealthRowStatus] onto its per-theme dot/summary color (web `DOT_FOR_STATUS` / `TEXT_FOR_STATUS`). */
@Composable
private fun healthStatusColor(status: HealthRowStatus): Color =
    when (status) {
        HealthRowStatus.Healthy -> TeslaTokens.status.success
        HealthRowStatus.Degraded -> TeslaTokens.status.warning
        HealthRowStatus.Unhealthy -> TeslaTokens.status.danger
        HealthRowStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The web summary `·` is between value segments; the a11y description uses an em-dash (web `aria-label`). */
private const val DESCRIPTION_SEPARATOR: String = " \u2014 "

/**
 * The one glyph this surface needs that the shared sets do not carry. The web uses lucide `Activity` (the
 * heart-rate pulse line); Android ships no equivalent without the frozen `material-icons-extended` artifact,
 * so — exactly as the shared `TeslaGlyphs` do for their lucide ports — it is authored here as a 24×24 stroked
 * vector (`M22 12h-4l-3 9L9 3l-3 9H2`) recolored at render time by the [Icon] composable's tint.
 */
private object AnomalyInlineGlyphs {
    val Activity: ImageVector =
        ImageVector
            .Builder(
                name = "Activity",
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                ) {
                    moveTo(22f, 12f)
                    lineTo(18f, 12f)
                    lineTo(15f, 21f)
                    lineTo(9f, 3f)
                    lineTo(6f, 12f)
                    lineTo(2f, 12f)
                }
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each rendered state) ─────────────────────────

private const val PREVIEW_DETECTED_AT = "2026-06-01T12:00:00Z"
private const val PREVIEW_AGE_MS = 5 * 60 * 1_000L

private fun previewEnvelope(
    count: Int,
    severity: String,
    signal: String,
): JsonElement =
    buildJsonObject {
        put("anomalies_last_24h", count)
        putJsonArray("anomalies") {
            addJsonObject {
                put("signal", signal)
                put("severity", severity)
                put("detected_at", PREVIEW_DETECTED_AT)
            }
        }
    }

private fun previewNowMs(): Long = Instant.parse(PREVIEW_DETECTED_AT).toEpochMilli() + PREVIEW_AGE_MS

@Preview(name = "Critical anomaly", showBackground = true)
@Composable
private fun AnomalyInlineRowCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(3, "critical", "BatteryVoltage"), fetchedAt = 1L),
            nowMs = ::previewNowMs,
        )
    }
}

@Preview(name = "Warning anomaly", showBackground = true)
@Composable
private fun AnomalyInlineRowWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(1, "warning", "TirePressureFL"), fetchedAt = 1L),
            nowMs = ::previewNowMs,
        )
    }
}

@Preview(name = "Empty — no anomalies", showBackground = true)
@Composable
private fun AnomalyInlineRowEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(state = UiState(phase = UiPhase.Empty, data = previewEnvelope(0, "info", ""), fetchedAt = 1L))
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AnomalyInlineRowLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(state = UiState.loading())
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun AnomalyInlineRowErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "Offline — cached", showBackground = true)
@Composable
private fun AnomalyInlineRowOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AnomalyInlineRowContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewEnvelope(2, "warning", "ChargeState"),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            nowMs = ::previewNowMs,
        )
    }
}
