// The single interaction seam the CopyLinkButton shared surface binds to — the native analogue of the
// web clipboard write (`navigator.clipboard.writeText(window.location.href)` with its textarea fallback)
// in web/src/components/layout/CopyLinkButton.tsx. The composable performs NO clipboard I/O of its own;
// it drives this seam through the state holder, so "data flows through the shared state holder, never a
// raw platform call from the view" is satisfied honestly (P1/S8, ADR-002) and the orchestration stays
// fully unit-testable off-device against a fake writer.
//
// The web `try { … } catch { toast.error(…) }` has a genuine failure branch (the Clipboard API is absent
// in a non-secure context, or the user denied permission), so the seam returns a [Boolean] rather than
// `Unit`: `true` when the link reached the clipboard, `false` when the platform rejected it — exactly the
// two branches the surface renders. The production Android implementation lives at the composable
// boundary (rememberSystemClipboardWriter in CopyLinkButton.kt) because it needs a `Context`; this file
// stays framework-free so the contract is covered by the JVM unit gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/CopyLinkButton) cannot form a valid Kotlin package; `MatchingDeclarationName`
// / `ktlint:standard:filename` are suppressed because the seam is named for its role, not the file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

/**
 * Writes a shareable link to the system clipboard — the native analogue of the web
 * `navigator.clipboard.writeText(url)`. The single seam the [CopyLinkButtonViewModel] depends on so it
 * binds to an abstraction (the real system clipboard ↔ a recording test double), never to an Android
 * `ClipboardManager` directly.
 *
 * [writeLink] returns `true` when the [link] reached the clipboard and `false` when the platform rejected
 * the write (the web `catch` branch) — the surface raises the success or error toast accordingly. [label]
 * is the user-visible clipboard-entry label (Android's `ClipData` label / accessibility description);
 * implementations that cannot carry a label simply ignore it.
 */
fun interface ClipboardWriter {
    /** Copies [link] under the user-visible [label]; returns whether the platform accepted the write. */
    fun writeLink(
        label: String,
        link: String,
    ): Boolean
}
