// The native Jetpack Compose + Material 3 DatePresetChips shared surface — a parity port of
// web/src/components/forms/DatePresetChips.tsx. The web component is a tiny presentational chip row: it filters
// the static `DATE_PRESETS` registry down to the caller's `presetIds` and renders one shared `<Button>` chip per
// preset (variant `primary` for the `activeId`, else `ghost`, with `aria-pressed`); a tap resolves the preset
// against the local calendar day into `{ id, start, end }` ISO strings and calls `onSelect`. This surface keeps
// that contract end to end and reproduces every state the web source has without ever hiding a region: the
// content chip row and — when the caller's `presetIds` match no known preset — a friendly empty state (the
// prompt's matrix upgrades the web's empty row into a labelled [EmptyState]).
//
// It performs NO HTTP and binds NO data state holder: the web component fetches nothing; its only hook is
// `useTranslation` — the i18n catalog (P1/S10) resolved here at the render boundary through [rememberStringResolver]
// (a `getIdentifier` lookup over the generated catalog with the web English fallback), exactly the idiom the
// sibling AIFeatureCard surface uses. See DatePresetChipsModel.kt for the honesty rationale and why the generic
// loading/error/stale/offline states do not apply to a registry-backed control. The chrome is composed from the
// shared component library (ui Button, feedback EmptyState) over the per-theme tokens (P1/S9); every string
// resolves through the i18n catalog (P1/S10); the group carries the web `aria-label`, every chip exposes its
// `aria-pressed` state to TalkBack via `selected` semantics, and a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) fires on first composition carrying only the surface slug.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DatePresetChips) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datepresetchips

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/**
 * Stateful entry point — the parity port of the web `DatePresetChips({ presetIds, activeId, onSelect, size,
 * ariaLabel })`. Records the one-shot `view.opened` diagnostic (P1/S11) on first composition, projects the
 * caller's [presetIds] + [activeId] into the render-ready chip row, and renders it. The chips are static
 * (registry + membership), so they are projected once per input change; the selected range is resolved against
 * [today] at tap time (the web `p.resolve()` over the current wall-clock day) and handed to [onSelect].
 *
 * @param onSelect receives the tapped preset's `{ id, start, end }` (web `onSelect`).
 * @param presetIds the subset of preset ids to render; defaults to [DEFAULT_PRESET_IDS] (web default).
 * @param activeId the id of the currently-active preset to highlight, or null (web `activeId`).
 * @param size the chip size on the shared Button scale; defaults to [ButtonSize.Sm] (web default `'sm'`).
 * @param ariaLabel an override for the group's accessible name; defaults to the localized group label.
 * @param today the calendar day taps resolve against; defaults to the device's current local day.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param resolve the i18n facade; defaults to a catalog-backed resolver with the web English fallback.
 */
@Composable
fun DatePresetChips(
    onSelect: (DatePresetSelection) -> Unit,
    modifier: Modifier = Modifier,
    presetIds: List<String> = DEFAULT_PRESET_IDS,
    activeId: String? = null,
    size: ButtonSize = ButtonSize.Sm,
    ariaLabel: String? = null,
    today: LocalDate = LocalDate.now(),
    logger: Logger = LocalDataContainer.current.logger,
    resolve: StringResolver = rememberStringResolver(),
) {
    LaunchedEffect(Unit) { recordDatePresetChipsViewOpened(logger) }
    val display = remember(presetIds, activeId) { projectDatePresetChips(presetIds, activeId) }

    DatePresetChipsContent(
        display = display,
        onSelect = { id -> resolveSelection(id, today)?.let(onSelect) },
        groupLabel = datePresetGroupLabel(resolve, ariaLabel),
        emptyMessage = resolve(DatePresetChipsRegistration.EMPTY_KEY, DatePresetChipsRegistration.EMPTY_EN),
        label = { chip -> chipLabel(chip, resolve) },
        modifier = modifier,
        size = size,
    )
}

/**
 * Stateless chip row — the unit/UI-test + preview entry point. Draws every branch the web source has: the
 * wrap-around row of preset chips (web `flex flex-wrap`), each a shared [Button] whose [ButtonVariant] mirrors
 * the web `primary`/`ghost` highlight and whose `selected` semantics carries the web `aria-pressed`; and, when
 * there are no chips, a labelled [EmptyState] so the surface is never a blank box. The group carries the web
 * `aria-label` via [groupLabel].
 */
@Composable
fun DatePresetChipsContent(
    display: DatePresetChipsDisplay,
    onSelect: (String) -> Unit,
    groupLabel: String,
    emptyMessage: String,
    label: (DatePresetChip) -> String,
    modifier: Modifier = Modifier,
    size: ButtonSize = ButtonSize.Sm,
) {
    when (display.phase) {
        DatePresetChipsPhase.Empty ->
            EmptyState(message = emptyMessage, modifier = modifier.fillMaxWidth())

        DatePresetChipsPhase.Content ->
            FlowRow(
                modifier = modifier.fillMaxWidth().semantics { contentDescription = groupLabel },
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                display.chips.forEach { chip ->
                    DatePresetChipButton(
                        chip = chip,
                        label = label(chip),
                        size = size,
                        onClick = { onSelect(chip.id) },
                    )
                }
            }
    }
}

/**
 * One preset chip — a shared [Button] coloured [ButtonVariant.Primary] when [DatePresetChip.active] (web
 * `primary`) else [ButtonVariant.Ghost] (web `ghost`), with the web `aria-pressed` exposed to TalkBack as the
 * `selected` state so the active range is announced.
 */
@Composable
private fun DatePresetChipButton(
    chip: DatePresetChip,
    label: String,
    size: ButtonSize,
    onClick: () -> Unit,
) {
    Button(
        label = label,
        onClick = onClick,
        modifier = Modifier.semantics { selected = chip.active },
        variant = if (chip.active) ButtonVariant.Primary else ButtonVariant.Ghost,
        size = size,
    )
}

/**
 * Builds the production i18n resolver — the P1/S10 catalog looked up by the folded resource name with the web
 * English fallback when a key is absent (web `t(key, fallback)`). Tests + previews pass [FallbackResolver].
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Previews — one per rendered state (default set / active highlight / empty). ───────────────────────────────

private fun previewDisplay(
    presetIds: List<String> = DEFAULT_PRESET_IDS,
    activeId: String? = null,
): DatePresetChipsDisplay = projectDatePresetChips(presetIds, activeId)

@Composable
private fun PreviewChips(display: DatePresetChipsDisplay) {
    DatePresetChipsContent(
        display = display,
        onSelect = {},
        groupLabel = DatePresetChipsRegistration.GROUP_LABEL_EN,
        emptyMessage = DatePresetChipsRegistration.EMPTY_EN,
        label = { it.fallback },
    )
}

@Preview(name = "DatePresetChips · default set", showBackground = true)
@Composable
private fun DatePresetChipsDefaultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewChips(previewDisplay())
    }
}

@Preview(name = "DatePresetChips · active highlight", showBackground = true)
@Composable
private fun DatePresetChipsActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewChips(previewDisplay(activeId = "30d"))
    }
}

@Preview(name = "DatePresetChips · empty", showBackground = true)
@Composable
private fun DatePresetChipsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewChips(previewDisplay(presetIds = emptyList()))
    }
}
