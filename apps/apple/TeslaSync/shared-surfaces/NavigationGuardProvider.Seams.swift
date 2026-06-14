//
//  NavigationGuardProvider.Seams.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  The dependency seams the provider binds through, kept apart from the coordinator for the lint length
//  budget: the @MainActor silence seam (web `<ConfirmDialog>` `localStorage` allowlist) and its three
//  implementations, the registration token (web unregister fn), the context protocol vended into the
//  environment (web React `NavigationGuardContext`) plus its no-op (web `NOOP_CTX`), and the
//  `EnvironmentValues.navigationGuard` read side (web `useNavigationGuardContext`).
//

import Foundation
import SwiftUI

// MARK: - Silence seam (web `<ConfirmDialog>` `localStorage` allowlist)

/// The "Don't ask again" allowlist the coordinator honors — the native parity of the web
/// `ConfirmDialog` silence (`silenceKey="unsaved-navigation"`). Main-actor isolated (UI-adjacent, like
/// the peer `ConfirmDialogSilenceStore`); previews + tests inject the in-memory store.
@MainActor
public protocol NavigationGuardSilence: AnyObject {
    /// Whether the user previously opted to silence this action key (web `isSilenced`).
    func isSilenced(_ key: String) -> Bool
    /// Persist that the user no longer wants to be asked about this action key (web `silence`).
    func silence(_ key: String)
}

/// `UserDefaults`-backed silence store — the native parity of the web `localStorage` allowlist. Stores
/// a deduped string array under the same versioned key shape (`teslasync:confirm-silence:v1`) so the
/// contract reads identically across platforms.
@MainActor
public final class UserDefaultsNavigationGuardSilence: NavigationGuardSilence {
    public static let storageKey = "teslasync:confirm-silence:v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func isSilenced(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return load().contains(key)
    }

    public func silence(_ key: String) {
        guard !key.isEmpty else { return }
        var set = load()
        guard !set.contains(key) else { return }
        set.insert(key)
        defaults.set(Array(set).sorted(), forKey: Self.storageKey)
    }

    private func load() -> Set<String> {
        let raw = defaults.array(forKey: Self.storageKey) as? [String] ?? []
        return Set(raw)
    }
}

/// In-memory silence store for previews + unit tests. Seeds an optional initial allowlist and records
/// writes so a test can assert the persistence happened exactly once.
@MainActor
public final class InMemoryNavigationGuardSilence: NavigationGuardSilence {
    public private(set) var silenced: Set<String>
    public private(set) var silenceCalls: [String] = []

    public init(silenced: Set<String> = []) {
        self.silenced = silenced
    }

    public func isSilenced(_ key: String) -> Bool {
        guard !key.isEmpty else { return false }
        return silenced.contains(key)
    }

    public func silence(_ key: String) {
        guard !key.isEmpty else { return }
        silenceCalls.append(key)
        silenced.insert(key)
    }
}

/// A silence store that never silences — for hosts that always want the prompt shown.
@MainActor
public final class DisabledNavigationGuardSilence: NavigationGuardSilence {
    public init() {}

    public func isSilenced(_: String) -> Bool {
        false
    }

    public func silence(_: String) {}
}

// MARK: - Registration token (web unregister fn)

/// The handle a consumer holds for a registered guard — the native parity of the function the web
/// `register(entry)` returns. Calling `cancel()` unregisters (web `useEffect` cleanup); the
/// `.navigationGuard(id:isDirty:message:)` modifier manages it automatically.
@MainActor
public final class NavigationGuardRegistrationToken {
    private var unregister: (() -> Void)?

    init(unregister: @escaping () -> Void) {
        self.unregister = unregister
    }

    /// Unregister the guard. Idempotent.
    public func cancel() {
        unregister?()
        unregister = nil
    }
}

// MARK: - Context (web React `NavigationGuardContext`)

/// The context vended to descendants — the native parity of the web `useNavigationGuardContext()`
/// value (`{ register, confirmIfDirty }`). The live `NavigationGuardCoordinator` conforms; descendants
/// outside a provider read the `NoopNavigationGuardContext` (web `NOOP_CTX`).
@MainActor
public protocol NavigationGuardContext: AnyObject, Sendable {
    /// Register a dirty-state guard. Returns a token whose `cancel()` unregisters (web cleanup fn).
    @discardableResult
    func register(_ entry: NavigationGuardEntry) -> NavigationGuardRegistrationToken
    /// Resolve `true` when no guard is dirty; otherwise raise the confirm prompt and resolve to the
    /// user's choice (`true` = discard / navigate; `false` = keep editing). Racing callers share the
    /// in-flight prompt (web `pendingPromiseRef`).
    func confirmIfDirty() async -> Bool
}

/// The no-op context used when no `<NavigationGuardProvider>` is mounted — the native parity of the web
/// `NOOP_CTX`. Lets guarded consumers render inside isolated previews / tests without the full provider
/// tree: registration is inert and `confirmIfDirty()` always proceeds.
@MainActor
public final class NoopNavigationGuardContext: NavigationGuardContext {
    public init() {}

    @discardableResult
    public func register(_: NavigationGuardEntry) -> NavigationGuardRegistrationToken {
        NavigationGuardRegistrationToken {}
    }

    public func confirmIfDirty() async -> Bool {
        true
    }
}

// MARK: - Environment (web React context)

private struct NavigationGuardContextKey: EnvironmentKey {
    static let defaultValue: (any NavigationGuardContext)? = nil
}

public extension EnvironmentValues {
    /// The active navigation-guard context — the read side of the web `useNavigationGuardContext()`.
    /// `nil` outside a ``NavigationGuardProvider`` (resolve to a no-op at the call site).
    var navigationGuard: (any NavigationGuardContext)? {
        get { self[NavigationGuardContextKey.self] }
        set { self[NavigationGuardContextKey.self] = newValue }
    }
}
