// The native Jetpack Compose + Material 3 DashboardsPage power-user surface — a parity port of
// web/src/features/power-user/pages/DashboardsPage.tsx, the manual Grafana dashboard-JSON composer at
// /power/dashboards. It reproduces the page chrome (the `PageTitle` heading + the intro paragraph) and both
// `GlassPanel` sections: GlassPanel1 — the manual JSON editor (textarea + Copy-to-clipboard / Clear actions + the
// live status message) — and GlassPanel2 — the curated panel catalog (intro + the alphabetically-sorted panel list).
// Every visible label resolves from the generated res/values catalog (`powerDashboards.*`, ADR-014); the curated
// panel name/description pairs are static technical reference data, hardcoded exactly as in the web source.
//
// Composition: [DashboardsPage] is the stateful entry (constructs the view-model, records the one-shot `view.opened`
// diagnostic, builds the `LocalClipboardManager`-backed [ClipboardTarget], collects the success state + the draft +
// the copy outcome); [DashboardsPageContent] is the stateless render layer drawn from those — the unit/preview entry.
// There is no async data source (the manifest declares the single `success` state), so the body always renders the
// two panels from the immediate [UiState.data]. All outcome/sort logic lives in the framework-free model
// (DashboardsPageModel.kt), so this file only resolves i18n + draws.
//
// The web AINLDashboardComposer (the optional AI drafter rendered between the intro and the editor) is a separately
// tracked shared-surface parity unit with its own string set and tests; it is intentionally out of this page-shell
// unit's scope (the manifest lists exactly GlassPanel1/GlassPanel2 + the 13 powerDashboards.* strings).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.dashboards

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The minimum visible rows of the JSON editor (web `<Textarea rows={12} />`). */
private const val EDITOR_MIN_LINES = 12

/** The maximum visible rows before the editor scrolls internally on a phone viewport. */
private const val EDITOR_MAX_LINES = 16

// ── Stateful entry point ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DashboardsPageViewModel] (keyed to this surface's slug so it is scoped to the
 * /power/dashboards navigation entry), records the one-shot `view.opened` diagnostic, builds the
 * `LocalClipboardManager`-backed [ClipboardTarget] the web `navigator.clipboard.writeText` maps to, and binds the
 * live state to the stateless content. [logger] defaults to the app's redacting logger.
 */
@Composable
fun DashboardsPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DashboardsPageViewModel =
        viewModel(
            key = DashboardsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DashboardsPageViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val clipboardManager = LocalClipboardManager.current
    val clipboard =
        remember(clipboardManager) {
            object : ClipboardTarget {
                override val isAvailable: Boolean = true

                override fun write(text: String): Boolean =
                    runCatching { clipboardManager.setText(AnnotatedString(text)) }.isSuccess
            }
        }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val draft by viewModel.draft.collectAsStateWithLifecycle()
    val copyStatus by viewModel.copyStatus.collectAsStateWithLifecycle()

    DashboardsPageContent(
        state = state,
        draft = draft,
        copyStatus = copyStatus,
        onDraftChange = viewModel::updateDraft,
        onCopy = { viewModel.copy(clipboard) },
        onClear = viewModel::clear,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title + intro chrome (web `PageTitle` + the intro `<p>`), then the two panels drawn
 * from the immediate `success` [state]. The editor panel (GlassPanel1) renders the JSON textarea + Copy / Clear
 * actions + the status message; the catalog panel (GlassPanel2) renders the curated panel list. Scrolls vertically so
 * both panels stay reachable on short viewports.
 */
@Composable
fun DashboardsPageContent(
    state: UiState<DashboardsCatalog>,
    draft: String,
    copyStatus: CopyStatus,
    onDraftChange: (String) -> Unit,
    onCopy: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val catalog = state.data ?: DashboardsCatalog.DEFAULT
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_powerDashboards_title))
        BodyText(
            stringResource(R.string.translation_powerDashboards_intro),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        DashboardEditorPanel(
            draft = draft,
            copyStatus = copyStatus,
            onDraftChange = onDraftChange,
            onCopy = onCopy,
            onClear = onClear,
        )
        DashboardCatalogPanel(panels = catalog.panels)
    }
}

// ── GlassPanel1 — manual JSON editor ────────────────────────────────────────────────────────────────────────────

/**
 * The manual dashboard-JSON editor (web first `GlassPanel`): the panel title, the multi-line JSON [Textarea] (its
 * accessible name is the web `aria-label`; the example envelope is shown as a hint only while empty), the
 * Copy / Clear actions (both disabled while the editor is blank, web `disabled={!canCopy}`), and the live status
 * message.
 */
@Composable
private fun DashboardEditorPanel(
    draft: String,
    copyStatus: CopyStatus,
    onDraftChange: (String) -> Unit,
    onCopy: () -> Unit,
    onClear: () -> Unit,
) {
    val editorLabel = stringResource(R.string.translation_powerDashboards_editor_label)
    val exampleHint =
        stringResource(R.string.translation_powerDashboards_editor_placeholder) // parity:allow editor.placeholder is a web i18n key name (the JSON example), not a stub marker
    val canCopy = draft.isNotBlank()
    GlassPanel {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_powerDashboards_editor_title))
            Textarea(
                value = draft,
                onValueChange = onDraftChange,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = editorLabel },
                hint = exampleHint.takeIf { draft.isBlank() },
                minLines = EDITOR_MIN_LINES,
                maxLines = EDITOR_MAX_LINES,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    label = stringResource(R.string.translation_powerDashboards_editor_copy),
                    onClick = onCopy,
                    variant = ButtonVariant.Primary,
                    enabled = canCopy,
                )
                Button(
                    label = stringResource(R.string.translation_powerDashboards_editor_clear),
                    onClick = onClear,
                    variant = ButtonVariant.Secondary,
                    enabled = canCopy,
                )
            }
            CopyStatusMessage(copyStatus)
        }
    }
}

/**
 * The live copy-to-clipboard status line (web `<span role="status" className="text-amber-300">`). Renders nothing in
 * the [CopyStatus.None] state; otherwise resolves the matching localized message, announces it as a polite live
 * region (web `role="status"`), and tints it with the warning token (web amber).
 */
@Composable
private fun CopyStatusMessage(status: CopyStatus) {
    val message =
        when (status) {
            CopyStatus.None -> null
            CopyStatus.Empty -> stringResource(R.string.translation_powerDashboards_editor_copyEmpty)
            CopyStatus.Unavailable -> stringResource(R.string.translation_powerDashboards_editor_copyUnavailable)
            CopyStatus.Success -> stringResource(R.string.translation_powerDashboards_editor_copySuccess)
            CopyStatus.Failed -> stringResource(R.string.translation_powerDashboards_editor_copyFailed)
        }
    if (message != null) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = TeslaTokens.status.warning,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

// ── GlassPanel2 — curated panel catalog ───────────────────────────────────────────────────────────────────────

/**
 * The curated panel catalog (web second `GlassPanel`): the panel title, the intro paragraph, and the
 * alphabetically-sorted list of curated [panels]. Each entry shows the `panel_name` identifier (monospace, info
 * accent — web `text-cyan-300`) above its description.
 */
@Composable
private fun DashboardCatalogPanel(panels: List<CuratedDashboardPanel>) {
    GlassPanel {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_powerDashboards_panels_title))
            BodyText(
                stringResource(R.string.translation_powerDashboards_panels_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                panels.forEach { panel -> CuratedPanelRow(panel) }
            }
        }
    }
}

/** One curated-catalog row: the monospace `panel_name` over its description, inside a subtle outlined surface. */
@Composable
private fun CuratedPanelRow(panel: CuratedDashboardPanel) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = panel.name,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = TeslaTokens.status.info,
            )
            Text(
                text = panel.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
