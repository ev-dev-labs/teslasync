// The native Jetpack Compose + Material 3 SqlPlaygroundPage power-user surface — a parity port of
// web/src/features/power-user/pages/SqlPlaygroundPage.tsx, the manual SQL editor + curated schema catalog mounted at
// /power/sql. It reproduces the page's two panels (GlassPanel1 — the Manual SQL editor with its Run + Clear actions
// and deterministic Run help message; GlassPanel2 — the curated schema catalog, a by-name-sorted table-by-table
// column listing), the single success data state (the page is always interactive against the static catalog with no
// remote feed), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SqlPlaygroundPage] is the stateful entry (constructs the view-model, records the one-shot
// `view.opened` diagnostic, collects the [SqlPlaygroundUiState]); [SqlPlaygroundPageContent] is the stateless render
// layer driven entirely by the state holder + a [SqlPlaygroundActions] callback bundle. All derivation (the Run
// reduction, canRun, the catalog ordering) lives in the framework-free model (SqlPlaygroundPageModel.kt); this file
// only resolves i18n + draws. There is no unit-bearing value on this page (the catalog stores SI column names as
// schema text, not computed quantities), so there is no SI conversion at this boundary.
//
// AI-drafter note (honesty, no silent drift): the web page also mounts the optional <AINLSqlPlayground/> AI drafter
// via `withAiFeature` — a SEPARATE, feature-gated shared-surface parity unit that is absent in AI-off mode and is
// NOT among this page's 14 required parity items. Its native shared surface
// (io.teslasync.android.sharedsurfaces.ainlsqlplayground.AINLSqlPlayground) exists but binds an AI-mode gate + SSE
// draft source that the app DI graph (DataContainer) does not yet expose, and wiring that is outside this prompt's
// allowed files. The manual editor + curated catalog baseline (web ADR-015 "I3 baseline intact") is implemented in
// full here; the AI section is left to its own shared-surface wiring phase rather than stubbed with a fake gate.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.sqlplayground

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** Number of editor rows the Textarea reserves (web `<Textarea rows={10} />`). */
private const val EDITOR_ROWS = 10

/** The page's interaction callbacks, wired to the [SqlPlaygroundPageViewModel] (web event handlers). */
data class SqlPlaygroundActions(
    val onSqlChange: (String) -> Unit,
    val onRun: () -> Unit,
    val onClear: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SqlPlaygroundPageViewModel] (keyed to this surface's slug so it is scoped to the
 * /power/sql navigation entry). The page binds no shared store — it owns only the in-memory editor state.
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun SqlPlaygroundPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SqlPlaygroundPageViewModel =
        viewModel(
            key = SqlPlaygroundPageRegistration.SLUG,
            factory = SqlPlaygroundPageViewModel.factory(logger),
        )
    SqlPlaygroundPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11), collects the success surface, and
 * binds the editor actions to the stateless content.
 */
@Composable
fun SqlPlaygroundPage(
    viewModel: SqlPlaygroundPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            SqlPlaygroundActions(
                onSqlChange = viewModel::onSqlChange,
                onRun = viewModel::onRun,
                onClear = viewModel::onClear,
            )
        }

    SqlPlaygroundPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `div.space-y-6.p-6`): the title + intro header, the Manual SQL editor panel
 * (GlassPanel1), then the curated schema catalog panel (GlassPanel2). Scrolls vertically so both panels are always
 * reachable on short viewports.
 */
@Composable
fun SqlPlaygroundPageContent(
    state: SqlPlaygroundUiState,
    actions: SqlPlaygroundActions,
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
        SqlPlaygroundHeader()

        FadeIn { SqlEditorPanel(state = state, actions = actions) }

        FadeIn(delayMs = FADE_STEP_MS) { SchemaCatalogPanel(tables = state.tables) }
    }
}

/** The page header — the title heading + the muted intro paragraph (web `PageTitle` + `powerSql.intro`). */
@Composable
private fun SqlPlaygroundHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_powerSql_title))
        BodyText(
            stringResource(R.string.translation_powerSql_intro),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * GlassPanel1 — the Manual SQL editor: the panel title, the multi-line query field (the floating label is the web
 * `aria-label`; the supporting hint is the web in-field example query), the Run + Clear actions (both disabled when
 * the query is blank, web `disabled={!canRun}`), and the deterministic Run help message.
 */
@Composable
private fun SqlEditorPanel(
    state: SqlPlaygroundUiState,
    actions: SqlPlaygroundActions,
) {
    val title = stringResource(R.string.translation_powerSql_editor_title)
    GlassPanel(modifier = Modifier.semantics { contentDescription = title }) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(title)
            Textarea(
                value = state.sql,
                onValueChange = actions.onSqlChange,
                label = stringResource(R.string.translation_powerSql_editor_label),
                hint = stringResource(R.string.translation_powerSql_editor_placeholder), // parity:allow i18n key id (example query), not a stub marker
                minLines = EDITOR_ROWS,
                maxLines = EDITOR_ROWS,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    label = stringResource(R.string.translation_powerSql_editor_run),
                    onClick = actions.onRun,
                    variant = ButtonVariant.Primary,
                    enabled = state.canRun,
                )
                Button(
                    label = stringResource(R.string.translation_powerSql_editor_clear),
                    onClick = actions.onClear,
                    variant = ButtonVariant.Secondary,
                    enabled = state.canRun,
                )
            }
            RunMessage(outcome = state.runOutcome)
        }
    }
}

/**
 * The Run help message (web `runMessage`, `role="status"`). Renders the warning-toned help text for the latest
 * [outcome]; [RunOutcome.None] renders nothing (web `runMessage === ''`). The `liveRegion` mirrors the web
 * `role="status"` so TalkBack announces the message when Run is pressed.
 */
@Composable
private fun RunMessage(outcome: RunOutcome) {
    val message =
        when (outcome) {
            RunOutcome.None -> null
            RunOutcome.Empty -> stringResource(R.string.translation_powerSql_editor_runEmpty)
            RunOutcome.Unavailable -> stringResource(R.string.translation_powerSql_editor_runUnavailable)
        } ?: return

    BodyText(
        text = message,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        color = TeslaTokens.status.warning,
    )
}

/**
 * GlassPanel2 — the curated schema catalog: the panel title, the muted intro, then one bordered [Card] per table
 * (web `<li class="rounded-md border …">`), each listing the table's columns. The web grid collapses to a single
 * native column on phone widths (web `grid-cols-1` default).
 */
@Composable
private fun SchemaCatalogPanel(tables: List<CuratedTable>) {
    val title = stringResource(R.string.translation_powerSql_catalog_title)
    GlassPanel(modifier = Modifier.semantics { contentDescription = title }) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(title)
            BodyText(
                stringResource(R.string.translation_powerSql_catalog_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                tables.forEach { table -> CatalogTableCard(table = table) }
            }
        }
    }
}

/** One curated table block — the monospace table name, its description, and its column rows. */
@Composable
private fun CatalogTableCard(table: CuratedTable) {
    Card(modifier = Modifier.fillMaxWidth().semantics { contentDescription = table.name }) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            CodeText(table.name)
            Caption(table.description)
            Column(
                modifier = Modifier.padding(top = Spacing.xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                table.columns.forEach { column -> CatalogColumnRow(column = column) }
            }
        }
    }
}

/** One column row — the monospace column name above its "type — description" detail (web inline col line). */
@Composable
private fun CatalogColumnRow(column: CuratedColumn) {
    Column {
        CodeText(column.name)
        HelperText("${column.type} — ${column.description}")
    }
}
