// Pure, framework-free model for the AiOutputPanel shared surface — the native analogue of every value the
// web component derives before returning JSX (web/src/components/ai/AiOutputPanel.tsx). No Compose, no Android
// UI, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions.
//
// AiOutputPanel is the shared streaming-output renderer every Helix feature reuses: it shows the accumulated
// `delta.text` as it streams in, an animated thinking indicator while the SSE is open but no text has arrived,
// and an inline error when the stream settled in error. The web component renders nothing until a stream has
// run at least once (text empty AND state idle). This file owns the parts the web render derives from those
// props:
//   • the lifecycle the panel is driven by — web `AiStreamState` ('idle' | 'streaming' | 'done' | 'error'),
//     reproduced as [AiStreamState];
//   • the render-branch decision — web `hasAnything` gate plus the error / pending / text conditional, in
//     [aiOutputBranch] over [AiOutputBranch]; THIS is the adapter the unit gate asserts for every input;
//   • the terminal-error message resolution — web `error ?? t('ai.common.errorUnknown', 'unknown')` in
//     [resolveErrorDetail], and the "Helix error: <detail>" line (web's bold label + message) in
//     [aiOutputErrorLine], which is both the visible text and the surface's accessible label.
//
// Binding (P1/S8): AiOutputPanel is a stateless presentational renderer driven entirely by caller-supplied
// stream props — the panel performs NO HTTP and owns no fetch. Its "data source" (web `useTranslation`) is the
// i18n facade (P1/S10) alone; the streaming state holder that owns the SSE lifecycle (the `useAiStream`
// analogue, e.g. the sibling AIAutoTripNameSuggestion's AutoTripNameDraftController) lives with the consuming
// feature, which passes the resolved `text` / `state` / `error` slice in. Because there is no cache-then-network
// feed here, the generic loading / empty / stale / offline data-states do not apply (Honesty Covenant #9,
// documented not silent): the surface's real states ARE the web component's four render branches — hidden,
// streaming (the thinking indicator), the streamed text, and the terminal error — every one of which renders.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AiOutputPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aioutputpanel

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val AI_OUTPUT_PANEL_SLUG: String = "AiOutputPanel"

/**
 * The lifecycle the output panel is driven by — a 1:1 port of the web `AiStreamState` union
 * (web/src/hooks/useAiStream.ts `'idle' | 'streaming' | 'done' | 'error'`). The panel is a pure function of
 * this state plus the accumulated `text`, so every render decision is asserted off-device.
 */
enum class AiStreamState {
    /** No stream started yet (web `'idle'`); with no text the panel renders nothing. */
    Idle,

    /** A stream is open; `delta` text accumulates as it arrives (web `'streaming'`). */
    Streaming,

    /** The stream settled successfully (web `'done'`); the accumulated text stays readable. */
    Done,

    /** The stream ended in error (web `'error'`); the inline error line is shown. */
    Error,
}

/**
 * Which of the panel's four render branches applies — the native analogue of the web JSX conditional. A sealed
 * hierarchy so the composable's `when` is exhaustive and every branch is covered by a preview + a unit case.
 */
sealed interface AiOutputBranch {
    /** Nothing has streamed yet — web `if (!hasAnything) return null`; the panel emits no node. */
    data object Hidden : AiOutputBranch

    /** The stream settled in error — web `state === 'error'`; the inline Helix-error line is shown. */
    data object Error : AiOutputBranch

    /** Open but awaiting the first `delta` — web `text === '' && state === 'streaming'`; the thinking child. */
    data object Pending : AiOutputBranch

    /** Accumulated streamed text — web's `else` paragraph (`whitespace-pre-wrap`). */
    data object Text : AiOutputBranch
}

/**
 * Whether the panel renders anything at all — a port of the web `hasAnything = text.length > 0 || state ===
 * 'streaming' || state === 'error' || state === 'done'`. Idle with no text is the only resting state that
 * renders nothing (the consuming feature shows its own ready chrome until the user starts a stream).
 */
fun aiOutputHasAnything(
    text: String,
    state: AiStreamState,
): Boolean =
    text.isNotEmpty() ||
        state == AiStreamState.Streaming ||
        state == AiStreamState.Error ||
        state == AiStreamState.Done

/**
 * Classifies the panel's render branch for ([text], [state]) — the single adapter the unit gate asserts for
 * every input, mirroring the web component's conditional exactly:
 *   1. `!hasAnything` → [AiOutputBranch.Hidden] (web `return null`);
 *   2. `state === 'error'` → [AiOutputBranch.Error];
 *   3. `text === '' && state === 'streaming'` → [AiOutputBranch.Pending] (the thinking indicator);
 *   4. otherwise → [AiOutputBranch.Text] (the streamed paragraph).
 * The error branch is checked before the pending branch so a stream that errors before its first delta shows
 * the error, not the thinking indicator — matching the web ordering.
 */
fun aiOutputBranch(
    text: String,
    state: AiStreamState,
): AiOutputBranch =
    when {
        !aiOutputHasAnything(text, state) -> AiOutputBranch.Hidden
        state == AiStreamState.Error -> AiOutputBranch.Error
        text.isEmpty() && state == AiStreamState.Streaming -> AiOutputBranch.Pending
        else -> AiOutputBranch.Text
    }

/**
 * Resolves the terminal-error detail shown after the label — a port of the web `error ?? t('ai.common.
 * errorUnknown', 'unknown')`. Only a `null` message falls back to [unknownFallback] (the web `??` nullish
 * coalesce), so a non-null server message is shown verbatim.
 */
fun resolveErrorDetail(
    error: String?,
    unknownFallback: String,
): String = error ?: unknownFallback

/**
 * The full inline error line — the native analogue of the web error paragraph `<span class="font-medium">Helix
 * error:</span> {detail}`. The composable renders [label] in a medium weight and [detail] in the normal weight,
 * but the announced/asserted string is the joined form this returns, so it doubles as the surface's accessible
 * label for the error state.
 */
fun aiOutputErrorLine(
    label: String,
    detail: String,
): String = "$label $detail"

/**
 * The PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the streamed
 * text or the error message — so a diagnostics line can never leak what Helix produced. Kept free of Compose so
 * it is unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
object AiOutputPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = AI_OUTPUT_PANEL_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
