//
//  CookieConsentBanner.Sources.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The dependency seams the CookieConsentBanner view-model binds through (P1/S8), kept apart from the
//  model for the lint length budget: the consent-policy feed protocol (web `useVersionInfo`), the
//  tri-state decision-store protocol (web `lib/cookieConsent`), and the in-memory implementations the
//  previews + unit/UI tests drive. No network, no `UserDefaults`, no bundle access lives in the view —
//  the production app implements these protocols over the shared `/system/version` state holder and the
//  persistent consent store; previews/tests use the in-memory doubles below.
//

import Foundation

// MARK: - Source protocols (P1/S8 seam)

/// The deployment consent-policy feed (web `useVersionInfo`). Production implements this over the
/// shared `/system/version` state holder; previews/tests use `InMemoryConsentPolicySource`. The view
/// never talks to the network. Pushes the current policy on `start` and after every refresh.
@MainActor
public protocol ConsentPolicySource: AnyObject {
    var onUpdate: (@MainActor (ConsentPolicyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The tri-state cookie-consent store (web `lib/cookieConsent`: `getConsent`, `setConsent`,
/// `subscribeConsent`). Pushes the current decision on `start` and after every mutation (incl. the
/// cross-surface Settings → Privacy reset that re-surfaces the banner in production).
@MainActor
public protocol ConsentDecisionStore: AnyObject {
    var onChange: (@MainActor (ConsentDecision) -> Void)? { get set }
    func start()
    func stop()
    /// Records an explicit decision (web `setConsent('accepted' | 'declined')`).
    func set(_ decision: ConsentDecision)
}

// MARK: - In-memory consent-policy source (previews + tests)

/// In-memory policy feed for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`,
/// re-emits the last snapshot on `refresh()`, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryConsentPolicySource: ConsentPolicySource {
    public var onUpdate: (@MainActor (ConsentPolicyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private var snapshot: ConsentPolicyUpdate?

    public init(initial: ConsentPolicyUpdate? = nil) {
        snapshot = initial
    }

    public func start() {
        startCount += 1
        if let snapshot { onUpdate?(snapshot) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        if let snapshot { onUpdate?(snapshot) }
    }

    /// Pushes a snapshot to the bound model and remembers it as the latest (test/preview affordance).
    public func push(_ update: ConsentPolicyUpdate) {
        snapshot = update
        onUpdate?(update)
    }
}

// MARK: - In-memory decision store (previews + tests)

/// In-memory consent store for previews + unit/UI tests. Holds the current decision, pushes it on
/// `start()`, records every `set(_:)`, and lets a test simulate an external change (the production
/// Settings → Privacy reset / cross-tab update) via `external(_:)`.
@MainActor
public final class InMemoryConsentDecisionStore: ConsentDecisionStore {
    public var onChange: (@MainActor (ConsentDecision) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var setCalls: [ConsentDecision] = []

    private var decision: ConsentDecision

    public init(initial: ConsentDecision = .unknown) {
        decision = initial
    }

    public func start() {
        startCount += 1
        onUpdate()
    }

    public func stop() {
        stopCount += 1
    }

    public func set(_ decision: ConsentDecision) {
        setCalls.append(decision)
        self.decision = decision
        onUpdate()
    }

    /// Simulates an external decision change (web `subscribeConsent` firing from another surface).
    public func external(_ decision: ConsentDecision) {
        self.decision = decision
        onUpdate()
    }

    private func onUpdate() {
        onChange?(decision)
    }
}

// MARK: - Recording reporter sink (previews + tests)

/// Records every `setConsentRequirement` value so the reporter-mirroring contract (web
/// `useEffect([requireConsent])`) can be asserted. Lock-guarded so it satisfies the `Sendable`
/// reporter seam under Swift 6 strict concurrency.
public final class RecordingReporterConsentSink: ReporterConsentSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Bool] = []

    public init() {}

    public var values: [Bool] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    public func setConsentRequirement(_ required: Bool) {
        lock.lock()
        storage.append(required)
        lock.unlock()
    }
}
