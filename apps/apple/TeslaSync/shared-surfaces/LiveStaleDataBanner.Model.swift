//
//  LiveStaleDataBanner.Model.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the live-stale-data banner. The view binds through `LiveStaleDataBannerModel`; no
//  transport monitoring lives in the view. The web `LiveStaleDataBanner` reads `useLiveConnection()`
//  and renders the warning banner once `status === 'disconnected'` has held for longer than two
//  minutes, nothing otherwise. The native model keeps the same contract: a source emits the live status
//  reading (status + when it was entered + the reading's freshness), the model recomputes the resolved
//  projection against an injected clock on every snapshot and every tick (the web `setTimeout`
//  re-check), emits `view.opened` once on mount, and fires a one-shot re-subscribe when the status
//  reading transitions to stale (the P4 leaf "stale → auto-refresh" contract).
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum LiveStaleDataBannerSurface {
    public static let slug = "LiveStaleDataBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol LiveStaleDataBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLiveStaleDataBannerTelemetry: LiveStaleDataBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (live status reading + feed lifecycle)

/// One coalesced reading of the live pipeline — the native mirror of the web `useLiveConnection`
/// result the banner consumes (`status`), plus when the current status was entered (`statusSince`, the
/// peer of the hook's `stateEnteredAtRef`, so the two-minute window is a pure function), an optional
/// feed error (the native error leaf), and the reading's freshness (the P4 leaf axis).
public struct LiveStaleDataBannerInput: Sendable, Equatable {
    /// Web `useLiveConnection().status`.
    public var status: LiveStaleStatus
    /// When the current `status` was entered — the peer of the web hook's `stateEnteredAtRef` /
    /// the banner's `disconnectedSinceRef`. Drives the sustained-outage window for `disconnected`.
    public var statusSince: Date
    /// A hard failure reading the live status (the native error leaf; the web hook never throws).
    public var errorMessage: String?
    /// How fresh this status reading is (P4 leaf axis).
    public var freshness: LiveStaleFreshness

    public init(
        status: LiveStaleStatus = .unknown,
        statusSince: Date = Date(),
        errorMessage: String? = nil,
        freshness: LiveStaleFreshness = .live
    ) {
        self.status = status
        self.statusSince = statusSince
        self.errorMessage = errorMessage
        self.freshness = freshness
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The data payload for the `.stale` phase — the fully-derived warning: the localized title + message
/// (web `t('live.staleBanner.title')` / `t('live.staleBanner.message')`) plus the pre-composed
/// VoiceOver summary. A pure value so the view is a function of it and snapshot tests assert it directly.
public struct LiveStaleDataBannerData: Sendable, Equatable {
    public let title: String
    public let body: String
    public let accessibilitySummary: String

    public init(title: String, body: String, accessibilitySummary: String) {
        self.title = title
        self.body = body
        self.accessibilitySummary = accessibilitySummary
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the stale phase the derived `data`
/// payload is pre-computed and `freshness` drives the chip, so the view is a pure function of this
/// value.
public struct LiveStaleDataBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case healthy
        case stale
        case error(String)
    }

    public let phase: Phase
    public let data: LiveStaleDataBannerData?
    public let freshness: LiveStaleFreshness

    public init(phase: Phase, data: LiveStaleDataBannerData?, freshness: LiveStaleFreshness = .live) {
        self.phase = phase
        self.data = data
        self.freshness = freshness
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

/// Pure projection from the input reading to the resolved view-state — the native port of the web
/// banner's control flow plus the P4 leaf contract:
///   • a feed read failure surfaces as `error`, unless a sustained outage is still observed (which
///     keeps the banner visible behind a transient failure, the P4 leaf contract).
///   • an `unknown` status (the web hook's brand-new, never-connected seed) shows `loading`.
///   • `connected` / `reconnecting` / a sub-threshold `disconnected` are the friendly `healthy` empty
///     leaf — the native improvement over the web component rendering nothing, never a blank box.
///   • a `disconnected` status that has held past the two-minute window renders the warning banner with
///     its pre-composed copy + the freshness axis.
/// Unit tested across every branch.
public enum LiveStaleDataBannerProjection {
    public static func resolve(
        input: LiveStaleDataBannerInput,
        now: Date,
        threshold: TimeInterval = LiveStaleWindow.threshold,
        strings: LiveStaleResolve = LiveStaleDataBannerStrings.string
    ) -> LiveStaleDataBannerResolved {
        let outage = LiveStaleWindow.isStale(
            status: input.status,
            since: input.statusSince,
            now: now,
            threshold: threshold
        )
        if let message = input.errorMessage, !message.isEmpty {
            if outage { return banner(input, strings) }
            return LiveStaleDataBannerResolved(phase: .error(message), data: nil, freshness: input.freshness)
        }
        switch input.status {
        case .unknown:
            return LiveStaleDataBannerResolved(phase: .loading, data: nil)
        case .connected, .reconnecting:
            return LiveStaleDataBannerResolved(phase: .healthy, data: nil)
        case .disconnected:
            return outage ? banner(input, strings) : LiveStaleDataBannerResolved(phase: .healthy, data: nil)
        }
    }

    private static func banner(
        _ input: LiveStaleDataBannerInput,
        _ strings: LiveStaleResolve
    ) -> LiveStaleDataBannerResolved {
        let title = LiveStaleMessage.title(strings)
        let body = LiveStaleMessage.message(strings)
        let summary = LiveStaleAccessibility.bannerSummary(
            title: title,
            body: body,
            freshness: input.freshness,
            strings: strings
        )
        return LiveStaleDataBannerResolved(
            phase: .stale,
            data: LiveStaleDataBannerData(title: title, body: body, accessibilitySummary: summary),
            freshness: input.freshness
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `LiveStaleDataBannerSource`, recomputes the
/// resolved projection against the injected clock on every snapshot and every tick (the web
/// `setTimeout` re-check), exposes a render `phase` + the resolved view-state and the `freshness` axis,
/// emits `view.opened` once on mount, and fires a one-shot re-subscribe when the status reading
/// transitions to stale (the P4 leaf "stale → auto-refresh"; re-armed once the reading leaves stale).
@MainActor
@Observable
public final class LiveStaleDataBannerModel {
    public private(set) var resolved = LiveStaleDataBannerResolved(phase: .loading, data: nil)

    public var phase: LiveStaleDataBannerResolved.Phase {
        resolved.phase
    }

    public var data: LiveStaleDataBannerData? {
        resolved.data
    }

    public var freshness: LiveStaleFreshness {
        resolved.freshness
    }

    @ObservationIgnored private let source: any LiveStaleDataBannerSource
    @ObservationIgnored private let telemetry: any LiveStaleDataBannerTelemetry
    @ObservationIgnored private let strings: LiveStaleResolve
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let threshold: TimeInterval
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastInput = LiveStaleDataBannerInput()
    @ObservationIgnored private var lastFreshness: LiveStaleFreshness = .live

    public init(
        source: any LiveStaleDataBannerSource,
        telemetry: any LiveStaleDataBannerTelemetry = OSLogLiveStaleDataBannerTelemetry(),
        strings: @escaping LiveStaleResolve = LiveStaleDataBannerStrings.string,
        clock: @escaping @Sendable () -> Date = { Date() },
        threshold: TimeInterval = LiveStaleWindow.threshold
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        self.clock = clock
        self.threshold = threshold
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveStaleDataBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream live-status feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream reading (chip tap + the stale auto re-subscribe + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Recomputes the resolved state from the last reading against the current clock — the native port
    /// of the web `setTimeout` that promotes the banner once the outage crosses two minutes. Driven by
    /// the view's periodic timer.
    public func tick() {
        recompute()
    }

    private func apply(_ input: LiveStaleDataBannerInput) {
        lastInput = input
        recompute()
        let previous = lastFreshness
        lastFreshness = input.freshness
        if input.freshness == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = LiveStaleDataBannerProjection.resolve(
            input: lastInput,
            now: clock(),
            threshold: threshold,
            strings: strings
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. The web source already calls `t(key, default)`; the fallbacks reproduce those defaults
/// verbatim. Keys live in the "LiveStaleDataBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum LiveStaleDataBannerStrings {
    public static let table = "LiveStaleDataBanner"

    public static let string: LiveStaleResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
