// The native Jetpack Compose + Material 3 BatteryRangePanel feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx. The web component is a
// presentational vehicle-detail panel inside a `GlassPanel`: a circular battery `RadialGauge` (value =
// `state.battery_level`, label "Battery", unit "%", color by `batteryColor(level)`) beside a responsive
// 2 / 3-column grid of three `MetricCard`s — Rated Range (`formatDistance(rated_range, 0)`, Navigation icon,
// cyan), Ideal Range (`formatDistance(ideal_range, 0)`, MapPin icon, green), and Charging
// (`is_charging ? "${formatDistance(charge_rate)}/h" : "Not Charging"`, BatteryCharging icon, green-when-
// charging-else-cyan, with a "Full in {fmtNumber(time_to_full_charge, 1)}h" subtitle while charging).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own for the
// panel's primary value (its web hooks are `useTranslation` and `useUnits`). The owning vehicle-detail host
// owns the `useVehicleState` feed and supplies it through the shared P1/S8 state-holder layer as a [UiState],
// so this feature view renders every lifecycle state that layer can carry — loading skeleton, hard error with
// retry, empty, content, and stale/offline ("last known") — without ever fetching. A web-parity overload that
// takes the raw `state` prop is also provided for hosts that already hold the value. The live unit preference
// (web `useUnits`) is bound from the shared `DataContainer.unitFormatter`; every value derivation + formatter
// flows through the pure [BatteryRangeProjection], so the composable is a thin render layer.
//
// Colors map the web hex palette onto design tokens (P1/S9): the gauge tone (web `batteryColor`) emerald /
// amber / red → `TeslaTokens.status.success` / `.warning` / `.danger`; the Rated Range "cyan" and Charging
// idle accent → `.info`; the Ideal Range "green" and Charging active accent → `.success`. The gauge color is a
// dynamic computed value, the sanctioned exception to the static-token rule. Every string resolves through the
// i18n catalog (P1/S10) and the one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryRangePanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryrangepanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `size={140}` battery gauge diameter. */
private val GAUGE_SIZE: Dp = 140.dp

/** Web `sm:` (640px) breakpoint — at/above it the gauge + cards lay out side-by-side (`sm:flex-row`). */
private val SM_BREAKPOINT: Dp = 640.dp

/** Web `sm:grid-cols-3` — three cards per row on a wide panel. */
private const val GRID_COLUMNS_WIDE: Int = 3

/** Web `grid-cols-2` — two cards per row on a narrow panel. */
private const val GRID_COLUMNS_NARROW: Int = 2

/** The fixed three metric cards (Rated Range, Ideal Range, Charging). */
private const val CARD_COUNT: Int = 3

/** Battery percent renders without fraction digits in the gauge center. */
private const val GAUGE_DECIMALS: Int = 0

/** Loading tile skeleton proportions (label bar over a larger value bar), mirroring the sibling ports. */
private const val SKELETON_LABEL_FRACTION: Float = 0.6f
private const val SKELETON_VALUE_FRACTION: Float = 0.4f
private val SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val SKELETON_VALUE_HEIGHT: Dp = 24.dp

/** Em dash for an unknown freshness age (the same render-only fallback the sibling surfaces use). */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the battery + range panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), binds the live unit preference (web `useUnits`) from the shared [unitFormatter] feed, and renders
 * every lifecycle [state] the shared vehicle-state feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the vehicle's last-known state (web `state` prop).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param unitFormatter the live SI→display unit formatter feed (web `useUnits`); defaults to the app holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryRangePanel(
    state: UiState<VehicleState>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    unitFormatter: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BatteryRangePanelDiagnostics.recordViewOpened(logger) }
    val formatter by unitFormatter.collectAsStateWithLifecycle()
    BatteryRangePanelContent(state = state, onRetry = onRetry, modifier = modifier, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web component's `state: VehicleState` prop, for hosts that already hold the
 * value. A `null` state renders the empty state; a present state renders the panel. Records `view.opened` like
 * the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun BatteryRangePanel(
    state: VehicleState?,
    modifier: Modifier = Modifier,
    unitFormatter: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val uiState =
        remember(state) {
            if (state == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = state)
        }
    BatteryRangePanel(state = uiState, onRetry = {}, modifier = modifier, unitFormatter = unitFormatter, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web panel
 * (battery gauge + the three metric cards) and adds the lifecycle chrome the host's feed implies: a loading
 * skeleton, a hard-error retry surface (web `QueryError` equivalent), a friendly empty state, and a freshness
 * chip that reflects refreshing / stale / offline over cached data. Stale (non-error) data auto-refreshes,
 * mirroring the freshness contract. [formatter] applies the user's units (web `useUnits`); [locale] formats the
 * hours-to-full figure.
 */
@Composable
fun BatteryRangePanelContent(
    state: UiState<VehicleState>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
    strings: BatteryRangeStrings = rememberBatteryRangeStrings(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        when {
            state.isLoading -> BatteryRangeLoading()
            state.isError -> BatteryRangeError(onRetry = onRetry)
            else -> {
                val display =
                    remember(state.data, formatter, strings, locale) {
                        state.data?.let { BatteryRangeProjection.project(BatteryRangeData.from(it), formatter, strings, locale) }
                    }
                BatteryRangeLoaded(state = state, display = display)
            }
        }
    }
}

/**
 * The non-loading/non-error body: the honest freshness chip (only when cached data is refreshing / stale /
 * offline — so a fresh panel is pixel-faithful to the web, which has no chrome), then either the friendly empty
 * state or the gauge + three metric cards. Laid out as a spaced column so the panel reads as one surface and is
 * never a blank box.
 */
@Composable
private fun ColumnScope.BatteryRangeLoaded(
    state: UiState<VehicleState>,
    display: BatteryRangeDisplay?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (shouldShowFreshness(state)) {
            BatteryRangeFreshnessRow(state = state)
        }
        if (display == null) {
            BatteryRangeEmpty()
        } else {
            BatteryRangeBody(display = display)
        }
    }
}

/** True when cached data is refreshing / stale / offline and the panel content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/**
 * The web `flex flex-col items-center gap-6 sm:flex-row sm:items-start` layout: the battery gauge beside (wide)
 * or above (narrow) the three metric cards. The cards take the remaining width on a wide panel (web `flex-1`).
 */
@Composable
private fun BatteryRangeBody(display: BatteryRangeDisplay) {
    BatteryResponsiveLayout(
        gauge = { BatteryGauge(display = display) },
        cards = { columns, cardsModifier -> BatteryMetricCards(display = display, columns = columns, modifier = cardsModifier) },
    )
}

/**
 * Shared responsive scaffold for the body and the loading skeleton: side-by-side at/above [SM_BREAKPOINT]
 * (`sm:flex-row sm:items-start`, the cards weighted to fill the rest), stacked and centered below it
 * (`flex-col items-center`). The web `gap-6` (24dp) gutter separates the gauge from the cards.
 */
@Composable
private fun BatteryResponsiveLayout(
    modifier: Modifier = Modifier,
    gauge: @Composable () -> Unit,
    cards: @Composable (columns: Int, cardsModifier: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= SM_BREAKPOINT) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xl2),
                verticalAlignment = Alignment.Top,
            ) {
                gauge()
                cards(GRID_COLUMNS_WIDE, Modifier.weight(1f))
            }
        } else {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
            ) {
                gauge()
                cards(GRID_COLUMNS_NARROW, Modifier.fillMaxWidth())
            }
        }
    }
}

/** The battery `RadialGauge` — web `value={state.battery_level} max={100} unit="%"` colored by the tone. */
@Composable
private fun BatteryGauge(display: BatteryRangeDisplay) {
    RadialGauge(
        value = display.batteryLevel,
        max = BATTERY_MAX_PERCENT,
        label = display.batteryLabel,
        unit = display.batteryUnit,
        color = toneColor(display.tone),
        size = GAUGE_SIZE,
        decimals = GAUGE_DECIMALS,
    )
}

/** Maps the gauge [BatteryTone] onto its design-token color (web `batteryColor` emerald / amber / red). */
@Composable
private fun toneColor(tone: BatteryTone): Color =
    when (tone) {
        BatteryTone.Good -> TeslaTokens.status.success
        BatteryTone.Warn -> TeslaTokens.status.warning
        BatteryTone.Critical -> TeslaTokens.status.danger
    }

/** The three metric cards in the web responsive grid (Rated Range, Ideal Range, Charging). */
@Composable
private fun BatteryMetricCards(
    display: BatteryRangeDisplay,
    columns: Int,
    modifier: Modifier = Modifier,
) {
    BatteryCardGrid(columns = columns, itemCount = CARD_COUNT, modifier = modifier) { index, cellModifier ->
        when (index) {
            0 ->
                MetricCard(
                    label = display.ratedRangeLabel,
                    value = display.ratedRangeValue,
                    modifier = cellModifier,
                    icon = BatteryRangePanelGlyphs.Navigation,
                    accent = TeslaTokens.status.info,
                )
            1 ->
                MetricCard(
                    label = display.idealRangeLabel,
                    value = display.idealRangeValue,
                    modifier = cellModifier,
                    icon = DataDisplayGlyphs.MapPin,
                    accent = TeslaTokens.status.success,
                )
            else ->
                MetricCard(
                    label = display.chargingLabel,
                    value = display.chargingValue,
                    modifier = cellModifier,
                    icon = DataDisplayGlyphs.BatteryCharging,
                    accent = if (display.chargingActive) TeslaTokens.status.success else TeslaTokens.status.info,
                    subtitle = display.chargingSubtitle,
                )
        }
    }
}

/**
 * Lays [itemCount] cells in rows of [columns], each cell filling its column via [Modifier.weight] with the web
 * `gap-4` (16dp) gutter; a short trailing row is padded with weighted spacers so the cards keep a uniform width.
 */
@Composable
private fun BatteryCardGrid(
    columns: Int,
    itemCount: Int,
    modifier: Modifier = Modifier,
    item: @Composable (index: Int, cellModifier: Modifier) -> Unit,
) {
    val rows = (0 until itemCount).chunked(columns)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        rows.forEach { rowIndices ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                rowIndices.forEach { index -> item(index, Modifier.weight(1f)) }
                repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * First-load skeleton — a gauge-circle stand-in beside three card-shaped tiles in the same responsive
 * layout as the resolved panel, so the surface reads as itself (not a generic spinner) and is never blank while
 * the first fetch runs. Carries a single TalkBack "Loading" description.
 */
@Composable
private fun BatteryRangeLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    BatteryResponsiveLayout(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        gauge = { BatteryGaugeSkeleton() },
        cards = { columns, cardsModifier -> BatteryCardSkeletons(columns = columns, modifier = cardsModifier) },
    )
}

/** A circular shimmering stand-in matching the gauge footprint. */
@Composable
private fun BatteryGaugeSkeleton() {
    Box(modifier = Modifier.size(GAUGE_SIZE)) {
        Skeleton(height = GAUGE_SIZE, rounded = true)
    }
}

/** The three metric-card loading tiles (a label bar over a larger value bar), in the responsive grid. */
@Composable
private fun BatteryCardSkeletons(
    columns: Int,
    modifier: Modifier = Modifier,
) {
    BatteryCardGrid(columns = columns, itemCount = CARD_COUNT, modifier = modifier) { _, cellModifier ->
        Card(modifier = cellModifier) {
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
            Skeleton(
                modifier = Modifier.padding(top = Spacing.sm),
                widthFraction = SKELETON_VALUE_FRACTION,
                height = SKELETON_VALUE_HEIGHT,
            )
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun BatteryRangeError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — shown when the host has no vehicle state yet, so the panel is never a blank box. */
@Composable
private fun BatteryRangeEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = DataDisplayGlyphs.Battery,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The honest "refreshing / stale / offline" freshness chip over cached figures, aligned to the trailing edge. */
@Composable
private fun BatteryRangeFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberBatteryFreshnessFormatter(),
        )
    }
}

/**
 * Builds the localized [BatteryRangeStrings] from the i18n catalog (P1/S10) — the native analogue of the web
 * `t(...)` calls. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberBatteryRangeStrings(): BatteryRangeStrings {
    val battery = stringResource(R.string.translation_common_battery)
    val ratedRange = stringResource(R.string.translation_vehicles_detail_ratedRange)
    val idealRange = stringResource(R.string.translation_vehicles_detail_idealRange)
    val charging = stringResource(R.string.translation_common_charging)
    val notCharging = stringResource(R.string.translation_common_notCharging)
    val fullIn = stringResource(R.string.translation_vehicles_detail_fullIn)
    return remember(battery, ratedRange, idealRange, charging, notCharging, fullIn) {
        BatteryRangeStrings(
            battery = battery,
            ratedRange = ratedRange,
            idealRange = idealRange,
            charging = charging,
            notCharging = notCharging,
            fullIn = fullIn,
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`), kept out of the projection. */
@Composable
private fun rememberBatteryFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun previewVehicleState(
    batteryLevel: Long,
    isCharging: Boolean,
    chargeRate: Double = 0.0,
    timeToFullCharge: Double = 0.0,
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = chargeRate,
        chargerPower = 0.0,
        idealRange = 402_336.0,
        insideTemp = 21.0,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = true,
        latitude = 37.4,
        longitude = -122.1,
        odometer = 24_140_160.0,
        outsideTemp = 14.0,
        power = 0.0,
        ratedRange = 386_243.0,
        sentryMode = false,
        softwareVersion = "2024.20.1",
        speed = 0.0,
        state = "online",
        timeToFullCharge = timeToFullCharge,
        vehicleId = 1L,
    )

@Preview(name = "Content — charging", showBackground = true)
@Composable
private fun BatteryRangeChargingPreview() {
    val charging = previewVehicleState(72, isCharging = true, chargeRate = 48_280.0, timeToFullCharge = 2.5)
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(
            state = UiState(UiPhase.Content, data = charging),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content — not charging (low)", showBackground = true)
@Composable
private fun BatteryRangeNotChargingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(
            state = UiState(UiPhase.Content, data = previewVehicleState(18, isCharging = false)),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun BatteryRangeLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(state = UiState(UiPhase.Loading), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun BatteryRangeEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(state = UiState(UiPhase.Empty), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun BatteryRangeErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun BatteryRangeOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangePanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewVehicleState(54, isCharging = false),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
        )
    }
}
