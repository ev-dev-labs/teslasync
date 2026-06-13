// Compose render layer for the TOUSettingsModal surface — the native analogue of the JSX the web component returns
// (web/src/features/battery/components/TOUSettingsModal.tsx). It is a thin shell over the pure
// [TOUSettingsModalProjection] derivations + the [TOUSettingsModalViewModel] orchestration: a Material 3 modal hosting
// the Preset/Custom tab strip, the preset Select with a pretty-printed JSON preview of the chosen plan, the custom-JSON
// textarea, the single error slot (a client-side validation message or the verbatim server error), and the Cancel +
// Update-Rate-Plan actions (the submit button shows its in-flight spinner and both actions disable while saving — web
// `updateMutation.isPending`). Every string is resolved from the i18n catalog (P1/S10) `energy.tou.*` + `common.*`
// keys; colors come from the generated theme tokens (P1/S9). No HTTP.
//
// i18n parity note (declared, not silent — honesty covenant #9): the prompt's authoritative "i18n keys extracted from
// source" enumerates exactly the twelve catalog-backed strings rendered here. The web source additionally renders two
// INLINE-DEFAULT-ONLY strings — `t('energy.tou.description', '…')` and `t('energy.tou.customHint', '…')` — whose keys
// exist in NEITHER the web `en.json` nor the generated Android catalog (they fall through to the English default arg).
// The catalog is auto-generated (`apps/shared/i18n/generators/gen-i18n.ts`, "do not edit by hand") and lies outside
// this surface's allowed files, and a hardcoded English literal is prohibited — so the two decorative helper prose
// strings are not reproduced. All functional composition (tabs, select, preview, textarea, every error, both actions)
// is fully present.
//
// Web parity note: the web component takes an `open` prop and renders a self-managed `<Modal open>`. The native idiom
// is conditional composition — the host renders `if (open) TOUSettingsModal(...)` — so this surface omits the `open`
// parameter, exactly as the sibling FeedbackModal surface does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs) cannot form
// a valid Kotlin package. `MatchingDeclarationName` is suppressed because the file's primary export is the
// `TOUSettingsModal` composable (matching the filename); the co-located [TOUSettingsModalStrings] carrier is a
// supporting type.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.tousettingsmodal

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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject

/** Test tags for the nodes the UI test selects (the web `data-testid` analogue). */
object TOUSettingsModalTestTags {
    const val ROOT: String = "tou-settings-modal"
    const val PREVIEW: String = "tou-settings-preview"
    const val ERROR: String = "tou-settings-error"
    const val CANCEL: String = "tou-settings-cancel"
    const val SUBMIT: String = "tou-settings-submit"
}

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [TOUSettingsModalContent] takes plain strings and stays trivially previewable + UI-testable.
 */
data class TOUSettingsModalStrings(
    val title: String,
    val close: String,
    val tabPreset: String,
    val tabCustom: String,
    val selectPlan: String,
    val selectEmptyLabel: String,
    val previewLabel: String,
    val customLabel: String,
    val errorNoPreset: String,
    val errorEmptyJson: String,
    val errorNotObject: String,
    val errorInvalidJson: String,
    val submit: String,
    val cancel: String,
)

/** Resolves every [TOUSettingsModalStrings] entry from the existing generated `energy.tou.*` + `common.*` keys (P1/S10). */
@Composable
fun rememberTOUSettingsModalStrings(): TOUSettingsModalStrings =
    TOUSettingsModalStrings(
        title = stringResource(R.string.translation_energy_tou_title),
        close = stringResource(R.string.translation_common_close),
        tabPreset = stringResource(R.string.translation_energy_tou_tabPreset),
        tabCustom = stringResource(R.string.translation_energy_tou_tabCustom),
        selectPlan = stringResource(R.string.translation_energy_tou_selectPlan),
        selectEmptyLabel = stringResource(R.string.translation_energy_tou_selectPlaceholder), // parity:allow i18n key name
        previewLabel = stringResource(R.string.translation_energy_tou_previewLabel),
        customLabel = stringResource(R.string.translation_energy_tou_customLabel),
        errorNoPreset = stringResource(R.string.translation_energy_tou_errorNoPreset),
        errorEmptyJson = stringResource(R.string.translation_energy_tou_errorEmptyJSON),
        errorNotObject = stringResource(R.string.translation_energy_tou_errorNotObject),
        errorInvalidJson = stringResource(R.string.translation_energy_tou_errorInvalidJSON),
        submit = stringResource(R.string.translation_energy_tou_submit),
        cancel = stringResource(R.string.translation_common_cancel),
    )

/**
 * Stateful entry point. Binds the [source] (the S8 TOU write seam) into a [TOUSettingsModalViewModel], records the
 * one-shot PII-safe `view.opened` diagnostic, clears any stale error on (re)open, dismisses on a successful save, and
 * renders the modal form. A host supplies [source] (bound from the shared EnergyStore) and the [siteId]; tests/previews
 * pass fakes. The dialog cannot be dismissed while a save is in flight (web `onClose={loading ? noop : onClose}`). No
 * HTTP.
 *
 * @param onClose dismiss callback — invoked by the Cancel/close affordances and after a successful save (web `onClose`).
 * @param source the TOU write seam (P1/S8); host-provided so the dialog never sees the store or HTTP.
 * @param siteId the Tesla energy-site whose tariff is being updated (web `siteId`).
 */
@Composable
fun TOUSettingsModal(
    onClose: () -> Unit,
    source: TOUSettingsModalSource,
    siteId: Long,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TOUSettingsModalRegistration.SLUG,
) {
    val viewModel: TOUSettingsModalViewModel =
        viewModel(key = instanceKey, factory = TOUSettingsModalViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(Unit) { viewModel.resetSubmitError() }
    LaunchedEffect(viewModel) { viewModel.closed.collect { onClose() } }

    val submitting by viewModel.submitting.collectAsStateWithLifecycle()
    val submitError by viewModel.submitError.collectAsStateWithLifecycle()
    val strings = rememberTOUSettingsModalStrings()

    Modal(
        onDismissRequest = { if (!submitting) onClose() },
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
        dismissOnBackdrop = !submitting,
    ) {
        TOUSettingsModalContent(
            strings = strings,
            submitting = submitting,
            submitError = submitError,
            onSubmit = { payload -> viewModel.submit(siteId, payload) },
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral tab / chosen
 * preset / custom-JSON fields (web `useState`), runs [TOUSettingsModalProjection.buildPayload] on submit (web
 * `getPayload`), surfaces a client-side validation message OR the [submitError] in the single error slot (precedence:
 * the just-computed validation message wins, matching the web's single `error` state that `getPayload` overwrites), and
 * hands the assembled `tou_settings` envelope back through [onSubmit] only when valid. Every control carries an
 * accessible label; the Cancel + submit actions disable while a save is in flight, and the submit additionally spins.
 *
 * The [initialTab] / [initialPresetId] / [initialCustomJson] seams default to the web initial form
 * (`activeTab='preset'`, no preset, empty JSON) and exist only so previews + UI tests can render a specific branch.
 */
@Composable
fun TOUSettingsModalContent(
    strings: TOUSettingsModalStrings,
    submitting: Boolean,
    submitError: String?,
    onSubmit: (JsonObject) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    initialTab: TOUTab = TOUTab.Preset,
    initialPresetId: String = "",
    initialCustomJson: String = "",
) {
    var tab by remember { mutableStateOf(initialTab) }
    var selectedPresetId by remember { mutableStateOf(initialPresetId) }
    var customJson by remember { mutableStateOf(initialCustomJson) }
    var validationError by remember { mutableStateOf<TOUValidationError?>(null) }

    val displayedError = validationError?.let { resolveValidationError(it, strings) } ?: submitError

    val handleSubmit: () -> Unit = {
        when (val result = TOUSettingsModalProjection.buildPayload(tab, selectedPresetId, customJson)) {
            is TOUPayloadResult.Invalid -> validationError = result.error
            is TOUPayloadResult.Valid -> {
                validationError = null
                onSubmit(result.payload)
            }
        }
    }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(TOUSettingsModalTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Tabs(
            tabs =
                listOf(
                    TabItem(TOUTab.Preset.wire, strings.tabPreset),
                    TabItem(TOUTab.Custom.wire, strings.tabCustom),
                ),
            selectedKey = tab.wire,
            onSelect = { key -> tab = TOUTab.fromWire(key) },
        )

        when (tab) {
            TOUTab.Preset ->
                PresetFields(
                    strings = strings,
                    selectedPresetId = selectedPresetId,
                    submitting = submitting,
                    onSelectPreset = { selectedPresetId = it },
                )

            TOUTab.Custom ->
                Textarea(
                    value = customJson,
                    onValueChange = { customJson = it },
                    label = strings.customLabel,
                    enabled = !submitting,
                    minLines = CUSTOM_JSON_LINES,
                    maxLines = CUSTOM_JSON_LINES,
                )
        }

        if (displayedError != null) {
            ErrorText(
                text = displayedError,
                modifier =
                    Modifier
                        .testTag(TOUSettingsModalTestTags.ERROR)
                        .semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                modifier = Modifier.testTag(TOUSettingsModalTestTags.CANCEL),
                variant = ButtonVariant.Ghost,
                enabled = !submitting,
            )
            Button(
                label = strings.submit,
                onClick = handleSubmit,
                modifier = Modifier.testTag(TOUSettingsModalTestTags.SUBMIT),
                variant = ButtonVariant.Primary,
                enabled = !submitting,
                loading = submitting,
            )
        }
    }
}

/**
 * The Preset-tab body — the rate-plan [Select] plus the pretty-printed JSON [previewLabel] preview of the chosen plan
 * (web `selectedPreset && <pre>{JSON.stringify(...)}</pre>`). Extracted so the parent [TOUSettingsModalContent] stays a
 * flat tab switch.
 */
@Composable
private fun PresetFields(
    strings: TOUSettingsModalStrings,
    selectedPresetId: String,
    submitting: Boolean,
    onSelectPreset: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Select(
            options = presetSelectOptions(),
            selectedValue = selectedPresetId,
            onSelect = onSelectPreset,
            label = strings.selectPlan,
            emptyLabel = strings.selectEmptyLabel,
            enabled = !submitting,
        )
        val preview = TOUSettingsModalProjection.previewFor(selectedPresetId)
        if (preview != null) {
            GlassPanel(padding = PanelPadding.Md) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(strings.previewLabel)
                    CodeText(preview, modifier = Modifier.testTag(TOUSettingsModalTestTags.PREVIEW))
                }
            }
        }
    }
}

/** Maps a [TOUValidationError] to its already-localized message — each case is one `energy.tou.error*` string. */
private fun resolveValidationError(
    error: TOUValidationError,
    strings: TOUSettingsModalStrings,
): String =
    when (error) {
        TOUValidationError.NoPreset -> strings.errorNoPreset
        TOUValidationError.EmptyJson -> strings.errorEmptyJson
        TOUValidationError.NotObject -> strings.errorNotObject
        TOUValidationError.InvalidJson -> strings.errorInvalidJson
    }

/** The rate-plan Select options — the projection's data options mapped onto the shared [SelectOption] type. */
private fun presetSelectOptions(): List<SelectOption> =
    TOUSettingsModalProjection.presetOptions().map { option -> SelectOption(option.value, option.label) }

/** Custom-JSON textarea row count (web `rows={12}`). */
private const val CUSTOM_JSON_LINES = 12

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────────────

private val previewStrings =
    TOUSettingsModalStrings(
        title = "Update Rate Plan",
        close = "Close",
        tabPreset = "Preset Tariff",
        tabCustom = "Custom JSON",
        selectPlan = "Rate Plan",
        selectEmptyLabel = "Choose a rate plan…",
        previewLabel = "Preview",
        customLabel = "TOU Settings JSON",
        errorNoPreset = "Please select a rate plan",
        errorEmptyJson = "Please enter the TOU settings JSON",
        errorNotObject = "JSON must be an object",
        errorInvalidJson = "Invalid JSON — please check syntax",
        submit = "Update Rate Plan",
        cancel = "Cancel",
    )

@Preview(name = "Preset tab — no plan chosen", showBackground = true, widthDp = 360)
@Composable
private fun TOUSettingsModalPresetPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOUSettingsModalContent(
            strings = previewStrings,
            submitting = false,
            submitError = null,
            onSubmit = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Preset tab — plan chosen (preview)", showBackground = true, widthDp = 360)
@Composable
private fun TOUSettingsModalPresetChosenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOUSettingsModalContent(
            strings = previewStrings,
            submitting = false,
            submitError = null,
            onSubmit = {},
            onCancel = {},
            initialPresetId = "pge-ev2a",
        )
    }
}

@Preview(name = "Custom tab — error", showBackground = true, widthDp = 360)
@Composable
private fun TOUSettingsModalCustomErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOUSettingsModalContent(
            strings = previewStrings,
            submitting = false,
            submitError = "TOU update failed: 502 Bad Gateway",
            onSubmit = {},
            onCancel = {},
            initialTab = TOUTab.Custom,
            initialCustomJson = "{ not valid",
        )
    }
}

@Preview(name = "Submitting", showBackground = true, widthDp = 360)
@Composable
private fun TOUSettingsModalSubmittingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOUSettingsModalContent(
            strings = previewStrings,
            submitting = true,
            submitError = null,
            onSubmit = {},
            onCancel = {},
            initialPresetId = "sce-tou-d",
        )
    }
}
