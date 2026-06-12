// The native Jetpack Compose + Material 3 ChargingTelemetrySection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx. The web component is purely
// presentational: its parent (the vehicle-detail page) loads the `ChargingTelemetry` record and passes it down
// as a `chargingTelemetry` prop, and the component renders a single `GlassPanel` with a bolt-icon header titled
// "Charging Telemetry" containing either a responsive grid of eight `MetricCard`s (charger power, voltage,
// current, energy added, charging state, battery level, charge rate, range added) or — when the prop is
// null/undefined — the "No charging telemetry available" empty state.
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its
// only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useUnits` (mapped to the live
// [UnitFormatter] from the data container, P1/S8) for the charge-rate / range-added display units, locale and
// precision. The host supplies the decoded snapshot through the shared state-holder layer as a [UiState], so
// this feature view also renders every lifecycle state that layer can carry — loading, hard error with retry,
// empty, content, and stale/offline (cached "last known") — without ever fetching. The panel header (and thus
// the surface's title) is always present, so no state ever collapses to a blank box. A web-parity overload that
// takes the raw `chargingTelemetry` snapshot is also provided.
//
// Colors map web neon names to the generated palette (never raw hex in render code): the web `green` accent
// (neon glow `rgba(16,185,129)`) is the emerald [TeslaTokens.chart.battery]; `cyan` is [TeslaTokens.chart.regen];
// `purple` (neon glow `rgba(168,85,247)`) is [TeslaTokens.chart.power]. Reproducing the web hex literals
// verbatim would reintroduce raw hex into component code (forbidden) and bypass light/dark theming, so — as the
// sibling surfaces do — each metric takes the closest theme token. The four lucide glyphs (`Zap`, `Activity`,
// `BatteryCharging`, `Battery`) are authored here as 24×24 round-capped stroked vectors faithful to the lucide
// shapes, since Android ships no equivalent without the frozen `material-icons-extended` artifact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingTelemetrySection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtelemetrysection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
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
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the cards lay out four-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 4
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The eight tiles the surface renders; sizes the loading skeleton grid so it does not jump on resolve. */
private const val TILE_COUNT: Int = 8

/** Each loading tile mirrors a resolved MetricCard's height so the skeleton grid stays stable. */
private val SKELETON_HEIGHT: Dp = 76.dp

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH_CHIP: String = "\u2014"

/**
 * The already-localized strings the section renders — the keys the web component resolves via `t(...)`: the
 * panel [title] (`vehicles.detail.chargingTelemetry`), the eight metric labels, and the [noData] empty message
 * (`vehicles.detail.noChargingTelemetry`). The nine catalog-present keys resolve at compile time; [rangeAdded]
 * is resolved by-name with the web English fallback because the catalog does not yet define it. Lifecycle-chrome
 * strings (loading / error / retry / offline / freshness) are resolved inline at the Compose boundary.
 */
data class ChargingTelemetrySectionStrings(
    val title: String,
    val chargerPower: String,
    val voltage: String,
    val current: String,
    val energyAdded: String,
    val chargingState: String,
    val batteryLevel: String,
    val chargeRate: String,
    val rangeAdded: String,
    val noData: String,
)

/**
 * Stateful entry point for the Charging Telemetry section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live unit preference + locale (web `useUnits`) from the shared
 * [UnitFormatter] (P1/S8), and renders every lifecycle [state] the shared charging-telemetry feed can carry.
 * The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [ChargingTelemetrySnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingTelemetrySection(
    state: UiState<ChargingTelemetrySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChargingTelemetrySectionOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    ChargingTelemetrySectionContent(state = state, onRetry = onRetry, modifier = modifier, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web component's `chargingTelemetry: ChargingTelemetry | null | undefined`
 * prop, for hosts that already hold the decoded snapshot. A non-null snapshot renders the eight-tile grid; a
 * null one renders the empty state — the web `chargingTelemetry ?` boundary, reproduced via
 * [ChargingTelemetrySectionProjection.projectUiState]. Records `view.opened` like the stateful entry; with no
 * fetch behind it, it offers no retry affordance.
 */
@Composable
fun ChargingTelemetrySection(
    chargingTelemetry: ChargingTelemetrySnapshot?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(chargingTelemetry) {
            ChargingTelemetrySectionProjection.projectUiState(chargingTelemetry, isLoading = false)
        }
    ChargingTelemetrySection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always draws the
 * [GlassPanel] with its bolt-icon header + title (so the section is never hidden or blank), then maps the host
 * feed's [UiState] onto the panel body: a skeleton grid while loading, a retry surface on a hard error, the
 * eight-tile grid when a snapshot is present, or the empty state otherwise. A freshness chip appears in the
 * header when cached data is refreshing / stale / offline, and stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [formatter] supplies the web `useUnits` outputs (distance/speed display units,
 * locale, precision) the tiles format with.
 */
@Composable
fun ChargingTelemetrySectionContent(
    state: UiState<ChargingTelemetrySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
    strings: ChargingTelemetrySectionStrings = rememberChargingTelemetrySectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val locale = remember(formatter) { localeOf(formatter.prefs.locale) }
    val precision = formatter.prefs.precision ?: ChargingTelemetryFormat.DEFAULT_PRECISION
    val formatters =
        remember(formatter, locale, precision) {
            ChargingTelemetryFormatters(
                number = { ChargingTelemetryFormat.number(it, precision, locale) },
                distance = { formatter.distance(it) },
                speed = { formatter.speed(it) },
            )
        }
    val tiles =
        remember(state.data, formatters) {
            state.data?.let { ChargingTelemetrySectionProjection.tiles(it, formatters) }
        }
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        ChargingTelemetryHeader(
            title = strings.title,
            freshness = if (showFreshness) ({ ChargingTelemetryFreshnessChip(state) }) else null,
        )
        when {
            state.isLoading -> ChargingTelemetryLoadingGrid(loadingLabel = loadingLabel)
            state.isError -> ChargingTelemetryError(onRetry = onRetry)
            tiles != null -> ChargingTelemetryGrid(tiles = tiles, strings = strings)
            else -> EmptyState(message = strings.noData, icon = ChargingTelemetryGlyphs.Zap)
        }
    }
}

/**
 * The panel header — the web `flex items-center gap-2 mb-4` row: a green bolt glyph, the bold section title,
 * and (when supplied) the right-aligned freshness chip. The bolt is decorative (the visible title labels the
 * section), so it carries no content description.
 */
@Composable
private fun ChargingTelemetryHeader(
    title: String,
    freshness: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = ChargingTelemetryGlyphs.Zap,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.chart.battery,
        )
        SectionTitle(title, modifier = Modifier.weight(1f))
        if (freshness != null) freshness()
    }
}

/**
 * The resolved branch — the eight tiles in the web responsive grid (`grid-cols-2 sm:grid-cols-3
 * lg:grid-cols-4`). Each card fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cards keep a uniform width. Cells are spaced by `Spacing.md`, the native expression
 * of the web `gap-3`. Each card carries a merged TalkBack label ("label. value") so a tile reads as one node.
 */
@Composable
private fun ChargingTelemetryGrid(
    tiles: List<ChargingTelemetryTile>,
    strings: ChargingTelemetrySectionStrings,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowTiles.forEach { tile ->
                        ChargingTelemetryMetricCard(
                            tile = tile,
                            label = labelFor(tile.metric, strings),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single tile: the web `<MetricCard label value icon color />` with a merged TalkBack label. */
@Composable
private fun ChargingTelemetryMetricCard(
    tile: ChargingTelemetryTile,
    label: String,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = label,
        value = tile.value,
        icon = glyphFor(tile.metric),
        accent = accentFor(tile.metric),
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label. ${tile.value}" },
    )
}

/**
 * The loading branch — [TILE_COUNT] skeleton tiles in the same responsive grid as the resolved cards. The grid
 * carries a single TalkBack "Loading" content description so the loading state is announced rather than read as
 * several empty boxes.
 */
@Composable
private fun ChargingTelemetryLoadingGrid(loadingLabel: String) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel }) {
        val columns = columnsFor(maxWidth)
        val rowCount = (TILE_COUNT + columns - 1) / columns
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            repeat(rowCount) { rowIndex ->
                val tilesInRow = minOf(columns, TILE_COUNT - rowIndex * columns)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    repeat(tilesInRow) { Skeleton(modifier = Modifier.weight(1f), height = SKELETON_HEIGHT, rounded = true) }
                    repeat(columns - tilesInRow) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun ChargingTelemetryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' freshness contract;
 * carries no English literal.
 */
@Composable
private fun ChargingTelemetryFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberChargingTelemetryFreshnessFormatter(),
    )
}

/** Resolves the responsive column count from the available [width] (web `grid-cols-2 sm:3 lg:4`). */
private fun columnsFor(width: Dp): Int =
    when {
        width >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
        width >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
        else -> GRID_COLUMNS_BASE
    }

/** Maps a metric to its localized tile label — the web `t('vehicles.detail.*', …)` strings. */
private fun labelFor(
    metric: ChargingTelemetryMetric,
    strings: ChargingTelemetrySectionStrings,
): String =
    when (metric) {
        ChargingTelemetryMetric.ChargerPower -> strings.chargerPower
        ChargingTelemetryMetric.Voltage -> strings.voltage
        ChargingTelemetryMetric.Current -> strings.current
        ChargingTelemetryMetric.EnergyAdded -> strings.energyAdded
        ChargingTelemetryMetric.ChargingState -> strings.chargingState
        ChargingTelemetryMetric.BatteryLevel -> strings.batteryLevel
        ChargingTelemetryMetric.ChargeRate -> strings.chargeRate
        ChargingTelemetryMetric.RangeAdded -> strings.rangeAdded
    }

/**
 * Maps a metric onto the active theme accent token, reproducing the web `MetricCard color` prop: the web
 * `green` → [TeslaTokens.chart.battery] (emerald), `cyan` → [TeslaTokens.chart.regen], `purple` →
 * [TeslaTokens.chart.power], in the exact web per-tile assignment.
 */
@Composable
private fun accentFor(metric: ChargingTelemetryMetric): Color =
    when (metric) {
        ChargingTelemetryMetric.ChargerPower -> TeslaTokens.chart.battery
        ChargingTelemetryMetric.Voltage -> TeslaTokens.chart.regen
        ChargingTelemetryMetric.Current -> TeslaTokens.chart.power
        ChargingTelemetryMetric.EnergyAdded -> TeslaTokens.chart.battery
        ChargingTelemetryMetric.ChargingState -> TeslaTokens.chart.regen
        ChargingTelemetryMetric.BatteryLevel -> TeslaTokens.chart.battery
        ChargingTelemetryMetric.ChargeRate -> TeslaTokens.chart.regen
        ChargingTelemetryMetric.RangeAdded -> TeslaTokens.chart.power
    }

/** Maps a metric onto its authored lucide glyph — the web per-tile `icon` (`Zap`/`Activity`/`Battery*`). */
private fun glyphFor(metric: ChargingTelemetryMetric): ImageVector =
    when (metric) {
        ChargingTelemetryMetric.ChargerPower -> ChargingTelemetryGlyphs.Zap
        ChargingTelemetryMetric.Voltage -> ChargingTelemetryGlyphs.Activity
        ChargingTelemetryMetric.Current -> ChargingTelemetryGlyphs.Activity
        ChargingTelemetryMetric.EnergyAdded -> ChargingTelemetryGlyphs.BatteryCharging
        ChargingTelemetryMetric.ChargingState -> ChargingTelemetryGlyphs.Battery
        ChargingTelemetryMetric.BatteryLevel -> ChargingTelemetryGlyphs.Battery
        ChargingTelemetryMetric.ChargeRate -> ChargingTelemetryGlyphs.Activity
        ChargingTelemetryMetric.RangeAdded -> ChargingTelemetryGlyphs.Zap
    }

/**
 * Builds the localized [ChargingTelemetrySectionStrings] from the i18n catalog (P1/S10): the title, the nine
 * catalog-present `vehicles.detail.*` keys resolve through compile-time resources; the "Range Added" label
 * resolves by-name with the web `t(key, default)` fallback, since the catalog does not yet define it.
 * Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
fun rememberChargingTelemetrySectionStrings(): ChargingTelemetrySectionStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_vehicles_detail_chargingTelemetry)
    val chargerPower = stringResource(R.string.translation_vehicles_detail_chargerPower)
    val voltage = stringResource(R.string.translation_vehicles_detail_voltage)
    val current = stringResource(R.string.translation_vehicles_detail_current)
    val energyAdded = stringResource(R.string.translation_vehicles_detail_energyAdded)
    val chargingState = stringResource(R.string.translation_vehicles_detail_chargingState)
    val batteryLevel = stringResource(R.string.translation_vehicles_detail_batteryLevel)
    val chargeRate = stringResource(R.string.translation_vehicles_detail_chargeRate)
    val noData = stringResource(R.string.translation_vehicles_detail_noChargingTelemetry)
    val rangeAdded =
        resolveOptional({ context.optionalString(it) }, KEY_RANGE_ADDED, ChargingTelemetrySectionDefaults.RANGE_ADDED)
    return remember(
        title,
        chargerPower,
        voltage,
        current,
        energyAdded,
        chargingState,
        batteryLevel,
        chargeRate,
        rangeAdded,
        noData,
    ) {
        ChargingTelemetrySectionStrings(
            title = title,
            chargerPower = chargerPower,
            voltage = voltage,
            current = current,
            energyAdded = energyAdded,
            chargingState = chargingState,
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            rangeAdded = rangeAdded,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargingTelemetryFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Builds a [Locale] from a BCP-47 [tag]; null/blank ⇒ the device default (web `deriveLocale` fallback). */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * The four lucide glyphs the surface needs. The web uses `lucide-react` (`Zap`, `Activity`, `BatteryCharging`,
 * `Battery`); Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly
 * as the sibling surfaces do for their lucide ports — each is authored here as a 24×24 round-capped stroked
 * vector faithful to the lucide shape, recolored at render time by `MetricCard`'s accent tint (and the header's).
 */
private object ChargingTelemetryGlyphs {
    /** lucide `zap` — a lightning bolt (the header, Charger Power, and Range Added). */
    val Zap: ImageVector =
        stroked("ChargingTelemetryZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `activity` — a heart-rate pulse polyline (Voltage, Current, Charge Rate). */
    val Activity: ImageVector =
        stroked("ChargingTelemetryActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `battery-charging` — a battery body, terminal, and inner bolt (Energy Added). */
    val BatteryCharging: ImageVector =
        stroked("ChargingTelemetryBatteryCharging") {
            moveTo(3f, 8f)
            lineTo(15f, 8f)
            lineTo(15f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(18f, 11f)
            lineTo(18f, 13f)
            moveTo(9.5f, 9.5f)
            lineTo(6.5f, 12.5f)
            lineTo(9f, 12.5f)
            lineTo(8f, 15f)
        }

    /** lucide `battery` — a battery body and terminal (Charging State, Battery Level). */
    val Battery: ImageVector =
        stroked("ChargingTelemetryBattery") {
            moveTo(3f, 8f)
            lineTo(15f, 8f)
            lineTo(15f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(18f, 11f)
            lineTo(18f, 13f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    ChargingTelemetrySectionStrings(
        title = "Charging Telemetry",
        chargerPower = "Charger Power",
        voltage = "Voltage",
        current = "Current",
        energyAdded = "Energy Added",
        chargingState = "Charging State",
        batteryLevel = "Battery Level",
        chargeRate = "Charge Rate",
        rangeAdded = "Range Added",
        noData = "No charging telemetry available",
    )

private fun previewSnapshot(): ChargingTelemetrySnapshot =
    ChargingTelemetrySnapshot(
        chargerPowerW = 11000.0,
        chargerVoltage = 240.0,
        chargerActualCurrent = 48.0,
        chargeEnergyAddedWh = 18500.0,
        chargingState = "Charging",
        batteryLevel = 72.0,
        rangeAddedMetersPerHour = 48000.0,
        rangeAddedMeters = 120000.0,
    )

@Preview(name = "Content — charging", showBackground = true, widthDp = 720)
@Composable
private fun ChargingTelemetrySectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTelemetrySectionContent(
            state = ChargingTelemetrySectionProjection.projectUiState(previewSnapshot(), isLoading = false),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no telemetry", showBackground = true, widthDp = 720)
@Composable
private fun ChargingTelemetrySectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTelemetrySectionContent(
            state = ChargingTelemetrySectionProjection.projectUiState(snapshot = null, isLoading = false),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 720)
@Composable
private fun ChargingTelemetrySectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTelemetrySectionContent(
            state = UiState.loading(),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 720)
@Composable
private fun ChargingTelemetrySectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingTelemetrySectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
