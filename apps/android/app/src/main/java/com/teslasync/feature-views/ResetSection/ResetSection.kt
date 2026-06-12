// The native Jetpack Compose + Material 3 Reset-to-defaults surface — a parity port of
// web/src/features/settings/components/ResetSection.tsx. It reproduces the web composition: a faded-in stack
// of three GlassPanels — (1) "Reset to defaults", a header (amber IconBox + RotateCcw + title + subtitle) over
// a divided list of every whitelisted section, each a section icon + title + description beside a ghost
// "Reset" button; (2) "Sections that aren't user-resettable", a read-only deny-list (cyan Shield header +
// AlertTriangle rows); (3) the "Danger zone" (red AlertOctagon header + a destructive "Reset ALL settings"
// button). Tapping a section's Reset opens a danger ConfirmDialog describing that reset; the Danger-zone
// button opens a typed-confirmation dialog that requires the user to type RESET. A confirm runs the matching
// mutation (busy → the dialog stays open + loading), then raises a success toast with the receipt counts or a
// failure toast.
//
// All state + mutations flow through the shared [ResetSectionViewModel] (P1/S8); the view performs no HTTP
// (ADR-002). Because the web component is MUTATION-ONLY (two `useMutation`s, no `useQuery`), there is no data
// feed and therefore no loading / empty / stale / offline surface — the section + deny lists are static
// localized constants; the only lifecycle is the confirm-then-run mutation, whose busy / success / failure
// states are all rendered. Every string resolves through the i18n catalog (P1/S10) and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResetSection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.resetsection

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

private const val FADE_DELAY_MS = 240
private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val DIVIDER_ALPHA = 0.4f
private val MIN_TOUCH_TARGET = 44.dp
private const val A11Y_LABEL_SEPARATOR = ", "

/**
 * Stateful entry point. Binds the supplied [source] (P1/S8) into a [ResetSectionViewModel], records the
 * one-shot `view.opened` diagnostic, collects the dialog/busy state and the success/failure toast stream, and
 * renders the surface. The host owns the shared `SettingsResetStore` and passes
 * `store.asResetSectionSource()`; this view never performs HTTP.
 *
 * @param source the settings-reset mutation seam (web `useResetSection` + `useResetAllSettings`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ResetSection(
    source: ResetSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ResetSectionViewModel = viewModel(factory = ResetSectionViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    val state by viewModel.state.collectAsStateWithLifecycle()

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

    ResetSectionContent(
        state = state,
        toasts = toasts,
        onRequestSection = viewModel::requestSection,
        onRequestAll = viewModel::requestAll,
        onConfirm = viewModel::confirm,
        onDismiss = viewModel::dismiss,
        onToastDismiss = { id -> toasts = dismissToast(toasts, id) },
        modifier = modifier,
    )
}

/**
 * Stateless surface — the unit/UI-test + preview entry point. Renders the faded-in three-panel stack
 * (by-section list, deny-list, danger zone), the per-section + danger-zone confirm dialogs (driven by
 * [state]), and the bottom-anchored toast host. Hoisted out of the ViewModel so each state is preview- and
 * screenshot-testable with hand-built inputs.
 */
@Composable
fun ResetSectionContent(
    state: ResetSectionUiState,
    toasts: List<ToastItem>,
    onRequestSection: (ResetSectionRow) -> Unit,
    onRequestAll: () -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onToastDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val sections = rememberSectionRows()
    val denied = rememberDeniedRows()
    Box(modifier = modifier.fillMaxWidth()) {
        FadeIn(delayMs = FADE_DELAY_MS) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                BySectionPanel(sections = sections, state = state, onRequestReset = onRequestSection)
                DeniedPanel(rows = denied)
                DangerZonePanel(busy = state.busy, onResetAll = onRequestAll)
            }
        }
        ToastHost(toasts = toasts, onDismiss = onToastDismiss, modifier = Modifier.align(Alignment.BottomCenter))
    }
    ResetDialogs(state = state, onConfirm = onConfirm, onDismiss = onDismiss)
}

/** The "Reset to defaults" panel: header + the divided list of resettable sections with per-row Reset buttons. */
@Composable
private fun BySectionPanel(
    sections: List<ResetSectionRow>,
    state: ResetSectionUiState,
    onRequestReset: (ResetSectionRow) -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        PanelHeader(
            tone = IconBoxTone.Warning,
            glyph = ResetSectionGlyphs.RotateCcw,
            title = stringResource(R.string.translation_settingsReset_title),
            headingLevel = HeadingLevel.Section,
            subtitle = stringResource(R.string.translation_settingsReset_subtitle),
        )
        val resetLabel = stringResource(R.string.translation_settingsReset_actions_reset)
        Column(modifier = Modifier.fillMaxWidth().padding(top = Spacing.md)) {
            sections.forEachIndexed { index, row ->
                if (index > 0) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA))
                }
                SectionRowItem(
                    row = row,
                    busy = state.isSectionBusy(row.id),
                    resetLabel = resetLabel,
                    onRequestReset = onRequestReset,
                )
            }
        }
    }
}

/** One resettable-section row — the section icon, title + description, and the per-row ghost "Reset" button. */
@Composable
private fun SectionRowItem(
    row: ResetSectionRow,
    busy: Boolean,
    resetLabel: String,
    onRequestReset: (ResetSectionRow) -> Unit,
) {
    // Per-row TalkBack name so the (visually identical) "Reset" buttons are distinguishable, e.g. "Reset, Geofences".
    val resetDescription = "$resetLabel$A11Y_LABEL_SEPARATOR${row.title}"
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET).padding(vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Sm) {
            Icon(iconFor(row.id), contentDescription = null, size = IconSize.Md)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Subhead(row.title)
            HelperText(row.description)
        }
        Button(
            label = resetLabel,
            onClick = { onRequestReset(row) },
            modifier = Modifier.semantics { contentDescription = resetDescription },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !busy,
            leadingIcon = ResetSectionGlyphs.RotateCcw,
        )
    }
}

/** The read-only deny-list panel — sections that live outside the server's preference store. */
@Composable
private fun DeniedPanel(rows: List<ResetDeniedRow>) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        PanelHeader(
            tone = IconBoxTone.Info,
            glyph = ResetSectionGlyphs.Shield,
            title = stringResource(R.string.translation_settingsReset_deniedTitle),
            headingLevel = HeadingLevel.Panel,
            subtitle = stringResource(R.string.translation_settingsReset_deniedSubtitle),
        )
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            rows.forEach { DeniedRowItem(it) }
        }
    }
}

/** One deny-list row — an amber warning marker beside the section name + the reason / alternative path. */
@Composable
private fun DeniedRowItem(row: ResetDeniedRow) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            ResetSectionGlyphs.AlertTriangle,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.warning,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Subhead(row.title)
            HelperText(row.reason)
        }
    }
}

/** The Danger-zone panel — a destructive bordered panel with the "Reset ALL settings" affordance. */
@Composable
private fun DangerZonePanel(
    busy: Boolean,
    onResetAll: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), accent = PanelAccent.Danger) {
        PanelHeader(
            tone = IconBoxTone.Danger,
            glyph = ResetSectionGlyphs.AlertOctagon,
            title = stringResource(R.string.translation_settingsReset_dangerZone_title),
            headingLevel = HeadingLevel.Section,
            subtitle = stringResource(R.string.translation_settingsReset_dangerZone_subtitle),
        )
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            HelperText(stringResource(R.string.translation_settingsReset_dangerZone_help))
            Button(
                label = stringResource(R.string.translation_settingsReset_dangerZone_cta),
                onClick = onResetAll,
                modifier = Modifier.align(Alignment.End),
                variant = ButtonVariant.Danger,
                enabled = !busy,
                leadingIcon = ResetSectionGlyphs.RotateCcw,
            )
        }
    }
}

/** The panel header shared by all three panels — a tinted IconBox glyph beside a title + muted subtitle. */
@Composable
private fun PanelHeader(
    tone: IconBoxTone,
    glyph: ImageVector,
    title: String,
    headingLevel: HeadingLevel,
    subtitle: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = tone, size = IconBoxSize.Md) {
            Icon(glyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Heading(title, level = headingLevel, modifier = Modifier.semantics { heading() })
            HelperText(subtitle)
        }
    }
}

/** The per-section + Danger-zone confirm dialogs (web's two `<ConfirmDialog>`s), driven by [state]. */
@Composable
private fun ResetDialogs(
    state: ResetSectionUiState,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val cancelLabel = stringResource(R.string.translation_settingsReset_confirm_cancelLabel)
    val closeLabel = stringResource(R.string.translation_common_close)
    val pending = state.pendingSection
    if (pending != null) {
        ConfirmDialog(
            title = context.getString(R.string.translation_settingsReset_confirm_sectionTitle, pending.title),
            message = context.getString(R.string.translation_settingsReset_confirm_sectionMessage, pending.description),
            confirmLabel = stringResource(R.string.translation_settingsReset_confirm_confirmLabel),
            cancelLabel = cancelLabel,
            onConfirm = onConfirm,
            onCancel = onDismiss,
            severity = ConfirmSeverity.Danger,
            loading = state.busy,
            closeLabel = closeLabel,
        )
    }
    if (state.isAllDialogOpen) {
        ConfirmDialog(
            title = stringResource(R.string.translation_settingsReset_confirm_allTitle),
            message = stringResource(R.string.translation_settingsReset_confirm_allMessage),
            confirmLabel = stringResource(R.string.translation_settingsReset_confirm_allConfirmLabel),
            cancelLabel = cancelLabel,
            onConfirm = onConfirm,
            onCancel = onDismiss,
            severity = ConfirmSeverity.Danger,
            loading = state.busy,
            requireTypedConfirmation = RESET_CONFIRMATION,
            typedConfirmationLabel = stringResource(R.string.translation_settingsReset_confirm_typedLabel),
            closeLabel = closeLabel,
        )
    }
}

/**
 * Resolves the eight resettable-section rows from the i18n catalog (P1/S10), in the canonical
 * [ResetSectionCatalog.SECTIONS] order. Each id's title + description is read once and the ordered list is
 * remembered so the row build is stable across recompositions.
 */
@Composable
private fun rememberSectionRows(): List<ResetSectionRow> {
    val generalTitle = stringResource(R.string.translation_settingsReset_section_general_title)
    val generalDesc = stringResource(R.string.translation_settingsReset_section_general_desc)
    val appearanceTitle = stringResource(R.string.translation_settingsReset_section_appearance_title)
    val appearanceDesc = stringResource(R.string.translation_settingsReset_section_appearance_desc)
    val alertRulesTitle = stringResource(R.string.translation_settingsReset_section_alertRules_title)
    val alertRulesDesc = stringResource(R.string.translation_settingsReset_section_alertRules_desc)
    val geofencesTitle = stringResource(R.string.translation_settingsReset_section_geofences_title)
    val geofencesDesc = stringResource(R.string.translation_settingsReset_section_geofences_desc)
    val channelsTitle = stringResource(R.string.translation_settingsReset_section_notificationChannels_title)
    val channelsDesc = stringResource(R.string.translation_settingsReset_section_notificationChannels_desc)
    val dashboardTitle = stringResource(R.string.translation_settingsReset_section_dashboardLayout_title)
    val dashboardDesc = stringResource(R.string.translation_settingsReset_section_dashboardLayout_desc)
    val automationsTitle = stringResource(R.string.translation_settingsReset_section_automations_title)
    val automationsDesc = stringResource(R.string.translation_settingsReset_section_automations_desc)
    val quietHoursTitle = stringResource(R.string.translation_settingsReset_section_quietHours_title)
    val quietHoursDesc = stringResource(R.string.translation_settingsReset_section_quietHours_desc)
    return remember(
        generalTitle,
        generalDesc,
        appearanceTitle,
        appearanceDesc,
        alertRulesTitle,
        alertRulesDesc,
        geofencesTitle,
        geofencesDesc,
        channelsTitle,
        channelsDesc,
        dashboardTitle,
        dashboardDesc,
        automationsTitle,
        automationsDesc,
        quietHoursTitle,
        quietHoursDesc,
    ) {
        listOf(
            ResetSectionRow(ResetSectionId.General, generalTitle, generalDesc),
            ResetSectionRow(ResetSectionId.Appearance, appearanceTitle, appearanceDesc),
            ResetSectionRow(ResetSectionId.AlertRules, alertRulesTitle, alertRulesDesc),
            ResetSectionRow(ResetSectionId.Geofences, geofencesTitle, geofencesDesc),
            ResetSectionRow(ResetSectionId.NotificationChannels, channelsTitle, channelsDesc),
            ResetSectionRow(ResetSectionId.DashboardLayout, dashboardTitle, dashboardDesc),
            ResetSectionRow(ResetSectionId.Automations, automationsTitle, automationsDesc),
            ResetSectionRow(ResetSectionId.QuietHours, quietHoursTitle, quietHoursDesc),
        )
    }
}

/** Resolves the two deny-list rows from the i18n catalog (P1/S10), in the canonical web order. */
@Composable
private fun rememberDeniedRows(): List<ResetDeniedRow> {
    val tariffsTitle = stringResource(R.string.translation_settingsReset_denied_tariffs_title)
    val tariffsReason = stringResource(R.string.translation_settingsReset_denied_tariffs_reason)
    val soundTitle = stringResource(R.string.translation_settingsReset_denied_soundPrefs_title)
    val soundReason = stringResource(R.string.translation_settingsReset_denied_soundPrefs_reason)
    return remember(tariffsTitle, tariffsReason, soundTitle, soundReason) {
        listOf(
            ResetDeniedRow(ResetSectionCatalog.DENIED_TARIFFS, tariffsTitle, tariffsReason),
            ResetDeniedRow(ResetSectionCatalog.DENIED_SOUND_PREFS, soundTitle, soundReason),
        )
    }
}

/** Maps a resettable section to its lucide row glyph (web `useSectionRows` `icon`). */
private fun iconFor(id: ResetSectionId): ImageVector =
    when (id) {
        ResetSectionId.General -> ResetSectionGlyphs.Cog
        ResetSectionId.Appearance -> ResetSectionGlyphs.Palette
        ResetSectionId.AlertRules -> ResetSectionGlyphs.Bell
        ResetSectionId.Geofences -> ResetSectionGlyphs.MapPin
        ResetSectionId.NotificationChannels -> ResetSectionGlyphs.Bell
        ResetSectionId.DashboardLayout -> ResetSectionGlyphs.LayoutDashboard
        ResetSectionId.Automations -> ResetSectionGlyphs.Workflow
        ResetSectionId.QuietHours -> ResetSectionGlyphs.Calendar
    }

/** Resolves a [UiEvent.Message] toast to its localized text (ADR-014 — the render boundary owns the lookup). */
private fun resolveToastMessage(
    context: Context,
    event: UiEvent.Message,
): String =
    when (event.messageKey) {
        SUCCESS_DETAIL_KEY ->
            context.getString(
                R.string.translation_settingsReset_toasts_successDetail,
                event.args.getOrElse(0) { "0" },
                event.args.getOrElse(1) { "0" },
            )

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

// ── Previews — one per rendered state (content / per-section dialog / danger dialog / busy) ───────────────

private val PREVIEW_PENDING =
    ResetSectionRow(
        id = ResetSectionId.Geofences,
        title = "Geofences",
        description = "Delete every geofence and its electricity-rate overrides. Vehicle home assignments will be cleared.",
    )

@Composable
private fun PreviewSurface(
    state: ResetSectionUiState,
    toasts: List<ToastItem> = emptyList(),
) {
    TeslaSyncTheme(dynamicColor = false) {
        ResetSectionContent(
            state = state,
            toasts = toasts,
            onRequestSection = {},
            onRequestAll = {},
            onConfirm = {},
            onDismiss = {},
            onToastDismiss = {},
        )
    }
}

@Preview(name = "ResetSection · content", showBackground = true)
@Composable
private fun ResetSectionContentPreview() {
    PreviewSurface(state = ResetSectionUiState())
}

@Preview(name = "ResetSection · section dialog", showBackground = true)
@Composable
private fun ResetSectionSectionDialogPreview() {
    PreviewSurface(state = ResetSectionUiState(dialog = ResetDialog.Section(PREVIEW_PENDING)))
}

@Preview(name = "ResetSection · danger dialog", showBackground = true)
@Composable
private fun ResetSectionAllDialogPreview() {
    PreviewSurface(state = ResetSectionUiState(dialog = ResetDialog.All))
}

@Preview(name = "ResetSection · busy", showBackground = true)
@Composable
private fun ResetSectionBusyPreview() {
    PreviewSurface(state = ResetSectionUiState(dialog = ResetDialog.Section(PREVIEW_PENDING), busy = true))
}
