// The native Jetpack Compose + Material 3 VehicleDetailPage vehicles surface — a parity port of
// web/src/features/vehicles/pages/VehicleDetailPage.tsx, the per-vehicle detail surface reached from `/vehicles/:id`.
// It reproduces the page-file orchestration the web source owns: the resilient header (the vehicle name + the wake
// command + the live-freshness chip), the GlassPanel1 state fallback (web `{!state ? <GlassPanel className="p-8">
// <Skeleton lines={5}/></GlassPanel> : …}`), every data state (loading skeleton / error-retry / empty / content, plus
// the cache-then-network stale/offline tier the bound state holder carries), the 16 `SectionErrorBoundary` resilience
// boundaries with their localized fallback titles (web L195-263), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// This unit's declared data source is the per-vehicle settings resolver (web `useVehicleSettings` + `findEffectiveSetting`,
// the manifest's `dataSources`), so the Settings section binds and renders the real per-key effective rows (the
// `VehicleSettingsTab` analogue: label + value + the override/user/vehicle/default source pill); the nickname override
// drives the page title. The remaining sections' dedicated per-section reads (vehicle state / motor / climate / …) are
// separate parity concerns not declared for this unit, so — exactly as the web sub-components do for a null payload —
// each renders its localized section title + its own empty surface inside its error boundary. No region ever blanks.
//
// Composition: [VehicleDetailPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the settings feed + the effective name + the display preferences +
// the wake-busy flag, and surfaces the wake toast); [VehicleDetailPageContent] is the stateless render layer. Settings
// values are tokens / free text (the `mute_until` timestamp is locale-formatted at the render boundary via the model's
// [VehicleDetailDisplayPrefs]); there is no SI quantity on this surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)

package io.teslasync.android.vehicles.vehicledetail

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Per-section entrance-fade stagger (web `FadeIn delay` cascade), in ms per ordinal. */
private const val FADE_STEP_MS = 40

/** The GlassPanel1 loading fallback mirrors the web `<Skeleton lines={5} />`. */
private const val GLASS_PANEL1_SKELETON_LINES = 5

/** The page's interaction callbacks, wired to the [VehicleDetailPageViewModel] (web event handlers). */
data class VehicleDetailActions(
    val onWake: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [VehicleDetailPageViewModel] over the supplied [source] (the host wires the shared
 * resilient client + settings holder via [vehicleDetailPageSourceOf]) for the route [vehicleId]. [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun VehicleDetailPage(
    source: VehicleDetailPageSource,
    vehicleId: Long,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: VehicleDetailPageViewModel =
        viewModel(
            key = "${VehicleDetailPageRegistration.SLUG}:$vehicleId",
            factory = viewModelFactory { initializer { VehicleDetailPageViewModel(source, vehicleId, logger) } },
        )
    VehicleDetailPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] settings feed + derived name + display prefs to the stateless content. */
@Composable
fun VehicleDetailPage(
    viewModel: VehicleDetailPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.settingsState.collectAsStateWithLifecycle()
    val effectiveName by viewModel.effectiveName.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val waking by viewModel.waking.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(viewModel, context) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                snackbarHostState.showSnackbar(resolveWakeMessage(context, event.messageKey))
            }
        }
    }

    val actions =
        remember(viewModel) {
            VehicleDetailActions(onWake = viewModel::wake, onRetry = viewModel::retry)
        }

    VehicleDetailPageContent(
        state = state,
        effectiveName = effectiveName,
        prefs = prefs,
        waking = waking,
        actions = actions,
        snackbarHostState = snackbarHostState,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the always-present header, then the state-driven body (web `{!state ? GlassPanel1 :
 * sections}`): a first load with nothing decoded shows the GlassPanel1 skeleton; a hard failure with no cache shows the
 * GlassPanel1 retry surface; otherwise the 15 content sections render (the Settings section carries the real bound
 * data, the others their localized empty surfaces). The wake toast is hosted at the bottom.
 */
@Composable
fun VehicleDetailPageContent(
    state: UiState<VehicleSettings>,
    effectiveName: String?,
    prefs: VehicleDetailDisplayPrefs,
    waking: Boolean,
    actions: VehicleDetailActions,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            VehicleDetailHeaderSection(
                state = state,
                effectiveName = effectiveName,
                waking = waking,
                onWake = actions.onWake,
            )

            when {
                state.isLoading -> VehicleDetailGlassPanel1(loading = true, onRetry = actions.onRetry)
                state.isError && !state.hasData -> VehicleDetailGlassPanel1(loading = false, onRetry = actions.onRetry)
                else -> VehicleDetailSections(settings = state.data, prefs = prefs)
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.md),
        )
    }
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The header section (web L195-206, `SectionErrorBoundary name="vehicle-detail:header"`): the effective vehicle name
 * (the `nickname` override, else the localized page title), the live-freshness chip over the settings feed, and the
 * wake command button (web `VehicleHeader onWake`).
 */
@Composable
private fun VehicleDetailHeaderSection(
    state: UiState<VehicleSettings>,
    effectiveName: String?,
    waking: Boolean,
    onWake: () -> Unit,
) {
    val boundary = rememberErrorBoundaryState()
    val headerLabel = effectiveName ?: stringResource(R.string.translation_vehicles_detail_title)
    SectionErrorBoundary(
        state = boundary,
        title = stringResource(R.string.translation_vehicles_detail_section_headerFailed),
    ) {
        FadeIn {
            Row(
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = headerLabel },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    PageTitle(headerLabel)
                }
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    DataFreshness(
                        updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
                        isFetching = state.refreshing,
                        isStale = state.stale,
                        isError = state.hasError,
                        compact = true,
                    )
                    Button(
                        label = stringResource(R.string.translation_common_wakeUp),
                        onClick = onWake,
                        variant = ButtonVariant.Secondary,
                        size = ButtonSize.Sm,
                        loading = waking,
                    )
                }
            }
        }
    }
}

// ── GlassPanel1 (the web `!state` fallback) ────────────────────────────────────────────────────────────────

/**
 * GlassPanel1 — the web `{!state ? <GlassPanel className="p-8"> … </GlassPanel>}` state-fallback panel. While the
 * settings feed is still loading (with nothing cached) it holds the five-line skeleton (web `<Skeleton lines={5} />`);
 * on a hard failure with no cache it holds the retry surface (web `PageContainer error`).
 */
@Composable
private fun VehicleDetailGlassPanel1(
    loading: Boolean,
    onRetry: () -> Unit,
) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            if (loading) {
                SkeletonLines(lines = GLASS_PANEL1_SKELETON_LINES)
            } else {
                ErrorDisplay(
                    message = stringResource(R.string.translation_common_noData),
                    onRetry = onRetry,
                    retryLabel = stringResource(R.string.translation_common_retry),
                )
            }
        }
    }
}

// ── Content sections ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The web content cascade (L216-263): the 15 `SectionErrorBoundary`-wrapped sections rendered once the settings feed
 * resolves. The Settings section binds this unit's declared data source; every other section renders its localized
 * title + empty surface inside its boundary (its dedicated read is a separate parity concern), so no region blanks.
 */
@Composable
private fun VehicleDetailSections(
    settings: VehicleSettings?,
    prefs: VehicleDetailDisplayPrefs,
) {
    VEHICLE_DETAIL_CONTENT_SECTIONS.forEachIndexed { index, section ->
        key(section) {
            val boundary = rememberErrorBoundaryState()
            FadeIn(delayMs = FADE_STEP_MS * (index + 1)) {
                SectionErrorBoundary(
                    state = boundary,
                    title = stringResource(sectionFailedTitleRes(section)),
                ) {
                    if (section == VehicleDetailSection.Settings) {
                        VehicleDetailSettingsSection(settings = settings, prefs = prefs)
                    } else {
                        VehicleDetailInfoSection(section = section)
                    }
                }
            }
        }
    }
}

/**
 * The per-vehicle Settings section (web `VehicleSettingsTab`) — the real bound data: one row per resolved key with its
 * humanized label, its formatted effective value, and the resolver-source pill (override / user / vehicle / default).
 * An empty resolver payload renders the localized empty surface.
 */
@Composable
private fun VehicleDetailSettingsSection(
    settings: VehicleSettings?,
    prefs: VehicleDetailDisplayPrefs,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SectionTitle(stringResource(R.string.translation_nav_settings))
            val rows = settings?.settings.orEmpty()
            if (rows.isEmpty()) {
                EmptyState(message = stringResource(R.string.translation_common_noData))
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    rows.forEach { setting ->
                        key(setting.key) {
                            VehicleSettingRow(setting = setting, prefs = prefs)
                        }
                    }
                }
            }
        }
    }
}

/** One resolved setting row — humanized label + formatted value + the resolver-source [Badge] pill. */
@Composable
private fun VehicleSettingRow(
    setting: EffectiveSetting,
    prefs: VehicleDetailDisplayPrefs,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FieldLabelText(humanizeKey(setting.key))
            BodyText(displaySettingValue(setting, prefs))
        }
        Badge(text = settingSourceLabel(setting), variant = sourceBadgeVariant(setting.source))
    }
}

/**
 * A non-Settings detail section (web `BatteryRangePanel` / `MotorSection` / …): its localized section title plus the
 * section's own localized empty surface (the same message the web sub-component shows for a null payload), since its
 * dedicated read is a separate parity concern not declared for this unit.
 */
@Composable
private fun VehicleDetailInfoSection(section: VehicleDetailSection) {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            sectionTitleRes(section)?.let { titleRes -> SectionTitle(stringResource(titleRes)) }
            EmptyState(message = stringResource(sectionEmptyRes(section)))
        }
    }
}

// ── String + variant mapping (render boundary, ADR-014) ───────────────────────────────────────────────────────

/** The localized `SectionErrorBoundary` fallback title for each section (web `fallbackTitle`). */
private fun sectionFailedTitleRes(section: VehicleDetailSection): Int =
    when (section) {
        VehicleDetailSection.Header -> R.string.translation_vehicles_detail_section_headerFailed
        VehicleDetailSection.BatteryRange -> R.string.translation_vehicles_detail_section_batteryRangeFailed
        VehicleDetailSection.LiveState -> R.string.translation_vehicles_detail_section_liveStateFailed
        VehicleDetailSection.QuickStats -> R.string.translation_vehicles_detail_section_quickStatsFailed
        VehicleDetailSection.Motor -> R.string.translation_vehicles_detail_section_motorFailed
        VehicleDetailSection.Climate -> R.string.translation_vehicles_detail_section_climateFailed
        VehicleDetailSection.Security -> R.string.translation_vehicles_detail_section_securityFailed
        VehicleDetailSection.Tire -> R.string.translation_vehicles_detail_section_tireFailed
        VehicleDetailSection.ChargingTelemetry -> R.string.translation_vehicles_detail_section_chargingTelemetryFailed
        VehicleDetailSection.BatteryCharts -> R.string.translation_vehicles_detail_section_batteryChartsFailed
        VehicleDetailSection.RecentDrives -> R.string.translation_vehicles_detail_section_recentDrivesFailed
        VehicleDetailSection.RecentCharges -> R.string.translation_vehicles_detail_section_recentChargesFailed
        VehicleDetailSection.VehicleConfig -> R.string.translation_vehicles_detail_section_vehicleConfigFailed
        VehicleDetailSection.AiPaintPreview -> R.string.translation_vehicles_detail_section_aiPaintPreviewFailed
        VehicleDetailSection.QuickLinks -> R.string.translation_vehicles_detail_section_quickLinksFailed
        VehicleDetailSection.Settings -> R.string.translation_vehicles_detail_section_settingsFailed
    }

/** The localized normal section title, where the web sub-component carries one; `null` renders no heading. */
private fun sectionTitleRes(section: VehicleDetailSection): Int? =
    when (section) {
        VehicleDetailSection.BatteryRange -> R.string.translation_vehicles_detail_batteryOverview
        VehicleDetailSection.Motor -> R.string.translation_vehicles_detail_motor
        VehicleDetailSection.Climate -> R.string.translation_vehicles_detail_climate
        VehicleDetailSection.Security -> R.string.translation_vehicles_detail_security
        VehicleDetailSection.Tire -> R.string.translation_vehicles_detail_tirePressure
        VehicleDetailSection.ChargingTelemetry -> R.string.translation_vehicles_detail_chargingTelemetry
        VehicleDetailSection.BatteryCharts -> R.string.translation_vehicles_detail_driveTrend
        VehicleDetailSection.VehicleConfig -> R.string.translation_vehicles_detail_vehicleConfig
        VehicleDetailSection.QuickLinks -> R.string.translation_vehicles_detail_quickLinks
        else -> null
    }

/** The localized empty-state message each section shows when it has no in-scope payload (web sub-component empty). */
private fun sectionEmptyRes(section: VehicleDetailSection): Int =
    when (section) {
        VehicleDetailSection.Motor -> R.string.translation_vehicles_detail_noMotorData
        VehicleDetailSection.Climate -> R.string.translation_vehicles_detail_noClimateData
        VehicleDetailSection.Security -> R.string.translation_vehicles_detail_noSecurityData
        VehicleDetailSection.Tire -> R.string.translation_vehicles_detail_noTireData
        VehicleDetailSection.ChargingTelemetry -> R.string.translation_vehicles_detail_noChargingTelemetry
        VehicleDetailSection.BatteryCharts -> R.string.translation_vehicles_detail_noDriveData
        else -> R.string.translation_common_noData
    }

/** Maps a resolver source token to its [Badge] tone (override stands out; the rest are neutral/info). */
private fun sourceBadgeVariant(source: String): BadgeVariant =
    when (source) {
        "override" -> BadgeVariant.Success
        "user" -> BadgeVariant.Info
        "vehicle" -> BadgeVariant.Info
        else -> BadgeVariant.Neutral
    }

/** Resolves a wake [UiEvent.Message] key to its localized toast text (web `toast.success`/`toast.error`). */
private fun resolveWakeMessage(
    context: Context,
    key: String,
): String =
    when (key) {
        VehicleDetailPageRegistration.WAKE_SUCCESS_KEY ->
            context.getString(R.string.translation_vehicles_detail_wakeSuccess)
        else ->
            context.getString(R.string.translation_vehicles_detail_wakeFailed)
    }
