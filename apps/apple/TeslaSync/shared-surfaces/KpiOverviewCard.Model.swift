//
//  KpiOverviewCard.Model.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), the
//  diagnostics metadata, and the input value-types for the KPI overview card — the SwiftUI parity of
//  `web/src/components/data-display/KpiOverviewCard.tsx`. The web component is a purely presentational
//  shell (a GlassPanel composing a ComparisonHeader + a KPI grid + an optional secondary line + an
//  optional footer callout); the page computes the numbers and the card supplies a consistent visual
//  shell across overview surfaces (Drives, Charging, Trips, …). The native parity keeps that shell but
//  adds the P4 leaf contract so the surface never collapses to a blank box: a host snapshot carries the
//  header, the KPI tiles, the optional secondary / footer, plus the parent's loading / error /
//  connectivity state, and the projection derives the render phase so the view is a pure function of
//  the resolved state. No networking lives in the view (the web source has none).
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics metadata (P1/S11)

/// Static, non-identifying metadata for the surface. The slug is the `view.opened` event name.
public enum KpiOverviewMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "KpiOverviewCard"
    /// The period-strip separator the web renders between the current and comparison labels.
    public static let periodSeparator = "·"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol KpiOverviewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogKpiOverviewTelemetry: KpiOverviewTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views, the projection, and the
/// accessibility helpers hold no hardcoded user-facing literals.
public typealias KpiOverviewResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the English fallback. The web source renders no
/// translatable copy of its own (the title / period / KPI labels are caller-provided strings), so the
/// keys here are the native chrome: the empty / error / loading states, the freshness chip, and
/// the VoiceOver labels. Keys live in the "KpiOverviewCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum KpiOverviewStrings {
    public static let table = "KpiOverviewCard"

    public static let string: KpiOverviewResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feed — the orthogonal connectivity axis rendered as the freshness chip.
/// `live` hides the chip; `stale` / `offline` show it while the last content stays visible.
public enum KpiOverviewConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - KPI value types (web `MetricCard` / `Delta` / `ComparisonHeader` / `InlineCallout` slots)

/// A direction-aware change indicator — the native mirror of the web `<Delta>`. The page pre-computes
/// the signed `value` (drives the arrow + good/bad colour) and the `formatted` magnitude string
/// (e.g. "5%" / "12 mi"), exactly as the web caller hands `Delta` its numbers; `lowerIsBetter` mirrors
/// the web metric `direction: 'lower_better'`, inverting which sign reads as good.
public struct KpiOverviewDelta: Sendable, Equatable {
    public let value: Double
    public let formatted: String
    public let lowerIsBetter: Bool

    public init(value: Double, formatted: String, lowerIsBetter: Bool = false) {
        self.value = value
        self.formatted = formatted
        self.lowerIsBetter = lowerIsBetter
    }
}

/// One KPI tile — the native mirror of a web `<MetricCard>` child in the grid slot. The page formats
/// the value string (units applied at its own boundary); the optional `delta` is the per-tile change.
public struct KpiOverviewItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let delta: KpiOverviewDelta?

    public init(id: String, label: String, value: String, delta: KpiOverviewDelta? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.delta = delta
    }
}

/// The severity tier of the footer callout — the native mirror of the web `CalloutVariant`.
public enum KpiOverviewCalloutTone: String, Sendable, Equatable, CaseIterable {
    case info
    case success
    case warning
    case danger
}

/// The optional footer insight — the native mirror of the web `<InlineCallout>` footer slot
/// (e.g. "1 anomaly in this range →"). `actionLabel`, when present, renders a trailing affordance.
public struct KpiOverviewCallout: Sendable, Equatable {
    public let tone: KpiOverviewCalloutTone
    public let message: String
    public let actionLabel: String?

    public init(tone: KpiOverviewCalloutTone, message: String, actionLabel: String? = nil) {
        self.tone = tone
        self.message = message
        self.actionLabel = actionLabel
    }
}

/// The section header — the native mirror of the web `<ComparisonHeader>`: a title, the current-period
/// label, an optional comparison-period label, and an optional headline `delta`. All copy is
/// caller-provided + already localized (the web component holds no date/i18n logic), so it passes
/// straight through the projection.
public struct KpiOverviewHeader: Sendable, Equatable {
    public let title: String
    public let currentLabel: String
    public let comparisonLabel: String?
    public let delta: KpiOverviewDelta?

    public init(
        title: String,
        currentLabel: String,
        comparisonLabel: String? = nil,
        delta: KpiOverviewDelta? = nil
    ) {
        self.title = title
        self.currentLabel = currentLabel
        self.comparisonLabel = comparisonLabel
        self.delta = delta
    }
}

// MARK: - Input snapshot (web props + parent lifecycle)

/// One coalesced snapshot of the card's inputs — the native mirror of the web `header` / `kpis` /
/// `secondary` / `footer` props plus the parent's lifecycle (`isLoading`, an error message,
/// connectivity). A value type, so it is `Sendable` & `Equatable` and the projection is a pure
/// function of it.
public struct KpiOverviewInput: Sendable, Equatable {
    public var header: KpiOverviewHeader
    public var items: [KpiOverviewItem]
    public var secondary: String?
    public var footer: KpiOverviewCallout?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: KpiOverviewConnection

    public init(
        header: KpiOverviewHeader,
        items: [KpiOverviewItem] = [],
        secondary: String? = nil,
        footer: KpiOverviewCallout? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: KpiOverviewConnection = .live
    ) {
        self.header = header
        self.items = items
        self.secondary = secondary
        self.footer = footer
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `KpiOverviewSource`, recomputes the resolved
/// projection, exposes a render `phase`, the resolved view-state, and the `connection` axis, emits
/// `view.opened` exactly once when the surface first appears, and auto-refreshes once when the feed
/// transitions to stale. There is no async source of its own — the web source has no data dependency;
/// the host owns the numbers and pushes a snapshot.
@MainActor
@Observable
public final class KpiOverviewCardModel {
    public private(set) var resolved: KpiOverviewResolved
    public private(set) var connection: KpiOverviewConnection = .live

    public var phase: KpiOverviewResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any KpiOverviewSource
    @ObservationIgnored private let telemetry: any KpiOverviewTelemetry
    @ObservationIgnored private let strings: KpiOverviewResolve
    @ObservationIgnored private var input: KpiOverviewInput?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any KpiOverviewSource,
        telemetry: any KpiOverviewTelemetry = OSLogKpiOverviewTelemetry(),
        strings: @escaping KpiOverviewResolve = KpiOverviewStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        resolved = KpiOverviewResolved.chrome(phase: .loading, connection: .live)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: KpiOverviewMeta.surfaceSlug)
        }
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

    private func apply(_ input: KpiOverviewInput) {
        self.input = input
        connection = input.connection
        resolved = KpiOverviewProjection.resolve(input, strings: strings)
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (the cached content stays shown).
    private func handleAutoRefresh(for connection: KpiOverviewConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
