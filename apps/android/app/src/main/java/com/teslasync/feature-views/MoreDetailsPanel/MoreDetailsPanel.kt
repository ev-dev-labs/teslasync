// The native Jetpack Compose + Material 3 MoreDetailsPanel feature view — a parity port of
// web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx. The web component is purely
// presentational: the drive-detail page computes the per-row `stats` and passes `drive` + `stats` down, and it
// renders one GlassPanel with an Activity-icon header over two responsive grids — a six-cell primary grid
// (Odometer, Range, Elevation Summary, Energy Consumed, Energy Recovered, Consumption;
// `grid-cols-2 sm:grid-cols-3 lg:grid-cols-7`) and, below a divider, a four-to-six-cell secondary grid
// (Avg Power, Avg Outside Temp + Avg Inside Temp gated on a non-null mean, Min Speed, Battery Used, Net
// Consumption; `grid-cols-2 sm:grid-cols-4`). Distance/range/odometer, speed and temperature convert from SI at
// render via `useUnits`; energy/power/elevation/battery render in fixed units.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10; `useUnits` + the global `fmtNumber` precision/locale,
// mapped to the live S8 SettingsStore for the distance/speed/temperature units, precision and locale). The owning
// drive-detail page computes the snapshot and threads it in through the shared state-holder layer as a [UiState],
// so this view also renders every lifecycle state that layer can carry — a loading skeleton grid, a hard error
// with retry, a friendly empty state, content, and stale/offline cached "last known" with a freshness chip +
// auto-refresh — without ever fetching, exactly like the sibling drive-detail ports. The content branch
// reproduces the web two-grid layout verbatim, including the two conditional temperature cells, wrapped in a
// single [FadeIn] (web `<FadeIn>`). A web-parity overload taking the raw snapshot (web `{ drive, stats }`) is
// provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MoreDetailsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.moredetailspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** Web Tailwind `lg` breakpoint region: at or above this width the primary grid lays out seven-per-row. */
private val GRID_EXPANDED_MIN: Dp = 840.dp

/** Web Tailwind `sm` breakpoint region: at or above this width the grids leave the base two-per-row layout. */
private val GRID_MEDIUM_MIN: Dp = 600.dp

/** Primary grid columns: web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-7`. */
private const val PRIMARY_COLUMNS_COMPACT = 2
private const val PRIMARY_COLUMNS_MEDIUM = 3
private const val PRIMARY_COLUMNS_EXPANDED = 7

/** Secondary grid columns: web `grid-cols-2 sm:grid-cols-4` (no `lg` variant — `sm` holds at every wider size). */
private const val SECONDARY_COLUMNS_COMPACT = 2
private const val SECONDARY_COLUMNS_MEDIUM = 4
private const val SECONDARY_COLUMNS_EXPANDED = 4

/** The six primary + six secondary skeleton cells shown while the host's feed first loads. */
private const val PRIMARY_SKELETON_CELLS = 6
private const val SECONDARY_SKELETON_CELLS = 6

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/** Accessible label connector between a cell's label and its value (web cells read "label, value"). */
private const val LABEL_VALUE_SEPARATOR = ", "

private const val SKELETON_LABEL_FRACTION = 0.6f
private const val SKELETON_VALUE_FRACTION = 0.8f
private val SKELETON_LABEL_HEIGHT: Dp = 10.dp
private val SKELETON_VALUE_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point for the more-details panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live unit + precision + locale preferences from the shared S8 SettingsStore (the native
 * binding of the web `useUnits` hook + global `fmtNumber` precision/locale; metric/2dp/en-US defaults apply until
 * settings load), and renders every lifecycle [state] the shared drive feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [MoreDetailsSnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + precision + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MoreDetailsPanel(
    state: UiState<MoreDetailsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MoreDetailsPanelDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { MoreDetailsDisplayPrefs.from(settingsResource.cached) }
    MoreDetailsPanelContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ drive, stats })` props bundled into one snapshot, for
 * hosts that already hold the computed values. A `null` [snapshot] projects onto the empty [UiState] (the
 * drive-detail page's no-data branch). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun MoreDetailsPanel(
    snapshot: MoreDetailsSnapshot?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(snapshot) { MoreDetailsProjection.projectUiState(snapshot, isLoading = false) }
    MoreDetailsPanel(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The whole panel mounts
 * through a [FadeIn] (web `<FadeIn>`), keeps the Activity-icon header in every state so the section is never blank,
 * and shows a freshness chip in the header when content is stale/refreshing/offline (stale non-error data
 * auto-refreshes). Inside the panel body it switches between a loading skeleton, a hard-error retry surface, a
 * friendly empty state, and the resolved two-grid content. [prefs] supplies the SI -> display conversion and the
 * grouping/precision locale.
 */
@Composable
fun MoreDetailsPanelContent(
    state: UiState<MoreDetailsSnapshot>,
    onRetry: () -> Unit,
    prefs: MoreDetailsDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: MoreDetailsStrings = rememberMoreDetailsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val showFreshness = snapshot != null && (state.stale || state.refreshing || state.hasError)
    FadeIn(modifier = modifier.fillMaxWidth()) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                MoreDetailsHeader(title = strings.title, state = state, showFreshness = showFreshness)
                when {
                    state.isLoading -> MoreDetailsSkeleton()
                    state.isError -> MoreDetailsError(onRetry = onRetry)
                    state.isEmpty || snapshot == null -> MoreDetailsEmpty(message = strings.noData)
                    else -> MoreDetailsLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
                }
            }
        }
    }
}

/**
 * The panel header — the web `<h3>` with its cyan Activity glyph and the localized title, plus a right-aligned
 * freshness chip when the content is degraded (the native expression of the shared [DataFreshness] contract).
 */
@Composable
private fun MoreDetailsHeader(
    title: String,
    state: UiState<MoreDetailsSnapshot>,
    showFreshness: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Icon(MoreDetailsGlyphs.Activity, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.chart.regen)
            PanelTitle(title)
        }
        if (showFreshness) {
            val formatAge = rememberMoreDetailsFreshnessFormatter()
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
}

/**
 * The content branch: the resolved primary grid, a divider (web `border-t`), and the secondary grid. Derives the
 * render-ready cells once via the pure [MoreDetailsProjection].
 */
@Composable
private fun MoreDetailsLoaded(
    snapshot: MoreDetailsSnapshot,
    prefs: MoreDetailsDisplayPrefs,
    strings: MoreDetailsStrings,
) {
    val primary = remember(snapshot, prefs, strings) { MoreDetailsProjection.primaryRows(snapshot, prefs, strings) }
    val secondary = remember(snapshot, prefs, strings) { MoreDetailsProjection.secondaryRows(snapshot, prefs, strings) }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        DetailGrid(
            rows = primary,
            compactColumns = PRIMARY_COLUMNS_COMPACT,
            mediumColumns = PRIMARY_COLUMNS_MEDIUM,
            expandedColumns = PRIMARY_COLUMNS_EXPANDED,
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        DetailGrid(
            rows = secondary,
            compactColumns = SECONDARY_COLUMNS_COMPACT,
            mediumColumns = SECONDARY_COLUMNS_MEDIUM,
            expandedColumns = SECONDARY_COLUMNS_EXPANDED,
        )
    }
}

/**
 * Lays out [rows] in the web responsive grid: [expandedColumns] per row at or above [GRID_EXPANDED_MIN]
 * (`lg:`), [mediumColumns] at or above [GRID_MEDIUM_MIN] (`sm:`), and [compactColumns] below it (base). Cells
 * fill their column via [Modifier.weight], a partial trailing row is padded with weighted spacers, and cells are
 * spaced by `Spacing.sm` (the native expression of the web `gap-4`).
 */
@Composable
private fun DetailGrid(
    rows: List<MoreDetailRow>,
    compactColumns: Int,
    mediumColumns: Int,
    expandedColumns: Int,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_EXPANDED_MIN -> expandedColumns
                maxWidth >= GRID_MEDIUM_MIN -> mediumColumns
                else -> compactColumns
            }
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (chunk in rows.chunked(columns)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    for (row in chunk) {
                        DetailCell(row = row, modifier = Modifier.weight(1f))
                    }
                    repeat(columns - chunk.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One detail cell — the native analogue of a single web `<div class="text-center">`: a small muted label over the
 * bold accent-colored value (or the two arrowed elevation lines). The whole cell is one accessibility node
 * reading "label, value".
 */
@Composable
private fun DetailCell(
    row: MoreDetailRow,
    modifier: Modifier = Modifier,
) {
    val announce = row.label + LABEL_VALUE_SEPARATOR + row.value.announce
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = announce },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        CellLabel(row.label)
        when (val value = row.value) {
            is MoreDetailValue.Measure -> MeasureValue(value = value.value, unit = value.unit, color = row.detail.accent())
            is MoreDetailValue.Elevation -> ElevationValue(gain = value.gain, loss = value.loss)
        }
    }
}

/** The muted, centered cell label (web `text-[10px] text-[var(--text-muted)]`). */
@Composable
private fun CellLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A bold accent-colored value with an optional smaller, muted trailing unit — the native mirror of the web
 * `<p class="text-lg font-bold text-{color}">{value} <span class="text-xs text-muted">{unit}</span></p>`. Built
 * as one centered [buildAnnotatedString] so a long value (e.g. an odometer range) wraps exactly like the web `<p>`.
 */
@Composable
private fun MeasureValue(
    value: String,
    unit: String,
    color: Color,
) {
    val unitColor = MaterialTheme.colorScheme.onSurfaceVariant
    val unitSize = MaterialTheme.typography.labelSmall.fontSize
    val text =
        buildAnnotatedString {
            withStyle(SpanStyle(color = color)) { append(value) }
            if (unit.isNotBlank()) {
                append(" ")
                withStyle(SpanStyle(color = unitColor, fontSize = unitSize)) { append(unit) }
            }
        }
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The Elevation cell: a green gain line (web `ArrowUpRight`) over a red loss line (web `ArrowDownRight`). */
@Composable
private fun ElevationValue(
    gain: String,
    loss: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ElevationLine(glyph = MoreDetailsGlyphs.ArrowUpRight, text = gain, color = TeslaTokens.chart.battery)
        ElevationLine(glyph = MoreDetailsGlyphs.ArrowDownRight, text = loss, color = TeslaTokens.chart.temperature)
    }
}

/** One arrowed elevation line — a small tinted arrow glyph beside the bold tinted "{n} m" value. */
@Composable
private fun ElevationLine(
    glyph: ImageVector,
    text: String,
    color: Color,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Icon(glyph, contentDescription = null, size = IconSize.Xs, tint = color)
        Text(
            text = text,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
            color = color,
        )
    }
}

/** The loading branch: two skeleton grids matching the primary + secondary cell counts, announced as "Loading". */
@Composable
private fun MoreDetailsSkeleton() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        SkeletonGrid(
            cellCount = PRIMARY_SKELETON_CELLS,
            compactColumns = PRIMARY_COLUMNS_COMPACT,
            mediumColumns = PRIMARY_COLUMNS_MEDIUM,
            expandedColumns = PRIMARY_COLUMNS_EXPANDED,
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        SkeletonGrid(
            cellCount = SECONDARY_SKELETON_CELLS,
            compactColumns = SECONDARY_COLUMNS_COMPACT,
            mediumColumns = SECONDARY_COLUMNS_MEDIUM,
            expandedColumns = SECONDARY_COLUMNS_EXPANDED,
        )
    }
}

/** A grid of [cellCount] skeleton cells in the same responsive layout as [DetailGrid]. */
@Composable
private fun SkeletonGrid(
    cellCount: Int,
    compactColumns: Int,
    mediumColumns: Int,
    expandedColumns: Int,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_EXPANDED_MIN -> expandedColumns
                maxWidth >= GRID_MEDIUM_MIN -> mediumColumns
                else -> compactColumns
            }
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (chunk in (0 until cellCount).chunked(columns)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    repeat(chunk.size) { SkeletonCell(modifier = Modifier.weight(1f)) }
                    repeat(columns - chunk.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single loading cell — a centered label bar over a value bar (the detail-cell skeleton shape). */
@Composable
private fun SkeletonCell(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT)
    }
}

/**
 * Empty state — the `common.noData` message with the Activity glyph, so the panel never collapses to a blank
 * body. [EmptyState] exposes the message as its accessibility label, so the section is still announced to TalkBack
 * when it holds no data.
 */
@Composable
private fun MoreDetailsEmpty(message: String) {
    EmptyState(message = message, icon = MoreDetailsGlyphs.Activity, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun MoreDetailsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The value-text accent — the native mirror of the web Tailwind value colors. The web hexes map onto the
 * theme-invariant chart tokens carrying the matching values (cyan→`chart.regen` #06B6D4, green→`chart.battery`
 * #10B981, amber→`chart.energy` #F59E0B, purple→`chart.power` #A855F7, blue→`chart.speed` #3B82F6); the web
 * orange-400 Avg Inside Temp has no dedicated token and maps onto the warm `chart.energy`; Min Speed has no web
 * accent (`text-secondary`) so it reads in the theme's muted on-surface variant.
 */
@Composable
private fun MoreDetail.accent(): Color =
    when (this) {
        MoreDetail.Odometer -> TeslaTokens.chart.regen
        MoreDetail.Range -> TeslaTokens.chart.battery
        MoreDetail.Elevation -> TeslaTokens.chart.battery
        MoreDetail.EnergyConsumed -> TeslaTokens.chart.energy
        MoreDetail.EnergyRecovered -> TeslaTokens.chart.battery
        MoreDetail.Consumption -> TeslaTokens.chart.power
        MoreDetail.AvgPower -> TeslaTokens.chart.energy
        MoreDetail.AvgOutsideTemp -> TeslaTokens.chart.speed
        MoreDetail.AvgInsideTemp -> TeslaTokens.chart.energy
        MoreDetail.MinSpeed -> MaterialTheme.colorScheme.onSurfaceVariant
        MoreDetail.BatteryUsed -> TeslaTokens.chart.energy
        MoreDetail.NetConsumption -> TeslaTokens.chart.regen
    }

/**
 * Builds the localized [MoreDetailsStrings] from the i18n catalog (P1/S10): the `driveDetail.*` labels and
 * `common.noData` the web component reads through `useTranslation`. Resolved once at the Compose boundary so the
 * rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberMoreDetailsStrings(): MoreDetailsStrings {
    val title = stringResource(R.string.translation_driveDetail_moreDetails)
    val odometer = stringResource(R.string.translation_driveDetail_odometer)
    val rangeStartEnd = stringResource(R.string.translation_driveDetail_rangeStartEnd)
    val elevSummary = stringResource(R.string.translation_driveDetail_elevSummary)
    val energyConsumed = stringResource(R.string.translation_driveDetail_energyConsumed)
    val energyRecovered = stringResource(R.string.translation_driveDetail_energyRecovered)
    val consumptionRate = stringResource(R.string.translation_driveDetail_consumptionRate)
    val avgPower = stringResource(R.string.translation_driveDetail_avgPower)
    val avgOutsideTemp = stringResource(R.string.translation_driveDetail_avgOutsideTemp)
    val avgInsideTemp = stringResource(R.string.translation_driveDetail_avgInsideTemp)
    val minSpeed = stringResource(R.string.translation_driveDetail_minSpeed)
    val batteryUsed = stringResource(R.string.translation_driveDetail_batteryUsed)
    val netEnergy = stringResource(R.string.translation_driveDetail_netEnergy)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(
        title,
        odometer,
        rangeStartEnd,
        elevSummary,
        energyConsumed,
        energyRecovered,
        consumptionRate,
        avgPower,
        avgOutsideTemp,
        avgInsideTemp,
        minSpeed,
        batteryUsed,
        netEnergy,
        noData,
    ) {
        MoreDetailsStrings(
            title = title,
            odometer = odometer,
            rangeStartEnd = rangeStartEnd,
            elevSummary = elevSummary,
            energyConsumed = energyConsumed,
            energyRecovered = energyRecovered,
            consumptionRate = consumptionRate,
            avgPower = avgPower,
            avgOutsideTemp = avgOutsideTemp,
            avgInsideTemp = avgInsideTemp,
            minSpeed = minSpeed,
            batteryUsed = batteryUsed,
            netEnergy = netEnergy,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMoreDetailsFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * The lucide glyphs this surface needs that the shared icon sets do not carry. The web uses lucide `Activity`
 * (the panel header), `ArrowUpRight` (elevation gain) and `ArrowDownRight` (elevation loss); Android ships no
 * equivalents without the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do for
 * their lucide ports — they are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object MoreDetailsGlyphs {
    /** lucide `activity` — a single pulse polyline (the panel header glyph + empty-state glyph). */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `arrow-up-right` — a corner bracket with a diagonal up-right arrow (elevation gain line). */
    val ArrowUpRight: ImageVector =
        stroked("ArrowUpRight") {
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 17f)
            moveTo(7f, 17f)
            lineTo(17f, 7f)
        }

    /** lucide `arrow-down-right` — a corner bracket with a diagonal down-right arrow (elevation loss line). */
    val ArrowDownRight: ImageVector =
        stroked("ArrowDownRight") {
            moveTo(7f, 7f)
            lineTo(17f, 17f)
            moveTo(17f, 7f)
            lineTo(17f, 17f)
            lineTo(7f, 17f)
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
    MoreDetailsStrings(
        title = "More Details",
        odometer = "Odometer (From \u2192 To)",
        rangeStartEnd = "Range (Start \u2192 End)",
        elevSummary = "Elevation Summary",
        energyConsumed = "Energy Consumed",
        energyRecovered = "Energy Recovered",
        consumptionRate = "Consumption",
        avgPower = "Avg Power",
        avgOutsideTemp = "Avg Outside Temp",
        avgInsideTemp = "Avg Inside Temp",
        minSpeed = "Min Speed",
        batteryUsed = "Battery Used",
        netEnergy = "Net Consumption",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    MoreDetailsSnapshot(
        odometerStartM = 12_345_000.0,
        odometerEndM = 12_387_300.0,
        startRangeM = 350_000.0,
        endRangeM = 308_000.0,
        elevGainM = 248.0,
        elevLossM = 173.0,
        energyWh = 9_400.0,
        regenWh = 1_500.0,
        distanceM = 42_300.0,
        avgPowerKw = 28.0,
        avgOutsideTempC = 12.5,
        avgInsideTempC = 21.0,
        minSpeedMps = 5.0,
        startBatteryPct = 82.0,
        endBatteryPct = 57.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun MoreDetailsPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MoreDetailsPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = MoreDetailsDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun MoreDetailsPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MoreDetailsPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = MoreDetailsDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MoreDetailsPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MoreDetailsPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = MoreDetailsDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MoreDetailsPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MoreDetailsPanelContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = MoreDetailsDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MoreDetailsPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MoreDetailsPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = MoreDetailsDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
