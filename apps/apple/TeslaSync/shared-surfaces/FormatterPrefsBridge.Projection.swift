//
//  FormatterPrefsBridge.Projection.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the web
//  `FormatterPrefsBridge` logic wrapped in the P4 leaf contract. The web component renders `null` and
//  only has side effects (resolve locale + precision, apply them to the globals); natively the
//  "never a blank box" treatment turns that invisible bridge into a visible diagnostic of the active
//  formatter prefs while reproducing every meaningful branch:
//    • loading      — the `['settings']` query is in flight → skeleton chrome.
//    • unavailable  — the query failed → a retry tile (the web `QueryError` peer).
//    • usingDefaults— resolved with no user-set locale AND no user-set precision → the friendly
//                     "device defaults" state (the native parity of the web `resolveLocale('') → en-US`
//                     + `decimal_precision ?? 2` fallbacks taking effect with nothing configured).
//    • applied      — resolved with an explicit locale and/or precision → the active-prefs card.
//  The resolved value carries the `FormatterPrefsBridgeApplied` (the values the bridge writes to the
//  globals) for BOTH resolved phases, since the web effect applies the resolved values regardless of
//  whether the user set them. The view is a pure function of this value; every branch is unit tested.
//

import Foundation

// MARK: - Source input (P1/S8 — the settings query + its fetch lifecycle)

/// One coalesced snapshot of the surface's inputs — the `['settings']` fetch lifecycle (web
/// `useSettingsQuery` state), the settings payload slice the bridge reads, and the P4 connectivity
/// bit. The model binds over this; the resolved render is a pure function of it plus the static config.
public struct FormatterPrefsBridgeInput: Sendable, Equatable {
    public var status: FormatterPrefsBridgeStatus
    public var settings: FormatterPrefsBridgeSettings
    public var connection: FormatterPrefsBridgeConnection

    public init(
        status: FormatterPrefsBridgeStatus = .loading,
        settings: FormatterPrefsBridgeSettings = FormatterPrefsBridgeSettings(),
        connection: FormatterPrefsBridgeConnection = .live
    ) {
        self.status = status
        self.settings = settings
        self.connection = connection
    }
}

// MARK: - Static configuration (web non-data constants)

/// The static configuration — the web constants that are not data. `defaultPrecision` is the web
/// `decimal_precision ?? 2` fallback; it defaults to the web value of 2 and is injectable for tests.
public struct FormatterPrefsBridgeConfig: Sendable, Equatable {
    public var defaultPrecision: Int

    public init(defaultPrecision: Int = FormatterPrefsBridgeLimits.defaultPrecision) {
        self.defaultPrecision = defaultPrecision
    }

    public static let `default` = FormatterPrefsBridgeConfig()
}

// MARK: - Applied formatter prefs (the values the bridge writes to the globals)

/// The resolved formatter preferences the bridge applies to the globals — the native parity of the web
/// `setGlobalLocale(resolveLocale(settings.locale))` + `setGlobalPrecision(settings.decimal_precision ??
/// 2)`. `locale` is already the resolved tag (never empty) and `precision` is the raw resolved value
/// (the global setter clamps it, exactly like the web); the view renders these and the model writes
/// them.
public struct FormatterPrefsBridgeApplied: Sendable, Equatable {
    public let locale: String
    public let precision: Int

    public init(locale: String, precision: Int) {
        self.locale = locale
        self.precision = precision
    }
}

// MARK: - Resolved view-state (web side effects + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the rendered body while `offline` decorates the
/// applied card and `connection` drives the freshness chip. A pure value so the view is a function of
/// it and snapshot tests assert it directly.
public struct FormatterPrefsBridgeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Settings query still in flight → skeleton chrome.
        case loading
        /// Query failed → a retry tile (the `QueryError` peer).
        case unavailable
        /// Resolved, nothing configured → the friendly defaults state (carries the resolved defaults).
        case usingDefaults(FormatterPrefsBridgeApplied)
        /// Resolved with an explicit pref → the active-prefs card (carries the resolved values).
        case applied(FormatterPrefsBridgeApplied)
    }

    public let phase: Phase
    public let offline: Bool
    public let connection: FormatterPrefsBridgeConnection

    public init(phase: Phase, offline: Bool, connection: FormatterPrefsBridgeConnection) {
        self.phase = phase
        self.offline = offline
        self.connection = connection
    }

    /// The resolved formatter prefs the bridge should apply — present for BOTH resolved phases (the web
    /// effect applies the resolved values whether or not the user set them), `nil` for the chrome
    /// phases (web effect early-returns while `settings` is undefined). Drives the model's apply step.
    public var applied: FormatterPrefsBridgeApplied? {
        switch phase {
        case let .usingDefaults(value), let .applied(value): value
        case .loading, .unavailable: nil
        }
    }

    /// Whether the surface resolved to a values-bearing state (applied or defaults) — a convenience for
    /// the view + tests.
    public var isResolved: Bool {
        applied != nil
    }
}

// MARK: - Projection (input + config → resolved)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// bridge in order: a failed query surfaces as `unavailable`; an in-flight query as `loading`; a
/// resolved query resolves the locale (web `resolveLocale`) + precision (web `?? 2`) and chooses
/// `applied` when the user set either a locale or a precision, else the `usingDefaults` state. The
/// connectivity bit rides through unchanged for the freshness chip + offline decoration. The `strings`
/// resolver is accepted for signature parity with the other surfaces (the resolved value carries no
/// copy itself — the views localize), so it is currently unused here.
public enum FormatterPrefsBridgeProjection {
    public static func resolve(
        _ input: FormatterPrefsBridgeInput,
        config: FormatterPrefsBridgeConfig = .default,
        strings _: FormatterPrefsBridgeResolve = { _, fallback in fallback }
    ) -> FormatterPrefsBridgeResolved {
        FormatterPrefsBridgeResolved(
            phase: phase(for: input, config: config),
            offline: input.connection == .offline,
            connection: input.connection
        )
    }

    private static func phase(
        for input: FormatterPrefsBridgeInput,
        config: FormatterPrefsBridgeConfig
    ) -> FormatterPrefsBridgeResolved.Phase {
        switch input.status {
        case .failed:
            return .unavailable
        case .loading:
            return .loading
        case .resolved:
            break
        }
        let applied = FormatterPrefsBridgeApplied(
            locale: FormatterPrefsBridgeLocale.resolve(input.settings.locale),
            precision: input.settings.decimalPrecision ?? config.defaultPrecision
        )
        let hasExplicitLocale = FormatterPrefsBridgeLocale.isExplicit(input.settings.locale)
        let hasExplicitPrecision = input.settings.decimalPrecision != nil
        return hasExplicitLocale || hasExplicitPrecision ? .applied(applied) : .usingDefaults(applied)
    }
}
