// The native Jetpack Compose + Material 3 HelpPage system surface — a parity port of
// web/src/features/system/pages/HelpPage.tsx, the deterministic /help baseline. It reproduces the web page's title,
// the framing intro panel (GlassPanel1), and the curated link grid — one GlassPanel card per link (GlassPanel2+),
// each wrapping a deep link to an existing canonical destination (the docs/status-api page, onboarding,
// system-status, search, the chatbot). Every visible string resolves from the generated res/values catalog (ADR-014);
// no copy is hardcoded.
//
// Composition: [HelpPage] is the stateful entry (constructs the view-model over the app's redacting logger, records
// the one-shot `view.opened` diagnostic, collects the resolved snapshot, and wires the per-card deep-link opener);
// [HelpPageContent] is the stateless render layer that draws the title, the intro panel, and the staggered link
// cards off the bound [UiState].
//
// State matrix: the web page renders its links unconditionally (no API read), so the resolved [UiState] is always in
// the content phase and no loading / empty / error chrome is fabricated. The conditional AI surface the web page
// layers alongside (AIRAGHelp) is a separate, conditional component outside this page parity unit and its allowed
// files, so it is intentionally not mounted here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.help

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Size of each curated link's leading icon chip — the web `h-10 w-10` rounded badge. */
private val LinkIconChipSize = 40.dp

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [HelpPageViewModel] over the app's redacting [logger] (resolved from
 * [LocalDataContainer]). The HelpPage has no API data source, so no host-wired source seam is needed — the curated
 * link palette is local + static.
 */
@Composable
fun HelpPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: HelpPageViewModel =
        viewModel(
            key = HelpPageRegistration.SLUG,
            factory = viewModelFactory { initializer { HelpPageViewModel(logger) } },
        )
    HelpPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot, wires the
 * curated-link deep-link opener (web `<Link to={…}>` ▸ the app's own `teslasync://app/{path}` scheme via
 * `LocalUriHandler`), and hands the stateless content the accessibility pane title (web `usePageTitle(t('help.title'))`).
 */
@Composable
fun HelpPage(
    viewModel: HelpPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    val uriHandler = LocalUriHandler.current
    val onOpenLink: (String) -> Unit =
        remember(uriHandler) { { webPath -> uriHandler.openUri(helpDeepLinkFor(webPath)) } }

    val title = stringResource(R.string.translation_help_title)

    HelpPageContent(
        uiState = uiState,
        onOpenLink = onOpenLink,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the page title, the FadeIn intro panel
 * (GlassPanel1), and the curated-link grid (one GlassPanel card per [HelpLink], GlassPanel2+). The content is always
 * present (the model is static), mirroring the web page, which renders its links unconditionally.
 */
@Composable
fun HelpPageContent(
    uiState: UiState<HelpContent>,
    onOpenLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val links = uiState.data?.links ?: HELP_LINKS

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_help_title))

        FadeIn { HelpIntroPanel() }

        HelpLinksList(links = links, onOpenLink = onOpenLink)
    }
}

/** GlassPanel1 — the framing intro paragraph (web `<GlassPanel><p>{t('help.intro')}</p></GlassPanel>`). */
@Composable
private fun HelpIntroPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        BodyText(
            stringResource(R.string.translation_help_intro),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The curated-link grid — the web responsive grid of `<Link>`-wrapped GlassPanels (GlassPanel2+). */
@Composable
private fun HelpLinksList(
    links: List<HelpLink>,
    onOpenLink: (String) -> Unit,
) {
    StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        links.forEachIndexed { index, link ->
            StaggerItem(index = index) {
                HelpLinkCard(link = link, onOpenLink = onOpenLink)
            }
        }
    }
}

/**
 * GlassPanel2 — one curated link card. The whole panel is a single touch target (web `<Link>` wrapping the
 * GlassPanel) opening the link's in-app deep link; it shows the leading icon chip, the title + a trailing arrow
 * affordance, and the one-line description. Every string resolves from the catalog at this boundary.
 */
@Composable
private fun HelpLinkCard(
    link: HelpLink,
    onOpenLink: (String) -> Unit,
) {
    val title = stringResource(link.titleRes)
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.large)
                .clickable { onOpenLink(link.webPath) }
                .semantics {
                    role = Role.Button
                    contentDescription = title
                },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            HelpLinkIconChip(icon = link.icon)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PanelTitle(title, modifier = Modifier.weight(1f))
                    Icon(
                        HelpGlyphs.ArrowRight,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                BodyText(
                    stringResource(link.descRes),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** The leading icon chip — the web `h-10 w-10 rounded-xl bg-cyan-300/10 ring-1` badge, theme-tinted. */
@Composable
private fun HelpLinkIconChip(icon: ImageVector) {
    Box(
        modifier =
            Modifier
                .size(LinkIconChipSize)
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}
