//
//  PrivacyDataSources.swift
//  TeslaSync — P4-APPLE P7 · page:settings/Privacy (Apple) — Seams
//
//  The injectable boundaries the `PrivacyPageModel` drives so the view layer never touches a
//  persistence service directly (ADR-004). The web `PrivacySection` reads three browser-local
//  stores plus one server flag:
//    - `lib/recentPages` — the recently-viewed-pages LRU (count + clear),
//    - `lib/cookieConsent` — the GDPR consent state (get / set / clear),
//    - `lib/confirmSilence` — the per-action "don't ask again" preference (`clear-recent-pages`),
//    - `useVersionInfo().require_cookie_consent` — the deployment consent-required flag.
//  Each is modeled as a small seam here. Production wires `UserDefaults` (the native peer of the
//  web localStorage surfaces); previews / tests inject deterministic doubles to exercise every
//  state without touching real defaults.
//

import Foundation

// MARK: - Consent state (web `ConsentState`)

/// The GDPR cookie/analytics consent state (web `ConsentState` = `'accepted' | 'declined' |
/// 'unknown'`). The raw value is the stable wire identifier the web persists to localStorage, so a
/// store round-trips it verbatim.
enum AccountPrivacyConsentState: String, CaseIterable, Sendable {
    case accepted
    case declined
    case unknown
}

// MARK: - Recent-pages store (web `lib/recentPages`)

/// The recently-viewed-pages LRU boundary (web `getRecentPages().length` + `clearRecentPages()`).
protocol PrivacyRecentPagesStoring: Sendable {
    /// Current number of stored entries (web `getRecentPages().length`).
    func count() -> Int
    /// Wipes the list (web `clearRecentPages()`).
    func clear()
}

/// `UserDefaults`-backed recent-pages store — the native peer of the web localStorage LRU. The
/// entries are persisted as a `[String]` of route paths under a stable key; `UserDefaults` is
/// thread-safe and the struct holds no mutable Swift state, so `@unchecked Sendable` is sound.
struct UserDefaultsRecentPagesStore: PrivacyRecentPagesStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "io.teslasync.recentPages") {
        self.defaults = defaults
        self.key = key
    }

    func count() -> Int {
        (defaults.array(forKey: key) as? [String])?.count ?? 0
    }

    func clear() {
        defaults.removeObject(forKey: key)
    }
}

/// In-memory recent-pages store for previews / tests, seeded with a representative entry count.
final class AccountPrivacyInMemoryRecentPagesStore: PrivacyRecentPagesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var entries: Int

    init(entries: Int = 12) {
        self.entries = entries
    }

    func count() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    func clear() {
        lock.lock()
        entries = 0
        lock.unlock()
    }
}

// MARK: - Consent store (web `lib/cookieConsent`)

/// The cookie/analytics consent boundary (web `getConsent()` / `setConsent()` / `clearConsent()`).
protocol PrivacyConsentStoring: Sendable {
    /// Current consent state (web `getConsent()`; absent → `.unknown`).
    func current() -> AccountPrivacyConsentState
    /// Records an explicit choice (web `setConsent('accepted' | 'declined')`).
    func set(_ state: AccountPrivacyConsentState)
    /// Resets to undecided so the banner reappears (web `clearConsent()`).
    func clear()
}

/// `UserDefaults`-backed consent store — the native peer of the web localStorage consent record.
struct UserDefaultsConsentStore: PrivacyConsentStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "io.teslasync.cookieConsent") {
        self.defaults = defaults
        self.key = key
    }

    func current() -> AccountPrivacyConsentState {
        guard let raw = defaults.string(forKey: key),
              let state = AccountPrivacyConsentState(rawValue: raw)
        else {
            return .unknown
        }
        return state
    }

    func set(_ state: AccountPrivacyConsentState) {
        defaults.set(state.rawValue, forKey: key)
    }

    func clear() {
        defaults.removeObject(forKey: key)
    }
}

/// In-memory consent store for previews / tests, seeded with a starting state.
final class AccountPrivacyInMemoryConsentStore: PrivacyConsentStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var state: AccountPrivacyConsentState

    init(state: AccountPrivacyConsentState = .unknown) {
        self.state = state
    }

    func current() -> AccountPrivacyConsentState {
        lock.lock()
        defer { lock.unlock() }
        return state
    }

    func set(_ state: AccountPrivacyConsentState) {
        lock.lock()
        self.state = state
        lock.unlock()
    }

    func clear() {
        lock.lock()
        state = .unknown
        lock.unlock()
    }
}

// MARK: - Confirm-silence store (web `lib/confirmSilence`)

/// The per-action "don't ask again" preference boundary (web `isSilenced(key)` / `silence(key)`),
/// scoped to the `clear-recent-pages` action so the destructive clear can skip its confirmation
/// once the user opts in.
protocol PrivacyConfirmSilenceStoring: Sendable {
    /// Whether the user previously opted out of the confirmation (web `isSilenced(silenceKey)`).
    func isSilenced() -> Bool
    /// Records the opt-out (web `silence(silenceKey)`).
    func silence()
}

/// `UserDefaults`-backed silence store keyed by the web `clear-recent-pages` silence key.
struct AccountPrivacyUserDefaultsConfirmSilenceStore: PrivacyConfirmSilenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    init(
        defaults: UserDefaults = .standard,
        key: String = "io.teslasync.confirmSilence.clear-recent-pages"
    ) {
        self.defaults = defaults
        self.key = key
    }

    func isSilenced() -> Bool {
        defaults.bool(forKey: key)
    }

    func silence() {
        defaults.set(true, forKey: key)
    }
}

/// In-memory silence store for previews / tests.
final class AccountPrivacyInMemoryConfirmSilenceStore: PrivacyConfirmSilenceStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var silenced: Bool

    init(silenced: Bool = false) {
        self.silenced = silenced
    }

    func isSilenced() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return silenced
    }

    func silence() {
        lock.lock()
        silenced = true
        lock.unlock()
    }
}

// MARK: - Consent requirement (web `useVersionInfo().require_cookie_consent`)

/// Supplies the deployment-wide "consent collection required" flag (web
/// `Boolean(versionQuery.data?.require_cookie_consent)`), which only switches the consent section's
/// body copy (`bodyOn` vs `bodyOff`) — the controls render regardless so operators can preview the
/// user-facing flow even when consent is gated off.
protocol PrivacyConsentRequirementProviding: Sendable {
    func requiresConsent() async -> Bool
}

/// Default provider — mirrors the web load default of `false` (the flag is off until the version
/// endpoint reports otherwise). The shared KMP `useVersionInfo` binding replaces this in production
/// through the seam (ADR-004).
struct DefaultConsentRequirementProvider: PrivacyConsentRequirementProviding {
    func requiresConsent() async -> Bool { false }
}

/// Deterministic provider for previews / tests — reports a fixed flag.
struct FixedConsentRequirementProvider: PrivacyConsentRequirementProviding {
    let value: Bool
    func requiresConsent() async -> Bool { value }
}
