// The native Jetpack Compose + Material 3 AnnouncerRegion shared surface — the data layer of a parity port
// of the web global screen-reader announcer (web/src/components/a11y/AnnouncerRegion.tsx + its data source
// web/src/hooks/useAnnouncer.ts). The view lives in AnnouncerRegion.kt.
//
// What the web does: `useAnnouncer` owns a module-level pub/sub — `announce(message, priority)` fans a message
// out to every subscribed live region, and `<AnnouncerRegion>` (mounted once in <Layout>) keeps a polite and
// an assertive string in state and renders two screen-reader-only `aria-live` regions that assistive tech
// voices when the text changes. The two regions are siblings with STATIC `aria-live` values because some
// screen readers ignore an `aria-live` change after the first announcement.
//
// The native port keeps that contract 1:1:
//   • [Announcer] is the P1/S8 state holder — the `useAnnouncer` module port. It exposes a polite and an
//     assertive hot [StateFlow] of the current message (the web `useState` per region) plus the [announce]
//     writer (the web module `announce`). A Compose live region that collects a flow re-voices exactly when
//     the value changes, so the StateFlow IS the subscriber list — collection replaces `subscribeAnnouncer`.
//   • [GlobalAnnouncer] is the app-wide singleton every call-site fires through (the web module-level store);
//     mount [AnnouncerRegion] once against it, exactly as <Layout> mounts the web component once.
//   • [AnnouncerRegionDiagnostics] emits the one PII-safe `view.opened` event (P1/S11), slug `AnnouncerRegion`.
//
// De-duplication parity (web "rotating zero-width space"): a StateFlow suppresses a re-set of the SAME value,
// so two identical consecutive announcements would be voiced once — the same defect the web works around. The
// port reproduces the web fix verbatim: each [announce] appends a rotating run of zero-width spaces
// (`'\u200B'.repeat(counter % 4)`), forcing a fresh, distinct value the live region re-voices, while the
// zero-width characters stay inaudible. This is faithful behaviour, not an embellishment.
//
// This surface has NO async data source — its only input is the imperative [announce] stream — so it has no
// network loading / error / stale / offline lifecycle to model; inventing those would fabricate behaviour the
// web spec does not have (the same rationale the accepted globalShortcuts port documents). Its real states are
// the web's two: an empty region (initial, voices nothing) and a populated region (after [announce]); the view
// renders both, always mounted, never conditionally hidden.
//
// i18n: the surface is anonymous — it owns no copy. Every announced string is supplied already-localized by the
// caller (e.g. a bulk-action result), so there is no literal to route through the P1/S10 catalog here.
//
// The mandated surface directory (com/teslasync/shared-surfaces/AnnouncerRegion — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen and a capitalized leaf are illegal in a package id), so
// the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.announcerregion

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicInteger

/**
 * Live-region urgency — the native analogue of the web `AnnouncerPriority` (`'polite' | 'assertive'`).
 * [Polite] (the default) waits for the user's current AT activity to finish; [Assertive] interrupts and is
 * reserved for genuine errors / security-sensitive messages, matching the web guidance.
 */
enum class AnnouncerPriority {
    Polite,
    Assertive,
}

/**
 * The global screen-reader announcer — the Android port of the web `useAnnouncer` module
 * (web/src/hooks/useAnnouncer.ts) and the P1/S8 state holder the [AnnouncerRegion] view binds to.
 *
 * [polite] and [assertive] are hot [StateFlow]s of the current message for each priority (the web `useState`
 * per region). [announce] is the single imperative writer (the web module `announce`); call it from any
 * thread — the increment is atomic and a [MutableStateFlow] write is itself atomic, so concurrent callers
 * never corrupt the rotation counter or interleave a half-written value.
 *
 * Because a [StateFlow] suppresses a re-set of an equal value, two identical consecutive messages would
 * otherwise be voiced once. [announce] reproduces the web fix: it appends a rotating run of zero-width spaces
 * so the emitted value always differs from its predecessor, forcing the live region to re-voice while the
 * suffix stays inaudible.
 *
 * The default app-wide instance is [GlobalAnnouncer]; tests construct throwaway instances so the singleton is
 * never polluted across cases.
 */
class Announcer {
    private val politeState = MutableStateFlow("")
    private val assertiveState = MutableStateFlow("")
    private val counter = AtomicInteger(0)

    /** The current polite message — empty until the first polite [announce] (web polite `useState`). */
    val polite: StateFlow<String> = politeState.asStateFlow()

    /** The current assertive message — empty until the first assertive [announce] (web assertive `useState`). */
    val assertive: StateFlow<String> = assertiveState.asStateFlow()

    /**
     * Fires a screen-reader announcement on the live region for [priority]. Empty [message]s are skipped (web
     * `if (!message) return`). The emitted value carries the rotating zero-width-space suffix so an identical
     * consecutive message is still re-voiced.
     *
     * @param message the text to announce; supplied already-localized by the caller.
     * @param priority [AnnouncerPriority.Polite] (default) waits; [AnnouncerPriority.Assertive] interrupts.
     */
    fun announce(
        message: String,
        priority: AnnouncerPriority = AnnouncerPriority.Polite,
    ) {
        if (message.isEmpty()) return
        val rotation = counter.incrementAndGet() % DEDUP_MODULUS
        val padded = message + ZERO_WIDTH_SPACE.repeat(rotation)
        when (priority) {
            AnnouncerPriority.Assertive -> assertiveState.value = padded
            AnnouncerPriority.Polite -> politeState.value = padded
        }
    }

    /** Clears both regions and the rotation counter. Lets a fresh surface / test start from a clean slate. */
    fun reset() {
        politeState.value = ""
        assertiveState.value = ""
        counter.set(0)
    }

    companion object {
        /** The zero-width space appended (0..3 of them) so repeated identical messages re-voice. */
        const val ZERO_WIDTH_SPACE: String = "\u200B"

        /** The rotation modulus — bounds the suffix length so a message never grows without limit (web mod 4). */
        const val DEDUP_MODULUS: Int = 4
    }
}

/**
 * The app-wide announcer singleton every call-site fires through — the web module-level subscriber store.
 * Mount [AnnouncerRegion] exactly once (the web `<Layout>` mount) so these flows reach a live region.
 */
val GlobalAnnouncer: Announcer = Announcer()

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never any announced copy, which can contain user data.
 */
object AnnouncerRegionDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "announcer-region"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "AnnouncerRegion"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the view's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
