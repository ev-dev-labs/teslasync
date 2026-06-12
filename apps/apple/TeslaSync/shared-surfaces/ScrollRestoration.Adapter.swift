//
//  ScrollRestoration.Adapter.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The Foundation-only, dependency-light core of the scroll-restoration surface — the SwiftUI parity
//  of components/layout/ScrollRestoration.tsx. The web component is a behavioral primitive: it renders
//  `return null` and, mounted once near the router root, tracks the scrollTop of the scroll container
//  per location key in `sessionStorage`, restores it synchronously on POP (back / forward), and scrolls
//  to the top on PUSH / REPLACE. There is no network and no remote data, so this file ports its
//  building blocks verbatim, each unit-testable in isolation:
//
//    • ScrollRestorationSurface.slug — the P1/S11 diagnostics slug (the web source is anonymous).
//    • ScrollRestorationKey — the per-location key, the verbatim port of `keyFor(pathname, search)`
//      with the same `teslasync.scroll:` storage prefix.
//    • ScrollNavigationAction — the native peer of `useNavigationType()` (POP / PUSH / REPLACE), with
//      the same "only POP restores" rule the web `useLayoutEffect` encodes.
//    • ScrollPositionStore — the seam standing in for `window.sessionStorage`: a session-lifetime store
//      (survives a navigation, not a relaunch — exactly like sessionStorage) with the web `readSaved`
//      finite-number guard, plus the inert ``UnavailableScrollPositionStore`` that reproduces the
//      private-mode / quota-exceeded branch where the web `try/catch` silently degrades.
//    • ScrollSaveThrottle — the native peer of the web `requestAnimationFrame` coalescing in `onScroll`:
//      it accepts at most one write per interval window, with a `reset()` re-arm for the final flush.
//
//  No SwiftUI, no @Observable model, no networking — the live model + the views live in the sibling
//  files. The web source has no loading / empty / error / stale / offline data states (it reads no
//  remote data); its REAL branches are navigation-driven (POP-restore vs. PUSH/REPLACE-top, a finite
//  saved offset vs. none, and the storage-available vs. storage-disabled degrade). This surface
//  reproduces exactly those — inventing fetch chrome would contradict the source.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web source is anonymous (it renders `null` and has no slug of its own); the prompt assigns this
/// surface the canonical slug `ScrollRestoration`, kept here (SwiftUI-free) so the state-holder can
/// emit telemetry without depending on the view layer.
public enum ScrollRestorationSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ScrollRestoration"
}

// MARK: - ScrollRestorationKey (web `keyFor(pathname, search)`)

/// The per-location storage key — the native peer of the web `keyFor(pathname, search)`. It pairs the
/// route `path` (the native peer of `location.pathname`) with its `search` (the native peer of
/// `location.search`, e.g. a serialized query string), and serializes to the same
/// `teslasync.scroll:{path}{search}` form the web component writes to `sessionStorage`. Value-typed,
/// `Hashable` so the in-memory session store can key on it directly (the native peer of the string
/// `sessionStorage` key).
public struct ScrollRestorationKey: Hashable, Sendable {
    /// The storage-key prefix — the verbatim port of the web `STORAGE_PREFIX`.
    public static let storagePrefix = "teslasync.scroll:"

    /// The route path (web `location.pathname`).
    public let path: String
    /// The route query string (web `location.search`); empty when there is none.
    public let search: String

    public init(path: String, search: String = "") {
        self.path = path
        self.search = search
    }

    /// The serialized storage key — `teslasync.scroll:{path}{search}` (web `keyFor`).
    public var storageKey: String {
        "\(Self.storagePrefix)\(path)\(search)"
    }

    /// Builds the key for a path + search — the ergonomic spelling of the web `keyFor(pathname, search)`.
    public static func keyFor(path: String, search: String = "") -> ScrollRestorationKey {
        ScrollRestorationKey(path: path, search: search)
    }
}

// MARK: - ScrollNavigationAction (web `useNavigationType()`)

/// The kind of navigation that produced the current location — the native peer of React Router's
/// `useNavigationType()` (`"POP" | "PUSH" | "REPLACE"`). The web `useLayoutEffect` restores the saved
/// offset only on `POP` (back / forward) and scrolls to the top on `PUSH` / `REPLACE` (a fresh
/// navigation), which ``restoresSavedOffset`` encodes.
public enum ScrollNavigationAction: String, Sendable, Equatable, CaseIterable {
    /// Back / forward — the user is returning to a prior entry (web `POP`).
    case pop
    /// A fresh navigation pushing a new entry (web `PUSH`).
    case push
    /// A navigation replacing the current entry (web `REPLACE`).
    case replace

    /// Parses the raw `useNavigationType()` value (`"POP"` / `"PUSH"` / `"REPLACE"`), case-insensitively;
    /// an unrecognized value yields `nil` so the caller can fall back to the fresh-navigation default.
    public init?(rawNavigationType raw: String) {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "POP": self = .pop
        case "PUSH": self = .push
        case "REPLACE": self = .replace
        default: return nil
        }
    }

    /// Whether this navigation restores the saved scroll offset — `true` only for `POP`, the verbatim
    /// port of the web `if (navType === 'POP')` branch (everything else scrolls to the top).
    public var restoresSavedOffset: Bool {
        self == .pop
    }
}

// MARK: - ScrollPositionStore (web `window.sessionStorage`)

/// The seam the model reads / writes scroll offsets through — the native shape of the web
/// `window.sessionStorage`. It is session-lifetime (it survives a navigation but not a process relaunch,
/// exactly like `sessionStorage`), keyed by ``ScrollRestorationKey`` (the native peer of the string
/// storage key), and reports `isAvailable` so the model can surface the degraded branch when the store
/// is unusable (web private-mode / quota-exceeded `catch`). Production + previews use
/// ``SessionScrollPositionStore``; the disabled branch uses ``UnavailableScrollPositionStore``.
@MainActor
public protocol ScrollPositionStore: AnyObject {
    /// The saved offset for a key, or `nil` when nothing is stored or the value is not finite — the
    /// native peer of `readSaved` (which returns `null` unless `Number.isFinite(n)`).
    func offset(forKey key: ScrollRestorationKey) -> Double?
    /// Persists the offset for a key — the native peer of `writeSaved`. A non-finite value is dropped
    /// so a later read can never resurrect it (mirroring the web read-side `Number.isFinite` guard).
    func setOffset(_ offset: Double, forKey key: ScrollRestorationKey)
    /// Whether the store can persist — `false` reproduces the web `try/catch` degrade (sessionStorage
    /// disabled in private mode or quota exceeded), where restoration is silently lost for the session.
    var isAvailable: Bool { get }
}

/// The session-lifetime, in-memory store — the native peer of `window.sessionStorage`. It survives a
/// navigation (the values live for the life of the process / app session) but not a relaunch, exactly
/// like the web `sessionStorage` the component uses. The web read-side `Number.isFinite` guard is
/// reproduced on read: a stored value is returned only when finite, so a `NaN` / `±∞` write can never
/// be restored as a bogus offset.
@MainActor
public final class SessionScrollPositionStore: ScrollPositionStore {
    private var offsets: [ScrollRestorationKey: Double] = [:]

    public init() {}

    public var isAvailable: Bool {
        true
    }

    public func offset(forKey key: ScrollRestorationKey) -> Double? {
        guard let value = offsets[key], value.isFinite else { return nil }
        return value
    }

    public func setOffset(_ offset: Double, forKey key: ScrollRestorationKey) {
        guard offset.isFinite else { return }
        offsets[key] = offset
    }

    /// Drops every saved offset — a test / preview helper (the web `sessionStorage` clears on relaunch).
    public func clear() {
        offsets.removeAll()
    }
}

/// The inert store — the native peer of the web branch where `window.sessionStorage` is unavailable
/// (private mode, disabled storage, quota exceeded). Reads always return `nil` and writes are no-ops, so
/// the surface still scrolls to the top on a fresh navigation but cannot restore a prior offset — the
/// graceful degrade the web `try/catch` blocks encode (the user "just loses scroll restoration").
@MainActor
public final class UnavailableScrollPositionStore: ScrollPositionStore {
    public init() {}

    public var isAvailable: Bool {
        false
    }

    public func offset(forKey _: ScrollRestorationKey) -> Double? {
        nil
    }

    public func setOffset(_: Double, forKey _: ScrollRestorationKey) {}
}

// MARK: - ScrollSaveThrottle (web `requestAnimationFrame` coalescing)

/// The save-rate limiter — the native peer of the web `onScroll` `requestAnimationFrame` coalescing
/// (the web component schedules at most one `writeSaved` per paint regardless of scroll velocity). It
/// accepts a write only when at least `minInterval` seconds have elapsed since the last accepted write,
/// dropping the in-between calls; ``reset()`` re-arms it so the next call is accepted unconditionally —
/// the native peer of the web component's final, un-throttled flush on route change / unmount.
public struct ScrollSaveThrottle: Sendable {
    /// The minimum spacing between accepted writes, in seconds. Defaults to one 60 Hz frame (~16 ms),
    /// the closest fixed-interval analog of "once per animation frame".
    public let minInterval: Double
    private var lastAccepted: Double?

    public init(minInterval: Double = 1.0 / 60.0) {
        self.minInterval = minInterval
    }

    /// Whether a write at monotonic time `now` (seconds) should be accepted. The first call after init
    /// or ``reset()`` always passes; subsequent calls pass only once `minInterval` has elapsed. Accepted
    /// calls advance the window; dropped calls leave it unchanged (so a burst still yields one write).
    public mutating func accept(now: Double) -> Bool {
        if let last = lastAccepted, now - last < minInterval {
            return false
        }
        lastAccepted = now
        return true
    }

    /// Re-arms the throttle so the next ``accept(now:)`` is accepted unconditionally — used before the
    /// final flush on route change / unmount (web cleanup writes the current position un-throttled).
    public mutating func reset() {
        lastAccepted = nil
    }
}
