// The single platform seam the FullscreenButton shared surface binds to — the native analogue of the browser
// Fullscreen API the web component drives (web/src/components/ui/FullscreenButton.tsx):
// `document.fullscreenEnabled`, `document.fullscreenElement`, the `fullscreenchange` event, and
// `target.requestFullscreen()` / `document.exitFullscreen()`. The composable performs NO window I/O of its
// own; it drives this seam through the state holder, so "data flows through the shared state holder, never a
// raw platform call from the view" is satisfied honestly (P1/S8, ADR-002) and the orchestration stays fully
// unit-testable off-device against a fake controller.
//
// On Android "fullscreen" is host-window immersive mode (hiding the system bars via WindowInsetsController),
// not an element-level request, so the seam is window-scoped rather than target-scoped — a documented
// divergence from the web `targetRef`, not a silent one. The production implementation lives at the composable
// boundary (rememberSystemFullscreenController in FullscreenButton.kt) because it needs the host Window + View;
// this file stays framework-free so the contract is covered by the JVM unit gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/FullscreenButton) cannot form a valid Kotlin package; `MatchingDeclarationName`
// / `ktlint:standard:filename` are suppressed because the seam is named for its role, not the file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import kotlinx.coroutines.flow.Flow

/**
 * Toggles and observes the host's fullscreen (immersive) state — the native analogue of the browser Fullscreen
 * API. The single seam the [FullscreenButtonViewModel] depends on so it binds to an abstraction (the real host
 * window ↔ a recording test double), never to an Android `WindowInsetsController` directly.
 *
 * [isSupported] mirrors `document.fullscreenEnabled`: when false the surface hides entirely (web
 * `if (!supported) return null`). [isFullscreen] is the synchronous current-state read the toggle decision uses
 * (web `document.fullscreenElement` read fresh at click time). [fullscreenChanges] emits the current value on
 * subscription and again on every change (web `fullscreenchange` event), so the icon stays in sync when the
 * host exits fullscreen without a tap. [enter] / [exit] request and release fullscreen
 * (web `requestFullscreen()` / `exitFullscreen()`); on an unsupported host both are no-ops.
 */
interface FullscreenController {
    /** Whether this host can toggle fullscreen at all (web `document.fullscreenEnabled`). */
    val isSupported: Boolean

    /** The current fullscreen state, read fresh — the toggle decision's source (web `document.fullscreenElement`). */
    fun isFullscreen(): Boolean

    /** Emits the current fullscreen state on subscription and on every change (web `fullscreenchange`). */
    fun fullscreenChanges(): Flow<Boolean>

    /** Enters fullscreen / immersive mode (web `target.requestFullscreen()`); a no-op when unsupported. */
    fun enter()

    /** Exits fullscreen / immersive mode (web `document.exitFullscreen()`); a no-op when unsupported. */
    fun exit()
}
