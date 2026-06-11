// The native Jetpack Compose + Material 3 Destination ETA dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DestinationETAWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a retry surface on hard failure, otherwise a freshness + refresh header —
// titled with a navigation icon for the standard footprint, bare for the compact footprint) wrapping
// one of: the compact ETA hero (a big animated arrival-minutes count + "min" + "ETA"), the compact
// location badge (an emoji + a toned badge for where the car is parked), the full navigating view (the
// destination name, the arrival countdown + remaining distance, and a route-completion progress bar),
// the full idle view (the location emoji + badge + "No active navigation"), or the "No location data"
// empty surface when no snapshot resolved. All data flows through the shared
// [DestinationETAWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves through
// the i18n catalog and every interactive element + the location emoji carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DestinationETAWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.destinationeta

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapsGlyphs
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
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3
private val PROGRESS_TRACK_HEIGHT = 8.dp
private val DESTINATION_ROW_MIN_HEIGHT = 44.dp

/**
 * Stateful entry point. Binds the cache-then-network latest-location feed via [source] into a
 * [DestinationETAWidgetViewModel], records the one-shot `view.opened` diagnostic, resolves the live
 * display-unit preference, and renders the surface for the given [size]. A dashboard host supplies
 * [source] (an adapter over the shared S8 Vehicles data layer) and a unique [instanceKey] per
 * placement.
 *
 * @param source the cache-then-network latest-location seam (a [VehiclesStoreDestinationETASource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DestinationETAWidget(
    source: DestinationETASource,
    modifier: Modifier = Modifier,
    size: DestinationETASize = DestinationETARegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DestinationETARegistration.ID,
) {
    val viewModel: DestinationETAWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { DestinationETAWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    DestinationETAWidgetContent(
        state = state,
        size = size,
        units = unitFormatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness +
 * refresh header over the compact ETA hero / compact location badge / full navigating / full idle body,
 * or the "No location data" empty surface when no snapshot resolved.
 */
@Composable
fun DestinationETAWidgetContent(
    state: UiState<LocationSnapshotData?>,
    size: DestinationETASize,
    units: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberDestinationETAStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, size, units, strings) {
                    DestinationETAProjection.project(snapshot, size, units, strings)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<LocationSnapshotData?>,
    size: DestinationETASize,
    display: DestinationETADisplay,
    onRefresh: () -> Unit,
    strings: DestinationETAStrings,
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
                !display.hasSnapshot -> DestinationETAEmpty(display)
                display.isCompact && display.isNavigating -> CompactEta(display)
                display.isCompact -> CompactLocationBadge(display)
                display.isNavigating -> FullNavigating(display)
                else -> FullIdle(display)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<LocationSnapshotData?>,
    size: DestinationETASize,
    onRefresh: () -> Unit,
    strings: DestinationETAStrings,
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
                MapsGlyphs.Navigation,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
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

// -- Empty: no location data --
@Composable
private fun DestinationETAEmpty(display: DestinationETADisplay) {
    EmptyState(
        message = display.noDataText,
        icon = MapsGlyphs.Navigation,
        modifier = Modifier.fillMaxWidth(),
    )
}

// -- Compact: actively navigating (the WidgetBigNumber ETA hero) --
@Composable
private fun CompactEta(display: DestinationETADisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .heightIn(min = DESTINATION_ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactEtaContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            AnimatedNumber(
                value = display.minutesToArrivalValue,
                decimals = 0,
                locale = Locale.US,
            )
            BodyText(display.minLabel, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        MetricLabel(display.etaLabel)
    }
}

// -- Compact: idle (bare location badge) --
@Composable
private fun CompactLocationBadge(display: DestinationETADisplay) {
    Column(
        modifier = Modifier.fillMaxSize().heightIn(min = DESTINATION_ROW_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        LocationEmoji(display, large = false)
        Badge(display.locationLabel, variant = badgeVariantFor(display.locationKind))
    }
}

// -- Full: actively navigating --
@Composable
private fun FullNavigating(display: DestinationETADisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
    ) {
        // Destination name row.
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = DESTINATION_ROW_MIN_HEIGHT),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                MapsGlyphs.Navigation,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.primary,
            )
            BodyText(display.destinationName, maxLines = 1, modifier = Modifier.weight(1f))
        }

        // ETA countdown + remaining distance row.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                AnimatedNumber(
                    value = display.minutesToArrivalValue,
                    decimals = 0,
                    locale = Locale.US,
                )
                MetricLabel(display.etaCountdownText)
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                MetricValue(display.distanceText)
                MetricLabel(display.distanceUnitLabel)
            }
        }

        // Route-completion progress bar.
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            ProgressBar(display.progressPercent)
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clearAndSetSemantics { contentDescription = display.remainingContentDescription },
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MetricLabel(display.remainingLabel)
                MetricLabel("${display.distanceText} ${display.distanceUnitLabel}")
            }
        }
    }
}

// -- Full: idle (not navigating) --
@Composable
private fun FullIdle(display: DestinationETADisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
    ) {
        LocationEmoji(display, large = true)
        Badge(display.locationLabel, variant = badgeVariantFor(display.locationKind))
        Caption(display.noNavText)
    }
}

@Composable
private fun LocationEmoji(
    display: DestinationETADisplay,
    large: Boolean,
) {
    Text(
        text = display.locationEmoji,
        style = if (large) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.headlineSmall,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { contentDescription = display.locationLabel },
    )
}

@Composable
private fun ProgressBar(percent: Double) {
    val fraction = (percent / 100.0).toFloat().coerceIn(0f, 1f)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(PROGRESS_TRACK_HEIGHT)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
        )
    }
}

/**
 * Map a [DestinationLocationKind] to its [Badge] tone — the native analogue of the web
 * `locationBadge` variant (Home → success, Other → warning, Work/Favorite → neutral).
 */
private fun badgeVariantFor(kind: DestinationLocationKind): BadgeVariant =
    when (kind) {
        DestinationLocationKind.Home -> BadgeVariant.Success
        DestinationLocationKind.Other -> BadgeVariant.Warning
        DestinationLocationKind.Work, DestinationLocationKind.Favorite -> BadgeVariant.Neutral
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

/**
 * Builds the localized [DestinationETAStrings] from the i18n catalog (P1/S10): the title + the
 * home/work/favorite/other location labels, the "No location data" / "No active navigation" messages,
 * the "min" / "ETA" / "Remaining" microcopy, the header refresh/refreshing/offline microcopy, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberDestinationETAStrings(): DestinationETAStrings {
    val title = stringResource(R.string.translation_widget_destinationETA_title)
    val home = stringResource(R.string.translation_widget_destinationETA_home)
    val work = stringResource(R.string.translation_widget_destinationETA_work)
    val favorite = stringResource(R.string.translation_widget_destinationETA_favorite)
    val other = stringResource(R.string.translation_widget_destinationETA_other)
    val noData = stringResource(R.string.translation_widget_destinationETA_noData)
    val min = stringResource(R.string.translation_widget_destinationETA_min)
    val eta = stringResource(R.string.translation_widget_destinationETA_eta)
    val noNav = stringResource(R.string.translation_widget_destinationETA_noNav)
    val remaining = stringResource(R.string.translation_widget_destinationETA_remaining)
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
        home,
        work,
        favorite,
        other,
        noData,
        min,
        eta,
        noNav,
        remaining,
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
        DestinationETAStrings(
            title = title,
            home = home,
            work = work,
            favorite = favorite,
            other = other,
            noData = noData,
            min = min,
            eta = eta,
            noNav = noNav,
            remaining = remaining,
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
