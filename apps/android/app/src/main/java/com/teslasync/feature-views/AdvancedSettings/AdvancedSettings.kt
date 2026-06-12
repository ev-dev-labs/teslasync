// The native Jetpack Compose + Material 3 Advanced Settings "Restore confirmation prompts" surface — a
// parity port of web/src/features/settings/components/AdvancedSettings.tsx. It reproduces the web
// composition: a GlassPanel (faded in) with a header (cyan IconBox + ShieldQuestion glyph + title +
// description, plus a "Restore all" affordance shown only when ≥1 prompt is silenced) over either a
// friendly empty state (web `silenced.length === 0`) or a bordered, divided list of silenced action ids
// — each a label (the web `useSilenceKeyLabel` mapping) beside a per-row "Restore" (RotateCcw) button.
// A first device-local read shows a skeleton; a hard read failure with nothing cached shows an error +
// retry; a failed re-read keeps the last list visible behind a stale/offline freshness chip. All data
// flows through the shared [AdvancedSettingsViewModel] (P1/S8); the view performs no I/O and the data is
// device-local, so the surface works fully offline. Every string resolves through the i18n catalog
// (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AdvancedSettings) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.advancedsettings

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private const val FADE_DELAY_MS = 240
private val MIN_TOUCH_TARGET = 44.dp
private const val SKELETON_ROWS = 3
private val SKELETON_ROW_HEIGHT = 28.dp
private val LIST_MIN_HEIGHT = 96.dp
private val LIST_CORNER = Radius.md
private const val DIVIDER_ALPHA = 0.4f
private const val COMMA_SPACE = ", "

/**
 * Stateful entry point. Collects the shared [AdvancedSettingsViewModel] state, records the one-shot
 * `view.opened` diagnostic + first device-local read (P1/S11), and renders the surface. A host supplies
 * the view-model (wired via [AdvancedSettingsViewModel.factory]).
 *
 * @param viewModel the state holder bound to the device-local confirm-silence allowlist.
 */
@Composable
fun AdvancedSettings(
    viewModel: AdvancedSettingsViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    AdvancedSettingsContent(
        state = state,
        modifier = modifier,
        onRestore = viewModel::restore,
        onRestoreAll = viewModel::restoreAll,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless surface — renders the faded-in GlassPanel with the always-present header (icon + title +
 * description + conditional "Restore all"), the optional stale/offline freshness chip, and the body for
 * every state: a loading skeleton on the first read, the error + retry (hard failure with nothing
 * cached), the friendly empty state (web `silenced.length === 0`), and the silenced-prompt list + per-row
 * restore. Hoisted out of the ViewModel so each state is preview- and screenshot-testable with hand-built
 * [UiState] inputs.
 */
@Composable
fun AdvancedSettingsContent(
    state: UiState<SilencedPrompts>,
    modifier: Modifier = Modifier,
    onRestore: (String) -> Unit = {},
    onRestoreAll: () -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    val strings = rememberAdvancedSettingsStrings()
    val prompts = state.data
    val hasPrompts = prompts != null && !prompts.isBlank
    FadeInPanel(modifier = modifier) {
        AdvancedSettingsHeader(
            showRestoreAll = hasPrompts && !state.isLoading && !state.isError,
            onRestoreAll = onRestoreAll,
        )
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (state.stale || state.hasError || state.refreshing) {
                AdvancedSettingsFreshness(state = state, onRefresh = onRefresh)
            }
            AdvancedSettingsBody(state = state, strings = strings, onRestore = onRestore, onRetry = onRetry)
        }
    }
}

/** The faded-in GlassPanel shell (web `<FadeIn delay={0.24}><GlassPanel>`). */
@Composable
private fun FadeInPanel(
    modifier: Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), content = content)
    }
}

/** The panel header — the cyan IconBox + title + description + the conditional "Restore all" affordance. */
@Composable
private fun AdvancedSettingsHeader(
    showRestoreAll: Boolean,
    onRestoreAll: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(AdvancedSettingsGlyphs.ShieldQuestion, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(
                stringResource(R.string.translation_settings_advanced_restoreConfirms_title),
                modifier = Modifier.semantics { heading() },
            )
            Caption(stringResource(R.string.translation_settings_advanced_restoreConfirms_description))
        }
        if (showRestoreAll) {
            Button(
                label = stringResource(R.string.translation_settings_advanced_restoreConfirms_restoreAll),
                onClick = onRestoreAll,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = AdvancedSettingsGlyphs.RotateCcw,
            )
        }
    }
}

/** The body — one of loading / error / content / empty, never a blank box. */
@Composable
private fun AdvancedSettingsBody(
    state: UiState<SilencedPrompts>,
    strings: AdvancedSettingsStrings,
    onRestore: (String) -> Unit,
    onRetry: () -> Unit,
) {
    val prompts = state.data
    when {
        state.isLoading -> AdvancedSettingsLoading()
        state.isError -> AdvancedSettingsError(onRetry = onRetry)
        prompts != null && !prompts.isBlank -> {
            val display = remember(prompts, strings) { AdvancedSettingsProjection.project(prompts, strings) }
            SilencedList(rows = display.rows, onRestore = onRestore)
        }
        else -> AdvancedSettingsEmpty()
    }
}

/** The silenced-prompt rows in a bordered, divided container (web `<ul class="divide-y ... border">`). */
@Composable
private fun SilencedList(
    rows: List<SilencedPromptRow>,
    onRestore: (String) -> Unit,
) {
    val restoreLabel = stringResource(R.string.translation_settings_advanced_restoreConfirms_restore)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(LIST_CORNER))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(LIST_CORNER)),
    ) {
        rows.forEachIndexed { index, row ->
            if (index > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA))
            }
            SilencedRow(row = row, restoreLabel = restoreLabel, onRestore = onRestore)
        }
    }
}

/** One silenced-prompt row — the friendly [SilencedPromptRow.label] beside its "Restore" control. */
@Composable
private fun SilencedRow(
    row: SilencedPromptRow,
    restoreLabel: String,
    onRestore: (String) -> Unit,
) {
    // Per-row TalkBack name so the (visually identical) "Restore" controls are distinguishable by which
    // prompt they re-enable, e.g. "Restore, Discard unsaved draft".
    val restoreContentDescription = "$restoreLabel$COMMA_SPACE${row.label}"
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BodyText(row.label, modifier = Modifier.weight(1f), maxLines = 1)
        Button(
            label = restoreLabel,
            onClick = { onRestore(row.key) },
            modifier = Modifier.semantics { contentDescription = restoreContentDescription },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = AdvancedSettingsGlyphs.RotateCcw,
        )
    }
}

/** The friendly empty state (web `<EmptyState>` when nothing is silenced). */
@Composable
private fun AdvancedSettingsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_settings_advanced_restoreConfirms_empty),
        icon = AdvancedSettingsGlyphs.ShieldQuestion,
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT),
    )
}

/** The first-read skeleton — shimmering row shapes with an accessible "loading" label. */
@Composable
private fun AdvancedSettingsLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/** The error state — the shared server-error message with a retry (web `QueryError` equivalent). */
@Composable
private fun AdvancedSettingsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT),
    )
}

/** The stale / offline freshness chip + re-read control, shown only over a degraded last-known list. */
@Composable
private fun AdvancedSettingsFreshness(
    state: UiState<SilencedPrompts>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            errorLabel = stringResource(R.string.translation_common_offline),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/**
 * Builds the localized label holder for the projection from the i18n catalog (P1/S10) — the two known
 * silence-key labels (the native port of `useSilenceKeyLabel`). The chrome strings (title, description,
 * empty, restore, restoreAll) are resolved inline where they are rendered.
 */
@Composable
private fun rememberAdvancedSettingsStrings(): AdvancedSettingsStrings {
    val discardDraft = stringResource(R.string.translation_settings_advanced_restoreConfirms_keys_discardDraft)
    val unsavedNavigation = stringResource(R.string.translation_settings_advanced_restoreConfirms_keys_unsavedNavigation)
    return remember(discardDraft, unsavedNavigation) {
        AdvancedSettingsStrings(discardDraftLabel = discardDraft, unsavedNavigationLabel = unsavedNavigation)
    }
}

// ── Previews — one per rendered state (content / empty / loading / error / offline) ──────────────────────

private val PREVIEW_PROMPTS =
    SilencedPrompts(listOf(ConfirmSilenceKeys.DISCARD_DRAFT, ConfirmSilenceKeys.UNSAVED_NAVIGATION))
private const val PREVIEW_NOW = 1_780_000_000_000L

@Preview(name = "AdvancedSettings · content", showBackground = true)
@Composable
private fun AdvancedSettingsContentPreview() {
    TeslaSyncTheme {
        AdvancedSettingsContent(state = UiState(phase = UiPhase.Content, data = PREVIEW_PROMPTS, fetchedAt = PREVIEW_NOW))
    }
}

@Preview(name = "AdvancedSettings · empty", showBackground = true)
@Composable
private fun AdvancedSettingsEmptyPreview() {
    TeslaSyncTheme {
        AdvancedSettingsContent(state = UiState(phase = UiPhase.Empty, data = SilencedPrompts.EMPTY, fetchedAt = PREVIEW_NOW))
    }
}

@Preview(name = "AdvancedSettings · loading", showBackground = true)
@Composable
private fun AdvancedSettingsLoadingPreview() {
    TeslaSyncTheme {
        AdvancedSettingsContent(state = UiState.loading())
    }
}

@Preview(name = "AdvancedSettings · error", showBackground = true)
@Composable
private fun AdvancedSettingsErrorPreview() {
    TeslaSyncTheme {
        AdvancedSettingsContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown))
    }
}

@Preview(name = "AdvancedSettings · offline", showBackground = true)
@Composable
private fun AdvancedSettingsOfflinePreview() {
    TeslaSyncTheme {
        AdvancedSettingsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_PROMPTS,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
        )
    }
}
