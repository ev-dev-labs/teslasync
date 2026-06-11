// The native Jetpack Compose + Material 3 Charge Status Live dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + lightning icon + freshness
// header) wrapping one of: the compact charging hero (BatteryCharging icon + animated kW + battery %),
// the compact idle hero (battery % + "Not Charging"), the full charging view (status badge + battery %,
// the big animated kW readout, the Voltage/Current/Time Left/Added metric grid, and — when tall — the
// Rate/Battery row), the full idle view ("Not Charging" + battery % + an optional "Last Session" box),
// or the "No charge data" empty surface when no vehicle state has resolved. All data flows through the
// shared [ChargeStatusLiveWidgetViewModel]; the view never performs HTTP. Every string resolves through
// the i18n catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargeStatusLiveWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargestatuslive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3

/**
 * Stateful entry point. Binds the combined live-charge feed via [source] into a
 * [ChargeStatusLiveWidgetViewModel], records the one-shot `view.opened` diagnostic, resolves the live
 * display-unit preference, and renders the surface for the given [size]. A dashboard host supplies
 * [source] (an adapter over the shared S8 Vehicles + Charging data layer) and a unique [instanceKey] per
 * placement.
 *
 * @param source the combined cache-then-network live-charge seam (a [StoreChargeStatusLiveSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargeStatusLiveWidget(
    source: ChargeStatusLiveSource,
    modifier: Modifier = Modifier,
    size: ChargeStatusLiveSize = ChargeStatusLiveRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ChargeStatusLiveRegistration.ID,
) {
    val viewModel: ChargeStatusLiveWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ChargeStatusLiveWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    ChargeStatusLiveWidgetContent(
        state = state,
        size = size,
        units = unitFormatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading -> skeleton, hard error -> retry) and otherwise the title +
 * freshness header over the compact hero / full charging / full idle body, or the empty surface when no
 * vehicle state resolved.
 */
@Composable
fun ChargeStatusLiveWidgetContent(
    state: UiState<ChargeStatusLiveSnapshot>,
    size: ChargeStatusLiveSize,
    units: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberChargeStatusLiveStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, size, units, strings) {
                    snapshot?.state?.let {
                        ChargeStatusLiveProjection.project(it, snapshot.latestSession, size, units, strings)
                    }
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<ChargeStatusLiveSnapshot>,
    size: ChargeStatusLiveSize,
    display: ChargeStatusLiveDisplay?,
    onRefresh: () -> Unit,
    strings: ChargeStatusLiveStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, onRefresh = onRefresh, strings = strings)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            when {
                display == null -> ChargeStatusLiveEmpty(strings)
                display.isCompact && display.isCharging -> CompactCharging(display)
                display.isCompact -> CompactIdle(display)
                display.isCharging -> FullCharging(display)
                else -> FullIdle(display)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<ChargeStatusLiveSnapshot>,
    size: ChargeStatusLiveSize,
    onRefresh: () -> Unit,
    strings: ChargeStatusLiveStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!size.isCompact) {
            Icon(
                DataDisplayGlyphs.Bolt,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
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
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Compact: charging --
@Composable
private fun CompactCharging(display: ChargeStatusLiveDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            DataDisplayGlyphs.BatteryCharging,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.success,
        )
        AnimatedNumber(
            value = display.powerValue,
            decimals = ChargeStatusLiveProjection.POWER_PRECISION,
            suffix = display.powerSuffix,
            locale = Locale.US,
        )
        Caption(display.batteryPercentText)
    }
}

// -- Compact: idle --
@Composable
private fun CompactIdle(display: ChargeStatusLiveDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            glyphVector(ChargeStatusLiveGlyph.Plug),
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        MetricValue(display.batteryPercentText)
        Caption(display.notChargingText)
    }
}

// -- Full: actively charging --
@Composable
private fun FullCharging(display: ChargeStatusLiveDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(
                    DataDisplayGlyphs.BatteryCharging,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.success,
                )
                Badge(display.chargingBadgeLabel, variant = BadgeVariant.Success)
            }
            Caption(display.batteryPercentText)
        }

        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clearAndSetSemantics { contentDescription = display.powerText },
            contentAlignment = Alignment.Center,
        ) {
            AnimatedNumber(
                value = display.powerValue,
                decimals = ChargeStatusLiveProjection.POWER_PRECISION,
                suffix = display.powerSuffix,
                locale = Locale.US,
            )
        }

        MetricRow(display.voltage, display.current)
        MetricRow(display.timeLeft, display.added)

        if (display.isTall) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            MetricRow(display.rate, display.battery)
        }
    }
}

// -- Full: not charging --
@Composable
private fun FullIdle(display: ChargeStatusLiveDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
    ) {
        Icon(
            glyphVector(ChargeStatusLiveGlyph.Plug),
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(display.notChargingText)
            Caption(display.batteryPercentText)
        }
        if (display.hasSession) {
            LastSessionBox(display)
        }
    }
}

@Composable
private fun LastSessionBox(display: ChargeStatusLiveDisplay) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(display.lastSessionLabel)
            BodyText(display.lastSessionValue)
        }
    }
}

@Composable
private fun MetricRow(
    left: ChargeStatusLiveCell,
    right: ChargeStatusLiveCell,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MetricCell(left, modifier = Modifier.weight(1f))
        MetricCell(right, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun MetricCell(
    cell: ChargeStatusLiveCell,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = cell.contentDescription },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            glyphVector(cell.glyph),
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column {
            MetricLabel(cell.label)
            Subhead(cell.value)
        }
    }
}

@Composable
private fun ChargeStatusLiveEmpty(strings: ChargeStatusLiveStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
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

private fun glyphVector(glyph: ChargeStatusLiveGlyph): ImageVector =
    when (glyph) {
        ChargeStatusLiveGlyph.Zap -> DataDisplayGlyphs.Bolt
        ChargeStatusLiveGlyph.BatteryCharging -> DataDisplayGlyphs.BatteryCharging
        // No dedicated power-plug glyph in the shared set; the plain battery best approximates the web
        // Lucide `Plug` on the idle / not-charging surface.
        ChargeStatusLiveGlyph.Plug -> DataDisplayGlyphs.Battery
        ChargeStatusLiveGlyph.Timer -> DataDisplayGlyphs.Clock
        ChargeStatusLiveGlyph.Gauge -> DataDisplayGlyphs.Gauge
    }

/**
 * Builds the localized [ChargeStatusLiveStrings] from the i18n catalog (P1/S10): the title + empty
 * message, the metric-cell labels, the charging/not-charging words, the "Last Session" label, the header
 * refresh/refreshing/offline microcopy, and the `translation_freshness_*`-backed relative-time formatter
 * shared with the freshness chip.
 */
@Composable
private fun rememberChargeStatusLiveStrings(): ChargeStatusLiveStrings {
    val title = stringResource(R.string.translation_widget_chargeStatusLive)
    val empty = stringResource(R.string.translation_widget_noChargeData)
    val charging = stringResource(R.string.translation_widget_charging)
    val notCharging = stringResource(R.string.translation_widget_notCharging)
    val voltage = stringResource(R.string.translation_widget_voltage)
    val current = stringResource(R.string.translation_widget_amps)
    val timeLeft = stringResource(R.string.translation_widget_timeRemaining)
    val added = stringResource(R.string.translation_widget_energyAdded)
    val rate = stringResource(R.string.translation_widget_chargeRate)
    val battery = stringResource(R.string.translation_widget_batteryLevel)
    val lastSession = stringResource(R.string.translation_widget_lastSession)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        empty,
        charging,
        notCharging,
        voltage,
        current,
        timeLeft,
        added,
        rate,
        battery,
        lastSession,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        ChargeStatusLiveStrings(
            title = title,
            emptyMessage = empty,
            charging = charging,
            notCharging = notCharging,
            voltage = voltage,
            current = current,
            timeLeft = timeLeft,
            added = added,
            rate = rate,
            battery = battery,
            lastSession = lastSession,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
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
