//
//  SkipToContent.Model.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and
//  the pure projection for the skip-navigation surface. The view binds through
//  `SkipToContentModel`; no networking or focus posting lives in the view. The web source binds
//  `useTranslation` and renders one anchor to the `#main-content` landmark; the native model
//  keeps the same data contract — a source emits the registered-landmark snapshot plus the
//  parent's loading / error / connectivity state, the model derives the primary + secondary
//  skip targets over it, and routes each activation to the focus coordinator seam (the native
//  parity of the web `main.focus()` + `scrollIntoView`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying
/// constant.
public protocol SkipToContentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogSkipToContentTelemetry: SkipToContentTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound landmark feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum SkipConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (registered landmarks + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the registered skip landmarks (in
/// registration order, the native mirror of the `#main-content` element being present in the
/// DOM) plus the parent's lifecycle (`isLoading`, an error message, and connectivity).
public struct SkipToContentInput: Sendable, Equatable {
    public var targets: [SkipTarget]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: SkipConnection

    public init(
        targets: [SkipTarget] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: SkipConnection = .live
    ) {
        self.targets = targets
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// The main content landmark — the first `isPrimary` target, else the first registered one.
    /// This is the destination the single web anchor points at (`#main-content`).
    public var primaryTarget: SkipTarget? {
        targets.first { $0.isPrimary } ?? targets.first
    }

    /// The remaining landmarks (everything that is not the resolved primary), in registration
    /// order — rendered as secondary skip links beneath the hero.
    public var secondaryTargets: [SkipTarget] {
        guard let primary = primaryTarget else { return [] }
        return targets.filter { $0.id != primary.id }
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data phase the primary
/// target plus the ordered secondary targets are pre-computed so the view is a pure function of
/// this value.
public struct SkipToContentResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let primary: SkipTarget?
    public let secondary: [SkipTarget]

    public init(phase: Phase, primary: SkipTarget?, secondary: [SkipTarget]) {
        self.phase = phase
        self.primary = primary
        self.secondary = secondary
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// skip link's read-time derivation (which landmark is the main content) plus the P4 leaf
/// contract. Unit tested across loading / empty / error / data and the primary derivation.
public enum SkipToContentProjection {
    public static func resolve(_ input: SkipToContentInput) -> SkipToContentResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return SkipToContentResolved(phase: .error(message), primary: nil, secondary: [])
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return SkipToContentResolved(phase: .loading, primary: nil, secondary: [])
        }
        // Resolved with no landmark registered yet → friendly empty state (never blank), the
        // native peer of the anchor whose `#main-content` target is not yet in the DOM.
        guard let primary = input.primaryTarget else {
            return SkipToContentResolved(phase: .empty, primary: nil, secondary: [])
        }
        return SkipToContentResolved(phase: .data, primary: primary, secondary: input.secondaryTargets)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `SkipToContentSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, routes each skip activation to the focus coordinator (web `main.focus()` parity), and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class SkipToContentModel {
    public private(set) var resolved: SkipToContentResolved =
        .init(phase: .loading, primary: nil, secondary: [])
    public private(set) var connection: SkipConnection = .live

    public var phase: SkipToContentResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any SkipToContentSource
    @ObservationIgnored private let telemetry: any SkipToContentTelemetry
    @ObservationIgnored private let focuser: any SkipFocusing
    @ObservationIgnored private var started = false

    public init(
        source: any SkipToContentSource,
        telemetry: any SkipToContentTelemetry = OSLogSkipToContentTelemetry(),
        focuser: any SkipFocusing = OSLogSkipFocuser()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.focuser = focuser
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SkipToContent.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Routes a skip activation to the focus coordinator — the native parity of the web
    /// `main.focus({ preventScroll: false })` + `scrollIntoView({ block: 'start' })`.
    public func skip(to target: SkipTarget) {
        focuser.focus(target)
    }

    private func apply(_ input: SkipToContentInput) {
        resolved = SkipToContentProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SkipToContent" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum SkipToContentStrings {
    public static let table = "SkipToContent"

    public static let string: SkipResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
