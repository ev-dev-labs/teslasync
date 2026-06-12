//
//  VersionSegment.Model.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  footer version segment. The view binds through ``VersionSegmentModel``; no networking lives in the
//  view. The model is the native peer of the web component composed over its two `useQuery` hooks +
//  `useChangelog`: a ``VersionSegmentSource`` emits the coalesced snapshot, the model overlays the
//  build-time provenance, derives the resolved projection (segment + modal), owns the modal open state
//  (the web `useState(open)`), forwards the host's "open changelog" / "open release notes" handlers (web
//  `openChangelogModal()` / `window.open(...)`), and auto-refreshes once when the feed transitions to
//  stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there). The slug is a static, non-identifying constant.
public protocol VersionSegmentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogVersionSegmentTelemetry: VersionSegmentTelemetry {
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
/// literals. Keys live in the "VersionSegment" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum VersionSegmentStrings {
    public static let table = "VersionSegment"

    public static let string: VersionSegmentResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``VersionSegmentSource`` (the native peer of the
/// web `useQuery` + `useChangelog` composition), overlays the build-time provenance (the web module
/// constants), recomputes the resolved projection over the combined input, exposes a render `phase` + the
/// resolved view-state + the `connection` axis, owns the modal open state (web `useState(open)`),
/// forwards the host's "open changelog" / "open release notes" handlers, and auto-refreshes once on a
/// stale transition.
@MainActor
@Observable
public final class VersionSegmentModel {
    public private(set) var resolved: VersionSegmentResolved = .init(phase: .loading, data: nil)
    public private(set) var connection: VersionSegmentConnection = .live
    /// The "About this build" modal open state — the native peer of the web `const [open, setOpen]`.
    public var isModalPresented = false

    public var phase: VersionSegmentResolved.Phase {
        resolved.phase
    }

    public var data: VersionSegmentData? {
        resolved.data
    }

    @ObservationIgnored private let source: any VersionSegmentSource
    @ObservationIgnored private let buildInfo: VersionSegmentBuildInfo
    @ObservationIgnored private let telemetry: any VersionSegmentTelemetry
    @ObservationIgnored private let onOpenChangelog: (@MainActor () -> Void)?
    @ObservationIgnored private let onOpenReleaseNotes: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastSnapshot = VersionSegmentSnapshot()

    public init(
        source: any VersionSegmentSource,
        buildInfo: VersionSegmentBuildInfo = .dev,
        telemetry: any VersionSegmentTelemetry = OSLogVersionSegmentTelemetry(),
        onOpenChangelog: (@MainActor () -> Void)? = nil,
        onOpenReleaseNotes: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.buildInfo = buildInfo
        self.telemetry = telemetry
        self.onOpenChangelog = onOpenChangelog
        self.onOpenReleaseNotes = onOpenReleaseNotes
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
            telemetry.viewOpened(surface: VersionSegmentSurface.slug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream probes (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Opens the "About this build" modal — the native peer of the web `onClick={() => setOpen(true)}`.
    public func openModal() {
        isModalPresented = true
    }

    /// Closes the modal — the native peer of the web `onClose` / the "Close" button `setOpen(false)`.
    public func closeModal() {
        isModalPresented = false
    }

    /// Closes the modal and invokes the host's "open changelog" handler — the native peer of the web
    /// "What's new" button (`setOpen(false); openChangelogModal()`). A no-op handler is the host's choice.
    public func openChangelog() {
        isModalPresented = false
        onOpenChangelog?()
    }

    /// Invokes the host's "open release notes" handler — the native peer of the web "Release notes" button
    /// (`window.open('…/releases', …)`). The host opens ``VersionSegmentSurface/releaseNotesURL``.
    public func openReleaseNotes() {
        onOpenReleaseNotes?()
    }

    private func apply(_ snapshot: VersionSegmentSnapshot) {
        lastSnapshot = snapshot
        let previous = connection
        connection = snapshot.connection
        recompute()
        // Stale → one-shot auto-refresh on the transition (re-armed on return to live).
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = VersionSegmentProjection.resolve(
            VersionSegmentInput(snapshot: lastSnapshot, buildInfo: buildInfo)
        )
    }
}
