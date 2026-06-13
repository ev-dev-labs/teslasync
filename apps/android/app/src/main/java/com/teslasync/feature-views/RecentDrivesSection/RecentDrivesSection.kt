// The native Jetpack Compose + Material 3 RecentDrivesSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx. The web component is purely
// presentational: its parent (the vehicle-detail page) passes the resolved `drives: Drive[] | undefined` prop
// and it renders a `GlassPanel` with a Route-icon "Recent Drives" header + a "View all" link to /drives, then
// EITHER a paginated `DataTable` (Date / Distance / sortable, Duration / Battery) when there are drives OR a
// friendly `EmptyState`. It performs no fetching.
//
// This native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the P1/S10 i18n catalog, `useUnits`, mapped to the shared
// `UnitFormatter` preferences, and the local `useDriveColumns` helper, mapped to the projection). The host
// supplies the drive feed through the shared P1/S8 state-holder layer as a [UiState], so the feature view also
// renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, the
// friendly empty state, content, and stale/offline (cached "last known" with a freshness chip + silent
// auto-refresh) — without ever fetching. The content + empty branches reproduce the web component exactly. A
// web-parity overload that takes the raw `drives` prop is also provided for hosts that already hold the list.
//
// The shared native `DataTable` renders the four web columns. The web marks the Distance column `sortable`,
// but the base `DataTable` does NOT sort its own `data` — `sortKey`/`sortDir`/`onSort` are parent-controlled
// props the web `RecentDrivesSection` never wires, so clicking the header is a no-op and the rows stay in
// source order. The native column is likewise flagged `sortable = true` (the header is a tap target) with no
// sort state wired, faithfully reproducing the web's affordance-without-reordering behaviour. Pagination is
// client-side over the full list (the web `<DataTable pagination />` default page size of 25).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentDrivesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentdrivessection

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId
import java.time.ZoneOffset

// Column weights — the relative horizontal share each column gets. The full date+time gets the most room; the
// `Xh Ym` duration the least. Mirrors the web column ordering (Date / Distance / Duration / Battery).
private const val DATE_WEIGHT: Float = 2.2f
private const val DISTANCE_WEIGHT: Float = 1.4f
private const val DURATION_WEIGHT: Float = 1.2f
private const val BATTERY_WEIGHT: Float = 1.6f

// The loading skeleton — a title bar plus a handful of row bars so the panel never blanks on first load.
private const val SKELETON_ROWS: Int = 4
private const val SKELETON_TITLE_FRACTION: Float = 0.4f

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), binds the live unit
 * preferences (web `useUnits`), and renders every lifecycle [state] the shared recent-drives feed can carry.
 * The host owns the feed (P1/S8) and supplies [onViewAll] (its `/drives` navigation) + [onRetry] (its
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the recent-drives list.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onViewAll the header "View all" affordance (web `<Link to="/drives">`).
 * @param unitFormatterFlow the shared live SI -> display formatter (web `useUnits`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentDrivesSection(
    state: UiState<List<RecentDrive>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onViewAll: () -> Unit = {},
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordRecentDrivesSectionOpened(logger) }
    val unitFormatter by unitFormatterFlow.collectAsStateWithLifecycle()
    RecentDrivesSectionContent(
        state = state,
        onRetry = onRetry,
        onViewAll = onViewAll,
        modifier = modifier,
        unitFormatter = unitFormatter,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ drives })` prop, for hosts that already hold the
 * resolved list. Projects it onto a [UiState] via [projectUiState] (content / empty), then renders. Records
 * `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun RecentDrivesSection(
    drives: List<RecentDrive>?,
    modifier: Modifier = Modifier,
    onViewAll: () -> Unit = {},
    unitFormatterFlow: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(drives) { projectUiState(drives = drives, loading = false) }
    RecentDrivesSection(
        state = state,
        onRetry = {},
        modifier = modifier,
        onViewAll = onViewAll,
        unitFormatterFlow = unitFormatterFlow,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * `GlassPanel` + Route-icon header + "View all" link, then picks the same branch the web ternary does, extended
 * with the lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface, the
 * friendly empty state, or the populated table (with a freshness chip above it whenever the feed is
 * refreshing/stale/offline; stale non-error data silently auto-refreshes). [unitFormatter] supplies the
 * distance unit + locale + precision; [locale]/[zoneId] format each row's timestamp (the web `formatDateTime`).
 */
@Composable
fun RecentDrivesSectionContent(
    state: UiState<List<RecentDrive>>,
    onRetry: () -> Unit,
    onViewAll: () -> Unit,
    modifier: Modifier = Modifier,
    unitFormatter: UnitFormatter = UnitFormatter.default(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: RecentDrivesStrings = rememberRecentDrivesStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val drives = state.data
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            RecentDrivesHeader(title = strings.title, viewAllLabel = strings.viewAll, onViewAll = onViewAll)
            when {
                state.isLoading -> RecentDrivesLoading()
                state.isError -> RecentDrivesError(onRetry = onRetry)
                drives.isNullOrEmpty() -> RecentDrivesEmpty(strings = strings)
                else ->
                    RecentDrivesBody(
                        state = state,
                        drives = drives,
                        unitFormatter = unitFormatter,
                        zoneId = zoneId,
                        strings = strings,
                    )
            }
        }
    }
}

/**
 * The always-present panel header — the web `flex items-center justify-between mb-4` row: a Route icon, the
 * "Recent Drives" [title], and the right-aligned "View all" link (web `<Link to="/drives">`).
 */
@Composable
private fun RecentDrivesHeader(
    title: String,
    viewAllLabel: String,
    onViewAll: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = MapsGlyphs.Route,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        SectionTitle(title, modifier = Modifier.weight(1f))
        ViewAllLink(label = viewAllLabel, onClick = onViewAll)
    }
}

/** A "View all" text link with a trailing chevron — the web header `<Link>`; a single labeled tap target. */
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
                .padding(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        Icon(imageVector = TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Xs)
    }
}

/**
 * The populated table body — projects the drives (web per-column `render` callbacks) into render-ready rows,
 * shows a freshness chip whenever the feed is refreshing/stale/offline, client-paginates the full list (web
 * `<DataTable pagination />`), and renders the shared [DataTable] with the four web columns + a pagination
 * footer. [zoneId]/[unitFormatter] format each row at the render boundary.
 */
@Composable
private fun RecentDrivesBody(
    state: UiState<List<RecentDrive>>,
    drives: List<RecentDrive>,
    unitFormatter: UnitFormatter,
    zoneId: ZoneId,
    strings: RecentDrivesStrings,
) {
    val displayPrefs = remember(unitFormatter) { RecentDrivesDisplayPrefs.from(unitFormatter.prefs) }
    val rows =
        remember(drives, displayPrefs, zoneId, strings) {
            RecentDrivesProjection.rows(
                drives = drives,
                prefs = displayPrefs,
                strings = strings,
                formatDate = { iso -> RecentDrivesTimeFormatting.format(iso, zoneId, displayPrefs.locale) },
            )
        }
    var page by remember(rows) { mutableIntStateOf(1) }
    val pageCount = pageCount(rows.size)
    val current = page.coerceIn(1, pageCount)
    val pageRows = rows.subList(pageStart(current), pageEnd(current, rows.size))

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.stale || state.refreshing || state.hasError) {
            RecentDrivesFreshness(state = state)
        }
        DataTable(
            columns = recentDriveColumns(strings),
            rows = pageRows,
            keyOf = { it.id },
            modifier = Modifier.semantics { contentDescription = strings.title },
            emptyText = strings.empty,
            footer = {
                RecentDrivesPagination(
                    page = current,
                    total = rows.size,
                    onPageChange = { page = it },
                )
            },
        )
    }
}

/**
 * The four web columns (Date / Distance / Duration / Battery). The Distance header is flagged `sortable` to
 * reproduce the web affordance; like the web (which never wires `onSort`), no sort state is hoisted, so the
 * header is a tap target that does not reorder the rows. Cell content is already localized + formatted by the
 * projection, so each renderer is a thin map from a [RecentDriveRow] to a shared text primitive. The Date cell
 * carries the merged per-row a11y announcement so TalkBack reads the whole drive on focus.
 */
private fun recentDriveColumns(strings: RecentDrivesStrings): List<TableColumn<RecentDriveRow>> =
    listOf(
        TableColumn(key = COL_DATE, header = strings.date, weight = DATE_WEIGHT) { row ->
            BodyText(
                row.dateText,
                maxLines = 1,
                modifier = Modifier.semantics { contentDescription = row.announce },
            )
        },
        TableColumn(key = COL_DISTANCE, header = strings.distance, weight = DISTANCE_WEIGHT, sortable = true) { row ->
            BodyText(row.distanceText, maxLines = 1)
        },
        TableColumn(key = COL_DURATION, header = strings.duration, weight = DURATION_WEIGHT) { row ->
            BodyText(row.durationText, maxLines = 1)
        },
        TableColumn(key = COL_BATTERY, header = strings.battery, weight = BATTERY_WEIGHT) { row ->
            BodyText(row.batteryText, maxLines = 1)
        },
    )

/** First-load body — a title bar plus [SKELETON_ROWS] shimmer rows, with an accessible "loading" label. */
@Composable
private fun RecentDrivesLoading() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION)
        repeat(SKELETON_ROWS) { Skeleton(rounded = true) }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent for the feed's failure state. */
@Composable
private fun RecentDrivesError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The friendly empty state — the web `<EmptyState icon={<Route/>} message="No drives recorded yet" />`. Never a
 * blank box; the Route icon + message match the web exactly (no title, as the web passes none).
 */
@Composable
private fun RecentDrivesEmpty(strings: RecentDrivesStrings) {
    EmptyState(
        message = strings.empty,
        icon = MapsGlyphs.Route,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip surfacing refreshing/stale/offline over the cached table (ADR-013). */
@Composable
private fun RecentDrivesFreshness(state: UiState<List<RecentDrive>>) {
    val formatAge = rememberRecentDrivesFreshnessFormatter()
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

/** Client-side pagination footer — the web in-table `<Pagination />` over the full drives list. */
@Composable
private fun RecentDrivesPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = RECENT_DRIVES_PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            context.getString(R.string.translation_pagination_showing, start, end, count)
        },
    )
}

/**
 * Resolves the already-localized [RecentDrivesStrings] from the i18n catalog (P1/S10) — the web component's
 * `t(...)` calls. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
fun rememberRecentDrivesStrings(): RecentDrivesStrings {
    val title = stringResource(R.string.translation_common_recentDrives)
    val viewAll = stringResource(R.string.translation_common_viewAll)
    val date = stringResource(R.string.translation_common_date)
    val distance = stringResource(R.string.translation_common_distance)
    val duration = stringResource(R.string.translation_common_duration)
    val battery = stringResource(R.string.translation_common_battery)
    val empty = stringResource(R.string.translation_common_noDrives)
    return remember(title, viewAll, date, distance, duration, battery, empty) {
        RecentDrivesStrings(
            title = title,
            viewAll = viewAll,
            date = date,
            distance = distance,
            duration = duration,
            battery = battery,
            empty = empty,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberRecentDrivesFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Client pagination math (web `data.slice((page-1)*size, page*size)`) ──────────────────────────────────

private fun pageCount(total: Int): Int = if (total <= 0) 1 else (total + RECENT_DRIVES_PAGE_SIZE - 1) / RECENT_DRIVES_PAGE_SIZE

private fun pageStart(page: Int): Int = (page - 1) * RECENT_DRIVES_PAGE_SIZE

private fun pageEnd(
    page: Int,
    total: Int,
): Int = minOf(page * RECENT_DRIVES_PAGE_SIZE, total)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────────

private val PREVIEW_STRINGS =
    RecentDrivesStrings(
        title = "Recent Drives",
        viewAll = "View all",
        date = "Date",
        distance = "Distance",
        duration = "Duration",
        battery = "Battery",
        empty = "No drives recorded yet",
    )

private fun previewDrives(): List<RecentDrive> =
    listOf(
        RecentDrive(
            id = 1L,
            startTs = "2026-06-11T14:30:00Z",
            distanceM = 24_140.0,
            durationS = 1_980.0,
            startSocPct = 82.0,
            endSocPct = 64.0,
        ),
        RecentDrive(
            id = 2L,
            startTs = "2026-06-10T08:05:00Z",
            distanceM = 6_437.0,
            durationS = 720.0,
            startSocPct = 64.0,
            endSocPct = 58.0,
        ),
        RecentDrive(
            id = 3L,
            startTs = "2026-06-09T18:42:00Z",
            distanceM = 51_499.0,
            durationS = 4_260.0,
            startSocPct = 90.0,
            endSocPct = null,
        ),
    )

private fun previewState(
    data: List<RecentDrive>?,
    phase: UiPhase,
    stale: Boolean = false,
    fetchedAt: Long? = null,
    errorKind: ErrorKind? = null,
): UiState<List<RecentDrive>> = UiState(phase = phase, data = data, stale = stale, fetchedAt = fetchedAt, errorKind = errorKind)

@Composable
private fun previewContent(state: UiState<List<RecentDrive>>) {
    RecentDrivesSectionContent(
        state = state,
        onRetry = {},
        onViewAll = {},
        unitFormatter = UnitFormatter.default(),
        zoneId = ZoneOffset.UTC,
        strings = PREVIEW_STRINGS,
    )
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun RecentDrivesSectionDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(previewDrives(), UiPhase.Content))
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RecentDrivesSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(emptyList(), UiPhase.Loading))
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun RecentDrivesSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(emptyList(), UiPhase.Empty))
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RecentDrivesSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(null, UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun RecentDrivesSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(
            previewState(
                previewDrives(),
                UiPhase.Content,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
    }
}
