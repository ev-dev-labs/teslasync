// The native Jetpack Compose + Material 3 EnergyChargingPanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx. The web component is purely
// presentational: a parent passes a `ChargingTelemetry | null | undefined`; its only hooks are `useTranslation`
// (i18n) and `useUnits` (the `formatSpeed` helper). It renders a titled GlassPanel (a BatteryCharging glyph +
// "Energy & Charging") holding — when telemetry is present — a two-column MetricCard grid (Charger Voltage in V,
// Charger Current in A) above four label/value rows (Charger Power, Energy Added, Battery Level, and a Zap-prefixed
// Charge Rate) and a colored Charging-State chip; when telemetry is absent it renders a friendly EmptyState.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own: its web hooks are
// `useTranslation` (mapped to the i18n catalog, P1/S10) and `useUnits` (mapped to the live S8 SettingsStore for the
// speed unit + locale + precision that the Charge Rate conversion needs). The owning telemetry page supplies the
// `ChargingTelemetry` through the shared state-holder layer as a [UiState], so this feature view also renders every
// lifecycle state that layer can carry — a loading skeleton, a hard error with retry (web `QueryError` equivalent),
// the friendly empty state, content, and stale/offline cached "last known" with a freshness chip + auto-refresh —
// without ever fetching, exactly like the sibling telemetry-panel ports. A web-parity overload taking the raw
// `chargingTelemetry` prop is provided for hosts that already hold the snapshot.
//
// Colors map to design tokens (never raw hex in render code): the title BatteryCharging glyph uses the cyan
// `chart.regen` token (the web `text-cyan-300`); the Charging-State chip maps its semantic kind onto the shared
// `Badge` variants — Charging→Info (cyan), Complete→Success (green), else Neutral (gray) — the native expression of
// the web `cyan / green / gray` chip branch. The metric grid lays out two equal-width MetricCards (web
// `grid-cols-2`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EnergyChargingPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.energychargingpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
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
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** The title BatteryCharging glyph size — the web `<BatteryCharging className="h-4 w-4" />` (16 px). */
private val TITLE_ICON_SIZE: IconSize = IconSize.Md

/** The Charge Rate Zap glyph size — the web `<Zap className="h-3 w-3" />` (12 px). */
private val ROW_ICON_SIZE: IconSize = IconSize.Xs

/** Height of each loading skeleton block (a MetricCard / row shimmer). */
private val SKELETON_CARD_HEIGHT: Dp = 64.dp

/** Height of each loading skeleton detail-row bar. */
private val SKELETON_ROW_HEIGHT: Dp = 16.dp

/** The number of label/value skeleton bars under the two card blocks (Power/Energy/State/Battery/Rate). */
private const val SKELETON_ROW_COUNT: Int = 5

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH_FRESHNESS: String = "\u2014"

/**
 * Stateful entry point for the energy & charging panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live speed-unit + locale + precision preferences from the shared S8 SettingsStore (the native
 * binding of the web `useUnits` hook; metric/en-US/2-decimal defaults apply until settings load), and renders every
 * lifecycle [state] the host's charging feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the
 * feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [ChargingTelemetrySnapshot] (web `chargingTelemetry`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnergyChargingPanel(
    state: UiState<ChargingTelemetrySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordEnergyChargingPanelOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { EnergyChargingDisplayPrefs.from(settingsResource.cached) }
    EnergyChargingPanelContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `chargingTelemetry: ChargingTelemetry | null | undefined` prop,
 * for hosts that already hold the snapshot. Projects it onto a [UiState] via
 * [EnergyChargingPanelProjection.projectUiState] (content when present, else empty) and delegates to the stateful
 * entry, which records `view.opened`. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun EnergyChargingPanel(
    snapshot: ChargingTelemetrySnapshot?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(snapshot) { EnergyChargingPanelProjection.projectUiState(snapshot) }
    EnergyChargingPanel(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the titled
 * panel (the web `<h3>` sits outside the data gate) and then maps the host feed's [UiState] onto the body: a loading
 * skeleton, a hard-error retry surface (web `QueryError` equivalent), the panel-level empty state (web absent-prop
 * `EmptyState`), or the resolved metric grid + rows. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [prefs] supplies the Charge-Rate speed conversion + the grouping locale/precision.
 */
@Composable
fun EnergyChargingPanelContent(
    state: UiState<ChargingTelemetrySnapshot>,
    onRetry: () -> Unit,
    prefs: EnergyChargingDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: EnergyChargingStrings = rememberEnergyChargingStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        EnergyChargingTitle(title = strings.title)
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (snapshot != null && isDegraded) {
                EnergyChargingFreshnessRow(state = state)
            }
            when {
                state.isLoading -> EnergyChargingSkeleton()
                state.isError -> EnergyChargingError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> EnergyChargingEmpty(message = strings.noData)
                else -> EnergyChargingLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
            }
        }
    }
}

/** The panel title — a cyan `chart.regen` BatteryCharging glyph + the section title (web `<BatteryCharging /> {title}`). */
@Composable
private fun EnergyChargingTitle(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.BatteryCharging,
            contentDescription = null,
            size = TITLE_ICON_SIZE,
            tint = TeslaTokens.chart.regen,
        )
        SectionTitle(title)
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content — the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid.
 */
@Composable
private fun EnergyChargingFreshnessRow(state: UiState<ChargingTelemetrySnapshot>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberEnergyChargingFreshnessFormatter(),
        )
    }
}

/**
 * The content branch: the two MetricCards over the four label/value rows and the Charging-State chip, in web source
 * order. Derives the render-ready cells once via the pure [EnergyChargingPanelProjection.content].
 */
@Composable
private fun EnergyChargingLoaded(
    snapshot: ChargingTelemetrySnapshot,
    prefs: EnergyChargingDisplayPrefs,
    strings: EnergyChargingStrings,
) {
    val content = remember(snapshot, prefs, strings) { EnergyChargingPanelProjection.content(snapshot, prefs, strings) }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricTileView(tile = content.voltage, modifier = Modifier.weight(1f))
            MetricTileView(tile = content.current, modifier = Modifier.weight(1f))
        }
        DetailRowView(row = content.power)
        DetailRowView(row = content.energyAdded)
        ChargingStateRowView(row = content.chargingState)
        DetailRowView(row = content.batteryLevel)
        DetailRowView(row = content.chargeRate, leadingIcon = DataDisplayGlyphs.Bolt)
    }
}

/** One top-grid MetricCard — the web `<MetricCard label value subtitle />` (subtitle = the V / A unit symbol). */
@Composable
private fun MetricTileView(
    tile: EnergyChargingMetricTile,
    modifier: Modifier = Modifier,
) {
    MetricCard(label = tile.label, value = tile.value, subtitle = tile.unit, modifier = modifier)
}

/**
 * One label/value row — the muted label (with an optional [leadingIcon], e.g. the Charge-Rate Zap) on the left and
 * the primary value on the right, the whole row merged into a single TalkBack node so it is announced as one fact
 * (web `flex justify-between`).
 */
@Composable
private fun DetailRowView(
    row: EnergyChargingDetailRow,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
) {
    val description = EnergyChargingPanelProjection.accessibilityLabel(row.label, row.value)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (leadingIcon != null) {
                Icon(leadingIcon, contentDescription = null, size = ROW_ICON_SIZE)
            }
            Caption(row.label)
        }
        BodyText(row.value)
    }
}

/**
 * The Charging-State row — its muted label and the colored status [Badge]. The whole row is merged into one TalkBack
 * node ("Charging State: Charging") so the chip's semantic state is announced with its label rather than as a bare
 * color. The chip color maps the semantic [ChargingStateKind] onto the shared [Badge] variants.
 */
@Composable
private fun ChargingStateRowView(
    row: EnergyChargingStateRow,
    modifier: Modifier = Modifier,
) {
    val description = EnergyChargingPanelProjection.accessibilityLabel(row.label, row.text)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(row.label)
        Badge(text = row.text, variant = badgeVariant(row.kind))
    }
}

/** Maps the semantic [ChargingStateKind] onto a shared [BadgeVariant] (web cyan / green / gray chip branch). */
private fun badgeVariant(kind: ChargingStateKind): BadgeVariant =
    when (kind) {
        ChargingStateKind.Charging -> BadgeVariant.Info
        ChargingStateKind.Complete -> BadgeVariant.Success
        ChargingStateKind.Other -> BadgeVariant.Neutral
    }

/** The loading affordance: two card blocks over five label/value bars, matching the resolved layout shape. */
@Composable
private fun EnergyChargingSkeleton() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
    }
    repeat(SKELETON_ROW_COUNT) {
        Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
    }
}

/**
 * Panel-level empty state — web parity for the absent `chargingTelemetry` prop: the no-data message under a
 * BatteryCharging glyph, so the panel never collapses to a blank box. [EmptyState] exposes the message as its
 * accessibility label.
 */
@Composable
private fun EnergyChargingEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.BatteryCharging,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun EnergyChargingError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [EnergyChargingStrings] from the i18n catalog (P1/S10): the `telemetry.*` + `common.unknown`
 * keys the web component reads, plus the (resource-backed) `kW` / `kWh` unit words it passes to `fmtWithUnit`.
 * Resolved once at the Compose boundary so the rest of the surface holds no English literal.
 */
@Composable
private fun rememberEnergyChargingStrings(): EnergyChargingStrings {
    val title = stringResource(R.string.translation_telemetry_energyCharging)
    val chargerVoltage = stringResource(R.string.translation_telemetry_chargerVoltage)
    val chargerCurrent = stringResource(R.string.translation_telemetry_chargerCurrent)
    val chargerPower = stringResource(R.string.translation_telemetry_chargerPower)
    val energyAdded = stringResource(R.string.translation_telemetry_energyAdded)
    val chargingState = stringResource(R.string.translation_telemetry_chargingState)
    val batteryLevel = stringResource(R.string.translation_telemetry_batteryLevel)
    val chargeRate = stringResource(R.string.translation_telemetry_chargeRate)
    val unknown = stringResource(R.string.translation_common_unknown)
    val noData = stringResource(R.string.translation_telemetry_noChargingTelemetry)
    val kw = stringResource(R.string.translation_kW)
    val kwh = stringResource(R.string.translation_kWh)
    return remember(
        title,
        chargerVoltage,
        chargerCurrent,
        chargerPower,
        energyAdded,
        chargingState,
        batteryLevel,
        chargeRate,
        unknown,
        noData,
        kw,
        kwh,
    ) {
        EnergyChargingStrings(
            title = title,
            chargerVoltage = chargerVoltage,
            chargerCurrent = chargerCurrent,
            chargerPower = chargerPower,
            energyAdded = energyAdded,
            chargingState = chargingState,
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            unknown = unknown,
            noData = noData,
            kw = kw,
            kwh = kwh,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only concern
 * the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberEnergyChargingFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH_FRESHNESS
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
    EnergyChargingStrings(
        title = "Energy & Charging",
        chargerVoltage = "Charger Voltage",
        chargerCurrent = "Charger Current",
        chargerPower = "Charger Power",
        energyAdded = "Energy Added",
        chargingState = "Charging State",
        batteryLevel = "Battery Level",
        chargeRate = "Charge Rate",
        unknown = "Unknown",
        noData = "No charging telemetry available",
        kw = "kW",
        kwh = "kWh",
    )

private val PREVIEW_SNAPSHOT =
    ChargingTelemetrySnapshot(
        chargerVoltage = 238.0,
        chargerActualCurrent = 16.0,
        chargerPowerW = 11_000.0,
        chargeEnergyAddedWh = 8_450.0,
        chargingState = "Charging",
        batteryLevel = 72.0,
        rangeAddedMetersPerHour = 48_000.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun EnergyChargingPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergyChargingPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = EnergyChargingDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun EnergyChargingPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergyChargingPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = EnergyChargingDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun EnergyChargingPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergyChargingPanelContent(
            state = UiState(phase = UiPhase.Empty, data = null),
            onRetry = {},
            prefs = EnergyChargingDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun EnergyChargingPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergyChargingPanelContent(
            state = UiState(phase = UiPhase.Error, data = null, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = EnergyChargingDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun EnergyChargingPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergyChargingPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = EnergyChargingDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
