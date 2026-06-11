//
//  MetricSwitcherChart.Model.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  The surface identity, the diagnostics telemetry seam (P1/S11), the localisation facade (P1/S10),
//  and the `@MainActor` model the view binds through. The model owns the controlled metric selection
//  (the native shape of the web `activeMetric` / `onMetricChange` props), the dataset state (P1/S8),
//  the optional retry callback, and the once-only `view.opened` emission — keeping the view a pure
//  function of `resolved`. The pure value types + projection live in the `.Source` / `.Projection`
//  files; this file holds the stateful + side-effecting concerns.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum MetricSwitcherChartMeta {
    public static let surfaceSlug = "MetricSwitcherChart"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol MetricSwitcherChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMetricSwitcherChartTelemetry: MetricSwitcherChartTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the surface appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum MetricSwitcherChartDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any MetricSwitcherChartTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: MetricSwitcherChartMeta.surfaceSlug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "MetricSwitcherChart" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum MetricSwitcherChartStrings {
    public static let table = "MetricSwitcherChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a caller-supplied ``MetricSwitcherText`` through the facade (localised) or verbatim.
    public static func resolve(_ text: MetricSwitcherText, _ strings: MetricSwitcherResolve = string) -> String {
        switch text {
        case let .localized(key, fallback):
            strings(key, fallback)
        case let .verbatim(value):
            value
        }
    }
}

// MARK: - Model (@MainActor owner of the controlled selection + state)

/// The `@MainActor` model the view binds through — the home for the controlled metric selection (the
/// native shape of the web `activeMetric` / `onMetricChange` props), the dataset state (P1/S8), the
/// optional retry callback, and the once-only `view.opened` emission. The view stays a pure function
/// of `resolved`; this model carries the selection mutation + side effects off the view.
@MainActor
@Observable
public final class MetricSwitcherChartModel {
    public private(set) var state: LoadableState<MetricSwitcherDataset>
    public private(set) var selectedID: String

    @ObservationIgnored public let title: MetricSwitcherText
    @ObservationIgnored public let accessibilityLabel: MetricSwitcherText?
    @ObservationIgnored public let emptyMessage: MetricSwitcherText?
    @ObservationIgnored public let height: Double
    @ObservationIgnored private let onMetricChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let onRetry: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any MetricSwitcherChartTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        title: MetricSwitcherText,
        state: LoadableState<MetricSwitcherDataset>,
        activeMetric: String = "",
        accessibilityLabel: MetricSwitcherText? = nil,
        emptyMessage: MetricSwitcherText? = nil,
        height: Double = MetricSwitcherChartLayout.defaultHeight,
        onMetricChange: (@MainActor (String) -> Void)? = nil,
        onRetry: (@MainActor () -> Void)? = nil,
        telemetry: any MetricSwitcherChartTelemetry = OSLogMetricSwitcherChartTelemetry()
    ) {
        self.title = title
        self.state = state
        self.accessibilityLabel = accessibilityLabel
        self.emptyMessage = emptyMessage
        self.height = height
        self.onMetricChange = onMetricChange
        self.onRetry = onRetry
        self.telemetry = telemetry
        // Web parity: the pill row reflects the raw `activeMetric` key (a non-matching key highlights
        // nothing), while the chart resolves the fallback. An empty key adopts the first metric so the
        // standalone surface opens with a selection.
        let metrics = state.value?.metrics ?? []
        if activeMetric.isEmpty {
            selectedID = metrics.first?.id ?? ""
        } else {
            selectedID = activeMetric
        }
    }

    /// The view-ready resolved state — recomputed from the dataset state + the current selection.
    public var resolved: MetricSwitcherResolved {
        MetricSwitcherProjection.resolve(
            MetricSwitcherInput.from(state, activeID: selectedID),
            title: title,
            accessibilityLabel: accessibilityLabel,
            emptyMessage: emptyMessage,
            height: height
        )
    }

    /// Whether a retry affordance should be offered (a retry handler was supplied).
    public var canRetry: Bool {
        onRetry != nil
    }

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent).
    public func markAppeared() {
        didEmitOpen = MetricSwitcherChartDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// Selects a metric — the web `onMetricChange(key)`. Ignores unknown keys and no-op reselection so
    /// the host callback fires only on a real change.
    public func select(_ id: String) {
        let metrics = state.value?.metrics ?? []
        guard metrics.contains(where: { $0.id == id }), id != selectedID else { return }
        selectedID = id
        onMetricChange?(id)
    }

    /// Re-requests the data after a failure (the `QueryError` retry affordance).
    public func retry() {
        onRetry?()
    }

    /// Pushes a new dataset state (the parent re-feeding its state holder). Re-resolves the selection
    /// to the first metric when the current key is no longer present.
    public func update(state: LoadableState<MetricSwitcherDataset>) {
        self.state = state
        let metrics = state.value?.metrics ?? []
        if !metrics.contains(where: { $0.id == selectedID }), let first = metrics.first {
            selectedID = first.id
        }
    }
}
