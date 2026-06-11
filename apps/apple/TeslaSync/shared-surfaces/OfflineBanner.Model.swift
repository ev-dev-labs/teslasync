//
//  OfflineBanner.Model.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the offline banner. The view binds through `OfflineBannerModel`; no connectivity
//  monitoring lives in the view. The web `OfflineBanner` reads one boolean (`useOnlineStatus`) and
//  renders the warning banner when it is `false`, nothing when `true`. The native model keeps the same
//  contract: a source emits the connectivity reading plus the probe's load / freshness state, the model
//  derives the resolved banner over it, exposes the render `phase` + the `freshness` axis, and
//  auto-refreshes once when the reading transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum OfflineBannerSurface {
    public static let slug = "OfflineBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol OfflineBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogOfflineBannerTelemetry: OfflineBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (connectivity reading + probe lifecycle)

/// One coalesced snapshot of the surface's inputs — the connectivity reading (the web
/// `useOnlineStatus` boolean; `nil` until the first probe resolves), the probe's lifecycle
/// (`isLoading`, an error message), and the reading's freshness (the P4 leaf axis).
public struct OfflineBannerInput: Sendable, Equatable {
    public var status: OfflineConnectivity?
    public var isLoading: Bool
    public var errorMessage: String?
    public var freshness: OfflineFreshness

    public init(
        status: OfflineConnectivity? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        freshness: OfflineFreshness = .live
    ) {
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.freshness = freshness
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The data payload for the `.offline` phase — the fully-derived warning: the localized title + body
/// (web `t('pwa.offline.title')` / `t('pwa.offline.banner')`) plus the pre-composed VoiceOver summary.
/// A pure value so the view is a function of it and snapshot tests assert it directly.
public struct OfflineBannerData: Sendable, Equatable {
    public let title: String
    public let body: String
    public let accessibilitySummary: String

    public init(title: String, body: String, accessibilitySummary: String) {
        self.title = title
        self.body = body
        self.accessibilitySummary = accessibilitySummary
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the offline phase the derived `data`
/// payload is pre-computed and `freshness` drives the chip, so the view is a pure function of this
/// value.
public struct OfflineBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case online
        case offline
        case error(String)
    }

    public let phase: Phase
    public let data: OfflineBannerData?
    public let freshness: OfflineFreshness

    public init(phase: Phase, data: OfflineBannerData?, freshness: OfflineFreshness = .live) {
        self.phase = phase
        self.data = data
        self.freshness = freshness
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// banner's control flow (`if (online) return null` else the warning banner) plus the P4 leaf contract:
///   • a probe failure surfaces as `error`, unless a connectivity reading is still cached (which stays
///     visible behind a transient failure, the P4 leaf contract).
///   • a cached reading also survives a re-probe `isLoading`; only an unknown reading shows `loading`.
///   • an `online` reading (web `if (online) return null`) is the friendly `online` empty leaf.
///   • an `offline` reading renders the warning banner with its pre-composed copy + the freshness axis.
/// Unit tested across every branch.
public enum OfflineBannerProjection {
    public static func resolve(
        input: OfflineBannerInput,
        strings: OfflineBannerResolve = OfflineBannerStrings.string
    ) -> OfflineBannerResolved {
        if let message = input.errorMessage, !message.isEmpty {
            if let status = input.status {
                return phase(for: status, freshness: input.freshness, strings: strings)
            }
            return OfflineBannerResolved(phase: .error(message), data: nil)
        }
        guard let status = input.status else {
            return OfflineBannerResolved(phase: .loading, data: nil)
        }
        return phase(for: status, freshness: input.freshness, strings: strings)
    }

    private static func phase(
        for status: OfflineConnectivity,
        freshness: OfflineFreshness,
        strings: OfflineBannerResolve
    ) -> OfflineBannerResolved {
        switch status {
        case .online:
            return OfflineBannerResolved(phase: .online, data: nil, freshness: .live)
        case .offline:
            let title = OfflineBannerCopy.title(strings)
            let body = OfflineBannerCopy.banner(strings)
            let summary = OfflineBannerAccessibility.bannerSummary(
                title: title,
                body: body,
                freshness: freshness,
                strings: strings
            )
            return OfflineBannerResolved(
                phase: .offline,
                data: OfflineBannerData(title: title, body: body, accessibilitySummary: summary),
                freshness: freshness
            )
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `OfflineBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `freshness` axis,
/// and auto-refreshes once when the connectivity reading transitions to stale (web has no equivalent;
/// the P4 leaf contract requires the one-shot re-probe).
@MainActor
@Observable
public final class OfflineBannerModel {
    public private(set) var resolved = OfflineBannerResolved(phase: .loading, data: nil)

    public var phase: OfflineBannerResolved.Phase {
        resolved.phase
    }

    public var data: OfflineBannerData? {
        resolved.data
    }

    public var freshness: OfflineFreshness {
        resolved.freshness
    }

    @ObservationIgnored private let source: any OfflineBannerSource
    @ObservationIgnored private let telemetry: any OfflineBannerTelemetry
    @ObservationIgnored private let strings: OfflineBannerResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastFreshness: OfflineFreshness = .live

    public init(
        source: any OfflineBannerSource,
        telemetry: any OfflineBannerTelemetry = OSLogOfflineBannerTelemetry(),
        strings: @escaping OfflineBannerResolve = OfflineBannerStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OfflineBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream connectivity monitor.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream reading (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: OfflineBannerInput) {
        resolved = OfflineBannerProjection.resolve(input: input, strings: strings)
        let previous = lastFreshness
        lastFreshness = input.freshness
        if input.freshness == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "OfflineBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum OfflineBannerStrings {
    public static let table = "OfflineBanner"

    public static let string: OfflineBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
