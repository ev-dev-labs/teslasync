// Pure, framework-free model + render projection + diagnostics for the AIThinkingIndicator shared surface —
// the native analogue of everything the web component derives (web/src/components/ai/AIThinkingIndicator.tsx).
// No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a STATIC presentational surface — the streaming-but-empty pending state shown while an AI
// surface holds an open SSE connection and waits for the first `delta.text` frame (it is what `AiOutputPanel`
// renders as its `pendingChild`). It draws an animated "Helix is thinking" label (a HelixMark glyph + bouncing
// dots) over three shimmering skeleton lines of decreasing width. Its only inputs are:
//   • `label` — an optional caller override (web `label ?? t('helix.thinking', 'Helix is thinking')`).
//   • `prefers-reduced-motion` — the web `motion-safe:` variant gates the bounce + shimmer; under reduced motion
//     the dots stop bouncing and the lines drop the shimmer, while the static skeleton stays visible.
// There is no data fetch and no second exported "Dots" form beyond the compact in-button variant.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the generic
// loading / empty / error / stale / offline data-states do NOT apply to this surface. AIThinkingIndicator IS
// itself the "loading" state of a host AI surface — it has no feed of its own to be empty, stale, offline, or to
// fail, so modelling those would fabricate behaviour the web spec does not have (the same rationale the accepted
// AIChatbotIndicator / VisuallyHidden ports document). The surface's real, reproduced states are the animated
// indicator (full motion) and its reduced-motion variant (static skeleton, no bounce/shimmer), plus the caller's
// label override and the compact dots form — all projected purely here and unit-tested off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AIThinkingIndicator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AIChatbotIndicator / VisuallyHidden surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). It is the surface slug the
 * prompt mandates (`AIThinkingIndicator`) and carries no VIN, vehicle id, label text, or any model output, so a
 * diagnostics line can never leak the operator's fleet state or what the AI was asked.
 */
const val AI_THINKING_INDICATOR_SLUG: String = "AIThinkingIndicator"

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The web catalog key whose value is the canonical "Helix is thinking…" string (web `chatbot.thinking`, present
 * in the P1/S10 catalog as `R.string.translation_chatbot_thinking`). The web source's default label
 * `t('helix.thinking', 'Helix is thinking')` resolves to this exact string at runtime — `helix.thinking` is an
 * i18next key with no catalog entry, so i18next returns its fallback, which the catalog already canonicalises
 * under `chatbot.thinking`. The composable binds the catalog resource as the default; this constant records the
 * provenance so the mapping is auditable (Honesty Covenant #9).
 */
const val DEFAULT_LABEL_CATALOG_KEY: String = "chatbot.thinking"

/** Web `w-full` — the first skeleton line fills the full width. */
const val SKELETON_FRACTION_FULL: Float = 1f

/** Web `w-11/12` — the second skeleton line. */
const val SKELETON_FRACTION_ELEVEN_TWELFTHS: Float = 11f / 12f

/** Web `w-9/12` — the third (shortest) skeleton line, mimicking the ragged end of a paragraph. */
const val SKELETON_FRACTION_THREE_QUARTERS: Float = 9f / 12f

/** Web per-line shimmer offset (`[animation-delay:0.3s]` / `0.6s`) — each line trails the previous by this much. */
const val SKELETON_LINE_STAGGER_MS: Int = 300

/**
 * Web per-dot bounce offset. The web dots use negative delays (`-0.3s` / `-0.15s` / `0`) so they start mid-cycle
 * and ripple left-to-right; the native renderer reproduces that ripple by fast-forwarding each dot by this step.
 */
const val THINKING_DOT_STAGGER_MS: Int = 150

/** The web indicator draws exactly three skeleton lines and three dots. */
const val THINKING_DOT_COUNT: Int = 3

/**
 * The immutable surface state the [AIThinkingIndicatorViewModel] exposes. It carries only the resolved
 * reduced-motion preference (web `prefers-reduced-motion`, read through the `motion-safe:` variant); the label is
 * a pure render parameter threaded straight through (web's `label` prop), so it is not part of the bound state.
 *
 * @property reducedMotion whether the platform requests reduced motion. `true` stops the dot bounce and the line
 *   shimmer while keeping the static skeleton visible (web `motion-safe:` → animation suppressed). Defaults to
 *   `false` (full motion) so the surface animates until the preference resolves.
 */
data class ThinkingIndicatorState(
    val reducedMotion: Boolean = false,
)

/**
 * One shimmering skeleton line: its [widthFraction] of the parent width (web `w-full` / `w-11/12` / `w-9/12`) and
 * the [animationDelayMs] by which its shimmer trails the line above (web `[animation-delay:…]`). The delay is
 * inert under reduced motion (the line renders as a static bar).
 */
data class SkeletonLineSpec(
    val widthFraction: Float,
    val animationDelayMs: Int,
)

/**
 * One bouncing dot: the [animationDelayMs] (a fast-forward offset) that desynchronises it from its neighbours so
 * the three dots ripple (web's negative `[animation-delay]`). Inert under reduced motion (the dot renders static).
 */
data class ThinkingDotSpec(
    val animationDelayMs: Int,
)

/**
 * The render-ready projection of the full indicator: the resolved [label], whether the dots/lines should animate
 * ([animated] — the inverse of reduced motion), and the fixed [lines] + [dots] geometry the web encodes. A closed
 * value the stateless composable consumes directly, so the render path branches on nothing else and every field
 * is unit-tested off-device.
 */
data class ThinkingIndicatorProjection(
    val label: String,
    val animated: Boolean,
    val lines: List<SkeletonLineSpec>,
    val dots: List<ThinkingDotSpec>,
)

/**
 * The render-ready projection of the compact [AIThinkingDots] variant — whether the dots bounce ([animated]) and
 * the fixed [dots] geometry. The compact form carries no skeleton lines and no HelixMark; it is the in-button
 * streaming label the web exports alongside the full indicator.
 */
data class ThinkingDotsProjection(
    val animated: Boolean,
    val dots: List<ThinkingDotSpec>,
)

/**
 * Resolves the label the indicator shows — the pure port of web `label ?? t('helix.thinking', …)`. A non-null
 * [override] (an already-localized, caller-supplied string such as "Helix is summarising") wins; otherwise the
 * catalog [default] ("Helix is thinking…") is used. Nullish semantics match the web `??`: an explicitly empty
 * override is the caller's choice and is passed through unchanged.
 */
fun resolveThinkingLabel(
    override: String?,
    default: String,
): String = override ?: default

/**
 * The three skeleton lines, top-to-bottom, with their decreasing widths and trailing shimmer offsets — the pure
 * port of the web `flex flex-col gap-2` block. Stable order, so the renderer and the tests agree on every line.
 */
fun thinkingSkeletonLines(): List<SkeletonLineSpec> =
    listOf(
        SkeletonLineSpec(SKELETON_FRACTION_FULL, animationDelayMs = 0),
        SkeletonLineSpec(SKELETON_FRACTION_ELEVEN_TWELFTHS, animationDelayMs = SKELETON_LINE_STAGGER_MS),
        SkeletonLineSpec(SKELETON_FRACTION_THREE_QUARTERS, animationDelayMs = 2 * SKELETON_LINE_STAGGER_MS),
    )

/**
 * The three bouncing dots, left-to-right, each fast-forwarded one [THINKING_DOT_STAGGER_MS] step past the last so
 * they ripple — the pure port of the web dot row's staggered negative delays. Shared by the full indicator and
 * the compact [AIThinkingDots] form.
 */
fun thinkingDots(): List<ThinkingDotSpec> =
    (0 until THINKING_DOT_COUNT).map { index -> ThinkingDotSpec(animationDelayMs = index * THINKING_DOT_STAGGER_MS) }

/**
 * Projects the full indicator for [state] and the caller's [labelOverride] against the catalog [defaultLabel].
 * Pure (no Compose / clock): the label is resolved, motion is enabled only when the platform does not request
 * reduced motion, and the fixed line + dot geometry is attached. The stateless composable renders this verbatim.
 */
fun projectThinkingIndicator(
    state: ThinkingIndicatorState,
    labelOverride: String?,
    defaultLabel: String,
): ThinkingIndicatorProjection =
    ThinkingIndicatorProjection(
        label = resolveThinkingLabel(labelOverride, defaultLabel),
        animated = !state.reducedMotion,
        lines = thinkingSkeletonLines(),
        dots = thinkingDots(),
    )

/**
 * Projects the compact [AIThinkingDots] variant: the dots bounce only when [reducedMotion] is `false`. Pure, so
 * the in-button form's motion gating is unit-tested without a Compose host.
 */
fun projectThinkingDots(reducedMotion: Boolean): ThinkingDotsProjection =
    ThinkingDotsProjection(animated = !reducedMotion, dots = thinkingDots())

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [AI_THINKING_INDICATOR_SLUG] (P1/S11)
 * — never the label text, a vehicle id, or any model output, so a diagnostics line can never leak fleet state or
 * the prompt. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once
 * per surface open.
 */
fun recordThinkingIndicatorOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AI_THINKING_INDICATOR_SLUG))
}
