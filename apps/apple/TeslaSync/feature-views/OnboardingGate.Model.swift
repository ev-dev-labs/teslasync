//
//  OnboardingGate.Model.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  The state-holder seam (P1/S8), telemetry seam (P1/S11), navigation seam (the
//  `useNavigate` analog), the P1/S10 localization facade, and the surface's
//  `@Observable` model. The web `OnboardingGate` binds `useOnboardingStatus` +
//  `useOnboardingSkip` + `useLocation` and performs a `navigate('/onboarding')`
//  side effect; the native model binds the same inputs through a push-based source
//  and drives the same redirect through the navigator seam. No networking lives in
//  the view — it is a pure function of the model's projection + freshness.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default logs via `os.Logger`; the app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(…))`, which is consent-gated + redacted.
public protocol OnboardingGateTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogOnboardingGateTelemetry: OnboardingGateTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Navigation seam (web `useNavigate`)

/// The navigation the gate drives — abstracted so the redirect side effect is
/// unit-testable with a spy and so the app's router stays out of the view. Mirrors
/// the web `navigate(to, { replace })`.
@MainActor
public protocol OnboardingGateNavigator {
    func navigate(to path: String, replace: Bool)
}

/// `os.Logger`-backed default. The app injects a navigator that drives the real
/// `AppRoute` router; previews use this no-op-but-logged implementation.
public struct LoggingOnboardingGateNavigator: OnboardingGateNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func navigate(to path: String, replace: Bool) {
        logger.info("navigate path=\(path, privacy: .public) replace=\(replace, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip + connectivity banner the native state matrix requires.
public enum OnboardingGateConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One snapshot pushed by an `OnboardingGateSource`: the onboarding-status feed
/// phase, the local skip flag, the current path, and the feed's freshness. The
/// model turns this into the projection + render phase.
public struct OnboardingGateUpdate: Sendable, Equatable {
    public var feed: OnboardingFeedPhase
    public var isSkipped: Bool
    public var path: String
    public var connection: OnboardingGateConnection
    public var updatedAt: Date?

    public init(
        feed: OnboardingFeedPhase,
        isSkipped: Bool = false,
        path: String = "/",
        connection: OnboardingGateConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.feed = feed
        self.isSkipped = isSkipped
        self.path = path
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The app implements this over the shared
/// onboarding-status state holder (`useOnboardingStatus`) joined with the skip
/// store (`useOnboardingSkip`) and the router's current path (`useLocation`);
/// previews + tests use `InMemoryOnboardingGateSource`. No HTTP here.
@MainActor
public protocol OnboardingGateSource: AnyObject {
    var onUpdate: (@MainActor (OnboardingGateUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOnboardingGateSource: OnboardingGateSource {
    public var onUpdate: (@MainActor (OnboardingGateUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OnboardingGateUpdate?

    public init(initial: OnboardingGateUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: OnboardingGateUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the view
/// holds no hardcoded literals. Keys live in the "OnboardingGate" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum OnboardingGateStrings {
    public static let table = "OnboardingGate"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - View model

/// The surface's observable view-model. Subscribes to an `OnboardingGateSource`,
/// rebuilds the `OnboardingGateProjection` via `OnboardingGateProjectionBuilder`,
/// exposes a render `Phase` + freshness for SwiftUI to switch over, and drives the
/// `navigate('/onboarding')` redirect through the navigator seam when the gate's
/// verdict is `.redirect`.
@MainActor
@Observable
public final class OnboardingGateModel {
    /// The mutually-exclusive render branches (web gate is non-visual; these are the
    /// native state matrix the prompt requires — never a blank surface).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: OnboardingGateConnection = .live
    public private(set) var projection: OnboardingGateProjection
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any OnboardingGateSource
    @ObservationIgnored private let telemetry: any OnboardingGateTelemetry
    @ObservationIgnored private let navigator: any OnboardingGateNavigator
    @ObservationIgnored private var started = false
    /// The path most recently auto-redirected to, so the gate fires `navigate(…)`
    /// once per entry into the redirect verdict (the web effect re-runs only when a
    /// dependency changes the outcome). Reset whenever the verdict is not a redirect.
    @ObservationIgnored private var lastRedirectedPath: String?

    public init(
        source: any OnboardingGateSource,
        telemetry: any OnboardingGateTelemetry = OSLogOnboardingGateTelemetry(),
        navigator: any OnboardingGateNavigator = LoggingOnboardingGateNavigator()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        projection = OnboardingGateProjection(decision: .hold(.loading), anchors: [])
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OnboardingGateView.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-checks onboarding status (web `refetch()` behind the Retry / Check again).
    public func refresh() {
        source.refresh()
    }

    /// Routes the user to onboarding on demand (the redirect card's CTA). Mirrors
    /// the web `navigate('/onboarding', { replace: true })`.
    public func goToOnboarding() {
        navigator.navigate(to: OnboardingGateRoute.onboarding, replace: true)
    }

    private func apply(_ update: OnboardingGateUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = OnboardingGateProjectionBuilder.build(
            feed: update.feed,
            isSkipped: update.isSkipped,
            path: update.path
        )
        phase = Self.resolvePhase(projection)
        dispatchRedirectIfNeeded(projection.decision)
    }

    /// Fires the auto-redirect exactly once per entry into the `.redirect` verdict,
    /// the native parity of the web effect's `navigate('/onboarding')`.
    private func dispatchRedirectIfNeeded(_ decision: GateDecision) {
        guard case let .redirect(path) = decision else {
            lastRedirectedPath = nil
            return
        }
        guard lastRedirectedPath != path else { return }
        lastRedirectedPath = path
        navigator.navigate(to: path, replace: true)
    }

    /// Resolves the render phase from the gate decision. Hold verdicts map to the
    /// native loading / empty / error chrome; pass + redirect render content.
    static func resolvePhase(_ projection: OnboardingGateProjection) -> Phase {
        switch projection.decision {
        case .hold(.loading):
            .loading
        case .hold(.noData):
            .empty
        case .hold(.error):
            .error(projection.errorMessage ?? "")
        case .pass, .redirect:
            .content
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver labels for the surface. Pure + public so the a11y content
/// is unit-testable without rendering the view.
public enum OnboardingGateAccessibility {
    /// The spoken label for the whole panel in its current decision.
    public static func panelLabel(for projection: OnboardingGateProjection) -> String {
        let prefix = OnboardingGateStrings.string("onboarding.gate.title", "Finish setting up TeslaSync")
        switch projection.decision {
        case .hold(.loading):
            return "\(prefix): \(OnboardingGateStrings.string("onboarding.gate.loading", "Checking your setup…"))"
        case .hold(.noData):
            return "\(prefix): \(OnboardingGateStrings.string("onboarding.gate.empty", "Setup status unavailable"))"
        case .hold(.error):
            let message = OnboardingGateStrings.string("onboarding.gate.error.title", "Couldn't verify setup")
            return "\(prefix): \(message). \(projection.errorMessage ?? "")"
        case let .pass(reason):
            return "\(prefix): \(passLabel(reason))"
        case .redirect:
            return "\(prefix): \(OnboardingGateStrings.string("onboarding.gate.redirect.title", "Taking you to setup"))"
        }
    }

    /// The spoken label for a pass verdict.
    public static func passLabel(_ reason: GatePassReason) -> String {
        switch reason {
        case .complete:
            OnboardingGateStrings.string("onboarding.gate.complete.title", "You're all set")
        case .skipped, .allowListed:
            OnboardingGateStrings.string("onboarding.gate.continue.title", "Continuing to your dashboard")
        }
    }

    /// The spoken label for a single anchor row (e.g. "Vehicles synced, completed").
    public static func anchorLabel(_ anchor: OnboardingAnchor) -> String {
        let name = anchorTitle(anchor.kind)
        let state = anchor.done
            ? OnboardingGateStrings.string("onboarding.gate.anchor.done.a11y", "completed")
            : OnboardingGateStrings.string("onboarding.gate.anchor.pending.a11y", "pending")
        return "\(name), \(state)"
    }

    /// The localized title for an anchor kind (shared by the view + a11y).
    public static func anchorTitle(_ kind: OnboardingAnchorKind) -> String {
        switch kind {
        case .tesla:
            OnboardingGateStrings.string("onboarding.gate.anchor.tesla", "Tesla account connected")
        case .vehicle:
            OnboardingGateStrings.string("onboarding.gate.anchor.vehicle", "Vehicles synced")
        case .telemetry:
            OnboardingGateStrings.string("onboarding.gate.anchor.telemetry", "Telemetry flowing")
        }
    }
}
