// The native Jetpack Compose + Material 3 VehicleConfigSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx. The web component is purely
// presentational: the Vehicle Detail page holds the config + vehicle-state queries and passes a
// `vehicleConfig: VehicleConfigSnapshot | null | undefined` plus a `softwareVersion` scalar down, and the
// component renders a single glass panel — a "Vehicle Configuration" header (a `Settings` gear glyph + title)
// over a two-column definition list of twelve config rows — falling back to a loading `Skeleton` while
// `vehicleConfig` is still null.
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hook is `useTranslation` (mapped to the i18n catalog, P1/S10). The host supplies the decoded
// config through the shared state-holder layer as a [UiState], so this feature view also renders every
// lifecycle state that layer can carry — a loading skeleton, a hard error with retry, a friendly empty body,
// content, and the stale/offline ("last known") freshness chip — without ever fetching. A web-parity overload
// that takes the raw `vehicleConfig` + `softwareVersion` props is also provided, mirroring the web component's
// `{ vehicleConfig, softwareVersion }` signature.
//
// Every derivation flows through the pure [VehicleConfigSectionProjection]; the composable is a thin render
// layer that resolves the i18n labels (P1/S10) and draws the rows through the shared `KVList` (the web
// `KVList`), so the surface never hand-rolls a row or imports a chart library. The header gear is the locally
// authored [VehicleConfigSectionGlyphs.Settings] (the web's lucide `Settings`), tinted with the brand primary
// (the native expression of the web `text-[var(--neon-cyan)]`). The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleConfigSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleconfigsection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Number of skeleton rows drawn in the loading phase (the web panel has twelve rows). */
private const val SKELETON_ROWS = 6

/** Height of one loading-skeleton row. */
private val SKELETON_ROW_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point for the vehicle-configuration panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the host's feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [VehicleConfigData] (web `vehicleConfig`).
 * @param softwareVersion the web `softwareVersion` prop — the Software row's fallback when the config carries none.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleConfigSection(
    state: UiState<VehicleConfigData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    softwareVersion: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { VehicleConfigSectionDiagnostics.recordViewOpened(logger) }
    VehicleConfigSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        softwareVersion = softwareVersion,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ vehicleConfig, softwareVersion }` props (plus an
 * explicit [isLoading] for the host's first load). Projects the prop onto a [UiState] via
 * [VehicleConfigSectionProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened`. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun VehicleConfigSection(
    vehicleConfig: VehicleConfigData?,
    modifier: Modifier = Modifier,
    softwareVersion: String? = null,
    isLoading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(vehicleConfig, isLoading) { VehicleConfigSectionProjection.projectUiState(vehicleConfig, isLoading) }
    VehicleConfigSection(
        state = state,
        onRetry = {},
        modifier = modifier,
        softwareVersion = softwareVersion,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's panel (the "Vehicle Configuration" header over the label/value definition list) and adds the
 * lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface, a friendly empty
 * body, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [softwareVersion] is the web `softwareVersion` prop fed into the
 * Software row's fallback chain.
 */
@Composable
fun VehicleConfigSectionContent(
    state: UiState<VehicleConfigData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    softwareVersion: String? = null,
    strings: VehicleConfigSectionStrings = rememberVehicleConfigSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            VehicleConfigHeader(
                title = strings.title,
                freshness =
                    if (state.stale || state.refreshing || state.hasError) {
                        { VehicleConfigFreshnessChip(state) }
                    } else {
                        null
                    },
            )
            val config = state.data
            when {
                state.isLoading -> VehicleConfigLoading()
                state.isError -> VehicleConfigError(onRetry = onRetry)
                config == null -> EmptyState(message = strings.noData, modifier = Modifier.fillMaxWidth())
                else -> VehicleConfigRows(config = config, softwareVersion = softwareVersion, strings = strings)
            }
        }
    }
}

/**
 * The panel header — the web `flex items-center gap-2` row of the `Settings` gear glyph and the title, with an
 * optional freshness chip pushed to the trailing edge. The gear is decorative (the title carries the meaning),
 * so it is rendered with a `null` content description and tinted with the brand primary (the native expression
 * of the web `text-[var(--neon-cyan)]`).
 */
@Composable
private fun VehicleConfigHeader(
    title: String,
    freshness: (@Composable () -> Unit)?,
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
                VehicleConfigSectionGlyphs.Settings,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.primary,
            )
            SectionTitle(title)
        }
        if (freshness != null) freshness()
    }
}

/** The web `KVList` definition list — every projected row rendered through the shared `KVList`. */
@Composable
private fun VehicleConfigRows(
    config: VehicleConfigData,
    softwareVersion: String?,
    strings: VehicleConfigSectionStrings,
) {
    val items =
        remember(config, softwareVersion, strings) {
            VehicleConfigSectionProjection
                .rows(config, softwareVersion, strings)
                .map { KVItem(it.label, it.value) }
        }
    KVList(items = items, modifier = Modifier.fillMaxWidth())
}

/** The loading branch: skeleton rows so the panel never collapses to a blank box (the web `Skeleton`). */
@Composable
private fun VehicleConfigLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun VehicleConfigError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The "refreshing / stale / offline" freshness chip rendered in the header's trailing edge. */
@Composable
private fun VehicleConfigFreshnessChip(state: UiState<VehicleConfigData>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberVehicleConfigFreshnessFormatter(),
    )
}

/**
 * Builds the localized [VehicleConfigSectionStrings] from the i18n catalog (P1/S10): the panel title, the
 * twelve `vehicles.detail.*` row labels the web component reads through `useTranslation`, the shared Yes/No
 * words for the three boolean rows, and the shared no-data key for the empty body. Resolved once at the
 * Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberVehicleConfigSectionStrings(): VehicleConfigSectionStrings {
    val title = stringResource(R.string.translation_vehicles_detail_vehicleConfig)
    val carType = stringResource(R.string.translation_vehicles_detail_carType)
    val trim = stringResource(R.string.translation_vehicles_detail_trim)
    val exteriorColor = stringResource(R.string.translation_vehicles_detail_color)
    val wheels = stringResource(R.string.translation_vehicles_detail_wheels)
    val roofColor = stringResource(R.string.translation_vehicles_detail_roofColor)
    val chargePort = stringResource(R.string.translation_vehicles_detail_chargePort)
    val rightHandDrive = stringResource(R.string.translation_vehicles_detail_rhd)
    val europeVehicle = stringResource(R.string.translation_vehicles_detail_europeVehicle)
    val offroadLightbar = stringResource(R.string.translation_vehicles_detail_offroadLightbar)
    val rearSeatHeaters = stringResource(R.string.translation_vehicles_detail_rearSeatHeaters)
    val sunroof = stringResource(R.string.translation_vehicles_detail_sunroofInstalled)
    val software = stringResource(R.string.translation_vehicles_detail_softwareVersion)
    val yes = stringResource(R.string.translation_common_yes)
    val no = stringResource(R.string.translation_common_no)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(
        title,
        carType,
        trim,
        exteriorColor,
        wheels,
        roofColor,
        chargePort,
        rightHandDrive,
        europeVehicle,
        offroadLightbar,
        rearSeatHeaters,
        sunroof,
        software,
        yes,
        no,
        noData,
    ) {
        VehicleConfigSectionStrings(
            title = title,
            carType = carType,
            trim = trim,
            exteriorColor = exteriorColor,
            wheels = wheels,
            roofColor = roofColor,
            chargePort = chargePort,
            rightHandDrive = rightHandDrive,
            europeVehicle = europeVehicle,
            offroadLightbar = offroadLightbar,
            rearSeatHeaters = rearSeatHeaters,
            sunroof = sunroof,
            software = software,
            yes = yes,
            no = no,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberVehicleConfigFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; each @Preview exercises a rendered branch) ───────────────────────────────────

/** The English strings used by the previews (the catalog values, inlined so previews need no resources). */
private val PREVIEW_STRINGS =
    VehicleConfigSectionStrings(
        title = "Vehicle Configuration",
        carType = "Car Type",
        trim = "Trim",
        exteriorColor = "Exterior Color",
        wheels = "Wheels",
        roofColor = "Roof Color",
        chargePort = "Charge Port",
        rightHandDrive = "Right-Hand Drive",
        europeVehicle = "Europe Vehicle",
        offroadLightbar = "Offroad Lightbar",
        rearSeatHeaters = "Rear Seat Heaters",
        sunroof = "Sunroof",
        software = "Software",
        yes = "Yes",
        no = "No",
        noData = "No data available",
    )

/** A fully-populated config — exercises every row including the three Yes/No boolean rows. */
private val PREVIEW_CONFIG =
    VehicleConfigData(
        carType = "Model S",
        trim = "P100D",
        exteriorColor = "Midnight Silver",
        wheelType = "Arachnid",
        roofColor = "Glass",
        chargePort = "US",
        rightHandDrive = false,
        europeVehicle = false,
        offroadLightbarPresent = false,
        rearSeatHeaters = "1",
        sunroofInstalled = "None",
        softwareUpdateVersion = "2026.8.1",
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun VehicleConfigSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleConfigSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_CONFIG),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun VehicleConfigSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleConfigSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun VehicleConfigSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleConfigSectionContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun VehicleConfigSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleConfigSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (stale cached)", showBackground = true)
@Composable
private fun VehicleConfigSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleConfigSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_CONFIG,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
