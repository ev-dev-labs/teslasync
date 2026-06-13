// The native Jetpack Compose + Material 3 AIAutoNameUnnamedLocations shared surface — a parity port of
// web/src/components/ai/AIAutoNameUnnamedLocations.tsx. The web component is a propose-only Helix draft card: a
// header (title + "Helix" badge), a one-paragraph description, a Suggest action whose disabled state is computed
// from live stream state (never a literal), the optional current label, and — once a `tool_result` arrives — a
// proposal panel (proposed name + optional reason + a "rejected by validator" note when the validator declined +
// an "Apply to form" button gated on `status === 'ok'`). `withAiFeature` hides the whole surface when the
// feature is off; "Apply to form" copies the name into the parent form (the existing Save flow stays the only
// API write path — this card never writes).
//
// This port keeps that contract end to end. It performs NO HTTP: it binds the [AIAutoNameUnnamedLocationsViewModel]
// (P1/S8), which folds the decoded draft stream into a single [AiNameDraftUiState], and renders every state the
// stream can carry — idle (the friendly description + CTA, never a blank box), streaming (a "Helix is thinking"
// skeleton), done-with-proposal (ok → Apply enabled; rejected → the validator note + Apply disabled), and a
// stream failure (an [ErrorDisplay] with a retry that re-runs Suggest — the honest "offline" branch, since an
// on-demand proposal has no cached value to replay). All copy resolves through the P1/S10 catalog
// (`translation_locations_aiAutoName_*` + the shared a11y/error keys); the [GlassPanel], [Badge], [Button],
// [SkeletonLines] and [ErrorDisplay] are the faithful native counterparts of the web shared components.
//
// Android-idiomatic interaction: the Suggest + Apply controls are Material [Button]s (≥48 dp targets) whose
// accessible names are their visible labels, and the surface carries the web `data-testid` parity tags
// (root / suggest / draft / apply) as Compose test tags.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces) cannot form a valid Kotlin package, so the package intentionally diverges from
// the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the auto-name surface — the native analogue of the web
 * `withAiFeature('auto-name-unnamed-locations', InnerSection)` wrapper plus the `InnerSection` itself.
 *
 * When [enabled] is `false` the surface renders nothing (web `withAiFeature` returns `null` in `ai_mode='off'`),
 * so no AI affordance leaks into the tree. When enabled it binds a per-location view-model over [source]
 * (P1/S8), records the one-shot `view.opened` diagnostic, cancels the stream when the panel leaves composition or
 * the location changes (web AbortController cleanup), and renders [AIAutoNameUnnamedLocationsContent].
 *
 * @param locationId the visited-location synthetic id (web `locationId`); the Suggest action is disabled
 *   (computed) when it is non-positive.
 * @param onApplyName invoked with the proposed name when the user taps "Apply to form" (web `onApplyName`); the
 *   host copies it into the existing rename/geofence form — this surface never writes to the API.
 * @param source the draft-stream seam the view-model binds (the host's Ktor-backed [SseAiNameDraftSource]).
 * @param enabled the resolved AI-off gate for this feature (web `useAiEnabled('auto-name-unnamed-locations')`).
 * @param currentName the current (unnamed / coordinate-shaped) label shown for context (web `currentName`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIAutoNameUnnamedLocations(
    locationId: Long,
    onApplyName: (String) -> Unit,
    source: AiNameDraftSource,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    currentName: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!enabled) return
    val viewModel: AIAutoNameUnnamedLocationsViewModel =
        viewModel(
            key = "${AIAutoNameUnnamedLocationsRegistration.FEATURE_ID}:$locationId",
            factory = AIAutoNameUnnamedLocationsViewModel.factory(source, logger),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    DisposableEffect(viewModel) { onDispose { viewModel.reset() } }

    AIAutoNameUnnamedLocationsContent(
        state = state,
        locationId = locationId,
        currentName = currentName,
        onSuggest = { viewModel.suggest(locationId) },
        onApply = { draft ->
            viewModel.onApplied(draft)
            onApplyName(draft.proposedName)
        },
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The header (title +
 * "Helix" badge), the description, and the Suggest action are always visible (web parity, never a blank box);
 * beneath them the body switches on [state]: the optional current label, a "Helix is thinking" skeleton while a
 * draft streams, an [ErrorDisplay] with retry on a stream failure, and the proposal panel once a draft arrives.
 *
 * @param onSuggest fires a fresh proposal (web `handleSuggest`) — also the error-state retry.
 * @param onApply invoked with the accepted [LocationNameDraft] when "Apply to form" is tapped (web `handleApply`).
 */
@Composable
fun AIAutoNameUnnamedLocationsContent(
    state: AiNameDraftUiState,
    locationId: Long,
    onSuggest: () -> Unit,
    onApply: (LocationNameDraft) -> Unit,
    modifier: Modifier = Modifier,
    currentName: String? = null,
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(AIAutoNameUnnamedLocationsRegistration.ROOT_TEST_TAG),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            AutoNameHeader()
            AutoNameSuggestRow(enabled = state.canSuggest(locationId), loading = state.isStreaming, onSuggest = onSuggest)
            if (!currentName.isNullOrBlank()) {
                CurrentLabelRow(currentName)
            }
            if (state.isStreaming && state.draft == null) {
                AutoNameThinking(text = state.text)
            }
            if (state.isError) {
                AutoNameError(onRetry = onSuggest)
            }
            state.draft?.let { draft ->
                AutoNameDraftPanel(draft = draft, onApply = { onApply(draft) })
            }
        }
    }
}

/** Title + "Helix" badge + the propose-only description — the always-visible card header (web `AIFeatureCard`). */
@Composable
private fun AutoNameHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringResource(R.string.translation_locations_aiAutoName_title), modifier = Modifier.weight(1f, fill = false))
            Badge(
                text = stringResource(R.string.translation_locations_aiAutoName_badge),
                variant = BadgeVariant.Info,
                dot = true,
            )
        }
        HelperText(stringResource(R.string.translation_locations_aiAutoName_description))
    }
}

/** The right-aligned Suggest action (web `buttonPlacement="below"`); disabled is computed from live stream state. */
@Composable
private fun AutoNameSuggestRow(
    enabled: Boolean,
    loading: Boolean,
    onSuggest: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_locations_aiAutoName_suggestButton),
            onClick = onSuggest,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            loading = loading,
            modifier = Modifier.testTag(AIAutoNameUnnamedLocationsRegistration.SUGGEST_TEST_TAG),
        )
    }
}

/** The current (unnamed) label shown for context next to the proposal (web `currentName` line). */
@Composable
private fun CurrentLabelRow(currentName: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Caption(stringResource(R.string.translation_locations_aiAutoName_currentLabel))
        BodyText(currentName, modifier = Modifier.weight(1f, fill = false))
    }
}

/** The "Helix is thinking" affordance while a draft streams — shimmering lines with an accessible loading label. */
@Composable
private fun AutoNameThinking(text: String) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (text.isNotBlank()) {
            BodyText(text)
        }
        SkeletonLines(lines = 2)
    }
}

/** The stream-failure surface (web `AiOutputPanel` error) — a localized error with a retry that re-runs Suggest. */
@Composable
private fun AutoNameError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The captured proposal panel (web draft `<div>`): the "Proposed name" label, the name, an optional validator
 * reason, the "rejected by validator" note when the validator declined, and the "Apply to form" action gated
 * (computed) on the accepted status. Tagged with the web `data-testid` parity tags.
 */
@Composable
private fun AutoNameDraftPanel(
    draft: LocationNameDraft,
    onApply: () -> Unit,
) {
    GlassPanel(
        modifier = Modifier.fillMaxWidth().testTag(AIAutoNameUnnamedLocationsRegistration.DRAFT_TEST_TAG),
        padding = PanelPadding.Sm,
        accent = PanelAccent.Info,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                MetricLabel(stringResource(R.string.translation_locations_aiAutoName_proposalLabel))
                BodyText(draft.proposedName)
                draft.reason?.takeIf { it.isNotBlank() }?.let { Caption(it) }
                if (!draft.isOk) {
                    ErrorText(stringResource(R.string.translation_locations_aiAutoName_rejectedLabel))
                }
            }
            Button(
                label = stringResource(R.string.translation_locations_aiAutoName_applyButton),
                onClick = onApply,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = draft.isOk,
                modifier =
                    Modifier
                        .padding(top = Spacing.xs)
                        .testTag(AIAutoNameUnnamedLocationsRegistration.APPLY_TEST_TAG),
            )
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private fun okDraft(): LocationNameDraft = LocationNameDraft(locationId = 42, proposedName = "Home", status = "ok")

private fun rejectedDraft(): LocationNameDraft =
    LocationNameDraft(locationId = 42, proposedName = "Unknown Stop", status = "rejected", reason = "Too generic")

@Preview(name = "Idle", showBackground = true)
@Composable
private fun AIAutoNameIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoNameUnnamedLocationsContent(
            state = AiNameDraftUiState.IDLE,
            locationId = 42,
            currentName = "37.7749, -122.4194",
            onSuggest = {},
            onApply = {},
        )
    }
}

@Preview(name = "Streaming", showBackground = true)
@Composable
private fun AIAutoNameStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoNameUnnamedLocationsContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Streaming),
            locationId = 42,
            currentName = "37.7749, -122.4194",
            onSuggest = {},
            onApply = {},
        )
    }
}

@Preview(name = "Proposal accepted", showBackground = true)
@Composable
private fun AIAutoNameAcceptedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoNameUnnamedLocationsContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Done, draft = okDraft()),
            locationId = 42,
            currentName = "37.7749, -122.4194",
            onSuggest = {},
            onApply = {},
        )
    }
}

@Preview(name = "Proposal rejected", showBackground = true)
@Composable
private fun AIAutoNameRejectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoNameUnnamedLocationsContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Done, draft = rejectedDraft()),
            locationId = 42,
            onSuggest = {},
            onApply = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AIAutoNameErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoNameUnnamedLocationsContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Error, errorMessage = "stream_http_503"),
            locationId = 42,
            onSuggest = {},
            onApply = {},
        )
    }
}
