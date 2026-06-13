// Compose render layer for the CommandConfirmDialog modal/dialog surface — the native analogue of the JSX the
// web component returns (web/src/features/system/components/CommandConfirmDialog.tsx). It is a thin shell over
// the pure [CommandConfirmDialogProjection] derivations (CommandConfirmDialogModel.kt): a Material 3 [Modal]
// hosting a red danger-tinted title row, the localized confirmation body, an optional typed-confirmation
// [Input] gate, and the end-aligned Cancel + Confirm actions, with Confirm armed by a per-second count-down.
// The view performs NO HTTP and binds no fetch — the web component's only data dependency is `useTranslation`;
// the decision is handed back to the owner through the [onClose] / [onConfirm] callbacks exactly as the web
// `onClose` / `onConfirm` props are.
//
// Web `open` prop -> internal render gate: the web renders only when `open=true` (its Modal handles the gate).
// This surface keeps the web 1:1 prop signature and reproduces the gate with an early `if (!open) return`
// before any state is remembered, so leaving the open state (owner sets `open=false`) discards the remembered
// count-down + typed-input state and the next open starts fresh — the native analogue of the web
// reset-on-reopen effect (`useEffect([open, countdown])` re-seeding `remaining` + clearing `inputValue`).
//
// Dismiss semantics: the web binds Escape -> onClose and backdrop-click -> onClose (neither suppressed while
// loading). The Compose [Modal] (a platform [androidx.compose.ui.window.Dialog]) routes system-back AND
// outside-tap to `onDismissRequest`; wiring it straight to `onClose` with `dismissOnBackdrop = true`
// reproduces both web behaviours (back is the platform equivalent of Escape).
//
// Title chrome: the web passes NO `title` to its Modal, so the shared Modal renders no header/close-X here;
// the danger affordance (`rounded-xl bg-red-500/10 text-red-400` box + AlertTriangle) and the heading live in
// the body. This surface mirrors that exactly — the atomic [Modal] is composed title-less (so it adds no
// header), the resolved title is fed to its `accessibleName` so TalkBack still announces the dialog (an
// accessibility improvement over the web, which labels the dialog with neither `title` nor `ariaLabel`), and
// the red icon box + [PanelTitle] are rendered as the first body row.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the `rounded-xl p-2.5 bg-red-500/10 text-red-400` icon box
// maps to a [RoundedCornerShape](Radius.md) [Box] with the danger accent at 10% alpha + the AlertTriangle glyph
// ([TeslaGlyphs.Warning]) tinted with the accent at [IconSize.Lg] (web `h-5 w-5`); the `text-base font-semibold`
// heading maps to [PanelTitle]; the `text-sm text-[var(--text-secondary)]` body maps to [BodyText]; the
// `text-xs text-[var(--text-muted)]` typed-confirmation prompt maps to [Caption]. Web `mb-*` / `gap-*` insets
// map to `Spacing` tokens. The web ghost Cancel maps to [ButtonVariant.Ghost] and the danger Confirm to
// [ButtonVariant.Danger]; both are the web `size="sm"` -> [ButtonSize.Sm].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/CommandConfirmDialog) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandconfirmdialog

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tags for the nodes the UI test selects. */
object CommandConfirmDialogTestTags {
    const val ROOT: String = "command-confirm-dialog"
    const val TITLE: String = "command-confirm-dialog-title"
    const val MESSAGE: String = "command-confirm-dialog-message"
    const val TYPED_INPUT: String = "command-confirm-dialog-typed-input"
    const val CANCEL: String = "command-confirm-dialog-cancel"
    const val CONFIRM: String = "command-confirm-dialog-confirm"
}

/**
 * The component-owned microcopy read from the i18n catalog (P1/S10). The web component owns three static
 * strings — `common.cancel`, `common.confirm`, and `commands.confirm.typeToConfirm` — plus the runtime-dynamic
 * `def.labelKey` / `def.confirmKey` it resolves through the catalog with a fallback. The static three are
 * resolved here; the dynamic two are resolved by [translatedOrFallback]. [closeDialog] names the (unrendered,
 * title-less) Modal's dismiss affordance for assistive tech.
 */
data class CommandConfirmDialogStrings(
    val cancel: String,
    val confirm: String,
    val closeDialog: String,
)

/** Resolves the component-owned [CommandConfirmDialogStrings] from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberCommandConfirmDialogStrings(): CommandConfirmDialogStrings =
    CommandConfirmDialogStrings(
        cancel = stringResource(R.string.translation_common_cancel),
        confirm = stringResource(R.string.translation_common_confirm),
        closeDialog = stringResource(R.string.translation_common_close),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `CommandConfirmDialog({ open, onClose, onConfirm,
 * def, loading })`. Gates composition on [open] (web `open`), records the one-shot, PII-safe `view.opened`
 * diagnostic on first composition (P1/S11), seeds + drains the arming count-down, owns the typed-confirmation
 * input state, resolves the dynamic title/body through the catalog, and renders the danger-tinted prompt.
 *
 * @param open whether the overlay is shown (web `open`); `false` renders nothing.
 * @param def the selected command's definition (web `def`); supplies the title/body keys, count-down, and the
 *   optional typed-confirmation token.
 * @param onClose dismiss handler (web `onClose`); fired by Cancel, the backdrop tap, and system back / Esc.
 * @param onConfirm confirm handler (web `onConfirm`); fired by the armed Confirm action.
 * @param loading when true Confirm shows a spinner and disables, and the confirm hand-off is suppressed
 *   (web `loading`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer` (P1/S11).
 */
@Composable
fun CommandConfirmDialog(
    open: Boolean,
    def: CommandConfirmDef,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return

    val initialRemaining = remember(def.countdown) { CommandConfirmDialogProjection.initialRemaining(def.countdown) }
    var remaining by remember { mutableIntStateOf(initialRemaining) }
    var typed by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { CommandConfirmDialogDiagnostics.recordViewOpened(logger) }
    LaunchedEffect(Unit) {
        while (remaining > 0) {
            delay(COUNTDOWN_INTERVAL_MS)
            remaining = CommandConfirmDialogProjection.tick(remaining)
        }
    }

    val strings = rememberCommandConfirmDialogStrings()
    val title = translatedOrFallback(def.labelKey, def.labelFallback)
    val message =
        translatedOrFallback(
            CommandConfirmDialogProjection.confirmMessageKey(def.confirmKey),
            CommandConfirmDialogProjection.confirmMessageFallback(def.confirmFallback, def.labelFallback),
        )
    val confirmToken = def.confirmInput
    val typePrompt =
        if (CommandConfirmDialogProjection.requiresTypedConfirmation(confirmToken)) {
            stringResource(R.string.translation_commands_confirm_typeToConfirm, confirmToken.orEmpty())
        } else {
            null
        }

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = null,
        accessibleName = title,
        closeLabel = strings.closeDialog,
        dismissOnBackdrop = true,
    ) {
        CommandConfirmDialogContent(
            title = title,
            message = message,
            typePrompt = typePrompt,
            typedFieldLabel = confirmToken,
            typed = typed,
            onTypedChange = { typed = it },
            cancelLabel = strings.cancel,
            confirmLabel = CommandConfirmDialogProjection.countdownConfirmLabel(strings.confirm, remaining),
            confirmEnabled = CommandConfirmDialogProjection.canConfirm(remaining, confirmToken, typed),
            loading = loading,
            onCancel = onClose,
            onConfirm = onConfirm,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the danger title row, the
 * confirmation body, the optional typed-confirmation field, and the end-aligned Cancel / Confirm actions.
 * Confirm is enabled only when [confirmEnabled] (the projected `canConfirm`) and additionally disables +
 * shows a spinner while [loading]. The typed-confirmation field renders only when [typePrompt] is non-null
 * (web truthiness of `confirmInput`).
 */
@Composable
fun CommandConfirmDialogContent(
    title: String,
    message: String,
    typePrompt: String?,
    typedFieldLabel: String?,
    typed: String,
    onTypedChange: (String) -> Unit,
    cancelLabel: String,
    confirmLabel: String,
    confirmEnabled: Boolean,
    loading: Boolean,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(CommandConfirmDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DangerTitleRow(title = title)

        BodyText(text = message, modifier = Modifier.testTag(CommandConfirmDialogTestTags.MESSAGE))

        if (typePrompt != null) {
            TypedConfirmationField(
                prompt = typePrompt,
                fieldLabel = typedFieldLabel.orEmpty(),
                typed = typed,
                onTypedChange = onTypedChange,
                enabled = !loading,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = cancelLabel,
                onClick = onCancel,
                modifier = Modifier.testTag(CommandConfirmDialogTestTags.CANCEL),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !loading,
            )
            Button(
                label = confirmLabel,
                onClick = onConfirm,
                modifier = Modifier.testTag(CommandConfirmDialogTestTags.CONFIRM),
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
                enabled = confirmEnabled,
                loading = loading,
            )
        }
    }
}

/**
 * The destructive title row — the web `<div className="flex items-center gap-3 mb-4">` hosting the
 * `rounded-xl p-2.5 bg-red-500/10 text-red-400` AlertTriangle box and the `text-base font-semibold` heading.
 * The danger accent (P1/S9 [TeslaTokens.status.danger]) tints the glyph at full strength and the box fill at
 * 10% alpha; the icon is decorative (web has no accessible name on it) — the heading carries the meaning.
 */
@Composable
private fun DangerTitleRow(
    title: String,
    modifier: Modifier = Modifier,
) {
    val accent = TeslaTokens.status.danger
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(CommandConfirmDialogTestTags.TITLE),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(Radius.md))
                    .background(accent.copy(alpha = ICON_BOX_ALPHA))
                    .padding(Spacing.sm),
        ) {
            Icon(imageVector = TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Lg, tint = accent)
        }
        PanelTitle(text = title, modifier = Modifier.weight(1f))
    }
}

/**
 * The typed-confirmation gate — the web `{confirmInput && (<div><p>{typeToConfirm}</p><Input .../></div>)}`.
 * The `text-xs text-[var(--text-muted)]` instruction maps to [Caption]; the web inline ghost prompt (its
 * `Input` ghost slot set to `confirmInput`) maps to the field's floating [label] — the design-system [Input]
 * exposes no inline ghost slot — which doubles as the field's accessible name for TalkBack. Disabled while the
 * command is in flight.
 */
@Composable
private fun TypedConfirmationField(
    prompt: String,
    fieldLabel: String,
    typed: String,
    onTypedChange: (String) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(text = prompt)
        Input(
            value = typed,
            onValueChange = onTypedChange,
            modifier = Modifier.testTag(CommandConfirmDialogTestTags.TYPED_INPUT),
            label = fieldLabel,
            enabled = enabled,
        )
    }
}

/**
 * Resolves a runtime-dynamic i18n key against the generated P1/S10 catalog, falling back to [fallback] when
 * the key is blank or absent — the faithful native analogue of the web `t(key, fallback)` used for
 * `def.labelKey` / `def.confirmKey`. The command label/confirm keys are not part of the curated Android catalog
 * today (nor of the web `en.json`), so resolution returns the owner-supplied [fallback] exactly as the web does;
 * the lookup is structured so a future catalog addition resolves automatically. `DiscouragedApi` is suppressed
 * because dynamic-key resolution is precisely what `getIdentifier` exists for; the gate does not run Android
 * lint, and the deterministic `translation_<dotted→underscored>` scheme is owned by apps/shared/i18n.
 */
@Composable
@Suppress("DiscouragedApi")
private fun translatedOrFallback(
    key: String,
    fallback: String,
): String {
    if (key.isBlank()) return fallback
    val context = LocalContext.current
    val resId =
        remember(key, context) {
            context.resources.getIdentifier(TRANSLATION_PREFIX + key.replace('.', '_'), STRING_RES_TYPE, context.packageName)
        }
    return if (resId != 0) stringResource(resId) else fallback
}

// Web `bg-red-500/10` icon box fill -> the danger accent at this alpha.
private const val ICON_BOX_ALPHA = 0.10f

// The arming count-down cadence — the web `setInterval(…, 1000)`.
private const val COUNTDOWN_INTERVAL_MS = 1000L

// Generated-catalog key scheme (apps/shared/i18n): `commands.foo.bar` -> `translation_commands_foo_bar`.
private const val TRANSLATION_PREFIX = "translation_"
private const val STRING_RES_TYPE = "string"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

@Preview(name = "Count-down arming + typed gate (ERASE)", showBackground = true, widthDp = 360)
@Composable
private fun CommandConfirmDialogCountdownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandConfirmDialogContent(
            title = "Erase Data",
            message = "This will erase all user data from the vehicle touchscreen. Continue?",
            typePrompt = "Type \"ERASE\" to confirm:",
            typedFieldLabel = "ERASE",
            typed = "",
            onTypedChange = {},
            cancelLabel = "Cancel",
            confirmLabel = "Confirm (5s)",
            confirmEnabled = false,
            loading = false,
            onCancel = {},
            onConfirm = {},
        )
    }
}

@Preview(name = "Armed: typed gate satisfied", showBackground = true, widthDp = 360)
@Composable
private fun CommandConfirmDialogArmedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandConfirmDialogContent(
            title = "Erase Data",
            message = "This will erase all user data from the vehicle touchscreen. Continue?",
            typePrompt = "Type \"ERASE\" to confirm:",
            typedFieldLabel = "ERASE",
            typed = "ERASE",
            onTypedChange = {},
            cancelLabel = "Cancel",
            confirmLabel = "Confirm",
            confirmEnabled = true,
            loading = false,
            onCancel = {},
            onConfirm = {},
        )
    }
}

@Preview(name = "In-flight (loading): Confirm spinner, disabled", showBackground = true, widthDp = 360)
@Composable
private fun CommandConfirmDialogLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandConfirmDialogContent(
            title = "Remote Start",
            message = "This will enable keyless driving for 2 minutes. Continue?",
            typePrompt = null,
            typedFieldLabel = null,
            typed = "",
            onTypedChange = {},
            cancelLabel = "Cancel",
            confirmLabel = "Confirm",
            confirmEnabled = false,
            loading = true,
            onCancel = {},
            onConfirm = {},
        )
    }
}

@Preview(name = "Simple confirm (no count-down, no typed gate)", showBackground = true, widthDp = 360)
@Composable
private fun CommandConfirmDialogSimplePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandConfirmDialogContent(
            title = "Clear PIN",
            message = "Clear PIN to Drive without authentication?",
            typePrompt = null,
            typedFieldLabel = null,
            typed = "",
            onTypedChange = {},
            cancelLabel = "Cancel",
            confirmLabel = "Confirm",
            confirmEnabled = true,
            loading = false,
            onCancel = {},
            onConfirm = {},
        )
    }
}
