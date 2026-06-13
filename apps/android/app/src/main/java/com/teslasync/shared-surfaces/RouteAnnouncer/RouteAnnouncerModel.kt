// Pure, framework-free model + projection + diagnostics for the RouteAnnouncer shared surface — the native
// analogue of everything the web component decides before it pushes text into its live region
// (web/src/components/a11y/RouteAnnouncer.tsx). No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source actually does (and therefore the COMPLETE branch set this surface reproduces):
//   • First render is suppressed — the web keeps a `firstRender` ref and returns early on the initial effect
//     run so the browser's own initial page-title announcement is not double-spoken. Native mirror: the
//     [RouteAnnouncerState.primed] flag; the first observed route only arms the announcer and emits no text.
//   • On every SUBSEQUENT route change the web schedules a delayed read of `document.title`; an empty title
//     leaves the region empty (it deliberately does not re-speak the previous title), a non-empty title is
//     announced. Native mirror: [reduce] clears the message for a blank title and announces a non-blank one.
//   • A rotating 0–3 zero-width-space suffix is appended to every non-empty announcement. Two consecutive
//     routes that resolve to the SAME title (web example: `/charging/123` → `/charging/456`, both titled
//     "Charging Session — TeslaSync") would otherwise be dropped by screen readers that de-duplicate identical
//     live-region text. The rotating pad makes the text content differ so the second route is still spoken.
//     Native mirror: [padding] over the [RouteAnnouncerState.counter] advanced modulo [PADDING_CYCLE].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing. It is a router-driven accessibility live region whose only input is the current
// route's already-resolved title (the web `useLocation` + `document.title`, the native nav destination +
// `navTitle`). Modelling a network lifecycle here would invent behaviour the web spec does not have (honesty
// covenant: no scope narrowing, no silent drift). The three branches above ARE the surface's full state set,
// and each is reduced here and asserted in the off-device projection test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RouteAnnouncer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeannouncer

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Default delay before the resolved route title is read and announced — the native analogue of the web
 * `DEFAULT_ANNOUNCE_DELAY_MS = 100`. The delay lets a rapid A→B→C navigation collapse to a single announcement
 * (each route change cancels the previous pending read, exactly like the web `clearTimeout`), so a screen
 * reader is not flooded while the user taps through a stack. Tests pass `0` to read synchronously.
 */
const val DEFAULT_ANNOUNCE_DELAY_MS: Long = 100L

/**
 * The accumulated state of the announcer across route changes — the native analogue of the web component's two
 * refs (`firstRender`, `counter`) plus its `message` state. Pure data so the reducer is exercised off-device.
 *
 * @property primed false until the first route is observed; the web `firstRender` ref. The first observed
 *   route only flips this to true and announces nothing (the browser already spoke the initial title).
 * @property counter the rotating 0..[PADDING_CYCLE]-1 suffix length, advanced on every non-empty announcement
 *   so identical consecutive titles still differ in text content (web `counter.current`).
 * @property message the exact text the live region exposes — empty before the first route change, empty for a
 *   blank title, otherwise the title plus its zero-width-space pad (web `message`).
 */
data class RouteAnnouncerState(
    val primed: Boolean,
    val counter: Int,
    val message: String,
)

/**
 * Pure reducer from the previous [RouteAnnouncerState] and the current route's resolved title to the next
 * state — a 1:1 port of the web component's effect body (the `firstRender` early-return, the `document.title`
 * read, the empty-title clear, and the `counter % 4` zero-width-space rotation). Framework-free so the whole
 * announcement contract is covered by the JVM unit gate without a Compose host.
 */
object RouteAnnouncerProjection {
    /** The zero-width space (U+200B) appended to vary identical announcements (web `'\u200B'`). */
    const val ZERO_WIDTH_SPACE: String = "\u200B"

    /** The suffix-length cycle: the pad rotates 0,1,2,3,0,… so re-speaks differ (web `% 4`). */
    const val PADDING_CYCLE: Int = 4

    /** The pre-armed starting state: not primed, no pad, empty region. */
    val INITIAL: RouteAnnouncerState = RouteAnnouncerState(primed = false, counter = 0, message = "")

    /**
     * Web truthiness on the title to be announced (`if (!title)`): a null/blank value is "nothing meaningful to
     * announce" and clears the region; otherwise the trimmed title is spoken.
     */
    fun normalizeTitle(title: String?): String? = title?.trim()?.takeIf { it.isNotEmpty() }

    /** The rotating zero-width-space pad of the given length (web `'\u200B'.repeat(counter)`). */
    fun padding(count: Int): String = ZERO_WIDTH_SPACE.repeat(count)

    /**
     * Advance the announcer for a route change carrying [title]. Suppresses the very first observation (web
     * `firstRender`), clears the region for an absent title (web empty-`document.title`), and otherwise rotates
     * the pad and announces the title (web non-empty branch). Returns the next [RouteAnnouncerState]; the
     * composable simply renders its [RouteAnnouncerState.message].
     */
    fun reduce(
        previous: RouteAnnouncerState,
        title: String?,
    ): RouteAnnouncerState {
        val resolved = normalizeTitle(title)
        return when {
            !previous.primed -> previous.copy(primed = true, message = "")
            resolved == null -> previous.copy(message = "")
            else -> {
                val nextCounter = (previous.counter + 1) % PADDING_CYCLE
                previous.copy(counter = nextCounter, message = resolved + padding(nextCounter))
            }
        }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the route
 * path nor the page title — so a diagnostics line can never leak which screen a user navigated to.
 */
object RouteAnnouncerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "RouteAnnouncer"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
