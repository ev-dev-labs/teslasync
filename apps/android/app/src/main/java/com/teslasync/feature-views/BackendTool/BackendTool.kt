// The native Jetpack Compose + Material 3 BackendTool feature view — a parity port of
// web/src/features/admin/components/devtools/BackendTool.tsx. The web component is a GENERIC, reusable
// tool wrapper: a `ToolCard` (caller-supplied icon/color/title/description) around its `children`, a
// primary `Run` button bound to a TanStack `useMutation` over `apiFetch('/dev-tools/{endpoint}', …)`, a
// success/failed `Badge` shown once a run completes, and a `ResultPanel`. This port reuses the SAME two
// shared surfaces the web composes — the stateless `ToolCardContent` and `ResultPanelContent` — and adds
// the Run button + badge between them.
//
// Every rendered branch the web defines is reproduced (see BackendToolModel.kt for the full mapping):
// idle (no run → the result panel's friendly "no result yet" branch, never a blank box), running (the Run
// button's spinner, web `mutation.isPending`), success (a "Success" badge + the pretty-printed payload),
// and failure (a "Failed" badge + the error line — the branch a non-throwing transport/offline failure
// also folds into, web `apiFetch` catch → `{ error }`). The badge is gated on a completed run (web
// `{mutation.data && …}`); the result panel is always shown so the surface is never hidden (the prompt's
// no-hidden-surface mandate, and the sibling FleetApiSection's rendering of its result panels). All data
// flows through the shared [BackendToolViewModel] (P1/S8); the view performs no HTTP (ADR-002). The three
// surface-owned strings resolve through the i18n boundary (P1/S10): `Run` / `Success` / `Failed` and the
// `No result yet` idle message; the caller-supplied title/description arrive already localized (web
// parity — the `title`/`description` props are translated at the call site). Every interactive element
// (the Run button, the result panel's copy affordance) carries an accessible label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendTool) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendtool

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.feature.views.resultpanel.ResultPanelContent
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Collects the shared [BackendToolViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model (wired via
 * [BackendToolViewModel.factory] over the endpoint's [BackendToolPort]) and the presentation inputs.
 *
 * @param viewModel the state holder bound to the configured dev-tools mutation.
 * @param icon the leading glyph for the [ToolCardContent] header (web `icon`).
 * @param color the accent key (`cyan`/`green`/`purple`/`amber`/`red`); unknown folds to cyan (web `color`).
 * @param title the already-localized card title (web `title`).
 * @param description the already-localized one-line description (web `description`).
 * @param content the optional card body shown above the Run button (web `children`).
 */
@Composable
fun BackendTool(
    viewModel: BackendToolViewModel,
    icon: ImageVector,
    color: String,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    BackendToolContent(
        state = state,
        icon = icon,
        color = color,
        title = title,
        description = description,
        modifier = modifier,
        onRun = viewModel::run,
        content = content,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web composition exactly: a
 * [ToolCardContent] wrapping the optional [content] body, the Run button row (the primary `Run` button +
 * the success/failed badge once a run completes), and the [ResultPanelContent]. Hoisted out of the
 * view-model so every state is preview- and screenshot-testable with a hand-built [BackendToolActionState].
 */
@Composable
fun BackendToolContent(
    state: BackendToolActionState,
    icon: ImageVector,
    color: String,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    onRun: () -> Unit = {},
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val display = remember(state) { BackendToolProjection.project(state) }
    ToolCardContent(
        icon = icon,
        color = color,
        title = title,
        description = description,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (content != null) content()
            BackendToolRunRow(display = display, onRun = onRun)
            BackendToolResult(title = title, display = display)
        }
    }
}

/** The Run button + (once a run completes) the success/failed badge — web `mt-3 flex items-center gap-2`. */
@Composable
private fun BackendToolRunRow(
    display: BackendToolDisplay,
    onRun: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_Run),
            onClick = onRun,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            loading = display.running,
            leadingIcon = BackendToolGlyphs.Play,
        )
        if (display.showBadge) {
            BackendToolBadge(display.outcome)
        }
    }
}

/** The outcome badge — web `<Badge variant={data.error ? 'danger' : 'success'} dot>`. */
@Composable
private fun BackendToolBadge(outcome: BackendToolOutcome?) {
    when (outcome) {
        BackendToolOutcome.Success ->
            Badge(text = stringResource(R.string.translation_Success), variant = BadgeVariant.Success, dot = true)

        BackendToolOutcome.Failure ->
            Badge(text = stringResource(R.string.translation_Failed), variant = BadgeVariant.Danger, dot = true)

        null -> Unit
    }
}

/**
 * The result disclosure — the shared [ResultPanelContent] fed the projected data/error. Always rendered
 * (idle/running show the localized "No result yet" branch) so the surface is never a blank box, while a
 * completed run shows the pretty-printed payload or the error line.
 */
@Composable
private fun BackendToolResult(
    title: String,
    display: BackendToolDisplay,
) {
    ResultPanelContent(
        title = title,
        idleMessage = stringResource(R.string.translation_devtools_noResult),
        data = display.resultData,
        error = display.resultError,
    )
}

// ── Previews — one per rendered state (idle / running / success / failure) + a children-slot sample ──────

private val PREVIEW_ICON: ImageVector = BackendToolGlyphs.Play
private const val PREVIEW_COLOR = "cyan"
private const val PREVIEW_TITLE = "Config"
private const val PREVIEW_DESCRIPTION = "Fleet API configuration"

private val PREVIEW_SUCCESS_PAYLOAD: JsonObject =
    buildJsonObject {
        put("authenticated", true)
        put("baseUrl", "https://fleet-api.prd.na.vn.cloud.tesla.com")
        put("clientId", "ownerapi")
    }

@Preview(name = "BackendTool · idle", showBackground = true)
@Composable
private fun BackendToolIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackendToolContent(
            state = BackendToolActionState.Idle,
            icon = PREVIEW_ICON,
            color = PREVIEW_COLOR,
            title = PREVIEW_TITLE,
            description = PREVIEW_DESCRIPTION,
        )
    }
}

@Preview(name = "BackendTool · running", showBackground = true)
@Composable
private fun BackendToolRunningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackendToolContent(
            state = BackendToolActionState.Running,
            icon = PREVIEW_ICON,
            color = PREVIEW_COLOR,
            title = PREVIEW_TITLE,
            description = PREVIEW_DESCRIPTION,
        )
    }
}

@Preview(name = "BackendTool · success", showBackground = true)
@Composable
private fun BackendToolSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackendToolContent(
            state = BackendToolActionState.Done(BackendToolResponse.of(PREVIEW_SUCCESS_PAYLOAD)),
            icon = PREVIEW_ICON,
            color = "green",
            title = PREVIEW_TITLE,
            description = PREVIEW_DESCRIPTION,
        )
    }
}

@Preview(name = "BackendTool · failure", showBackground = true)
@Composable
private fun BackendToolFailurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackendToolContent(
            state = BackendToolActionState.Done(BackendToolResponse.ofError("503 Service Unavailable")),
            icon = PREVIEW_ICON,
            color = "red",
            title = PREVIEW_TITLE,
            description = PREVIEW_DESCRIPTION,
        )
    }
}

@Preview(name = "BackendTool · with body", showBackground = true)
@Composable
private fun BackendToolWithBodyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackendToolContent(
            state = BackendToolActionState.Idle,
            icon = PREVIEW_ICON,
            color = "amber",
            title = PREVIEW_TITLE,
            description = PREVIEW_DESCRIPTION,
        ) {
            Caption(PREVIEW_DESCRIPTION)
        }
    }
}
