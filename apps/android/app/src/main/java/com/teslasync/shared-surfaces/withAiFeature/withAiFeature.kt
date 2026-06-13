// The native Jetpack Compose + Material 3 withAiFeature shared surface — a parity port of the web AI-Off Contract
// gate primitive (web/src/components/ai/withAiFeature.tsx). The web source is a higher-order component:
// `withAiFeature(feature, Inner)` validates the feature id at construction (throwing on a typo), then returns a
// component that reads `useAiEnabled(feature)` and renders `null` unless the feature is on, otherwise wrapping
// `Inner` in a `<div data-ai-feature="<id>" data-testid="…">`. The markers let the off-mode invariant walk prove
// no AI surface leaks into the DOM when `ai_mode='off'`.
//
// A higher-order COMPONENT maps to a Compose gate composable with a content slot: [WithAiFeature] takes the
// `feature` id plus the inner `content` lambda (the native analogue of `Inner`), binds the fail-closed gate via
// the shared [WithAiFeatureViewModel] (P1/S8), records the one-shot `view.opened` diagnostic (P1/S11), and either
// renders nothing (gate closed — web `withAiFeature` → null) or wraps the caller's content in a marker [Box]
// carrying the [testTag] (web `data-testid`) and the [aiFeature] semantics (web `data-ai-feature`). The view
// performs NO HTTP.
//
// Accessibility (Honesty Covenant #5 — no parity shortcuts): the gate introduces no interactive element of its
// own — it is a transparent wrapper, exactly like the web `<div>`. The marker [Box] uses a non-merging
// `semantics` block (no `mergeDescendants`, no `clearAndSetSemantics`), so the wrapped surface's own TalkBack
// labels, focus order, and font-scaling are preserved untouched; the gate only attaches a non-interactive
// identity/test tag. There are therefore no gate-owned strings to route through the i18n catalog (the web source
// renders none either) and no gate-owned interactive control to label.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the web gate has exactly two outcomes —
// open → the inner content, closed → nothing — and no loading / empty / error / stale / offline lifecycle of its
// own (`useAiEnabled` is fail-closed to "off" until settings resolve). Those generic data-states therefore
// collapse into [GateSurface.Hidden]; see withAiFeatureModel.kt for the full rationale and the accepted sibling
// precedent (AIChatbotIndicator / VisuallyHidden).
//
// `MatchingDeclarationName` / `InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/withAiFeature) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do. `ktlint:standard:filename` is suppressed because
// the prompt-mandated file name (`withAiFeature`, mirroring the web source) is camelCase while the public
// composable is PascalCase by Compose convention.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.withaifeature

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Semantics key carrying the gated feature id on the marker node — the native analogue of the web
 * `data-ai-feature="<id>"` attribute. A UI test (or an off-mode invariant walk) can assert this property is
 * present exactly when the gate is open, mirroring the web DOM marker.
 */
val aiFeatureSemanticsKey: SemanticsPropertyKey<String> = SemanticsPropertyKey("AiFeature")

/** The gated feature id exposed on the marker node (web `data-ai-feature`). Backed by [aiFeatureSemanticsKey]. */
var SemanticsPropertyReceiver.aiFeature: String by aiFeatureSemanticsKey

/**
 * Stateful entry point — the faithful port of the web `withAiFeature(feature, Inner)` higher-order component.
 * Validates [feature] is registered (web's construction-time throw on a typo), binds the fail-closed gate via
 * [source] into a [WithAiFeatureViewModel], records the one-shot `view.opened` diagnostic, collects the live
 * state, and renders [content] wrapped in the parity marker (or nothing when the gate is closed — web
 * `withAiFeature` → `null`). The surface performs no HTTP.
 *
 * @param feature the AI feature id this gate is bound to (web `withAiFeature(feature, …)`); an unregistered id
 *   throws [IllegalArgumentException] on first composition, fast-failing a typo (web's module-load throw).
 * @param source the AI-feature gate seam (a shared-AI-layer adapter in production, a fake in tests).
 * @param content the inner AI surface to gate (the web `Inner`); rendered only when the gate is open.
 * @param logger defaults to the process logger; receives the PII-safe `view.opened` event.
 * @param instanceKey scopes the ViewModel per placement (defaults to [feature]); pass a distinct value when the
 *   same feature gates more than one placement on a screen.
 */
@Composable
fun WithAiFeature(
    feature: String,
    source: WithAiFeatureSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = feature,
    content: @Composable () -> Unit,
) {
    // Fail fast on a typo, mirroring the web `withAiFeature` construction-time throw (an unregistered id).
    requireKnownAiFeature(feature)

    val viewModel: WithAiFeatureViewModel =
        viewModel(
            key = "$WITH_AI_FEATURE_SLUG:$instanceKey",
            factory = WithAiFeatureViewModel.factory(source, feature, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    WithAiFeatureContent(state = state, feature = feature, modifier = modifier, content = content)
}

/**
 * Stateless renderer for the surface — the unit/UI-test + `@Preview` entry point. Classifies [state] and either
 * wraps [content] in the parity marker (gate open) or renders nothing (gate closed — web `withAiFeature` →
 * `null`). Trusts its caller for a registered [feature] (the stateful [WithAiFeature] validates first).
 */
@Composable
fun WithAiFeatureContent(
    state: WithAiFeatureState,
    feature: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    when (classifyGate(state)) {
        GateSurface.Hidden -> Unit
        GateSurface.Visible -> AiFeatureMarker(feature = feature, modifier = modifier, content = content)
    }
}

/**
 * The web marker element: a transparent wrapper around the gated [content] carrying the [testTag] (web
 * `data-testid`, resolved by [resolveAiFeatureTestId]) and the [aiFeature] semantics (web `data-ai-feature`).
 * The `semantics` block does not merge or clear descendants, so the inner surface's own accessibility tree is
 * preserved — the wrapper is identity-only, never interactive.
 */
@Composable
private fun AiFeatureMarker(
    feature: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val testId = resolveAiFeatureTestId(feature)
    Box(
        modifier =
            modifier
                .testTag(testId)
                .semantics { aiFeature = feature },
    ) {
        content()
    }
}

// ── Previews (tooling-only; the @Preview entry points exercise the open gate wrapping a sample inner surface) ──

@Preview(name = "Open — gate wraps inner content", showBackground = true)
@Composable
private fun WithAiFeatureOpenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WithAiFeatureContent(state = WithAiFeatureState(gateEnabled = true), feature = "chatbot-llm") {
            Text("Gated AI surface content")
        }
    }
}

@Preview(name = "Open — gate wraps inner content (dark)", showBackground = true)
@Composable
private fun WithAiFeatureOpenDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        WithAiFeatureContent(state = WithAiFeatureState(gateEnabled = true), feature = "nl-search") {
            Text("Gated AI surface content")
        }
    }
}
