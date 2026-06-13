// Pure, framework-free model + projection + session store + diagnostics for the ScrollRestoration shared
// surface — the native analogue of every decision the web component makes before it touches a scroll
// container (web/src/components/layout/ScrollRestoration.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin controller layer.
//
// What the web source actually does (and therefore the COMPLETE branch set this surface reproduces):
//   • It keys saved scroll offsets by location identity — `keyFor(pathname, search)` → a `sessionStorage`
//     entry. Native mirror: [ScrollRestorationProjection.keyFor] over the navigation route + its serialized
//     arguments (the `useLocation` analogue), and [ScrollPositionStore] as the session-scoped store that
//     survives navigation but not process death (the `sessionStorage` analogue).
//   • On POP (back/forward) it restores the saved offset, or 0 when there is no entry — `readSaved(key) ?? 0`.
//     Native mirror: [ScrollRestorationProjection.restoreTarget] for [NavigationType.Pop] returns the
//     normalized saved offset, or [ScrollRestorationProjection.TOP] when absent (the "empty" branch — a
//     never-scrolled or first-visited destination friendly-defaults to the top, never a blank jump).
//   • On PUSH/REPLACE (a fresh navigation) it always scrolls to the top — what a user expects after tapping a
//     link. Native mirror: [restoreTarget] for [NavigationType.Push]/[NavigationType.Replace] returns [TOP].
//   • `readSaved` rejects a non-finite stored value (`Number.isFinite`). Native mirror:
//     [ScrollRestorationProjection.normalizeOffset] rejects a negative offset — a scroll position is never
//     below the top, so a negative reading is corrupt and treated as absent.
//   • `writeSaved` swallows `sessionStorage` failures (private mode / quota) so a write is never fatal. Native
//     mirror: [ScrollPositionStore.save] coerces the offset to a sane non-negative value and can never throw.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing. It is a router-driven scroll controller whose only inputs are the current location
// key and the navigation type (the web `useLocation` + `useNavigationType`, the native nav route + type).
// Modelling a network lifecycle here would invent behaviour the web spec does not have (honesty covenant: no
// scope narrowing, no silent drift). The four branches above ARE the surface's full state set — pop-restore,
// pop-with-no-entry → top, push/replace → top, and persist-on-scroll — and each is reduced here and asserted
// in the off-device projection test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ScrollRestoration — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.scrollrestoration

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The kind of navigation that produced the current location — the native analogue of react-router's
 * `useNavigationType()`, which returns one of `'POP' | 'PUSH' | 'REPLACE'`. POP is a back/forward traversal
 * (restore the previously saved offset); PUSH and REPLACE are fresh navigations (start at the top).
 */
enum class NavigationType {
    Push,
    Replace,
    Pop,
}

/**
 * Pure decisions the controller makes for a location change — a 1:1 port of the web component's helpers and
 * its two effect bodies (`keyFor`, `readSaved`'s finite guard, and the POP-restore / PUSH-reset branches of
 * the `useLayoutEffect`). Framework-free so the whole restoration contract is covered by the JVM unit gate
 * without a Compose host.
 */
object ScrollRestorationProjection {
    /** Namespace for stored keys — the native analogue of the web `STORAGE_PREFIX = 'teslasync.scroll:'`. */
    const val STORAGE_PREFIX: String = "teslasync.scroll:"

    /** The top of the scroll container — the value a fresh navigation (and an absent entry) resolves to. */
    const val TOP: Int = 0

    /**
     * Builds the storage key for a location, the native analogue of the web `keyFor(pathname, search)`. The
     * [route] is the destination identity (the `pathname` analogue) and [arguments] is its already-serialized
     * argument string (the `search` analogue); together they identify one scrollable location.
     */
    fun keyFor(
        route: String,
        arguments: String,
    ): String = STORAGE_PREFIX + route + arguments

    /**
     * Validates a stored offset — the native analogue of the web `readSaved` `Number.isFinite` guard. A
     * negative value is impossible for a scroll position (the top is zero), so a negative reading is corrupt
     * and treated as "no saved entry" (`null`); a valid non-negative value is returned unchanged.
     */
    fun normalizeOffset(raw: Int?): Int? = raw?.takeIf { it >= TOP }

    /**
     * Clamps an offset before it is written — the native analogue of the web `writeSaved` storing a sane
     * value. A scroll position can never be below the top, so any negative input is pinned to [TOP].
     */
    fun sanitizeForSave(offset: Int): Int = offset.coerceAtLeast(TOP)

    /**
     * The offset the controller restores for this location, the native analogue of the web `useLayoutEffect`
     * body: a POP restores the (normalized) [savedOffset], or [TOP] when there is no valid entry; a PUSH or
     * REPLACE always returns [TOP] (a fresh navigation starts at the top).
     */
    fun restoreTarget(
        navigationType: NavigationType,
        savedOffset: Int?,
    ): Int =
        when (navigationType) {
            NavigationType.Pop -> normalizeOffset(savedOffset) ?: TOP
            NavigationType.Push, NavigationType.Replace -> TOP
        }

    /**
     * Parses the raw value react-router's `useNavigationType()` exposes (`'POP' | 'PUSH' | 'REPLACE'`) into a
     * [NavigationType]. Unknown or absent values fall back to [NavigationType.Push] — the web treats anything
     * that is not an explicit POP as a forward navigation, so an unrecognized value resets to the top. This is
     * the seam a binding layer that observes a string-typed navigation signal can route through.
     */
    fun fromRouterValue(value: String?): NavigationType =
        when (value?.trim()?.uppercase()) {
            "POP" -> NavigationType.Pop
            "REPLACE" -> NavigationType.Replace
            else -> NavigationType.Push
        }
}

/**
 * The session-scoped store of scroll offsets keyed by location — the native analogue of the web component's
 * use of `window.sessionStorage`. Like `sessionStorage`, it survives navigation within a session but not a
 * process restart (it is held in the composition that mounts the surface once near the navigation root). The
 * web read/write helpers swallow storage failures so restoration is never fatal; this in-memory map cannot
 * throw, and every write is clamped to a sane value via [ScrollRestorationProjection.sanitizeForSave].
 *
 * Pure data so the save/restore round-trip is exercised off-device in the projection test; the composable
 * merely calls [save] as the user scrolls and [restore] on a POP.
 */
class ScrollPositionStore {
    private val positions: MutableMap<String, Int> = mutableMapOf()

    /** Records [offset] under [key], clamped to a non-negative value (web `writeSaved`). */
    fun save(
        key: String,
        offset: Int,
    ) {
        positions[key] = ScrollRestorationProjection.sanitizeForSave(offset)
    }

    /** Returns the validated offset stored under [key], or `null` when absent/corrupt (web `readSaved`). */
    fun restore(key: String): Int? = ScrollRestorationProjection.normalizeOffset(positions[key])

    /** Drops every saved offset — the analogue of a fresh session (e.g. a sign-out clearing session state). */
    fun clear() {
        positions.clear()
    }

    /** The number of distinct locations with a saved offset; exposed for the off-device round-trip test. */
    val size: Int get() = positions.size
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the route
 * key nor any scroll offset — so a diagnostics line can never leak which screen a user visited or how far they
 * scrolled it.
 */
object ScrollRestorationDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ScrollRestoration"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
