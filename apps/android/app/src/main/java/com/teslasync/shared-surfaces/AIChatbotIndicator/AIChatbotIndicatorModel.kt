// Pure, framework-free model + gate predicate + surface classifier + diagnostics for the AIChatbotIndicator
// shared surface — the native analogue of everything the web component derives
// (web/src/components/ai/AIChatbotIndicator.tsx). No Compose, no Android framework, no HTTP: every declaration
// here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web source is `withAiFeature('chatbot-llm', InnerIndicator)`. `InnerIndicator` is a STATIC brand badge —
// a small cyan chip (a HelixMark glyph + the "Helix" label) carrying a `title` tooltip and an `aria-label`. Its
// only data dependency is `useTranslation` (i18n). The visibility gate is the `withAiFeature` HOC, which renders
// `null` unless `useAiEnabled('chatbot-llm')` is true; `useAiEnabled` is FAIL-CLOSED (ADR-015 §I6): an
// unresolved settings query, `ai_mode === 'off'`, a missing `ai_features` map, or a feature flag that is not
// exactly `true` all yield `false`.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the web surface has exactly two render
// outcomes — gate open → the chip, gate closed → nothing. It has NO loading / empty / error / stale / offline
// lifecycle of its own: the gate collapses settings-loading, settings-error, off-mode, and feature-disabled into
// a single fail-closed "render nothing", so modelling those generic data-states here would fabricate behaviour
// the web spec does not have (the same rationale the accepted VisuallyHidden / globalShortcuts ports document).
// The surface's real states are reproduced instead:
//   • [IndicatorSurface.Hidden]  ← the gate is closed (off / unresolved / feature off) — web `withAiFeature` → null.
//   • [IndicatorSurface.Visible] ← the gate is open — the Helix chip (the content state).
// The "loading" dimension is captured honestly: while the gate is unresolved it is fail-closed to Hidden, exactly
// as the web `useAiEnabled` returns `false` until settings resolve. The badge body itself is static, so it has no
// per-render-state variation once visible.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AIChatbotIndicator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AIAnomalyExplanations / VisuallyHidden surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). It is the surface slug the
 * prompt mandates (`AIChatbotIndicator`) and carries no VIN, vehicle id, settings value, or any generated text,
 * so a diagnostics line can never leak the operator's fleet state.
 */
const val AI_CHATBOT_INDICATOR_SLUG: String = "AIChatbotIndicator"

/**
 * The AI feature id this surface is gated on — the native mirror of the web
 * `withAiFeature('chatbot-llm', …)` / `useAiEnabled('chatbot-llm')` argument. When this feature is enabled the
 * chatbot's responses are LLM-generated (so the badge tells the user redaction + tools are active).
 */
const val CHATBOT_LLM_FEATURE: String = "chatbot-llm"

/**
 * The AI mode that disables every AI surface unconditionally (web `settings.ai_mode === 'off'`, ADR-015 §I1).
 * Any other mode (`local` / `cloud`) is "on"; an absent/unresolved mode is treated as off (fail-closed).
 */
const val AI_MODE_OFF: String = "off"

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Pure port of the web `useAiEnabled('chatbot-llm')` predicate (web/src/hooks/useAiEnabled.ts) — the "adapter"
 * a host's production [AIChatbotIndicatorSource] uses to fold the shared settings document into the single
 * gate boolean the surface binds. It is FAIL-CLOSED, matching the web hook (and the backend `guard.Wrap` 404)
 * so backend and native reach the same verdict for the same inputs:
 *
 *   - [aiMode] is `null` (settings not yet resolved) → `false` (the badge stays hidden while loading).
 *   - [aiMode] equals [AI_MODE_OFF] → `false` (off mode blocks every AI surface).
 *   - [featureEnabled] is `null`/`false` (the `ai_features` map is absent or the flag is not opted in) → `false`.
 *   - [aiMode] is a non-off mode AND [featureEnabled] is exactly `true` → `true`.
 *
 * Kept pure (no Flow, no Compose) so the gate logic is unit-tested off-device for every input.
 */
fun evaluateChatbotLlmGate(
    aiMode: String?,
    featureEnabled: Boolean?,
): Boolean = aiMode != null && aiMode != AI_MODE_OFF && featureEnabled == true

/**
 * The immutable surface state the [AIChatbotIndicatorViewModel] exposes. It carries only the resolved AI-feature
 * gate (web `useAiEnabled('chatbot-llm')` via the `withAiFeature` HOC); the badge body is static, so there is
 * nothing else to project.
 *
 * @property gateEnabled whether the `chatbot-llm` AI feature is enabled end-to-end (fail-closed default `false`,
 *   so the surface is hidden until the gate resolves — web's unresolved-settings behaviour).
 */
data class ChatbotIndicatorState(
    val gateEnabled: Boolean = false,
)

/**
 * The render-ready classification of [ChatbotIndicatorState] — a closed, mutually-exclusive set the view switches
 * on, so every branch is exhaustively covered and unit-tested off-device. It maps the web `withAiFeature` gate
 * onto the surface's two real outcomes (see the file header for the parity-with-honesty rationale).
 */
sealed interface IndicatorSurface {
    /** The AI feature is gated off / unresolved — the whole surface collapses (web `withAiFeature` → `null`). */
    data object Hidden : IndicatorSurface

    /** The AI feature is enabled — render the Helix chip (the web `InnerIndicator`). */
    data object Visible : IndicatorSurface
}

/**
 * Selects the render-ready [IndicatorSurface] for [state]. Pure (no Compose/clock): an enabled gate yields the
 * visible chip, every other case (disabled / unresolved / off) yields [IndicatorSurface.Hidden], mirroring the
 * fail-closed web `withAiFeature` gate.
 */
fun classifyIndicator(state: ChatbotIndicatorState): IndicatorSurface =
    if (state.gateEnabled) IndicatorSurface.Visible else IndicatorSurface.Hidden

/**
 * Builds the merged TalkBack description for the badge from already-localized parts. The web chip exposes a terse
 * accessible name (`aria-label` = "Helix") plus an explanatory hover `title` (the tooltip); on Android — where a
 * hover `title` is not idiomatic for a non-interactive status chip — both are folded into one announcement so a
 * TalkBack user still hears what the badge means. Kept pure so the a11y label is unit-tested without a Compose
 * host.
 *
 * @param label the terse accessible name (web `aria-label`, `translation_chatbot_llm_indicator`).
 * @param tooltip the long-form explanation (web `title`, `translation_chatbot_llm_indicatorTooltip`).
 */
fun indicatorAccessibilityLabel(
    label: String,
    tooltip: String,
): String = "$label. $tooltip"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [AI_CHATBOT_INDICATOR_SLUG] (P1/S11)
 * — never a settings value, vehicle id, or any generated text, so a diagnostics line can never leak fleet state.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface
 * open.
 */
fun recordChatbotIndicatorOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AI_CHATBOT_INDICATOR_SLUG))
}
