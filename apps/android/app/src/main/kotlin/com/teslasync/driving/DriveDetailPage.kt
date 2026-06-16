// The native Jetpack Compose + Material 3 DriveDetailPage driving surface — a parity port of
// web/src/features/driving/pages/DriveDetailPage.tsx, the `/drives/:id` detail route. It reproduces the page's
// chrome (the `driveDetail.title` heading), every data state the bound state holder carries (loading skeleton /
// hard-error retry / loaded content), and — through [DriveDetailLoaded] (DriveDetailPageSections.kt) — every
// section the web page stacks, each wrapped in a `SectionErrorBoundary` carrying its localized failure title so a
// single failing section never blanks the page. Every visible string resolves from the generated res/values
// catalog (ADR-014); SI values are formatted at the display boundary via the shared [UnitFormatter] (P1/S5).
//
// Composition: [DriveDetailPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the drive state + the resolved vehicle name + the live
// formatter); [DriveDetailPageContent] is the stateless render layer that switches loading / error / content.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivedetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DriveDetailPageViewModel] over the supplied [source] (the host wires the
 * page-local drive repository + the shared Vehicles holder + the live unit formatter) for the [driveId] route
 * argument. [logger] defaults to the app's redacting logger. The view-model is keyed by the drive id so
 * navigating between drives binds a fresh holder.
 */
@Composable
fun DriveDetailPage(
    source: DriveDetailPageSource,
    driveId: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DriveDetailPageViewModel =
        viewModel(
            key = "${DriveDetailPageRegistration.SLUG}:$driveId",
            factory = viewModelFactory { initializer { DriveDetailPageViewModel(source, driveId, logger) } },
        )
    DriveDetailPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] drive state + resolved vehicle name + live formatter to the content. */
@Composable
fun DriveDetailPage(
    viewModel: DriveDetailPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val vehicleName by viewModel.vehicleName.collectAsStateWithLifecycle()
    val formatter by viewModel.formatter.collectAsStateWithLifecycle()

    DriveDetailPageContent(
        state = state,
        vehicleName = vehicleName,
        formatter = formatter,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (nothing cached) renders the full-page skeleton (web
 * `DriveDetailSkeleton`); otherwise the page title is drawn, then the hard-error retry surface (web
 * `PageContainer` error prop) or the loaded content (web `{drive && stats && …}` — [DriveDetailLoaded]).
 */
@Composable
fun DriveDetailPageContent(
    state: UiState<Drive>,
    vehicleName: String?,
    formatter: UnitFormatter,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state.isLoading) {
        DriveDetailLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_driveDetail_title))

        val drive = state.data
        if (state.isError || drive == null) {
            DriveDetailError(onRetry = onRetry)
        } else {
            DriveDetailLoaded(drive = drive, vehicleName = vehicleName, formatter = formatter)
        }
    }
}

/**
 * The full-page loading skeleton (web `DriveDetailSkeleton`): the header, the hero-gauge row, the overview chart
 * block, the stat-card row, and two deep-dive chart blocks — so no region flashes blank while the first load is
 * in flight.
 */
@Composable
private fun DriveDetailLoading(modifier: Modifier = Modifier) {
    FadeIn {
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            PageHeaderSkeleton()
            StatGridSkeleton(count = HERO_SKELETON_TILES)
            ChartBlockSkeleton(height = 220.dp)
            StatGridSkeleton(count = STAT_SKELETON_TILES)
            ChartBlockSkeleton(height = 200.dp)
            ChartBlockSkeleton(height = 200.dp)
        }
    }
}

/** The hard-error surface for the drive feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun DriveDetailError(onRetry: () -> Unit) {
    FadeIn {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

/** Tile count for the hero-gauge loading skeleton (web distance / duration / avg-speed / max-speed gauges). */
private const val HERO_SKELETON_TILES = 4

/** Tile count for the stat-card loading skeleton row. */
private const val STAT_SKELETON_TILES = 4
