// The single interaction seam the HelpTooltip shared surface binds to — the native analogue of the web
// "Learn more" link's new-tab navigation (`<a href={learnMore.url} target="_blank" rel="noopener noreferrer">`)
// in web/src/components/ui/HelpTooltip.tsx. The composable performs NO navigation of its own; it drives this
// seam through the state holder, so "data flows through the shared state holder, never a raw platform call
// from the view" is satisfied honestly (P1/S8, ADR-002) and the orchestration stays fully unit-testable
// off-device against a fake opener.
//
// A new-tab open can genuinely fail (no browser installed, no activity able to handle the URL — the native
// analogue of a popup being blocked), so the seam returns a [Boolean] rather than `Unit`: `true` when the
// platform launched the link, `false` when it rejected it — exactly the two branches the surface records. The
// production Android implementation lives at the composable boundary (rememberExternalLinkOpener in
// HelpTooltip.kt) because it needs a `Context`; this file stays framework-free so the contract is covered by
// the JVM unit gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/HelpTooltip) cannot form a valid Kotlin package; `MatchingDeclarationName` /
// `ktlint:standard:filename` are suppressed because the seam is named for its role, not the file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

/**
 * Opens an external "Learn more" link — the native analogue of the web `<a target="_blank">` new-tab
 * navigation. The single seam the [HelpTooltipViewModel] depends on so it binds to an abstraction (the real
 * system browser ↔ a recording test double), never to an Android `Intent` / `Context` directly.
 *
 * [open] launches [url] and returns `true` when the platform accepted it and `false` when it rejected it
 * (no browser, no matching activity) — the surface records the success or failure outcome accordingly. The
 * URL is never logged; only the coarse outcome is.
 */
fun interface LinkOpener {
    /** Opens [url] externally; returns whether the platform accepted the navigation. */
    fun open(url: String): Boolean
}
