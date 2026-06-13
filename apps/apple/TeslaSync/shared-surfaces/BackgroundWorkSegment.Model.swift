//
//  BackgroundWorkSegment.Model.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  footer background-work segment. The view binds through ``BackgroundWorkSegmentModel``; no networking
//  lives in the view. The model is the native peer of the web component composed over `useBackgroundJobs`:
//  a ``BackgroundWorkSource`` emits the coalesced snapshot, the model derives the resolved projection
//  (segment + popover), owns the popover open state (the web `useState(open)` + the click-outside / Escape
//  dismissal), closes it when the work drains (the web `useEffect(() => { if (!hasJobs) setOpen(false) })`),
//  and auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol BackgroundWorkTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBackgroundWorkTelemetry: BackgroundWorkTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "BackgroundWorkSegment" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum BackgroundWorkStrings {
    public static let table = "BackgroundWorkSegment"

    public static let string: BackgroundWorkResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``BackgroundWorkSource`` (the native peer of the
/// web `useBackgroundJobs` aggregation), recomputes the resolved projection over each snapshot, exposes a
/// render `phase` + the resolved view-state + the `connection` axis, owns the popover open state (web
/// `useState(open)`), closes it when the work drains (web `useEffect` on `hasJobs`), and auto-refreshes
/// once on a stale transition.
@MainActor
@Observable
public final class BackgroundWorkSegmentModel {
    public private(set) var resolved: BackgroundWorkResolved = .init(phase: .empty, data: nil)
    public private(set) var connection: BackgroundWorkConnection = .live
    /// The running-jobs popover open state — the native peer of the web `const [open, setOpen]`.
    public var isPopoverPresented = false

    public var phase: BackgroundWorkResolved.Phase {
        resolved.phase
    }

    public var data: BackgroundWorkData? {
        resolved.data
    }

    /// Whether any work is in flight — the native peer of the web `hasJobs`. The host can read this to
    /// hide the surface entirely while quiet (the web `if (!hasJobs) return null`), though the surface's
    /// own `.empty` render is the P4 "never a blank box" default.
    public var hasJobs: Bool {
        resolved.data != nil
    }

    @ObservationIgnored private let source: any BackgroundWorkSource
    @ObservationIgnored private let telemetry: any BackgroundWorkTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastSnapshot = BackgroundWorkSnapshot()

    public init(
        source: any BackgroundWorkSource,
        telemetry: any BackgroundWorkTelemetry = OSLogBackgroundWorkTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        recompute()
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once per instance.
    /// Idempotent across the SwiftUI appear/disappear churn — a later ``start()`` after ``stop()`` does
    /// not re-emit.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: BackgroundWorkSurface.slug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream feed (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Opens the running-jobs popover — the native peer of the web `onClick={() => setOpen(o => !o)}`
    /// when closed.
    public func openPopover() {
        guard hasJobs else { return }
        isPopoverPresented = true
    }

    /// Closes the popover — the native peer of the web click-outside / Escape dismissal.
    public func closePopover() {
        isPopoverPresented = false
    }

    /// Toggles the popover — the native peer of the web button `setOpen((o) => !o)`.
    public func togglePopover() {
        if isPopoverPresented {
            isPopoverPresented = false
        } else {
            openPopover()
        }
    }

    private func apply(_ snapshot: BackgroundWorkSnapshot) {
        lastSnapshot = snapshot
        let previous = connection
        connection = snapshot.connection
        recompute()
        // Work drained → close the popover (web `useEffect(() => { if (!hasJobs) setOpen(false) })`).
        if !hasJobs {
            isPopoverPresented = false
        }
        // Stale → one-shot auto-refresh on the transition (re-armed on return to live).
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = BackgroundWorkProjection.resolve(lastSnapshot)
    }
}
