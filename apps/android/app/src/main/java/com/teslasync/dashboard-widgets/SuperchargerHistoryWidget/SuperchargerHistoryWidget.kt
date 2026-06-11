// The native Jetpack Compose + Material 3 Supercharger History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header)
// wrapping one of the two bodies the web renders: the compact 30-day-spend hero (1×N — a big number + a
// "$" unit + the "30-day Supercharger" label) or — when wider — the standard layout (a newest-first,
// ranked-by-energy session list with per-session cost badges + energy bars, capped at ten, plus a 30-day
// totals row), with a friendly empty state when no sessions are recorded. All data flows through the
// shared [SuperchargerHistoryWidgetViewModel]; SI watt-hours are converted to the user's energy unit and
// cost figures are currency-formatted at this render boundary via the live [SuperchargerHistoryDisplayPrefs].
// The view never performs HTTP. Every string resolves through the i18n catalog and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SuperchargerHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.superchargerhistory

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale
import io.teslasync.shared.core.units.formatEnergy as formatSiEnergy

private val ROW_MIN_HEIGHT = 44.dp
private val HERO_MIN_HEIGHT = 44.dp
private val DIVIDER_HEIGHT = 1.dp
private val LOADING_NUMBER_HEIGHT = 32.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_NUMBER_FRACTION = 0.6f
private const val LOADING_ROW_COUNT = 4
private const val BAR_ALPHA = 0.15f

/** SI watt-hours render at one fraction digit, matching the web `formatEnergy(wh, { precision: 1 })`. */
private const val ENERGY_PRECISION = 1

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [SuperchargerHistoryWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 data layer) and a unique [instanceKey] per
 * placement.
 *
 * @param source the cache-then-network seam (Tesla charging-history + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SuperchargerHistoryWidget(
    source: SuperchargerHistorySource,
    modifier: Modifier = Modifier,
    size: SuperchargerHistorySize = SuperchargerHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SuperchargerHistoryRegistration.ID,
) {
    val widgetViewModel: SuperchargerHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SuperchargerHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(widgetViewModel) { widgetViewModel.recordViewOpened() }
    val state by widgetViewModel.state.collectAsStateWithLifecycle()
    val prefs by widgetViewModel.displayPrefs.collectAsStateWithLifecycle()

    SuperchargerHistoryWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = widgetViewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display energy conversion +
 * currency formatting; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun SuperchargerHistoryWidgetContent(
    state: UiState<JsonElement>,
    prefs: SuperchargerHistoryDisplayPrefs,
    size: SuperchargerHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberSuperchargerHistoryStrings()
    val title = strings.title

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                SuperchargerLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError ->
                SuperchargerError(title = title, kind = state.toQueryErrorKind(), onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        SuperchargerHistoryProjection.project(
                            data = parseSuperchargerHistory(state.data),
                            strings = strings,
                            formatEnergy = { wh -> formatSiEnergy(wh, prefs.unitPref, ENERGY_PRECISION) },
                            formatCurrency = { amount ->
                                SuperchargerHistoryProjection.formatCurrency(amount, prefs.currencySymbol, prefs.precision, locale)
                            },
                            locale = locale,
                        )
                    }
                if (size.isCompact) {
                    SuperchargerCompact(state = state, display = display, locale = locale)
                } else {
                    SuperchargerStandard(state = state, display = display, title = title, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun SuperchargerCompact(
    state: UiState<JsonElement>,
    display: SuperchargerHistoryDisplay,
    locale: Locale,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    if (display.hasEntries) {
        SuperchargerHero(display = display, locale = locale)
    } else {
        SuperchargerEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun SuperchargerHero(
    display: SuperchargerHistoryDisplay,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (reduceMotion) {
                MetricValue(ChartFormat.number(display.compactSpendValue, display.compactSpendDecimals, locale))
            } else {
                AnimatedNumber(value = display.compactSpendValue, decimals = display.compactSpendDecimals, locale = locale)
            }
            Caption(display.compactUnit, modifier = Modifier.padding(bottom = Spacing.xs))
        }
        MetricLabel(display.compactLabel)
    }
}

@Composable
private fun SuperchargerStandard(
    state: UiState<JsonElement>,
    display: SuperchargerHistoryDisplay,
    title: String,
    onRefresh: () -> Unit,
) {
    SuperchargerHeader(title = title, state = state, onRefresh = onRefresh)
    if (display.hasEntries) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            display.rankedRows.forEachIndexed { index, row -> SuperchargerRankedRow(rank = index + 1, row = row) }
        }
        SuperchargerTotals(display = display)
    } else {
        SuperchargerEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun SuperchargerHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.energy,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
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

@Composable
private fun SuperchargerRankedRow(
    rank: Int,
    row: RankedSessionRow,
) {
    val barColor = TeslaTokens.chart.energy.copy(alpha = BAR_ALPHA)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription }
                .drawBehind {
                    if (row.barFraction > 0f) {
                        drawRect(color = barColor, size = Size(size.width * row.barFraction, size.height))
                    }
                },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(rank.toString())
            BodyText(text = row.label, modifier = Modifier.weight(1f), maxLines = 1)
            if (row.costBadge != null) {
                Badge(text = row.costBadge, variant = BadgeVariant.Neutral)
            }
            BodyText(text = row.energyText)
        }
    }
}

@Composable
private fun SuperchargerTotals(display: SuperchargerHistoryDisplay) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DIVIDER_HEIGHT)
                .background(MaterialTheme.colorScheme.outlineVariant),
    )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = Spacing.sm, start = Spacing.xs, end = Spacing.xs)
                .clearAndSetSemantics { contentDescription = display.totalsContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(display.totalsLabel, modifier = Modifier.weight(1f))
        BodyText(text = display.totalsEnergyText)
        BodyText(text = display.totalsCostText)
    }
}

@Composable
private fun SuperchargerEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SuperchargerLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            repeat(LOADING_ROW_COUNT) {
                Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            }
        }
    }
}

@Composable
private fun SuperchargerError(
    title: String,
    kind: QueryErrorKind,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = kind,
        resourceName = title,
        onRetry = onRetry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [SuperchargerHistoryStrings] from the i18n catalog (P1/S10) — the five
 * `widget.superchargerHistory.*` keys the web component reads via `t('widget.superchargerHistory.…')`.
 * Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberSuperchargerHistoryStrings(): SuperchargerHistoryStrings {
    val title = stringResource(R.string.translation_widget_superchargerHistory_title)
    val currencyUnit = stringResource(R.string.translation_widget_superchargerHistory_currencyUnit)
    val compactLabel = stringResource(R.string.translation_widget_superchargerHistory_compactLabel)
    val noData = stringResource(R.string.translation_widget_superchargerHistory_noData)
    val totals = stringResource(R.string.translation_widget_superchargerHistory_totals)
    return remember(title, currencyUnit, compactLabel, noData, totals) {
        SuperchargerHistoryStrings(
            title = title,
            currencyUnit = currencyUnit,
            compactLabel = compactLabel,
            noData = noData,
            totals = totals,
        )
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy (web `QueryError`). */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }
