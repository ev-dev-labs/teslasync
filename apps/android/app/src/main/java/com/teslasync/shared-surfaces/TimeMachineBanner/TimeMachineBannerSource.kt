// The single data port the TimeMachineBanner shared surface binds to — the native analogue of the web source the
// surface reflects (web/src/components/feedback/TimeMachineBanner.tsx: the `useAsOfDate` hook). The web hook holds
// the canonical `?as_of=` URL query parameter — a client-side, app-global RFC 3339 instant (or null in live mode)
// that it reads and writes; it performs NO HTTP. The native platform has no URL to mount that state on, and this
// surface's allowed-files budget forbids adding a shared holder to the DataContainer, so the app-global as-of
// state lives here as a process-singleton holder ([AsOfDateStore]) behind this seam — the faithful native
// equivalent of the URL parameter: one shared value every mount of the banner observes, that survives
// recomposition and that a future P1/S8 promotion can lift into the DataContainer without touching the view.
//
// The view-model depends on this abstraction (the real app-global holder in production, a fake in tests), never on
// a concrete store, so the view performs NO HTTP and owns no state itself (P1/S8 boundary, ADR-002). The contract
// is preserved end to end: only the PII-free [TimeMachineBannerSnapshot] (the as-of instant, never a vehicle id or
// signal payload) crosses this seam. [setAsOf] refuses malformed values exactly as the web hook does (it writes
// nothing the backend `signal.ParseAsOf` would reject); [clear] returns to live.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/TimeMachineBanner) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located holder + factories alongside the namesake
// interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/**
 * The seam the [TimeMachineBannerViewModel] binds to so it depends on an abstraction (the app-global holder ↔ a
 * test fake), never on a concrete store. [asOf] is the cold stream of PII-free [TimeMachineBannerSnapshot]s the
 * surface projects; [setAsOf] / [clear] are the banner's write affordances (web `setAsOf` / `clear`). No HTTP
 * touches the view.
 */
interface TimeMachineBannerSource {
    /** The current as-of anchor as a stream of PII-free [TimeMachineBannerSnapshot]s (web `useAsOfDate().asOf`). */
    fun asOf(): Flow<TimeMachineBannerSnapshot>

    /**
     * Sets the point-in-time anchor (web `setAsOf`). A blank/`null` value returns to live; a malformed value is
     * refused (the wire never receives a non-RFC-3339 string), so callers present a date/time picker that emits a
     * well-formed instant.
     */
    fun setAsOf(iso: String?)

    /** Returns to live mode — web `clear()` / `setAsOf(null)`. */
    fun clear()
}

/**
 * The process-singleton as-of holder — the native equivalent of the web `?as_of=` URL parameter. A single shared
 * [MutableStateFlow] is observed by every mount of the banner (the surface is global, exactly like the web one),
 * survives recomposition, and is the one place the historical anchor is read from and written to.
 */
object AsOfDateStore {
    private val holder = AsOfDateHolder()

    /** A [TimeMachineBannerSource] over the app-global holder; every call shares the one underlying state. */
    fun asTimeMachineBannerSource(): TimeMachineBannerSource = holder.source()
}

/**
 * The app-global as-of state behind [AsOfDateStore] — extracted as an instantiable class so tests can exercise the
 * write-validation contract against a fresh, isolated instance. Holds the RFC 3339 anchor (or `null` in live mode)
 * and enforces the web `useAsOfDate` write rules.
 */
class AsOfDateHolder {
    private val state = MutableStateFlow<String?>(null)

    /** The current anchor as a stream of PII-free [TimeMachineBannerSnapshot]s. */
    fun snapshots(): Flow<TimeMachineBannerSnapshot> = state.map { TimeMachineBannerSnapshot(it) }

    /**
     * Sets the anchor with the web `setAsOf` rules: a blank/`null` value returns to live; a value that is not a
     * well-formed RFC 3339 instant is refused (no write), so the wire only ever sees values the backend accepts.
     */
    fun set(iso: String?) {
        if (iso.isNullOrBlank()) {
            state.value = null
            return
        }
        if (!TimeMachineTime.looksLikeIso(iso)) return
        state.value = iso
    }

    /** Returns to live mode (web `clear()`). */
    fun clear() {
        state.value = null
    }

    /** A [TimeMachineBannerSource] view over this holder. */
    fun source(): TimeMachineBannerSource =
        object : TimeMachineBannerSource {
            override fun asOf(): Flow<TimeMachineBannerSnapshot> = snapshots()

            override fun setAsOf(iso: String?) = set(iso)

            override fun clear() = this@AsOfDateHolder.clear()
        }
}

/**
 * Builds a [TimeMachineBannerSource] from a [feed] provider (+ optional write callbacks) — the host wiring seam
 * used when a caller already has the snapshot flow in hand, and the test double used to drive each state
 * deterministically. Mirrors the contract of the [AsOfDateHolder] adapter above.
 */
fun timeMachineBannerSource(
    onSetAsOf: (String?) -> Unit = {},
    onClear: () -> Unit = {},
    feed: () -> Flow<TimeMachineBannerSnapshot>,
): TimeMachineBannerSource =
    object : TimeMachineBannerSource {
        override fun asOf(): Flow<TimeMachineBannerSnapshot> = feed()

        override fun setAsOf(iso: String?) = onSetAsOf(iso)

        override fun clear() = onClear()
    }
