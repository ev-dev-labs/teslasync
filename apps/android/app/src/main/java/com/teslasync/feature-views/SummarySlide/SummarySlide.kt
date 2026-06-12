// The native Jetpack Compose + Material 3 SummarySlide feature view — a parity port of
// web/src/features/analytics/components/review/SummarySlide.tsx. It reproduces the web composition: a
// screenshot-friendly card with a header (the recap year + "Year in Review" on the left, the vehicle name +
// model on the right), five animated headline stats (Drives, distance, kWh, Charges, kg CO₂ saved — each a
// leading glyph + count-up number + label), an optional "💰 Saved $X vs. gas" block when savings are
// positive, a "TeslaSync • Year in Review" footer, and a "📸 Screenshot to share your year!" prompt beneath
// the card. All data flows through the shared [SummarySlideViewModel] (P1/S8); the view performs no HTTP.
// SI distance is converted at this render boundary via the live [SummarySlideDisplayPrefs] (web `useUnits`).
// Every string resolves through the i18n catalog (P1/S10) and the surface emits the P1/S11 `view.opened`
// event on appear. The card reproduces every state the cache-then-network contract carries — loading,
// content, empty, hard error + retry, and stale/offline (the cached card stays visible with a freshness
// chip + auto-refresh).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummarySlide) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.summaryslide

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.Year
import java.util.Locale

/** The card never grows past this width, keeping the 16:9 screenshot framing on tablets (web `max-w-md`). */
private val CARD_MAX_WIDTH = 420.dp

/** Minimum width reserved for the count-up value so the labels align in a column (web `min-w-[4rem]`). */
private val VALUE_MIN_WIDTH = 72.dp

/** Loading skeleton geometry. */
private val LOADING_TITLE_HEIGHT = 22.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.5f

/** Entry-stagger delays for the savings block + screenshot prompt (web `delay: 1` / `1.2`). */
private const val SAVINGS_FADE_DELAY_MS = 300
private const val SCREENSHOT_FADE_DELAY_MS = 400

/** The number of headline stat rows (drives, distance, energy, charges, CO₂), for the loading skeleton. */
private const val STAT_ROW_COUNT = 5

/** The money emoji the savings line leads with (web `💰 {savedSummary}`); not translatable. */
private const val SAVINGS_EMOJI = "\uD83D\uDCB0 "

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [SummarySlideViewModel], records the
 * one-shot `view.opened` diagnostic, and renders the surface. A host supplies [source] (an adapter over the
 * shared S7/S8 data layer), an optional [vehicleId] (web `vehicleId`), and the recap [year].
 *
 * @param source the cache-then-network seam (vehicles + analytics + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle (and the
 *   empty surface when there is none — web `enabled: !!vehicleId`).
 * @param year the recap year (web `new Date().getFullYear()`); defaults to the current calendar year.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey unique per placement so multiple slides keep distinct view-models.
 */
@Composable
fun SummarySlide(
    source: SummarySlideSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    year: Int = Year.now().value,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SummarySlideRegistration.SLUG,
) {
    val viewModel: SummarySlideViewModel =
        viewModel(
            key = instanceKey,
            factory = SummarySlideViewModel.factory(source, logger, year, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    SummarySlideContent(
        state = state,
        prefs = prefs,
        year = year,
        onRetry = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the loading
 * skeleton, the hard-error retry surface, the friendly empty surface, and otherwise the screenshot card,
 * with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun SummarySlideContent(
    state: UiState<JsonElement>,
    prefs: SummarySlideDisplayPrefs,
    year: Int,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val strings = rememberSummarySlideStrings(year)
    Box(
        modifier = modifier.fillMaxWidth().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        when {
            state.isLoading -> SummarySlideLoading()
            state.isError -> SummarySlideErrorState(state = state, onRetry = onRetry)
            else -> {
                val display =
                    remember(state.data, prefs, strings, year, locale) {
                        SummarySlideProjection.project(parseSummarySlide(state.data), prefs, strings, year, locale)
                    }
                if (display.hasData) {
                    SummarySlideCard(display = display, state = state, locale = locale)
                } else {
                    SummarySlideEmpty(display = display)
                }
            }
        }
    }
}

@Composable
private fun SummarySlideCard(
    display: SummarySlideDisplay,
    state: UiState<JsonElement>,
    locale: Locale,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        FadeIn {
            GlassPanel(
                modifier = Modifier.widthIn(max = CARD_MAX_WIDTH).fillMaxWidth(),
                padding = PanelPadding.Lg,
            ) {
                SummarySlideHeader(display = display, state = state)
                Spacer(modifier = Modifier.height(Spacing.md))
                SummarySlideStats(stats = display.stats, locale = locale)
                if (display.showSavings) {
                    Spacer(modifier = Modifier.height(Spacing.md))
                    FadeIn(delayMs = SAVINGS_FADE_DELAY_MS) {
                        SummarySlideSavings(amount = display.savingsAmountFormatted)
                    }
                }
                Spacer(modifier = Modifier.height(Spacing.md))
                Caption(display.brandFooter)
            }
        }
        FadeIn(delayMs = SCREENSHOT_FADE_DELAY_MS) {
            Caption(display.screenshotPrompt)
        }
    }
}

@Composable
private fun SummarySlideHeader(
    display: SummarySlideDisplay,
    state: UiState<JsonElement>,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
        ) {
            Heading(display.year, modifier = Modifier.semantics { heading() }, level = HeadingLevel.Page)
            Caption(display.title)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (state.stale || state.refreshing || state.hasError) {
                DataFreshness(
                    updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    compact = true,
                )
                Spacer(modifier = Modifier.height(Spacing.xs))
            }
            if (display.vehicleName.isNotBlank()) BodyText(display.vehicleName, maxLines = 1)
            if (display.vehicleModel.isNotBlank()) Caption(display.vehicleModel)
        }
    }
}

@Composable
private fun SummarySlideStats(
    stats: List<SummarySlideStat>,
    locale: Locale,
) {
    val reduce = rememberReducedMotion()
    StaggerContainer(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.forEachIndexed { index, stat ->
            StaggerItem(index = index) {
                SummarySlideStatRow(stat = stat, reduce = reduce, locale = locale)
            }
        }
    }
}

@Composable
private fun SummarySlideStatRow(
    stat: SummarySlideStat,
    reduce: Boolean,
    locale: Locale,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = stat.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(
            iconFor(stat.icon),
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (reduce) {
            MetricValue(stat.formattedValue, modifier = Modifier.widthIn(min = VALUE_MIN_WIDTH))
        } else {
            AnimatedNumber(
                value = stat.rawValue,
                modifier = Modifier.widthIn(min = VALUE_MIN_WIDTH),
                decimals = stat.decimals,
                locale = locale,
            )
        }
        Caption(stat.label)
    }
}

@Composable
private fun SummarySlideSavings(amount: String) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            BodyText(
                text = SAVINGS_EMOJI + stringResource(R.string.translation_yearReview_savedSummary, amount),
                color = TeslaTokens.status.success,
            )
        }
    }
}

@Composable
private fun SummarySlideEmpty(display: SummarySlideDisplay) {
    GlassPanel(
        modifier = Modifier.widthIn(max = CARD_MAX_WIDTH).fillMaxWidth(),
        padding = PanelPadding.Lg,
    ) {
        EmptyState(
            message = display.emptyHint,
            icon = FormsGlyphs.Calendar,
            title = display.emptyMessage,
        )
    }
}

@Composable
private fun SummarySlideLoading() {
    val label = stringResource(R.string.translation_yearReview_loading)
    GlassPanel(
        modifier = Modifier.widthIn(max = CARD_MAX_WIDTH).fillMaxWidth(),
        padding = PanelPadding.Lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            repeat(STAT_ROW_COUNT) {
                Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            }
            Spacer(modifier = Modifier.height(Spacing.xs))
            Caption(label)
        }
    }
}

@Composable
private fun SummarySlideErrorState(
    state: UiState<JsonElement>,
    onRetry: () -> Unit,
) {
    GlassPanel(
        modifier = Modifier.widthIn(max = CARD_MAX_WIDTH).fillMaxWidth(),
        padding = PanelPadding.Lg,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_yearReview_title),
            onRetry = onRetry,
        )
    }
}

/**
 * Builds the localized [SummarySlideStrings] from the i18n catalog (P1/S10) — the seven `yearReview.*` keys
 * the web component reads, plus the page's loading / no-data copy for the cache-then-network surfaces. The
 * `noData` message is year-substituted here (web `t('yearReview.noData', { year })`). Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberSummarySlideStrings(year: Int): SummarySlideStrings {
    val title = stringResource(R.string.translation_yearReview_title)
    val drives = stringResource(R.string.translation_yearReview_totalDrives)
    val energyKwh = stringResource(R.string.translation_yearReview_energyKwh)
    val charges = stringResource(R.string.translation_yearReview_charges)
    val co2KgSaved = stringResource(R.string.translation_yearReview_co2KgSaved)
    val screenshot = stringResource(R.string.translation_yearReview_screenshot)
    val noData = stringResource(R.string.translation_yearReview_noData, year.toString())
    val noDataHint = stringResource(R.string.translation_yearReview_noDataHint)
    return remember(title, drives, energyKwh, charges, co2KgSaved, screenshot, noData, noDataHint) {
        SummarySlideStrings(
            title = title,
            drives = drives,
            energyKwh = energyKwh,
            charges = charges,
            co2KgSaved = co2KgSaved,
            screenshot = screenshot,
            noData = noData,
            noDataHint = noDataHint,
        )
    }
}

/** Maps a pure [SummarySlideStatIcon] case onto a glyph (web lucide `Car` / `Zap` / `Plug` / `Leaf`). */
private fun iconFor(icon: SummarySlideStatIcon): ImageVector =
    when (icon) {
        SummarySlideStatIcon.Drives -> NavGlyphs.Car
        SummarySlideStatIcon.Distance -> NavGlyphs.Car
        SummarySlideStatIcon.Energy -> DataDisplayGlyphs.Bolt
        SummarySlideStatIcon.Charges -> SummarySlideGlyphs.Plug
        SummarySlideStatIcon.Co2 -> SummarySlideGlyphs.Leaf
    }

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket — the same mapping every TeslaSync surface uses.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content / savings / empty / loading / error / offline) ────────────

private fun previewJson(
    distanceKm: Double = 12_500.0,
    savings: Double = 1840.0,
): JsonElement =
    buildJsonObject {
        put("year", 2024)
        putJsonObject("vehicle") {
            put("display_name", "Bluebird")
            put("model", "Model 3")
        }
        put("total_drives", 412.0)
        put("total_distance_km", distanceKm)
        put("total_energy_kwh", 2980.0)
        put("total_charge_sessions", 96.0)
        put("co2_offset_kg", 1320.0)
        put("gas_savings", savings)
    }

private val PREVIEW_PREFS = SummarySlideDisplayPrefs(DistanceUnitPref.KM)

@Preview(name = "SummarySlide · content", showBackground = true)
@Composable
private fun SummarySlideContentPreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state = UiState(phase = UiPhase.Content, data = previewJson(savings = 0.0), fetchedAt = System.currentTimeMillis()),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "SummarySlide · content + savings", showBackground = true)
@Composable
private fun SummarySlideSavingsPreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state = UiState(phase = UiPhase.Content, data = previewJson(), fetchedAt = System.currentTimeMillis()),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "SummarySlide · empty", showBackground = true)
@Composable
private fun SummarySlideEmptyPreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "SummarySlide · loading", showBackground = true)
@Composable
private fun SummarySlideLoadingPreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state = UiState.loading(),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "SummarySlide · error", showBackground = true)
@Composable
private fun SummarySlideErrorPreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "SummarySlide · offline (cached)", showBackground = true)
@Composable
private fun SummarySlideOfflinePreview() {
    TeslaSyncTheme {
        SummarySlideContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewJson(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            prefs = PREVIEW_PREFS,
            year = 2024,
            onRetry = {},
            locale = Locale.US,
        )
    }
}
