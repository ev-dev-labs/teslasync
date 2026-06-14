// The native Jetpack Compose + Material 3 IngestXRayPage admin surface — a parity port of
// web/src/features/admin/pages/IngestXRayPage.tsx, the per-vehicle telemetry-ingest diagnostic. It reproduces
// the page's four panels (the controls bar, the no-vehicle empty panel, the bucketed sample-count chart, and the
// per-field statistics table) plus the aggregate header strip, every data state (loading / empty / error /
// content, and the cache-then-network stale/offline tiers each panel adds), and every visible string (resolved
// from the generated res/values catalog, ADR-014).
//
// Composition: [IngestXRayPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the two feeds + the interaction snapshot);
// [IngestXRayPageContent] is the stateless render layer. The four A3 sub-views (XRayControls / XRayHeader /
// XRayBucketChart / XRayFieldsTable) own each panel's render + state matrix; this page wires the selection,
// fans the single X-Ray feed out into the header/chart/fields slices (IngestXRayPageModel.deriveData), and adds
// the page chrome (title + subtitle + the "Field statistics" panel header). All derivation lives in the
// framework-free model (IngestXRayPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.ingestxray

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.xraybucketchart.XRayBucketChart
import io.teslasync.android.featureviews.xraycontrols.IngestXRayBucket as ControlsBucket
import io.teslasync.android.featureviews.xraycontrols.IngestXRayWindow as ControlsWindow
import io.teslasync.android.featureviews.xraycontrols.XRayControls
import io.teslasync.android.featureviews.xraycontrols.XRayVehicle
import io.teslasync.android.featureviews.xrayfieldstable.XRayFieldsTable
import io.teslasync.android.featureviews.xrayheader.XRayHeader
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** The page's interaction callbacks, wired to the [IngestXRayPageViewModel] (web event handlers). */
data class IngestXRayActions(
    val onVehicle: (Long?) -> Unit,
    val onWindow: (ControlsWindow) -> Unit,
    val onBucket: (ControlsBucket) -> Unit,
    val onRetry: () -> Unit,
    val onRetryVehicles: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [IngestXRayPageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Ingest-X-Ray holders via [ingestXRaySourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun IngestXRayPage(
    source: IngestXRaySource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: IngestXRayPageViewModel =
        viewModel(
            key = IngestXRayPageRegistration.SLUG,
            factory = viewModelFactory { initializer { IngestXRayPageViewModel(source, logger) } },
        )
    IngestXRayPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun IngestXRayPage(
    viewModel: IngestXRayPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val xrayState by viewModel.xrayState.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            IngestXRayActions(
                onVehicle = viewModel::setVehicle,
                onWindow = viewModel::setWindow,
                onBucket = viewModel::setBucket,
                onRetry = viewModel::retry,
                onRetryVehicles = viewModel::refreshVehicles,
            )
        }

    IngestXRayPageContent(
        interaction = interaction,
        vehiclesState = vehiclesState,
        xrayState = xrayState,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle), the controls panel, then either the no-vehicle empty
 * panel (web `vehicleId === null`) or the loaded surface — the aggregate header strip, the bucket chart, and the
 * field-statistics table. The single X-Ray feed is fanned out into each sub-view's slice via [deriveData], so a
 * still-loading or failed feed renders every panel's own loading / error-retry state and a loaded response drives
 * each panel's content/empty independently.
 */
@Composable
fun IngestXRayPageContent(
    interaction: XRayInteraction,
    vehiclesState: UiState<List<XRayVehicle>>,
    xrayState: UiState<IngestXRayResponse>,
    actions: IngestXRayActions,
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
        IngestXRayHeader()

        // Panel 1 — the controls bar (vehicle picker + window + bucket).
        FadeIn {
            GlassPanel(padding = PanelPadding.Md) {
                XRayControls(
                    vehiclesState = vehiclesState,
                    vehicleId = interaction.vehicleId,
                    windowSel = interaction.window,
                    bucketSel = interaction.bucket,
                    onVehicleChange = actions.onVehicle,
                    onWindowChange = actions.onWindow,
                    onBucketChange = actions.onBucket,
                    onRetry = actions.onRetryVehicles,
                )
            }
        }

        if (!interaction.hasVehicle) {
            // Panel 2 — the "select a vehicle" empty state (web `vehicleId === null`).
            FadeIn(delayMs = FADE_STEP_MS) {
                GlassPanel(padding = PanelPadding.Md) {
                    EmptyState(
                        title = stringResource(R.string.translation_admin_xray_noVehicle_title),
                        message = stringResource(R.string.translation_admin_xray_noVehicle_message),
                    )
                }
            }
        } else {
            // Aggregate header strip — three StatCards (web `<XRayHeader>`).
            FadeIn(delayMs = FADE_STEP_MS) {
                XRayHeader(
                    state = xrayState.deriveData({ it.toSummary() }, { it.totalSamples <= 0L }),
                    window = interaction.window.toHeaderWindow(),
                    onRetry = actions.onRetry,
                )
            }

            // Panel 3 — the bucketed sample-count chart (web `<XRayBucketChart>`).
            FadeIn(delayMs = FADE_STEP_MS * 2) {
                XRayBucketChart(
                    state = xrayState.deriveData({ it.toBucketPoints() }, { it.isEmpty() }),
                    onRetry = actions.onRetry,
                )
            }

            // Panel 4 — the per-field statistics table, under its "Field statistics" header.
            FadeIn(delayMs = FADE_STEP_MS * 3) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    FieldStatisticsTitle()
                    XRayFieldsTable(
                        state = xrayState.deriveData({ it.toFieldStats() }, { it.isEmpty() }),
                        onRetry = actions.onRetry,
                    )
                }
            }
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun IngestXRayHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_xray_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_xray_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The "Field statistics" panel header — the web `<Activity/> <PanelTitle>` row above the table. */
@Composable
private fun FieldStatisticsTitle() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = IngestXRayGlyphs.Activity,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            size = IconSize.Md,
        )
        PanelTitle(stringResource(R.string.translation_admin_xray_panels_fields))
    }
}
