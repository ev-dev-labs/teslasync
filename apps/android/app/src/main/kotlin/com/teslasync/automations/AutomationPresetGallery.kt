// The Quick-Start preset gallery body for the AutomationsListPage (the content inside the collapsible GlassPanel6
// — web `<PresetGallery />` mounted in the `<details>`). A read-only, best-effort projection of the
// `useAutomationPresets` feed: every preset template's name, description, and action count. The one-click install
// affordance is the dedicated PresetGallery parity unit's responsibility and is intentionally out of scope here;
// this surface only renders the gallery's data with its loading / empty states so GlassPanel6 is never blank.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse

/**
 * The preset-gallery body. [state] is the `useAutomationPresets` surface: a spinner while loading, the
 * `presets.empty` message when there is nothing (including a failed best-effort fetch with no cache), else the
 * preset rows.
 */
@Composable
fun AutomationPresetGallery(
    state: UiState<AutomationPresetsResponse>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when {
            state.isLoading ->
                Spinner(
                    size = SpinnerSize.Sm,
                    modifier = Modifier.padding(Spacing.md),
                )

            else -> {
                val presets = state.data?.presets ?: emptyList()
                if (presets.isEmpty()) {
                    Caption(stringResource(R.string.translation_automations_presets_empty))
                } else {
                    presets.forEach { preset -> AutomationPresetRow(preset) }
                }
            }
        }
    }
}

@Composable
private fun AutomationPresetRow(preset: AutomationPreset) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Subhead(preset.name)
            preset.description.takeIf { it.isNotBlank() }?.let { HelperText(it) }
        }
        Badge(
            text = stringResource(R.string.translation_automations_presets_actionCount, preset.actions.size.toString()),
            variant = BadgeVariant.Info,
        )
    }
}
