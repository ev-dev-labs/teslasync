// The native Jetpack Compose + Material 3 BulkActionsToolbar shared surface — a parity port of
// web/src/components/data-display/BulkActionsToolbar.tsx. The web surface is a controlled, presentational
// selection toolbar: a sticky bar that appears above a list when one or more rows are selected, showing a live
// "{n} selected" count (+ an optional "{noun} of {total}"), the per-page action buttons (each with an optional
// icon, a danger variant, a per-action busy spinner, and an optional destructive confirm), and a ghost "Clear
// selection" button. It renders nothing when nothing is selected, so a consumer can mount it unconditionally.
//
// All interaction flows through the shared [BulkActionsToolbarViewModel] (P1/S8): the per-action in-flight set
// and the `useConfirm` round-trip live there, never in the view. Every visible string resolves through the i18n
// catalog (P1/S10) and every interactive element carries a TalkBack label. The atomic chrome (Button, GlassPanel,
// ConfirmDialog) is reused from the shared component library; this surface only composes them.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content /
// error / stale / offline contract is mapped onto this controlled surface's real behaviour, because it performs
// no data fetch (see BulkActionsToolbarModel.kt). `empty` is the web `count === 0` null render
// ([ToolbarSurface.Hidden]); `content` is the toolbar; `loading` is a per-action spinner; `error` is a failed
// action re-enabling for retry (the web source renders no error surface); `stale`/`offline` do not apply.
//
// Divergence note: the web component computes a default noun from `bulk.itemDefault` but only renders a noun
// when an explicit `itemNoun` is supplied. This port reproduces that exactly — the noun row appears only with an
// [BulkItemNoun] — so the toolbar never shows a half-built label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * One bulk action rendered in a [BulkActionsToolbar] — the native analogue of the web `BulkAction`.
 *
 * @property id stable id used as the render key and for action telemetry (web `id`).
 * @property label the already-translated button label (web `label`).
 * @property onClick invoked with the current selection when the action runs; should suspend until the mutation
 *   completes, driving the per-action spinner. Throwing leaves the selection intact for retry (web `onClick`).
 * @property icon optional leading icon (web `icon`).
 * @property intent visual intent; [BulkActionIntent.Danger] switches to a danger button (web `variant`).
 * @property confirm when set, routes the action through the shared confirm dialog first (web `confirm`).
 * @property disabled disables the action regardless of selection, e.g. a feature gate (web `disabled`).
 */
data class BulkAction(
    val id: String,
    val label: String,
    val onClick: suspend (selectedIds: List<String>) -> Unit,
    val icon: ImageVector? = null,
    val intent: BulkActionIntent = BulkActionIntent.Default,
    val confirm: BulkConfirmCopy? = null,
    val disabled: Boolean = false,
)

/**
 * Stateful entry point — the faithful port of the web `BulkActionsToolbar`. Binds the selection + the
 * `useConfirm` round-trip through a [BulkActionsToolbarViewModel], records the one-shot `view.opened`
 * diagnostic, threads the host's [selectedIds] (web prop), collects the live pending + confirm state, and
 * renders the toolbar plus its confirm dialog. The surface performs no business logic; [logger] defaults to the
 * process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param selectedIds the currently selected row identifiers (web `selectedIds`).
 * @param onClear clears the selection, wired to the "Clear selection" button (web `onClear`).
 * @param actions the per-page action definitions, rendered in order (web `actions`).
 * @param total the total visible rows for the optional "of {total}" suffix (web `total`).
 * @param itemNoun optional already-localized count noun, e.g. drive(s) (web `itemNoun`).
 */
@Composable
fun BulkActionsToolbar(
    selectedIds: List<String>,
    onClear: () -> Unit,
    actions: List<BulkAction>,
    modifier: Modifier = Modifier,
    total: Int? = null,
    itemNoun: BulkItemNoun? = null,
    confirmer: BulkConfirmer = remember { bulkConfirmer() },
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = BULK_ACTIONS_TOOLBAR_SLUG,
) {
    val viewModel: BulkActionsToolbarViewModel =
        viewModel(key = instanceKey, factory = BulkActionsToolbarViewModel.factory(confirmer, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, selectedIds) { viewModel.setSelection(selectedIds) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val confirmRequest by viewModel.confirmDialog.collectAsStateWithLifecycle()

    val defaultConfirmLabel = stringResource(R.string.translation_common_confirm)

    BulkActionsToolbarContent(
        selectedCount = selectedIds.size,
        total = total,
        itemNoun = itemNoun,
        actions = actions,
        pending = state.pending,
        onRun = { action ->
            viewModel.run(action.id, action.confirm?.toRequest(defaultConfirmLabel, action.intent)) { ids ->
                action.onClick(ids)
            }
        },
        onClear = onClear,
        modifier = modifier,
    )

    ConfirmDialogHost(
        request = confirmRequest,
        onConfirm = { viewModel.respondToConfirm(true) },
        onCancel = { viewModel.respondToConfirm(false) },
    )
}

/** Resolves the already-localized [BulkConfirmRequest] for this copy, defaulting the confirm label + severity. */
private fun BulkConfirmCopy.toRequest(
    defaultConfirmLabel: String,
    intent: BulkActionIntent,
): BulkConfirmRequest =
    BulkConfirmRequest(
        title = title,
        message = description,
        confirmLabel = confirmLabel ?: defaultConfirmLabel,
        severity = confirmSeverityFor(intent),
    )

/**
 * Stateless renderer — the unit/preview entry point. Classifies the selection into a [ToolbarSurface] and
 * renders the toolbar, or renders nothing when nothing is selected (web `if (count === 0) return null`). Every
 * action invokes [onRun]; the per-action spinner is driven by membership in [pending].
 */
@Composable
fun BulkActionsToolbarContent(
    selectedCount: Int,
    total: Int?,
    itemNoun: BulkItemNoun?,
    actions: List<BulkAction>,
    pending: Set<String>,
    onRun: (BulkAction) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val surface = classifyToolbar(selectedCount, total)
    if (surface !is ToolbarSurface.Visible) return

    val regionLabel = stringResource(R.string.translation_bulk_toolbarLabel)
    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = regionLabel },
        padding = PanelPadding.Sm,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SelectionCountChip(count = surface.count)
            if (itemNoun != null) {
                ToolbarNoun(noun = itemNoun.forCount(surface.count), total = surface.total)
            }
            Spacer(Modifier.weight(1f))
            actions.forEach { action ->
                BulkActionButton(action = action, busy = action.id in pending, onRun = onRun)
            }
            Button(
                label = stringResource(R.string.translation_bulk_clear),
                onClick = onClear,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The live "{n} selected" count chip — a polite live region so TalkBack announces selection changes. */
@Composable
private fun SelectionCountChip(count: Int) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Text(
            text = pluralStringResource(R.plurals.translation_bulk_selected, count, count),
            modifier =
                Modifier
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

/** The optional "{noun} of {total}" suffix — rendered only when the consumer supplies an explicit noun. */
@Composable
private fun ToolbarNoun(
    noun: String,
    total: Int?,
) {
    val text =
        if (total != null) {
            "$noun ${stringResource(R.string.translation_bulk_ofTotal, total)}"
        } else {
            noun
        }
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** One action button — danger/secondary variant, optional icon, per-action busy spinner + TalkBack label. */
@Composable
private fun BulkActionButton(
    action: BulkAction,
    busy: Boolean,
    onRun: (BulkAction) -> Unit,
) {
    val busyLabel = stringResource(R.string.translation_a11y_loading)
    Button(
        label = action.label,
        onClick = { onRun(action) },
        modifier =
            Modifier.semantics {
                contentDescription = actionContentDescription(action.label, busy, busyLabel)
            },
        variant = if (action.intent == BulkActionIntent.Danger) ButtonVariant.Danger else ButtonVariant.Secondary,
        size = ButtonSize.Sm,
        enabled = !action.disabled && !busy,
        loading = busy,
        leadingIcon = action.icon,
    )
}

/** Renders the shared confirm dialog when a confirmation is open (web `dialogProps && <ConfirmDialog />`). */
@Composable
private fun ConfirmDialogHost(
    request: BulkConfirmRequest?,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    if (request == null) return
    ConfirmDialog(
        title = request.title,
        message = request.message,
        confirmLabel = request.confirmLabel,
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity =
            when (request.severity) {
                BulkConfirmSeverity.Danger -> ConfirmSeverity.Danger
                BulkConfirmSeverity.Warning -> ConfirmSeverity.Warning
            },
        closeLabel = stringResource(R.string.translation_common_close),
    )
}

@Preview(name = "Selection — actions", showBackground = true)
@Composable
private fun BulkActionsToolbarActionsPreview() {
    TeslaSyncTheme {
        BulkActionsToolbarContent(
            selectedCount = 3,
            total = 27,
            itemNoun = BulkItemNoun(one = "drive", other = "drives"),
            actions =
                listOf(
                    BulkAction(id = "export", label = "Export CSV", onClick = {}),
                    BulkAction(id = "delete", label = "Delete", intent = BulkActionIntent.Danger, onClick = {}),
                ),
            pending = emptySet(),
            onRun = {},
            onClear = {},
        )
    }
}

@Preview(name = "Selection — action busy", showBackground = true)
@Composable
private fun BulkActionsToolbarBusyPreview() {
    TeslaSyncTheme {
        BulkActionsToolbarContent(
            selectedCount = 1,
            total = null,
            itemNoun = null,
            actions = listOf(BulkAction(id = "archive", label = "Archive", onClick = {})),
            pending = setOf("archive"),
            onRun = {},
            onClear = {},
        )
    }
}
