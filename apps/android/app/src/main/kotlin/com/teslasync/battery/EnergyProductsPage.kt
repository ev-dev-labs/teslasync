// The native Jetpack Compose + Material 3 EnergyProductsPage surface — a parity port of
// web/src/features/battery/pages/EnergyProductsPage.tsx, the Powerwalls / Solar / Wall-Connector product-discovery
// dashboard. It reproduces the page's thirteen panels (the four header summary tiles — Energy-Sites / With-Solar /
// With-Battery / Backup-Capable; per discovered site a card with its three stat tiles — Charge / Capacity / Type, its
// capability badges, and its Site-Configuration section with the operation-mode + backup-reserve radial gauge, the
// three rated tiles — Powerwalls / Rated-Power / Rated-Energy, the gateway-firmware line, the component badges and the
// time-of-use rate-plan block; plus the loading-skeleton and empty-state panels), the one chart (the backup-reserve
// RadialGauge), every data state (loading / empty / error / success, plus the cache-then-network stale/offline tier),
// and every visible string (resolved from the generated res/values catalog `energy.products.*` / `energy.siteInfo.*` /
// `energy.tou.*`, ADR-014).
//
// Panel ↔ symbol map (the 13 manifest panels + the 1 chart):
//   1 Powerwalls / 2 Rated-Power / 3 Rated-Energy → [SiteInfoStatsRow]
//   4 GlassPanel4                                 → [EnergySiteCard]   (web's per-site <GlassPanel>, L263)
//   5 Charge / 6 Capacity / 7 Type                → [SiteStatsRow]
//   8 Energy-Sites / 9 With-Solar / 10 With-Battery / 11 Backup-Capable → [SummaryStatsGrid]
//   12 GlassPanel12                               → [EnergyProductsSkeleton] (web's loading <GlassPanel>, L389)
//   13 GlassPanel13                               → [EnergyProductsEmptyPanel] (web's empty <GlassPanel>, L405)
//   chart RadialGauge                             → [SiteConfigOverview] backup-reserve gauge
//
// Composition: [EnergyProductsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the catalog feed + the summary + the live display preferences);
// [EnergyProductsPageContent] is the stateless render layer (the chrome — title / subtitle / freshness chip / refresh
// action — then the always-visible summary grid and the catalog-gated loading / empty / loaded body). Each site card
// independently collects its own per-site `…/site-info` detail via the hoisted [siteInfoProvider] (the web nested
// `SiteInfoSection`), so a dynamic number of sites each render their own loading / content / empty surface. All decode +
// derivation lives in the framework-free model (EnergyProductsPageModel.kt); this file only resolves i18n + draws. SI
// values are scaled to kW/kWh only here at the display boundary via the model's `prefs.energy`/`prefs.power`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package io.teslasync.android.battery.energyproducts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The backup-reserve radial-gauge ceiling (web `RadialGauge max={100}`) + its size. */
private const val RESERVE_MAX = 100.0
private val GAUGE_SIZE = 44.dp

/** The site-card header resource-icon box (web `h-10 w-10 rounded-lg bg-cyan-500/10`). */
private val ICON_BOX = 40.dp

/** The loading-skeleton card height (web `<Skeleton className="h-48" />`). */
private val SKELETON_CARD_HEIGHT = 192.dp

/** How many skeleton cards the loading body shows (web `[1, 2].map(...)`). */
private const val SKELETON_CARD_COUNT = 2

/** Theme-aware chart-palette accent indices (web per-card color), one per stat tile. */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_RED = 3
private const val ACCENT_PURPLE = 4

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [EnergyProductsPageViewModel] over the supplied [source] (the host wires the shared
 * Energy + Settings holders via [energyProductsPageSourceOf]). [logger] defaults to the app's redacting logger. Records
 * the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun EnergyProductsPage(
    source: EnergyProductsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: EnergyProductsPageViewModel =
        viewModel(
            key = EnergyProductsPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { EnergyProductsPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sites by viewModel.sites.collectAsStateWithLifecycle()
    val summary by viewModel.summary.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    EnergyProductsPageContent(
        sites = sites,
        summary = summary,
        prefs = prefs,
        siteInfoProvider = viewModel::siteInfo,
        onRefreshSites = viewModel::refreshSites,
        onRefreshSiteInfo = viewModel::refreshSiteInfo,
        onManageTouPlan = viewModel::manageTouPlan,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + refresh action + the stale/offline banner),
 * the always-visible summary grid, then the catalog-gated body — the loading skeleton on a first load, a retryable
 * error panel on a hard failure, the friendly empty panel when no site is discovered, or the discovered site cards.
 */
@Composable
fun EnergyProductsPageContent(
    sites: UiState<List<EnergySite>>,
    summary: EnergyProductsSummary,
    prefs: EnergyDisplayPrefs,
    siteInfoProvider: (Long) -> StateFlow<UiState<EnergySiteInfo?>>,
    onRefreshSites: () -> Unit,
    onRefreshSiteInfo: (Long) -> Unit,
    onManageTouPlan: (Long) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        EnergyProductsChrome(sites = sites, onRefreshSites = onRefreshSites)

        if (sites.isError) {
            EnergyProductsError(onRetry = onRetry)
        } else {
            FadeIn { SummaryStatsGrid(summary = summary) }
            FadeIn(delayMs = FADE_STEP_MS) {
                when {
                    sites.isLoading -> EnergyProductsSkeleton()
                    sites.isEmpty -> EnergyProductsEmptyPanel()
                    else ->
                        SiteCardsList(
                            sites = sites.data.orEmpty(),
                            prefs = prefs,
                            siteInfoProvider = siteInfoProvider,
                            onRefreshSiteInfo = onRefreshSiteInfo,
                            onManageTouPlan = onManageTouPlan,
                        )
                }
            }
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the refresh action, and the stale banner. */
@Composable
private fun EnergyProductsChrome(
    sites: UiState<List<EnergySite>>,
    onRefreshSites: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_energy_products_title))
                BodyText(
                    stringResource(R.string.translation_energy_products_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = sites.fetchedAt,
                isFetching = sites.refreshing,
                isStale = sites.stale,
                isError = sites.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `actions={<Button …>Refresh from Tesla</Button>}` — POST /tesla/energy-sites/refresh.
        Button(
            label = stringResource(R.string.translation_energy_products_refresh),
            onClick = onRefreshSites,
            leadingIcon = EnergyGlyphs.Refresh,
            loading = sites.refreshing,
        )
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (sites.isOffline) LiveStaleDataBanner()
    }
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun EnergyProductsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

// ── Panels 8-11 — Header summary tiles ──────────────────────────────────────────────────────────────────────────

/**
 * Energy-Sites / With-Solar / With-Battery / Backup-Capable — the web 4-up summary `<StatCard>` grid (always visible,
 * showing zeros before the catalog loads), collapsed to two phone-width rows.
 */
@Composable
private fun SummaryStatsGrid(summary: EnergyProductsSummary) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_totalSites),
                value = summary.totalSites.toString(),
                icon = EnergyGlyphs.Bolt,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_withSolar),
                value = summary.withSolar.toString(),
                icon = EnergyGlyphs.Sun,
            )
        }
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_withBattery),
                value = summary.withBattery.toString(),
                icon = EnergyGlyphs.Battery,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_backupCapable),
                value = summary.backupCapable.toString(),
                icon = EnergyGlyphs.Shield,
            )
        }
    }
}

// ── Panel 12 — Loading skeleton (GlassPanel12) ──────────────────────────────────────────────────────────────────

/** GlassPanel12 — the web `[1, 2].map(i => <GlassPanel><Skeleton className="h-48" /></GlassPanel>)` first-load surface. */
@Composable
private fun EnergyProductsSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(SKELETON_CARD_COUNT) {
            GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
                Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_CARD_HEIGHT)
            }
        }
    }
}

// ── Panel 13 — Empty state (GlassPanel13) ───────────────────────────────────────────────────────────────────────

/** GlassPanel13 — the web `<GlassPanel><EmptyState message={energy.products.empty} /></GlassPanel>` no-products surface. */
@Composable
private fun EnergyProductsEmptyPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        EmptyState(
            message = stringResource(R.string.translation_energy_products_empty),
            icon = EnergyGlyphs.Bolt,
        )
    }
}

// ── Panel 4 — Discovered site cards (GlassPanel4) ───────────────────────────────────────────────────────────────

/** The discovered-site card list — one [EnergySiteCard] per site (web `sites.map(site => <EnergySiteCard … />)`). */
@Composable
private fun SiteCardsList(
    sites: List<EnergySite>,
    prefs: EnergyDisplayPrefs,
    siteInfoProvider: (Long) -> StateFlow<UiState<EnergySiteInfo?>>,
    onRefreshSiteInfo: (Long) -> Unit,
    onManageTouPlan: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        sites.forEach { site ->
            EnergySiteCard(
                site = site,
                prefs = prefs,
                siteInfoProvider = siteInfoProvider,
                onRefreshSiteInfo = onRefreshSiteInfo,
                onManageTouPlan = onManageTouPlan,
            )
        }
    }
}

/**
 * GlassPanel4 — one discovered site (web `EnergySiteCard`): the resource header, the three stat tiles, the capability
 * badges, the nested Site-Configuration section, and the last-fetched footer. Collects its own per-site detail feed via
 * [siteInfoProvider] (the web nested `SiteInfoSection`).
 */
@Composable
private fun EnergySiteCard(
    site: EnergySite,
    prefs: EnergyDisplayPrefs,
    siteInfoProvider: (Long) -> StateFlow<UiState<EnergySiteInfo?>>,
    onRefreshSiteInfo: (Long) -> Unit,
    onManageTouPlan: (Long) -> Unit,
) {
    val info by siteInfoProvider(site.energySiteId).collectAsStateWithLifecycle()
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            SiteCardHeader(site = site)
            SiteStatsRow(site = site, prefs = prefs)
            CapabilityBadges(site = site)
            SiteConfigSection(
                site = site,
                info = info,
                prefs = prefs,
                onRefreshSiteInfo = onRefreshSiteInfo,
                onManageTouPlan = onManageTouPlan,
            )
            HelperText(
                "${stringResource(R.string.translation_energy_products_lastFetched)}: ${prefs.dateTime(site.fetchedAt)}",
            )
        }
    }
}

/** The site-card header — the resource icon box, the (or "Unnamed Site") name, the resource label + id, and the battery-type badge. */
@Composable
private fun SiteCardHeader(site: EnergySite) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier =
                Modifier
                    .size(ICON_BOX)
                    .background(
                        paletteColor(ACCENT_CYAN).copy(alpha = ICON_BOX_WASH_ALPHA),
                        RoundedCornerShape(Radius.md),
                    ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(resourceGlyph(site.kind), contentDescription = null, size = IconSize.Lg, tint = paletteColor(ACCENT_CYAN))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(site.siteName.ifBlank { stringResource(R.string.translation_energy_products_unnamed) })
            Caption("${resourceLabel(site.resourceType)} \u00b7 ID ${site.energySiteId}")
        }
        site.batteryType?.let { Badge(text = it, variant = BadgeVariant.Info) }
    }
}

// ── Panels 5-7 — Per-site stat tiles ────────────────────────────────────────────────────────────────────────────

/** Charge / Capacity / Type — the web 3-up site `<StatCard>` grid, collapsed to a phone-width row pair. */
@Composable
private fun SiteStatsRow(
    site: EnergySite,
    prefs: EnergyDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_charge),
                value = prefs.chargePercent(site.percentageCharged),
                icon = EnergyGlyphs.Gauge,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_capacity),
                value = prefs.energy(site.packEnergyWh),
                icon = EnergyGlyphs.Battery,
            )
        }
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_products_type),
                value = resourceLabel(site.resourceType),
                icon = EnergyGlyphs.Activity,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

/** The capability badges — Solar / Battery / Grid / Backup / Storm-Watch, plus the active Storm-Mode chip (web `CapBadge`s). */
@Composable
private fun CapabilityBadges(site: EnergySite) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CapabilityChip(
            label = stringResource(R.string.translation_energy_products_solar),
            icon = EnergyGlyphs.Sun,
            state = chipState(site.hasSolar),
        )
        CapabilityChip(
            label = stringResource(R.string.translation_energy_products_battery),
            icon = EnergyGlyphs.Battery,
            state = chipState(site.hasBattery),
        )
        CapabilityChip(
            label = stringResource(R.string.translation_energy_products_grid),
            icon = EnergyGlyphs.Grid,
            state = chipState(site.hasGrid),
        )
        CapabilityChip(
            label = stringResource(R.string.translation_energy_products_backup),
            icon = EnergyGlyphs.Shield,
            state = chipState(site.backupCapable),
        )
        CapabilityChip(
            label = stringResource(R.string.translation_energy_products_stormWatch),
            icon = EnergyGlyphs.CloudLightning,
            state = chipState(site.stormModeCapable),
        )
        if (site.stormModeEnabled) {
            CapabilityChip(
                label = stringResource(R.string.translation_energy_products_stormActive),
                icon = EnergyGlyphs.CloudLightning,
                state = ChipState.Warning,
            )
        }
    }
}

/** The tone of a [CapabilityChip] — present (success), absent (neutral), or an active alert (warning). */
private enum class ChipState { Active, Inactive, Warning }

/** Maps a capability flag to its chip tone (web `variant={active ? 'success' : 'neutral'}`). */
private fun chipState(active: Boolean): ChipState = if (active) ChipState.Active else ChipState.Inactive

/**
 * One capability chip (web `CapBadge`): an icon + label pill, success-toned when the capability is present, neutral
 * when absent, and warning-toned for an active storm alert. Mirrors the shared `Badge` wash/foreground treatment while
 * adding the leading icon the web badge carries.
 */
@Composable
private fun CapabilityChip(
    label: String,
    icon: ImageVector,
    state: ChipState,
) {
    val color =
        when (state) {
            ChipState.Active -> TeslaTokens.status.success
            ChipState.Warning -> TeslaTokens.status.warning
            ChipState.Inactive -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    val background =
        if (state == ChipState.Inactive) {
            MaterialTheme.colorScheme.surfaceVariant
        } else {
            color.copy(alpha = CHIP_WASH_ALPHA)
        }
    Surface(shape = RoundedCornerShape(Radius.pill), color = background, contentColor = color) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Xs, tint = color)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

// ── Site-Configuration section (web SiteInfoSection) ────────────────────────────────────────────────────────────

/**
 * The nested Site-Configuration section (web `SiteInfoSection`): a header with the per-site refresh action, then —
 * gated on the per-site detail feed — the loading skeleton, the decoded configuration (overview gauge + rated tiles +
 * firmware + components + rate-plan + fetched stamp), or the friendly "no configuration loaded" empty state.
 */
@Composable
private fun SiteConfigSection(
    site: EnergySite,
    info: UiState<EnergySiteInfo?>,
    prefs: EnergyDisplayPrefs,
    onRefreshSiteInfo: (Long) -> Unit,
    onManageTouPlan: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(
                    EnergyGlyphs.Settings,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Caption(stringResource(R.string.translation_energy_siteInfo_title))
            }
            Button(
                label = stringResource(R.string.translation_energy_siteInfo_refresh),
                onClick = { onRefreshSiteInfo(site.energySiteId) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = EnergyGlyphs.Refresh,
                loading = info.refreshing,
            )
        }

        val detail = info.data
        when {
            info.isLoading -> Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_CARD_HEIGHT)
            detail != null ->
                SiteConfigDetail(
                    site = site,
                    info = detail,
                    prefs = prefs,
                    onManageTouPlan = onManageTouPlan,
                )
            else -> SiteConfigEmpty()
        }
    }
}

/** The decoded site-configuration body — every region the web renders when `info` is present. */
@Composable
private fun SiteConfigDetail(
    site: EnergySite,
    info: EnergySiteInfo,
    prefs: EnergyDisplayPrefs,
    onManageTouPlan: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SiteConfigOverview(info = info, prefs = prefs)
        SiteInfoStatsRow(info = info, prefs = prefs)
        SiteFirmwareLine(info = info)
        ComponentBadges(info = info)
        if (site.touCapable || info.touCapable) {
            TouRatePlanBlock(site = site, info = info, onManageTouPlan = onManageTouPlan)
        }
        info.fetchedAt?.let {
            HelperText(
                "${stringResource(R.string.translation_energy_siteInfo_lastFetched)}: ${prefs.dateTime(it)}",
            )
        }
    }
}

/** The "no site configuration loaded yet" empty surface (web `<EmptyState message={energy.siteInfo.empty} />`). */
@Composable
private fun SiteConfigEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_energy_siteInfo_empty),
        icon = EnergyGlyphs.Info,
    )
}

/**
 * The operation-mode + backup-reserve overview pair (web grid-cols-2). The backup-reserve card hosts the page's one
 * chart — the [RadialGauge] swept to the reserve percentage (web `<RadialGauge value max={100} />`).
 */
@Composable
private fun SiteConfigOverview(
    info: EnergySiteInfo,
    prefs: EnergyDisplayPrefs,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        InfoTile(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_energy_siteInfo_operationMode),
        ) {
            BodyText(operationModeLabel(info.defaultRealMode))
        }
        InfoTile(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_energy_siteInfo_backupReserve),
        ) {
            val reserve = info.backupReservePercent
            if (reserve != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    RadialGauge(
                        value = reserve,
                        max = RESERVE_MAX,
                        label = "",
                        color = TeslaTokens.status.success,
                        size = GAUGE_SIZE,
                    )
                    MetricValue(prefs.reservePercent(reserve))
                }
            } else {
                BodyText(EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** A small bordered tile with a muted [label] and slotted value content (web `rounded-lg bg-white/[0.03] … p-3`). */
@Composable
private fun InfoTile(
    label: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier =
            modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.md))
                .padding(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(label)
            content()
        }
    }
}

// ── Panels 1-3 — Rated site-info tiles ──────────────────────────────────────────────────────────────────────────

/** Powerwalls / Rated-Power / Rated-Energy — the web 3-up site-info `<StatCard>` grid (em-dash when a field is absent). */
@Composable
private fun SiteInfoStatsRow(
    info: EnergySiteInfo,
    prefs: EnergyDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_siteInfo_batteryCount),
                value = info.batteryCount?.toString() ?: EM_DASH,
                icon = EnergyGlyphs.Battery,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_siteInfo_ratedPower),
                value = prefs.power(info.nameplatePowerW),
                icon = EnergyGlyphs.Bolt,
            )
        }
        StatRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_siteInfo_ratedEnergy),
                value = prefs.energy(info.nameplateEnergyWh),
                icon = EnergyGlyphs.Gauge,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

/** The gateway firmware + installation timezone line (web `Cpu` icon + `Firmware: {version} · {tz}`). */
@Composable
private fun SiteFirmwareLine(info: EnergySiteInfo) {
    val timezone = info.installationTimeZone?.let { " \u00b7 $it" }.orEmpty()
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(
            EnergyGlyphs.Cpu,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HelperText(
            "${stringResource(R.string.translation_energy_siteInfo_firmware)}: ${info.version ?: EM_DASH}$timezone",
        )
    }
}

/** The boolean component badges from `site_info.components` (web `Object.entries(components)` success/neutral chips). */
@Composable
private fun ComponentBadges(info: EnergySiteInfo) {
    if (info.components.isEmpty()) return
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        info.components.forEach { flag ->
            Badge(text = flag.label, variant = if (flag.active) BadgeVariant.Success else BadgeVariant.Neutral)
        }
    }
}

/**
 * The time-of-use rate-plan block (web `Rate Plan`): the current tariff name (or "No rate plan configured") and the
 * Update affordance that opens the separate TOU editor surface.
 */
@Composable
private fun TouRatePlanBlock(
    site: EnergySite,
    info: EnergySiteInfo,
    onManageTouPlan: (Long) -> Unit,
) {
    // web `aria-label={t('energy.tou.editPlan', 'Update rate plan')}` — read in composable scope, applied via semantics.
    val editPlanDescription = stringResource(R.string.translation_energy_tou_editPlan)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.md))
                .padding(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(
                        EnergyGlyphs.Clock,
                        contentDescription = null,
                        size = IconSize.Xs,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Caption(stringResource(R.string.translation_energy_tou_sectionTitle))
                }
                BodyText(info.tariffName ?: stringResource(R.string.translation_energy_tou_noPlan))
            }
            Button(
                label = stringResource(R.string.translation_energy_tou_updateButton),
                onClick = { onManageTouPlan(site.energySiteId) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                modifier = Modifier.semantics {
                    contentDescription = editPlanDescription
                },
            )
        }
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up stat row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun StatRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** Maps a discovered resource kind to its header glyph (web `resourceIcon`). */
private fun resourceGlyph(kind: EnergyResourceKind): ImageVector =
    when (kind) {
        EnergyResourceKind.Battery -> EnergyGlyphs.Battery
        EnergyResourceKind.Solar -> EnergyGlyphs.Sun
        EnergyResourceKind.Other -> EnergyGlyphs.Bolt
    }

/** Low-alpha wash behind the site-card resource icon (web `bg-cyan-500/10`). */
private const val ICON_BOX_WASH_ALPHA = 0.12f

/** Low-alpha wash behind an active/warning [CapabilityChip] (mirrors the shared `Badge` wash). */
private const val CHIP_WASH_ALPHA = 0.16f
