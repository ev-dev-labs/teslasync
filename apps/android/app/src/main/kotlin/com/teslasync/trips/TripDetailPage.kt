// The native Jetpack Compose + Material 3 TripDetailPage trips surface — a parity port of
// web/src/features/trips/pages/TripDetailPage.tsx, the single-trip summary. It reproduces the page's chrome
// (PageContainer: title + name/`Trip #id` subtitle + breadcrumb override + loading/error states), the four
// summary StatCards (distance, energy-used, efficiency, cost), the GlassPanel KVList (trip id, name, started,
// ended, drives, charges), the trip-not-found empty state, and every visible string (resolved from the generated
// res/values catalog, ADR-014).
//
// Composition: [TripDetailPage] is the stateful entry (constructs the view-model over the host-wired source,
// collects the trip feed + the live display preferences); [TripDetailPageContent] is the stateless render layer.
// The decoded SI [Trip] is folded by the framework-free model (TripDetailPageModel.kt) into the card + KVList
// values — exactly as the web page derives them inline. SI values are converted to the user's units only here at
// the display boundary via [TripDetailDisplayPrefs] (Phase-48 SI-canonical); the panels always render (the trip
// resolves to the not-found empty state, never a blank region). The web page uses no charts or map.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.trips.tripdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip

/** The two summary columns on a phone (web `cols.default = 2`); four on a large window (web `cols.lg = 4`). */
private const val GRID_COLUMNS_DEFAULT = 2
private const val GRID_COLUMNS_LG = 4

/** The Material expanded-width breakpoint at which the stat grid widens to four columns (web `lg`). */
private val LARGE_WINDOW_BREAKPOINT = 840.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TripDetailPageViewModel] over the supplied [source] (the host wires the shared
 * trips repository + settings holder via [tripDetailPageSourceOf]) for the trip [id]. [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun TripDetailPage(
    source: TripDetailPageSource,
    id: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TripDetailPageViewModel =
        viewModel(
            key = "${TripDetailPageRegistration.SLUG}:$id",
            factory = viewModelFactory { initializer { TripDetailPageViewModel(source, id, logger) } },
        )
    TripDetailPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] trip feed + display prefs to the stateless content. */
@Composable
fun TripDetailPage(
    viewModel: TripDetailPageViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.tripState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    TripDetailPageContent(
        state = state,
        prefs = prefs,
        id = viewModel.id,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body, rendered inside the shared [PageContainer] chrome (web `<PageContainer>`): a first load
 * shows the centered spinner; a hard fetch failure shows the error surface with retry; otherwise the content area
 * renders the loaded trip's panels, or the trip-not-found empty state when there is no trip (web
 * `{trip ? … : <EmptyState message={t('trips.detail.notFound')} />}`). The subtitle + breadcrumb override mirror
 * the web `trip.name ?? \`Trip #${id}\``.
 */
@Composable
fun TripDetailPageContent(
    state: UiState<Trip>,
    prefs: TripDetailDisplayPrefs,
    id: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val trip = state.data
    val view = trip?.let { deriveTripDetailView(it, prefs) }
    val breadcrumbLabel = view?.subtitle ?: tripFallbackLabel(id)
    val fetchError = remember { TripDetailLoadException() }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
    ) {
        PageContainer(
            title = stringResource(R.string.translation_trips_detail_title),
            subtitle = view?.subtitle,
            loading = state.isLoading,
            error = if (state.isError) fetchError else null,
            breadcrumbLabels = mapOf(TripDetailPageRegistration.WEB_PATH to breadcrumbLabel),
            onRetry = onRetry,
        ) {
            if (view != null) {
                TripDetailLoaded(view = view)
            } else {
                EmptyState(message = stringResource(R.string.translation_trips_detail_notFound))
            }
        }
    }
}

/** The loaded trip body: the four summary StatCards, then the trip-facts GlassPanel (web `mt-6` spacing). */
@Composable
private fun TripDetailLoaded(
    view: TripDetailView,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TripStatGrid(view = view)
        TripDetailFacts(view = view)
    }
}

/**
 * The four summary StatCards in a responsive grid (web `<Grid cols={{ default: 2, lg: 4 }}>`): distance, energy
 * used, efficiency, cost. Each card resolves its label from the i18n catalog, takes its value + unit symbol from
 * the folded [TripDetailView], and carries a merged content description for TalkBack (ADR-015).
 */
@Composable
private fun TripStatGrid(
    view: TripDetailView,
    modifier: Modifier = Modifier,
) {
    val cards =
        listOf(
            TripStat(stringResource(R.string.translation_trips_detail_distance), view.distance, view.distanceUnit),
            TripStat(stringResource(R.string.translation_trips_detail_energy), view.energy, view.energyUnit),
            TripStat(stringResource(R.string.translation_trips_detail_efficiency), view.efficiency, view.efficiencyUnit),
            TripStat(stringResource(R.string.translation_trips_detail_cost), view.cost, null),
        )
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= LARGE_WINDOW_BREAKPOINT) GRID_COLUMNS_LG else GRID_COLUMNS_DEFAULT
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card ->
                        val description = listOfNotNull(card.label, card.value, card.unit).joinToString(" ")
                        StatCard(
                            label = card.label,
                            value = card.value,
                            unit = card.unit,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .clearAndSetSemantics { contentDescription = description },
                        )
                    }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** One stat tile's resolved label + value + optional unit symbol (web `StatCard` props). */
private data class TripStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The trip-facts GlassPanel — the web `<GlassPanel className="mt-6 p-4 sm:p-6"><KVList .../></GlassPanel>`: a
 * definition list of trip id, name, started, ended, drives, and charges. Labels resolve from the i18n catalog;
 * values come from the folded [TripDetailView]. Each KVList row stays an individually accessible label/value pair.
 */
@Composable
private fun TripDetailFacts(
    view: TripDetailView,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth(),
        padding = PanelPadding.Lg,
    ) {
        KVList(
            items =
                listOf(
                    KVItem(stringResource(R.string.translation_trips_detail_tripId), view.tripId),
                    KVItem(stringResource(R.string.translation_trips_detail_name), view.name),
                    KVItem(stringResource(R.string.translation_trips_detail_started), view.started),
                    KVItem(stringResource(R.string.translation_trips_detail_ended), view.ended),
                    KVItem(stringResource(R.string.translation_trips_detail_drives), view.drives),
                    KVItem(stringResource(R.string.translation_trips_detail_charges), view.charges),
                ),
        )
    }
}

/**
 * The page-owned, message-less failure handed to [PageContainer] when the trip feed hard-fails (web
 * `error instanceof Error`). It carries no message so the chrome renders its localized server-error copy
 * (ADR-014) rather than a raw, un-internationalized exception string; the retry affordance re-collects the feed.
 */
private class TripDetailLoadException : Exception()
