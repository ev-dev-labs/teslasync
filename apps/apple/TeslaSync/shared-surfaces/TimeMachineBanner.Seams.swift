//
//  TimeMachineBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The dependency seams the TimeMachineBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the as-of store (the native parity of the web
//  `useAsOfDate` `?as_of=` URL state), the production source over that store, and the in-memory source
//  for previews / tests.
//
//  Parity note: the web banner owns its anchor through the URL `?as_of=` query parameter — deep-linkable
//  (a shared time-machine URL renders the same historical view on a fresh tab) and validated (malformed
//  values are dropped rather than propagated to the wire). The native app has no URL, so the closest
//  faithful analogue is a persisted, validated anchor store: `UserDefaultsAsOfDateStore` writes the
//  RFC 3339 string under a versioned key so a relaunched session restores the same historical view, and
//  drops a malformed stored value on read exactly as the web parser drops garbage. The view never reads
//  or writes the store directly (P1/S8).
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app uses `DefaultTimeMachineBannerSource` over the
/// as-of store; previews and tests use `InMemoryTimeMachineBannerSource`. The view never touches the
/// anchor persistence — it calls `setAsOf` / `clear` (web `setAsOf` / `clear`) and observes `onUpdate`.
@MainActor
public protocol TimeMachineBannerSource: AnyObject {
    var onUpdate: (@MainActor (TimeMachineInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Writes a new anchor and re-emits (web `setAsOf(iso)`).
    func setAsOf(_ date: Date?)
    /// Clears the anchor back to live state and re-emits (web `clear()`).
    func clear()
}

// MARK: - As-of store (web `useAsOfDate` `?as_of=` URL state)

/// The seam that holds the as-of anchor — the native parity of the web URL `?as_of=` state.
/// `asOf` returns `nil` in live mode (web absent / malformed parameter).
@MainActor
public protocol AsOfDateStore: AnyObject {
    var asOf: Date? { get }
    func setAsOf(_ date: Date?)
}

/// Production store backed by `UserDefaults`, persisting the anchor as an RFC 3339 string under a
/// versioned key so a relaunched session restores the same historical view (the native parity of the
/// web deep-linkable `?as_of=` URL). A malformed stored value is dropped on read, mirroring the web
/// `looksLikeIso` guard that refuses to propagate garbage.
@MainActor
public final class UserDefaultsAsOfDateStore: AsOfDateStore {
    /// The versioned anchor key — the native parity of the web `AS_OF_QUERY_PARAM` URL state.
    public static let storageKey = "teslasync:time-machine:as-of:v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var asOf: Date? {
        guard let raw = defaults.string(forKey: Self.storageKey) else { return nil }
        return TimeMachineRfc3339.parse(raw)
    }

    public func setAsOf(_ date: Date?) {
        guard let date else {
            defaults.removeObject(forKey: Self.storageKey)
            return
        }
        defaults.set(TimeMachineRfc3339.format(date), forKey: Self.storageKey)
    }
}

/// In-memory anchor store for previews + tests. Records the number of writes so the persistence
/// contract can be asserted without touching `UserDefaults`.
@MainActor
public final class InMemoryAsOfDateStore: AsOfDateStore {
    public private(set) var asOf: Date?
    public private(set) var setCount = 0

    public init(asOf: Date? = nil) {
        self.asOf = asOf
    }

    public func setAsOf(_ date: Date?) {
        asOf = date
        setCount += 1
    }
}

// MARK: - Default source (production — over the as-of store)

/// The production source. Reads the as-of store on `start` / `refresh` and writes it on
/// `setAsOf` / `clear`, re-emitting after each — the native parity of the web component reading the
/// `?as_of=` URL state and updating it through the picker. No view logic lives here.
@MainActor
public final class DefaultTimeMachineBannerSource: TimeMachineBannerSource {
    public var onUpdate: (@MainActor (TimeMachineInput) -> Void)?

    private let store: any AsOfDateStore

    public init(store: any AsOfDateStore = UserDefaultsAsOfDateStore()) {
        self.store = store
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    public func setAsOf(_ date: Date?) {
        store.setAsOf(date)
        emit()
    }

    public func clear() {
        store.setAsOf(nil)
        emit()
    }

    private func emit() {
        onUpdate?(TimeMachineInput(asOf: store.asOf))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records the anchor writes, and lets a test push further snapshots via `push(_:)` — so the model
/// contract can be asserted without real persistence.
@MainActor
public final class InMemoryTimeMachineBannerSource: TimeMachineBannerSource {
    public var onUpdate: (@MainActor (TimeMachineInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var setAsOfValues: [Date?] = []
    public private(set) var clearCount = 0

    private let initial: TimeMachineInput?
    private var current: TimeMachineInput?

    public init(initial: TimeMachineInput? = nil) {
        self.initial = initial
        current = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            current = initial
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func setAsOf(_ date: Date?) {
        setAsOfValues.append(date)
        emit(asOf: date)
    }

    public func clear() {
        clearCount += 1
        emit(asOf: nil)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: TimeMachineInput) {
        current = input
        onUpdate?(input)
    }

    private func emit(asOf: Date?) {
        let base = current ?? TimeMachineInput()
        let next = TimeMachineInput(asOf: asOf, connection: base.connection)
        current = next
        onUpdate?(next)
    }
}

// MARK: - Production factory

public extension TimeMachineBannerModel {
    /// The production model — wires the `UserDefaults`-backed as-of store. The app mounts
    /// `TimeMachineBanner(model: .live())` at the top of its content chrome, the native parity of the
    /// web `<Layout>` mounting the banner above the service-status banner.
    static func live(
        telemetry: any TimeMachineBannerTelemetry = OSLogTimeMachineBannerTelemetry()
    ) -> TimeMachineBannerModel {
        TimeMachineBannerModel(source: DefaultTimeMachineBannerSource(), telemetry: telemetry)
    }
}
