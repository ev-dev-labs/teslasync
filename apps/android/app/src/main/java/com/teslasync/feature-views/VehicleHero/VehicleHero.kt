// The native Jetpack Compose + Material 3 dashboard Vehicle Hero feature view — a parity port of
// web/src/features/dashboard/components/VehicleHero.tsx. The web component is purely presentational: its
// parent (VehicleHeroWidget) loads the vehicle + its live state and passes them down with SI->display
// converters, and VehicleHero renders the vehicle name + status + freshness header above context-aware radial
// gauges (battery / range / inside / outside, plus speed while driving and charge power while charging), a
// charging banner, a context-aware stat grid (driving / charging / idle layouts + always-visible cards), and
// four quick-action buttons — or, when the vehicle is asleep (`state == null`), a "wake to see live data" card.
//
// This port keeps that contract end to end and adds the lifecycle chrome every native surface must render. It
// performs NO HTTP: its only web hooks are `useTranslation` (mapped to the i18n catalog) and `useDateFormat` /
// `useUnits` (mapped to a clock formatter + the live [UnitFormatter] from the shared P1/S8 data layer). The
// host supplies the payload as a [UiState] (the cache-then-network projection of the vehicle + state feeds),
// so this view renders every lifecycle state that layer can carry — loading, hard error with retry, empty (no
// vehicle), content, the asleep sub-state, and stale/offline (cached "last known") — without ever fetching. A
// web-parity overload that takes the vehicle + state + the WidgetShell freshness flags is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleHero — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclehero

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/** Responsive gauge-grid breakpoints — fewer gauges per row on narrow screens, all six abreast when wide. */
private val GAUGE_BREAK_SM: Dp = 360.dp
private val GAUGE_BREAK_MD: Dp = 560.dp
private const val GAUGE_COLS_SM = 3
private const val GAUGE_COLS_MD = 4
private const val GAUGE_COLS_LG = 6

/** Stat / action grid breakpoint — the Android analogue of web `grid-cols-2 sm:grid-cols-4`. */
private val GRID_BREAK_MD: Dp = 420.dp
private const val GRID_COLS_SM = 2
private const val GRID_COLS_MD = 4

/** Tint opacity of the charging banner's success-colored fill (web `bg-neon-green/5`). */
private const val CHARGING_BANNER_ALPHA = 0.1f

/** Loading-skeleton sizing (the surface renders skeleton chrome while the first load is in flight). */
private const val LOADING_TITLE_FRACTION = 0.5f
private const val LOADING_SUBTITLE_FRACTION = 0.7f
private val LOADING_TITLE_HEIGHT = 24.dp
private val LOADING_SUBTITLE_HEIGHT = 12.dp
private val LOADING_GAUGE_HEIGHT = 72.dp

/** Wake-card skeleton bar height (web `<Skeleton className="h-8" />`). */
private val ASLEEP_SKELETON_HEIGHT = 32.dp

/**
 * The five navigation actions the hero exposes (web `<Link>` quick-actions + the asleep `Wake Up`). Grouping
 * them keeps the composable signatures small; a host supplies real navigation, previews/tests pass no-ops.
 */
data class VehicleHeroActions(
    val onOpenDetails: (Long) -> Unit = {},
    val onOpenCommands: () -> Unit = {},
    val onOpenLiveMap: () -> Unit = {},
    val onOpenDigitalTwin: () -> Unit = {},
    val onWakeUp: () -> Unit = {},
)

/**
 * Stateful entry point. Binds `useUnits` (the live [UnitFormatter] from the shared P1/S8 data layer), records
 * the one-shot PII-safe `view.opened` diagnostic (P1/S11), and renders every lifecycle [state] the host's
 * vehicle + state feeds can carry. The host owns the feed and supplies [onRetry] (its `refetch`) + the
 * navigation [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the resolved vehicle + its live state.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param actions the navigation callbacks for the quick-action buttons + the asleep wake button.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleHero(
    state: UiState<VehicleHeroData>,
    onRetry: () -> Unit,
    actions: VehicleHeroActions,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { recordVehicleHeroOpened(logger) }
    VehicleHeroContent(state = state, actions = actions, onRetry = onRetry, modifier = modifier, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web `VehicleHeroWidget` -> `VehicleHero` composition: the loaded
 * [vehicle] + its (nullable) [vehicleState] + [firmwareVersion], plus the WidgetShell freshness flags
 * (`loading={!vehicle}`, `isFetching`, `isStale`, `isError`, `updatedAt`). Builds the [UiState] and delegates,
 * so a host that already holds the resolved vehicle can render the hero directly.
 */
@Composable
fun VehicleHero(
    vehicle: Vehicle,
    vehicleState: VehicleState?,
    firmwareVersion: String,
    actions: VehicleHeroActions,
    modifier: Modifier = Modifier,
    lastFetchedAt: Long? = null,
    isFetching: Boolean = false,
    isStale: Boolean = false,
    isError: Boolean = false,
    onRetry: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(vehicle, vehicleState, firmwareVersion, lastFetchedAt, isFetching, isStale, isError) {
            vehicleHeroStateOf(
                data = VehicleHeroData(vehicle, vehicleState, firmwareVersion),
                loading = isFetching,
                isStale = isStale,
                isError = isError,
                fetchedAt = lastFetchedAt,
            )
        }
    VehicleHero(state = state, onRetry = onRetry, actions = actions, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the preview/UI-test entry point. Maps the host feed's [state]
 * onto the loading / error+retry / empty / content surfaces; the content surface renders the header and then
 * the live hero (gauges + charging + stats + actions) or the asleep wake card, reproducing the web
 * composition. Stale (non-error) cached data auto-refreshes and shows a freshness chip, mirroring the web
 * freshness contract. [formatter] is the `useUnits` boundary; [formatClockTime] is the `useDateFormat`
 * boundary; [locale] formats the numeric values.
 */
@Composable
fun VehicleHeroContent(
    state: UiState<VehicleHeroData>,
    modifier: Modifier = Modifier,
    actions: VehicleHeroActions = VehicleHeroActions(),
    onRetry: () -> Unit = {},
    formatter: UnitFormatter = UnitFormatter.default(),
    locale: Locale = Locale.getDefault(),
    nowMillis: Long = System.currentTimeMillis(),
    formatClockTime: (Long) -> String = defaultClockTime(locale),
    strings: VehicleHeroStrings = rememberVehicleHeroStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            when (vehicleHeroSurface(state)) {
                VehicleHeroSurface.Loading -> VehicleHeroLoading()
                VehicleHeroSurface.Error -> VehicleHeroError(state = state, onRetry = onRetry)
                VehicleHeroSurface.Empty -> VehicleHeroEmpty()
                VehicleHeroSurface.Content ->
                    VehicleHeroLoaded(
                        state = state,
                        formatter = formatter,
                        strings = strings,
                        locale = locale,
                        nowMillis = nowMillis,
                        formatClockTime = formatClockTime,
                        actions = actions,
                    )
            }
        }
    }
}

@Composable
private fun VehicleHeroLoaded(
    state: UiState<VehicleHeroData>,
    formatter: UnitFormatter,
    strings: VehicleHeroStrings,
    locale: Locale,
    nowMillis: Long,
    formatClockTime: (Long) -> String,
    actions: VehicleHeroActions,
) {
    val data = state.data ?: return
    val vehicle = data.vehicle ?: return
    val display =
        remember(data, formatter, strings, locale, nowMillis) {
            VehicleHeroProjection.project(
                vehicle = vehicle,
                state = data.state,
                firmwareVersion = data.firmwareVersion,
                formatter = formatter,
                strings = strings,
                nowMillis = nowMillis,
                locale = locale,
                formatClockTime = formatClockTime,
            )
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        VehicleHeroHeader(display = display, state = state)
        if (display.asleep) {
            VehicleHeroAsleep(onWakeUp = actions.onWakeUp)
        } else {
            Column(
                modifier = Modifier.clearAndSetSemantics { contentDescription = display.accessibleSummary },
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                VehicleHeroGauges(gauges = display.gauges, strings = strings)
                display.charging?.let { VehicleHeroChargingBanner(charging = it, strings = strings) }
                VehicleHeroStatGrid(stats = display.stats, strings = strings)
            }
            VehicleHeroActionsRow(vehicleId = vehicle.id, strings = strings, actions = actions)
        }
    }
}

/** The name + status badge + freshness header and the model/trim/vin subtitle (web hero header). */
@Composable
private fun VehicleHeroHeader(
    display: VehicleHeroDisplay,
    state: UiState<*>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Heading(display.name, modifier = Modifier.weight(1f), level = HeadingLevel.Section, maxLines = 1)
            StatusBadge(status = display.status, size = ChipSize.Md)
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberHeroFreshnessFormatter(),
            )
        }
        if (display.subtitle.isNotEmpty()) {
            Caption(display.subtitle)
        }
    }
}

/** The context-aware radial gauges, wrapped into responsive rows and centered (web flex-wrap gauge row). */
@Composable
private fun VehicleHeroGauges(
    gauges: List<HeroGauge>,
    strings: VehicleHeroStrings,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val cols =
            when {
                maxWidth < GAUGE_BREAK_SM -> GAUGE_COLS_SM
                maxWidth < GAUGE_BREAK_MD -> GAUGE_COLS_MD
                else -> GAUGE_COLS_LG
            }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            gauges.chunked(cols).forEach { rowGauges ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
                ) {
                    rowGauges.forEach { gauge ->
                        RadialGauge(
                            value = gauge.value,
                            max = gauge.max,
                            label = gaugeLabel(gauge.key, strings),
                            unit = gauge.unit,
                            color = heroAccentColor(gauge.accent),
                        )
                    }
                }
            }
        }
    }
}

/** The charging banner — a success-tinted surface with the power / rate / time-to-full figures. */
@Composable
private fun VehicleHeroChargingBanner(
    charging: HeroChargingDetails,
    strings: VehicleHeroStrings,
) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = TeslaTokens.status.success.copy(alpha = CHARGING_BANNER_ALPHA),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(DataDisplayGlyphs.BatteryCharging, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
                Heading(strings.charging, level = HeadingLevel.Sub, color = TeslaTokens.status.success)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                ChargeFigure(strings.chargePower, charging.powerText, null, Modifier.weight(1f))
                ChargeFigure(strings.rate, charging.rateText, null, Modifier.weight(1f))
                ChargeFigure(strings.timeToFull, charging.timeToFullText, charging.doneAtText, Modifier.weight(1f))
            }
        }
    }
}

/** One charging figure: a small label, the value, and an optional "done at ~time" caption. */
@Composable
private fun ChargeFigure(
    label: String,
    value: String,
    caption: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        MetricLabel(label)
        Heading(value, level = HeadingLevel.Sub, maxLines = 1)
        if (caption != null) {
            Caption(caption)
        }
    }
}

/** The context stat grid, wrapped into responsive rows (web `grid-cols-2 sm:grid-cols-4`). */
@Composable
private fun VehicleHeroStatGrid(
    stats: List<HeroStat>,
    strings: VehicleHeroStrings,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val cols = if (maxWidth < GRID_BREAK_MD) GRID_COLS_SM else GRID_COLS_MD
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            stats.chunked(cols).forEach { rowStats ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    rowStats.forEach { stat ->
                        MetricCard(
                            label = statLabel(stat, strings),
                            value = stat.value,
                            modifier = Modifier.weight(1f),
                            icon = heroGlyphVector(stat.glyph),
                            accent = heroAccentColor(stat.accent),
                            iconContentDescription = null,
                        )
                    }
                    repeat(cols - rowStats.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The four quick-action buttons, wrapped into responsive rows; each label is the button's accessible name. */
@Composable
private fun VehicleHeroActionsRow(
    vehicleId: Long,
    strings: VehicleHeroStrings,
    actions: VehicleHeroActions,
) {
    val items =
        listOf(
            HeroAction(strings.details, TeslaGlyphs.Eye) { actions.onOpenDetails(vehicleId) },
            HeroAction(strings.commands, DataDisplayGlyphs.Bolt, actions.onOpenCommands),
            HeroAction(strings.liveMap, DataDisplayGlyphs.MapPin, actions.onOpenLiveMap),
            HeroAction(strings.digitalTwin, VehicleHeroGlyphs.Monitor, actions.onOpenDigitalTwin),
        )
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val cols = if (maxWidth < GRID_BREAK_MD) GRID_COLS_SM else GRID_COLS_MD
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items.chunked(cols).forEach { rowItems ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    rowItems.forEach { action ->
                        Button(
                            label = action.label,
                            onClick = action.onClick,
                            modifier = Modifier.weight(1f),
                            variant = ButtonVariant.Secondary,
                            size = ButtonSize.Sm,
                            leadingIcon = action.icon,
                        )
                    }
                    repeat(cols - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** One quick-action spec (label + leading glyph + click). */
private data class HeroAction(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

/** The asleep card — skeleton chrome, the "wake to see live data" message, and the Wake Up button. */
@Composable
private fun VehicleHeroAsleep(onWakeUp: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = ASLEEP_SKELETON_HEIGHT, rounded = true)
        BodyText(
            stringResource(R.string.translation_hero_asleep),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            label = stringResource(R.string.translation_hero_wakeUp),
            onClick = onWakeUp,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
        )
    }
}

/** Loading chrome — name + subtitle bars over a gauge-skeleton row (never a blank panel). */
@Composable
private fun VehicleHeroLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(widthFraction = LOADING_SUBTITLE_FRACTION, height = LOADING_SUBTITLE_HEIGHT)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(GAUGE_COLS_MD) {
                Column(modifier = Modifier.weight(1f)) {
                    Skeleton(height = LOADING_GAUGE_HEIGHT, rounded = true)
                }
            }
        }
        StatGridSkeleton(count = GRID_COLS_MD)
    }
}

/** Hard-error surface with a retry affordance (web `QueryError`), personalised with the vehicle resource name. */
@Composable
private fun VehicleHeroError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind =
            classifyQueryError(
                status = state.httpStatus,
                online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
            ),
        resourceName = stringResource(R.string.translation_Vehicle),
        onRetry = onRetry,
    )
}

/** The friendly empty state when no vehicle is enrolled (web parent `{vehicle && …}` gate). */
@Composable
private fun VehicleHeroEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noVehicle),
        icon = VehicleHeroGlyphs.Car,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The arc color for a gauge / stat accent — design-token roles, never raw hex or neon. */
@Composable
private fun heroAccentColor(accent: HeroAccent): Color =
    when (accent) {
        HeroAccent.Green -> TeslaTokens.chart.battery
        HeroAccent.Amber -> TeslaTokens.chart.energy
        HeroAccent.Cyan -> TeslaTokens.chart.regen
        HeroAccent.Purple -> TeslaTokens.chart.power
        HeroAccent.Blue -> TeslaTokens.chart.speed
        HeroAccent.Red -> TeslaTokens.status.danger
        HeroAccent.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
        HeroAccent.Primary -> MaterialTheme.colorScheme.primary
    }

/** Maps a [HeroGlyph] to its rendered vector — shared data-display icons plus the locally-authored ones. */
private fun heroGlyphVector(glyph: HeroGlyph): ImageVector =
    when (glyph) {
        HeroGlyph.Gauge -> DataDisplayGlyphs.Gauge
        HeroGlyph.Bolt -> DataDisplayGlyphs.Bolt
        HeroGlyph.Navigation -> VehicleHeroGlyphs.Navigation
        HeroGlyph.Activity -> VehicleHeroGlyphs.Activity
        HeroGlyph.Thermometer -> VehicleHeroGlyphs.Thermometer
        HeroGlyph.Clock -> DataDisplayGlyphs.Clock
        HeroGlyph.Lock -> DataDisplayGlyphs.Lock
        HeroGlyph.Unlock -> VehicleHeroGlyphs.Unlock
        HeroGlyph.Shield -> DataDisplayGlyphs.Shield
    }

/** Resolves a gauge's localized label from its stable key (web `t('hero.*')`). */
private fun gaugeLabel(
    key: String,
    strings: VehicleHeroStrings,
): String =
    when (key) {
        "battery" -> strings.battery
        "range" -> strings.range
        "speed" -> strings.speed
        "chargePower" -> strings.power
        "inside" -> strings.inside
        "outside" -> strings.outside
        else -> ""
    }

/** Resolves a stat's label, swapping the power-card sentinel for the localized "Power" (web `hero.power`). */
private fun statLabel(
    stat: HeroStat,
    strings: VehicleHeroStrings,
): String = if (stat.label == HERO_POWER_LABEL_SENTINEL) strings.power else stat.label

/** The web `useDateFormat().formatTime` boundary — a short, localized wall-clock time. */
private fun defaultClockTime(locale: Locale): (Long) -> String =
    { millis -> DateFormat.getTimeInstance(DateFormat.SHORT, locale).format(Date(millis)) }

/**
 * Builds the localized [VehicleHeroStrings] from the i18n catalog (P1/S10) — every `t(...)` key the web
 * component resolves, plus the few stat-card labels the web renders as literals (re-localized here from the
 * existing catalog so no English literal reaches native code). Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberVehicleHeroStrings(): VehicleHeroStrings {
    val battery = stringResource(R.string.translation_hero_battery)
    val range = stringResource(R.string.translation_hero_range)
    val speed = stringResource(R.string.translation_hero_speed)
    val power = stringResource(R.string.translation_hero_power)
    val inside = stringResource(R.string.translation_hero_inside)
    val outside = stringResource(R.string.translation_hero_outside)
    val charging = stringResource(R.string.translation_hero_charging)
    val chargePower = stringResource(R.string.translation_hero_chargePower)
    val rate = stringResource(R.string.translation_hero_chargeRate)
    val timeToFull = stringResource(R.string.translation_hero_timeToFull)
    val doneAt = stringResource(R.string.translation_hero_doneAt)
    val odometer = stringResource(R.string.translation_Odometer)
    val idealRange = stringResource(R.string.translation_widget_idealRange)
    val chargeRate = stringResource(R.string.translation_common_chargeRate)
    val firmware = stringResource(R.string.translation_vehicleHero_stat_firmware)
    val status = stringResource(R.string.translation_common_status)
    val locked = stringResource(R.string.translation_common_locked)
    val unlocked = stringResource(R.string.translation_common_unlocked)
    val sentry = stringResource(R.string.translation_common_sentry)
    val active = stringResource(R.string.translation_common_active)
    val off = stringResource(R.string.translation_common_off)
    val details = stringResource(R.string.translation_hero_details)
    val commands = stringResource(R.string.translation_hero_commands)
    val liveMap = stringResource(R.string.translation_hero_liveMap)
    val digitalTwin = stringResource(R.string.translation_hero_digitalTwin)
    return remember(battery, range, speed, power, inside, outside, charging, chargePower, rate, timeToFull, doneAt) {
        VehicleHeroStrings(
            battery = battery,
            range = range,
            speed = speed,
            power = power,
            inside = inside,
            outside = outside,
            charging = charging,
            chargePower = chargePower,
            rate = rate,
            timeToFull = timeToFull,
            doneAt = doneAt,
            odometer = odometer,
            idealRange = idealRange,
            chargeRate = chargeRate,
            firmware = firmware,
            status = status,
            locked = locked,
            unlocked = unlocked,
            sentry = sentry,
            active = active,
            off = off,
            details = details,
            commands = commands,
            liveMap = liveMap,
            digitalTwin = digitalTwin,
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberHeroFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> HERO_EM_DASH
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

// ── Previews (tooling-only; one @Preview entry per rendered state) ───────────────────────────────────

private val PREVIEW_VEHICLE: Vehicle =
    Json.decodeFromString(
        Vehicle.serializer(),
        """
        {"id":1,"tesla_id":42,"vin":"5YJ3E1EA7KF000001","display_name":"My Model 3","model":"Model 3",
         "trim_level":"Long Range","timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
         "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-06-01T00:00:00Z"}
        """.trimIndent(),
    )

@Suppress("LongParameterList")
private fun previewState(
    batteryLevel: Long = 72,
    speed: Double = 0.0,
    power: Double = 0.0,
    isCharging: Boolean = false,
    chargerPower: Double = 0.0,
    timeToFullCharge: Double = 0.0,
    isLocked: Boolean = true,
    sentryMode: Boolean = false,
    state: String = "online",
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = 48_000.0,
        chargerPower = chargerPower,
        idealRange = 380_000.0,
        insideTemp = 21.5,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = isLocked,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 42_000_000.0,
        outsideTemp = 12.0,
        power = power,
        ratedRange = 350_000.0,
        sentryMode = sentryMode,
        softwareVersion = "2026.20.1",
        speed = speed,
        state = state,
        timeToFullCharge = timeToFullCharge,
        vehicleId = 1L,
    )

private fun previewUiState(
    state: VehicleState?,
    phase: UiPhase = UiPhase.Content,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<VehicleHeroData> =
    UiState(
        phase = phase,
        data = VehicleHeroData(PREVIEW_VEHICLE, state, "2026.20.1"),
        fetchedAt = 1_700_000_000_000L,
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "VehicleHero · idle", showBackground = true)
@Composable
private fun VehicleHeroIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = previewUiState(previewState()))
    }
}

@Preview(name = "VehicleHero · driving", showBackground = true)
@Composable
private fun VehicleHeroDrivingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = previewUiState(previewState(speed = 27.0, power = 32.0, state = "driving", isLocked = true)))
    }
}

@Preview(name = "VehicleHero · charging", showBackground = true)
@Composable
private fun VehicleHeroChargingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(
            state =
                previewUiState(
                    previewState(isCharging = true, chargerPower = 48.4, power = -48.0, timeToFullCharge = 1.5, state = "charging"),
                ),
        )
    }
}

@Preview(name = "VehicleHero · asleep", showBackground = true)
@Composable
private fun VehicleHeroAsleepPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = previewUiState(state = null, phase = UiPhase.Content))
    }
}

@Preview(name = "VehicleHero · loading", showBackground = true)
@Composable
private fun VehicleHeroLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = UiState.loading())
    }
}

@Preview(name = "VehicleHero · empty", showBackground = true)
@Composable
private fun VehicleHeroEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = UiState(UiPhase.Empty, data = VehicleHeroData(null, null, HERO_EM_DASH)))
    }
}

@Preview(name = "VehicleHero · error", showBackground = true)
@Composable
private fun VehicleHeroErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "VehicleHero · offline (cached)", showBackground = true)
@Composable
private fun VehicleHeroOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroContent(state = previewUiState(previewState(), stale = true, errorKind = ErrorKind.Network))
    }
}
