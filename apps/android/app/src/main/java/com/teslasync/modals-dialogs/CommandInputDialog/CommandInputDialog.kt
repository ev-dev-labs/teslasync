// Compose render layer for the CommandInputDialog modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/system/components/CommandInputDialog.tsx). It is a thin shell over the pure
// [CommandInputDialogProjection] derivations (CommandInputDialogModel.kt): a Material 3 [Modal] hosting the
// web header (an [IconBox] glyph + the command title + the prompt line), one [Input] per parameter, and the
// end-aligned Cancel + Send actions. The view performs NO HTTP and binds no fetch — the web component's only data
// dependency is `useTranslation`; the command spec + the submit / close handlers + the in-flight `loading` flag
// are all caller-supplied (web `def` / `onSubmit` / `onClose` / `loading` props), exactly as the sibling
// ConfirmDialog surface takes its title / message / handlers from its owner.
//
// Web `open` prop -> host-gated composition: the web renders only when `open=true` (its Modal handles the render
// gate). The Compose idiom — prescribed by the shared `components/ui/Modal` KDoc — is to compose
// `CommandInputDialog(...)` conditionally (`if (open) CommandInputDialog(...)`), so this surface maps to the
// `open=true` render and the owning view gates it. The web reset-on-reopen effect (web `useEffect([open])` that
// re-seeds values, clears errors/touched, and focuses the first input) is therefore reproduced two ways: the
// form state is keyed on the spec so it re-seeds when the dialog (re)opens, and the first field requests focus
// from its first-composition effect.
//
// Dismiss semantics: the web binds Escape -> onClose and backdrop-click -> onClose. The Compose [Modal] (a
// platform [androidx.compose.ui.window.Dialog]) routes system-back AND outside-tap to `onDismissRequest`; wiring
// it to `onClose` reproduces both web behaviours (back is the platform equivalent of Escape). The web renders its
// own header (no Modal title bar / close "X"), so this surface composes the [Modal] title-less and supplies the
// accessible pane name instead, with the title rendered inside the body as the web does.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web header icon box `rounded-xl p-2.5 bg-[var(--surface-2)]
// text-[var(--text-secondary)]` maps to a neutral [IconBox]; the `text-base font-semibold` title maps to
// [SectionTitle], the `text-xs text-[var(--text-muted)]` prompt to [HelperText]. The form `space-y-4` and the
// footer `gap-2` map to `Spacing` tokens. The web Send button accent (`bg-neon-cyan/20 …`) maps to the design
// system's [ButtonVariant.Primary]; the ghost Cancel maps to [ButtonVariant.Ghost].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/CommandInputDialog) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandinputdialog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object CommandInputDialogTestTags {
    const val ROOT: String = "command-input-dialog"
    const val CANCEL: String = "command-input-dialog-cancel"
    const val SUBMIT: String = "command-input-dialog-submit"

    /** The tag for the [field]'s input, so a multi-field form's inputs are individually addressable. */
    fun field(name: String): String = "command-input-dialog-field-$name"
}

/**
 * The already-localized microcopy the component itself owns (P1/S10). The title / prompt / field labels are
 * caller-localized and arrive on the [CommandInputSpec] (web passes `t(def.labelKey, …)` etc.), so the strings
 * this component owns are the two action labels (web `t('common.cancel', …)` / `t('common.send', …)`) and the
 * four non-parameterized validation messages (web `validateField` literals). The min / max messages are
 * parameterized, so they are resolved at the call site via [fieldErrorText].
 */
data class CommandInputDialogStrings(
    val cancel: String,
    val send: String,
    val errorRequired: String,
    val errorPin: String,
    val errorWholeNumber: String,
    val errorValidNumber: String,
)

/** Resolves the component-owned [CommandInputDialogStrings] from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberCommandInputDialogStrings(): CommandInputDialogStrings =
    CommandInputDialogStrings(
        cancel = stringResource(R.string.translation_common_cancel),
        send = stringResource(R.string.translation_common_send),
        errorRequired = stringResource(R.string.translation_commandInput_error_required),
        errorPin = stringResource(R.string.translation_commandInput_error_pin),
        errorWholeNumber = stringResource(R.string.translation_commandInput_error_wholeNumber),
        errorValidNumber = stringResource(R.string.translation_commandInput_error_validNumber),
    )

/**
 * Resolves a [FieldError] to its localized message (P1/S10) — the native analogue of the string the web
 * `validateField` returns. The bounded cases interpolate the formatted numeric bound (web `Minimum: ${min}` /
 * `Maximum: ${max}`); the rest read the component-owned [strings]. Returns `null` for a valid field.
 */
@Composable
fun fieldErrorText(
    error: FieldError?,
    strings: CommandInputDialogStrings,
): String? =
    when (error) {
        null -> null
        FieldError.Required -> strings.errorRequired
        FieldError.Pin -> strings.errorPin
        FieldError.WholeNumber -> strings.errorWholeNumber
        FieldError.ValidNumber -> strings.errorValidNumber
        is FieldError.Min ->
            stringResource(R.string.translation_commandInput_error_min, CommandInputDialogProjection.formatBound(error.bound))
        is FieldError.Max ->
            stringResource(R.string.translation_commandInput_error_max, CommandInputDialogProjection.formatBound(error.bound))
    }

/**
 * Stateful entry point — the faithful port of the web `CommandInputDialog({ open, onClose, onSubmit, def,
 * vehicle, loading })`. Composes only while the owner holds the dialog open (web `open`). It records the
 * one-shot, PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders the title-less [Modal]
 * (the web header is drawn inside the body) hosting the [CommandInputDialogContent].
 *
 * @param spec the fully-localized command + parameter spec to render (web `def` / `inputConfig`, with title /
 *   prompt / field labels already localized by the owner, and the single-param default already resolved).
 * @param icon the command glyph shown in the header (web `def.icon`); caller-supplied so the pure model holds no
 *   Compose type.
 * @param onSubmit invoked with the `name -> value` map once every field validates (web `onSubmit(values)`).
 * @param onClose dismiss handler (web `onClose`); fired by Cancel and by back / backdrop dismissal.
 * @param loading when true the Send action shows a spinner and is disabled (web `loading`); reflects the owning
 *   command page's mutation, not this dialog.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandInputDialog(
    spec: CommandInputSpec,
    icon: ImageVector,
    onSubmit: (Map<String, String>) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CommandInputDialogDiagnostics.recordViewOpened(logger) }
    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        accessibleName = spec.title,
    ) {
        CommandInputDialogContent(
            spec = spec,
            icon = icon,
            loading = loading,
            onSubmit = onSubmit,
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral
 * `name -> value` map and the touched-field set (web `useState`), seeded from the spec's initial values (web
 * `buildInitialValues`) and re-seeded whenever the [spec] identity changes (web reset-on-open). It surfaces a
 * per-field error once a field has been blurred or a submit was attempted (web `touched`), gates Send on whole-
 * form validity (web `disabled={!isValid()}`), and on submit touches every field then hands the assembled values
 * back through [onSubmit] only when valid (web `handleSubmit`). The first field requests focus on open (web
 * `firstInputRef.focus()`). Cancel always stays enabled (web Cancel has no disabled state).
 */
@Composable
fun CommandInputDialogContent(
    spec: CommandInputSpec,
    icon: ImageVector,
    loading: Boolean,
    onSubmit: (Map<String, String>) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberCommandInputDialogStrings()
    var values by remember(spec) { mutableStateOf(CommandInputDialogProjection.initialValues(spec)) }
    var touched by remember(spec) { mutableStateOf(emptySet<String>()) }
    val firstFieldFocus = remember(spec) { FocusRequester() }
    val valid = CommandInputDialogProjection.isValid(spec, values)

    LaunchedEffect(spec) { runCatching { firstFieldFocus.requestFocus() } }

    Column(
        modifier = modifier.fillMaxWidth().testTag(CommandInputDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        CommandInputHeader(title = spec.title, prompt = spec.prompt, icon = icon)

        spec.fields.forEachIndexed { index, field ->
            val error = if (field.name in touched) CommandInputDialogProjection.validate(field, values[field.name].orEmpty()) else null
            CommandInputFieldRow(
                field = field,
                value = values[field.name].orEmpty(),
                errorText = fieldErrorText(error, strings),
                enabled = !loading,
                onValueChange = { values = values + (field.name to it) },
                onBlur = { touched = touched + field.name },
                modifier = if (index == 0) Modifier.focusRequester(firstFieldFocus) else Modifier,
            )
        }

        CommandInputActions(
            cancelLabel = strings.cancel,
            sendLabel = strings.send,
            sendEnabled = valid,
            loading = loading,
            onCancel = onCancel,
            onSubmit = {
                touched = spec.fields.mapTo(mutableSetOf()) { it.name }
                if (CommandInputDialogProjection.isValid(spec, values)) onSubmit(values)
            },
        )
    }
}

/** The web header: an icon box, the command title, and the prompt line. */
@Composable
private fun CommandInputHeader(
    title: String,
    prompt: String,
    icon: ImageVector,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Neutral) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(title)
            HelperText(prompt)
        }
    }
}

/**
 * One parameter input. Tracks its own focus so the touched-on-blur edge (web `handleBlur`) fires exactly once
 * when focus leaves; the keyboard flavour + PIN masking come from the pure projection (web `resolveInputMode` /
 * `resolveInputType`). The field's example text maps to the [Input] helper text (the shared component has no
 * in-field example-text slot), and the localized [errorText] replaces it once the field is touched-and-invalid.
 */
@Composable
private fun CommandInputFieldRow(
    field: CommandInputField,
    value: String,
    errorText: String?,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onBlur: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var wasFocused by remember(field.name) { mutableStateOf(false) }
    val masked = CommandInputDialogProjection.isMasked(field.validation)
    Input(
        value = value,
        onValueChange = onValueChange,
        modifier =
            modifier
                .testTag(CommandInputDialogTestTags.field(field.name))
                .onFocusChanged { state ->
                    if (state.isFocused) {
                        wasFocused = true
                    } else if (wasFocused) {
                        wasFocused = false
                        onBlur()
                    }
                },
        label = field.label,
        hint = field.hint,
        errorText = errorText,
        enabled = enabled,
        keyboardType = keyboardTypeFor(CommandInputDialogProjection.keyboardKind(field.validation)),
        visualTransformation = if (masked) PasswordVisualTransformation() else VisualTransformation.None,
    )
}

/** The end-aligned footer: the always-enabled ghost Cancel and the primary Send (disabled until valid). */
@Composable
private fun CommandInputActions(
    cancelLabel: String,
    sendLabel: String,
    sendEnabled: Boolean,
    loading: Boolean,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = cancelLabel,
            onClick = onCancel,
            modifier = Modifier.testTag(CommandInputDialogTestTags.CANCEL),
            variant = ButtonVariant.Ghost,
        )
        Button(
            label = sendLabel,
            onClick = onSubmit,
            modifier = Modifier.testTag(CommandInputDialogTestTags.SUBMIT),
            variant = ButtonVariant.Primary,
            enabled = sendEnabled,
            loading = loading,
        )
    }
}

/** Maps a [KeyboardKind] to the Compose [KeyboardType] (web `inputMode` / `type`). */
private fun keyboardTypeFor(kind: KeyboardKind): KeyboardType =
    when (kind) {
        KeyboardKind.Text -> KeyboardType.Text
        KeyboardKind.Numeric -> KeyboardType.Number
        KeyboardKind.Decimal -> KeyboardType.Decimal
        KeyboardKind.NumericPassword -> KeyboardType.NumberPassword
    }

@Preview
@Composable
private fun CommandInputDialogPinPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandInputDialogContent(
            spec =
                CommandInputSpec(
                    title = "Set PIN to Drive",
                    prompt = "Enter 4-digit PIN:",
                    fields =
                        listOf(
                            CommandInputField(
                                name = "password",
                                label = "Requires PIN",
                                hint = null,
                                validation = FieldValidation.Pin,
                            ),
                        ),
                ),
            icon = TeslaGlyphs.Pin,
            loading = false,
            onSubmit = {},
            onCancel = {},
        )
    }
}

@Preview
@Composable
private fun CommandInputDialogCoordinatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandInputDialogContent(
            spec =
                CommandInputSpec(
                    title = "Share Destination",
                    prompt = "Enter GPS coordinates",
                    fields =
                        listOf(
                            CommandInputField("lat", "Latitude", "37.7749", FieldValidation.Decimal),
                            CommandInputField("lon", "Longitude", "-122.4194", FieldValidation.Decimal),
                        ),
                ),
            icon = TeslaGlyphs.Pin,
            loading = false,
            onSubmit = {},
            onCancel = {},
        )
    }
}
