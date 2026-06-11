// File hosts the ChargePlans Compose surface (stateful + stateless + per-state previews); named after
// the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName", "TooManyFunctions")

package io.teslasync.android.dashboardwidgets.chargeplans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The Charge Plans dashboard widget — the native Material-3 port of
 * `web/src/features/dashboard/widgets/ChargePlansWidget.tsx`. It reproduces every conditional branch
 * of the web source: a skeleton while the first load is in flight, a classified error retry surface,
 * the compact (single-column) Target-SoC tile, the standard active-plan layout (status badge + two
 * stat tiles + a label/value detail list), the Rate Plans section, and the "no charge plans" /
 * "no charge plans or rate data" empty states — each with a freshness chip that conveys
 * background-fetch / stale / offline / error honestly. The view is stateless; it collects the
 * shared-store-driven [ChargePlansWidgetViewModel] state and forwards refresh/retry (ADR-002).
 *
 * @param viewModel the state holder bound to the shared charging / vehicles / settings seam.
 * @param size the host-assigned grid footprint (web `WidgetProps.size`); `cols <= 1` is the tile.
 */
@Composable
fun ChargePlansWidget(
    viewModel: ChargePlansWidgetViewModel,
    modifier: Modifier = Modifier,
    size: ChargePlansSize = ChargePlansRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    ChargePlansWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * The stateless render of the widget for a resolved [state] + [prefs] + [size]. Separated from the
 * ViewModel binding so every branch is exercised by Compose UI tests with hand-built [UiState] inputs.
 */
@Composable
fun ChargePlansWidgetContent(
    state: UiState<ChargePlansSnapshot>,
    prefs: ChargePlansPrefs,
    size: ChargePlansSize,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxSize()) {
        when {
            state.isLoading -> ChargePlansLoading(compact = size.isCompact)
            state.isError -> ChargePlansError(state = state, onRetry = onRetry)
            else -> ChargePlansLoaded(state = state, prefs = prefs, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun ChargePlansLoaded(
    state: UiState<ChargePlansSnapshot>,
    prefs: ChargePlansPrefs,
    size: ChargePlansSize,
    onRefresh: () -> Unit,
) {
    val snapshot = state.data ?: ChargePlansSnapshot.EMPTY
    val strings = chargePlansStrings()
    val formatters = rememberChargePlansFormatters(prefs)
    val display = remember(snapshot, size, prefs, strings) { ChargePlansProjection.project(snapshot, size, strings, formatters) }
    if (size.isCompact) {
        ChargePlansCompact(display = display, state = state, strings = strings, onRefresh = onRefresh)
    } else {
        ChargePlansStandard(display = display, state = state, onRefresh = onRefresh)
    }
}

// ── Header ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ChargePlansHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (title != null) {
            Icon(
                imageVector = DataDisplayGlyphs.Clock,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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

// ── Standard (multi-column) layout ───────────────────────────────────────────────────────────

@Composable
private fun ChargePlansStandard(
    display: ChargePlansDisplay,
    state: UiState<ChargePlansSnapshot>,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ChargePlansHeader(
            title = stringResource(R.string.translation_widget_chargePlans_title),
            state = state,
            onRefresh = onRefresh,
        )
        if (!display.hasData) {
            EmptyState(
                message = stringResource(R.string.translation_widget_chargePlans_noData),
                icon = DataDisplayGlyphs.Clock,
            )
            return@Column
        }
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            val plan = display.activePlan
            if (plan != null) {
                ChargePlanDetails(plan = plan)
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_widget_chargePlans_noPlans),
                    icon = DataDisplayGlyphs.Clock,
                )
            }
            if (display.hasRates) {
                ChargePlansRateSection(entries = display.rateEntries)
            }
        }
    }
}

@Composable
private fun ChargePlanDetails(plan: ChargePlanView) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Badge(text = plan.statusText, variant = plan.statusVariant.toBadgeVariant(), dot = true)
            if (plan.ratePlanText.isNotEmpty()) {
                Caption(text = plan.ratePlanText, modifier = Modifier.weight(1f))
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            val statEntries = plan.statEntries
            StatCard(label = statEntries[0].label, value = statEntries[0].value, modifier = Modifier.weight(1f))
            StatCard(label = statEntries[1].label, value = statEntries[1].value, modifier = Modifier.weight(1f))
        }
        WidgetDetailList(
            entries = plan.detailEntries,
            emptyMessage = stringResource(R.string.translation_widget_chargePlans_noDetails),
        )
    }
}

@Composable
private fun ChargePlansRateSection(entries: List<DetailEntry>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        MetricLabel(text = stringResource(R.string.translation_widget_chargePlans_ratePlans))
        WidgetDetailList(
            entries = entries,
            emptyMessage = stringResource(R.string.translation_widget_chargePlans_noRates),
        )
    }
}

// ── Compact (single-column) tile ───────────────────────────────────────────────────────────

@Composable
private fun ChargePlansCompact(
    display: ChargePlansDisplay,
    state: UiState<ChargePlansSnapshot>,
    strings: ChargePlansStrings,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ChargePlansHeader(title = null, state = state, onRefresh = onRefresh)
        Box(
            modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = Spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            val plan = display.activePlan
            if (plan != null) {
                ChargePlansCompactTile(plan = plan, targetSocLabel = strings.targetSoc)
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_widget_chargePlans_noPlans),
                    icon = DataDisplayGlyphs.Clock,
                )
            }
        }
    }
}

@Composable
private fun ChargePlansCompactTile(
    plan: ChargePlanView,
    targetSocLabel: String,
) {
    val description = "$targetSocLabel: ${plan.targetSocText}"
    Column(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        MetricValue(text = plan.targetSocText)
        MetricLabel(text = targetSocLabel)
        if (plan.compactDeparture != null) {
            Caption(text = plan.compactDeparture)
        }
    }
}

// ── Detail list (native WidgetDetailCard) ──────────────────────────────────────────────────

@Composable
private fun WidgetDetailList(
    entries: List<DetailEntry>,
    emptyMessage: String,
) {
    if (entries.isEmpty()) {
        EmptyState(message = emptyMessage, icon = DataDisplayGlyphs.Clock)
        return
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        entries.forEachIndexed { index, entry ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DetailRow(entry = entry)
        }
    }
}

@Composable
private fun DetailRow(entry: DetailEntry) {
    val description = "${entry.label}: ${entry.value}"
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = DETAIL_ROW_MIN_HEIGHT)
                .padding(vertical = Spacing.sm)
                .semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MetricLabel(text = entry.label, modifier = Modifier.weight(1f))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            DetailValueText(text = entry.value, mono = entry.mono)
            entry.badge?.let { badge -> Badge(text = badge.text, variant = badge.variant.toBadgeVariant()) }
        }
    }
}

@Composable
private fun DetailValueText(
    text: String,
    mono: Boolean,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default),
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

// ── Loading + error surfaces ───────────────────────────────────────────────────────────────

@Composable
private fun ChargePlansLoading(compact: Boolean) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_WIDTH, height = SKELETON_TITLE_HEIGHT)
        if (compact) {
            Skeleton(height = SKELETON_STAT_HEIGHT, rounded = true)
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_STAT_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_STAT_HEIGHT, rounded = true)
            }
            SkeletonLines(lines = SKELETON_ROW_COUNT)
        }
    }
}

@Composable
private fun ChargePlansError(
    state: UiState<ChargePlansSnapshot>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = chargePlansQueryErrorKind(state),
            resourceName = stringResource(R.string.translation_widget_chargePlans_title),
            onRetry = onRetry,
        )
    }
}

/** Maps the [UiState] failure classification onto the feedback layer's [QueryErrorKind]. */
internal fun chargePlansQueryErrorKind(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── i18n + formatting helpers ──────────────────────────────────────────────────────────────

@Composable
private fun chargePlansStrings(): ChargePlansStrings =
    ChargePlansStrings(
        targetSoc = stringResource(R.string.translation_widget_chargePlans_targetSoc),
        departure = stringResource(R.string.translation_widget_chargePlans_departure),
        schedStart = stringResource(R.string.translation_widget_chargePlans_schedStart),
        schedEnd = stringResource(R.string.translation_widget_chargePlans_schedEnd),
        estEnergy = stringResource(R.string.translation_widget_chargePlans_estEnergy),
        estCost = stringResource(R.string.translation_widget_chargePlans_estCost),
        savings = stringResource(R.string.translation_widget_chargePlans_savings),
        saved = stringResource(R.string.translation_widget_chargePlans_saved),
        ratePlan = stringResource(R.string.translation_widget_chargePlans_ratePlan),
    )

@Composable
private fun rememberChargePlansFormatters(prefs: ChargePlansPrefs): ChargePlansFormatters =
    remember(prefs) {
        val locale = resolveChargePlansLocale(prefs.localeTag)
        ChargePlansFormatters(
            currency = { amount -> prefs.currencySymbol + ChartFormat.number(amount, prefs.precision, locale) },
            time = { raw -> formatChargeTime(raw, locale) },
            date = { raw -> formatChargeDate(raw, locale) },
            number1 = { value -> ChartFormat.number(value, NUMBER_DECIMALS, locale) },
            integer = { value -> ChartFormat.number(value, INTEGER_DECIMALS, locale) },
        )
    }

private fun resolveChargePlansLocale(tag: String): Locale = if (tag.isBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

private fun formatChargeTime(
    raw: String?,
    locale: Locale,
): String = parseChargeInstant(raw)?.let { TIME_FORMATTER.withLocale(locale).format(it) } ?: CHARGE_PLANS_EM_DASH

private fun formatChargeDate(
    raw: String?,
    locale: Locale,
): String = parseChargeInstant(raw)?.let { DATE_FORMATTER.withLocale(locale).format(it) } ?: CHARGE_PLANS_EM_DASH

private fun parseChargeInstant(raw: String?): Instant? {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return null
    return runCatching { Instant.parse(value) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC) }.getOrNull()
}

private fun DetailBadgeVariant.toBadgeVariant(): BadgeVariant =
    when (this) {
        DetailBadgeVariant.Success -> BadgeVariant.Success
        DetailBadgeVariant.Warning -> BadgeVariant.Warning
        DetailBadgeVariant.Error -> BadgeVariant.Danger
        DetailBadgeVariant.Neutral -> BadgeVariant.Neutral
    }

private val TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private val DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private const val NUMBER_DECIMALS = 1
private const val INTEGER_DECIMALS = 0
private const val SKELETON_TITLE_WIDTH = 0.5f
private const val SKELETON_ROW_COUNT = 4
private val DETAIL_ROW_MIN_HEIGHT = 40.dp
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_STAT_HEIGHT = 48.dp

// ── Previews — one per rendered state (content / compact / empty / loading / error) ──────────

private fun samplePlan(
    status: String,
    savings: Double?,
): ChargePlan =
    ChargePlan(
        id = 1,
        vehicleId = 1,
        targetSoc = 80.0,
        departBy = "2024-01-02T07:30:00Z",
        scheduledStart = "2024-01-02T00:00:00Z",
        scheduledEnd = "2024-01-02T06:00:00Z",
        ratePlan = "PG&E EV2-A",
        estimatedKwh = 42.5,
        estimatedCost = 6.4,
        chargeNowCost = 9.2,
        savings = savings,
        status = status,
        appliedAt = null,
        completedAt = null,
        createdAt = "2024-01-01T00:00:00Z",
    )

private fun sampleSnapshot(): ChargePlansSnapshot =
    ChargePlansSnapshot(
        plans = listOf(samplePlan("scheduled", 2.8)),
        ratePlans =
            listOf(
                RatePlanInfo(id = "EV2A", name = "EV2-A Time of Use", utility = "PG&E"),
                RatePlanInfo(id = "EVRATE", name = "EV Rate Plan", utility = "SCE"),
            ),
    )

private fun previewState(snapshot: ChargePlansSnapshot): UiState<ChargePlansSnapshot> =
    UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L)

@Preview(name = "ChargePlans · content", showBackground = true)
@Composable
private fun ChargePlansContentPreview() {
    TeslaSyncTheme {
        ChargePlansWidgetContent(
            state = previewState(sampleSnapshot()),
            prefs = ChargePlansPrefs.DEFAULT,
            size = ChargePlansRegistration.DEFAULT_SIZE,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "ChargePlans · compact", showBackground = true)
@Composable
private fun ChargePlansCompactPreview() {
    TeslaSyncTheme {
        ChargePlansWidgetContent(
            state = previewState(sampleSnapshot()),
            prefs = ChargePlansPrefs.DEFAULT,
            size = ChargePlansSize(cols = 1, rows = 2),
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "ChargePlans · empty", showBackground = true)
@Composable
private fun ChargePlansEmptyPreview() {
    TeslaSyncTheme {
        ChargePlansWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = ChargePlansSnapshot.EMPTY, fetchedAt = 1L),
            prefs = ChargePlansPrefs.DEFAULT,
            size = ChargePlansRegistration.DEFAULT_SIZE,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "ChargePlans · loading", showBackground = true)
@Composable
private fun ChargePlansLoadingPreview() {
    TeslaSyncTheme {
        ChargePlansWidgetContent(
            state = UiState.loading(),
            prefs = ChargePlansPrefs.DEFAULT,
            size = ChargePlansRegistration.DEFAULT_SIZE,
            onRefresh = {},
            onRetry = {},
        )
    }
}

@Preview(name = "ChargePlans · error", showBackground = true)
@Composable
private fun ChargePlansErrorPreview() {
    TeslaSyncTheme {
        ChargePlansWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = ChargePlansPrefs.DEFAULT,
            size = ChargePlansRegistration.DEFAULT_SIZE,
            onRefresh = {},
            onRetry = {},
        )
    }
}
