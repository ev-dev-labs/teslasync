// The native Jetpack Compose + Material 3 NotFoundPage system surface — a parity port of
// web/src/features/system/pages/NotFoundPage.tsx, the catch-all 404 mounted at `/*`. It reproduces the web page's
// single centered GlassPanel (GlassPanel1): the Compass lead glyph, the heading, the body that names the unmatched
// path, the "Did you mean" closest-route suggestion list, and the three escape-hatch actions (Go back / Go to
// dashboard / Open command palette). Every visible string resolves from the generated res/values catalog (ADR-014);
// the page reads no API (the web page renders from `location.pathname` + a Levenshtein ranking over the route
// registry), so the snapshot is derived in the framework-free model and projected through the shared UiState surface
// by the view-model.
//
// Composition: [NotFoundPage] is the stateful entry (constructs the view-model over the attempted path, records the
// one-shot `view.opened` diagnostic, collects the resolved snapshot, and wires the back / deep-link navigation
// seams); [NotFoundPageContent] is the stateless render layer that switches the loading / success surfaces off the
// bound [UiState] and lays out the panel.
//
// Navigation seam (web parity): no `LocalNavController` is exposed to page hosts, so — exactly as the sibling
// ExplorePage / GlancePage surfaces document — forward navigation goes through the shared DeepLinkRouter
// (`teslasync://app/...`, the web `<Link>` / `navigate(...)`) and "Go back" uses the back dispatcher (web
// `window.history.back()`). "Open command palette" (web dispatches `toggle-command-palette`) maps to the app's own
// search route — the same target the chrome's search action opens (AppScaffold `onSearch`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.notfound

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.navigation.navTitleRes
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Max width of the centered card — the web `max-w-2xl` (≈ 42rem) constraint on the GlassPanel. */
private val CardMaxWidth = 560.dp

/** Min touch target for a suggestion row — Material 3 / ADR-015 ≥ 48dp. */
private val SuggestionMinHeight = 48.dp

/** Height of the (never-normally-shown) loading skeleton card, kept for data-state symmetry. */
private val CardSkeletonHeight = 360.dp

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [NotFoundPageViewModel] over the [attemptedPath] (the unmatched URL, web
 * `location.pathname`). [logger] defaults to the app's redacting logger. The view-model is keyed by this surface's
 * slug + the attempted path so a new unmatched URL re-derives its suggestions.
 */
@Composable
fun NotFoundPage(
    attemptedPath: String? = null,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: NotFoundPageViewModel =
        viewModel(
            key = NotFoundPageRegistration.SLUG + ":" + (attemptedPath ?: ""),
            factory =
                viewModelFactory {
                    initializer { NotFoundPageViewModel(logger = logger, attemptedPath = attemptedPath) }
                },
        )
    NotFoundPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot, wires the
 * back-dispatcher + DeepLinkRouter navigation seams, and hands the stateless content the accessibility pane title
 * (web `usePageTitle(t('notFound.title'))`).
 */
@Composable
fun NotFoundPage(
    viewModel: NotFoundPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val title = stringResource(R.string.translation_notFound_title)

    // Forward navigation goes through the shared DeepLinkRouter (the seam widget / shortcut / notification taps use);
    // no LocalNavController is exposed to page hosts. A feature path (e.g. `/battery`) becomes the app deep-link URI.
    val deepLinkRouter = LocalDeepLinkRouter.current
    val onNavigate: (String) -> Unit =
        remember(deepLinkRouter) {
            { path -> deepLinkRouter?.request("${RouteTable.APP_SCHEME}://app$path") }
        }

    // "Go back" leaves the surface via the back dispatcher (web `window.history.back()`).
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onGoBack: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    NotFoundPageContent(
        uiState = uiState,
        onSuggestion = onNavigate,
        onGoBack = onGoBack,
        onGoHome = remember(onNavigate) { { onNavigate("/") } },
        onOpenSearch = remember(onNavigate) { { onNavigate("/search") } },
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the page title header, then switches off the
 * bound [uiState]: the loading skeleton (never normally shown — the static surface resolves synchronously), or — on
 * success — the centered GlassPanel1 (heading, body, suggestions, actions). The surface always has content, so there
 * is no empty/error branch; the data-state seams are kept for the standard parity matrix.
 *
 * @param onSuggestion navigates to a suggested route path (web `<Link to={s.path}>`).
 * @param onGoBack web `window.history.back()`.
 * @param onGoHome web `navigate('/')`.
 * @param onOpenSearch web `openCommandPalette()` — the app's search route (chrome `onSearch`).
 */
@Composable
fun NotFoundPageContent(
    uiState: UiState<NotFoundSnapshot>,
    onSuggestion: (String) -> Unit,
    onGoBack: () -> Unit,
    onGoHome: () -> Unit,
    onOpenSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = uiState.data

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_notFound_title))

        if (uiState.isLoading || snapshot == null) {
            NotFoundLoading()
        } else {
            FadeIn {
                NotFoundCard(
                    snapshot = snapshot,
                    onSuggestion = onSuggestion,
                    onGoBack = onGoBack,
                    onGoHome = onGoHome,
                    onOpenSearch = onOpenSearch,
                )
            }
        }
    }
}

/**
 * GlassPanel1 — the centered 404 card. The Compass lead glyph, the heading, the body naming the unmatched path, the
 * optional "Did you mean" suggestion list, and the three escape-hatch actions (web `<GlassPanel className="... max-w-2xl
 * text-center">`).
 */
@Composable
private fun NotFoundCard(
    snapshot: NotFoundSnapshot,
    onSuggestion: (String) -> Unit,
    onGoBack: () -> Unit,
    onGoHome: () -> Unit,
    onOpenSearch: () -> Unit,
) {
    val heading = stringResource(R.string.translation_notFound_heading)
    GlassPanel(
        modifier =
            Modifier
                .widthIn(max = CardMaxWidth)
                .fillMaxWidth()
                .semantics { contentDescription = heading },
        padding = PanelPadding.Lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Icon(
                NotFoundGlyphs.Compass,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Heading(
                text = heading,
                level = HeadingLevel.Section,
                modifier = Modifier.semantics { heading() },
            )
            BodyText(
                text = stringResource(R.string.translation_notFound_body, snapshot.attemptedPath),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (snapshot.hasSuggestions) {
                NotFoundSuggestions(suggestions = snapshot.suggestions, onSuggestion = onSuggestion)
            }

            NotFoundActions(onGoBack = onGoBack, onGoHome = onGoHome, onOpenSearch = onOpenSearch)
        }
    }
}

/**
 * The "Did you mean" closest-route list (web `suggestions.length > 0 && ...`). A label over one tappable row per
 * suggestion (the localized destination title + its path), each navigating to that route.
 */
@Composable
private fun NotFoundSuggestions(
    suggestions: List<RouteSuggestion>,
    onSuggestion: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(stringResource(R.string.translation_notFound_didYouMean))
        suggestions.forEach { suggestion ->
            NotFoundSuggestionRow(suggestion = suggestion, onSuggestion = onSuggestion)
        }
    }
}

/** One suggestion row — the localized route title plus its path, tappable to navigate (web `<Link>`). */
@Composable
private fun NotFoundSuggestionRow(
    suggestion: RouteSuggestion,
    onSuggestion: (String) -> Unit,
) {
    val label = stringResource(navTitleRes(suggestion.id))
    Row(
        modifier =
            Modifier
                .heightIn(min = SuggestionMinHeight)
                .clickable(role = Role.Button) { onSuggestion(suggestion.path) }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics { contentDescription = label + " " + suggestion.path },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(text = label, color = MaterialTheme.colorScheme.primary)
        Caption(text = suggestion.path)
    }
}

/**
 * The three escape-hatch actions (web button row): Go back (ghost + ArrowLeft), Go to dashboard (primary + Home), and
 * Open command palette (ghost + Search). Stacked for compact widths so each stays a full ≥48dp target.
 */
@Composable
private fun NotFoundActions(
    onGoBack: () -> Unit,
    onGoHome: () -> Unit,
    onOpenSearch: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label = stringResource(R.string.translation_notFound_goBack),
            onClick = onGoBack,
            variant = ButtonVariant.Ghost,
            leadingIcon = NotFoundGlyphs.ArrowLeft,
        )
        Button(
            label = stringResource(R.string.translation_notFound_goHome),
            onClick = onGoHome,
            variant = ButtonVariant.Primary,
            leadingIcon = NotFoundGlyphs.Home,
        )
        Button(
            label = stringResource(R.string.translation_notFound_openSearch),
            onClick = onOpenSearch,
            variant = ButtonVariant.Ghost,
            leadingIcon = NotFoundGlyphs.Search,
        )
    }
}

/** The loading skeleton — the static surface resolves synchronously and never actually spins, but the seam exists. */
@Composable
private fun NotFoundLoading() {
    Skeleton(
        modifier = Modifier.widthIn(max = CardMaxWidth).fillMaxWidth(),
        height = CardSkeletonHeight,
        rounded = true,
    )
}
