// Compose render layer for the ConfirmDialog modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/components/ui/ConfirmDialog.tsx). It is a thin shell over the pure
// [ConfirmDialogProjection] derivations (ConfirmDialogModel.kt): a Material 3 [Modal] hosting a severity-tinted
// message box, the optional typed-confirmation [Input] gate, the optional "Don't ask again" [Checkbox], and the
// end-aligned Cancel + Confirm actions. The view performs NO HTTP and binds no fetch — the web component's only
// data dependency is `useTranslation`; the silence choice is persisted through the [ConfirmSilenceStore] seam
// (the native analogue of web `lib/confirmSilence.ts`), and the decision is handed back to the owner through the
// [onConfirm] / [onCancel] callbacks exactly as the web `onConfirm` / `onCancel` props are.
//
// Web `open` prop -> host-gated composition: the web renders only when `open=true` (its Modal handles the render
// gate). The Compose idiom — prescribed by the shared `components/ui/Modal` KDoc — is to compose
// `ConfirmDialog(...)` conditionally (`if (open) ConfirmDialog(...)`), so this surface maps to the `open=true`
// render and the owning view gates it. The web reset-on-reopen effect is therefore implicit: leaving composition
// (owner sets `open=false`) discards the remembered `typed` / `dontAskAgain` state, so the next open starts fresh.
//
// Dismiss semantics: the web binds Escape -> onCancel and backdrop-click -> onCancel, both suppressed while
// `loading`. The Compose [Modal] (a platform [androidx.compose.ui.window.Dialog]) routes system-back AND
// outside-tap to `onDismissRequest`; guarding it with `if (!loading) onCancel()` plus `dismissOnBackdrop =
// !loading` reproduces both web behaviours (back is the platform equivalent of Escape), including the in-flight
// suppression.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the message box `rounded-lg border p-3 {bg} {border}` maps to
// a [RoundedCornerShape](Radius.lg) [Row] with a low-alpha [background] + [border] derived from the severity
// accent (web `severityTokens[sev].bg / .border` = the same hue at 10% / 30% alpha); the `h-5 w-5 {fg}` severity
// icon maps to an [Icon] at [IconSize.Lg] tinted with the accent (web AlertOctagon/critical, AlertTriangle/warn);
// the `text-sm text-[var(--text-primary)]` message maps to [BodyText] (onSurface). Web `space-y-4` / `gap-*`
// insets map to `Spacing` tokens. The warning confirm button — web `variant='primary'` + an amber className —
// maps to [ButtonVariant.Primary]; the design system exposes no amber button container, so (matching the shared
// `components/ui/ConfirmDialog` interpretation of the same web source) the caution accent is carried by the amber
// icon + amber-tinted message box, and danger maps to the destructive [ButtonVariant.Danger].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ConfirmDialog) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.confirmdialog

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object ConfirmDialogTestTags {
    const val ROOT: String = "confirm-dialog"
    const val MESSAGE: String = "confirm-dialog-message"
    const val TYPED_INPUT: String = "confirm-dialog-typed-input"
    const val SILENCE: String = "confirm-dialog-silence"
    const val CANCEL: String = "confirm-dialog-cancel"
    const val CONFIRM: String = "confirm-dialog-confirm"
}

/**
 * The already-localized microcopy the composable owns and reads from the i18n catalog (P1/S10). The web
 * component's title / message / confirm / cancel labels are caller-supplied props (localized by the owner, like
 * the web), so the ONLY strings the component itself owns are the silence-checkbox label (web
 * `t('confirm.silence.checkbox', …)`) and the modal close-button accessible name.
 */
data class ConfirmDialogStrings(
    val silenceCheckbox: String,
    val closeDialog: String,
)

/** Resolves the component-owned [ConfirmDialogStrings] from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberConfirmDialogStrings(): ConfirmDialogStrings =
    ConfirmDialogStrings(
        silenceCheckbox = stringResource(R.string.translation_confirm_silence_checkbox),
        closeDialog = stringResource(R.string.translation_a11y_closeDialog),
    )

/**
 * Stateful entry point — the faithful port of the web `ConfirmDialog({ open, title, message, confirmLabel,
 * cancelLabel, variant, loading, requireTypedConfirmation, typedConfirmationLabel, silenceKey, onConfirm,
 * onCancel })`. Composes only while the owner holds the dialog open (web `open`). It records the one-shot,
 * PII-safe `view.opened` diagnostic on first composition (P1/S11), owns the typed-confirmation + "Don't ask
 * again" state, resolves the render decisions via the pure [ConfirmDialogProjection], and auto-resolves
 * (firing [onConfirm], rendering nothing) when the action was previously silenced (web auto-resolve effect +
 * `return null`).
 *
 * @param title the dialog title (web `title`); caller-localized, shown in the modal header.
 * @param message the body message (web `message`); caller-localized, shown in the severity box.
 * @param confirmLabel the confirm action label (web `confirmLabel`, default `'Confirm'`); caller-localized.
 * @param cancelLabel the cancel action label (web `cancelLabel`, default `'Cancel'`); caller-localized.
 * @param onConfirm confirm handler (web `onConfirm`); fired after the silence choice is persisted.
 * @param onCancel cancel/dismiss handler (web `onCancel`); also fired on back / backdrop dismiss when not loading.
 * @param variant the destructive emphasis (web `variant`, default danger) selecting the severity styling.
 * @param loading when true both buttons disable, Confirm shows a spinner, and the dialog cannot be dismissed
 *   (web `loading`).
 * @param requireTypedConfirmation when set, the confirm action stays disabled until the user types this exact
 *   string (web `requireTypedConfirmation`).
 * @param typedConfirmationLabel optional caller-localized label for the typed-confirmation input (web
 *   `typedConfirmationLabel`); falls back to the required string when absent.
 * @param silenceKey optional stable action id enabling the "Don't ask again" affordance (web `silenceKey`);
 *   ignored for danger / typed-confirmation prompts.
 * @param silenceStore the persistence seam for the silence choice; defaults to the app's `SharedPreferences`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    cancelLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ConfirmVariant = ConfirmVariant.Danger,
    loading: Boolean = false,
    requireTypedConfirmation: String? = null,
    typedConfirmationLabel: String? = null,
    silenceKey: String? = null,
    silenceStore: ConfirmSilenceStore = rememberConfirmSilenceStore(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val silenceHonored = ConfirmDialogProjection.isSilenceHonored(variant, requireTypedConfirmation, silenceKey)
    val silenced = silenceHonored && silenceKey != null && silenceStore.isSilenced(silenceKey)

    if (silenced) {
        // Previously silenced: auto-resolve (web auto-resolve effect) and render nothing (web `return null`).
        LaunchedEffect(silenceKey) { onConfirm() }
        return
    }

    var typed by remember { mutableStateOf("") }
    var dontAskAgain by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { ConfirmDialogDiagnostics.recordViewOpened(logger) }

    val severity = ConfirmDialogProjection.severityFor(variant)
    val confirmEnabled = ConfirmDialogProjection.confirmEnabled(loading, requireTypedConfirmation, typed)
    val inputLabel = ConfirmDialogProjection.typedConfirmationInputLabel(typedConfirmationLabel, requireTypedConfirmation)
    val strings = rememberConfirmDialogStrings()

    Modal(
        onDismissRequest = { if (!loading) onCancel() },
        modifier = modifier,
        title = title,
        closeLabel = strings.closeDialog,
        dismissOnBackdrop = !loading,
    ) {
        ConfirmDialogContent(
            message = message,
            confirmLabel = confirmLabel,
            cancelLabel = cancelLabel,
            severity = severity,
            loading = loading,
            requireTypedConfirmation = requireTypedConfirmation,
            typedConfirmationInputLabel = inputLabel,
            typed = typed,
            onTypedChange = { typed = it },
            silenceHonored = silenceHonored,
            silenceCheckboxLabel = strings.silenceCheckbox,
            dontAskAgain = dontAskAgain,
            onDontAskAgainChange = { dontAskAgain = it },
            confirmEnabled = confirmEnabled,
            onConfirm = {
                if (ConfirmDialogProjection.shouldPersistSilence(silenceHonored, silenceKey, dontAskAgain) &&
                    silenceKey != null
                ) {
                    silenceStore.silence(silenceKey)
                }
                onConfirm()
            },
            onCancel = onCancel,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the severity-tinted message box, the
 * optional typed-confirmation input, the optional "Don't ask again" checkbox, and the end-aligned Cancel /
 * Confirm actions. Both actions disable while [loading]; Confirm additionally disables until the typed-gate is
 * satisfied ([confirmEnabled]) and shows a spinner while loading.
 */
@Composable
fun ConfirmDialogContent(
    message: String,
    confirmLabel: String,
    cancelLabel: String,
    severity: ConfirmSeverity,
    loading: Boolean,
    requireTypedConfirmation: String?,
    typedConfirmationInputLabel: String?,
    typed: String,
    onTypedChange: (String) -> Unit,
    silenceHonored: Boolean,
    silenceCheckboxLabel: String,
    dontAskAgain: Boolean,
    onDontAskAgainChange: (Boolean) -> Unit,
    confirmEnabled: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ConfirmDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SeverityMessage(message = message, severity = severity)

        if (requireTypedConfirmation != null) {
            Input(
                value = typed,
                onValueChange = onTypedChange,
                modifier = Modifier.testTag(ConfirmDialogTestTags.TYPED_INPUT),
                label = typedConfirmationInputLabel,
                enabled = !loading,
            )
        }

        if (silenceHonored) {
            Checkbox(
                checked = dontAskAgain,
                onCheckedChange = onDontAskAgainChange,
                modifier = Modifier.testTag(ConfirmDialogTestTags.SILENCE),
                label = silenceCheckboxLabel,
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
                modifier = Modifier.testTag(ConfirmDialogTestTags.CANCEL),
                variant = ButtonVariant.Secondary,
                enabled = !loading,
            )
            Button(
                label = confirmLabel,
                onClick = onConfirm,
                modifier = Modifier.testTag(ConfirmDialogTestTags.CONFIRM),
                variant = if (severity == ConfirmSeverity.Critical) ButtonVariant.Danger else ButtonVariant.Primary,
                enabled = confirmEnabled,
                loading = loading,
            )
        }
    }
}

/**
 * The severity-tinted message box — the web `<div className="flex items-start gap-3 rounded-lg border p-3 {bg}
 * {border}">` hosting the severity icon + the message. The accent hue (web `severityTokens[sev]`) tints the icon
 * at full strength, the fill at 10% alpha, and the border at 30% alpha, matching the web `{c}-500/10` background
 * and `{c}-500/30` border. The icon is decorative (web `aria-hidden`) — the message text carries the meaning.
 */
@Composable
private fun SeverityMessage(
    message: String,
    severity: ConfirmSeverity,
    modifier: Modifier = Modifier,
) {
    val accent = severityColor(severity)
    val shape = RoundedCornerShape(Radius.lg)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(accent.copy(alpha = SEVERITY_BG_ALPHA))
                .border(BorderStroke(1.dp, accent.copy(alpha = SEVERITY_BORDER_ALPHA)), shape)
                .padding(Spacing.md)
                .testTag(ConfirmDialogTestTags.MESSAGE),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = severityGlyph(severity),
            contentDescription = null,
            size = IconSize.Lg,
            tint = accent,
        )
        BodyText(text = message)
    }
}

/** The severity glyph — web `severityTokens[sev].icon` (AlertOctagon for critical, AlertTriangle for warn). */
private fun severityGlyph(severity: ConfirmSeverity): ImageVector =
    when (severity) {
        ConfirmSeverity.Critical -> TeslaGlyphs.Octagon
        ConfirmSeverity.Warn -> TeslaGlyphs.Warning
    }

/** The severity accent colour from the design tokens (P1/S9) — web `severityTokens[sev]` red / amber hue. */
@Composable
private fun severityColor(severity: ConfirmSeverity): Color =
    when (severity) {
        ConfirmSeverity.Critical -> TeslaTokens.status.danger
        ConfirmSeverity.Warn -> TeslaTokens.status.warning
    }

/**
 * Builds the production "Don't ask again" persistence — a [SharedPreferences]-backed [ConfirmSilenceStore], the
 * native analogue of the web `localStorage`-backed `lib/confirmSilence.ts`. Keyed off the application context so
 * the choice survives the dialog's owner leaving composition.
 */
@Composable
fun rememberConfirmSilenceStore(): ConfirmSilenceStore {
    val context = LocalContext.current
    return remember(context) { SharedPreferencesConfirmSilenceStore(context.applicationContext) }
}

/**
 * The default [ConfirmSilenceStore] — persists silenced action ids as a string set under one versioned key,
 * mirroring the web `lib/confirmSilence.ts` schema (`teslasync:confirm-silence:v1`, a deduped set of ids). All
 * writes are best-effort: a failed persist simply means the dialog re-prompts next time, the safe default.
 */
private class SharedPreferencesConfirmSilenceStore(
    context: Context,
) : ConfirmSilenceStore {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun isSilenced(key: String): Boolean = key.isNotEmpty() && prefs.getStringSet(SET_KEY, emptySet()).orEmpty().contains(key)

    override fun silence(key: String) {
        if (key.isEmpty()) return
        val current = prefs.getStringSet(SET_KEY, emptySet()).orEmpty()
        if (current.contains(key)) return
        prefs.edit { putStringSet(SET_KEY, current + key) }
    }

    private companion object {
        const val PREFS_NAME = "teslasync_confirm_silence"
        const val SET_KEY = "teslasync:confirm-silence:v1"
    }
}

// Web `{c}-500/10` background + `{c}-500/30` border (severityTokens[sev]) -> the accent hue at these alphas.
private const val SEVERITY_BG_ALPHA = 0.10f
private const val SEVERITY_BORDER_ALPHA = 0.30f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

@Preview(name = "Danger — typed confirmation gate", showBackground = true, widthDp = 360)
@Composable
private fun ConfirmDialogDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConfirmDialogContent(
            message = "This permanently deletes the vehicle and all of its history. This action cannot be undone.",
            confirmLabel = "Delete vehicle",
            cancelLabel = "Cancel",
            severity = ConfirmSeverity.Critical,
            loading = false,
            requireTypedConfirmation = "DELETE",
            typedConfirmationInputLabel = "DELETE",
            typed = "",
            onTypedChange = {},
            silenceHonored = false,
            silenceCheckboxLabel = "Don't ask again for this action",
            dontAskAgain = false,
            onDontAskAgainChange = {},
            confirmEnabled = false,
            onConfirm = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Warning — Don't ask again", showBackground = true, widthDp = 360)
@Composable
private fun ConfirmDialogWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConfirmDialogContent(
            message = "Resetting the dashboard layout discards your custom arrangement.",
            confirmLabel = "Reset layout",
            cancelLabel = "Cancel",
            severity = ConfirmSeverity.Warn,
            loading = false,
            requireTypedConfirmation = null,
            typedConfirmationInputLabel = null,
            typed = "",
            onTypedChange = {},
            silenceHonored = true,
            silenceCheckboxLabel = "Don't ask again for this action",
            dontAskAgain = false,
            onDontAskAgainChange = {},
            confirmEnabled = true,
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
            message = "Wiping all stored telemetry. This may take a moment.",
            confirmLabel = "Wipe data",
            cancelLabel = "Cancel",
            severity = ConfirmSeverity.Critical,
            loading = true,
            requireTypedConfirmation = null,
            typedConfirmationInputLabel = null,
            typed = "",
            onTypedChange = {},
            silenceHonored = false,
            silenceCheckboxLabel = "Don't ask again for this action",
            dontAskAgain = false,
            onDontAskAgainChange = {},
            confirmEnabled = false,
            onConfirm = {},
            onCancel = {},
        )
    }
}
