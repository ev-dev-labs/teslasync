// Compose render layer for the CommandSelectDialog modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/system/components/CommandSelectDialog.tsx). It is a thin shell over the pure
// [CommandSelectDialogProjection] derivations (CommandSelectDialogModel.kt): a Material 3 [Modal] hosting the
// icon + title header, the vertical list of selectable option cards (each an option label + optional description
// sub-line), and the end-aligned Cancel action. The view performs NO HTTP and binds no fetch — the web component's
// only data dependency is `useTranslation`; the option list arrives pre-built in the [def] (the page's static
// `commands.ts` config), and the chosen value is handed back to the owner through [onSelect] exactly as the web
// `onSelect(opt.value)` prop is.
//
// Web `open` prop -> early-return composition: the web passes `open` straight to its `components/ui/Modal`. The
// Compose idiom is to render nothing while closed (`if (!open) return`), so re-opening enters a fresh composition —
// the web `useEffect`-on-mount reset — and re-fires the one-shot `view.opened` diagnostic. This mirrors the sibling
// AcknowledgeAlertDialog entry.
//
// Dismiss semantics: the web binds Escape -> onClose (its `handleKeyDown`) and backdrop-click -> onClose (the Modal
// default); neither is suppressed while `loading` (the web Cancel button and dismiss stay live so a stuck dispatch is
// always escapable). The Compose [Modal] (a platform [androidx.compose.ui.window.Dialog]) routes system-back AND
// outside-tap to `onDismissRequest`; wiring it straight to `onClose` with `dismissOnBackdrop = true` reproduces both
// web behaviours (back is the platform equivalent of Escape).
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the header's `rounded-xl p-2.5 bg-[var(--surface-2)]
// text-[var(--text-secondary)]` icon chip maps to a neutral [IconBox]; the `text-base font-semibold` title maps to
// [SectionTitle]. Each option's `rounded-lg border p-3 bg-[var(--surface-2)]` card with its `hover:border-neon-cyan/30`
// + `focus:ring-neon-cyan/30` affordances maps to an [ButtonVariant.Outline] button (Material drives the hover/focus/
// pressed state layers); its `text-sm font-medium` label maps to [Subhead] (onSurface) and the `text-xs
// text-[var(--text-muted)]` descriptor to [Caption] (onSurfaceVariant). The `space-y-2` / `gap-*` insets map to
// `Spacing` tokens. The ghost Cancel maps to [ButtonVariant.Ghost]; like the web it is NOT disabled while a command
// dispatches, so the dialog is always escapable.
//
// Empty projection: when `selectConfig.options` carries nothing (a malformed config), the web maps an empty list to a
// blank `space-y-2` box. The native port renders a friendly [EmptyState] in its place (P3 "never a blank box"), keeping
// the header + Cancel visible so the surface is never hidden.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/CommandSelectDialog) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed because the file's primary export is the
// `CommandSelectDialog` composable (matching the filename); the co-located [CommandSelectDef] carrier + supporting
// declarations are helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandselectdialog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object CommandSelectDialogTestTags {
    const val ROOT: String = "command-select-dialog"
    const val OPTIONS: String = "command-select-dialog-options"
    const val EMPTY: String = "command-select-dialog-empty"
    const val CANCEL: String = "command-select-dialog-cancel"

    /** Per-option tag, stable on the option's [CommandSelectOption.value]. */
    fun option(value: String): String = "command-select-dialog-option-$value"
}

/**
 * The rendered slice of the web `def: CommandDef` this picker needs — its icon, its localized title, and its option
 * list. The owning command surface (which owns the `commands.ts` config + `useTranslation`) resolves the [icon] glyph
 * and the localized [title] (web `t(def.labelKey, def.labelFallback)`) and supplies the pre-localized [options] (web
 * `def.selectConfig.options`). Bundling these into one carrier keeps the stateless [CommandSelectDialogContent] a
 * trivially previewable + UI-testable function, mirroring how the web component reads everything off the single `def`
 * prop.
 *
 * @property icon the command's glyph, shown in the header chip (web `def.icon`).
 * @property title the localized command label, shown as the header title (web `t(def.labelKey, def.labelFallback)`).
 * @property options the selectable options to list (web `def.selectConfig.options`).
 */
data class CommandSelectDef(
    val icon: ImageVector,
    val title: String,
    val options: List<CommandSelectOption>,
)

/**
 * The component-owned microcopy resolved from the i18n catalog (P1/S10). The command title + option labels are
 * caller-supplied (localized by the owner, like the web `def`), so the ONLY strings this component owns are the Cancel
 * action label (web `t('common.cancel', 'Cancel')`), the modal close-button accessible name, and the empty-state
 * message shown when a malformed config carries no options.
 *
 * @property cancel the Cancel action label (web `t('common.cancel', 'Cancel')`).
 * @property closeDialog the modal close affordance's accessible name (TalkBack).
 * @property noOptions the friendly empty-state message shown when there are no options to pick.
 */
data class CommandSelectDialogStrings(
    val cancel: String,
    val closeDialog: String,
    val noOptions: String,
)

/** Resolves the component-owned [CommandSelectDialogStrings] from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberCommandSelectDialogStrings(): CommandSelectDialogStrings =
    CommandSelectDialogStrings(
        cancel = stringResource(R.string.translation_common_cancel),
        closeDialog = stringResource(R.string.translation_a11y_closeDialog),
        noOptions = stringResource(R.string.translation_common_noData),
    )

/**
 * Stateful entry point — the faithful port of the web `CommandSelectDialog({ open, onClose, onSelect, def, loading })`.
 * Renders nothing while [open] is false (the Compose idiom for the web `open` prop, so re-opening enters a fresh
 * composition), records the one-shot PII-safe `view.opened` diagnostic on open (P1/S11), and hosts the modal. The
 * chosen option's value is handed to [onSelect]; [onClose] dismisses (Cancel, system-back, backdrop) and — exactly like
 * the web — is never suppressed while [loading], so a stuck dispatch is always escapable. No HTTP, no store: the owner
 * owns both callbacks exactly as the web component's props are.
 *
 * @param open whether the dialog is shown (web `open`).
 * @param def the icon + localized title + options to render (web `def`).
 * @param onClose dismiss callback fired by Cancel, system-back, and backdrop (web `onClose`).
 * @param onSelect receives the chosen option's value (web `onSelect(opt.value)`).
 * @param loading when true every option disables (web `loading` -> `disabled={loading}`); Cancel stays live.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandSelectDialog(
    open: Boolean,
    def: CommandSelectDef,
    onClose: () -> Unit,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { CommandSelectDialogDiagnostics.recordViewOpened(logger) }
    val strings = rememberCommandSelectDialogStrings()
    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        accessibleName = def.title,
        closeLabel = strings.closeDialog,
        dismissOnBackdrop = true,
    ) {
        CommandSelectDialogContent(
            def = def,
            loading = loading,
            strings = strings,
            onSelect = onSelect,
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the icon + title header, the option list (or
 * a friendly empty state when there are none), and the end-aligned Cancel action. Every option disables together while
 * [loading]; Cancel stays enabled so the dialog is always escapable (web parity).
 */
@Composable
fun CommandSelectDialogContent(
    def: CommandSelectDef,
    loading: Boolean,
    strings: CommandSelectDialogStrings,
    onSelect: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(CommandSelectDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        CommandSelectHeader(icon = def.icon, title = def.title)

        if (CommandSelectDialogProjection.isEmpty(def.options)) {
            EmptyState(
                message = strings.noOptions,
                modifier = Modifier.testTag(CommandSelectDialogTestTags.EMPTY),
                icon = TeslaGlyphs.Info,
            )
        } else {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(CommandSelectDialogTestTags.OPTIONS),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                def.options.forEach { option ->
                    CommandOptionButton(
                        option = option,
                        enabled = CommandSelectDialogProjection.isOptionEnabled(loading),
                        onSelect = onSelect,
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                modifier = Modifier.testTag(CommandSelectDialogTestTags.CANCEL),
                variant = ButtonVariant.Ghost,
            )
        }
    }
}

/**
 * The icon + title header — the web `flex items-center gap-3` row of a neutral icon chip (web `rounded-xl p-2.5
 * bg-[var(--surface-2)]`) and the `text-base font-semibold` command title. The icon is decorative (web has no label on
 * it); the title carries the accessible meaning.
 */
@Composable
private fun CommandSelectHeader(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Neutral) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Md)
        }
        SectionTitle(title, modifier = Modifier.weight(1f))
    }
}

/**
 * One selectable option card — the web `ControlButton` styled as a `rounded-lg border p-3` card. Renders the option
 * [label][CommandSelectOption.label] (medium emphasis) and, when present, its description sub-line (web `opt.description
 * && (...)`). Disabled together with its siblings while a command dispatches (web `disabled={loading}`); choosing it
 * hands the option's value to [onSelect] (web `onSelect(opt.value)`).
 */
@Composable
private fun CommandOptionButton(
    option: CommandSelectOption,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = { onSelect(option.value) },
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(CommandSelectDialogTestTags.option(option.value)),
        variant = ButtonVariant.Outline,
        enabled = enabled,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            horizontalAlignment = Alignment.Start,
        ) {
            Subhead(option.label)
            CommandSelectDialogProjection.visibleDescription(option)?.let { description ->
                Caption(description)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    CommandSelectDialogStrings(
        cancel = "Cancel",
        closeDialog = "Close dialog",
        noOptions = "No data available",
    )

private val PREVIEW_DEF =
    CommandSelectDef(
        icon = TeslaGlyphs.Info,
        title = "Seat heater — front left",
        options =
            listOf(
                CommandSelectOption(value = "0", label = "Off", description = "Turn the seat heater off"),
                CommandSelectOption(value = "1", label = "Low"),
                CommandSelectOption(value = "2", label = "Medium"),
                CommandSelectOption(value = "3", label = "High", description = "Maximum heat"),
            ),
    )

@Preview(name = "Option list", showBackground = true, widthDp = 360)
@Composable
private fun CommandSelectDialogListPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSelectDialogContent(
            def = PREVIEW_DEF,
            loading = false,
            strings = PREVIEW_STRINGS,
            onSelect = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Dispatching (loading): options disabled", showBackground = true, widthDp = 360)
@Composable
private fun CommandSelectDialogLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSelectDialogContent(
            def = PREVIEW_DEF,
            loading = true,
            strings = PREVIEW_STRINGS,
            onSelect = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Empty: no options -> friendly empty state", showBackground = true, widthDp = 360)
@Composable
private fun CommandSelectDialogEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSelectDialogContent(
            def = PREVIEW_DEF.copy(options = emptyList()),
            loading = false,
            strings = PREVIEW_STRINGS,
            onSelect = {},
            onCancel = {},
        )
    }
}
