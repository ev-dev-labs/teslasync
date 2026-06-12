// The native Jetpack Compose + Material 3 RecentActivity feature view — a parity port of
// web/src/features/vehicles/components/RecentActivity.tsx. The web component is purely presentational: its
// parent passes `drives` / `sessions` and it composes two side-by-side `GlassPanel`s — "Recent Drives"
// (first five drives) and "Recent Charges" (first five charging sessions). Each row renders the distance /
// energy through an `AnimatedNumber`, the start timestamp through `<TimeStamp>`, the duration through an
// `InlineMetric`, and an optional `start% → end%` SoC range; an empty list shows the friendly "No drives /
// charges recorded yet" line.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hooks are `useTranslation`, mapped to the i18n catalog, and `useUnits`, mapped to the shared
// `UnitFormatter` preferences). The host supplies the payload through the shared P1/S8 state-holder layer as
// a [UiState], so this feature view also renders every lifecycle state that layer can carry — loading
// chrome, hard error with retry, content, empty, and stale/offline (cached "last known") — without ever
// fetching. Two entry points are offered: a stateful one bound to a `UiState<RecentActivityData>` feed and a
// web-parity overload that takes `drives` / `sessions` exactly like the web component's props.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentActivity — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentactivity

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId
import java.util.Locale

/** Container width at/above which the two panels lay out side by side instead of stacked (web `lg:grid-cols-2`). */
private val WIDE_LAYOUT_MIN_WIDTH: Dp = 600.dp

private const val SKELETON_ROWS: Int = 3
private const val SKELETON_TITLE_FRACTION: Float = 0.5f
private const val SKELETON_ROW_FRACTION: Float = 0.9f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_ROW_HEIGHT: Dp = 28.dp

/**
 * Stateful entry point bound to the host's RecentActivity feed. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), reads the live display [UnitFormatter] (the native binding of `useUnits`) from the
 * shared S8 layer, and renders every lifecycle [state] the feed can carry. The host owns the feed (P1/S8)
 * and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [RecentActivityData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onViewAllDrives the drives panel's "View all" affordance (web `<Link to="/drives">`).
 * @param onViewAllCharges the charges panel's "View all" affordance (web `<Link to="/charging">`).
 * @param onDriveClick a drive row tap (web `<Link to={`/drives/${id}`}>`), given the drive id.
 * @param onChargeClick a charge row tap (web `<Link to={`/charging/${id}`}>`), given the session id.
 * @param unitFormatterFlow the shared live SI -> display formatter (web `useUnits`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentActivity(
    state: UiState<RecentActivityData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onViewAllDrives: () -> Unit = {},
    onViewAllCharges: () -> Unit = {},
    onDriveClick: (Long) -> Unit = {},
    onChargeClick: (Long) -> Unit = {},
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordRecentActivityOpened(logger) }
    val unitFormatter by unitFormatterFlow.collectAsStateWithLifecycle()
    RecentActivityContent(
        state = state,
        onRetry = onRetry,
        onViewAllDrives = onViewAllDrives,
        onViewAllCharges = onViewAllCharges,
        onDriveClick = onDriveClick,
        onChargeClick = onChargeClick,
        modifier = modifier,
        unitFormatter = unitFormatter,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ drives, sessions })` props, for hosts that already
 * hold the resolved lists. A `null`/empty payload renders the two-panel grid with each panel's own empty
 * branch (web parity — the grid never collapses to a single blank), classified as the empty phase. Records
 * `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun RecentActivity(
    drives: List<RecentActivityDrive>?,
    sessions: List<RecentActivityCharge>?,
    modifier: Modifier = Modifier,
    onViewAllDrives: () -> Unit = {},
    onViewAllCharges: () -> Unit = {},
    onDriveClick: (Long) -> Unit = {},
    onChargeClick: (Long) -> Unit = {},
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(drives, sessions) {
            val payload = RecentActivityData(drives = drives.orEmpty(), sessions = sessions.orEmpty())
            val phase = if (isEmptyPayload(payload)) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = payload)
        }
    RecentActivity(
        state = state,
        onRetry = {},
        modifier = modifier,
        onViewAllDrives = onViewAllDrives,
        onViewAllCharges = onViewAllCharges,
        onDriveClick = onDriveClick,
        onChargeClick = onChargeClick,
        unitFormatterFlow = unitFormatterFlow,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes,
 * mirroring the shared cache-then-network freshness contract. Inside it switches between the loading
 * skeleton grid, a hard-error retry surface, and the resolved two-panel grid (whose panels reproduce the
 * web component's own empty branches), so the surface never blanks. [unitFormatter] supplies the distance
 * unit + locale; [zoneId] the timestamp's wall-clock zone.
 */
@Composable
fun RecentActivityContent(
    state: UiState<RecentActivityData>,
    onRetry: () -> Unit,
    onViewAllDrives: () -> Unit,
    onViewAllCharges: () -> Unit,
    onDriveClick: (Long) -> Unit,
    onChargeClick: (Long) -> Unit,
    modifier: Modifier = Modifier,
    unitFormatter: UnitFormatter = UnitFormatter.default(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: RecentActivityUiStrings = rememberRecentActivityUiStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val isDegraded = state.stale || state.refreshing || state.hasError
    FadeIn(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (state.data != null && isDegraded) {
                RecentActivityFreshnessRow(state = state)
            }
            when {
                state.isLoading -> RecentActivityLoading()
                state.isError -> RecentActivityError(onRetry = onRetry)
                else -> {
                    val data = state.data ?: RecentActivityData()
                    val locale = remember(unitFormatter) { resolveRecentActivityLocale(unitFormatter.prefs.locale) }
                    val distanceUnit = unitFormatter.prefs.distance
                    val driveRows =
                        remember(data, distanceUnit) {
                            RecentActivityProjection.driveRows(data.drives, distanceUnit)
                        }
                    val chargeRows = remember(data) { RecentActivityProjection.chargeRows(data.sessions) }
                    RecentActivityGrid(
                        driveRows = driveRows,
                        chargeRows = chargeRows,
                        strings = strings,
                        onViewAllDrives = onViewAllDrives,
                        onViewAllCharges = onViewAllCharges,
                        onDriveClick = onDriveClick,
                        onChargeClick = onChargeClick,
                        zoneId = zoneId,
                        locale = locale,
                    )
                }
            }
        }
    }
}

/** The two-panel grid — side by side when wide, stacked otherwise, mirroring the web responsive grid. */
@Composable
private fun RecentActivityGrid(
    driveRows: List<DriveRow>,
    chargeRows: List<ChargeRow>,
    strings: RecentActivityUiStrings,
    onViewAllDrives: () -> Unit,
    onViewAllCharges: () -> Unit,
    onDriveClick: (Long) -> Unit,
    onChargeClick: (Long) -> Unit,
    zoneId: ZoneId,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    PanelLayout(
        modifier = modifier,
        first = { panelModifier ->
            DrivesPanel(
                rows = driveRows,
                strings = strings,
                onViewAll = onViewAllDrives,
                onRowClick = onDriveClick,
                zoneId = zoneId,
                locale = locale,
                modifier = panelModifier,
            )
        },
        second = { panelModifier ->
            ChargesPanel(
                rows = chargeRows,
                strings = strings,
                onViewAll = onViewAllCharges,
                onRowClick = onChargeClick,
                zoneId = zoneId,
                locale = locale,
                modifier = panelModifier,
            )
        },
    )
}

/** Adaptive holder for the two panels: a weighted [Row] when wide, a spaced [Column] otherwise. */
@Composable
private fun PanelLayout(
    modifier: Modifier = Modifier,
    first: @Composable (Modifier) -> Unit,
    second: @Composable (Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= WIDE_LAYOUT_MIN_WIDTH) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                first(Modifier.weight(1f))
                second(Modifier.weight(1f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                first(Modifier.fillMaxWidth())
                second(Modifier.fillMaxWidth())
            }
        }
    }
}

/** The "Recent Drives" panel — the web `<GlassPanel>` with the drive rows or the "No drives" empty line. */
@Composable
private fun DrivesPanel(
    rows: List<DriveRow>,
    strings: RecentActivityUiStrings,
    onViewAll: () -> Unit,
    onRowClick: (Long) -> Unit,
    zoneId: ZoneId,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        PanelHeader(
            icon = RecentActivityGlyphs.Route,
            iconTint = TeslaTokens.status.info,
            title = strings.recentDrives,
            viewAllLabel = strings.viewAll,
            onViewAll = onViewAll,
        )
        Spacer(Modifier.height(Spacing.sm))
        if (rows.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                rows.forEach { row ->
                    ActivityRowItem(
                        icon = RecentActivityGlyphs.Route,
                        tone = IconBoxTone.Info,
                        value = row.distanceValue,
                        valueSuffix = row.distanceSuffix,
                        startTsMillis = row.startTsMillis,
                        durationLabel = row.durationLabel,
                        socRange = row.socRange,
                        onClick = { onRowClick(row.id) },
                        zoneId = zoneId,
                        locale = locale,
                    )
                }
            }
        } else {
            PanelEmptyText(message = strings.noDrives)
        }
    }
}

/** The "Recent Charges" panel — the web `<GlassPanel>` with the charge rows or the "No charges" empty line. */
@Composable
private fun ChargesPanel(
    rows: List<ChargeRow>,
    strings: RecentActivityUiStrings,
    onViewAll: () -> Unit,
    onRowClick: (Long) -> Unit,
    zoneId: ZoneId,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        PanelHeader(
            icon = DataDisplayGlyphs.BatteryCharging,
            iconTint = TeslaTokens.status.success,
            title = strings.recentCharges,
            viewAllLabel = strings.viewAll,
            onViewAll = onViewAll,
        )
        Spacer(Modifier.height(Spacing.sm))
        if (rows.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                rows.forEach { row ->
                    ActivityRowItem(
                        icon = DataDisplayGlyphs.Bolt,
                        tone = IconBoxTone.Success,
                        value = row.energyValue,
                        valueSuffix = row.energySuffix,
                        startTsMillis = row.startTsMillis,
                        durationLabel = row.durationLabel,
                        socRange = row.socRange,
                        onClick = { onRowClick(row.id) },
                        zoneId = zoneId,
                        locale = locale,
                    )
                }
            }
        } else {
            PanelEmptyText(message = strings.noCharges)
        }
    }
}

/** A panel header row: a tinted decorative glyph, the title, and the "View all" affordance. */
@Composable
private fun PanelHeader(
    icon: ImageVector,
    iconTint: Color,
    title: String,
    viewAllLabel: String,
    onViewAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
        PanelTitle(text = title, modifier = Modifier.weight(1f))
        ViewAllLink(label = viewAllLabel, onClick = onViewAll)
    }
}

/**
 * A row in a panel — the web `<Link>` row: a colored [IconBox] glyph, the animated distance/energy value
 * with its unit suffix over the start timestamp, and a right-aligned duration `InlineMetric` with the
 * optional `start% → end%` SoC range below it. The whole row is a single tap target (web row link).
 */
@Composable
private fun ActivityRowItem(
    icon: ImageVector,
    tone: IconBoxTone,
    value: Double,
    valueSuffix: String,
    startTsMillis: Long,
    durationLabel: String,
    socRange: String?,
    onClick: () -> Unit,
    zoneId: ZoneId,
    locale: Locale,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.lg))
                .clickable(role = Role.Button) { onClick() }
                .semantics(mergeDescendants = true) {}
                .padding(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        IconBox(tone = tone, size = IconBoxSize.Sm) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            AnimatedNumber(value = value, decimals = VALUE_DECIMALS, suffix = valueSuffix, locale = locale)
            Caption(RecentActivityTimeFormatting.formatTimestamp(startTsMillis, zoneId, locale))
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            InlineMetric(icon = DataDisplayGlyphs.Clock, value = durationLabel)
            if (socRange != null) MetricLabel(text = socRange)
        }
    }
}

/** A centered, muted "nothing yet" line — the web `<p className="... text-center py-6">` panel empty state. */
@Composable
private fun PanelEmptyText(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.lg),
        contentAlignment = Alignment.Center,
    ) {
        Caption(message)
    }
}

/** A "View all" text link with a trailing chevron — the web header `<Link>`; a single tap target. */
@Composable
private fun ViewAllLink(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .clickable(role = Role.Button, onClickLabel = label) { onClick() }
                .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        Icon(imageVector = TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Xs)
    }
}

/** The loading skeleton grid — both panels as skeleton chrome so the surface never blanks. */
@Composable
private fun RecentActivityLoading(modifier: Modifier = Modifier) {
    PanelLayout(
        modifier = modifier,
        first = { panelModifier -> SkeletonPanel(modifier = panelModifier) },
        second = { panelModifier -> SkeletonPanel(modifier = panelModifier) },
    )
}

/** A skeleton panel with a title bar and [SKELETON_ROWS] row bars. */
@Composable
private fun SkeletonPanel(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            repeat(SKELETON_ROWS) {
                Skeleton(widthFraction = SKELETON_ROW_FRACTION, height = SKELETON_ROW_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun RecentActivityError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content. */
@Composable
private fun RecentActivityFreshnessRow(state: UiState<RecentActivityData>) {
    val formatAge = rememberRecentActivityFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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
 * The localized microcopy the surface renders — the web `t('common.*')` keys, resolved from the i18n catalog
 * (P1/S10). Held as one bundle so the two panels share a single resolved set.
 */
data class RecentActivityUiStrings(
    val recentDrives: String,
    val recentCharges: String,
    val viewAll: String,
    val noDrives: String,
    val noCharges: String,
)

/** Resolves the [RecentActivityUiStrings] from the i18n catalog (the web `common.*` keys). */
@Composable
private fun rememberRecentActivityUiStrings(): RecentActivityUiStrings {
    val recentDrives = stringResource(R.string.translation_common_recentDrives)
    val recentCharges = stringResource(R.string.translation_common_recentCharges)
    val viewAll = stringResource(R.string.translation_common_viewAll)
    val noDrives = stringResource(R.string.translation_common_noDrives)
    val noCharges = stringResource(R.string.translation_common_noCharges)
    return remember(recentDrives, recentCharges, viewAll, noDrives, noCharges) {
        RecentActivityUiStrings(
            recentDrives = recentDrives,
            recentCharges = recentCharges,
            viewAll = viewAll,
            noDrives = noDrives,
            noCharges = noCharges,
        )
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern as the siblings. */
@Composable
private fun rememberRecentActivityFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> ChartFormat.EMPTY
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private const val PREVIEW_NOW: Long = 1_700_000_000_000L

private val PREVIEW_DRIVES =
    listOf(
        RecentActivityDrive(
            id = 1L,
            distanceM = 42_000.0,
            durationS = 3_900L,
            startSocPct = 82.0,
            endSocPct = 68.0,
            startTsMillis = PREVIEW_NOW - 600_000L,
        ),
        RecentActivityDrive(
            id = 2L,
            distanceM = 12_500.0,
            durationS = 1_500L,
            startSocPct = 68.0,
            endSocPct = 61.0,
            startTsMillis = PREVIEW_NOW - 7_200_000L,
        ),
    )

private val PREVIEW_SESSIONS =
    listOf(
        RecentActivityCharge(
            id = 9L,
            totalEnergyAddedWh = 23_400.0,
            durationMin = 72L,
            startSocPct = 61.0,
            endSocPct = 90.0,
            startTsMillis = PREVIEW_NOW - 3_600_000L,
        ),
    )

private val PREVIEW_DATA = RecentActivityData(drives = PREVIEW_DRIVES, sessions = PREVIEW_SESSIONS)

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RecentActivityLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RecentActivityErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun RecentActivityEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Empty, data = RecentActivityData()),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun RecentActivityContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}

@Preview(name = "Content (wide)", showBackground = true, widthDp = 820)
@Composable
private fun RecentActivityWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun RecentActivityOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = PREVIEW_NOW,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            onViewAllDrives = {},
            onViewAllCharges = {},
            onDriveClick = {},
            onChargeClick = {},
        )
    }
}
