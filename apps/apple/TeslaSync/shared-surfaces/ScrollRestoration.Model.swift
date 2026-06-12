//
//  ScrollRestoration.Model.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  scroll-restoration surface — the live core of the SwiftUI parity of
//  components/layout/ScrollRestoration.tsx.
//
//  The web component reads two hooks — `useLocation()` (pathname + search) and `useNavigationType()`
//  (POP / PUSH / REPLACE) — and owns a `useRef` to the current key plus the scroll listener that writes
//  to `sessionStorage`. The native peers live here:
//
//    • ScrollRestorationLocation + ScrollRestorationSource — the P1/S8 binding seam: the native shape of
//      `useLocation()` + `useNavigationType()`. The view never reads the router directly; the companion
//      observes this source and drives the model on each route change.
//    • ScrollRestorationModel — the `@MainActor @Observable` coordinator. It owns the session store, the
//      rAF-peer throttle and the live offset, emits `view.opened` once, runs the restore decision on
//      each navigation (web `useLayoutEffect`), and persists the scroll offset as the user scrolls (web
//      throttled `onScroll`) with a final flush on route change (web effect cleanup). All side effects
//      live here so the SwiftUI layer stays a pure function of the published `phase` + `restoreToken`.
//    • ScrollRestorationStrings — the P1/S10 facade. The web source is anonymous (it renders `null` and
//      calls no `t()`), so every key here backs the NATIVE status surface + accessibility wording the
//      P4 "render every state" contract requires; production restoration itself needs no copy.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — native status chrome (web source is anonymous)

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web `ScrollRestoration` renders `null` and calls no `t()`, so these keys do not
/// mirror web copy — they back the NATIVE status surface, the phase chip, the degraded banner, and the
/// VoiceOver wording that satisfy the P4 "render every state" + accessibility contract. Keys live in the
/// "ScrollRestoration" table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping projections
/// deterministic.
public enum ScrollRestorationStrings {
    public static let table = "ScrollRestoration"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ScrollRestorationTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogScrollRestorationTelemetry: ScrollRestorationTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ScrollRestorationLocation (web `useLocation()` pathname + search)

/// The current route's identity for restoration purposes — the native peer of the subset of
/// `useLocation()` the web component reads: `pathname` + `search`. Two locations with the same path +
/// search share a saved offset (web keys on `pathname + search`).
public struct ScrollRestorationLocation: Hashable, Sendable {
    /// The route path (web `location.pathname`).
    public let path: String
    /// The route query string (web `location.search`); empty when there is none.
    public let search: String

    public init(path: String, search: String = "") {
        self.path = path
        self.search = search
    }

    /// The restoration key for this location (web `keyFor(pathname, search)`).
    public var key: ScrollRestorationKey {
        ScrollRestorationKey(path: path, search: search)
    }

    /// The serialized storage key — a stable, `Equatable` token the companion observes for route changes.
    public var storageKey: String {
        key.storageKey
    }
}

// MARK: - ScrollRestorationSource (P1/S8) — web `useLocation()` + `useNavigationType()`

/// The binding seam the model reads the current location + navigation type through — the native shape of
/// the web `useLocation()` + `useNavigationType()` hooks. The production app implements this over the
/// app router's current route + the navigation action that produced it; previews + tests drive a
/// ``StaticScrollRestorationSource``. The view never reads the router directly.
@MainActor
public protocol ScrollRestorationSource: AnyObject {
    /// The current location (web `useLocation()` — pathname + search).
    var location: ScrollRestorationLocation { get }
    /// The navigation type that produced the current location (web `useNavigationType()`).
    var navigationAction: ScrollNavigationAction { get }
}

/// The controlled / production source — an `@Observable` holder the composition root pushes route
/// changes into (the native parity of the web parent re-rendering under a new `useLocation()`), and that
/// previews + tests drive directly. SwiftUI observation makes the companion react to ``navigate(to:
/// action:)`` exactly as the web effect re-runs when `location` changes.
@MainActor
@Observable
public final class StaticScrollRestorationSource: ScrollRestorationSource {
    public private(set) var location: ScrollRestorationLocation
    public private(set) var navigationAction: ScrollNavigationAction

    public init(
        location: ScrollRestorationLocation,
        navigationAction: ScrollNavigationAction = .push
    ) {
        self.location = location
        self.navigationAction = navigationAction
    }

    /// Pushes a new location + action — the parity of a route change under the surface. The companion
    /// observes the change and runs the restore decision.
    public func navigate(to location: ScrollRestorationLocation, action: ScrollNavigationAction) {
        self.location = location
        navigationAction = action
    }

    /// Convenience: a fresh PUSH navigation to a path (web nav-link click).
    public func push(path: String, search: String = "") {
        navigate(to: ScrollRestorationLocation(path: path, search: search), action: .push)
    }

    /// Convenience: a POP navigation back to a path (web back / forward).
    public func pop(path: String, search: String = "") {
        navigate(to: ScrollRestorationLocation(path: path, search: search), action: .pop)
    }
}

// MARK: - ScrollRestorationModel (P1/S8 live coordinator)

/// The surface's observable coordinator — the `@MainActor` owner of the session store, the rAF-peer
/// throttle, the live scroll offset, and the resolved phase. It is the live heart of the web component:
/// it emits `view.opened` once, runs the restore decision on every navigation (web `useLayoutEffect`),
/// persists the scroll offset as the user scrolls (web throttled `onScroll`), and flushes the current
/// offset before the route changes (web effect cleanup). The view binds to `phase` for the status
/// surface and to `restoreToken` + `pendingRestoreOffset` to apply the scroll position; every side
/// effect lives here so no router or storage access leaks into the SwiftUI layer.
@MainActor
@Observable
public final class ScrollRestorationModel {
    /// The resolved restoration phase (drives the status surface). ``ScrollRestorationPhase/preparing``
    /// until the first navigation resolves (web: inert before the first effect).
    public private(set) var phase: ScrollRestorationPhase = .preparing

    /// The key of the current location (web `lastKey` ref). `nil` before the first navigation.
    public private(set) var lastKey: ScrollRestorationKey?

    /// The offset the scroll view should move to after the latest navigation (web `setScrollTop`
    /// argument). The modifier applies it whenever ``restoreToken`` changes.
    public private(set) var pendingRestoreOffset: Double = 0

    /// A monotonically increasing token bumped on every navigation, so the scroll modifier can apply the
    /// pending restore exactly once per navigation (the native trigger for the web `useLayoutEffect`).
    public private(set) var restoreToken = 0

    /// The most recently reported scroll offset (web "current scrollTop"). Persisted under ``lastKey``
    /// on the next accepted throttle tick, and flushed verbatim before the route changes.
    public private(set) var liveOffset: Double = 0

    @ObservationIgnored private let source: any ScrollRestorationSource
    @ObservationIgnored private let store: any ScrollPositionStore
    @ObservationIgnored private let telemetry: any ScrollRestorationTelemetry
    @ObservationIgnored private let now: @MainActor () -> Double
    @ObservationIgnored private var throttle: ScrollSaveThrottle
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any ScrollRestorationSource,
        store: any ScrollPositionStore = SessionScrollPositionStore(),
        telemetry: any ScrollRestorationTelemetry = OSLogScrollRestorationTelemetry(),
        throttle: ScrollSaveThrottle = ScrollSaveThrottle(),
        now: @escaping @MainActor () -> Double = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.source = source
        self.store = store
        self.telemetry = telemetry
        self.throttle = throttle
        self.now = now
    }

    /// Whether the session store can persist offsets — `false` surfaces the degraded branch (web
    /// private-mode / quota-exceeded `try/catch`).
    public var storeIsAvailable: Bool {
        store.isAvailable
    }

    /// The current location's storage key — the stable token the companion observes for route changes
    /// (reading it tracks the underlying observable source).
    public var currentLocationKey: String {
        source.location.storageKey
    }

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent across the
    /// SwiftUI appear / disappear churn).
    public func markAppeared() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: ScrollRestorationSurface.slug)
    }

    /// Runs the restore decision for the current location — the native peer of the web `useLayoutEffect`.
    /// It first flushes the outgoing position under the previous key (web effect cleanup), then reads the
    /// new location + navigation type from the source, resolves the saved offset, projects the decision,
    /// and publishes the new phase + restore target. Returns the decision so callers / tests can assert.
    @discardableResult
    public func onNavigation() -> ScrollRestorationDecision {
        flushCurrentOffset()

        let location = source.location
        let action = source.navigationAction
        let key = location.key
        let saved = store.offset(forKey: key)
        let decision = ScrollRestorationProjection.decide(
            action: action,
            savedOffset: saved,
            isStoreAvailable: store.isAvailable
        )

        phase = decision.phase
        lastKey = key
        pendingRestoreOffset = decision.targetOffset
        liveOffset = decision.targetOffset
        throttle.reset()
        restoreToken &+= 1
        return decision
    }

    /// Records the latest scroll offset and persists it under the current key when the throttle admits
    /// the write — the native peer of the web throttled `onScroll` (`requestAnimationFrame` coalescing).
    /// The live offset is always retained so the next flush captures the true latest position even when
    /// this tick is throttled away.
    public func recordScroll(offset: Double) {
        liveOffset = offset
        guard store.isAvailable, let key = lastKey else { return }
        guard throttle.accept(now: now()) else { return }
        store.setOffset(offset, forKey: key)
    }

    /// Persists the current live offset under the current key unconditionally — the native peer of the
    /// web effect cleanup's final, un-throttled flush before a route change / unmount. No-op when there
    /// is no current key (before the first navigation) or the store is unavailable.
    public func flushCurrentOffset() {
        guard store.isAvailable, let key = lastKey else { return }
        throttle.reset()
        store.setOffset(liveOffset, forKey: key)
    }

    /// The saved offset for a key, reading through the store (web `readSaved`) — a status / test helper.
    public func savedOffset(forKey key: ScrollRestorationKey) -> Double? {
        store.offset(forKey: key)
    }
}
