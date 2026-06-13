// Pure, framework-free model + projection + diagnostics for the VisuallyHidden shared surface — the
// native analogue of web/src/components/a11y/VisuallyHidden.tsx together with its data source
// web/src/hooks/useAnnouncer.ts (the global screen-reader announcer) and its consumer
// web/src/components/a11y/AnnouncerRegion.tsx. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web source is an ACCESSIBILITY PRIMITIVE, not a data-fetching view: `VisuallyHidden` renders
// content invisible to sighted users but exposed to assistive technologies, optionally as a
// role=status/alert + aria-live region (the `liveRegion` + `priority` props) or as a focus-revealed
// skip link (the `focusable` prop). Its bound data source `useAnnouncer` is an imperative announcement
// channel — `announce(message, priority)` fans a message out to every mounted live region, rotating a
// zero-width-space suffix (mod 4) so screen readers re-read an identical consecutive message, and
// skipping empty messages. `AnnouncerRegion` mounts two `VisuallyHidden` live regions (one polite, one
// assertive) and routes each announcement to the matching region.
//
// Because the announcer is an event channel and NOT an async cache-then-network feed, the surface has
// no loading / empty / error / stale / offline lifecycle to render; modelling those would fabricate
// behaviour the web spec does not have (the same rationale the accepted globalShortcuts / QuickNav
// ports document). The surface's real states are reproduced instead: an idle region (no message), a
// polite announcement, an assertive announcement, and the primitive's hidden / live / focus-revealed
// render modes. The web source renders no static copy of its own (its content is caller-supplied), so
// the surface carries no i18n keys — there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/VisuallyHidden — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the VisuallyHidden surface. The diagnostics [SLUG] is emitted with
 * the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`VisuallyHidden`).
 */
object VisuallyHiddenRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the announcer region with). */
    const val ID: String = "visually-hidden"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VisuallyHidden"
}

/**
 * Live-region urgency — the native tag for the web `priority` prop (`'polite' | 'assertive'`).
 * [Polite] (web default) waits for the user to finish their current assistive-technology activity;
 * [Assertive] interrupts and is reserved for genuine errors / time-sensitive messages. The render
 * boundary maps this onto Compose `LiveRegionMode`.
 */
enum class AnnouncePriority {
    /** Web `priority="polite"` → `role="status"`, `aria-live="polite"` → `LiveRegionMode.Polite`. */
    Polite,

    /** Web `priority="assertive"` → `role="alert"`, `aria-live="assertive"` → `LiveRegionMode.Assertive`. */
    Assertive,
}

/**
 * A single screen-reader announcement fanned out by the announcer — the native analogue of the web
 * `announce(message, priority)` payload. [message] is already padded with the dedupe suffix (see
 * [padAnnouncement]); [priority] selects which live region voices it.
 */
data class Announcement(
    val message: String,
    val priority: AnnouncePriority,
)

/**
 * The projected state the announcer region renders — the native analogue of the web `AnnouncerRegion`'s
 * two pieces of state (`polite`, `assertive`). Each field holds the latest padded message routed to
 * that region; an empty string is an idle region that voices nothing.
 */
data class AnnouncerState(
    val politeMessage: String,
    val assertiveMessage: String,
) {
    companion object {
        /** The neutral state before anything is announced — both regions idle (web initial `''`/`''`). */
        val EMPTY: AnnouncerState = AnnouncerState(politeMessage = "", assertiveMessage = "")
    }
}

/** The zero-width space the dedupe suffix is built from (web `'\u200B'`). */
const val ZERO_WIDTH_SPACE: String = "\u200B"

/** How many distinct dedupe suffixes rotate before repeating (web `counter % 4`). */
const val DEDUPE_PERIOD: Int = 4

/**
 * The rotating zero-width-space dedupe suffix for the [counter]-th announcement — the native mirror of
 * the web `'\u200B'.repeat(counter % 4)`. Without a changing suffix a screen reader skips an identical
 * consecutive message ("Selection cleared" fired twice is voiced once); rotating 0–3 trailing
 * zero-width spaces forces a fresh string so the message is re-read, while staying invisible and
 * bounded in length. A negative [counter] is folded into range so the function is total.
 */
fun dedupePadding(counter: Int): String {
    val steps = ((counter % DEDUPE_PERIOD) + DEDUPE_PERIOD) % DEDUPE_PERIOD
    return ZERO_WIDTH_SPACE.repeat(steps)
}

/**
 * Appends the [counter]-th [dedupePadding] to [message] — the native mirror of the web
 * `${message}${padding}`. Applied by the announcer at fan-out time so two consecutive identical
 * messages reach the region as distinct strings and are both voiced.
 */
fun padAnnouncement(
    message: String,
    counter: Int,
): String = message + dedupePadding(counter)

/**
 * Routes an [announcement] into the [state], replacing only the matching region and leaving the other
 * untouched — the native mirror of the web `AnnouncerRegion` `setAssertive` / `setPolite` split (some
 * screen readers ignore `aria-live` changes after the first announcement, so the two regions are kept
 * independent). An empty [Announcement.message] leaves the state unchanged (web `announce` skips empty
 * messages before any region is touched), so an idle region is never clobbered with nothing.
 */
fun routeAnnouncement(
    state: AnnouncerState,
    announcement: Announcement,
): AnnouncerState =
    if (announcement.message.isEmpty()) {
        state
    } else {
        when (announcement.priority) {
            AnnouncePriority.Polite -> state.copy(politeMessage = announcement.message)
            AnnouncePriority.Assertive -> state.copy(assertiveMessage = announcement.message)
        }
    }

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the surface fans out an announcement. */
const val EVENT_ANNOUNCE: String = "visuallyHidden.announce"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the announcement urgency (never the message text). */
const val FIELD_PRIORITY: String = "priority"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [VisuallyHiddenRegistration.SLUG] (P1/S11) — never an announced message, so a diagnostics line can
 * never leak what a screen-reader user was told. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordVisuallyHiddenOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to VisuallyHiddenRegistration.SLUG))
}
