// The native Jetpack Compose + Material 3 QuietHoursPage notifications surface — a parity port of
// web/src/features/notifications/pages/QuietHoursPage.tsx, the dedicated /notifications/quiet-hours wrapper.
// Like the web page it is a thin composition wrapper: it sets the PageContainer title/subtitle header (web
// `PageContainer` title + subtitle + copyLink) and stacks the two already-built shared surfaces the web page
// composes — the AI advisor <AIQuietHoursSuggestion> above the canonical <QuietHoursPanel> — so the suggest
// stream, the captured-proposal preview, the inline create/edit form, every window row, and every cache-then-
// network data state (loading / empty / hard-error+retry / stale-offline / content) come from those two shared
// surfaces, never re-implemented here (DRY, ADR-006). Every visible string resolves from the generated
// res/values catalog (ADR-014); the page records the one-shot PII-safe `view.opened` diagnostic (P1/S11).
//
// The page owns exactly one piece of state — the pending seed handed across from the advisor's "Apply to form"
// action to the panel's create form, the verbatim native port of the web page's
// `useState<QuietHoursWindowInput | null>` + `handleApplyDraft` / `handleSeedConsumed`. The advisor proposes
// (propose-only, ADR-015); the panel keeps the sole canonical Save button. Because the two native surfaces each
// declare their own copy of the seed-input type (the web page shared one type from `@/api/types`), the page
// bridges them with [toPanelInput].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located header composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.quiethours

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.quiethourspanel.QuietHoursPanel
import io.teslasync.android.featureviews.quiethourspanel.QuietHoursPanelSource
import io.teslasync.android.featureviews.quiethourspanel.QuietHoursPanelViewModel
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AIQuietHoursSuggestion
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AIQuietHoursSuggestionViewModel
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AiQuietHoursStreamSource
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import kotlinx.coroutines.flow.StateFlow
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.QuietHoursWindowInput as AiQuietHoursWindowInput

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the two embedded view-models the page composes — the [QuietHoursPanelViewModel]
 * over the host-wired [panelSource] (the shared notifications repository) and the
 * [AIQuietHoursSuggestionViewModel] over the host-wired [aiSource] (the AI draft-stream seam), [connectivity]
 * gate, and [featureEnabled] AI-Off gate. Each view-model is keyed by this surface's slug so it is scoped to the
 * /notifications/quiet-hours navigation entry. [logger] defaults to the app's redacting logger.
 */
@Composable
fun QuietHoursPage(
    panelSource: QuietHoursPanelSource,
    aiSource: AiQuietHoursStreamSource,
    connectivity: StateFlow<Boolean>,
    featureEnabled: StateFlow<Boolean>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val panelViewModel: QuietHoursPanelViewModel =
        viewModel(
            key = "${QuietHoursPageRegistration.SLUG}.panel",
            factory = QuietHoursPanelViewModel.factory(panelSource, logger),
        )
    val aiViewModel: AIQuietHoursSuggestionViewModel =
        viewModel(
            key = "${QuietHoursPageRegistration.SLUG}.ai",
            factory = AIQuietHoursSuggestionViewModel.factory(aiSource, logger, connectivity, featureEnabled),
        )
    QuietHoursPage(
        panelViewModel = panelViewModel,
        aiViewModel = aiViewModel,
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and owns the pending-seed
 * hand-off between the two embedded surfaces — the native port of the web page's
 * `useState<QuietHoursWindowInput | null>`. The advisor's "Apply to form" patch ([AiQuietHoursWindowInput]) is
 * bridged into the panel's shared-core [QuietHoursWindowInput] via [toPanelInput] and stored as the panel's
 * `seedDraft`; the panel fires `onSeedConsumed` once it copies the seed, clearing the pointer so it does not
 * re-seed on later recompositions (web `handleSeedConsumed`).
 */
@Composable
fun QuietHoursPage(
    panelViewModel: QuietHoursPanelViewModel,
    aiViewModel: AIQuietHoursSuggestionViewModel,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordQuietHoursPageOpened(logger) }

    var pendingSeed by remember { mutableStateOf<QuietHoursWindowInput?>(null) }

    QuietHoursPageContent(
        panelViewModel = panelViewModel,
        aiViewModel = aiViewModel,
        pendingSeed = pendingSeed,
        onApplyDraft = { draft -> pendingSeed = draft.toPanelInput() },
        onSeedConsumed = { pendingSeed = null },
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` chrome) above the AI advisor surface
 * and the canonical quiet-hours panel, in the web page's order (`<AIQuietHoursSuggestion>` then
 * `<QuietHoursPanel>`). Scrolls vertically so both embedded surfaces are reachable on short viewports, mirroring
 * the sibling notifications surfaces. The advisor renders nothing when its AI-Off gate is closed (web
 * `withAiFeature` → null); the panel owns every windows-feed data state, so this layer never draws a blank
 * region.
 */
@Composable
fun QuietHoursPageContent(
    panelViewModel: QuietHoursPanelViewModel,
    aiViewModel: AIQuietHoursSuggestionViewModel,
    pendingSeed: QuietHoursWindowInput?,
    onApplyDraft: (AiQuietHoursWindowInput) -> Unit,
    onSeedConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        QuietHoursPageHeader()

        AIQuietHoursSuggestion(
            viewModel = aiViewModel,
            onApplyDraft = onApplyDraft,
        )

        QuietHoursPanel(
            viewModel = panelViewModel,
            seedDraft = pendingSeed,
            onSeedConsumed = onSeedConsumed,
        )
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the [QuietHoursPageRegistration]-backed title
 * heading, the descriptive subtitle, and the copy-link affordance (web `copyLink`). The copy-link writes the
 * canonical route to the clipboard (the native analogue of copying the current URL).
 */
@Composable
private fun QuietHoursPageHeader() {
    val clipboard = LocalClipboardManager.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PageTitle(stringResource(R.string.translation_notifications_quietHours_title))
            BodyText(
                text = stringResource(R.string.translation_notifications_quietHours_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(QuietHoursPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
    }
}
