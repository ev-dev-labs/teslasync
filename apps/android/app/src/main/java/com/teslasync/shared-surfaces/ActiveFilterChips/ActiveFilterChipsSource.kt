// The single interaction seam the ActiveFilterChips shared surface binds to — the native analogue of the web
// component's local a11y announcer (web/src/components/forms/ActiveFilterChips.tsx, the `removalAnnouncement`
// `useState` + the `announceCounterRef` `useRef`). The surface performs NO data fetch, so unlike the data-bound
// surfaces there is no store or SSE seam here; the only abstracted dependency is the live-region announcer, which
// is what makes the re-announce mechanic fully unit-testable off-device (a fake announcer stands in for the
// state round-trip). The view-model depends on this abstraction, never on a concrete Compose state, so the view
// performs no business logic (P1/S8 boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the port interface + its production state holder co-located in one file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activefilterchips

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The polite live-region announcer the [ActiveFilterChipsViewModel] drives — the native `removalAnnouncement`
 * state + `announceCounterRef`. [announcement] is the observable string the view renders into a polite live
 * region (web `<VisuallyHidden liveRegion>`); [announce] publishes an already-localized [message], re-announcing
 * it so assistive tech re-reads even an identical message. A real [LiveFilterAnnouncer] is used in production; a
 * fake implements this interface directly in tests so the gating logic runs without a UI.
 */
interface FilterAnnouncer {
    /** The current live-region text — the empty string until the first announcement (web initial state). */
    val announcement: StateFlow<String>

    /**
     * Publishes [message] to [announcement], appending a fresh invisible suffix so the live region re-fires even
     * for a repeated message — web `setRemovalAnnouncement(\`${message}${padding}\`)`. The [message] is supplied
     * already translated by the render boundary (P1/S10); no i18n lookup happens here.
     */
    fun announce(message: String)
}

/**
 * The production [FilterAnnouncer]: a small, self-contained state holder backing the web announcer round-trip.
 * [announce] increments a private counter and republishes the message with [reannouncePadding] appended, so a
 * screen-reader re-reads it even when two successive removals carry the same field name. Instances are scoped to
 * a single surface placement (created in the composable and remembered), so no cross-instance synchronization is
 * required — [announce] is invoked from the main dispatcher.
 */
class LiveFilterAnnouncer : FilterAnnouncer {
    private val announcementState = MutableStateFlow("")
    private var counter = 0

    override val announcement: StateFlow<String> = announcementState.asStateFlow()

    override fun announce(message: String) {
        counter += 1
        announcementState.value = message + reannouncePadding(counter)
    }
}

/** Builds the production [FilterAnnouncer] for a surface placement. A test fake implements [FilterAnnouncer]. */
fun filterAnnouncer(): FilterAnnouncer = LiveFilterAnnouncer()
