//
//  NavigationGuardProvider.Model.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  The surface identity, the telemetry seam (P1/S11 `view.opened`), the i18n facade (P1/S10), and the
//  view-ready value types for the navigation-guard provider. The web `NavigationGuardProvider` is a
//  React context that owns a registry of dirty-form guards and renders a warning `<ConfirmDialog>`
//  when a guarded navigation hits a dirty guard. The native model keeps the same split: the pure
//  registry / decision / copy live in the Adapter; this file holds the diagnostics + localization
//  seams and the resolved render state the @Observable coordinator publishes and the presenter binds.
//

import Foundation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum NavigationGuardSurface {
    public static let slug = "NavigationGuardProvider"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol NavigationGuardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogNavigationGuardTelemetry: NavigationGuardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound silence-allowlist feed — the orthogonal connectivity axis rendered as
/// the freshness chip on the confirm card. `live` hides the chip; `stale` / `offline` show it (a
/// previously-silenced action may be out of date when the feed is not live).
public enum NavigationGuardConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Confirm request (web pending `<ConfirmDialog>`)

/// The pending unsaved-changes confirmation — the native parity of the dialog the web provider renders
/// when `confirmIfDirty()` finds a dirty guard. It captures the resolved copy, whether the "Don't ask
/// again" opt-out is offered (web `silenceHonored`), and the freshness of the silence feed. `Equatable`
/// + `Identifiable` by content so the value is deterministic under test (no random id).
public struct NavigationGuardConfirmRequest: Sendable, Equatable, Identifiable {
    public let copy: NavigationGuardConfirmCopy
    public let showsSilenceToggle: Bool
    public let connection: NavigationGuardConnection

    public var id: String {
        copy.title + "\u{1F}" + copy.message
    }

    public init(
        copy: NavigationGuardConfirmCopy,
        showsSilenceToggle: Bool,
        connection: NavigationGuardConnection
    ) {
        self.copy = copy
        self.showsSilenceToggle = showsSilenceToggle
        self.connection = connection
    }
}

// MARK: - Render phase + resolution (web render branches + P4 leaf contract)

/// The presenter's render phase — `idle` and `confirming` are the only phases the live provider
/// produces (web parity: the provider is transparent, rendering `null` for the dialog until a guard
/// blocks). `loading` and `error` round out the P4 leaf contract for the standalone presenter so no
/// surface is ever a blank box.
public enum NavigationGuardPhase: String, Sendable, Equatable, CaseIterable {
    case loading
    case idle
    case confirming
    case error
}

/// The resolved, view-ready state the presenter switches over. A pure value so the presenter is a
/// function of it and snapshot tests assert it directly.
///   • `loading`   — arming chrome (standalone presenter; the live provider never sits here).
///   • `idle`      — nothing to confirm (the friendly empty leaf); the live provider is transparent.
///   • `confirming`— a guard is dirty and the warning prompt is up (the real interactive state).
///   • `failed`    — the silence feed failed (standalone presenter `QueryError` peer).
public enum NavigationGuardResolution: Sendable, Equatable {
    case loading
    case idle(connection: NavigationGuardConnection)
    case confirming(NavigationGuardConfirmRequest)
    case failed(message: String, connection: NavigationGuardConnection)

    /// The render phase selector.
    public var phase: NavigationGuardPhase {
        switch self {
        case .loading: .loading
        case .idle: .idle
        case .confirming: .confirming
        case .failed: .error
        }
    }

    /// The pending confirm request when `confirming`, else `nil`.
    public var request: NavigationGuardConfirmRequest? {
        if case let .confirming(request) = self {
            return request
        }
        return nil
    }

    /// The orthogonal connectivity axis carried by every phase.
    public var connection: NavigationGuardConnection {
        switch self {
        case .loading: .live
        case let .idle(connection): connection
        case let .confirming(request): request.connection
        case let .failed(_, connection): connection
        }
    }

    /// The failure reason when `failed`, else `nil`.
    public var failureMessage: String? {
        if case let .failed(message, _) = self {
            return message
        }
        return nil
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "NavigationGuardProvider" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum NavigationGuardStrings {
    public static let table = "NavigationGuardProvider"

    public static let string: NavigationGuardResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
