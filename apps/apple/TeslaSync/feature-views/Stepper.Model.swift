//
//  OnboardingStepper.Model.swift
//  TeslaSync — P4 feature view · 0195 · OnboardingStepper (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and
//  the i18n facade (P1/S10). The view binds through `StepperModel`; no
//  networking lives in the view.
//
//  The web component is a pure presentational leaf — its parent (the onboarding
//  page) derives the `steps` array from its own anchor queries and passes it
//  down. The native surface owns the full P4 states contract around that parent
//  query, so the source snapshot carries the query phase (loading / loaded /
//  failed) plus the freshness + connectivity flags that drive the stale +
//  offline chrome. The empty case is the native, never-a-blank-box treatment of
//  an onboarding flow that has no remaining steps.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter forwarding to the
/// shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated
/// and redacted there.
public protocol StepperTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event.
public struct OSLogStepperTelemetry: StepperTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Parent query lifecycle (web onboarding-page step derivation)

/// The load lifecycle of the parent's onboarding-step derivation, mirrored as
/// the source of truth the native surface renders around. `loaded([])` is the
/// healthy "nothing left to configure" outcome.
public enum StepperPhase: Sendable, Equatable {
    case loading
    case loaded([StepperStep])
    case failed
}

/// The resolved render branch the SwiftUI surface switches over. `empty` is the
/// native treatment of a step list with no entries; `steps` carries the
/// projected, display-ready rows.
public enum StepperRender: Sendable, Equatable {
    case loading
    case failed
    case empty
    case steps([StepperRow])
}

// MARK: - Input snapshot (web parent props + query meta)

/// One coalesced snapshot of the surface inputs — the parent's step-query phase
/// plus the freshness + connectivity flags. The production source composes this
/// from the onboarding page's anchor queries; previews/tests construct it
/// directly.
public struct StepperInput: Sendable, Equatable {
    public var phase: StepperPhase
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        phase: StepperPhase,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.phase = phase
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// onboarding page's anchor queries; previews + tests use
/// `InMemoryStepperSource`. The view never talks to the network directly.
@MainActor
public protocol StepperSource: AnyObject {
    var onUpdate: (@MainActor (StepperInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the step-derivation query (wired to retry + stale auto-refresh).
    func refresh()
    /// Activates a step's CTA by its stable key (web `cta.onClick` / navigation).
    func activateStep(_ key: String)
}

/// The surface's observable view-model. Subscribes to a `StepperSource`,
/// recomputes the resolved render branch + the stale/offline chrome flags, and
/// exposes them for SwiftUI to switch over. Auto-refreshes once on each rising
/// edge into the stale state (the P4 "stale chip + auto-refresh" contract).
@MainActor
@Observable
public final class StepperModel {
    public private(set) var render: StepperRender = .loading
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any StepperSource
    @ObservationIgnored private let telemetry: any StepperTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var wasStale = false

    public init(
        source: any StepperSource,
        telemetry: any StepperTelemetry = OSLogStepperTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OnboardingStepper.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the step-derivation query (wired to the retry affordance).
    public func refresh() {
        source.refresh()
    }

    /// Forwards a step CTA activation to the bound source (web `cta.onClick`).
    public func activateStep(_ key: String) {
        source.activateStep(key)
    }

    private func apply(_ input: StepperInput) {
        render = Self.render(for: input.phase)
        isStale = input.isStale
        isOffline = input.isOffline
        if input.isStale, !wasStale {
            source.refresh()
        }
        wasStale = input.isStale
    }

    /// Resolves the render branch from the parent-query phase (web step list,
    /// extended with the loading/error/empty chrome the leaf delegates upward).
    nonisolated static func render(for phase: StepperPhase) -> StepperRender {
        switch phase {
        case .loading:
            .loading
        case .failed:
            .failed
        case let .loaded(steps):
            steps.isEmpty ? .empty : .steps(StepperProjection.rows(from: steps))
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryStepperSource: StepperSource {
    public var onUpdate: (@MainActor (StepperInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var activatedSteps: [String] = []

    private let initial: StepperInput?

    public init(initial: StepperInput? = nil) {
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

    public func activateStep(_ key: String) {
        activatedSteps.append(key)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: StepperInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "OnboardingStepper" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum StepperStrings {
    public static let table = "OnboardingStepper"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
