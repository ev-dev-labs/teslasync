// The announcer seam the VisuallyHidden surface binds to, plus its process-wide production instance —
// the native port of web/src/hooks/useAnnouncer.ts (the global screen-reader announcer). The view
// (composable) performs NO work of its own; it only renders the routed state the ViewModel derives
// from this seam, satisfying the "data flows through the shared state holder" contract (ADR-002).
//
// The web source is a module-level singleton: a shared `listeners` set + an `announceCounter`, an
// exported `announce(message, priority)` that increments the counter, pads the message with a rotating
// zero-width-space suffix and fans it out to every listener (skipping empty messages, dropping when no
// region is mounted), and `subscribeAnnouncer` for a region to listen. This seam mirrors that 1:1:
// [announce] is the exported function, [announcements] is the subscription, and [BroadcastAnnouncer]
// reproduces the counter + padding + drop-if-no-listener semantics. The web announcer is itself a
// self-contained state holder (no heavier store), so its native counterpart is co-located with its
// sole consumer surface and exposed app-wide through [ProcessAnnouncer] / [announce].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VisuallyHidden) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import java.util.concurrent.atomic.AtomicInteger

/**
 * The single seam the [VisuallyHiddenViewModel] depends on so it binds to an abstraction (the real
 * process announcer ↔ a throwaway test instance), never to a concrete client — the Android analogue of
 * the web `useAnnouncer` global announcer (the P1/S8 state-holder boundary for this surface).
 *
 * [announcements] streams every fanned-out [Announcement] (web `subscribeAnnouncer`); [announce] fires
 * one (web `announce`). Implementations apply the rotating dedupe suffix and skip empty messages so the
 * seam's contract matches the web module exactly. No HTTP touches the view.
 */
interface Announcer {
    /**
     * The hot stream of fanned-out announcements. It is replay-free: a subscriber that attaches after
     * an [announce] call misses it, exactly as the web announcer drops a message fired with no mounted
     * listener.
     */
    val announcements: Flow<Announcement>

    /** Fans [message] out to every current subscriber at [priority] (web `announce(message, priority)`). */
    fun announce(
        message: String,
        priority: AnnouncePriority = AnnouncePriority.Polite,
    )
}

/** Extra buffered announcements kept per subscriber before the oldest is dropped (bounded fan-out). */
private const val ANNOUNCER_BUFFER: Int = 16

/**
 * The default [Announcer] — a hot broadcast over a replay-free [MutableSharedFlow], the native analogue
 * of the web module-level listener set + counter. Each [announce] increments a rotating counter, pads
 * the message with the dedupe suffix ([padAnnouncement]) and emits it to every current subscriber; an
 * empty message is skipped before the counter advances (web `if (!message) return`), and an
 * announcement made with no subscriber is dropped (web drops it with no listener). Safe to call from
 * any thread — the counter is atomic and `tryEmit` over a bounded buffer never blocks.
 */
class BroadcastAnnouncer : Announcer {
    private val counter = AtomicInteger(0)
    private val sink =
        MutableSharedFlow<Announcement>(
            replay = 0,
            extraBufferCapacity = ANNOUNCER_BUFFER,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    override val announcements: Flow<Announcement> = sink

    override fun announce(
        message: String,
        priority: AnnouncePriority,
    ) {
        if (message.isEmpty()) return
        val padded = padAnnouncement(message, counter.incrementAndGet())
        sink.tryEmit(Announcement(padded, priority))
    }
}

/**
 * The process-wide announcer singleton — the native analogue of the web module-level announcer every
 * call-site shares. Host code mounts one `AnnouncerRegion` over this instance and any feature fires
 * announcements through [announce]; a test constructs a throwaway [BroadcastAnnouncer] so the singleton
 * is never polluted across cases.
 */
val ProcessAnnouncer: Announcer = BroadcastAnnouncer()

/**
 * Fires a screen-reader announcement on the process-wide [ProcessAnnouncer] — the native analogue of
 * the web exported `announce(message, priority)`. Safe to call from anywhere; no-ops when no
 * `AnnouncerRegion` is mounted, exactly like the web announcer with no listener.
 */
fun announce(
    message: String,
    priority: AnnouncePriority = AnnouncePriority.Polite,
) {
    ProcessAnnouncer.announce(message, priority)
}
