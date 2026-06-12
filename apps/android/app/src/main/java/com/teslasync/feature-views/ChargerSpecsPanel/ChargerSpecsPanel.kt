// The native Jetpack Compose + Material 3 ChargerSpecsPanel feature view — a parity port of
// web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx. The web component is purely
// presentational: its parent computes a `ChargerSpecsData` (helpers.ts `computeChargerSpecs`) and passes it
// in; the only web hook is `useTranslation`. It renders a titled `GlassPanel` (a Gauge glyph + "Charger
// Specs Breakdown") holding either a four-column breakdown grid — By Voltage (Zap), By Phase (Activity),
// By Cable (Cable), By Brand (Plug, showing average power) — or, when there is no data, a friendly
// `EmptyState`. Each column independently shows its own empty message when it has no rows.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10; counts/energy/power use the
// localized number formatters). The host supplies the breakdown through the shared P1/S8 state-holder layer
// as a [UiState], so this feature view renders every lifecycle state that layer can carry — loading, hard
// error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. A
// web-parity overload that takes the raw `specs` prop is also provided for hosts that already hold the
// computed breakdown.
//
// Colors map to design tokens (never raw hex in render code): the title Gauge uses the semantic `chart.power`
// token (the web `text-neon-purple` #A855F7); column glyphs and the muted summary text inherit the theme's
// on-surface-variant. The four spec columns lay out in a responsive 1/2/4-column grid (web `grid-cols-1
// sm:grid-cols-2 lg:grid-cols-4`) aligned to the Material window-size width breakpoints.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargerSpecsPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargerspecspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** The title Gauge glyph size — the web `<Gauge className="h-4 w-4" />` (16 px). */
private val TITLE_ICON_SIZE: IconSize = IconSize.Md

/** Each column header glyph size — the web `className="h-3 w-3"` (12 px). */
private val COLUMN_ICON_SIZE: IconSize = IconSize.Xs

/** Fraction digits for the kWh value — the web `fmtWithUnit(energy, 'kWh')` default precision. */
private const val ENERGY_DECIMALS: Int = 2

/** Fraction digits for the kW value — the web `fmtInt(avgPower)` (whole number). */
private const val POWER_DECIMALS: Int = 0

/** The four loading skeleton column blocks — one per spec breakdown column. */
private const val SKELETON_COLUMN_COUNT: Int = 4

/** Height of each loading skeleton column block. */
private val SKELETON_COLUMN_HEIGHT: Dp = 96.dp

// Responsive column counts, mirroring the web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` and aligned to the
// Material window-size-class width breakpoints (compact < 600dp, medium < 840dp, expanded ≥ 840dp).
private val GRID_MEDIUM_MIN: Dp = 600.dp
private val GRID_EXPANDED_MIN: Dp = 840.dp
private const val GRID_COLS_COMPACT: Int = 1
private const val GRID_COLS_MEDIUM: Int = 2
private const val GRID_COLS_EXPANDED: Int = 4

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the charger specs panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [ChargerSpecsData] (web `specs`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargerSpecsPanel(
    state: UiState<ChargerSpecsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChargerSpecsPanelOpened(logger) }
    ChargerSpecsPanelContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `specs: ChargerSpecsData | null` prop, for hosts that
 * already hold the computed breakdown. Projects it onto a [UiState] via
 * [ChargerSpecsPanelProjection.projectUiState] (content when the web `hasData` gate passes, else empty) and
 * delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun ChargerSpecsPanel(
    specs: ChargerSpecsData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(specs) { ChargerSpecsPanelProjection.projectUiState(specs) }
    ChargerSpecsPanel(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the
 * titled panel (the web `<h3>` sits outside the data gate) and then maps the host feed's [UiState] onto the
 * body: a loading skeleton grid, a hard-error retry surface (web `QueryError` equivalent), the panel-level
 * empty state (web `!hasData` `EmptyState`), or the four-column breakdown grid. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [locale] formats the counts, energy, and power.
 */
@Composable
fun ChargerSpecsPanelContent(
    state: UiState<ChargerSpecsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: ChargerSpecsStrings = rememberChargerSpecsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters = rememberChargerSpecsFormatters(locale)
    val result = remember(state.data, strings, formatters) { ChargerSpecsPanelProjection.project(state.data, strings, formatters) }

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        ChargerSpecsTitle(title = strings.title)
        when {
            state.isLoading -> ChargerSpecsSkeletonGrid()
            state.isError -> ChargerSpecsError(onRetry = onRetry)
            state.isEmpty || !result.hasData -> ChargerSpecsEmpty(message = strings.noData)
            else -> ChargerSpecsLoaded(columns = result.columns, state = state)
        }
    }
}

/** The panel title — a `chart.power`-purple Gauge glyph + the section title (web `<Gauge /> {title}`). */
@Composable
private fun ChargerSpecsTitle(title: String) {
    Row(
        modifier = Modifier.padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            ChargerSpecsPanelGlyphs.Gauge,
            contentDescription = null,
            size = TITLE_ICON_SIZE,
            tint = TeslaTokens.chart.power,
        )
        SectionTitle(title)
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the four-column
 * breakdown grid. Mirrors the web `grid` of `SpecColumn`s; each column renders its rows or its own empty
 * message, so a column is never a blank gap.
 */
@Composable
private fun ChargerSpecsLoaded(
    columns: List<ChargerSpecsColumn>,
    state: UiState<*>,
) {
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            ChargerSpecsFreshnessChip(state)
        }
    }
    SpecGrid(itemCount = columns.size) { index ->
        SpecColumnView(column = columns[index], modifier = Modifier.weight(1f))
    }
}

/** One breakdown column — its icon + label header, then its rows or its own empty message (web `SpecColumn`). */
@Composable
private fun SpecColumnView(
    column: ChargerSpecsColumn,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(columnGlyph(column.kind), contentDescription = null, size = COLUMN_ICON_SIZE)
            Caption(column.label)
        }
        if (column.isEmpty) {
            EmptyState(message = column.emptyMessage, modifier = Modifier.fillMaxWidth())
        } else {
            column.rows.forEach { row -> SpecRowView(row) }
        }
    }
}

/**
 * One breakdown row — the group name (left, primary) and the "{count} sessions · {value}" summary (right,
 * muted), the whole row merged into a single TalkBack node so it is announced as one fact (web `flex
 * justify-between`).
 */
@Composable
private fun SpecRowView(row: ChargerSpecsRow) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = "${row.name}, ${row.summary}" },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(row.name)
        Caption(row.summary)
    }
}

/** The web loading affordance: four shimmering column blocks laid out in the same responsive grid as the cards. */
@Composable
private fun ChargerSpecsSkeletonGrid() {
    SpecGrid(itemCount = SKELETON_COLUMN_COUNT) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_COLUMN_HEIGHT, rounded = true)
    }
}

/**
 * Panel-level empty state — web parity for `!hasData`: the no-data message under the panel's own Gauge glyph,
 * so the panel never collapses to a blank box. [EmptyState] exposes the message as its accessibility label.
 */
@Composable
private fun ChargerSpecsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = ChargerSpecsPanelGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ChargerSpecsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A responsive grid of [itemCount] equal-width cells — the native analogue of the web `grid-cols-1
 * sm:grid-cols-2 lg:grid-cols-4 gap-6`. The column count tracks the available width via Material
 * window-size breakpoints; cells are top-aligned (web grid items align to the top) and the trailing cells of
 * a short final row are filled with weighted spacers so every cell keeps a uniform width. [tile] receives the
 * cell index and applies `weight(1f)`.
 */
@Composable
private fun SpecGrid(
    itemCount: Int,
    tile: @Composable RowScope.(Int) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth < GRID_MEDIUM_MIN -> GRID_COLS_COMPACT
                maxWidth < GRID_EXPANDED_MIN -> GRID_COLS_MEDIUM
                else -> GRID_COLS_EXPANDED
            }
        val rowCount = (itemCount + columns - 1) / columns
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            for (rowIndex in 0 until rowCount) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                    verticalAlignment = Alignment.Top,
                ) {
                    for (column in 0 until columns) {
                        val index = rowIndex * columns + column
                        if (index < itemCount) tile(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * The freshness chip rendered above the grid when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun ChargerSpecsFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberChargerSpecsFreshnessFormatter(),
    )
}

/**
 * Resolves a [SpecColumnKind] to its column-header glyph — the native analogue of the web lucide icons
 * (Voltage→Zap, Phase→Activity, Cable→Cable, Brand→Plug).
 */
private fun columnGlyph(kind: SpecColumnKind): ImageVector =
    when (kind) {
        SpecColumnKind.Voltage -> ChargerSpecsPanelGlyphs.Zap
        SpecColumnKind.Phase -> ChargerSpecsPanelGlyphs.Activity
        SpecColumnKind.Cable -> ChargerSpecsPanelGlyphs.Cable
        SpecColumnKind.Brand -> ChargerSpecsPanelGlyphs.Plug
    }

/**
 * Builds the localized [ChargerSpecsStrings] from the i18n catalog (P1/S10): the `charging.specs.*` keys the
 * web component reads plus the unit words (`charging.curve.sessions`, `kW`, `kWh`, `avg`) it composes into
 * each summary line. Resolved once at the Compose boundary so the rest of the surface holds no English literal.
 */
@Composable
private fun rememberChargerSpecsStrings(): ChargerSpecsStrings {
    val title = stringResource(R.string.translation_charging_specs_title)
    val byVoltage = stringResource(R.string.translation_charging_specs_byVoltage)
    val byPhase = stringResource(R.string.translation_charging_specs_byPhase)
    val byCable = stringResource(R.string.translation_charging_specs_byCable)
    val byBrand = stringResource(R.string.translation_charging_specs_byBrand)
    val noVoltage = stringResource(R.string.translation_charging_specs_noVoltage)
    val noPhase = stringResource(R.string.translation_charging_specs_noPhase)
    val noCable = stringResource(R.string.translation_charging_specs_noCable)
    val noBrand = stringResource(R.string.translation_charging_specs_noBrand)
    val noData = stringResource(R.string.translation_charging_specs_noData)
    val sessions = stringResource(R.string.translation_charging_curve_sessions)
    val kw = stringResource(R.string.translation_kW)
    val kwh = stringResource(R.string.translation_kWh)
    val avg = stringResource(R.string.translation_avg)
    return remember(
        title,
        byVoltage,
        byPhase,
        byCable,
        byBrand,
        noVoltage,
        noPhase,
        noCable,
        noBrand,
        noData,
        sessions,
        kw,
        kwh,
        avg,
    ) {
        ChargerSpecsStrings(
            title = title,
            byVoltage = byVoltage,
            byPhase = byPhase,
            byCable = byCable,
            byBrand = byBrand,
            noVoltage = noVoltage,
            noPhase = noPhase,
            noCable = noCable,
            noBrand = noBrand,
            noData = noData,
            sessions = sessions,
            kw = kw,
            kwh = kwh,
            avg = avg,
        )
    }
}

/**
 * The locale-aware number formatters the projection injects — the native mirror of the web `fmtInt` /
 * `fmtWithUnit` rules. The session count is rendered verbatim (web `{v.count}`, ungrouped); energy is grouped
 * with two fraction digits (web kWh default precision); power is a grouped integer (web `fmtInt`). Both
 * numeric formatters round half away from zero so the output matches ECMAScript `Intl.NumberFormat`.
 */
@Composable
private fun rememberChargerSpecsFormatters(locale: Locale): ChargerSpecsFormatters =
    remember(locale) {
        ChargerSpecsFormatters(
            count = { value -> value.toString() },
            energyKwh = { value -> formatDecimal(value, ENERGY_DECIMALS, locale) },
            powerKw = { value -> formatDecimal(value, POWER_DECIMALS, locale) },
        )
    }

private fun formatDecimal(
    value: Double,
    decimals: Int,
    locale: Locale,
): String {
    val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
    return DecimalFormat(pattern, DecimalFormatSymbols(locale))
        .apply { roundingMode = RoundingMode.HALF_UP }
        .format(value)
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargerSpecsFreshnessFormatter(): (FreshnessAge) -> String {
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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time by
 * the [Icon] composable's tint — the same approach as the sibling feature-view glyphs.
 */
private object ChargerSpecsPanelGlyphs {
    /** lucide `gauge` — a dial arc with a needle (the panel title). */
    val Gauge: ImageVector =
        chargerVector("ChargerSpecsGauge") {
            moveTo(4f, 18f)
            arcTo(8f, 8f, 0f, false, true, 20f, 18f)
            moveTo(12f, 16f)
            lineTo(16.5f, 11f)
        }

    /** lucide `zap` — a lightning bolt (By Voltage column). */
    val Zap: ImageVector =
        chargerVector("ChargerSpecsZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(20f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `activity` — the ECG pulse line (By Phase column). */
    val Activity: ImageVector =
        chargerVector("ChargerSpecsActivity") {
            moveTo(2f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(22f, 12f)
        }

    /** lucide `cable` — a cord curving between a top and a bottom connector (By Cable column). */
    val Cable: ImageVector =
        chargerVector("ChargerSpecsCable") {
            moveTo(6f, 4f)
            lineTo(6f, 8f)
            curveTo(6f, 13f, 18f, 11f, 18f, 16f)
            lineTo(18f, 20f)
            moveTo(4f, 4f)
            lineTo(8f, 4f)
            moveTo(16f, 20f)
            lineTo(20f, 20f)
        }

    /** lucide `plug` — two prongs, a body cup, and a cord (By Brand column). */
    val Plug: ImageVector =
        chargerVector("ChargerSpecsPlug") {
            moveTo(9f, 2f)
            lineTo(9f, 7f)
            moveTo(15f, 2f)
            lineTo(15f, 7f)
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 11f)
            curveTo(17f, 14f, 15f, 15f, 12f, 15f)
            curveTo(9f, 15f, 7f, 14f, 7f, 11f)
            close()
            moveTo(12f, 15f)
            lineTo(12f, 21f)
        }
}

private fun chargerVector(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    ChargerSpecsStrings(
        title = "Charger Specs Breakdown",
        byVoltage = "By Voltage",
        byPhase = "By Phase",
        byCable = "By Cable",
        byBrand = "By Brand",
        noVoltage = "No voltage data",
        noPhase = "No phase data",
        noCable = "No cable data",
        noBrand = "No brand data",
        noData = "No charger specification data available yet",
        sessions = "sessions",
        kw = "kW",
        kwh = "kWh",
        avg = "avg",
    )

private val PREVIEW_SPECS =
    ChargerSpecsData(
        voltage = emptyList(),
        phase = emptyList(),
        cable =
            listOf(
                SpecEntry("Type 2", 12, 340_000.0, null),
                SpecEntry("CCS", 5, 210_000.0, null),
            ),
        brand =
            listOf(
                SpecEntry("Tesla", 9, 480_000.0, 120_000.0),
                SpecEntry("ChargePoint", 3, 90_000.0, 48_000.0),
            ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargerSpecsPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerSpecsPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SPECS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargerSpecsPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerSpecsPanelContent(state = UiState.loading(), onRetry = {}, locale = Locale.US, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargerSpecsPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerSpecsPanelContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargerSpecsPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerSpecsPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargerSpecsPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerSpecsPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SPECS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
