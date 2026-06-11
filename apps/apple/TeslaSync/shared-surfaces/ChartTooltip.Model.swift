//
//  ChartTooltip.Model.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the chart value readout. The view binds through `ChartTooltipModel`; no
//  networking lives in the view. The web `ChartTooltip` keeps no state of its own — Recharts
//  feeds it `active` + `payload` + `label` on every hover/focus and the component renders (or
//  renders nothing). The native model keeps the same data contract: a source emits the current
//  selection snapshot plus the parent's loading / error / connectivity state, and the model
//  derives the render phase over it so the view is a pure function of the resolved state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying
/// constant.
public protocol ChartTooltipTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogChartTooltipTelemetry: ChartTooltipTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound readout feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum ChartTooltipConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (current selection + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the current chart selection (`isActive` +
/// `label` + `series`, the native mirror of the web `active` / `label` / `payload`) plus the
/// parent's lifecycle (`isLoading`, an error message, and connectivity).
public struct ChartTooltipInput: Sendable, Equatable {
    public var isActive: Bool
    public var label: ChartTooltipLabel
    public var series: [ChartTooltipSeries]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ChartTooltipConnection

    public init(
        isActive: Bool = false,
        label: ChartTooltipLabel = .absent,
        series: [ChartTooltipSeries] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ChartTooltipConnection = .live
    ) {
        self.isActive = isActive
        self.label = label
        self.series = series
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data phase the label
/// and series are carried through so the view is a pure function of this value.
public struct ChartTooltipResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let label: ChartTooltipLabel
    public let series: [ChartTooltipSeries]

    public init(phase: Phase, label: ChartTooltipLabel, series: [ChartTooltipSeries]) {
        self.phase = phase
        self.label = label
        self.series = series
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// web component's gating (`if (!active || !payload?.length) return null`) plus the P4 leaf
/// contract. The web "render nothing" case becomes the friendly empty state so the surface never
/// collapses to a blank box. Unit tested across loading / empty / error / data.
public enum ChartTooltipProjection {
    public static func resolve(_ input: ChartTooltipInput) -> ChartTooltipResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return ChartTooltipResolved(phase: .error(message), label: .absent, series: [])
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return ChartTooltipResolved(phase: .loading, label: .absent, series: [])
        }
        // Web gate: inactive cursor or empty payload renders nothing → native friendly empty.
        guard input.isActive, !input.series.isEmpty else {
            return ChartTooltipResolved(phase: .empty, label: .absent, series: [])
        }
        return ChartTooltipResolved(phase: .data, label: input.label, series: input.series)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `ChartTooltipSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class ChartTooltipModel {
    public private(set) var resolved: ChartTooltipResolved =
        .init(phase: .loading, label: .absent, series: [])
    public private(set) var connection: ChartTooltipConnection = .live

    public var phase: ChartTooltipResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any ChartTooltipSource
    @ObservationIgnored private let telemetry: any ChartTooltipTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChartTooltipSource,
        telemetry: any ChartTooltipTelemetry = OSLogChartTooltipTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChartTooltip.surfaceSlug)
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

    private func apply(_ input: ChartTooltipInput) {
        resolved = ChartTooltipProjection.resolve(input)
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
/// hardcoded literals. Keys live in the "ChartTooltip" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum ChartTooltipStrings {
    public static let table = "ChartTooltip"

    public static let string: ChartTooltipResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
