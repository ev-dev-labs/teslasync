// The native Jetpack Compose + Material 3 SharingTripsPage sharing surface — a parity port of
// web/src/features/sharing/pages/SharingTripsPage.tsx, the "Share a trip" page. It reproduces the page's title +
// subtitle header (web `PageContainer`), the recent-trips selectable listbox panel (GlassPanel1 — every data state:
// loading skeletons / empty / error-retry / the date-grouped selectable rows, plus the cache-then-network
// stale/offline tier the bound state holder carries), and the static-share-cards hint panel (GlassPanel2), and
// every visible string (resolved from the generated res/values catalog, ADR-014).
//
// The web page also renders the propose-only AI share-card surface beneath the panels, gated by
// `withAiFeature('trip-postcard-share-card-image-generation')`. That surface is its OWN parity unit
// (com/teslasync/shared-surfaces/AITripPostcardShareCardImageGeneration) and is wired by its own prompt with the
// SSE transport it needs; the web page is contractually required to keep working with AI off (ADR-015 §I3), and
// that AI-off baseline is exactly these two panels. The page still owns the selected-trip interaction (the listbox
// selection) the AI surface consumes once it is hosted, so no parity is lost here.
//
// Composition: [SharingTripsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the trips feed + display prefs + the selection);
// [SharingTripsPageContent] is the stateless render layer. SI values are converted to the user's units only here at
// the display boundary via the model's prefs helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharing.sharingtrips

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip

/** Stagger between the two body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Number of shimmering skeleton rows shown while the recent-trips feed first loads (web `[1,2,3].map`). */
private const val LOADING_ROWS = 3

/** Height of a recent-trips row / its loading skeleton (web `h-16` ≈ 64 dp). */
private val ROW_HEIGHT = 64.dp

/** Subtle wash behind an unselected row's border (web `bg-white/[0.02]`). */
private const val ROW_WASH_ALPHA = 0.03f

/** Wash behind the selected row (web `bg-cyan-500/5`). */
private const val SELECTED_ROW_WASH_ALPHA = 0.08f

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SharingTripsPageViewModel] over the supplied [source] (the host wires the shared
 * trips repository + settings holder + the app-scoped active-vehicle selection via [sharingTripsPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun SharingTripsPage(
    source: SharingTripsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SharingTripsPageViewModel =
        viewModel(
            key = SharingTripsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SharingTripsPageViewModel(source, logger) } },
        )
    SharingTripsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] trips feed + display prefs + selection to the stateless content. */
@Composable
fun SharingTripsPage(
    viewModel: SharingTripsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val tripsState by viewModel.tripsState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val selectedTripId by viewModel.selectedTripId.collectAsStateWithLifecycle()

    SharingTripsPageContent(
        tripsState = tripsState,
        prefs = prefs,
        selectedTripId = selectedTripId,
        onSelectTrip = viewModel::selectTrip,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle/freshness header above the recent-trips panel (GlassPanel1) and the
 * static-share-cards hint panel (GlassPanel2). GlassPanel1 renders the trips feed's every state inline (loading
 * skeletons / empty / error-retry / the selectable rows), and GlassPanel2 is data-independent so the static
 * publishing hint is always visible — no region ever blanks (ADR-011).
 */
@Composable
fun SharingTripsPageContent(
    tripsState: UiState<List<Trip>>,
    prefs: SharingTripsDisplayPrefs,
    selectedTripId: Long?,
    onSelectTrip: (Long) -> Unit,
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
        SharingTripsHeader(tripsState = tripsState)

        FadeIn(delayMs = FADE_STEP_MS) {
            RecentTripsPanel(
                tripsState = tripsState,
                prefs = prefs,
                selectedTripId = selectedTripId,
                onSelectTrip = onSelectTrip,
                onRetry = onRetry,
            )
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            StaticShareCardsPanel()
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle + the cache-freshness chip (web `PageContainer`). */
@Composable
private fun SharingTripsHeader(tripsState: UiState<List<Trip>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_sharing_trips_title))
            BodyText(
                stringResource(R.string.translation_sharing_trips_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = tripsState.fetchedAt?.takeIf { it > 0L },
            isFetching = tripsState.isLoading || tripsState.refreshing,
            isStale = tripsState.stale,
            isError = tripsState.hasError,
            compact = true,
        )
    }
}

// ── GlassPanel1 — recent trips listbox ──────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel1 — the recent-trips selector (web first `GlassPanel`). The heading is always present; the body
 * switches on the trips feed's lifecycle: shimmering skeletons while it first loads, a retry-able error surface
 * on a hard failure with no cache, the no-trips empty state when the log is empty, or the selectable rows otherwise.
 */
@Composable
private fun RecentTripsPanel(
    tripsState: UiState<List<Trip>>,
    prefs: SharingTripsDisplayPrefs,
    selectedTripId: Long?,
    onSelectTrip: (Long) -> Unit,
    onRetry: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_sharing_trips_recent_heading))
            when {
                tripsState.isLoading -> RecentTripsLoading()
                tripsState.isError -> RecentTripsError(onRetry = onRetry)
                tripsState.isEmpty -> RecentTripsEmpty()
                else ->
                    RecentTripsList(
                        trips = tripsState.data.orEmpty(),
                        prefs = prefs,
                        selectedTripId = selectedTripId,
                        onSelectTrip = onSelectTrip,
                    )
            }
        }
    }
}

/** The first-load shimmer for the recent-trips list (web `isLoading ? [1,2,3].map(<Skeleton h-16/>)`). */
@Composable
private fun RecentTripsLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(LOADING_ROWS) {
            Skeleton(height = ROW_HEIGHT, rounded = true)
        }
    }
}

/** The no-trips empty state (web `<EmptyState icon={Route} message={recent.empty} />`). */
@Composable
private fun RecentTripsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_sharing_trips_recent_empty),
        icon = NavGlyphs.Route,
    )
}

/**
 * The hard-error surface for the trips feed (no cached fallback) — a retry-able error panel. The web page falls back
 * to its empty state on error (it wires only `loading`), but the bound state holder distinguishes a hard error from
 * an empty result, so this surface is honest about the failure and offers a retry (ADR-013).
 */
@Composable
private fun RecentTripsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The selectable recent-trips rows (web `role="listbox"` of `role="option"` buttons). The column is a
 * `selectableGroup` so TalkBack announces single-selection; each row toggles [onSelectTrip] and highlights when it
 * is the [selectedTripId].
 */
@Composable
private fun RecentTripsList(
    trips: List<Trip>,
    prefs: SharingTripsDisplayPrefs,
    selectedTripId: Long?,
    onSelectTrip: (Long) -> Unit,
) {
    val heading = stringResource(R.string.translation_sharing_trips_recent_heading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .selectableGroup()
                .semantics { contentDescription = heading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        trips.forEach { trip ->
            val row = sharingTripRow(trip, prefs)
            TripRow(
                row = row,
                selected = selectedTripId == trip.id,
                onClick = { onSelectTrip(trip.id) },
            )
        }
    }
}

/**
 * One recent-trips row — the Route avatar + name (or the "Trip #id" fallback) + the date/duration/drive-count
 * metrics on the left, and the distance + energy figures on the right (web list item). The whole row is one
 * `Role.RadioButton` selection target (≥ 48 dp) so a tap selects the trip the AI surface consumes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TripRow(
    row: SharingTripRow,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val tripLabel = stringResource(R.string.translation_sharing_trips_row_trip)
    val name = row.name ?: "$tripLabel #${row.id}"
    val drivesLabel = stringResource(R.string.translation_sharing_trips_row_drives, row.driveCount.toString())

    val borderColor =
        if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    val washColor =
        if (selected) {
            MaterialTheme.colorScheme.primary.copy(alpha = SELECTED_ROW_WASH_ALPHA)
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_WASH_ALPHA)
        }

    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT)
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
        shape = MaterialTheme.shapes.medium,
        color = washColor,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(if (selected) 1.5.dp else 1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
                Icon(NavGlyphs.Route, contentDescription = null, size = IconSize.Md)
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                BodyText(name)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    InlineMetric(icon = FormsGlyphs.Calendar, value = row.dateText)
                    InlineMetric(icon = DataDisplayGlyphs.Clock, value = row.durationText)
                    Caption(drivesLabel)
                }
            }
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                TripFigure(
                    icon = DataDisplayGlyphs.MapPin,
                    text = row.distanceText,
                    iconTint = MaterialTheme.colorScheme.primary,
                    textColor = MaterialTheme.colorScheme.onSurface,
                )
                TripFigure(
                    icon = DataDisplayGlyphs.Bolt,
                    text = row.energyText,
                    iconTint = TeslaTokens.status.warning,
                    textColor = TeslaTokens.status.warning,
                )
            }
        }
    }
}

/** A right-aligned icon + value figure (web distance `MapPin` cell / energy `Zap` cell). */
@Composable
private fun TripFigure(
    icon: ImageVector,
    text: String,
    iconTint: Color,
    textColor: Color,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = iconTint)
        BodyText(text, color = textColor)
    }
}

// ── GlassPanel2 — static share cards hint ───────────────────────────────────────────────────────────────────────

/**
 * GlassPanel2 — the static-share-cards publishing hint (web second `GlassPanel`). Data-independent: it surfaces the
 * canonical per-drive Share workflow so a user who lands here (even with AI off) sees how to publish a static card.
 */
@Composable
private fun StaticShareCardsPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PanelTitle(stringResource(R.string.translation_sharing_trips_staticHint_heading))
            BodyText(
                stringResource(R.string.translation_sharing_trips_staticHint_body),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
