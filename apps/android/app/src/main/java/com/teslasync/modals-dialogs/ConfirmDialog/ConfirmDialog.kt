// The native Jetpack Compose + Material 3 ConfirmDialog modal/dialog — a parity port of the web
// `AiConfirmDialog` (web/src/components/ai/ConfirmDialog.tsx). The web component is the user-facing
// confirmation prompt for a dispatcher-paused mutating tool call: it surfaces what the assistant proposed
// (the tool name + optional description) and the proposed arguments rendered verbatim as pretty-printed JSON,
// behind explicit Approve / Cancel affordances so nothing fires automatically. This port reproduces every one
// of those branches with native primitives.
//
// Every derivation flows through the pure [ConfirmDialogProjection] + [ConfirmDialogDisplay]
// (ConfirmDialogModel.kt); the composable is a thin render layer. The only strings are resolved from the i18n
// catalog (P1/S10) `aiConfirm.*` keys — there is no English literal in this file. The one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// Web `open` prop -> host-gated composition: the web renders only when `open=true` (its Modal handles the
// render gate). The Compose idiom — prescribed by the shared `components/ui/Modal` KDoc — is to compose
// `ConfirmDialog(...)` conditionally (`if (open) ConfirmDialog(...)`), so this surface maps to the
// `open=true` render and the owning view gates it, exactly as the sibling IncidentForm dialog does.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the intro `text-sm text-[var(--text-primary)]` maps to
// [BodyText] (onSurface); the section labels `text-xs uppercase tracking-wide text-[var(--text-muted)]` map
// to [Caption] (onSurfaceVariant) — the CSS `uppercase` is presentation-only and intentionally not applied so
// the label keeps its localized casing for TalkBack; the tool name `font-mono` maps to [CodeText]; the
// description `text-[var(--text-secondary)]` maps to [HelperText] (onSurfaceVariant); the arguments `<pre>`
// (`rounded-md border-[var(--border-strong)] bg-[var(--surface-2)] p-3 font-mono overflow-auto`) maps to a
// rounded [Box] with an `outline` border, a `surfaceVariant` fill, `Spacing.md` padding, horizontal scroll,
// and a [CodeText] body. Web `gap-*` insets map to `Spacing` tokens.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ConfirmDialog) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.confirmdialog

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object ConfirmDialogTestTags {
    const val ROOT: String = "ai-confirm-dialog"
    const val TOOL_NAME: String = "ai-confirm-tool-name"
    const val ARGS: String = "ai-confirm-args"
    const val CANCEL: String = "ai-confirm-cancel"
    const val APPROVE: String = "ai-confirm-approve"
}

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless [ConfirmDialogContent] takes plain strings and stays trivially previewable +
 * UI-testable.
 */
data class ConfirmDialogStrings(
    val title: String,
    val introMutates: String,
    val introRead: String,
    val toolLabel: String,
    val argsLabel: String,
    val approve: String,
    val cancel: String,
    val close: String,
)

/** Resolves every [ConfirmDialogStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberConfirmDialogStrings(): ConfirmDialogStrings =
    ConfirmDialogStrings(
        title = stringResource(R.string.translation_aiConfirm_title),
        introMutates = stringResource(R.string.translation_aiConfirm_introMutates),
        introRead = stringResource(R.string.translation_aiConfirm_introRead),
        toolLabel = stringResource(R.string.translation_aiConfirm_toolLabel),
        argsLabel = stringResource(R.string.translation_aiConfirm_argsLabel),
        approve = stringResource(R.string.translation_aiConfirm_run),
        cancel = stringResource(R.string.translation_aiConfirm_cancel),
        close = stringResource(R.string.translation_aiConfirm_close),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `AiConfirmDialog({ open, tool, args, onConfirm,
 * onCancel, loading })`. Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11),
 * projects the props via the pure [ConfirmDialogProjection], resolves the localized copy, and renders the
 * modal. The owning view gates composition (web `open`); see the file header.
 *
 * @param tool the tool metadata from the dispatcher's `confirm_request` SSE frame (web `tool`).
 * @param args the proposed arguments object, or `null` for a tool with no input (web `args`).
 * @param onConfirm Approve handler; the owner forwards the decision to the continuation endpoint (web
 *   `onConfirm`).
 * @param onCancel Cancel/dismiss handler; the owner MUST close the dialog AND notify the continuation
 *   endpoint that the user denied so the dispatcher releases the paused state (web `onCancel`).
 * @param loading when true both buttons disable, Approve shows a spinner, and the dialog cannot be dismissed —
 *   used while the continuation POST is in flight (web `loading`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConfirmDialog(
    tool: AiToolPreview,
    args: JsonObject?,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordConfirmDialogOpened(logger) }

    val display = remember(tool, args) { ConfirmDialogProjection.project(tool, args) }
    val strings = rememberConfirmDialogStrings()

    Modal(
        // Web `onClose={loading ? () => undefined : onCancel}`: the dialog cannot be dismissed in flight.
        onDismissRequest = { if (!loading) onCancel() },
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
        dismissOnBackdrop = !loading,
    ) {
        ConfirmDialogContent(
            display = display,
            strings = strings,
            loading = loading,
            onConfirm = onConfirm,
            onCancel = onCancel,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the intro copy, the tool section
 * (label + monospaced name + optional description), the arguments block (pretty-printed JSON), and the
 * end-aligned Cancel / Approve actions. Both actions disable while [loading]; Approve also shows a spinner.
 */
@Composable
fun ConfirmDialogContent(
    display: ConfirmDialogDisplay,
    strings: ConfirmDialogStrings,
    loading: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ConfirmDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BodyText(text = if (display.mutates) strings.introMutates else strings.introRead)

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(text = strings.toolLabel)
            CodeText(text = display.toolName, modifier = Modifier.testTag(ConfirmDialogTestTags.TOOL_NAME))
            display.toolDescription?.let { description -> HelperText(text = description) }
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(text = strings.argsLabel)
            ArgsBlock(json = display.argsJson)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                modifier = Modifier.testTag(ConfirmDialogTestTags.CANCEL),
                variant = ButtonVariant.Secondary,
                enabled = !loading,
            )
            Button(
                label = strings.approve,
                onClick = onConfirm,
                modifier = Modifier.testTag(ConfirmDialogTestTags.APPROVE),
                variant = ButtonVariant.Primary,
                enabled = !loading,
                loading = loading,
            )
        }
    }
}

/**
 * The arguments block — the web `<pre>` rendering the proposed tool arguments verbatim as pretty-printed JSON.
 * A rounded, `outline`-bordered, `surfaceVariant`-filled, horizontally-scrollable surface hosting a
 * monospaced [CodeText], so a long JSON line never clips and the user can inspect exactly what will happen.
 */
@Composable
private fun ArgsBlock(
    json: String,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.md)
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .horizontalScroll(rememberScrollState())
                .padding(Spacing.md)
                .testTag(ConfirmDialogTestTags.ARGS),
    ) {
        CodeText(text = json)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private const val PREVIEW_ARGS_JSON = "{\n  \"rule_id\": 42,\n  \"threshold\": 80\n}"

private val previewStrings =
    ConfirmDialogStrings(
        title = "Approve Helix action",
        introMutates = "The assistant wants to make a change to your data. Review what it will do, then approve or cancel.",
        introRead = "The assistant wants to run a tool. Review the inputs, then approve or cancel.",
        toolLabel = "Tool",
        argsLabel = "Arguments",
        approve = "Approve",
        cancel = "Cancel",
        close = "Close",
    )

@Preview(name = "Mutating tool, with description + args", showBackground = true, widthDp = 360)
@Composable
private fun ConfirmDialogMutatingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConfirmDialogContent(
            display =
                ConfirmDialogDisplay(
                    toolName = "set_alert_threshold",
                    toolDescription = "Update an alert rule threshold.",
                    mutates = true,
                    argsJson = PREVIEW_ARGS_JSON,
                ),
            strings = previewStrings,
            loading = false,
            onConfirm = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Read-only tool, no description, empty args", showBackground = true, widthDp = 360)
@Composable
private fun ConfirmDialogReadOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConfirmDialogContent(
            display =
                ConfirmDialogDisplay(
                    toolName = "query_vehicle_count",
                    toolDescription = null,
                    mutates = false,
                    argsJson = "{}",
                ),
            strings = previewStrings,
            loading = false,
            onConfirm = {},
            onCancel = {},
        )
    }
}

@Preview(name = "In-flight (loading): actions disabled, spinner", showBackground = true, widthDp = 360)
@Composable
private fun ConfirmDialogLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConfirmDialogContent(
            display =
                ConfirmDialogDisplay(
                    toolName = "set_alert_threshold",
                    toolDescription = "Update an alert rule threshold.",
                    mutates = true,
                    argsJson = PREVIEW_ARGS_JSON,
                ),
            strings = previewStrings,
            loading = true,
            onConfirm = {},
            onCancel = {},
        )
    }
}
