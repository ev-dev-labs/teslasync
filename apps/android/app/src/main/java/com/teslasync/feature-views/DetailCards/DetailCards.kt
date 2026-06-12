// The native Jetpack Compose + Material 3 DetailCards feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/DetailCards.tsx. The web component is purely
// presentational: the Drivetrain Health page owns the `useDrivetrainHealth` / `useDrives` / `useDrivingStats`
// queries plus the chart-derived peak/avg/regen power figures, and passes them down. From those props it
// renders, inside a `FadeIn`, a responsive `Grid` (one column on phones, two from the `md` breakpoint) of two
// `Card`s: a "Temperature Details" definition list (front motor, rear motor, inverter, battery temps) and a
// "Power Summary" definition list (Peak Power, Avg Peak Power, Max Regen, Total Regen, CO2 Saved).
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useUnits` (mapped to the
// live temperature/energy unit preference + locale read from the data container, P1/S8). The host supplies
// the decoded [DetailCardsData] through the shared state-holder layer as a [UiState], so this feature view
// also renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, the
// resolved cards, an empty body, and the stale/offline ("last known") freshness chip — without ever fetching.
// A web-parity overload that takes the five raw props is also provided, mirroring the web component's
// `{ health, peakPower, avgPowerMax, minRegenPower, stats }` signature.
//
// Every derivation flows through the pure [DetailCardsProjection]; the composable is a thin render layer that
// resolves the i18n labels (P1/S10), draws the rows through the shared `KVList` inside the shared `Card` /
// `CardHeader` (the web `Card` + `CardHeader` + `KVList`), and lays the two cards out in a `BoxWithConstraints`
// grid that reflows at the web Tailwind `md` (768dp) breakpoint. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DetailCards — the prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.detailcards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardHeader
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale

/** The em dash shown by the freshness chip when no fetch timestamp is known. */
private const val EM_DASH_CHIP = "\u2014"

/** Web `FadeIn delay={0.4}` — the entry animation is delayed by 0.4 seconds. */
private const val FADE_DELAY_MS = 400

/** Web Tailwind `md` breakpoint (768px): at or above this width the two cards lay out side by side. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web `Grid cols={{ md: 2 }}` — two columns from the `md` breakpoint. */
private const val GRID_COLUMNS_MD = 2

/** Web `Grid cols={{ default: 1 }}` — a single stacked column below the `md` breakpoint. */
private const val GRID_COLUMNS_BASE = 1

/** Skeleton row counts mirroring each resolved card's row count (4 temperature rows, 5 power rows). */
private const val TEMPERATURE_ROW_COUNT = 4
private const val POWER_ROW_COUNT = 5

/** Height of one loading-skeleton row, sized so the skeleton card does not jump on resolve. */
private val SKELETON_ROW_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point for DetailCards. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * reads the live unit preference + locale from the data container (web `useUnits`, P1/S8), and renders every
 * lifecycle [state] the host's feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the
 * feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [DetailCardsData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DetailCards(
    state: UiState<DetailCardsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DetailCardsDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val locale = remember(prefs.locale) { resolveDisplayLocale(prefs.locale) }
    DetailCardsContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        prefs = prefs,
        locale = locale,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ health, peakPower, avgPowerMax, minRegenPower, stats }`
 * props (plus an explicit [isLoading] for the host's first load). Projects the props onto a [UiState] via
 * [DetailCardsProjection.projectUiState] and delegates to the stateful entry, which records `view.opened` and
 * resolves the unit preferences. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun DetailCards(
    health: DrivetrainHealthInput,
    peakPowerKw: Double,
    avgPowerMaxKw: Double,
    minRegenPowerKw: Double,
    stats: DrivingStatsInput?,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(health, peakPowerKw, avgPowerMaxKw, minRegenPowerKw, stats, isLoading) {
            DetailCardsProjection.projectUiState(
                data =
                    DetailCardsData(
                        health = health,
                        peakPowerKw = peakPowerKw,
                        avgPowerMaxKw = avgPowerMaxKw,
                        minRegenPowerKw = minRegenPowerKw,
                        stats = stats,
                    ),
                isLoading = isLoading,
            )
        }
    DetailCards(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's `FadeIn` + two-card grid and adds the lifecycle chrome the host's feed implies: a loading
 * skeleton grid, a hard-error retry surface, a friendly empty body, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [prefs] + [locale] format every value, and [strings] supplies the localized labels.
 */
@Composable
fun DetailCardsContent(
    state: UiState<DetailCardsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    prefs: UnitPref = UnitPreferences.fromSettings(null),
    locale: Locale = Locale.getDefault(),
    strings: DetailCardsStrings = detailCardsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (state.stale || state.refreshing || state.hasError) {
                DetailCardsFreshnessRow(state = state)
            }
            val data = state.data
            when {
                state.isLoading -> DetailCardsLoadingGrid(strings = strings)
                state.isError -> DetailCardsError(onRetry = onRetry)
                data == null -> EmptyState(message = strings.noData, modifier = Modifier.fillMaxWidth())
                else -> DetailCardsGrid(data = data, prefs = prefs, locale = locale, strings = strings)
            }
        }
    }
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful entry,
 * the previews, and any host share one source of strings without re-listing resource ids.
 */
@Composable
fun detailCardsStrings(): DetailCardsStrings =
    DetailCardsStrings(
        temperatureTitle = stringResource(R.string.translation_drivetrain_temperatures),
        powerTitle = stringResource(R.string.translation_drivetrain_powerSummary),
        frontMotorTemp = stringResource(R.string.translation_drivetrain_frontMotorTemp),
        rearMotorTemp = stringResource(R.string.translation_drivetrain_rearMotorTemp),
        inverterTemp = stringResource(R.string.translation_drivetrain_inverterTemp),
        batteryTemp = stringResource(R.string.translation_drivetrain_batteryTemp),
        peakPower = stringResource(R.string.translation_drivetrain_peakPowerLabel),
        avgPeakPower = stringResource(R.string.translation_drivetrain_avgPowerLabel),
        maxRegen = stringResource(R.string.translation_drivetrain_maxRegenLabel),
        totalRegen = stringResource(R.string.translation_drivetrain_regenLabel),
        co2Saved = stringResource(R.string.translation_drivetrain_co2Label),
        noData = stringResource(R.string.translation_common_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/** The resolved branch — the Temperature Details and Power Summary cards in the responsive two-column grid. */
@Composable
private fun DetailCardsGrid(
    data: DetailCardsData,
    prefs: UnitPref,
    locale: Locale,
    strings: DetailCardsStrings,
) {
    val temperatureItems =
        remember(data, prefs, strings) {
            DetailCardsProjection.temperatureRows(data, prefs, strings).map { KVItem(it.label, it.value) }
        }
    val powerItems =
        remember(data, prefs, locale, strings) {
            DetailCardsProjection.powerRows(data, prefs, locale, strings).map { KVItem(it.label, it.value) }
        }
    val cards =
        listOf<@Composable (Modifier) -> Unit>(
            { cardModifier -> DetailCard(title = strings.temperatureTitle, items = temperatureItems, modifier = cardModifier) },
            { cardModifier -> DetailCard(title = strings.powerTitle, items = powerItems, modifier = cardModifier) },
        )
    DetailCardsResponsiveGrid(cards = cards)
}

/** A single card: the web `<Card><CardHeader title /><KVList items /></Card>`. */
@Composable
private fun DetailCard(
    title: String,
    items: List<KVItem>,
    modifier: Modifier,
) {
    Card(modifier = modifier) {
        CardHeader(title = title)
        KVList(items = items, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * The loading branch — two skeleton cards in the same responsive grid as the resolved cards. Each card keeps
 * its real header (static chrome) over skeleton rows, so the surface never collapses to a blank box; the grid
 * carries a single TalkBack "Loading" content description so the state is announced rather than read as rows.
 */
@Composable
private fun DetailCardsLoadingGrid(strings: DetailCardsStrings) {
    val cards =
        listOf<@Composable (Modifier) -> Unit>(
            { cardModifier -> DetailCardSkeleton(title = strings.temperatureTitle, rows = TEMPERATURE_ROW_COUNT, modifier = cardModifier) },
            { cardModifier -> DetailCardSkeleton(title = strings.powerTitle, rows = POWER_ROW_COUNT, modifier = cardModifier) },
        )
    DetailCardsResponsiveGrid(
        cards = cards,
        modifier = Modifier.semantics { contentDescription = strings.loadingLabel },
    )
}

/** A single loading card: the real header over [rows] skeleton lines. */
@Composable
private fun DetailCardSkeleton(
    title: String,
    rows: Int,
    modifier: Modifier,
) {
    Card(modifier = modifier) {
        CardHeader(title = title)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            repeat(rows) {
                Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun DetailCardsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The "refreshing / stale / offline" freshness chip, right-aligned above the cards. */
@Composable
private fun DetailCardsFreshnessRow(state: UiState<DetailCardsData>) {
    val formatAge = rememberDetailCardsFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * Lays the [cards] out as the web responsive grid: two per row at or above [GRID_MD_MIN_WIDTH] (`md:2`), and
 * one per row below it (`default:1`). Each card fills its column via [Modifier.weight]; a partial trailing row
 * is padded with a weighted spacer so the cards keep a uniform width. Cells are spaced by `Spacing.md`, the
 * native expression of the web `gap-4`.
 */
@Composable
private fun DetailCardsResponsiveGrid(
    cards: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card -> card(Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDetailCardsFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH_CHIP
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; each @Preview exercises a rendered branch) ──────────────────────────────────

/** A fully-populated input — every temperature present, positive power figures, and a stats slice. */
private fun previewFullData(): DetailCardsData =
    DetailCardsData(
        health =
            DrivetrainHealthInput(
                frontMotorTempC = 48.0,
                rearMotorTempC = 52.5,
                inverterTempC = 41.0,
                batteryTempC = 27.5,
            ),
        peakPowerKw = 212.0,
        avgPowerMaxKw = 94.6,
        minRegenPowerKw = -63.4,
        stats = DrivingStatsInput(regenEnergyWh = 18_400.0, co2SavedKg = 132.7),
    )

/** A sparse input — some temperatures absent, non-positive power figures, and no stats slice. */
private fun previewSparseData(): DetailCardsData =
    DetailCardsData(
        health =
            DrivetrainHealthInput(
                frontMotorTempC = 31.0,
                rearMotorTempC = null,
                inverterTempC = null,
                batteryTempC = 22.0,
            ),
        peakPowerKw = 0.0,
        avgPowerMaxKw = 0.0,
        minRegenPowerKw = 0.0,
        stats = null,
    )

@Preview(name = "Content — full", showBackground = true)
@Composable
private fun DetailCardsFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailCardsContent(
            state = DetailCardsProjection.projectUiState(previewFullData(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content — sparse (dashes)", showBackground = true)
@Composable
private fun DetailCardsSparsePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailCardsContent(
            state = DetailCardsProjection.projectUiState(previewSparseData(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DetailCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailCardsContent(
            state = UiState.loading(),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DetailCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DetailCardsContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
        )
    }
}
