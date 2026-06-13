// Compose render layer for the DashboardSettingsModal surface — the native analogue of the JSX the web component
// returns (web/src/features/dashboard/components/DashboardSettingsModal.tsx). It is a thin shell over the pure
// [DashboardSettingsModalProjection] derivations: a Material 3 modal hosting four sections — Identity (the dashboard
// name field + the 16-emoji icon picker), Vehicle Filter (a description + a vehicle dropdown scoping every widget),
// Auto-Refresh (the interval dropdown), and Display (the two toggles: show widget borders, compact mode) — followed by
// the Cancel + Save actions. Save fans out through the host callbacks (onRename when the name changed, onChangeIcon
// when the icon changed, always onUpdate) then dismisses, exactly as the web `handleSave` does. Every string is
// resolved from the i18n catalog (P1/S10); colors + spacing come from the generated theme tokens (P1/S9). No HTTP.
//
// Web parity note: the web component takes an `open` prop and renders a self-managed `<Modal open>`. The native idiom
// is conditional composition — the host renders `if (open) DashboardSettingsModal(...)` — so this surface omits the
// `open` parameter, exactly as the sibling FeedbackModal dialog does.
//
// State note: the web source is a controlled dialog — its only hook is useTranslation and it performs no data
// fetching, so there is no loading / error / stale / offline branch to reproduce. The single data-shaped variation is
// an empty vehicle list, which the always-present "All Vehicles" option absorbs (the dropdown is never blank).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs) cannot form
// a valid Kotlin package. `MatchingDeclarationName` is suppressed because the file's primary export is the
// `DashboardSettingsModal` composable (matching the filename); the co-located [DashboardSettingsModalStrings] carrier
// is a supporting type.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.dashboardsettingsmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier so the
 * stateless [DashboardSettingsModalContent] takes plain strings and stays trivially previewable + UI-testable.
 */
data class DashboardSettingsModalStrings(
    val title: String,
    val close: String,
    val identity: String,
    val nameLabel: String,
    val nameHint: String,
    val iconLabel: String,
    val vehicleFilter: String,
    val vehicleFilterDesc: String,
    val allVehicles: String,
    val refresh: String,
    val refresh0: String,
    val refresh5: String,
    val refresh10: String,
    val refresh30: String,
    val refresh60: String,
    val refresh300: String,
    val display: String,
    val showBorders: String,
    val compactMode: String,
    val cancel: String,
    val save: String,
)

/** Resolves every [DashboardSettingsModalStrings] entry from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberDashboardSettingsModalStrings(): DashboardSettingsModalStrings =
    DashboardSettingsModalStrings(
        title = stringResource(R.string.translation_dashSettings_title),
        close = stringResource(R.string.translation_common_close),
        identity = stringResource(R.string.translation_dashSettings_identity),
        nameLabel = stringResource(R.string.translation_dashSettings_nameLabel),
        nameHint = stringResource(R.string.translation_dashSettings_name),
        iconLabel = stringResource(R.string.translation_dashSettings_iconLabel),
        vehicleFilter = stringResource(R.string.translation_dashSettings_vehicleFilter),
        vehicleFilterDesc = stringResource(R.string.translation_dashSettings_vehicleFilterDesc),
        allVehicles = stringResource(R.string.translation_dashSettings_allVehicles),
        refresh = stringResource(R.string.translation_dashSettings_refresh),
        refresh0 = stringResource(R.string.translation_dashSettings_refresh0),
        refresh5 = stringResource(R.string.translation_dashSettings_refresh5),
        refresh10 = stringResource(R.string.translation_dashSettings_refresh10),
        refresh30 = stringResource(R.string.translation_dashSettings_refresh30),
        refresh60 = stringResource(R.string.translation_dashSettings_refresh60),
        refresh300 = stringResource(R.string.translation_dashSettings_refresh300),
        display = stringResource(R.string.translation_dashSettings_display),
        showBorders = stringResource(R.string.translation_dashSettings_showBorders),
        compactMode = stringResource(R.string.translation_dashSettings_compactMode),
        cancel = stringResource(R.string.translation_common_cancel),
        save = stringResource(R.string.translation_common_save),
    )

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), then renders the modal form.
 * A host supplies the target [dashboard], the [vehicles] for the filter dropdown, and the four mutation callbacks; the
 * dialog itself performs no data fetching (web `useTranslation`-only). No HTTP.
 *
 * @param dashboard the dashboard being edited; its id re-seeds the form when the target changes (web open-effect deps).
 * @param vehicles the selectable vehicles for the per-dashboard vehicle filter (web `vehicles` prop).
 * @param onUpdate applies the edited settings block — always invoked on Save (web `onUpdate`).
 * @param onRename renames the dashboard — invoked on Save only when the trimmed name changed (web `onRename`).
 * @param onChangeIcon changes the dashboard icon — invoked on Save only when the icon changed (web `onChangeIcon`).
 * @param onClose dismiss callback — invoked by Cancel/close and after a successful Save (web `onClose`).
 */
@Composable
fun DashboardSettingsModal(
    dashboard: DashboardSummary,
    vehicles: List<VehicleOption>,
    onUpdate: (DashboardSettingsValues) -> Unit,
    onRename: (String) -> Unit,
    onChangeIcon: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordDashboardSettingsModalOpened(logger) }
    val strings = rememberDashboardSettingsModalStrings()

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        DashboardSettingsModalContent(
            strings = strings,
            dashboard = dashboard,
            vehicles = vehicles,
            onSave = { result ->
                result.rename?.let(onRename)
                result.icon?.let(onChangeIcon)
                onUpdate(result.settings)
                onClose()
            },
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral draft seeded
 * from [dashboard] (web `useState` + open-effect; re-seeds when [dashboard] changes), applies each edit, and on Save
 * hands the resolved [DashboardSettingsSaveResult] back through [onSave]. Every control carries an accessible label.
 */
@Composable
fun DashboardSettingsModalContent(
    strings: DashboardSettingsModalStrings,
    dashboard: DashboardSummary,
    vehicles: List<VehicleOption>,
    onSave: (DashboardSettingsSaveResult) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember(dashboard) { mutableStateOf(DashboardSettingsModalProjection.initialDraft(dashboard)) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        SettingsSection(strings.identity) {
            Input(
                value = draft.name,
                onValueChange = { draft = draft.copy(name = it) },
                label = strings.nameLabel,
                hint = strings.nameHint,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(strings.iconLabel)
                EmojiPicker(selectedEmoji = draft.icon, onSelect = { draft = draft.copy(icon = it) })
            }
        }

        SettingsSection(strings.vehicleFilter) {
            HelperText(strings.vehicleFilterDesc)
            Select(
                options = vehicleSelectOptions(strings.allVehicles, vehicles),
                selectedValue = draft.settings.vehicleId?.toString() ?: "",
                onSelect = { value ->
                    val vehicleId = DashboardSettingsModalProjection.parseVehicleId(value)
                    draft = draft.copy(settings = draft.settings.copy(vehicleId = vehicleId))
                },
                emptyLabel = strings.allVehicles,
            )
        }

        SettingsSection(strings.refresh) {
            Select(
                options = refreshSelectOptions(strings),
                selectedValue = draft.settings.refreshInterval.toString(),
                onSelect = { value ->
                    val interval = DashboardSettingsModalProjection.parseRefresh(value)
                    draft = draft.copy(settings = draft.settings.copy(refreshInterval = interval))
                },
            )
        }

        SettingsSection(strings.display) {
            Toggle(
                checked = draft.settings.showWidgetBorders,
                onCheckedChange = { draft = draft.copy(settings = draft.settings.copy(showWidgetBorders = it)) },
                label = strings.showBorders,
            )
            Toggle(
                checked = draft.settings.compactMode,
                onCheckedChange = { draft = draft.copy(settings = draft.settings.copy(compactMode = it)) },
                label = strings.compactMode,
            )
        }

        HorizontalDivider()
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        ) {
            Button(label = strings.cancel, onClick = onCancel, variant = ButtonVariant.Ghost)
            Button(
                label = strings.save,
                onClick = { onSave(DashboardSettingsModalProjection.resolveSave(dashboard, draft)) },
                variant = ButtonVariant.Primary,
            )
        }
    }
}

/** One titled settings block: a [Subhead] section heading over its [content] (web `<h3>` + the section body). */
@Composable
private fun SettingsSection(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Subhead(title)
        content()
    }
}

/**
 * The 16-emoji icon grid (web `EmojiPicker`, `grid grid-cols-8`). Wraps to fewer columns on narrow widths via
 * [FlowRow]; each cell announces its emoji + selected state to TalkBack (web `aria-label={emoji}` + selected ring).
 */
@Composable
private fun EmojiPicker(
    selectedEmoji: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        maxItemsInEachRow = EMOJI_COLUMNS,
    ) {
        DASHBOARD_EMOJIS.forEach { emoji ->
            EmojiCell(emoji = emoji, isSelected = emoji == selectedEmoji, onSelect = { onSelect(emoji) })
        }
    }
}

/** One emoji choice — a square, accessible toggle target highlighted (border + tint) when it is the chosen icon. */
@Composable
private fun EmojiCell(
    emoji: String,
    isSelected: Boolean,
    onSelect: () -> Unit,
) {
    Surface(
        onClick = onSelect,
        modifier =
            Modifier
                .size(EMOJI_CELL_SIZE)
                .semantics {
                    contentDescription = emoji
                    selected = isSelected
                },
        shape = MaterialTheme.shapes.small,
        color = if (isSelected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
        border = if (isSelected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null,
    ) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(text = emoji, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** The vehicle-filter dropdown options — the "All Vehicles" choice (empty value) followed by each vehicle (web list). */
private fun vehicleSelectOptions(
    allVehiclesLabel: String,
    vehicles: List<VehicleOption>,
): List<SelectOption> =
    buildList {
        add(SelectOption(value = "", label = allVehiclesLabel))
        vehicles.forEach { add(SelectOption(value = it.id.toString(), label = it.displayName)) }
    }

/** The auto-refresh dropdown options, in display order, each labelled from the localized carrier (web `REFRESH_OPTIONS`). */
private fun refreshSelectOptions(strings: DashboardSettingsModalStrings): List<SelectOption> =
    DashboardSettingsModalProjection.refreshOptions.map { option ->
        SelectOption(value = option.wire, label = refreshLabel(option, strings))
    }

private fun refreshLabel(
    option: RefreshIntervalOption,
    strings: DashboardSettingsModalStrings,
): String =
    when (option) {
        RefreshIntervalOption.Default -> strings.refresh0
        RefreshIntervalOption.FiveSeconds -> strings.refresh5
        RefreshIntervalOption.TenSeconds -> strings.refresh10
        RefreshIntervalOption.ThirtySeconds -> strings.refresh30
        RefreshIntervalOption.OneMinute -> strings.refresh60
        RefreshIntervalOption.FiveMinutes -> strings.refresh300
    }

/** Web `grid-cols-8` — the icon grid's preferred column count (FlowRow wraps earlier on narrow widths). */
private const val EMOJI_COLUMNS = 8

/** Square edge for one emoji cell (web `h-8 w-8` lifted to a comfortable touch target). */
private val EMOJI_CELL_SIZE = 40.dp
