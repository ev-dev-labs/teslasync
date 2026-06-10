//
//  TOUSettingsModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The testable projection core for the Time-of-Use rate-plan dialog — the faithful port of
//  features/battery/components/TOUSettingsModal.tsx. The web source is a `Modal` wrapping a two-tab
//  form: a "Preset Tariff" tab (a `Select` of three utility rate plans + a JSON preview of the chosen
//  one) and a "Custom JSON" tab (a `Textarea` for a pasted `tou_settings` blob), with a shared `error`
//  line and a Cancel / "Update Rate Plan" footer that POSTs through `useUpdateTOUSettings`. Everything
//  here is pure and dependency-free (Foundation only) so the projection — phase resolution, the
//  `getPayload` validation (preset lookup + the Custom-JSON parse / object-guard / `tou_settings`
//  wrapping), and the submit-result mapping — unit-tests without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `getPayload()` preset branch + `errorNoPreset`     → `TOUSettingsProjection.payload(...)` `.noPreset`.
//    • `getPayload()` custom branch (`trim`/`JSON.parse`/ → `.emptyJSON` / `.invalidJSON` / `.notObject`
//      `typeof === object` / `'tou_settings' in obj`)        + the `tou_settings` pass-through / wrap.
//    • The web always renders the form; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum TOUSettingsSurface {
    public static let slug = "TOUSettingsModal"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the energy-site context the dialog configures. The web reads its
/// `siteId` synchronously from props; the native surface models the site-context load lifecycle here so
/// every prompt-required state renders.
public enum TOUSettingsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// labels when the site context (and its current tariff) may be out of date.
public enum TOUSettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web only ever shows the form; the loading + empty +
/// error envelopes are added so the first-open, no-TOU-site, and context-failure cases never render a
/// blank panel.
public enum TOUSettingsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The two form tabs (web `activeTab` `'preset' | 'custom'`).
public enum TOUSettingsTab: String, Sendable, Equatable, CaseIterable, Identifiable {
    case preset
    case custom

    public var id: String {
        rawValue
    }
}

/// The outcome of the update mutation (web `updateMutation` `onSuccess` / `onError`).
public enum TOUSubmitResult: Sendable, Equatable {
    case success
    case failure(String)
}

// MARK: - Energy-site context (web `siteId` + `useEnergy`)

/// The energy-site context a source resolves: the `energy_site_id` the form POSTs to, its display name,
/// and whether the site is TOU-capable (web `TeslaEnergySite.tou_capable`). The native surface models
/// this as loadable so the dialog can show loading / empty / error before the form.
public struct TOUSettingsContext: Sendable, Equatable {
    public let siteId: Int
    public let siteName: String
    public let touCapable: Bool

    public init(siteId: Int, siteName: String, touCapable: Bool) {
        self.siteId = siteId
        self.siteName = siteName
        self.touCapable = touCapable
    }
}

// MARK: - Submitted payload (web `TOUSettingsPayload`)

/// The validated payload the footer submits — the native parity of the web `{ tou_settings: … }`
/// envelope handed to `useUpdateTOUSettings`. Always a JSON object whose `root` is submitted verbatim.
public struct TOUSettingsPayload: Sendable, Equatable {
    public let root: TOUJSON

    public init(root: TOUJSON) {
        self.root = root
    }

    /// Pretty-prints the payload (web preview `JSON.stringify(settings, null, 2)`).
    public func prettyPrinted() -> String {
        root.prettyPrinted()
    }
}

// MARK: - Validation failure (web `getPayload` `setError(...)`)

/// Why `getPayload` rejected the form — each maps to the exact web `t(key, default)` error copy so the
/// model can localize it for the shared inline error line.
public enum TOUSettingsValidationError: Error, Sendable, Equatable {
    case noPreset
    case emptyJSON
    case notObject
    case invalidJSON

    /// The web i18n key for this error (resolved through P1/S10 by the model).
    public var messageKey: String {
        switch self {
        case .noPreset: "energy.tou.errorNoPreset"
        case .emptyJSON: "energy.tou.errorEmptyJSON"
        case .notObject: "energy.tou.errorNotObject"
        case .invalidJSON: "energy.tou.errorInvalidJSON"
        }
    }

    /// The web English fallback for this error.
    public var messageFallback: String {
        switch self {
        case .noPreset: "Please select a rate plan"
        case .emptyJSON: "Please enter the TOU settings JSON"
        case .notObject: "JSON must be an object"
        case .invalidJSON: "Invalid JSON — please check syntax"
        }
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution and the `getPayload`
/// validation (preset selection + the Custom-JSON parse / object-guard / `tou_settings` wrapping).
public enum TOUSettingsProjection {
    /// Resolves the render phase. Loading shows only before the site context resolves; a resolved
    /// context that is not TOU-capable (or no site at all) shows the empty state; a failure with no
    /// cached context shows the error state; once a context is on hand the form stays on screen
    /// (freshness shown by the chip / banner, a failed reload by the inline error).
    public static func resolvePhase(
        status: TOUSettingsLoadStatus,
        context: TOUSettingsContext?
    ) -> TOUSettingsPhase {
        switch status {
        case .loading:
            return context == nil ? .loading : .content
        case .loaded:
            guard let context else { return .empty }
            return context.touCapable ? .content : .empty
        case let .failed(message):
            return context == nil ? .error(message) : .content
        }
    }

    /// The web `getPayload()`: builds the `{ tou_settings: … }` payload for the active tab, or the
    /// validation error to surface in the shared error line.
    ///
    /// - Parameters:
    ///   - tab: the active tab (web `activeTab`).
    ///   - presetSettings: the selected preset's settings, or `nil` when none is chosen (web
    ///     `PRESETS.find(...)` miss → `errorNoPreset`). Resolved by the caller from the catalog.
    ///   - customJSON: the raw Custom-JSON text (web `customJSON`).
    public static func payload(
        tab: TOUSettingsTab,
        presetSettings: TOUSettingsPayload?,
        customJSON: String
    ) -> Result<TOUSettingsPayload, TOUSettingsValidationError> {
        switch tab {
        case .preset:
            guard let presetSettings else { return .failure(.noPreset) }
            return .success(presetSettings)
        case .custom:
            return customPayload(customJSON)
        }
    }

    /// The Custom-JSON branch of `getPayload`: trim → empty guard → `JSON.parse` → object guard →
    /// pass an envelope that already has `tou_settings` through verbatim, else wrap the object as the
    /// inner `tou_settings` value.
    private static func customPayload(
        _ raw: String
    ) -> Result<TOUSettingsPayload, TOUSettingsValidationError> {
        let trimmed = raw.trimmed
        guard !trimmed.isEmpty else { return .failure(.emptyJSON) }
        switch TOUJSON.parseObject(trimmed) {
        case let .success(object):
            if object.hasKey("tou_settings") {
                return .success(TOUSettingsPayload(root: object))
            }
            return .success(TOUSettingsPayload(root: .object([TOUJSONField("tou_settings", object)])))
        case .failure(.notObject):
            return .failure(.notObject)
        case .failure(.invalidSyntax):
            return .failure(.invalidJSON)
        }
    }
}

// MARK: - Small helpers

extension String {
    /// Whitespace/newline-trimmed copy (web `String.prototype.trim`).
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
