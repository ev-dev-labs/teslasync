//
//  TeslaAccountSection.Types.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The value types + facades the surface binds through: the P1/S11 diagnostics seam, the P1/S10
//  localization facade, the connectivity axis, the coalesced status snapshot, the resolved
//  presentation + render phase, the mutation error, and the toast. Split out of the model so the file
//  stays focused; all are pure, Sendable, and Foundation-only.
//

import Foundation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here so the model + tests
/// reference it without importing SwiftUI.
public enum TeslaAccountDiagnostics {
    public static let surface = "TeslaAccountSection"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter forwarding to the shared-core diagnostics sink (consent-gated
/// + redacted there).
public protocol TeslaAccountTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogTeslaAccountTelemetry: TeslaAccountTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// The localizer the model + projection take — the web `t(key, default)` reduced to its two
/// arguments, so the pure core never imports the bundle facade.
public typealias TeslaAccountLocalize = (String, String) -> String

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "TeslaAccountSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum TeslaAccountStrings {
    public static let table = "TeslaAccountSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound auth-status feed — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum TeslaAccountConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Status snapshot (web `useAuthStatus` + the pill events + P4 leaf axes)

/// One coalesced snapshot of the surface's status inputs — the native mirror of the web `auth` query
/// (`authenticated`, `expires_at`) plus the `pillDisconnected` state the web derives from the
/// `teslasync:tesla-auth-expired/-recovered` DOM events, plus the P4 leaf loading / error /
/// connectivity axes. `expiresAtRaw` is carried as the raw ISO string so the projection reproduces
/// the web's missing-vs-unparseable distinction.
public struct TeslaAccountStatusInput: Sendable, Equatable {
    public var authenticated: Bool?
    public var expiresAtRaw: String?
    public var pillDisconnected: Bool
    public var now: Date
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TeslaAccountConnection

    public init(
        authenticated: Bool? = nil,
        expiresAtRaw: String? = nil,
        pillDisconnected: Bool = false,
        now: Date = Date(),
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TeslaAccountConnection = .live
    ) {
        self.authenticated = authenticated
        self.expiresAtRaw = expiresAtRaw
        self.pillDisconnected = pillDisconnected
        self.now = now
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Presentation (resolved status content for empty + data phases)

/// The resolved, view-ready status content — the native mirror of the web status row (glyph + label +
/// expiring-soon pill + token-expiry line) plus the action-set selector. Every field is pre-localized
/// + pre-formatted so the view is a pure function of this value. Shared by the `empty` (unknown) and
/// `data` (concrete) phases.
public struct TeslaAccountPresentation: Sendable, Equatable {
    public let statusKind: TeslaAccountStatusKind
    public let isAuthenticated: Bool
    public let statusLabel: String
    public let reconnectBody: String?
    public let expiringSoonDays: Int?
    public let expiringSoonLabel: String?
    public let tokenExpiresLine: String?
    public let accessibilitySummary: String

    public init(
        statusKind: TeslaAccountStatusKind,
        isAuthenticated: Bool,
        statusLabel: String,
        reconnectBody: String?,
        expiringSoonDays: Int?,
        expiringSoonLabel: String?,
        tokenExpiresLine: String?,
        accessibilitySummary: String
    ) {
        self.statusKind = statusKind
        self.isAuthenticated = isAuthenticated
        self.statusLabel = statusLabel
        self.reconnectBody = reconnectBody
        self.expiringSoonDays = expiringSoonDays
        self.expiringSoonLabel = expiringSoonLabel
        self.tokenExpiresLine = tokenExpiresLine
        self.accessibilitySummary = accessibilitySummary
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved render branch. `loading` / `error` are the P4 leaf chrome; `empty` carries the web
/// "auth status unknown" surface (resolved but no concrete `authenticated` value, never blank);
/// `data` carries the concrete connected / disconnected / not-connected surface. Both content phases
/// hold a fully resolved `TeslaAccountPresentation`.
public struct TeslaAccountResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty(TeslaAccountPresentation)
        case data(TeslaAccountPresentation)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

// MARK: - Mutation error (web mutation `onError` → `err.message`)

/// The classified failure of a Tesla-account mutation. The production seam maps the shared `ApiError`
/// to a case so the model needs no transport knowledge: a transport failure becomes `offline`, and
/// anything else becomes `failed(message:)` (web `toast.error(title, err.message)`).
public enum TeslaAccountError: Error, Equatable {
    case offline
    case failed(message: String)
}

// MARK: - Toast (web `useToast().success` / `.error`)

/// The kind of transient toast an account action produces.
public enum TeslaAccountToastKind: Sendable, Equatable {
    case success
    case error
}

/// One transient toast (web `toast.success(title)` / `toast.error(title, detail)`). Carries a fresh id
/// so a repeated identical message still re-triggers the auto-dismissing presentation.
public struct TeslaAccountToast: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let kind: TeslaAccountToastKind
    public let title: String
    public let detail: String

    public init(id: UUID = UUID(), kind: TeslaAccountToastKind, title: String, detail: String = "") {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
    }
}
