// The native Jetpack Compose + Material 3 VehicleSettingsTab feature view — a parity port of
// web/src/features/vehicles/components/VehicleSettingsTab.tsx. The web component is the per-vehicle settings
// section mounted inside <VehicleDetailPage>: a GlassPanel with a header (title + subtitle), a short loading
// skeleton while the resolver `GET` is in flight, a compact error fallback with retry, and otherwise one row
// per supported key — each row showing the typed input, a "source" pill (Override | User default | Vehicle
// name | System default), a Save button (enabled only when the draft differs), and a "Reset to default"
// button (enabled only when the value is a per-vehicle override).
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the resolver feed + both
// mutations only through the shared S8 [VehicleSettingsTabSource], folding the cache-then-network lifecycle
// through the [VehicleSettingsTabViewModel] + the pure [VehicleSettingsTabProjection]; the composable is a
// thin render layer that resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the
// projection returns, using the shared component library (ui GlassPanel/Button/Input/Select/Badge/typography,
// feedback ErrorDisplay/Skeleton/ToastHost, data-display DataFreshness, motion FadeIn). It renders every
// state the prompt's matrix mandates without ever hiding a surface: loading (skeleton), the editable rows
// (content — a "no value" row renders an empty input with a "System default" pill, never a blank box), a hard
// error with Retry, and a stale/offline/refreshing freshness chip over the cached rows. Per-key save/reset
// outcomes surface as one-shot toasts (the web `useMutationToast`). The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleSettingsTab) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclesettingstab

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsStore
import kotlinx.coroutines.delay

private const val FADE_DELAY_MS = 120
private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val SKELETON_ROWS = 3
private val SKELETON_ROW_HEIGHT = 56.dp
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point — the faithful 1:1 port of the web `VehicleSettingsTab({ vehicleId })`. Binds the
 * shared S8 [store] (scoped to [vehicleId]) into a [VehicleSettingsTabViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11) on first composition, collects the combined state, projects it, drains
 * the one-shot mutation toasts, and renders. The host (the vehicle detail page) owns the shared store and
 * passes it; this view never performs HTTP.
 *
 * @param vehicleId the vehicle whose per-vehicle settings are shown (the web `vehicleId` prop).
 * @param store the shared S8 vehicle-settings state holder the section binds to.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleSettingsTab(
    vehicleId: Int,
    store: VehicleSettingsStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val source = remember(store, vehicleId) { store.asVehicleSettingsTabSource(vehicleId.toString()) }
    val viewModel: VehicleSettingsTabViewModel =
        viewModel(
            key = "$VEHICLE_SETTINGS_TAB_SLUG:$vehicleId",
            factory = VehicleSettingsTabViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val display = remember(state) { VehicleSettingsTabProjection.project(state) }

    val context = LocalContext.current
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    LaunchedEffect(viewModel, context) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                toastSeq += 1
                val item = ToastItem(id = toastSeq, message = resolveToastMessage(context, event), tone = toneOf(event.severity))
                toasts = enqueueToast(toasts, item, MAX_TOASTS)
            }
        }
    }
    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    VehicleSettingsTabContent(
        display = display,
        onEdit = viewModel::edit,
        onSave = viewModel::save,
        onReset = viewModel::reset,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
        toasts = toasts,
        onToastDismiss = { id -> toasts = dismissToast(toasts, id) },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Draws the faded-in [GlassPanel] holding the
 * always-present header, an optional stale/offline freshness chip, the per-state body (loading skeleton /
 * hard-error retry / the editable rows), and the bottom-anchored toast host. Hoisted out of the ViewModel so
 * every state is preview- and screenshot-testable with hand-built inputs.
 */
@Composable
fun VehicleSettingsTabContent(
    display: VehicleSettingsTabDisplay,
    onEdit: (String, String) -> Unit,
    onSave: (String) -> Unit,
    onReset: (String) -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
    toasts: List<ToastItem>,
    onToastDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
    strings: VehicleSettingsTabStrings = rememberVehicleSettingsTabStrings(),
) {
    Box(modifier = modifier.fillMaxWidth()) {
        FadeIn(delayMs = FADE_DELAY_MS) {
            GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
                VehicleSettingsHeader(strings)
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = Spacing.lg),
                    verticalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    if (display.status == VehicleSettingsTabStatus.Ready && display.isDegraded) {
                        VehicleSettingsFreshness(display = display, strings = strings, onRefresh = onRefresh)
                    }
                    VehicleSettingsBody(
                        display = display,
                        strings = strings,
                        onEdit = onEdit,
                        onSave = onSave,
                        onReset = onReset,
                        onRetry = onRetry,
                    )
                }
            }
        }
        ToastHost(toasts = toasts, onDismiss = onToastDismiss, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

/** The panel header — the section title + subtitle (web `<Heading level="section">` + `<Text>`). */
@Composable
private fun VehicleSettingsHeader(strings: VehicleSettingsTabStrings) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionTitle(strings.title, modifier = Modifier.semantics { heading() })
        HelperText(strings.subtitle)
    }
}

/** Switches between the loading skeleton, the hard-error retry, and the editable rows. */
@Composable
private fun VehicleSettingsBody(
    display: VehicleSettingsTabDisplay,
    strings: VehicleSettingsTabStrings,
    onEdit: (String, String) -> Unit,
    onSave: (String) -> Unit,
    onReset: (String) -> Unit,
    onRetry: () -> Unit,
) {
    when (display.status) {
        VehicleSettingsTabStatus.Loading -> VehicleSettingsLoading(strings)
        VehicleSettingsTabStatus.Error -> VehicleSettingsErrorState(strings, onRetry)
        VehicleSettingsTabStatus.Ready ->
            VehicleSettingsRows(display = display, strings = strings, onEdit = onEdit, onSave = onSave, onReset = onReset)
    }
}

/** The stale / offline freshness chip + re-read control, shown only over a degraded last-known set of rows. */
@Composable
private fun VehicleSettingsFreshness(
    display: VehicleSettingsTabDisplay,
    strings: VehicleSettingsTabStrings,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = display.fetchedAtMillis?.takeIf { it > 0 },
            isFetching = display.refreshing,
            isStale = display.stale,
            isError = display.errorKind != null,
            errorLabel = strings.offline,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refresh,
            onClick = onRefresh,
            enabled = !display.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The first-load skeleton — three shimmering row bars with an accessible "loading" label. */
@Composable
private fun VehicleSettingsLoading(strings: VehicleSettingsTabStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/** The hard-error surface — the resolver failure message with a retry (web `ErrorDisplay`). */
@Composable
private fun VehicleSettingsErrorState(
    strings: VehicleSettingsTabStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The editable list — one [VehicleSettingRow] per whitelist key, divided like the web `divide-y`. */
@Composable
private fun VehicleSettingsRows(
    display: VehicleSettingsTabDisplay,
    strings: VehicleSettingsTabStrings,
    onEdit: (String, String) -> Unit,
    onSave: (String) -> Unit,
    onReset: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        display.rows.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider()
            VehicleSettingRow(row = row, strings = strings, onEdit = onEdit, onSave = onSave, onReset = onReset)
        }
    }
}

/** One settings row: the source pill, the typed input (with inline validation), and the Save / Reset actions. */
@Composable
private fun VehicleSettingRow(
    row: VehicleSettingRowDisplay,
    strings: VehicleSettingsTabStrings,
    onEdit: (String, String) -> Unit,
    onSave: (String) -> Unit,
    onReset: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SourcePill(source = row.source, strings = strings)
        }
        RowInput(row = row, validationText = validationTextFor(row.validation, strings), onEdit = onEdit)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = if (row.saving) strings.saving else strings.save,
                onClick = { onSave(row.key) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = row.canSave,
                loading = row.saving,
            )
            Button(
                label = if (row.resetting) strings.resetting else strings.reset,
                onClick = { onReset(row.key) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = row.canReset,
                loading = row.resetting,
            )
        }
    }
}

/** The typed input — a select for unit keys, otherwise a text field; the setting label is the field label. */
@Composable
private fun RowInput(
    row: VehicleSettingRowDisplay,
    validationText: String?,
    onEdit: (String, String) -> Unit,
) {
    val label = stringResource(labelResFor(row.key))
    val help = stringResource(helpResFor(row.key)).takeIf { it.isNotBlank() }
    when (row.kind) {
        VehicleSettingKind.Select ->
            Select(
                options = row.options.map { SelectOption(it.value, it.label) },
                selectedValue = row.draft.ifBlank { null },
                onSelect = { onEdit(row.key, it) },
                label = label,
                emptyLabel = EM_DASH,
                hint = help,
                errorText = validationText,
            )

        VehicleSettingKind.Timestamp ->
            Input(
                value = row.draft,
                onValueChange = { onEdit(row.key, it) },
                label = label,
                hint = help,
                errorText = validationText,
            )

        VehicleSettingKind.Text ->
            Input(
                value = row.draft,
                onValueChange = { onEdit(row.key, capLength(it, row.maxLength)) },
                label = label,
                hint = help,
                errorText = validationText,
            )
    }
}

/** The "source" pill — the layer that produced the effective value, colored by semantic variant (web Badge). */
@Composable
private fun SourcePill(
    source: EffectiveSettingSource,
    strings: VehicleSettingsTabStrings,
) {
    Badge(text = sourceLabelFor(source, strings), variant = sourceVariantFor(source))
}

/** Truncates [value] to [maxLength] characters, enforcing the web `maxLength` attribute. */
private fun capLength(
    value: String,
    maxLength: Int?,
): String = if (maxLength != null && value.length > maxLength) value.take(maxLength) else value

/** The localized source-pill label for [source] (web `vehicleSettings.source.{source}`). */
private fun sourceLabelFor(
    source: EffectiveSettingSource,
    strings: VehicleSettingsTabStrings,
): String =
    when (source) {
        EffectiveSettingSource.OVERRIDE -> strings.sourceOverride
        EffectiveSettingSource.USER -> strings.sourceUser
        EffectiveSettingSource.VEHICLE -> strings.sourceVehicle
        EffectiveSettingSource.DEFAULT -> strings.sourceDefault
    }

/** The semantic badge variant for [source] (web `SOURCE_PILL_VARIANT`). */
private fun sourceVariantFor(source: EffectiveSettingSource): BadgeVariant =
    when (source) {
        EffectiveSettingSource.OVERRIDE -> BadgeVariant.Success
        EffectiveSettingSource.USER -> BadgeVariant.Info
        EffectiveSettingSource.VEHICLE -> BadgeVariant.Neutral
        EffectiveSettingSource.DEFAULT -> BadgeVariant.Warning
    }

/** The inline validation message for [validation], or null when the draft is valid (web inline error). */
private fun validationTextFor(
    validation: VehicleSettingValidation?,
    strings: VehicleSettingsTabStrings,
): String? =
    when (validation) {
        null -> null
        VehicleSettingValidation.Required -> strings.validationRequired
        VehicleSettingValidation.InvalidDate -> strings.validationInvalidDate
        VehicleSettingValidation.Invalid -> strings.validationInvalid
    }

/** The `R.string` label resource for [key] (web `vehicleSettings.keys.{key}.label`). */
@StringRes
private fun labelResFor(key: String): Int =
    when (key) {
        "nickname" -> R.string.translation_vehicleSettings_keys_nickname_label
        "mute_until" -> R.string.translation_vehicleSettings_keys_mute_until_label
        "charge_cost_tariff_id" -> R.string.translation_vehicleSettings_keys_charge_cost_tariff_id_label
        "units_distance" -> R.string.translation_vehicleSettings_keys_units_distance_label
        "units_temperature" -> R.string.translation_vehicleSettings_keys_units_temperature_label
        "units_energy" -> R.string.translation_vehicleSettings_keys_units_energy_label
        else -> R.string.translation_vehicleSettings_title
    }

/** The `R.string` help resource for [key] (web `vehicleSettings.keys.{key}.help`). */
@StringRes
private fun helpResFor(key: String): Int =
    when (key) {
        "nickname" -> R.string.translation_vehicleSettings_keys_nickname_help
        "mute_until" -> R.string.translation_vehicleSettings_keys_mute_until_help
        "charge_cost_tariff_id" -> R.string.translation_vehicleSettings_keys_charge_cost_tariff_id_help
        "units_distance" -> R.string.translation_vehicleSettings_keys_units_distance_help
        "units_temperature" -> R.string.translation_vehicleSettings_keys_units_temperature_help
        "units_energy" -> R.string.translation_vehicleSettings_keys_units_energy_help
        else -> R.string.translation_vehicleSettings_subtitle
    }

/** Resolves a [UiEvent.Message] toast to its localized text (ADR-014 — the render boundary owns the lookup). */
private fun resolveToastMessage(
    context: Context,
    event: UiEvent.Message,
): String =
    when (event.messageKey) {
        VEHICLE_SETTINGS_SAVED_KEY -> context.getString(R.string.translation_vehicleSettings_toasts_saved)
        VEHICLE_SETTINGS_RESET_KEY -> context.getString(R.string.translation_vehicleSettings_toasts_reset)
        VEHICLE_SETTINGS_SAVE_FAILED_KEY -> context.getString(R.string.translation_vehicleSettings_errors_save)
        VEHICLE_SETTINGS_RESET_FAILED_KEY -> context.getString(R.string.translation_vehicleSettings_errors_reset)
        else -> context.getString(R.string.translation_error_serverError_message)
    }

/** Maps a [UiEvent.Severity] onto the feedback-layer [Tone] the toast renders with. */
private fun toneOf(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

/**
 * The localized strings the surface draws, resolved once from the i18n catalog (P1/S10) so the stateless
 * content stays preview- and test-friendly. Every value is a catalog lookup — no string is authored in
 * native code.
 *
 * @property title the panel title (web `vehicleSettings.title`).
 * @property subtitle the panel subtitle (web `vehicleSettings.subtitle`).
 * @property errorTitle the hard-error title.
 * @property errorMessage the hard-error message (web `vehicleSettings.error`).
 * @property retry the retry CTA label.
 * @property offline the offline freshness label.
 * @property refresh the re-read affordance label.
 * @property loading the accessible loading-skeleton label.
 * @property save the Save button label (web `vehicleSettings.actions.save`).
 * @property saving the in-flight Save label (web `vehicleSettings.actions.saving`).
 * @property reset the Reset button label (web `vehicleSettings.actions.reset`).
 * @property resetting the in-flight Reset label (web `vehicleSettings.actions.resetting`).
 * @property sourceOverride the override source pill label.
 * @property sourceUser the user-default source pill label.
 * @property sourceVehicle the vehicle-name source pill label.
 * @property sourceDefault the system-default source pill label.
 * @property validationRequired the "value is required" inline message.
 * @property validationInvalid the "value is not valid" inline message.
 * @property validationInvalidDate the "enter a valid date" inline message.
 */
data class VehicleSettingsTabStrings(
    val title: String,
    val subtitle: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val offline: String,
    val refresh: String,
    val loading: String,
    val save: String,
    val saving: String,
    val reset: String,
    val resetting: String,
    val sourceOverride: String,
    val sourceUser: String,
    val sourceVehicle: String,
    val sourceDefault: String,
    val validationRequired: String,
    val validationInvalid: String,
    val validationInvalidDate: String,
)

/** Resolves the [VehicleSettingsTabStrings] from the i18n catalog (P1/S10), memoized per locale. */
@Composable
fun rememberVehicleSettingsTabStrings(): VehicleSettingsTabStrings {
    val title = stringResource(R.string.translation_vehicleSettings_title)
    val subtitle = stringResource(R.string.translation_vehicleSettings_subtitle)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_vehicleSettings_error)
    val retry = stringResource(R.string.translation_common_retry)
    val offline = stringResource(R.string.translation_common_offline)
    val refresh = stringResource(R.string.translation_common_refresh)
    val loading = stringResource(R.string.translation_a11y_loading)
    val save = stringResource(R.string.translation_vehicleSettings_actions_save)
    val saving = stringResource(R.string.translation_vehicleSettings_actions_saving)
    val reset = stringResource(R.string.translation_vehicleSettings_actions_reset)
    val resetting = stringResource(R.string.translation_vehicleSettings_actions_resetting)
    val sourceOverride = stringResource(R.string.translation_vehicleSettings_source_override)
    val sourceUser = stringResource(R.string.translation_vehicleSettings_source_user)
    val sourceVehicle = stringResource(R.string.translation_vehicleSettings_source_vehicle)
    val sourceDefault = stringResource(R.string.translation_vehicleSettings_source_default)
    val validationRequired = stringResource(R.string.translation_vehicleSettings_validation_required)
    val validationInvalid = stringResource(R.string.translation_vehicleSettings_validation_invalid)
    val validationInvalidDate = stringResource(R.string.translation_vehicleSettings_validation_invalidDate)
    return remember(title, subtitle, errorMessage, save, sourceOverride, validationRequired) {
        VehicleSettingsTabStrings(
            title = title,
            subtitle = subtitle,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            offline = offline,
            refresh = refresh,
            loading = loading,
            save = save,
            saving = saving,
            reset = reset,
            resetting = resetting,
            sourceOverride = sourceOverride,
            sourceUser = sourceUser,
            sourceVehicle = sourceVehicle,
            sourceDefault = sourceDefault,
            validationRequired = validationRequired,
            validationInvalid = validationInvalid,
            validationInvalidDate = validationInvalidDate,
        )
    }
}

// ── Previews — one per rendered state (content / loading / error / offline) ──────────────────────────────

private fun previewRow(
    descriptor: VehicleSettingDescriptor,
    source: EffectiveSettingSource,
    draft: String,
): VehicleSettingRowDisplay =
    VehicleSettingRowDisplay(
        key = descriptor.key,
        kind = descriptor.kind,
        options = descriptor.options,
        maxLength = descriptor.maxLength,
        source = source,
        draft = draft,
        isDirty = false,
        validation = null,
        saving = false,
        resetting = false,
    )

private fun previewRows(): List<VehicleSettingRowDisplay> =
    listOf(
        previewRow(VEHICLE_SETTING_DESCRIPTORS[0], EffectiveSettingSource.OVERRIDE, "Snowball"),
        previewRow(VEHICLE_SETTING_DESCRIPTORS[1], EffectiveSettingSource.DEFAULT, ""),
        previewRow(VEHICLE_SETTING_DESCRIPTORS[2], EffectiveSettingSource.DEFAULT, ""),
        previewRow(VEHICLE_SETTING_DESCRIPTORS[3], EffectiveSettingSource.USER, "mi"),
        previewRow(VEHICLE_SETTING_DESCRIPTORS[4], EffectiveSettingSource.USER, "F"),
        previewRow(VEHICLE_SETTING_DESCRIPTORS[5], EffectiveSettingSource.DEFAULT, "kWh"),
    )

private fun previewDisplay(
    status: VehicleSettingsTabStatus,
    rows: List<VehicleSettingRowDisplay> = previewRows(),
    stale: Boolean = false,
    offline: Boolean = false,
    errorKind: ErrorKind? = null,
): VehicleSettingsTabDisplay =
    VehicleSettingsTabDisplay(
        status = status,
        rows = rows,
        stale = stale,
        refreshing = false,
        offline = offline,
        canRetry = offline,
        fetchedAtMillis = if (rows.isEmpty()) null else PREVIEW_NOW,
        errorKind = errorKind,
    )

@Composable
private fun PreviewSurface(display: VehicleSettingsTabDisplay) {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSettingsTabContent(
            display = display,
            onEdit = { _, _ -> },
            onSave = {},
            onReset = {},
            onRetry = {},
            onRefresh = {},
            toasts = emptyList(),
            onToastDismiss = {},
        )
    }
}

@Preview(name = "VehicleSettingsTab · content", showBackground = true)
@Composable
private fun PreviewContent() = PreviewSurface(previewDisplay(VehicleSettingsTabStatus.Ready))

@Preview(name = "VehicleSettingsTab · loading", showBackground = true)
@Composable
private fun PreviewLoading() = PreviewSurface(previewDisplay(VehicleSettingsTabStatus.Loading, rows = emptyList()))

@Preview(name = "VehicleSettingsTab · error", showBackground = true)
@Composable
private fun PreviewError() =
    PreviewSurface(
        previewDisplay(VehicleSettingsTabStatus.Error, rows = emptyList(), errorKind = ErrorKind.Network),
    )

@Preview(name = "VehicleSettingsTab · offline", showBackground = true)
@Composable
private fun PreviewOffline() = PreviewSurface(previewDisplay(VehicleSettingsTabStatus.Ready, stale = true, offline = true))

private const val PREVIEW_NOW = 1_780_000_000_000L
