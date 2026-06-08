//
//  ComputedMetricEditor.LivePreview.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The P1/S8 state-holder seam for the live-preview mutation (web
//  `usePreviewComputedMetric`, POST `/alerts/test` with `kind: 'computed_metric'`):
//  a Shared-free `ComputedMetricPreviewRunner` the view binds through, the settled
//  outcome taxonomy, and the `@Observable` model that drives the preview lifecycle
//  (web `useMutation` status) plus the freshness/offline chrome the Apple HIG states
//  contract requires. No SwiftUI view code and no direct networking live here — the
//  production app injects a runner over the shared networking client; previews + tests
//  inject `InMemoryComputedMetricPreviewRunner`.
//

import Foundation
import Observation

// MARK: - Settled outcome (the seam's result; web `previewMut` resolution)

/// The result of a preview request, mirroring the shapes the web mutation collapses
/// to: the resolved `ComputedMetricPreview` body (success), a server/validation error
/// string (web `onError` message), and the transport failure the native app surfaces
/// as `offline` so the last successful preview can stay on screen behind an offline
/// chip rather than being blanked.
public enum ComputedMetricPreviewOutcome: Sendable, Equatable {
    case success(ComputedMetricPreviewResult)
    case failure(message: String)
    case offline(message: String)
}

// MARK: - Runner seam (P1/S8 layer; never HTTP from the view)

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 preview mutation holder (which POSTs `/alerts/test` via the shared
/// networking client); previews and tests inject `InMemoryComputedMetricPreviewRunner`.
/// The view never performs I/O itself.
@MainActor
public protocol ComputedMetricPreviewRunner: AnyObject {
    var onOutcome: (@MainActor (ComputedMetricPreviewOutcome) -> Void)? { get set }
    func run(_ request: ComputedMetricPreviewRequest)
    func cancel()
}

/// Deterministic runner for previews and unit/UI tests. Constructed with a canned
/// outcome (delivered synchronously on `run(_:)` when `autoResponds`), or driven
/// manually via `push(_:)` to script multi-step flows (e.g. success → offline).
@MainActor
public final class InMemoryComputedMetricPreviewRunner: ComputedMetricPreviewRunner {
    public var onOutcome: (@MainActor (ComputedMetricPreviewOutcome) -> Void)?
    public private(set) var runCount = 0
    public private(set) var cancelCount = 0
    public private(set) var lastRequest: ComputedMetricPreviewRequest?

    private let outcome: ComputedMetricPreviewOutcome?
    private let autoResponds: Bool

    public init(outcome: ComputedMetricPreviewOutcome? = nil, autoResponds: Bool = true) {
        self.outcome = outcome
        self.autoResponds = autoResponds
    }

    public func run(_ request: ComputedMetricPreviewRequest) {
        runCount += 1
        lastRequest = request
        if autoResponds, let outcome {
            onOutcome?(outcome)
        }
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Delivers an outcome to the bound model (deterministic test/preview affordance).
    public func push(_ outcome: ComputedMetricPreviewOutcome) {
        onOutcome?(outcome)
    }
}

// MARK: - Preview view-model

/// The surface's observable preview view-model. Drives the run lifecycle (web
/// `useMutation` status), keeps the last result visible as cached, and layers
/// freshness (stale / offline) on top so SwiftUI can render every preview state from
/// the web source plus the offline/stale chrome the prompt requires.
@MainActor
@Observable
public final class ComputedMetricPreviewModel {
    /// The run lifecycle, mirroring the web mutation status.
    public enum Phase: Equatable, Sendable {
        case idle
        case computing
        case success
        case failure
    }

    public private(set) var phase: Phase = .idle
    public private(set) var result: ComputedMetricPreviewResult?
    public private(set) var errorMessage: String?
    public private(set) var isOffline = false
    public private(set) var lastUpdatedAt: Date?

    @ObservationIgnored private let runner: any ComputedMetricPreviewRunner
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private var inFlightRequest: ComputedMetricPreviewRequest?

    public init(
        runner: any ComputedMetricPreviewRunner,
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 30
    ) {
        self.runner = runner
        self.now = now
        self.stalenessWindow = stalenessWindow
        runner.onOutcome = { [weak self] outcome in self?.apply(outcome) }
    }

    /// Whether the last successful preview is older than the freshness window. Only a
    /// success can go stale (an error is never "fresh data").
    public var isStale: Bool {
        guard phase == .success, let lastUpdatedAt else { return false }
        return now().timeIntervalSince(lastUpdatedAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: ComputedMetricFreshness {
        if isOffline { return .offline }
        if isStale { return .stale }
        return .live
    }

    /// Fires a preview (web `previewMut.mutate(...)`). Re-entrancy is guarded so an
    /// identical in-flight request is not dispatched twice; a changed request supersedes
    /// the previous one. The outcome arrives via the seam.
    public func requestPreview(_ request: ComputedMetricPreviewRequest) {
        if phase == .computing, inFlightRequest == request { return }
        inFlightRequest = request
        phase = .computing
        errorMessage = nil
        runner.run(request)
    }

    /// Resets to idle (web `!ready` branch — the editor is incomplete). Cancels any
    /// in-flight request so a late outcome cannot resurrect a stale line.
    public func clear() {
        guard phase != .idle || result != nil || errorMessage != nil || isOffline else { return }
        inFlightRequest = nil
        runner.cancel()
        phase = .idle
        result = nil
        errorMessage = nil
        isOffline = false
        lastUpdatedAt = nil
    }

    private func apply(_ outcome: ComputedMetricPreviewOutcome) {
        let at = now()
        inFlightRequest = nil
        switch outcome {
        case let .success(value):
            result = value
            phase = .success
            errorMessage = nil
            isOffline = false
            lastUpdatedAt = at
        case let .failure(message):
            phase = .failure
            errorMessage = message
            isOffline = false
            lastUpdatedAt = at
        case let .offline(message):
            isOffline = true
            if let cached = result, cached.value.isFinite {
                // Keep the last successful preview visible behind the offline chip.
                phase = .success
                errorMessage = nil
            } else {
                phase = .failure
                errorMessage = message
            }
        }
    }
}
