//
//  StatusBar.Copy.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The P1/S10 i18n facade for the status bar. `StatusBarStrings` resolves the surface's copy by key with
//  the English fallback so the Swift sources hold no hardcoded prose. Keys mirror the web `statusBar.*`
//  namespace VERBATIM (plus the shared `shortcuts.*` / `tour.*` / `feedback.*` / `changelog.*` keys the Help
//  and Version segments reuse); they fold into the app `Localizable.xcstrings` catalog at integration time.
//  In test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the projection
//  deterministic.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "StatusBar" table, folded into the app `Localizable.xcstrings` master catalog at
/// integration time; kept in a per-surface table so each parallel surface prompt owns its own strings.
public enum StatusBarStrings {
    /// The per-surface strings table name.
    public static let table = "StatusBar"

    /// Resolves `key` in the surface table, returning `fallback` when the catalog has no entry.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The surface's i18n closure — routes every lookup through the same facade so it localizes alongside
    /// the rest of the catalog. `@Sendable` for the Foundation-only core under strict concurrency.
    public static let localize: StatusBarLocalize = { key, fallback in
        string(key, fallback)
    }
}
