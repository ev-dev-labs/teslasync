// The native Jetpack Compose + Material 3 RecentChargesSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx. The web component is purely
// presentational: its parent (the vehicle-detail page) owns the `ChargingSession[]` and passes it through the
// `sessions` prop, and the component renders a GlassPanel header (a charging icon + "Recent Charges" title + a
// "View all" link to /charging) over either a five-column DataTable (date / energy / duration / cost / battery)
// or, when there are no sessions, an EmptyState.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting` (the currency
// symbol + decimal precision, read from the shared settings store, P1/S8). The host supplies the decoded
// session list through the shared state-holder layer as a [UiState], so this feature view renders every
// lifecycle state that layer can carry — a loading skeleton, a hard error with retry, the "no charging
// sessions recorded yet" empty, content, and stale/offline (cached "last known" with a freshness chip + silent
// auto-refresh) — without ever fetching. The stateful [RecentChargesSection] resolves the formatting context
// from the shared stores; the web-parity overload mirrors the web `sessions` prop; and the stateless
// [RecentChargesSectionContent] is the fully-controlled test/preview entry.
//
// Every derivation flows through the pure [RecentChargesProjection]; the composable resolves the i18n labels
// (P1/S10) and the design-token accents (P1/S9) and draws what they return, using the shared component library
// (ui GlassPanel / DataTable / Pagination / Button / Heading / BodyText / Caption / Icon, feedback EmptyState /
// ErrorDisplay / Skeleton, data-display DataFreshness, motion FadeIn) so it never reaches for a raw widget. The
// one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentChargesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentchargessection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
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
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
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
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn>` panel entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 50

/** Page window for the DataTable's `pagination` — the web `DataTable` default page size. */
private const val PAGE_SIZE: Int = 25

/** Loading branch: skeleton rows that hold the table's shape so the panel never collapses. */
private const val SKELETON_ROWS: Int = 4

private val SKELETON_ROW_HEIGHT: Dp = 28.dp

/** DataTable column weights — the date column is widest, the three metrics equal, the battery range wider. */
private const val DATE_WEIGHT: Float = 1.8f
private const val METRIC_WEIGHT: Float = 1.1f
private const val BATTERY_WEIGHT: Float = 1.4f

/**
 * The already-localized strings the surface renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the surface free of any English literal.
 */
data class RecentChargesStrings(
    val title: String,
    val viewAll: String,
    val columnDate: String,
    val columnEnergy: String,
    val columnDuration: String,
    val columnCost: String,
    val columnBattery: String,
    val noCharges: String,
    val loading: String,
    val retry: String,
    val errorTitle: String,
    val errorMessage: String,
    val offline: String,
    val paginationFirst: String,
    val paginationPrevious: String,
    val paginationNext: String,
    val paginationLast: String,
    val paginationShowing: String,
    val freshnessJustNow: String,
    val freshnessSeconds: String,
    val freshnessMinutes: String,
    val freshnessHours: String,
    val freshnessDays: String,
    val freshnessWeeks: String,
)

/**
 * Stateful, self-contained entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * resolves the user's currency symbol + decimal precision from the shared settings store (web `useFormatting`,
 * P1/S8) and the active locale, and renders every lifecycle [state] the shared recent-charges feed can carry.
 * The host owns the feed (P1/S8) and supplies [onViewAll] (navigate to the charging page, web `/charging`
 * link) and [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded `ChargingSession[]`.
 * @param onViewAll invoked when the "View all" link is tapped (web `<Link to="/charging">`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` + `decimal_precision` format the
 *   energy and cost cells.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentChargesSection(
    state: UiState<RecentChargesData>,
    onViewAll: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currencySymbol =
        remember(settingsResource) { RecentChargesProjection.currencySymbol(settingsResource.cached) }
    val decimals =
        remember(settingsResource) { RecentChargesProjection.decimalPrecision(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    val zone = remember { ZoneId.systemDefault() }
    val formatTimestamp =
        remember(zone, locale) { { iso: String? -> RecentChargesTimeFormatting.format(iso, zone, locale) } }
    LaunchedEffect(Unit) { RecentChargesSectionDiagnostics.recordViewOpened(logger) }
    RecentChargesSectionContent(
        state = state,
        onViewAll = onViewAll,
        onRetry = onRetry,
        modifier = modifier,
        currencySymbol = currencySymbol,
        decimals = decimals,
        locale = locale,
        formatTimestamp = formatTimestamp,
    )
}

/**
 * Web-parity overload mirroring the web component's `sessions: ChargingSession[] | undefined` prop, for hosts
 * that already hold the resolved list. A `null` or empty list renders the empty branch; otherwise the list
 * renders. Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun RecentChargesSection(
    sessions: List<ChargeSession>?,
    onViewAll: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sessions) {
            val list = sessions.orEmpty()
            UiState(
                phase = if (list.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = RecentChargesData(list),
            )
        }
    RecentChargesSection(
        state = state,
        onViewAll = onViewAll,
        onRetry = {},
        modifier = modifier,
        settings = settings,
        logger = logger,
    )
}

/**
 * Stateless, fully-controlled renderer for every surface state — the unit/UI-test + preview entry point.
 * Reproduces the web component's branches (the always-present header + the DataTable / EmptyState body) and
 * adds the lifecycle chrome the host's feed implies — a loading skeleton, a hard-error retry surface, and a
 * freshness chip that reflects refreshing/stale/offline; stale (non-error) data silently auto-refreshes.
 * [currencySymbol] / [decimals] / [locale] / [formatTimestamp] format the row cells.
 */
@Composable
fun RecentChargesSectionContent(
    state: UiState<RecentChargesData>,
    onViewAll: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currencySymbol: String = DEFAULT_CURRENCY,
    decimals: Int = DEFAULT_DECIMALS,
    locale: Locale = Locale.getDefault(),
    formatTimestamp: (String?) -> String = { it ?: EM_DASH },
    strings: RecentChargesStrings = rememberRecentChargesStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, currencySymbol, decimals, locale, formatTimestamp) {
            RecentChargesProjection.project(state.data, currencySymbol, decimals, locale, formatTimestamp)
        }
    val showFreshness = state.stale || state.refreshing || (state.hasError && state.hasData)

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            RecentChargesHeader(strings = strings, onViewAll = onViewAll)
            if (showFreshness) {
                Spacer(Modifier.height(Spacing.sm))
                RecentChargesFreshnessRow(state = state, strings = strings)
            }
            Spacer(Modifier.height(Spacing.md))
            when {
                state.isLoading -> RecentChargesLoading()
                state.isError -> RecentChargesError(strings = strings, onRetry = onRetry)
                result.isEmpty -> RecentChargesEmpty(strings = strings)
                else -> RecentChargesTable(rows = result.rows, strings = strings, locale = locale)
            }
        }
    }
}

/** The always-present header: the green charging IconBox + "Recent Charges" title and the "View all" link. */
@Composable
private fun RecentChargesHeader(
    strings: RecentChargesStrings,
    onViewAll: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                BatteryChargingGlyph,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.success,
            )
            Heading(strings.title, level = HeadingLevel.Panel)
        }
        ViewAllLink(strings = strings, onViewAll = onViewAll)
    }
}

/** The "View all" link — a ghost button with a trailing chevron, carrying its own TalkBack label (web link). */
@Composable
private fun ViewAllLink(
    strings: RecentChargesStrings,
    onViewAll: () -> Unit,
) {
    Button(
        onClick = onViewAll,
        modifier = Modifier.semantics { contentDescription = strings.viewAll },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    ) {
        Caption(strings.viewAll)
        Spacer(Modifier.width(Spacing.xs))
        Icon(
            TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The freshness chip rendered above the table when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun RecentChargesFreshnessRow(
    state: UiState<*>,
    strings: RecentChargesStrings,
) {
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
            fetchingLabel = strings.loading,
            errorLabel = strings.offline,
            formatAge = rememberFreshnessFormatter(strings),
        )
    }
}

/** First-load branch — skeleton rows holding the table's shape so the panel never collapses (web has none). */
@Composable
private fun RecentChargesLoading() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT)
        }
    }
}

/**
 * Hard-error branch — a retry affordance shown when the first load failed with nothing cached (web `QueryError`
 * equivalent). Uses the shared "Server error" title + load-failed message + Retry.
 */
@Composable
private fun RecentChargesError(
    strings: RecentChargesStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty branch — the friendly "no charging sessions recorded yet" state (web `EmptyState`), never a blank box. */
@Composable
private fun RecentChargesEmpty(strings: RecentChargesStrings) {
    EmptyState(
        message = strings.noCharges,
        icon = BatteryChargingGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Content branch — the five-column DataTable (date / energy / duration / cost / battery) the web renders. The
 * web passes `pagination`, so when the host supplies more than one page of sessions a [Pagination] footer is
 * shown; a single page renders without the footer, matching the web's single-page DataTable.
 */
@Composable
private fun RecentChargesTable(
    rows: List<ChargeRowProjection>,
    strings: RecentChargesStrings,
    locale: Locale,
) {
    var page by remember(rows) { mutableIntStateOf(1) }
    val total = rows.size
    val pageCount = if (total == 0) 1 else (total + PAGE_SIZE - 1) / PAGE_SIZE
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * PAGE_SIZE
    val to = minOf(from + PAGE_SIZE, total)
    val visible = if (total > PAGE_SIZE) rows.subList(from, to) else rows

    DataTable(
        columns = recentChargesColumns(strings),
        rows = visible,
        keyOf = { it.id },
        modifier = Modifier.fillMaxWidth(),
        emptyText = strings.noCharges,
        footer =
            if (total > PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = PAGE_SIZE,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = strings.paginationFirst,
                        previousLabel = strings.paginationPrevious,
                        nextLabel = strings.paginationNext,
                        lastLabel = strings.paginationLast,
                        showingText = { start, end, count ->
                            String.format(locale, strings.paginationShowing, start, end, count)
                        },
                    )
                }
            } else {
                null
            },
    )
}

/** The five table columns the web `useChargeColumns` returns — header labels (P1/S10) + per-cell renderers. */
private fun recentChargesColumns(strings: RecentChargesStrings): List<TableColumn<ChargeRowProjection>> =
    listOf(
        TableColumn(
            key = "date",
            header = strings.columnDate,
            weight = DATE_WEIGHT,
            cell = { row -> BodyText(row.dateLabel) },
        ),
        TableColumn(
            key = "energy",
            header = strings.columnEnergy,
            weight = METRIC_WEIGHT,
            cell = { row -> BodyText(row.energyLabel) },
        ),
        TableColumn(
            key = "duration",
            header = strings.columnDuration,
            weight = METRIC_WEIGHT,
            cell = { row -> BodyText(row.durationLabel) },
        ),
        TableColumn(
            key = "cost",
            header = strings.columnCost,
            weight = METRIC_WEIGHT,
            cell = { row -> BodyText(row.costLabel) },
        ),
        TableColumn(
            key = "battery",
            header = strings.columnBattery,
            weight = BATTERY_WEIGHT,
            cell = { row -> BodyText(row.batteryLabel) },
        ),
    )

/**
 * Builds the localized [RecentChargesStrings] from the i18n catalog (P1/S10) — every label the web component
 * reads through `useTranslation` (the five column headers, the title + "View all", and the empty message) plus
 * the generic lifecycle/pagination/freshness labels the native chrome needs — resolved once at the Compose
 * boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberRecentChargesStrings(): RecentChargesStrings =
    RecentChargesStrings(
        title = stringResource(R.string.translation_common_recentCharges),
        viewAll = stringResource(R.string.translation_common_viewAll),
        columnDate = stringResource(R.string.translation_common_date),
        columnEnergy = stringResource(R.string.translation_common_energy),
        columnDuration = stringResource(R.string.translation_common_duration),
        columnCost = stringResource(R.string.translation_common_cost),
        columnBattery = stringResource(R.string.translation_common_battery),
        noCharges = stringResource(R.string.translation_common_noCharges),
        loading = stringResource(R.string.translation_common_loading),
        retry = stringResource(R.string.translation_common_retry),
        errorTitle = stringResource(R.string.translation_error_serverError_title),
        errorMessage = stringResource(R.string.translation_error_loadFailed),
        offline = stringResource(R.string.translation_common_offline),
        paginationFirst = stringResource(R.string.translation_pagination_first),
        paginationPrevious = stringResource(R.string.translation_pagination_previous),
        paginationNext = stringResource(R.string.translation_pagination_next),
        paginationLast = stringResource(R.string.translation_pagination_last),
        paginationShowing = stringResource(R.string.translation_pagination_showing),
        freshnessJustNow = stringResource(R.string.translation_freshness_justNow),
        freshnessSeconds = stringResource(R.string.translation_freshness_seconds),
        freshnessMinutes = stringResource(R.string.translation_freshness_minutes),
        freshnessHours = stringResource(R.string.translation_freshness_hours),
        freshnessDays = stringResource(R.string.translation_freshness_days),
        freshnessWeeks = stringResource(R.string.translation_freshness_weeks),
    )

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`), kept out of projection. */
@Composable
private fun rememberFreshnessFormatter(strings: RecentChargesStrings): (FreshnessAge) -> String =
    remember(strings) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> strings.freshnessJustNow
                is FreshnessAge.Seconds -> strings.freshnessSeconds.format(age.value)
                is FreshnessAge.Minutes -> strings.freshnessMinutes.format(age.value)
                is FreshnessAge.Hours -> strings.freshnessHours.format(age.value)
                is FreshnessAge.Days -> strings.freshnessDays.format(age.value)
                is FreshnessAge.Weeks -> strings.freshnessWeeks.format(age.value)
            }
        }
    }

// ── Local lucide glyph ───────────────────────────────────────────────────────────────────────────────────
// The web component draws one lucide icon (`BatteryCharging`). The shared Android icon set (TeslaGlyphs) has a
// ChevronRight (reused above) but no battery glyph, and feature views may not expand the shared icon library
// from a surface prompt (allowed-files), so the battery is authored here as a 24×24 stroked vector in the
// shared monochrome style — recolored at render time by the `Icon` composable's tint, exactly as the sibling
// feature-view surfaces author their local glyphs.

/** The web `BatteryCharging` (lucide) — a battery body + terminal with a lightning bolt across it. */
val BatteryChargingGlyph: ImageVector =
    strokedGlyph("BatteryCharging") {
        moveTo(2.5f, 8f)
        lineTo(15f, 8f)
        lineTo(15f, 16f)
        lineTo(2.5f, 16f)
        close()
        moveTo(17.5f, 10.5f)
        lineTo(17.5f, 13.5f)
        moveTo(10f, 9.5f)
        lineTo(7.5f, 12.5f)
        lineTo(9.5f, 12.5f)
        lineTo(8f, 15.5f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_SESSIONS: List<ChargeSession> =
    listOf(
        ChargeSession(
            id = 1L,
            startTs = "2026-04-04T18:30:00Z",
            energyAddedWh = 42_300.0,
            durationMinutes = 95.0,
            cost = 8.45,
            startSocPct = 23.0,
            endSocPct = 82.0,
        ),
        ChargeSession(
            id = 2L,
            startTs = "2026-04-01T08:00:00Z",
            energyAddedWh = 11_900.0,
            durationMinutes = 42.0,
            cost = null,
            startSocPct = 64.0,
            endSocPct = 88.0,
        ),
    )

private val PREVIEW_CONTENT: RecentChargesData = RecentChargesData(PREVIEW_SESSIONS)

private fun previewTimestamp(iso: String?): String = iso ?: EM_DASH

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RecentChargesLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentChargesSectionContent(
            state = UiState(UiPhase.Loading),
            onViewAll = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewTimestamp,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun RecentChargesContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentChargesSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_CONTENT),
            onViewAll = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewTimestamp,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun RecentChargesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentChargesSectionContent(
            state = UiState(UiPhase.Empty, data = RecentChargesData()),
            onViewAll = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewTimestamp,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RecentChargesErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentChargesSectionContent(
            state = UiState(UiPhase.Error),
            onViewAll = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewTimestamp,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun RecentChargesOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentChargesSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_CONTENT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onViewAll = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewTimestamp,
        )
    }
}
