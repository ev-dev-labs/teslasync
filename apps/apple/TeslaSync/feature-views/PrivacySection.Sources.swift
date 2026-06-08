//
//  PrivacySection.Sources.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The in-memory P1/S8 seam implementations the previews + unit/UI tests drive the
//  surface with. They carry no networking, no `UserDefaults`, and no bundle access — the
//  production app injects real seams over the `/system/version` state holder, the
//  App-Group recents store, the cookie-consent store, and the confirm-silence store; the
//  surface binds through the protocols in `PrivacySection.Model.swift` either way.
//

import Foundation

/// In-memory consent-policy source for previews + tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryPrivacyEnvironmentSource: PrivacyEnvironmentSource {
    public var onUpdate: (@MainActor (PrivacyEnvironmentUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PrivacyEnvironmentUpdate?

    public init(initial: PrivacyEnvironmentUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func push(_ update: PrivacyEnvironmentUpdate) {
        onUpdate?(update)
    }
}

/// In-memory recent-pages store for previews + tests. Seeded with a starting count.
@MainActor
public final class InMemoryRecentPagesStore: RecentPagesStore {
    public var onChange: (@MainActor (Int) -> Void)?
    public private(set) var clearCount = 0

    private var count: Int

    public init(count: Int = 0) {
        self.count = count
    }

    public func start() {
        onChange?(count)
    }

    public func stop() {}

    public func clear() {
        clearCount += 1
        count = 0
        onChange?(0)
    }

    /// Test/preview affordance: simulate an external mutation (web `subscribeRecentPages`).
    public func push(_ value: Int) {
        count = value
        onChange?(value)
    }
}

/// In-memory consent store for previews + tests. Seeded with a starting state.
@MainActor
public final class InMemoryConsentStore: ConsentStore {
    public var onChange: (@MainActor (PrivacyConsentState) -> Void)?
    public private(set) var state: PrivacyConsentState

    public init(state: PrivacyConsentState = .unknown) {
        self.state = state
    }

    public func start() {
        onChange?(state)
    }

    public func stop() {}

    public func set(_ state: PrivacyConsentState) {
        self.state = state
        onChange?(state)
    }

    public func reset() {
        state = .unknown
        onChange?(.unknown)
    }
}

/// In-memory confirm-silence store for previews + tests.
@MainActor
public final class PrivacySectionInMemoryConfirmSilenceStore: ConfirmSilenceStore {
    private var silenced: Set<String>

    public init(silenced: Set<String> = []) {
        self.silenced = silenced
    }

    public func isSilenced(_ key: String) -> Bool {
        silenced.contains(key)
    }

    public func silence(_ key: String) {
        silenced.insert(key)
    }
}
