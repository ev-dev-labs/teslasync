// File hosts the SignalHealth Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.signalhealth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Signal Health dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/SignalHealthWidget.tsx`. It mirrors the web `WidgetShell` (full
 * skeleton while stats loads, otherwise an activity glyph + title + stats-driven freshness header)
 * wrapping either the compact centered health badge + signal count, or the Total Signals / Active /
 * With Gaps / Freshness stat grid plus a status badge and — at wide footprints — the stale/gap signal
 * list, or a friendly empty state when no feed has resolved. All data flows through the
 * [SignalHealthWidgetViewModel] (P1/S8); the view performs no HTTP. Every string resolves from
 * `strings.xml` (P1/S10) and every interactive control + gap row carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared vehicles + telemetry feeds.
 * @param size the grid footprint; controls the compact vs standard vs wide layout (web isCompact/isWide).
 */
@Composable
fun SignalHealthWidget(
    viewModel: SignalHealthWidgetViewModel,
    modifier: Modifier = Modifier,
    size: SignalHealthSize = SignalHealthRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    SignalHealthWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Signal Health panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over cached figures, and the compact
 * 1-column health-badge layout). Hoisted out of the ViewModel so it is preview- and screenshot-testable
 * for each state. Stale (non-error) data auto-refreshes exactly once, mirroring the web realtime refetch.
 */
@Composable
fun SignalHealthWidgetContent(
    state: UiState<SignalHealthData>,
    size: SignalHealthSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val compact = size.isCompact
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> SignalHealthLoading(compact = compact)
            state.isError -> SignalHealthError(state = state, onRetry = onRetry)
            else -> {
                val data = state.data ?: SignalHealthData.EMPTY
                if (compact) {
                    SignalHealthFreshnessRow(state)
                    if (data.hasData) SignalHealthCompact(data = data) else SignalHealthEmpty()
                } else {
                    SignalHealthHeader(state = state, level = data.healthLevel, onRefresh = onRefresh)
                    if (data.hasData) SignalHealthBody(data = data, size = size) else SignalHealthEmpty()
                }
            }
        }
    }
}

@Composable
private fun SignalHealthHeader(
    state: UiState<*>,
    level: SignalHealthLevel,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = SignalHealthGlyphs.Activity,
            contentDescription = null,
            size = IconSize.Sm,
            tint = healthColor(level),
        )
        Caption(
            text = stringResource(R.string.translation_widget_signalHealth_title).uppercase(Locale.getDefault()),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** Top-right freshness chip for the title-less compact layout (web `WidgetShell` overlay). */
@Composable
private fun SignalHealthFreshnessRow(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

/** Compact 1-column layout — the health badge, the big signal count, its label, and the freshness age. */
@Composable
private fun SignalHealthCompact(data: SignalHealthData) {
    val locale = Locale.getDefault()
    val total = SignalHealthProjection.formatCount(data.totalSignals, locale)
    val signalsLabel = stringResource(R.string.translation_widget_signalHealth_signals)
    val age = signalFreshnessAge(data.freshnessAgeSeconds)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = COMPACT_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Badge(text = "${data.activeCount}/${data.liveTotal}", variant = signalHealthBadgeVariant(data.healthLevel))
        MetricValue(total, modifier = Modifier.semantics { contentDescription = "$total $signalsLabel" })
        Caption(signalsLabel)
        if (age != SignalAge.Unknown) {
            Text(
                text = signalAgeLabel(age),
                style = MaterialTheme.typography.labelSmall,
                color = healthColor(data.healthLevel),
            )
        }
    }
}

/** Standard/wide layout — the stat grid, the status badge, and (wide) the stale/gap signal list. */
@Composable
private fun SignalHealthBody(
    data: SignalHealthData,
    size: SignalHealthSize,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SignalHealthStatGrid(data)
        SignalHealthStatusRow(level = data.healthLevel)
        if (size.isWide && data.gapSignals.isNotEmpty()) {
            SignalHealthStaleList(gaps = data.gapSignals)
        }
    }
}

@Composable
private fun SignalHealthStatGrid(data: SignalHealthData) {
    val locale = Locale.getDefault()
    val freshness = signalAgeLabel(signalFreshnessAge(data.freshnessAgeSeconds))
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_widget_signalHealth_totalSignals),
                value = SignalHealthProjection.formatCount(data.totalSignals, locale),
                modifier = Modifier.weight(1f),
                icon = SignalHealthGlyphs.Activity,
            )
            StatCard(
                label = stringResource(R.string.translation_widget_signalHealth_active),
                value = SignalHealthProjection.formatCount(data.activeCount, locale),
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.CheckCircle,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_widget_signalHealth_withGaps),
                value = SignalHealthProjection.formatCount(data.staleCount, locale),
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.AlertTriangle,
            )
            StatCard(
                label = stringResource(R.string.translation_widget_signalHealth_freshness),
                value = freshness,
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Clock,
            )
        }
    }
}

@Composable
private fun SignalHealthStatusRow(level: SignalHealthLevel) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(stringResource(R.string.translation_widget_signalHealth_status).uppercase(Locale.getDefault()))
        Badge(text = healthLevelLabel(level), variant = signalHealthBadgeVariant(level))
    }
}

@Composable
private fun SignalHealthStaleList(gaps: List<SignalGap>) {
    val nowMillis = remember(gaps) { System.currentTimeMillis() }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        StaleListDivider()
        Caption(stringResource(R.string.translation_widget_signalHealth_staleSignals).uppercase(Locale.getDefault()))
        gaps.take(SignalHealthRegistration.STALE_LIST_LIMIT).forEach { gap ->
            SignalHealthGapRow(gap = gap, nowMillis = nowMillis)
        }
    }
}

@Composable
private fun SignalHealthGapRow(
    gap: SignalGap,
    nowMillis: Long,
) {
    val time = signalRelativeLabel(gap.lastSeenMillis, nowMillis)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = GAP_ROW_MIN_HEIGHT)
                .semantics(mergeDescendants = true) { contentDescription = "${gap.name}, $time" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(
            gap.name,
            modifier = Modifier.weight(GAP_NAME_WEIGHT),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Box(modifier = Modifier.weight(GAP_TIME_WEIGHT), contentAlignment = Alignment.CenterEnd) {
            Caption(time)
        }
    }
}

@Composable
private fun StaleListDivider() {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DIVIDER_THICKNESS)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = DIVIDER_ALPHA)),
    )
}

@Composable
private fun SignalHealthEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_signalHealth_noData),
        icon = SignalHealthGlyphs.Activity,
    )
}

@Composable
private fun SignalHealthLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = COMPACT_LOADING_FRACTION, height = COMPACT_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = TITLE_LOADING_FRACTION, height = TITLE_LOADING_HEIGHT)
            StatGridSkeleton(count = 2)
            StatGridSkeleton(count = 2)
        }
    }
}

@Composable
private fun SignalHealthError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = signalHealthErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_signalHealth_title),
        onRetry = onRetry,
    )
}

@Composable
private fun healthColor(level: SignalHealthLevel): Color =
    when (level) {
        SignalHealthLevel.Healthy -> TeslaTokens.status.success
        SignalHealthLevel.Degraded -> TeslaTokens.status.warning
        SignalHealthLevel.Critical -> TeslaTokens.status.danger
        SignalHealthLevel.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun healthLevelLabel(level: SignalHealthLevel): String =
    stringResource(
        when (level) {
            SignalHealthLevel.Healthy -> R.string.translation_widget_signalHealth_healthy
            SignalHealthLevel.Degraded -> R.string.translation_widget_signalHealth_degraded
            SignalHealthLevel.Critical -> R.string.translation_widget_signalHealth_critical
            SignalHealthLevel.Unknown -> R.string.translation_widget_signalHealth_unknown
        },
    )

/** Resolves the Freshness stat label (web `formatAge`, i18n words injected). */
@Composable
private fun signalAgeLabel(age: SignalAge): String =
    when (age) {
        SignalAge.Unknown -> SIGNAL_HEALTH_EM_DASH
        is SignalAge.Seconds -> stringResource(R.string.translation_widget_signalHealth_secAgo, age.value.toString())
        is SignalAge.Minutes -> stringResource(R.string.translation_widget_signalHealth_minAgo, age.value.toString())
        is SignalAge.Hours -> stringResource(R.string.translation_widget_signalHealth_hrAgo, age.value.toString())
    }

/** Resolves a gap row's last-seen label (web `formatRelative`, i18n words injected). */
@Composable
private fun signalRelativeLabel(
    millis: Long?,
    nowMillis: Long,
): String =
    when (val rel = signalRelativeAge(millis, nowMillis)) {
        SignalRelative.Unknown -> SIGNAL_HEALTH_EM_DASH
        SignalRelative.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is SignalRelative.Minutes -> stringResource(R.string.translation_freshness_minutes, rel.value.toString())
        is SignalRelative.Hours -> stringResource(R.string.translation_freshness_hours, rel.value.toString())
        is SignalRelative.Days -> stringResource(R.string.translation_freshness_days, rel.value.toString())
        is SignalRelative.Absolute -> SIGNAL_HEALTH_ABSOLUTE_FORMATTER.format(Instant.ofEpochMilli(rel.epochMillis))
    }

// ── Local glyph — the web `Activity` (lucide). Authored as a 24×24 stroked vector because the shared
// data-display layer carries no Activity glyph (mirrors NotificationStatsWidget's local Send/Radio). ──

private fun signalHealthStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private object SignalHealthGlyphs {
    /** Heart-rate "activity" glyph (lucide `activity`) — the header + Total Signals + empty-state icon. */
    val Activity: ImageVector =
        signalHealthStroked("SignalHealthActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }
}

private val SIGNAL_HEALTH_ABSOLUTE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private val COMPACT_MIN_HEIGHT = 88.dp
private val COMPACT_NUMBER_HEIGHT = 32.dp
private val TITLE_LOADING_HEIGHT = 14.dp
private val GAP_ROW_MIN_HEIGHT = 28.dp
private val DIVIDER_THICKNESS = 1.dp
private const val DIVIDER_ALPHA = 0.06f
private const val COMPACT_LOADING_FRACTION = 0.6f
private const val TITLE_LOADING_FRACTION = 0.5f
private const val GAP_NAME_WEIGHT = 1.2f
private const val GAP_TIME_WEIGHT = 1f

// ── Previews — one per rendered state (content / wide + stale list / compact / empty / loading / error) ──

private const val PREVIEW_NOW = 1_700_000_000_000L

private fun previewData(): SignalHealthData =
    SignalHealthData(
        totalSignals = 48,
        activeCount = 40,
        staleCount = 6,
        gapSignals =
            listOf(
                SignalGap("VehicleSpeed", null),
                SignalGap("TpmsPressureFl", PREVIEW_NOW - 22L * 60L * 1000L),
                SignalGap("ChargeState", PREVIEW_NOW - 3L * 60L * 60L * 1000L),
            ),
        freshnessAgeSeconds = 12,
        healthLevel = SignalHealthLevel.Degraded,
        resolved = true,
    )

@Preview(name = "SignalHealth · content", showBackground = true)
@Composable
private fun SignalHealthContentPreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = SignalHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SignalHealth · wide + stale list", showBackground = true)
@Composable
private fun SignalHealthWidePreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = SignalHealthSize(cols = 4, rows = 6),
        )
    }
}

@Preview(name = "SignalHealth · compact", showBackground = true)
@Composable
private fun SignalHealthCompactPreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = SignalHealthSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "SignalHealth · empty", showBackground = true)
@Composable
private fun SignalHealthEmptyPreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = SignalHealthData.EMPTY, fetchedAt = 1L),
            size = SignalHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SignalHealth · loading", showBackground = true)
@Composable
private fun SignalHealthLoadingPreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState.loading(),
            size = SignalHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SignalHealth · error", showBackground = true)
@Composable
private fun SignalHealthErrorPreview() {
    TeslaSyncTheme {
        SignalHealthWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = SignalHealthRegistration.DEFAULT_SIZE,
        )
    }
}
