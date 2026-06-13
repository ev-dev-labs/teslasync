// The native Jetpack Compose view for the AnnouncerRegion shared surface — the parity port of the web
// `AnnouncerRegion` component (web/src/components/a11y/AnnouncerRegion.tsx). It binds the [Announcer] state
// holder (its data layer lives in AnnouncerRegionModel.kt) and renders the two screen-reader live regions.
//
// Web parity, element for element: the web renders two `VisuallyHidden` siblings — one polite, one assertive —
// each a screen-reader-only `aria-live` region whose text the announcer writes. Here each region is a 1.dp,
// visually-negligible [Box] carrying a STATIC [LiveRegionMode] and the current message as its
// `contentDescription`; when that text changes TalkBack voices it WITHOUT moving focus — the exact `aria-live`
// / `role=status|alert` contract. Keeping each region's mode static across its lifetime mirrors the web reason
// for splitting polite and assertive into two siblings. This is the same visually-hidden live-region primitive
// the accepted navigation RouteAnnouncer already ships.
//
// Data binding: the view performs NO HTTP and owns no state — it only collects the [Announcer]'s two flows
// (P1/S8) with `collectAsStateWithLifecycle` and reflects them into the regions, satisfying the "no direct
// HTTP / state-holder-bound view" contract (ADR-002).
//
// Accessibility: the surface emits NO interactive element — there is nothing to focus, tap, or label for
// TalkBack beyond the live regions themselves, which carry their announced text as `contentDescription`. It is
// invisible by design (the web `sr-only`), so font-scale, reduce-motion, and visible empty-state concerns do
// not apply — a visible empty state would contradict the screen-reader-only spec. Diagnostics: a single
// PII-safe `view.opened` (P1/S11) fires on first composition.
//
// The mandated surface directory cannot form a valid Kotlin package, so the package diverges from the path,
// exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.announcerregion

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the polite live region — mirrors the web `data-testid="announcer-polite"`. */
const val POLITE_TEST_TAG: String = "announcer-polite"

/** Test tag for the assertive live region — mirrors the web `data-testid="announcer-assertive"`. */
const val ASSERTIVE_TEST_TAG: String = "announcer-assertive"

private val LIVE_REGION_SIZE = 1.dp

/**
 * The global announcer mount point — the parity port of the web `AnnouncerRegion`. Renders the two
 * screen-reader-only live regions (one polite, one assertive) that [Announcer] writes into, records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11), and shows no visible UI. Mount exactly once per app
 * (the web `<Layout>` mount); tests that observe announcements mount this around the unit under test.
 *
 * @param announcer the state holder the regions bind to; defaults to the app-wide [GlobalAnnouncer]. Tests
 *   pass a throwaway instance so the singleton is never polluted across cases.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through; defaults to
 *   the app's [LocalDataContainer].
 */
@Composable
fun AnnouncerRegion(
    announcer: Announcer = GlobalAnnouncer,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val polite by announcer.polite.collectAsStateWithLifecycle()
    val assertive by announcer.assertive.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { AnnouncerRegionDiagnostics.recordViewOpened(logger) }

    // Two siblings with STATIC live-region modes — the web splits polite/assertive so neither region's
    // urgency value ever changes after its first announcement.
    LiveRegion(message = polite, mode = LiveRegionMode.Polite, tag = POLITE_TEST_TAG)
    LiveRegion(message = assertive, mode = LiveRegionMode.Assertive, tag = ASSERTIVE_TEST_TAG)
}

/**
 * One screen-reader-only live region — a visually-negligible node that voices [message] through TalkBack
 * whenever the text changes, without moving focus. [mode] stays constant for the region's lifetime (web
 * static `aria-live`). The node is always present even when [message] is empty, so the region is never
 * conditionally unmounted before assistive tech can read it.
 */
@Composable
private fun LiveRegion(
    message: String,
    mode: LiveRegionMode,
    tag: String,
) {
    Box(
        modifier =
            Modifier
                .size(LIVE_REGION_SIZE)
                .testTag(tag)
                .semantics {
                    liveRegion = mode
                    contentDescription = message
                },
    )
}
