// The single environment port the AIThinkingIndicator shared surface binds to — the native analogue of the one
// runtime signal the web component reads beyond its `label` prop: `prefers-reduced-motion`
// (web/src/components/ai/AIThinkingIndicator.tsx, the `motion-safe:` variant). The web surface performs no data
// fetch; its only environmental dependency is the reduced-motion media query, which gates the dot bounce + line
// shimmer. This seam is that signal, narrowed to the one boolean the surface needs. The view-model depends on
// this abstraction (a real adapter over the platform animator scale in production, a fake in tests), never on the
// Android framework directly, so the view performs NO HTTP and reads no platform setting itself (P1/S8 boundary,
// ADR-002).
//
// In production the host derives the flow from the established motion layer — the same animator-duration-scale
// read that backs `io.teslasync.android.components.motion.rememberReducedMotion()` (Android's
// `prefers-reduced-motion` equivalent) — and wires it via [aiThinkingIndicatorSource]; a preview or test that
// already knows the value uses [staticReducedMotionSource]; a unit test implements [AIThinkingIndicatorSource]
// directly. The surface carries no other data dependency — its default label comes from the P1/S10 i18n catalog,
// not from this port.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIThinkingIndicator) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located factories alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [AIThinkingIndicatorViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on the Android framework or the network. [reducedMotion] streams the platform reduced-motion
 * preference (web `prefers-reduced-motion`); when it emits `true` the dot bounce and line shimmer are suppressed
 * while the static skeleton stays visible, mirroring the web `motion-safe:` variant. No HTTP touches the view.
 */
interface AIThinkingIndicatorSource {
    /**
     * Stream whether the platform requests reduced motion (web `prefers-reduced-motion`). Re-emits whenever the
     * user toggles the system "remove animations" / animator-duration-scale setting, so the indicator switches
     * between the animated and static renders live. A source that cannot observe changes may emit a single value.
     */
    fun reducedMotion(): Flow<Boolean>
}

/**
 * Builds an [AIThinkingIndicatorSource] from the reduced-motion flow a host wires to the platform motion layer —
 * typically the animator-duration-scale read that backs `rememberReducedMotion()`. This is the production seam; a
 * test fake implements [AIThinkingIndicatorSource] directly instead.
 */
fun aiThinkingIndicatorSource(reducedMotion: () -> Flow<Boolean>): AIThinkingIndicatorSource =
    object : AIThinkingIndicatorSource {
        override fun reducedMotion(): Flow<Boolean> = reducedMotion()
    }

/**
 * A constant [AIThinkingIndicatorSource] that emits a single [reduced] value — for previews and hosts that have
 * already resolved the preference (e.g. from `rememberReducedMotion()` at the call site) and only need to hand it
 * to the ViewModel. Defaults to `false` (full motion).
 */
fun staticReducedMotionSource(reduced: Boolean = false): AIThinkingIndicatorSource =
    object : AIThinkingIndicatorSource {
        override fun reducedMotion(): Flow<Boolean> = flowOf(reduced)
    }
