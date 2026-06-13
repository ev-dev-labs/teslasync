// The native Jetpack Compose + Material 3 MotorSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx. The web component is purely
// presentational: inside a `<GlassPanel>` titled with a cyan Cog icon it renders, when a `motorData` snapshot
// exists, a responsive `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` of eight `<MetricCard>`s (Shift State,
// Pack Voltage, Motor Current (F), Front/Rear Torque, Front/Rear RPM, and peak Motor Temp); otherwise it shows
// a friendly `<EmptyState>` ("No motor data available"). This port keeps that contract end to end.
//
// It performs NO HTTP and binds no data hook of its own; its two web hooks map as: `useTranslation` → the i18n
// catalog (P1/S10) and `useUnits` → the live [io.teslasync.android.data.UnitFormatter] (P1/S8) for the
// temperature display unit + locale + precision. The host supplies the snapshot through the shared P1/S8
// state-holder layer as a [UiState] (the cache-then-network projection of the Vehicle Detail page's `/motor`
// query), so this feature view renders every lifecycle state that layer can carry — loading, hard error with
// retry, empty, content, and stale/offline (cached "last known") — without ever fetching. A web-parity overload
// that takes the raw `motorData` prop is also provided. Because the web title icon is `text-[var(--neon-cyan)]`
// the header Cog is tinted with the cyan status token; the per-card accents (cyan / purple / green, the web
// `MetricCard color` prop) resolve to design tokens so no hex literal leaks into render code.
//
// Every derivation flows through the pure [io.teslasync.android.featureviews.motorsection.MotorSectionProjection];
// the composable is a thin render layer that resolves the labels, builds the live formatters, and records the
// one-shot `view.opened` diagnostic (P1/S11) on first composition. The title, every label, and the empty
// message resolve through the catalog (`vehicles.detail.*` keys); the lifecycle-chrome copy (error / retry /
// offline / loading / freshness) resolves through the shared feedback components + catalog keys, so there is no
// English UI copy literal in this file (only the web's own hard-coded unit symbols `V` / `A` / `Nm`, which live
// in the model).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MotorSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorsection

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
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
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Tailwind `sm` (640px) breakpoint — the web `sm:grid-cols-3` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Tailwind `lg` (1024px) breakpoint — the web `lg:grid-cols-4` reflow. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

private const val GRID_COLUMNS_BASE: Int = 2
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_LG: Int = 4

/** Loading chrome: one tile-height shimmer bar per skeleton row. */
private val SKELETON_TILE_HEIGHT: Dp = 72.dp
private const val SKELETON_COUNT: Int = 4

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Motor section. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * resolves the live temperature unit + locale + precision (web `useUnits`) from the shared
 * [io.teslasync.android.data.UnitFormatter], and renders every lifecycle [state] the shared `/motor` feed can
 * carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs
 * HTTP.
 *
 * @param state the cache-then-network projection of the `MotorSnapshot` (web `motorData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MotorSection(
    state: UiState<MotorReadout>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MotorSectionDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val formatters =
        remember(formatter) {
            val prefs = formatter.prefs
            val locale = resolveDisplayLocale(prefs.locale)
            val precision = (prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)
            MotorFormatters(
                number = { MotorSectionFormat.number(it, precision, locale) },
                integer = { MotorSectionFormat.integer(it, locale) },
                temperature = { formatter.temperature(it) },
            )
        }
    MotorSectionContent(state = state, onRetry = onRetry, formatters = formatters, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `motorData: MotorSnapshot | null | undefined` prop, for
 * hosts that already hold the decoded snapshot. The web `motorData ? … : …` boundary is reproduced from the
 * value itself: a present snapshot renders the grid, an absent one renders the empty state. Records `view.opened`
 * like the stateful entry; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun MotorSection(
    motorData: MotorReadout?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(motorData) {
            val phase = if (motorData != null) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = motorData)
        }
    MotorSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the keys the web component
 * resolves via `t(...)`. Exposed so the stateful entry, the previews, and any host can share one source of
 * strings without re-listing resource ids.
 */
@Composable
fun motorSectionStrings(): MotorSectionStrings =
    MotorSectionStrings(
        title = stringResource(R.string.translation_vehicles_detail_motor),
        shiftState = stringResource(R.string.translation_vehicles_detail_shiftState),
        packVoltage = stringResource(R.string.translation_vehicles_detail_packVoltage),
        motorCurrentFront = stringResource(R.string.translation_vehicles_detail_motorCurrentFront),
        torqueFront = stringResource(R.string.translation_vehicles_detail_torqueFront),
        torqueRear = stringResource(R.string.translation_vehicles_detail_torqueRear),
        rpmFront = stringResource(R.string.translation_vehicles_detail_rpmFront),
        rpmRear = stringResource(R.string.translation_vehicles_detail_rpmRear),
        motorTemp = stringResource(R.string.translation_vehicles_detail_motorTemp),
        noData = stringResource(R.string.translation_vehicles_detail_noMotorData),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always renders the
 * `GlassPanel` + cyan Cog title; then maps the host feed's [UiState] onto the body: skeleton chrome while
 * loading, the shared [QueryError] with retry on a hard error, the eight-tile metric grid when a snapshot is
 * present (web `motorData`, including the stale/offline cached value), or the empty state otherwise. A freshness
 * chip appears in the header when cached data is refreshing / stale / offline, and stale (non-error) data
 * auto-refreshes, mirroring the sibling surfaces' freshness contract. [formatters] are the web `useUnits` /
 * `fmtNumber` outputs the tiles format with.
 */
@Composable
fun MotorSectionContent(
    state: UiState<MotorReadout>,
    onRetry: () -> Unit,
    formatters: MotorFormatters,
    modifier: Modifier = Modifier,
    strings: MotorSectionStrings = motorSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val tiles =
        remember(state.data, formatters) {
            state.data?.let { MotorSectionProjection.project(it, formatters) }.orEmpty()
        }
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    GlassPanel(modifier = modifier.fillMaxWidth()) {
        MotorHeader(title = strings.title, state = state, showFreshness = showFreshness)
        Spacer(modifier = Modifier.height(Spacing.md))
        when {
            state.isLoading -> MotorLoadingChrome(loadingLabel = stringResource(R.string.translation_a11y_loading))
            state.isError -> QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
            state.data != null -> MotorGrid(tiles = tiles, strings = strings)
            else -> EmptyState(message = strings.noData)
        }
    }
}

/**
 * The web header row: the cyan Cog icon beside the localized "Powertrain" section title (web
 * `text-[var(--neon-cyan)]` + `text-lg font-bold`), with the freshness chip pushed to the trailing edge for the
 * native stale/offline affordance when [showFreshness] is set.
 */
@Composable
private fun MotorHeader(
    title: String,
    state: UiState<*>,
    showFreshness: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = MotorSectionGlyphs.Cog,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        SectionTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        if (showFreshness) MotorFreshnessChip(state)
    }
}

/**
 * The responsive metric grid — the web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. Picks 4 columns at or
 * above the `lg` breakpoint, 3 at `sm`, else 2, and lays the eight tiles out as weighted rows so every card
 * shares a uniform width.
 */
@Composable
private fun MotorGrid(
    tiles: List<MotorTile>,
    strings: MotorSectionStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        MotorCellGrid(columns = columns, items = tiles) { tile, cellModifier ->
            MetricCard(
                label = tileLabel(tile.key, strings),
                value = tile.value,
                icon = tileGlyph(tile.key),
                accent = accentColor(tile.accent),
                modifier = cellModifier,
            )
        }
    }
}

/**
 * The loading branch — a column of tile-height skeleton bars carrying a single TalkBack "Loading" content
 * description, so the loading state is announced rather than read as a stack of empty boxes. No metric label
 * leaks while loading.
 */
@Composable
private fun MotorLoadingChrome(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_COUNT) { Skeleton(height = SKELETON_TILE_HEIGHT) }
    }
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' freshness contract;
 * carries no English literal.
 */
@Composable
private fun MotorFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberMotorFreshnessFormatter(),
    )
}

/**
 * Lays the [items] out as the web responsive grid: [columns]-per-row, each cell filling its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so cells keep a uniform width.
 * Cells are spaced by `Spacing.sm`, the native expression of the web `gap-3`.
 */
@Composable
private fun <T> MotorCellGrid(
    columns: Int,
    items: List<T>,
    modifier: Modifier = Modifier,
    cell: @Composable (T, Modifier) -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item -> cell(item, Modifier.weight(1f)) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/** Resolves a [MotorAccent] to its design-token color so no hex literal leaks into the view (web `color` prop). */
@Composable
private fun accentColor(accent: MotorAccent): Color =
    when (accent) {
        MotorAccent.Cyan -> TeslaTokens.status.info
        MotorAccent.Purple -> TeslaTokens.chart.power
        MotorAccent.Green -> TeslaTokens.status.success
    }

/** Maps a tile onto its generated i18n label (web `t('vehicles.detail.<key>')`). */
private fun tileLabel(
    key: MotorTileKey,
    strings: MotorSectionStrings,
): String =
    when (key) {
        MotorTileKey.ShiftState -> strings.shiftState
        MotorTileKey.PackVoltage -> strings.packVoltage
        MotorTileKey.MotorCurrentFront -> strings.motorCurrentFront
        MotorTileKey.TorqueFront -> strings.torqueFront
        MotorTileKey.TorqueRear -> strings.torqueRear
        MotorTileKey.RpmFront -> strings.rpmFront
        MotorTileKey.RpmRear -> strings.rpmRear
        MotorTileKey.MotorTemp -> strings.motorTemp
    }

/** Maps a tile onto its lucide-equivalent glyph (web `Settings` / `Battery` / `Zap` / `Activity` / `Gauge` / `Thermometer`). */
private fun tileGlyph(key: MotorTileKey): ImageVector =
    when (key) {
        MotorTileKey.ShiftState -> MotorSectionGlyphs.Settings
        MotorTileKey.PackVoltage -> MotorSectionGlyphs.Battery
        MotorTileKey.MotorCurrentFront -> MotorSectionGlyphs.Zap
        MotorTileKey.TorqueFront, MotorTileKey.TorqueRear -> MotorSectionGlyphs.Activity
        MotorTileKey.RpmFront, MotorTileKey.RpmRear -> MotorSectionGlyphs.Gauge
        MotorTileKey.MotorTemp -> MotorSectionGlyphs.Thermometer
    }

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMotorFreshnessFormatter(): (FreshnessAge) -> String {
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

private val PREVIEW_STRINGS =
    MotorSectionStrings(
        title = "Powertrain",
        shiftState = "Shift State",
        packVoltage = "Pack Voltage",
        motorCurrentFront = "Motor Current (F)",
        torqueFront = "Front Torque",
        torqueRear = "Rear Torque",
        rpmFront = "Front RPM",
        rpmRear = "Rear RPM",
        motorTemp = "Motor Temp (peak)",
        noData = "No motor data available",
    )

private val PREVIEW_READOUT =
    MotorReadout(
        shiftState = "D",
        vbatFront = 396.0,
        vbatRear = 398.0,
        motorCurrentFront = 152.0,
        torqueNmFront = 180.0,
        torqueNmRear = 175.0,
        motorRpmFront = 1240.0,
        motorRpmRear = 1238.0,
        motorTempCFront = 48.0,
        motorTempCRear = 47.0,
    )

private fun previewFormatters(): MotorFormatters {
    val locale = Locale.US
    return MotorFormatters(
        number = { MotorSectionFormat.number(it, DEFAULT_DECIMAL_PRECISION, locale) },
        integer = { MotorSectionFormat.integer(it, locale) },
        temperature = { "${MotorSectionFormat.number(it, 1, locale)}\u00B0C" },
    )
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MotorSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MotorSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state = UiState(UiPhase.Empty, data = null),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MotorSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — narrow", showBackground = true)
@Composable
private fun MotorSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_READOUT),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — wide (4-col)", showBackground = true, widthDp = 1100)
@Composable
private fun MotorSectionWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_READOUT),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (stale cached)", showBackground = true)
@Composable
private fun MotorSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_READOUT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            formatters = previewFormatters(),
            strings = PREVIEW_STRINGS,
        )
    }
}
