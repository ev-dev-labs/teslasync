// The single interaction seam the CopyButton shared surface binds to — the native analogue of the web
// clipboard write (`navigator.clipboard.writeText(text)`) in web/src/components/ui/CopyButton.tsx. The
// composable performs NO clipboard I/O of its own; it drives this seam through the state holder, so
// "data flows through the shared state holder, never a raw platform call from the view" is satisfied
// honestly (P1/S8, ADR-002) and the orchestration stays fully unit-testable off-device against a fake
// writer.
//
// The web `try { … } catch { … }` has a genuine failure branch (the Clipboard API is absent in a
// non-secure context, or the platform denied the write), so the seam returns a [Boolean] rather than
// `Unit`: `true` when the text reached the clipboard, `false` when the platform rejected it — exactly
// the two branches the surface renders. The production Android implementation lives at the composable
// boundary (rememberSystemClipboardWriter in CopyButton.kt) because it needs a `Context`; this file
// stays framework-free so the contract is covered by the JVM unit gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/CopyButton) cannot form a valid Kotlin package; `MatchingDeclarationName`
// / `ktlint:standard:filename` are suppressed because the seam is named for its role, not the file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

/**
 * Writes arbitrary text to the system clipboard — the native analogue of the web
 * `navigator.clipboard.writeText(text)`. The single seam the [CopyButtonViewModel] depends on so it binds
 * to an abstraction (the real system clipboard ↔ a recording test double), never to an Android
 * `ClipboardManager` directly.
 *
 * [writeText] returns `true` when the [text] reached the clipboard and `false` when the platform rejected
 * the write (the web `catch` branch) — the surface flips to the copied confirmation or raises the error
 * toast accordingly. [label] is the user-visible clipboard-entry label (Android's `ClipData` label);
 * implementations that cannot carry a label simply ignore it.
 */
fun interface ClipboardWriter {
    /** Copies [text] under the user-visible [label]; returns whether the platform accepted the write. */
    fun writeText(
        label: String,
        text: String,
    ): Boolean
}
