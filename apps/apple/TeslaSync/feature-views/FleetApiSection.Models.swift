//
//  FleetApiSection.Models.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/admin/components/devtools/FleetApiSection.tsx): the JSON value model
//  that mirrors the `Record<string, unknown>` payloads `apiFetch` returns, the
//  per-tool request envelope (a 1:1 port of `apiFetch(endpoint, method, body)`),
//  the projected DTOs every tool renders (fleet config, public-key status, partner
//  key verification, telemetry errors, vehicle options, onboarding steps), the
//  load / connection / freshness / result enums, and the i18n string resolver.
//  Kept transport- and SwiftUI-free so the adapter (Builder) and these types
//  compile + run headless in the executed unit harness.
//

import Foundation

// MARK: - JSON value (port of the web `unknown` / `Record<string, unknown>`)

/// A decoded JSON value. The web tools receive `apiFetch`'s untyped
/// `Record<string, unknown>` and read fields defensively; this models the same
/// shape so the defensive projections (config, key status, partner verification,
/// telemetry-error extraction, pretty-printing) port verbatim and stay testable.
public indirect enum JSONValue: Sendable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    /// The string payload, or `nil` for any non-string value.
    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// The boolean payload, or `nil` for any non-bool value.
    public var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    /// The numeric payload, or `nil` for any non-number value.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The array payload, or `nil` when the value is not an array.
    public var arrayValue: [JSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }

    /// The object payload, or `nil` when the value is not an object.
    public var objectValue: [String: JSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    /// Whether the value is JSON `null` (the web `data == null` guard).
    public var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    /// Member access for object values (returns `.null` when absent / non-object),
    /// mirroring the web `(obj as Record<string, unknown>)?.[key]` reads.
    public subscript(key: String) -> JSONValue {
        objectValue?[key] ?? .null
    }
}

// MARK: - Tool request envelope (port of `apiFetch(endpoint, method, body)`)

/// HTTP method for a dev-tools request — a port of the web
/// `method: 'GET' | 'POST' | 'DELETE'`.
public enum FleetHTTPMethod: String, Sendable, Equatable {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// One dev-tools request, the native port of `apiFetch(endpoint, method, body)`.
/// `id` is the stable key the model files the resulting `ToolResult` under (one per
/// tool action), so a tool view renders exactly the outcome of its own button.
public struct FleetRequest: Sendable, Equatable, Identifiable {
    public let id: String
    public let endpoint: String
    public let method: FleetHTTPMethod
    public let body: [String: JSONValue]?

    public init(
        id: String,
        endpoint: String,
        method: FleetHTTPMethod = .get,
        body: [String: JSONValue]? = nil
    ) {
        self.id = id
        self.endpoint = endpoint
        self.method = method
        self.body = body
    }
}

// MARK: - Projected DTOs (what the tool views render)

/// The Fleet API configuration card projection (port of the `fleet-api-info` read
/// in `FleetApiConfigTool`).
public struct FleetApiConfigInfo: Sendable, Equatable {
    public var baseURL: String
    public var clientID: String
    public var authenticated: Bool
    public var regions: [String]
    public var hostname: String?

    public init(
        baseURL: String = "",
        clientID: String = "",
        authenticated: Bool = false,
        regions: [String] = [],
        hostname: String? = nil
    ) {
        self.baseURL = baseURL
        self.clientID = clientID
        self.authenticated = authenticated
        self.regions = regions
        self.hostname = hostname
    }
}

/// The local public-key status projection (port of the `public-key-status` read in
/// `PublicKeySetupTool` + the onboarding auto-detect).
public struct PublicKeyStatus: Sendable, Equatable {
    public var configured: Bool
    public var fingerprint: String?
    public var wellKnownURL: String?

    public init(configured: Bool = false, fingerprint: String? = nil, wellKnownURL: String? = nil) {
        self.configured = configured
        self.fingerprint = fingerprint
        self.wellKnownURL = wellKnownURL
    }
}

/// The partner public-key verification projection (port of the `verification`
/// envelope `PartnerPublicKeyTool` reads).
public struct PartnerKeyVerification: Sendable, Equatable {
    public var remoteKeyFound: Bool
    public var matchesLocal: Bool
    public var localKeyConfigured: Bool
    public var publicKeyPEM: String?

    public init(
        remoteKeyFound: Bool = false,
        matchesLocal: Bool = false,
        localKeyConfigured: Bool = false,
        publicKeyPEM: String? = nil
    ) {
        self.remoteKeyFound = remoteKeyFound
        self.matchesLocal = matchesLocal
        self.localKeyConfigured = localKeyConfigured
        self.publicKeyPEM = publicKeyPEM
    }
}

/// One verification status chip (port of the `Badge` row in `PartnerPublicKeyTool`).
public struct PartnerKeyBadge: Sendable, Equatable, Identifiable {
    public var id: String
    public var tone: FleetTone
    public var titleKey: String
    public var fallback: String

    public init(id: String, tone: FleetTone, titleKey: String, fallback: String) {
        self.id = id
        self.tone = tone
        self.titleKey = titleKey
        self.fallback = fallback
    }
}

/// The UI-normalised fleet-telemetry error row (port of the web `TelemetryError`
/// after `extractTelemetryErrors`).
public struct TelemetryErrorRow: Sendable, Equatable, Identifiable {
    public var rowKey: String
    public var timestamp: String
    public var code: String
    public var message: String

    public var id: String {
        rowKey
    }

    public init(rowKey: String, timestamp: String, code: String, message: String) {
        self.rowKey = rowKey
        self.timestamp = timestamp
        self.code = code
        self.message = message
    }
}

/// The result of `extractTelemetryErrors`: the parsed rows plus the `ok` flag that
/// distinguishes "zero errors / healthy" (`ok == true`) from "unrecognised wire
/// shape" (`ok == false`, which surfaces the raw response disclosure).
public struct TelemetryErrorsResult: Sendable, Equatable {
    public var errors: [TelemetryErrorRow]
    public var ok: Bool

    public init(errors: [TelemetryErrorRow] = [], ok: Bool = false) {
        self.errors = errors
        self.ok = ok
    }
}

/// A vehicle option for the tool selectors (port of `useVehicleOptions`).
public struct VehicleOption: Sendable, Equatable, Identifiable {
    public var vin: String
    public var label: String

    public var id: String {
        vin
    }

    public init(vin: String, label: String) {
        self.vin = vin
        self.label = label
    }
}

/// One onboarding wizard step (port of `ONBOARDING_STEPS`). `label`/`detail` carry
/// the canonical English copy; SF Symbol name maps the web lucide icon.
public struct OnboardingStep: Sendable, Equatable, Identifiable {
    public var id: String
    public var label: String
    public var detail: String
    public var systemImage: String

    public init(id: String, label: String, detail: String, systemImage: String) {
        self.id = id
        self.label = label
        self.detail = detail
        self.systemImage = systemImage
    }
}

/// The onboarding progress projection (completed count, total, percent).
public struct OnboardingProgress: Sendable, Equatable {
    public var completed: Int
    public var total: Int

    public init(completed: Int, total: Int) {
        self.completed = completed
        self.total = total
    }

    /// Completion percentage in 0...100 (web `(completedCount / length) * 100`).
    public var percent: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total) * 100
    }
}

// MARK: - Tone / load / freshness / result enums

/// The accent tone for a tool card icon chip (port of `ICON_COLOR_MAP`).
public enum FleetTone: String, Sendable, Equatable, CaseIterable {
    case cyan, green, purple, amber, red, neutral
}

/// A shared dev-tools query lifecycle (port of the `useQuery` `isLoading`/`error`/
/// `data` triad the `Config` + `PublicKey` cards switch over).
public enum FleetQuery: Sendable, Equatable {
    case loading
    case loaded(JSONValue)
    case failed(String)
}

/// Live-stream connection band (ADR-013). The web section has no offline state;
/// `offline` is the native addition reflected in the freshness chip + cached banner.
public enum FleetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status (ADR-013), extending the web `DataFreshness`
/// fresh/fetching/stale/error model with the native `offline` band.
public enum FleetFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The section shell render branch resolved from the shared queries.
public enum FleetRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The state of one tool's result panel (port of the `ResultPanel` /
/// mutation-state matrix): idle (italic hint), loading, success (pretty JSON),
/// failure (error copy).
public enum ToolResult: Sendable, Equatable {
    case idle(messageKey: String, fallback: String)
    case loading
    case success(JSONValue)
    case failure(String)
}

public extension ToolResult {
    /// Whether a request is in flight (drives the button spinner).
    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    /// Whether the result panel should be shown — the web gates it on
    /// `mutation.data`; the native surface additionally shows the in-flight state.
    var isPresented: Bool {
        if case .idle = self { return false }
        return true
    }
}

/// The five render branches of the telemetry-errors panel (port of
/// `TelemetryErrorsPanel`): idle / loading / error / table / empty.
public enum TelemetryErrorsPhase: Sendable, Equatable {
    case idle
    case loading
    case failed(String)
    case table([TelemetryErrorRow])
    case empty(ok: Bool, raw: JSONValue?)
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback, so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "FleetApiSection" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. The SwiftUI `text(_:_:)` convenience lives in the
/// Model file so this half stays Foundation-only (so the adapter harness can
/// resolve a11y/label copy headless).
public enum FleetApiStrings {
    public static let table = "FleetApiSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ arg: String) -> String {
        String(format: string(key, fallbackFormat), arg)
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
