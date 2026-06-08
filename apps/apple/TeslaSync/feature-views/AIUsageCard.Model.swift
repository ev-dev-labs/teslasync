//
//  AIUsageCard.Model.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the Helix "Usage today" settings card. The view binds through `AIUsageModel`; no
//  networking lives in the view. The web source (AIUsageCard.tsx) reads its data from
//  `useAiUsageToday()` (TanStack Query, polled at INTERVALS.STANDARD) and its display
//  preferences from `useFormatting()` (currency symbol + decimal precision), so the input
//  snapshot here carries those numbers + the currency context (plus the query's loading / error
//  state and the live-state connectivity axis) rather than issuing HTTP itself.
//
//  States: the web card degrades every cell to the em-dash sentinel on `!data || isError`.
//  On top of that this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) fed by the query state, and an orthogonal `connection`
//  axis (live / stale / offline) surfaced as a freshness chip + banner with a one-shot
//  auto-refresh on the stale transition. `empty` is the web "all-zeroes / no calls today"
//  rendering — the zeroed cells plus the hint caption, never a blank box.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol AIUsageTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogAIUsageTelemetry: AIUsageTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header
/// chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AIUsageConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web hooks: useAiUsageToday + useFormatting)

/// One coalesced snapshot of the card's inputs — the native mirror of the web
/// `useAiUsageToday()` result (`data` + `isLoading`; `isError` surfaced as an error message per
/// the P4 leaf contract) and the `useFormatting()` display preferences (`currencySymbol` +
/// `decimalPrecision`), plus the live-state connectivity.
public struct AIUsageInput: Sendable, Equatable {
    public var data: AIUsageData?
    public var isLoading: Bool
    public var errorMessage: String?
    public var currencySymbol: String
    public var decimalPrecision: Int
    public var connection: AIUsageConnection

    public init(
        data: AIUsageData? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        currencySymbol: String = "$",
        decimalPrecision: Int = 2,
        connection: AIUsageConnection = .live
    ) {
        self.data = data
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.connection = connection
    }
}

// MARK: - Caption (web `call_count > 0 ? live suffix : hint copy`)

/// The card's footer caption — the native mirror of the web ternary. `live` carries the
/// already-formatted call count (the localized "Helix calls today." suffix is appended in the
/// view); `hint` is the static "usage populates as features run" copy.
public enum AIUsageCaption: Sendable, Equatable {
    case live(callCount: String)
    case hint
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the card's render branches. `phase`
/// selects the body; `metrics` is the pre-computed three-cell grid (already locale-formatted);
/// `caption` is the resolved footer line — so the view is a pure function of this value.
public struct AIUsageResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let metrics: [AIUsageMetric]
    public let caption: AIUsageCaption

    public init(phase: Phase, metrics: [AIUsageMetric], caption: AIUsageCaption) {
        self.phase = phase
        self.metrics = metrics
        self.caption = caption
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// web component's render plus the P4 leaf contract. Unit tested across loading / empty / error
/// / data and the currency-context propagation.
public enum AIUsageProjection {
    public static func resolve(_ input: AIUsageInput, locale: Locale = .current) -> AIUsageResolved {
        // P4 contract: a query failure (web `isError`) surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return AIUsageResolved(phase: .error(message), metrics: [], caption: .hint)
        }
        // Initial fetch (web `isLoading`) — keep the card shape with skeletons.
        if input.isLoading {
            return AIUsageResolved(phase: .loading, metrics: [], caption: .hint)
        }
        // Resolved: absence is treated as zeroes (the web hook contract), so the grid is always
        // built. `call_count > 0` selects the live caption; otherwise the hint + `empty`.
        let data = input.data ?? .zero
        let metrics = AIUsageMetricsBuilder.metrics(
            for: data,
            currencySymbol: input.currencySymbol,
            precision: input.decimalPrecision,
            locale: locale
        )
        if data.callCount > 0 {
            let caption = AIUsageCaption.live(callCount: AIUsageFormat.count(data.callCount, locale: locale))
            return AIUsageResolved(phase: .data, metrics: metrics, caption: caption)
        }
        return AIUsageResolved(phase: .empty, metrics: metrics, caption: .hint)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// `useAiUsageToday` query holder composed with the formatting holder (web `useFormatting`);
/// previews and tests use `InMemoryAIUsageSource`. The view never talks to the network.
@MainActor
public protocol AIUsageSource: AnyObject {
    var onUpdate: (@MainActor (AIUsageInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to an `AIUsageSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved metrics + caption and the `connection`
/// axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AIUsageModel {
    public private(set) var resolved: AIUsageResolved =
        AIUsageProjection.resolve(AIUsageInput(isLoading: true))
    public private(set) var connection: AIUsageConnection = .live

    public var phase: AIUsageResolved.Phase {
        resolved.phase
    }

    public var metrics: [AIUsageMetric] {
        resolved.metrics
    }

    public var caption: AIUsageCaption {
        resolved.caption
    }

    @ObservationIgnored private let source: any AIUsageSource
    @ObservationIgnored private let telemetry: any AIUsageTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AIUsageSource,
        telemetry: any AIUsageTelemetry = OSLogAIUsageTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AIUsageCard.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AIUsageInput) {
        resolved = AIUsageProjection.resolve(input, locale: locale)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh of the usage query (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: AIUsageConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAIUsageSource: AIUsageSource {
    public var onUpdate: (@MainActor (AIUsageInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AIUsageInput?

    public init(initial: AIUsageInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: AIUsageInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded prose. Keys live in the "AIUsageCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum AIUsageStrings {
    public static let table = "AIUsageCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
