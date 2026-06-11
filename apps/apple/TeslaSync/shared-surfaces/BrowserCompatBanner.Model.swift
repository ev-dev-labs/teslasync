//
//  BrowserCompatBanner.Model.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the platform-compatibility banner. The view binds through
//  `BrowserCompatBannerModel`; no detection or persistence lives in the view. The web component runs
//  `detectMissingFeatures()` once on mount and reads/writes a sticky localStorage dismissal; the
//  native model keeps the same contract: a source emits the probed capability gap + the persisted
//  dismissal (plus the parent's loading / error / connectivity state), the model derives the resolved
//  banner over it, and `dismiss()` persists through the source. There is intentionally NO re-detection
//  poller — capabilities cannot change inside a running process, exactly as the web detects once.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BrowserCompatBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBrowserCompatBannerTelemetry: BrowserCompatBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound capability snapshot — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip (the probe result is current); `stale` shows it and triggers
/// a one-shot auto-refresh (re-probe); `offline` keeps the last cached probe result on screen.
public enum BrowserCompatConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (probed capabilities + persisted dismissal + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the probed missing-capability set (web
/// `detectMissingFeatures()`), the persisted dismissal flag (web `isCompatWarningDismissed()`), and
/// the parent's lifecycle (`isLoading`, an error message, connectivity). An empty `missing` set means
/// the device is supported, mirroring the web empty array.
public struct BrowserCompatInput: Sendable, Equatable {
    public var missing: [RequiredCapability]
    public var dismissed: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: BrowserCompatConnection

    public init(
        missing: [RequiredCapability] = [],
        dismissed: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: BrowserCompatConnection = .live
    ) {
        self.missing = missing
        self.dismissed = dismissed
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Empty kind (web `if (dismissed || missing.length === 0) return null`)

/// Why the surface is in its empty (non-warning) state — the native split of the two web branches
/// that both render nothing. `compatible` is "no missing capabilities" (web `missing.length === 0`);
/// `acknowledged` is "capabilities are missing but the user dismissed the notice" (web `dismissed`).
/// The P4 leaf contract renders a calm card for each instead of collapsing to a blank box, and the
/// copy stays honest in the acknowledged case.
public enum BrowserCompatEmptyKind: String, Sendable, Equatable, CaseIterable {
    case compatible
    case acknowledged
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the warning render: the missing capabilities the body
/// enumerates. A pure value so the view is a function of it and projection tests assert it directly.
public struct BrowserCompatData: Sendable, Equatable {
    public let missing: [RequiredCapability]

    public init(missing: [RequiredCapability]) {
        self.missing = missing
    }
}

/// The resolved, view-ready state — `phase` selects the body; the `.data` phase carries the derived
/// warning payload and the `.empty` phase carries the empty kind, so the view is a pure function of
/// this value.
public struct BrowserCompatResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: BrowserCompatData?
    public let emptyKind: BrowserCompatEmptyKind?

    public init(phase: Phase, data: BrowserCompatData?, emptyKind: BrowserCompatEmptyKind?) {
        self.phase = phase
        self.data = data
        self.emptyKind = emptyKind
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// banner's render logic: the parent lifecycle (`isLoading`), then the
/// `if (dismissed || missing.length === 0) return null` guard split into the two calm empty kinds,
/// then the active warning. A feed failure surfaces at the leaf as `error`. Unit tested across every
/// branch.
public enum BrowserCompatProjection {
    public static func resolve(input: BrowserCompatInput) -> BrowserCompatResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return BrowserCompatResolved(phase: .error(message), data: nil, emptyKind: nil)
        }
        if input.isLoading {
            return BrowserCompatResolved(phase: .loading, data: nil, emptyKind: nil)
        }
        // Web `missing.length === 0` → the device is supported (calm "compatible" card).
        if input.missing.isEmpty {
            return BrowserCompatResolved(phase: .empty, data: nil, emptyKind: .compatible)
        }
        // Web `dismissed` → the user acknowledged the gap (calm "acknowledged" card, honest copy).
        if input.dismissed {
            return BrowserCompatResolved(phase: .empty, data: nil, emptyKind: .acknowledged)
        }
        // Missing capabilities, not dismissed → the active warning (web `<AlertBanner variant="warning">`).
        return BrowserCompatResolved(
            phase: .data,
            data: BrowserCompatData(missing: input.missing),
            emptyKind: nil
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `BrowserCompatBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// emits the `view.opened` diagnostics event once, persists dismissal through the source (web
/// `dismissCompatWarning()`), and auto-refreshes a single time when the feed transitions to stale.
@MainActor
@Observable
public final class BrowserCompatBannerModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the canonical source of truth, re-exposed by
    /// the `BrowserCompatBanner` view so the pure core stays self-contained.
    public static let surfaceSlug = "BrowserCompatBanner"

    public private(set) var resolved: BrowserCompatResolved = .init(
        phase: .loading,
        data: nil,
        emptyKind: nil
    )
    public private(set) var connection: BrowserCompatConnection = .live

    public var phase: BrowserCompatResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any BrowserCompatBannerSource
    @ObservationIgnored private let telemetry: any BrowserCompatBannerTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BrowserCompatBannerSource,
        telemetry: any BrowserCompatBannerTelemetry = OSLogBrowserCompatBannerTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing (which runs the one-shot capability detection) and emits the `view.opened`
    /// diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot — a re-probe (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Persists the dismissal and re-emits (web `dismissCompatWarning()` + `setDismissed(true)`).
    public func dismiss() {
        source.dismiss()
    }

    private func apply(_ input: BrowserCompatInput) {
        resolved = BrowserCompatProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (re-probe).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "BrowserCompatBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum BrowserCompatBannerStrings {
    public static let table = "BrowserCompatBanner"

    public static let string: BrowserCompatResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
