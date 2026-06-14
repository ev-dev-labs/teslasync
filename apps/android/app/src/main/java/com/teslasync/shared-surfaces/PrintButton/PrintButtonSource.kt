// The two interaction seams the PrintButton shared surface binds to — the native analogues of the web
// `window.print()` call and the `requestAnimationFrame(...)` flush in web/src/components/ui/PrintButton.tsx.
// The composable performs NO platform print I/O and no frame timing of its own; it drives these seams
// through the state holder, so "data flows through the shared state holder, never a raw platform call from
// the view" is satisfied honestly (P1/S8, ADR-002) and the orchestration stays fully unit-testable
// off-device against in-memory test doubles.
//
// The production Android implementations that need a `Context` / a Compose frame clock live at the
// composable boundary (rememberSystemPrintLauncher / rememberFrameSynchronizer in PrintButton.kt); this
// file stays framework-free so the contract is covered by the JVM unit gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/PrintButton) cannot form a valid Kotlin package; `MatchingDeclarationName`
// / `ktlint:standard:filename` are suppressed because the file is named for its surface role, not for a
// single namesake declaration.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

/**
 * Opens the platform print dialog — the native analogue of the web `window.print()`. The single seam the
 * [PrintButtonViewModel] depends on so it binds to an abstraction (the real Android `PrintManager` ↔ a
 * recording test double), never to a platform print API directly.
 *
 * Unlike the web `window.print()` (which returns `void` and cannot fail), the Android print framework can
 * decline to start — there may be no print service on the device — so [print] returns a [Boolean]: `true`
 * when the system print dialog was launched, `false` when the platform rejected it. The surface records the
 * resolved [PrintOutcome] either way and returns to idle; this native-only failure branch never invents a
 * new visible state.
 */
fun interface PrintLauncher {
    /** Launches the system print dialog; returns whether the platform accepted the launch. */
    fun print(): Boolean
}

/**
 * Awaits a single rendered frame — the native analogue of the web `requestAnimationFrame(...)`, which the
 * web component uses to give React one paint cycle to flush any pre-print state updates (expanded panels,
 * switched tabs) before the print snapshot is taken. The state holder suspends on [awaitFrame] after the
 * `beforePrint` hook resolves and before launching the dialog, so a caller's pre-print Compose state has a
 * chance to commit.
 *
 * The production implementation (rememberFrameSynchronizer) suspends on the Compose `withFrameNanos` clock;
 * tests inject an immediate implementation so virtual-time coroutines never wait on a real display.
 */
fun interface FrameSynchronizer {
    /** Suspends until the next rendered frame (production) or returns immediately (tests). */
    suspend fun awaitFrame()
}
