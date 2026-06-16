// The native Jetpack Compose + Material 3 GrafanaPanelPage power-user surface — a parity port of
// web/src/features/power-user/pages/GrafanaPanelPage.tsx (route /power/grafana). Faithful to the web render tree:
// the page title + intro, the optional Helix natural-language drafter (the embedded AINLGrafanaPanel shared
// surface, propose-only — hidden when the AI feature is off), and the deterministic baseline that is always
// present — the manual panel-JSON editor (Textarea + Copy-to-clipboard + Clear + status) and the three curated
// catalog viewers (panel types, datasource types, table catalog). The browser/app never pushes a panel to
// Grafana; the user copies the JSON into their own Grafana dashboard editor.
//
// Every visible string resolves from the generated res/values catalog (ADR-014); the curated catalogs and the
// apply-to-editor JSON projection come from the pure GrafanaPanelPageModel (asserted off-device); local editor
// state + persistence + the copy outcome flow through GrafanaPanelPageViewModel (P1/S8 state-holder boundary). The
// page records the one-shot PII-safe `view.opened` diagnostic for the /power/grafana route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located overloads + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.grafanapanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.AINLGrafanaPanel
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.AINLGrafanaPanelSource
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelDraft
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `rows={12}` — the editor opens tall enough to hold a small panel envelope before it scrolls. */
private const val EDITOR_MIN_LINES: Int = 12
private const val EDITOR_MAX_LINES: Int = 24

/** A 1px hairline around each catalog entry (web `rounded-md border`). */
private val CATALOG_ITEM_BORDER: Dp = 1.dp

/**
 * Stateful entry: constructs the [GrafanaPanelPageViewModel] over the supplied [draftStore] (the host wires the
 * SharedPreferences-backed store), keyed by this surface's slug so it is scoped to the /power/grafana navigation
 * entry, and binds the embedded Helix drafter to [aiSource] (the host wires the real settings-derived AI gate).
 */
@Composable
fun GrafanaPanelPage(
    draftStore: GrafanaDraftStore,
    aiSource: AINLGrafanaPanelSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GrafanaPanelPageViewModel =
        viewModel(
            key = GrafanaPanelPageRegistration.SLUG,
            factory = GrafanaPanelPageViewModel.factory(draftStore, logger),
        )
    GrafanaPanelPage(viewModel = vm, aiSource = aiSource, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11), collects the local editor state,
 * and binds the intent callbacks to the stateless body.
 */
@Composable
fun GrafanaPanelPage(
    viewModel: GrafanaPanelPageViewModel,
    aiSource: AINLGrafanaPanelSource,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    GrafanaPanelPageContent(
        state = state,
        aiSource = aiSource,
        onPanelJsonChange = viewModel::setPanelJson,
        onApplyAiDraft = viewModel::applyAiDraft,
        onClear = viewModel::clear,
        onCopyStatus = viewModel::reportCopyStatus,
        modifier = modifier,
    )
}

/**
 * The stateless page body — the faithful port of the web render tree. Scrolls vertically so every panel is
 * reachable on short viewports. Order matches web: title ▸ intro ▸ Helix drafter ▸ manual editor ▸ panel-type
 * catalog ▸ datasource-type catalog ▸ table catalog.
 */
@Composable
fun GrafanaPanelPageContent(
    state: GrafanaPanelUiState,
    aiSource: AINLGrafanaPanelSource,
    onPanelJsonChange: (String) -> Unit,
    onApplyAiDraft: (GrafanaPanelDraft) -> Unit,
    onClear: () -> Unit,
    onCopyStatus: (GrafanaCopyStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_powerGrafana_title))
        BodyText(
            stringResource(R.string.translation_powerGrafana_intro),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // The optional Helix natural-language drafter (web <AINLGrafanaPanel onApply={…} />). Propose-only and
        // hidden when the nl-grafana-panel AI feature is off; on apply it copies the proposed envelope into the
        // editor below (the user still copies it into Grafana themselves).
        AINLGrafanaPanel(source = aiSource, onApply = onApplyAiDraft)

        EditorPanel(
            state = state,
            onPanelJsonChange = onPanelJsonChange,
            onClear = onClear,
            onCopyStatus = onCopyStatus,
        )
        PanelTypesPanel()
        DatasourceTypesPanel()
        TablesPanel()
    }
}

/** GlassPanel 1 — the manual panel-JSON editor (web "Manual panel JSON editor" GlassPanel). */
@Composable
private fun EditorPanel(
    state: GrafanaPanelUiState,
    onPanelJsonChange: (String) -> Unit,
    onClear: () -> Unit,
    onCopyStatus: (GrafanaCopyStatus) -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val editorExampleJson = stringResource(R.string.translation_powerGrafana_editor_placeholder) // parity:allow web i18n key name

    val performCopy: () -> Unit = {
        val trimmed = state.panelJson.trim()
        if (trimmed.isEmpty()) {
            onCopyStatus(GrafanaCopyStatus.Empty)
        } else {
            runCatching { clipboard.setText(AnnotatedString(trimmed)) }
                .onSuccess { onCopyStatus(GrafanaCopyStatus.Success) }
                .onFailure { onCopyStatus(GrafanaCopyStatus.Failed) }
        }
    }

    GlassPanel {
        SectionStack {
            PanelTitle(stringResource(R.string.translation_powerGrafana_editor_title))
            Textarea(
                value = state.panelJson,
                onValueChange = onPanelJsonChange,
                label = stringResource(R.string.translation_powerGrafana_editor_label),
                hint = if (state.panelJson.isBlank()) editorExampleJson else null,
                minLines = EDITOR_MIN_LINES,
                maxLines = EDITOR_MAX_LINES,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    label = stringResource(R.string.translation_powerGrafana_editor_copy),
                    onClick = performCopy,
                    variant = ButtonVariant.Primary,
                    enabled = state.canCopy,
                )
                Button(
                    label = stringResource(R.string.translation_powerGrafana_editor_clear),
                    onClick = onClear,
                    variant = ButtonVariant.Secondary,
                    enabled = state.canCopy,
                )
            }
            state.status?.let { status -> CopyStatusText(status) }
        }
    }
}

/** The localized, accessibility-announced copy outcome (web `statusMessage` with `role="status"`). */
@Composable
private fun CopyStatusText(status: GrafanaCopyStatus) {
    val message =
        when (status) {
            GrafanaCopyStatus.Empty -> stringResource(R.string.translation_powerGrafana_editor_copyEmpty)
            GrafanaCopyStatus.Unavailable -> stringResource(R.string.translation_powerGrafana_editor_copyUnavailable)
            GrafanaCopyStatus.Success -> stringResource(R.string.translation_powerGrafana_editor_copySuccess)
            GrafanaCopyStatus.Failed -> stringResource(R.string.translation_powerGrafana_editor_copyFailed)
        }
    BodyText(
        message,
        color = MaterialTheme.colorScheme.tertiary,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** GlassPanel 2 — the curated panel-type catalog (web "Curated panel types" GlassPanel). */
@Composable
private fun PanelTypesPanel() {
    GlassPanel {
        SectionStack {
            PanelTitle(stringResource(R.string.translation_powerGrafana_panelTypes_title))
            BodyText(
                stringResource(R.string.translation_powerGrafana_panelTypes_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SORTED_PANEL_TYPES.forEach { entry ->
                CatalogItemCard {
                    CodeText(entry.name)
                    HelperText(entry.description)
                }
            }
        }
    }
}

/** GlassPanel 3 — the curated datasource-type catalog (web "Curated datasource types" GlassPanel). */
@Composable
private fun DatasourceTypesPanel() {
    GlassPanel {
        SectionStack {
            PanelTitle(stringResource(R.string.translation_powerGrafana_datasourceTypes_title))
            BodyText(
                stringResource(R.string.translation_powerGrafana_datasourceTypes_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SORTED_DATASOURCE_TYPES.forEach { entry ->
                CatalogItemCard {
                    CodeText("${entry.name}  ·  uid=${entry.uid}")
                    HelperText(entry.description)
                }
            }
        }
    }
}

/** GlassPanel 4 — the curated postgres-target table catalog (web "Curated table catalog" GlassPanel). */
@Composable
private fun TablesPanel() {
    GlassPanel {
        SectionStack {
            PanelTitle(stringResource(R.string.translation_powerGrafana_tables_title))
            BodyText(
                stringResource(R.string.translation_powerGrafana_tables_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SORTED_TABLES.forEach { table ->
                CatalogItemCard {
                    CodeText(table.name)
                    HelperText(table.description)
                    Column(
                        modifier = Modifier.padding(top = Spacing.xs),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        table.columns.forEach { column ->
                            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                                CodeText(column.name)
                                HelperText("· ${column.type} — ${column.description}")
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A vertically-spaced stack for a GlassPanel's content (web `<Stack className="gap-4">`). */
@Composable
private fun SectionStack(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
        content = { content() },
    )
}

/**
 * One bordered catalog entry (web `rounded-md border p-3`), merged into a single TalkBack node so its identifier
 * + description are announced together. Content is laid out in a spaced column.
 */
@Composable
private fun CatalogItemCard(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(CATALOG_ITEM_BORDER, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            content = { content() },
        )
    }
}
