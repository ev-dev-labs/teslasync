// The native Jetpack Compose + Material 3 DraftRestorePrompt shared surface — a parity port of
// web/src/components/feedback/DraftRestorePrompt.tsx. The web component surfaces unsaved `useFormDraft` work
// recovered after a tab close, crash, PWA reload, or auth redirect: a compact bottom-left card ("Unsaved
// drafts restored" + Review / Dismiss) and a review modal listing every draft with per-row Resume / Discard.
// This native surface keeps that contract end to end and renders every state the prompt's matrix mandates
// without ever hiding a region: loading (the draft-store read's skeleton), content (the card + list), empty
// (the modal's "No drafts to restore." friendly empty state — the web `getDrafts()` empty branch), a hard
// error with Retry, and a stale/offline freshness chip over the cached list.
//
// It performs NO HTTP and binds the recoverable-draft list only through the draft registry seam
// ([DraftRestorePromptSource], default [DraftRegistry.shared]) folded through [DraftRestorePromptViewModel] +
// the pure [DraftRestoreProjection]; the composable resolves the i18n labels (P1/S10) and design tokens
// (P1/S9) and draws what the projection returns, using the shared component library (ui GlassPanel / Button /
// Modal / StatusPill / typography, feedback QueryError / Skeleton / EmptyState, motion FadeIn). `useNavigate`
// maps to the host-supplied [onNavigate] callback (the view never touches the NavController, mirroring the
// sibling QuickNav / HistoryListRow ports). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DraftRestorePrompt) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private val CARD_MAX_WIDTH = 380.dp
private val ROW_SKELETON_HEIGHT = 48.dp
private const val SKELETON_ROW_COUNT = 2

/**
 * Stateful entry point — the parity port of the web `DraftRestorePrompt`. Binds the draft registry via
 * [source] into a [DraftRestorePromptViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on
 * first composition, collects the recoverable-draft [io.teslasync.android.data.UiState] + the per-session
 * dismissed guard, projects the feed via [DraftRestoreProjection], auto-refreshes a stale cache, and renders
 * the compact card plus the review modal. Once dismissed/resumed it stays hidden for the session (web
 * `sessionStorage` one-shot guard). The [source] defaults to the app-wide [DraftRegistry.shared].
 *
 * The host places this surface (the web uses fixed bottom-left positioning); apply [modifier] to position
 * and size the card within the host scaffold.
 *
 * @param onNavigate invoked with a draft's in-app route when the user resumes it (web `navigate(entry.route)`);
 *   the host wires it to its NavController. The view never touches navigation directly.
 * @param source the recoverable-draft registry seam (the shared registry, or a fake in tests).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DraftRestorePrompt(
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    source: DraftRestorePromptSource = DraftRegistry.shared,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DraftRestorePromptViewModel =
        viewModel(
            key = DraftRestorePromptRegistration.SLUG,
            factory = DraftRestorePromptViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val state by viewModel.drafts.collectAsStateWithLifecycle()
    val dismissed by viewModel.dismissed.collectAsStateWithLifecycle()
    val display = remember(state) { DraftRestoreProjection.project(state) }
    val nowMillis = rememberSaveable { System.currentTimeMillis() }
    var reviewOpen by rememberSaveable { mutableStateOf(false) }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    if (dismissed) return

    if (display.showCard && !reviewOpen) {
        FadeIn(modifier = modifier) {
            DraftRestoreCard(
                display = display,
                onReview = { reviewOpen = true },
                onDismiss = viewModel::dismiss,
            )
        }
    }

    if (reviewOpen) {
        DraftRestoreReviewModal(
            display = display,
            nowMillis = nowMillis,
            onResume = { record ->
                viewModel.resume()
                reviewOpen = false
                onNavigate(record.route)
            },
            onDiscard = viewModel::discard,
            onDiscardAll = viewModel::discardAll,
            onRetry = viewModel::retry,
            onClose = {
                reviewOpen = false
                viewModel.dismiss()
            },
        )
    }
}

/**
 * Stateless compact prompt card — the web bottom-left "Unsaved drafts restored" affordance. Renders the
 * loading skeleton or the populated content (a warning glyph, the pluralized body, and Review / Dismiss
 * actions, with a Close affordance). The empty/error/stale/offline states live in the review modal, so this
 * card only ever draws the [DraftRestorePhase.Loading] or [DraftRestorePhase.Content] surface. Hoisted out
 * of the ViewModel so it is preview- and screenshot-testable.
 */
@Composable
fun DraftRestoreCard(
    display: DraftRestoreDisplay,
    modifier: Modifier = Modifier,
    onReview: () -> Unit = {},
    onDismiss: () -> Unit = {},
) {
    val closeLabel = stringResource(R.string.translation_draft_recovery_close)
    GlassPanel(
        modifier = modifier.widthIn(max = CARD_MAX_WIDTH),
        padding = PanelPadding.Md,
        accent = PanelAccent.Warning,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(
                imageVector = TeslaGlyphs.Warning,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TeslaTokens.status.warning,
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                if (display.phase == DraftRestorePhase.Loading) {
                    DraftCardLoading()
                } else {
                    DraftCardContent(count = display.count, onReview = onReview, onDismiss = onDismiss)
                }
            }
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = closeLabel,
                onClick = onDismiss,
                variant = IconButtonVariant.Standard,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun DraftCardContent(
    count: Int,
    onReview: () -> Unit,
    onDismiss: () -> Unit,
) {
    Subhead(stringResource(R.string.translation_draft_recovery_promptTitle))
    BodyText(
        promptBodyText(count),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(
        modifier = Modifier.padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label = stringResource(R.string.translation_draft_recovery_review),
            onClick = onReview,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_draft_recovery_dismiss),
            onClick = onDismiss,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun DraftCardLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = 0.7f, height = 14.dp)
        Skeleton(widthFraction = 0.9f, height = 12.dp)
    }
}

/**
 * The review modal — the web "Restore unsaved drafts" dialog. Wraps the shared [io.teslasync.android.
 * components.ui.Modal] (its own scrim / back / outside-tap dismissal) around the stateless
 * [DraftRestoreReviewContent], which renders every phase.
 */
@Composable
fun DraftRestoreReviewModal(
    display: DraftRestoreDisplay,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    onResume: (DraftRecord) -> Unit = {},
    onDiscard: (DraftRecord) -> Unit = {},
    onDiscardAll: () -> Unit = {},
    onRetry: () -> Unit = {},
    onClose: () -> Unit = {},
) {
    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = stringResource(R.string.translation_draft_recovery_modalTitle),
        closeLabel = stringResource(R.string.translation_draft_recovery_close),
    ) {
        DraftRestoreReviewContent(
            display = display,
            nowMillis = nowMillis,
            onResume = onResume,
            onDiscard = onDiscard,
            onDiscardAll = onDiscardAll,
            onRetry = onRetry,
            onClose = onClose,
        )
    }
}

/**
 * Stateless review body — renders every branch the web modal draws plus the draft store's lifecycle: the
 * intro copy, an optional stale/offline freshness chip, then the loading skeleton, the draft rows, the
 * friendly empty state, or the classified error with retry, and a Discard-all / Close footer. Hoisted out
 * so it is preview- and UI-testable for each state.
 */
@Composable
fun DraftRestoreReviewContent(
    display: DraftRestoreDisplay,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    onResume: (DraftRecord) -> Unit = {},
    onDiscard: (DraftRecord) -> Unit = {},
    onDiscardAll: () -> Unit = {},
    onRetry: () -> Unit = {},
    onClose: () -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BodyText(
            stringResource(R.string.translation_draft_recovery_modalBody),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (display.showFreshnessChip) {
            DraftFreshnessChip(display)
        }
        when (display.phase) {
            DraftRestorePhase.Loading -> DraftListLoading()
            DraftRestorePhase.Error ->
                QueryError(
                    kind = DraftRestoreProjection.queryErrorKind(display),
                    resourceName = stringResource(R.string.translation_draft_recovery_modalTitle),
                    onRetry = onRetry,
                )
            DraftRestorePhase.Empty ->
                EmptyState(
                    message = stringResource(R.string.translation_draft_recovery_empty),
                    icon = TeslaGlyphs.Check,
                )
            DraftRestorePhase.Content ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    display.drafts.forEach { record ->
                        DraftRestoreRow(
                            record = record,
                            nowMillis = nowMillis,
                            onResume = onResume,
                            onDiscard = onDiscard,
                        )
                    }
                }
        }
        DraftReviewFooter(
            showDiscardAll = display.phase == DraftRestorePhase.Content,
            onDiscardAll = onDiscardAll,
            onClose = onClose,
        )
    }
}

@Composable
private fun DraftReviewFooter(
    showDiscardAll: Boolean,
    onDiscardAll: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showDiscardAll) {
            Button(
                label = stringResource(R.string.translation_draft_recovery_discardAll),
                onClick = onDiscardAll,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        Button(
            label = stringResource(R.string.translation_draft_recovery_close),
            onClick = onClose,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * One recoverable-draft row — the web modal `<li>`: the draft label (falling back to the catalog
 * `fallbackLabel`), the relative "Saved {{when}}" age, and per-row Resume / Discard actions.
 */
@Composable
fun DraftRestoreRow(
    record: DraftRecord,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    onResume: (DraftRecord) -> Unit = {},
    onDiscard: (DraftRecord) -> Unit = {},
) {
    val label =
        record.label?.takeIf { it.isNotBlank() }
            ?: stringResource(R.string.translation_draft_recovery_fallbackLabel)
    val saved = savedAtLabel(record, nowMillis)
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .clearAndSetSemantics { contentDescription = "$label, $saved" },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                BodyText(label, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
                Caption(saved)
            }
            Button(
                label = stringResource(R.string.translation_draft_recovery_resume),
                onClick = { onResume(record) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_draft_recovery_discard),
                onClick = { onDiscard(record) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun DraftFreshnessChip(display: DraftRestoreDisplay) {
    if (display.offline) {
        StatusPill(text = stringResource(R.string.translation_common_offline), tone = StatusTone.Danger)
    } else {
        StatusPill(text = stringResource(R.string.translation_mqtt_stale), tone = StatusTone.Warning)
    }
}

@Composable
private fun DraftListLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(height = ROW_SKELETON_HEIGHT)
        }
    }
}

/** The pluralized prompt body (web `draft.recovery.promptBody` with `{{count}}`). */
@Composable
private fun promptBodyText(count: Int): String = pluralStringResource(R.plurals.translation_draft_recovery_promptBody, count, count)

/**
 * The localized "Saved {{when}}" label, resolving the relative-age bucket from the catalog
 * (web `formatRelativeTime`).
 */
@Composable
private fun savedAtLabel(
    record: DraftRecord,
    nowMillis: Long,
): String {
    val age =
        remember(record.savedAtEpochMs, nowMillis) {
            DraftRestoreProjection.savedAge(record.savedAtEpochMs, nowMillis)
        }
    val phrase =
        when (age) {
            DraftSavedAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
            is DraftSavedAge.Minutes ->
                pluralStringResource(R.plurals.translation_palette_recent_minutesAgo, age.count, age.count)
            is DraftSavedAge.Hours ->
                pluralStringResource(R.plurals.translation_palette_recent_hoursAgo, age.count, age.count)
            is DraftSavedAge.Days ->
                pluralStringResource(R.plurals.translation_palette_recent_daysAgo, age.count, age.count)
        }
    return stringResource(R.string.translation_draft_recovery_savedAt, phrase)
}

// ── Previews — one per rendered state (card loading / card content / review content / empty / stale /
// offline / error). ────────────────────────────────────────────────────────────────────────────────────

private const val PREVIEW_NOW = 1_000_000_000_000L
private val PREVIEW_DRAFTS =
    listOf(
        DraftRecord(
            storageKey = "k1",
            route = "/alerts/new",
            label = "New alert rule",
            savedAtEpochMs = PREVIEW_NOW - 120_000L,
        ),
        DraftRecord(
            storageKey = "k2",
            route = "/automations/new",
            label = "Charge automation",
            savedAtEpochMs = PREVIEW_NOW - 7_200_000L,
        ),
    )

@Preview(name = "DraftRestore · card loading", showBackground = true)
@Composable
private fun DraftRestoreCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreCard(display = DraftRestoreDisplay(phase = DraftRestorePhase.Loading))
    }
}

@Preview(name = "DraftRestore · card content", showBackground = true)
@Composable
private fun DraftRestoreCardContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreCard(display = DraftRestoreDisplay(phase = DraftRestorePhase.Content, drafts = PREVIEW_DRAFTS))
    }
}

@Preview(name = "DraftRestore · review content", showBackground = true)
@Composable
private fun DraftRestoreReviewContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(
            display = DraftRestoreDisplay(phase = DraftRestorePhase.Content, drafts = PREVIEW_DRAFTS),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "DraftRestore · review loading", showBackground = true)
@Composable
private fun DraftRestoreReviewLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(display = DraftRestoreDisplay(phase = DraftRestorePhase.Loading))
    }
}

@Preview(name = "DraftRestore · review empty", showBackground = true)
@Composable
private fun DraftRestoreReviewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(display = DraftRestoreDisplay(phase = DraftRestorePhase.Empty))
    }
}

@Preview(name = "DraftRestore · review stale", showBackground = true)
@Composable
private fun DraftRestoreReviewStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(
            display =
                DraftRestoreDisplay(
                    phase = DraftRestorePhase.Content,
                    drafts = PREVIEW_DRAFTS,
                    stale = true,
                    refreshing = true,
                ),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "DraftRestore · review offline", showBackground = true)
@Composable
private fun DraftRestoreReviewOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(
            display =
                DraftRestoreDisplay(
                    phase = DraftRestorePhase.Content,
                    drafts = PREVIEW_DRAFTS,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "DraftRestore · review error", showBackground = true)
@Composable
private fun DraftRestoreReviewErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRestoreReviewContent(
            display =
                DraftRestoreDisplay(
                    phase = DraftRestorePhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = PREVIEW_HTTP_ERROR,
                ),
        )
    }
}

private const val PREVIEW_HTTP_ERROR = 503
