// The native Jetpack Compose + Material 3 DevToolsPage feature view — a parity port of
// web/src/features/admin/pages/DevToolsPage.tsx, the thin tabbed Developer Tools shell. It reproduces the web
// composition end to end: the page header (title + subtitle), the icon-pill [TabNav] switching the five
// `TABS` (Fleet API / Telemetry / Infrastructure / Utilities / Reference) in web order, and the
// crossfaded body that renders the selected section (web `<FadeIn key={tab}>`). The selected tab is held in
// the shared [DevToolsPageViewModel] state holder (P1/S8), so the surface owns no data and performs no HTTP.
//
// Section hosting: the web page renders each section (`<FleetApiSection/>` … `<ReferenceLinksSection/>`)
// directly, but those are INDEPENDENT parity units (their own prompts) whose Android ports bind through
// host-supplied data adapters that this page does not own (the manifest record for `page:admin/DevTools`
// declares no data sources — only the two header strings). So, exactly as the sibling `ClientUtilitiesSection`
// takes a host `toolContent` slot and `AlertStudioPage` takes a host `source`, this page receives the five
// section bodies as the [DevToolsSections] slot bundle. The host (the nav layer) wires each independently
// built section; the page composes them into the tabbed shell. Every visible string resolves through the
// generated i18n catalog (ADR-014) and the tab strip carries accessible chip labels (ADR-015).
//
// Composition: [DevToolsPage] is the stateful entry (constructs/collects the view-model, records the one-shot
// `view.opened` diagnostic); [DevToolsPageContent] is the stateless renderer that is the unit/UI-test and
// preview entry point. All tab logic lives in the framework-free model (DevToolsPageModel.kt).
//
// `MatchingDeclarationName` is suppressed for the co-located slot bundle + stateless content + previews;
// `InvalidPackageDeclaration` because the mandated surface directory
// (com/teslasync/feature-views/DevToolsPage) cannot form a valid Kotlin package identifier.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.devtoolspage

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered page container — used by instrumented UI tests. */
const val DEV_TOOLS_PAGE_TEST_TAG: String = "dev-tools-page"

/**
 * The five host-provided section bodies, one per [DevToolsTab] (web `<FleetApiSection/>` …
 * `<ReferenceLinksSection/>`). Each section is an independently built parity unit hosted by the nav layer
 * with its own data adapter; the page only composes the active one into the tabbed shell.
 */
class DevToolsSections(
    val fleetApi: @Composable () -> Unit,
    val telemetry: @Composable () -> Unit,
    val infrastructure: @Composable () -> Unit,
    val utilities: @Composable () -> Unit,
    val reference: @Composable () -> Unit,
)

/** The catalog key for a tab's label (web `TABS[i].label`, routed through i18n for ADR-014). */
@StringRes
private fun DevToolsTab.labelRes(): Int =
    when (this) {
        DevToolsTab.FleetApi -> R.string.translation_devtools_tab_fleetApi
        DevToolsTab.Telemetry -> R.string.translation_devtools_tab_telemetry
        DevToolsTab.Infrastructure -> R.string.translation_devtools_tab_infrastructure
        DevToolsTab.Utilities -> R.string.translation_devtools_tab_utilities
        DevToolsTab.Reference -> R.string.translation_devtools_tab_reference
    }

/** The leading glyph for a tab (web `TABS[i].icon`). */
private fun DevToolsTab.glyph(): ImageVector =
    when (this) {
        DevToolsTab.FleetApi -> DevToolsPageIcons.Globe
        DevToolsTab.Telemetry -> DevToolsPageIcons.Radio
        DevToolsTab.Infrastructure -> DevToolsPageIcons.Server
        DevToolsTab.Utilities -> DevToolsPageIcons.Wrench
        DevToolsTab.Reference -> DevToolsPageIcons.BookOpen
    }

/**
 * Stateful entry: constructs the [DevToolsPageViewModel], records the one-shot `view.opened` diagnostic, and
 * binds the selected-tab state to the stateless content. [sections] supplies the five host-wired section
 * bodies; [logger] defaults to the app's redacting logger.
 */
@Composable
fun DevToolsPage(
    sections: DevToolsSections,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DevToolsPageViewModel =
        viewModel(
            key = DevToolsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DevToolsPageViewModel(logger) } },
        )
    DevToolsPage(viewModel = viewModel, sections = sections, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] selected-tab state to the stateless content. */
@Composable
fun DevToolsPage(
    viewModel: DevToolsPageViewModel,
    sections: DevToolsSections,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val activeTab by viewModel.activeTab.collectAsStateWithLifecycle()
    DevToolsPageContent(
        activeTab = activeTab,
        onSelectTab = viewModel::selectTab,
        sections = sections,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the header (title + subtitle), the
 * icon-pill tab strip, and the crossfaded body for [activeTab]. Hoisted out of the view-model so it is
 * previewable with a hand-built tab + section bundle.
 */
@Composable
fun DevToolsPageContent(
    activeTab: DevToolsTab,
    onSelectTab: (DevToolsTab) -> Unit,
    sections: DevToolsSections,
    modifier: Modifier = Modifier,
) {
    val navItems =
        DevToolsTab.entries.map { tab ->
            TabNavItem(key = tab.key, label = stringResource(tab.labelRes()), icon = tab.glyph())
        }
    Column(
        modifier = modifier.fillMaxWidth().testTag(DEV_TOOLS_PAGE_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(
                text = stringResource(R.string.translation_devtools_title),
                modifier = Modifier.semantics { heading() },
            )
            HelperText(text = stringResource(R.string.translation_devtools_subtitle))
        }
        TabNav(
            items = navItems,
            selectedKey = activeTab.key,
            onSelect = { key -> onSelectTab(DevToolsTab.fromKey(key)) },
        )
        key(activeTab) {
            FadeIn {
                DevToolsSectionBody(activeTab = activeTab, sections = sections)
            }
        }
    }
}

/** Renders the host-provided body for the [activeTab] (web `{tab === '…' && <Section/>}`). */
@Composable
private fun DevToolsSectionBody(
    activeTab: DevToolsTab,
    sections: DevToolsSections,
) {
    when (activeTab) {
        DevToolsTab.FleetApi -> sections.fleetApi()
        DevToolsTab.Telemetry -> sections.telemetry()
        DevToolsTab.Infrastructure -> sections.infrastructure()
        DevToolsTab.Utilities -> sections.utilities()
        DevToolsTab.Reference -> sections.reference()
    }
}

// ── Previews (tooling-only; the sample section bodies are never shipped UI) ───────────────────────────────

private fun devToolsPreviewSections(): DevToolsSections =
    DevToolsSections(
        fleetApi = { HelperText(text = stringResource(R.string.translation_devtools_tab_fleetApi)) },
        telemetry = { HelperText(text = stringResource(R.string.translation_devtools_tab_telemetry)) },
        infrastructure = { HelperText(text = stringResource(R.string.translation_devtools_tab_infrastructure)) },
        utilities = { HelperText(text = stringResource(R.string.translation_devtools_tab_utilities)) },
        reference = { HelperText(text = stringResource(R.string.translation_devtools_tab_reference)) },
    )

@Preview(name = "DevTools · Fleet API", showBackground = true)
@Composable
private fun DevToolsPageFleetApiPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DevToolsPageContent(
            activeTab = DevToolsTab.FleetApi,
            onSelectTab = {},
            sections = devToolsPreviewSections(),
        )
    }
}

@Preview(name = "DevTools · Infrastructure (dark)", showBackground = true)
@Composable
private fun DevToolsPageInfrastructureDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        DevToolsPageContent(
            activeTab = DevToolsTab.Infrastructure,
            onSelectTab = {},
            sections = devToolsPreviewSections(),
        )
    }
}
