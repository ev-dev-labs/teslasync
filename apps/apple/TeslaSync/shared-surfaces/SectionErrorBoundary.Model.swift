//
//  SectionErrorBoundary.Model.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the SectionErrorBoundary shared surface. The view binds through
//  `SectionErrorBoundaryModel`; no networking lives in the view. A source emits the coalesced inputs
//  (whether the guarded section caught a render failure, whether it has content to show, the
//  live-connection freshness, plus the parent's loading state); the model derives the render `phase`
//  + the resolved fallback over them, exposes the `connection` axis, forwards the host's retry
//  handler (web `handleRetry`), emits the boundary's `view.opened` + a `sectionFailed` diagnostic on
//  the catch transition (web `componentDidCatch` logging `[ErrorBoundary:name]`), and auto-refreshes
//  once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the surface's product-analytics events. The default logs via `os.Logger`; the production
/// app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated +
/// redacted there). `viewOpened` is the required `view.opened`; `sectionFailed` is the native parity
/// of the web `componentDidCatch` log that correlates the failing boundary by its `name`.
public protocol SectionErrorBoundaryTelemetry: Sendable {
    func viewOpened(surface: String)
    func sectionFailed(surface: String, name: String, reason: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event
/// and the catch as a `section.error.caught` event keyed by the boundary `name` (web
/// `[ErrorBoundary:name]`). The failure reason is logged `.private` so a thrown message never leaks.
public struct OSLogSectionErrorBoundaryTelemetry: SectionErrorBoundaryTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }

    public func sectionFailed(surface _: String, name: String, reason: String) {
        logger.error("section.error.caught name=\(name, privacy: .public) reason=\(reason, privacy: .private)")
    }
}

// MARK: - Input snapshot (caught failure + content + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — whether the guarded section caught a render
/// failure (web `error`, `nil` when healthy), whether it has content to show (`false` selects the
/// friendly empty leaf), the live-connection freshness, plus the parent's `isLoading`. The render is
/// derived purely from this value.
public struct SectionErrorBoundaryInput: Sendable, Equatable {
    public var error: SectionBoundaryError?
    public var hasContent: Bool
    public var connection: SectionBoundaryConnection
    public var isLoading: Bool

    public init(
        error: SectionBoundaryError? = nil,
        hasContent: Bool = true,
        connection: SectionBoundaryConnection = .live,
        isLoading: Bool = false
    ) {
        self.error = error
        self.hasContent = hasContent
        self.connection = connection
        self.isLoading = isLoading
    }

    /// A copy with the caught failure cleared — the native parity of the web `handleRetry` resetting
    /// `hasError` so the guarded children get a chance to re-render.
    public func clearingError() -> SectionErrorBoundaryInput {
        SectionErrorBoundaryInput(
            error: nil,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading
        )
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.caught` phase the derived
/// `fallback` payload is pre-computed so the view is a pure function of this value.
public struct SectionErrorBoundaryResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case content
        case caught
    }

    public let phase: Phase
    public let fallback: SectionBoundaryFallbackContent?

    public init(phase: Phase, fallback: SectionBoundaryFallbackContent?) {
        self.phase = phase
        self.fallback = fallback
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the configured fallback mode) to the resolved
/// view-state. The branch priority is: a caught render failure (`caught` → the fallback, web's whole
/// reason for being) → the parent's initial fetch (`loading`) → the empty leaf (`empty`, never a
/// blank box) → the healthy guarded section (`content`, render the children). Unit tested across
/// every branch.
public enum SectionErrorBoundaryProjection {
    public static func resolve(
        input: SectionErrorBoundaryInput,
        mode: SectionBoundaryFallbackMode
    ) -> SectionErrorBoundaryResolved {
        if let error = input.error {
            return SectionErrorBoundaryResolved(phase: .caught, fallback: mode.content(for: error))
        }
        if input.isLoading {
            return SectionErrorBoundaryResolved(phase: .loading, fallback: nil)
        }
        if !input.hasContent {
            return SectionErrorBoundaryResolved(phase: .empty, fallback: nil)
        }
        return SectionErrorBoundaryResolved(phase: .content, fallback: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `SectionErrorBoundarySource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved fallback and the `connection` axis,
/// forwards the host retry handler (web `handleRetry`), emits the diagnostics events, and
/// auto-refreshes once when the feed transitions to stale. No networking lives here — the data is
/// owned upstream.
@MainActor
@Observable
public final class SectionErrorBoundaryModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Lives on the non-generic model so the generic
    /// `SectionErrorBoundary` view and the tests share one constant.
    public static let surfaceSlug = "SectionErrorBoundary"

    public private(set) var resolved = SectionErrorBoundaryResolved(phase: .loading, fallback: nil)
    public private(set) var connection: SectionBoundaryConnection = .live
    public private(set) var retryCount = 0

    public var phase: SectionErrorBoundaryResolved.Phase {
        resolved.phase
    }

    /// The boundary's correlation name (web `name` prop) — emitted with the catch diagnostic.
    public let name: String

    /// The configured fallback mode (web `fallback` / `fallbackTitle` / default). Gates which
    /// fallback view the surface renders and whether a Retry is offered.
    public let mode: SectionBoundaryFallbackMode

    /// Whether the host wired a retry handler (web optional re-render). The default inline fallback
    /// always offers Retry; this only governs whether tapping it re-attempts upstream work.
    public var canRetry: Bool {
        onRetry != nil
    }

    @ObservationIgnored private let source: any SectionErrorBoundarySource
    @ObservationIgnored private let telemetry: any SectionErrorBoundaryTelemetry
    @ObservationIgnored private let onRetry: (@MainActor () -> Void)?
    @ObservationIgnored private var lastInput = SectionErrorBoundaryInput()
    @ObservationIgnored private var started = false

    public init(
        name: String,
        mode: SectionBoundaryFallbackMode = .inline,
        source: any SectionErrorBoundarySource,
        telemetry: any SectionErrorBoundaryTelemetry = OSLogSectionErrorBoundaryTelemetry(),
        onRetry: (@MainActor () -> Void)? = nil
    ) {
        self.name = name
        self.mode = mode
        self.source = source
        self.telemetry = telemetry
        self.onRetry = onRetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip retry).
    public func refresh() {
        source.refresh()
    }

    /// The native parity of the web `ErrorBoundary.handleRetry`: optimistically clears the caught
    /// failure so the guarded section re-renders, bumps the retry count, invokes the host's retry
    /// handler, and re-requests upstream. If the section fails again the source re-emits the error
    /// and the fallback returns — exactly as the web boundary re-catches a re-thrown render.
    public func retry() {
        retryCount += 1
        if resolved.phase == .caught {
            resolved = SectionErrorBoundaryProjection.resolve(input: lastInput.clearingError(), mode: mode)
        }
        onRetry?()
        source.refresh()
    }

    private func apply(_ input: SectionErrorBoundaryInput) {
        lastInput = input
        let wasCaught = resolved.phase == .caught
        resolved = SectionErrorBoundaryProjection.resolve(input: input, mode: mode)
        if resolved.phase == .caught, !wasCaught {
            telemetry.sectionFailed(
                surface: Self.surfaceSlug,
                name: name,
                reason: input.error?.message ?? ""
            )
        }
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's chrome strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SectionErrorBoundary" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings. The fallback subtitle reuses the web source's own key
/// (`errors.section.subtitle`) for catalog parity.
public enum SectionErrorBoundaryStrings {
    public static let table = "SectionErrorBoundary"

    public static let string: SectionErrorBoundaryResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
