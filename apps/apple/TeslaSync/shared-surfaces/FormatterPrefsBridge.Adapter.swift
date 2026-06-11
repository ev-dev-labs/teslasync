//
//  FormatterPrefsBridge.Adapter.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The testable, dependency-light core for the formatter-preferences bridge — the SwiftUI parity of
//  `components/FormatterPrefsBridge.tsx`. The web component renders `null`; it is a side-effect mount
//  that keeps the module-level number-format globals (`numberFormat._globalLocale` / `_globalPrecision`)
//  in sync with the persisted user settings and refetches the `['settings']` query when a peer fires
//  the `settings.changed` broadcast. Everything in this file is pure (Foundation only): the settings
//  value type, the fetch + connectivity lifecycle, the verbatim ports of the web `resolveLocale`
//  fallback and the `numberFormat` global-setter guards, the process-wide formatter-globals store (the
//  native parity of the JS module globals), the surface metadata (diagnostics slug), and the VoiceOver
//  summary builder. No store wiring, no bundle, no rendered view — each piece is unit tested alone.
//
//  Data sources (web): `useSettings` / `useSettingsQuery` (the `['settings']` query) and
//  `useQueryClient` (the cross-tab refetch on `settings.changed`). Natively these bind through the
//  P1/S8 `FormatterPrefsBridgeSource` + `FormatterPrefsBridgeBroadcast` seams (see Seams).
//

import Foundation
import os

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver. The web bridge
/// renders no copy of its own (it returns `null`); these keys are the native P4 leaf chrome the
/// "never a blank box" treatment adds, all routed through the same facade.
public typealias FormatterPrefsBridgeResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Settings value type (web `AppSettings` subset)

/// The slice of the web `AppSettings` payload this bridge reads — the BCP-47 `locale` tag (web
/// `settings.locale`, optional) and the `decimalPrecision` (web `settings.decimal_precision`, optional
/// off the wire while loading). Both are optional so the projection can reproduce the web `?? 2`
/// default and the `resolveLocale` empty-string fallback exactly.
public struct FormatterPrefsBridgeSettings: Sendable, Equatable {
    /// Web `settings.locale` — a BCP-47 tag (e.g. "en-US", "de-DE"); may be `nil`/empty/whitespace.
    public var locale: String?
    /// Web `settings.decimal_precision` — the number of decimal places; `nil` until the user sets it.
    public var decimalPrecision: Int?

    public init(locale: String? = nil, decimalPrecision: Int? = nil) {
        self.locale = locale
        self.decimalPrecision = decimalPrecision
    }
}

// MARK: - Fetch + connectivity lifecycle (P4 leaf contract)

/// The resolution state of the `['settings']` query backing the bridge — the native shape of the web
/// `useSettingsQuery` lifecycle. `loading` shows the skeleton chrome, `failed` shows the retry chrome,
/// and `resolved` lets the settings payload decide between the applied card and the defaults state.
public enum FormatterPrefsBridgeStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

/// The freshness of the bound settings query — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` (the query past its freshness window) and `offline`
/// show it, the latter over the cached prefs.
public enum FormatterPrefsBridgeConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Fixed limits (verbatim from the web formatter layer)

/// Constants ported from the web formatter layer: the default decimal precision (web
/// `settings.decimal_precision ?? 2`), the precision clamp (web `setGlobalPrecision` →
/// `Math.max(0, Math.min(20, decimals))`), and the locale fallback (web `resolveLocale` → "en-US").
public enum FormatterPrefsBridgeLimits {
    /// Web `?? 2` — the decimal precision used when settings carry none.
    public static let defaultPrecision = 2
    /// Web `Math.max(0, …)` — the minimum decimal precision the global setter allows.
    public static let minPrecision = 0
    /// Web `Math.min(20, …)` — the maximum decimal precision the global setter allows.
    public static let maxPrecision = 20
    /// Web `resolveLocale` / `setGlobalLocale` fallback — the BCP-47 tag used for empty/whitespace.
    public static let fallbackLocale = "en-US"
}

// MARK: - Locale resolution (verbatim port of the web `resolveLocale`)

/// The verbatim port of the web `lib/locale.ts` `resolveLocale`: a non-empty (after trimming) string
/// tag is returned unchanged; `nil`, empty, or whitespace-only input degrades to "en-US" (so an empty
/// `settings.locale` never reaches `Intl`/`Locale` as an invalid tag). `isExplicit` answers the
/// orthogonal question the projection needs — whether the user actually set a locale — which decides
/// the applied-vs-defaults state.
public enum FormatterPrefsBridgeLocale {
    /// Web `resolveLocale(locale)`: return the original tag when it has non-whitespace content, else
    /// the "en-US" fallback. Note the web returns the ORIGINAL (untrimmed) value, so this does too.
    public static func resolve(_ locale: String?) -> String {
        guard let locale, isExplicit(locale) else { return FormatterPrefsBridgeLimits.fallbackLocale }
        return locale
    }

    /// Whether `locale` is a user-set tag (non-`nil`, non-empty after trimming) — the web
    /// `locale.trim().length > 0` predicate, surfaced so the projection can pick the defaults state.
    public static func isExplicit(_ locale: String?) -> Bool {
        guard let locale else { return false }
        return !locale.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Process-wide formatter globals (native parity of the `numberFormat` module globals)

/// The native parity of the web `numberFormat` module globals (`_globalLocale` / `_globalPrecision`):
/// a process-wide, thread-safe holder the app's formatters read and this bridge keeps in sync. The web
/// globals are plain module-level `let`s mutated by `setGlobalLocale` / `setGlobalPrecision`; the
/// native equivalent is a `Sendable`, lock-guarded store so formatters on any queue read a consistent
/// value while the bridge (on the main actor) writes. Defaults and setter guards are reproduced
/// verbatim: locale defaults to "en-US" and empties back to it, precision defaults to 2 and clamps to
/// [0, 20]. The shared instance is the live global; tests construct isolated stores.
public final class FormatterPrefsBridgeStore: Sendable {
    private struct State {
        var locale: String
        var precision: Int
    }

    /// The live process-wide globals — the parity of the single web `numberFormat` module instance.
    public static let shared = FormatterPrefsBridgeStore()

    private let state: OSAllocatedUnfairLock<State>

    public init(
        locale: String = FormatterPrefsBridgeLimits.fallbackLocale,
        precision: Int = FormatterPrefsBridgeLimits.defaultPrecision
    ) {
        state = OSAllocatedUnfairLock(initialState: State(locale: locale, precision: precision))
    }

    /// The current global locale — web `getGlobalLocale()`.
    public var locale: String {
        state.withLock { $0.locale }
    }

    /// The current global precision — web `getGlobalPrecision()`.
    public var precision: Int {
        state.withLock { $0.precision }
    }

    /// Web `setGlobalLocale`: `_globalLocale = locale && locale.trim() ? locale : 'en-US'`.
    public func setLocale(_ locale: String) {
        let normalized = FormatterPrefsBridgeLocale.isExplicit(locale) ? locale : FormatterPrefsBridgeLimits
            .fallbackLocale
        state.withLock { $0.locale = normalized }
    }

    /// Web `setGlobalPrecision`: `_globalPrecision = Math.max(0, Math.min(20, decimals))`.
    public func setPrecision(_ precision: Int) {
        let clamped = min(
            max(FormatterPrefsBridgeLimits.minPrecision, precision),
            FormatterPrefsBridgeLimits.maxPrecision
        )
        state.withLock { $0.precision = clamped }
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum FormatterPrefsBridgeMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FormatterPrefsBridge"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localized parts, so the spoken content is
/// asserted without rendering the view. The applied card voices its title plus the locale and decimal
/// precision as one combined element; the defaults state voices its own title + message.
public enum FormatterPrefsBridgeAccessibility {
    /// The applied card's spoken label — "{title}. {localeLabel} {locale}. {precisionLabel} {precision}".
    public static func appliedLabel(
        title: String,
        localeLabel: String,
        locale: String,
        precisionLabel: String,
        precision: Int
    ) -> String {
        [
            title,
            "\(localeLabel) \(locale)",
            "\(precisionLabel) \(precision)"
        ]
        .filter { !$0.isEmpty }
        .joined(separator: ". ")
    }

    /// A two-part "{title}. {message}" spoken label — used by the defaults + unavailable states.
    public static func titledLabel(title: String, message: String) -> String {
        [title, message].filter { !$0.isEmpty }.joined(separator: ". ")
    }
}
