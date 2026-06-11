// The native Jetpack Compose + Material 3 Charging Schedule dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a header + freshness chip) wrapping
// either the compact charge-limit hero (1×1) or — when larger — the schedule-mode badge row above a
// start/departure/target timeline (or a "no scheduled times" note) plus, when tall, a current-level /
// charging-status detail row, or a friendly empty state. All data flows through the shared
// [ChargingScheduleWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingScheduleWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingschedule

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val EM_DASH_TIME = "\u2014"
private const val LOADING_BAR_COUNT = 3
private val SCHEDULE_TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

/**
 * Stateful entry point. Binds the shared schedule feed via [source] into a
 * [ChargingScheduleWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 Vehicles
 * + Signals data layer, carrying the host's selected `vehicleId`) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network schedule seam (a `chargingScheduleSource(...)` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingScheduleWidget(
    source: ChargingScheduleSource,
    modifier: Modifier = Modifier,
    size: ChargingScheduleSize = ChargingScheduleRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ChargingScheduleRegistration.ID,
) {
    val viewModel: ChargingScheduleWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ChargingScheduleWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    ChargingScheduleWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact hero /
 * full schedule body, gated by the projected `hasScheduleData` (the web empty branch).
 */
@Composable
fun ChargingScheduleWidgetContent(
    state: UiState<ChargingScheduleData>,
    size: ChargingScheduleSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberChargingScheduleStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display =
                remember(state.data, size, strings) {
                    state.data?.let { ChargingScheduleProjection.project(it, size, strings) }
                }
            if (size.isCompact) {
                CompactShell(state, display, onRefresh, strings, modifier)
            } else {
                FullShell(state, display, onRefresh, strings, modifier)
            }
        }
    }
}

@Composable
private fun FullShell(
    state: UiState<ChargingScheduleData>,
    display: ChargingScheduleDisplay?,
    onRefresh: () -> Unit,
    strings: ChargingScheduleStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (display == null || !display.hasScheduleData) {
                ScheduleEmpty()
            } else {
                ScheduleBody(display)
            }
        }
    }
}

@Composable
private fun CompactShell(
    state: UiState<ChargingScheduleData>,
    display: ChargingScheduleDisplay?,
    onRefresh: () -> Unit,
    strings: ChargingScheduleStrings,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.sm)) {
        Row(
            modifier = Modifier.align(Alignment.TopEnd),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            WidgetFreshness(state, strings)
            RefreshButton(onRefresh, state.refreshing, strings)
        }
        if (display == null || !display.hasScheduleData) {
            ScheduleEmpty(modifier = Modifier.align(Alignment.Center))
        } else {
            CompactHero(display, modifier = Modifier.align(Alignment.Center))
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<ChargingScheduleData>,
    onRefresh: () -> Unit,
    strings: ChargingScheduleStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            FormsGlyphs.Calendar,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        WidgetFreshness(state, strings)
        RefreshButton(onRefresh, state.refreshing, strings)
    }
}

@Composable
private fun WidgetFreshness(
    state: UiState<ChargingScheduleData>,
    strings: ChargingScheduleStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.refreshingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = strings.formatRelative,
    )
}

@Composable
private fun RefreshButton(
    onRefresh: () -> Unit,
    refreshing: Boolean,
    strings: ChargingScheduleStrings,
) {
    IconButton(
        imageVector = FeedbackGlyphs.Refresh,
        contentDescription = strings.refreshLabel,
        onClick = onRefresh,
        enabled = !refreshing,
        size = IconSize.Sm,
    )
}

@Composable
private fun ScheduleBody(display: ChargingScheduleDisplay) {
    ModeRow(display)
    if (display.hasTimelineRows) {
        ScheduleTimeline(display.timelineRows)
    } else {
        Caption(display.noTimesLabel)
    }
    if (display.showStateRow) {
        StateDetailRow(display)
    }
}

@Composable
private fun ModeRow(display: ChargingScheduleDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Badge(
            text = display.modeLabel,
            variant = modeBadgeVariant(display.modeTone),
            dot = true,
            modifier = Modifier.semantics { contentDescription = display.modeLabel },
        )
        if (display.pending) {
            Badge(text = display.pendingLabel, variant = BadgeVariant.Warning)
        }
    }
}

@Composable
private fun ScheduleTimeline(rows: List<ScheduleTimelineRow>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = row.title,
                        time = row.time,
                        subtitle = row.subtitle,
                        icon = glyphVector(row.glyph),
                        accent = toneColor(row.tone),
                    ),
                isLast = index == rows.lastIndex,
                modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
            )
        }
    }
}

@Composable
private fun StateDetailRow(display: ChargingScheduleDisplay) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StateMetric(display.currentLevelLabel, display.currentLevelValue, Modifier.weight(1f))
        StateMetric(display.statusLabel, display.statusValue, Modifier.weight(1f))
    }
}

@Composable
private fun StateMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.clearAndSetSemantics { contentDescription = "$label, $value" }) {
        Caption(label)
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun CompactHero(
    display: ChargingScheduleDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(display.compactValueText)
        MetricLabel(display.compactLimitLabel)
    }
}

@Composable
private fun ScheduleEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_widget_chargingSchedule_noData),
        icon = FormsGlyphs.Calendar,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

private fun modeBadgeVariant(tone: ChargeScheduleModeTone): BadgeVariant =
    when (tone) {
        ChargeScheduleModeTone.Success -> BadgeVariant.Success
        ChargeScheduleModeTone.Warning -> BadgeVariant.Warning
        ChargeScheduleModeTone.Neutral -> BadgeVariant.Neutral
    }

private fun glyphVector(glyph: ScheduleGlyph): ImageVector =
    when (glyph) {
        ScheduleGlyph.Zap -> DataDisplayGlyphs.Bolt
        ScheduleGlyph.Clock -> DataDisplayGlyphs.Clock
        ScheduleGlyph.BatteryFull -> DataDisplayGlyphs.Battery
    }

@Composable
private fun toneColor(tone: ScheduleTone): Color =
    when (tone) {
        ScheduleTone.Success -> TeslaTokens.status.success
        ScheduleTone.Info -> TeslaTokens.status.info
        ScheduleTone.Warning -> TeslaTokens.status.warning
    }

/**
 * Builds the localized [ChargingScheduleStrings] from the i18n catalog (P1/S10): the labels the surface
 * renders, plus the `translation_freshness_*`-backed relative-time formatter shared with the freshness
 * chip and a locale/timezone-aware schedule-time formatter (the web `useDateFormat().formatTime`, a
 * 2-digit hour:minute that returns an em-dash for an absent/unparseable value).
 */
@Composable
private fun rememberChargingScheduleStrings(): ChargingScheduleStrings {
    val title = stringResource(R.string.translation_widget_chargingSchedule_title)
    val modeStartAt = stringResource(R.string.translation_widget_chargingSchedule_modeStartAt)
    val modeDepartBy = stringResource(R.string.translation_widget_chargingSchedule_modeDepartBy)
    val modeOff = stringResource(R.string.translation_widget_chargingSchedule_modeOff)
    val modeUnknown = stringResource(R.string.translation_widget_chargingSchedule_modeUnknown)
    val startCharging = stringResource(R.string.translation_widget_chargingSchedule_startCharging)
    val pending = stringResource(R.string.translation_widget_chargingSchedule_pending)
    val departure = stringResource(R.string.translation_widget_chargingSchedule_departure)
    val targetLimit = stringResource(R.string.translation_widget_chargingSchedule_targetLimit)
    val limit = stringResource(R.string.translation_widget_chargingSchedule_limit)
    val noData = stringResource(R.string.translation_widget_chargingSchedule_noData)
    val noTimes = stringResource(R.string.translation_widget_chargingSchedule_noTimes)
    val currentLevel = stringResource(R.string.translation_widget_chargingSchedule_currentLevel)
    val status = stringResource(R.string.translation_widget_chargingSchedule_status)
    val charging = stringResource(R.string.translation_widget_charging)
    val notCharging = stringResource(R.string.translation_widget_notCharging)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

    return remember(
        title,
        startCharging,
        departure,
        targetLimit,
        limit,
        locale,
    ) {
        ChargingScheduleStrings(
            title = title,
            modeStartAt = modeStartAt,
            modeDepartBy = modeDepartBy,
            modeOff = modeOff,
            modeUnknown = modeUnknown,
            startCharging = startCharging,
            pending = pending,
            departure = departure,
            targetLimit = targetLimit,
            limit = limit,
            noData = noData,
            noTimes = noTimes,
            currentLevel = currentLevel,
            status = status,
            charging = charging,
            notCharging = notCharging,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatTime = { raw -> formatScheduleTime(raw, locale) },
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH_TIME
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

/**
 * Formats a schedule timestamp as a localized 2-digit hour:minute — the port of the web `formatTime`
 * (`new Date(iso)` → `toLocaleTimeString({hour:'2-digit', minute:'2-digit'})`). A blank or unparseable
 * value renders the em-dash, exactly as the web returns '—' for an invalid `Date`.
 */
private fun formatScheduleTime(
    raw: String?,
    locale: Locale,
): String {
    val instant = raw?.takeIf { it.isNotBlank() }?.let(::parseScheduleInstant) ?: return EM_DASH_TIME
    return SCHEDULE_TIME_FORMAT.withLocale(locale).format(instant.atZone(ZoneId.systemDefault()))
}

/** Tolerant parse of a schedule timestamp (offset, instant, or zone-less datetime), else `null`. */
private fun parseScheduleInstant(raw: String): Instant? =
    runCatching { OffsetDateTime.parse(raw).toInstant() }
        .recoverCatching { Instant.parse(raw) }
        .recoverCatching { LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant() }
        .getOrNull()
