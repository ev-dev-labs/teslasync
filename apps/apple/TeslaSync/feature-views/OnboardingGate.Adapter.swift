//
//  OnboardingGate.Adapter.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  The pure, host-testable adapter: the first-run gate's inputs (onboarding-status
//  feed + skip flag + current path) → a render-ready projection carrying the gate
//  decision and the three onboarding anchors. This is the native parity of the web
//  `OnboardingGate` effect (features/onboarding/components/OnboardingGate.tsx):
//
//      if (isLoading || isError || !data) return;   // hold — never trap the user
//      if (data.is_complete) return;                 // pass
//      if (isSkipped) return;                        // pass
//      if (isAllowed(location.pathname)) return;     // pass
//      navigate('/onboarding', { replace: true });   // redirect
//
//  Foundation-only — no SwiftUI, no networking, no `Shared` import — so it compiles
//  and RUNS under bare `swiftc` for the executed adapter harness.
//

import Foundation

// MARK: - Onboarding status (web `OnboardingStatus`)

/// The backend's three independent first-run anchors plus their AND, mirroring the
/// web `OnboardingStatus` (`GET /api/v1/onboarding/status`). `isComplete` is the
/// server's AND of all three — clients prefer it over re-deriving the gate.
public struct OnboardingStatus: Equatable, Sendable {
    /// A Tesla OAuth token has been stored (web `tesla_connected`).
    public let teslaConnected: Bool
    /// At least one vehicle row exists locally (web `vehicle_count`).
    public let vehicleCount: Int
    /// Telemetry arrived within the last 24h (web `data_flowing`).
    public let dataFlowing: Bool
    /// The server's AND of the three anchors (web `is_complete`).
    public let isComplete: Bool

    public init(teslaConnected: Bool, vehicleCount: Int, dataFlowing: Bool, isComplete: Bool) {
        self.teslaConnected = teslaConnected
        self.vehicleCount = vehicleCount
        self.dataFlowing = dataFlowing
        self.isComplete = isComplete
    }

    /// Whether at least one vehicle has synced (web `vehicle_count > 0`).
    public var hasVehicle: Bool {
        vehicleCount > 0
    }
}

// MARK: - Anchors (the three onboarding steps, as render data)

/// One of the three onboarding anchors the gate's status reports. Mirrors the
/// `OnboardingPage` step keys so the gate and the full wizard speak one vocabulary.
public enum OnboardingAnchorKind: String, CaseIterable, Equatable, Sendable {
    case tesla
    case vehicle
    case telemetry
}

/// A single anchor projected for display: its kind and whether it is satisfied.
public struct OnboardingAnchor: Equatable, Sendable {
    public let kind: OnboardingAnchorKind
    public let done: Bool

    public init(kind: OnboardingAnchorKind, done: Bool) {
        self.kind = kind
        self.done = done
    }
}

public extension OnboardingStatus {
    /// The three anchors in wizard order (Tesla → vehicles → telemetry).
    var anchors: [OnboardingAnchor] {
        [
            OnboardingAnchor(kind: .tesla, done: teslaConnected),
            OnboardingAnchor(kind: .vehicle, done: hasVehicle),
            OnboardingAnchor(kind: .telemetry, done: dataFlowing)
        ]
    }
}

// MARK: - Feed phase (web `useOnboardingStatus` query state, made exclusive)

/// The onboarding-status feed's state, the native projection of the web query's
/// `isLoading` / `isError` / `!data` / `data` flags collapsed into one exclusive
/// case so the evaluator is total. The web gate treats the first three as "hold"
/// (return early, never redirect) so a brief backend hiccup never traps the user.
public enum OnboardingFeedPhase: Equatable, Sendable {
    /// The status request is in flight (web `isLoading`).
    case loading
    /// The status request failed (web `isError`) — message for the error surface.
    case failed(message: String)
    /// The request resolved but produced no status object (web `!data`).
    case empty
    /// A status is available (web `data`).
    case loaded(OnboardingStatus)
}

// MARK: - Allow-list (web `ALLOW_PREFIXES` + `isAllowed`)

/// The path allow-list that bypasses the gate, a byte-faithful port of the web
/// `ALLOW_PREFIXES` + `isAllowed`. Prefixes ending in `/` match by `startsWith`;
/// the rest match the exact path or a nested child (`prefix + "/"`). The canonical
/// web paths are kept verbatim so the ported logic is identical across platforms
/// (the app's route layer maps native routes onto these canonical paths).
public struct OnboardingAllowList: Equatable, Sendable {
    public let prefixes: [String]

    /// The default allow-list, identical to the web source's `ALLOW_PREFIXES`.
    public static let `default` = OnboardingAllowList(prefixes: [
        "/onboarding",
        "/tesla-account",
        "/settings",
        "/s/", // public share links
        "/watch",
        "/login"
    ])

    public init(prefixes: [String]) {
        self.prefixes = prefixes
    }

    /// Whether `path` bypasses the gate. Match by prefix so nested routes
    /// (e.g. `/vehicles/:id/access`) work without enumerating every variant.
    public func isAllowed(_ path: String) -> Bool {
        prefixes.contains { prefix in
            if prefix.hasSuffix("/") {
                return path.hasPrefix(prefix)
            }
            return path == prefix || path.hasPrefix(prefix + "/")
        }
    }
}

// MARK: - Route target (web `navigate('/onboarding', …)`)

/// The canonical redirect target the gate routes to, matching the web
/// `navigate('/onboarding', { replace: true })`.
public enum OnboardingGateRoute {
    public static let onboarding = "/onboarding"
}

// MARK: - Decision (the gate's verdict)

/// Why the gate is holding the user where they are (no redirect). Each maps to one
/// of the web effect's early `return`s.
public enum GateHoldReason: Equatable, Sendable {
    /// Status still loading (web `isLoading`).
    case loading
    /// Status request failed (web `isError`).
    case error
    /// Status resolved but empty (web `!data`).
    case noData
}

/// Why the gate is letting the user through (no redirect).
public enum GatePassReason: Equatable, Sendable {
    /// All three anchors satisfied (web `data.is_complete`).
    case complete
    /// The operator chose "Skip for now" (web `isSkipped`).
    case skipped
    /// The current path is on the allow-list (web `isAllowed`).
    case allowListed
}

/// The gate's verdict for the current inputs — the native parity of what the web
/// effect does: hold (return early), pass (return), or redirect (navigate).
public enum GateDecision: Equatable, Sendable {
    case hold(GateHoldReason)
    case pass(GatePassReason)
    case redirect(path: String)

    /// Whether this verdict routes the user to onboarding (the web `navigate(…)`).
    public var isRedirect: Bool {
        if case .redirect = self { return true }
        return false
    }
}

// MARK: - Evaluator (the faithful port of the gate effect)

/// Evaluates the gate verdict from its inputs, preserving the web effect's exact
/// branch order: hold while loading/errored/dataless → pass when complete → pass
/// when skipped → pass when allow-listed → otherwise redirect to onboarding.
public enum GateEvaluator {
    public static func evaluate(
        feed: OnboardingFeedPhase,
        isSkipped: Bool,
        path: String,
        allowList: OnboardingAllowList = .default
    ) -> GateDecision {
        switch feed {
        case .loading:
            return .hold(.loading)
        case .failed:
            return .hold(.error)
        case .empty:
            return .hold(.noData)
        case let .loaded(status):
            if status.isComplete {
                return .pass(.complete)
            }
            if isSkipped {
                return .pass(.skipped)
            }
            if allowList.isAllowed(path) {
                return .pass(.allowListed)
            }
            return .redirect(path: OnboardingGateRoute.onboarding)
        }
    }
}

// MARK: - Projection (render-ready)

/// The render-ready projection the surface switches over: the gate decision, the
/// anchors to show (empty until the status loads), and the failure message for the
/// error state. Every branch the SwiftUI layer needs is resolved here so the view
/// is a pure function of the projection.
public struct OnboardingGateProjection: Equatable, Sendable {
    public let decision: GateDecision
    public let anchors: [OnboardingAnchor]
    public let errorMessage: String?

    public init(decision: GateDecision, anchors: [OnboardingAnchor], errorMessage: String? = nil) {
        self.decision = decision
        self.anchors = anchors
        self.errorMessage = errorMessage
    }

    /// Whether the status feed resolved to a concrete value (anchors are present).
    public var isResolved: Bool {
        !anchors.isEmpty
    }

    /// The count of satisfied anchors (drives the "x of 3" progress affordance).
    public var completedAnchorCount: Int {
        anchors.filter(\.done).count
    }
}

// MARK: - Builder (inputs → projection)

/// Builds an `OnboardingGateProjection` from the gate inputs. This is THE adapter
/// the executed harness exercises end-to-end.
public enum OnboardingGateProjectionBuilder {
    public static func build(
        feed: OnboardingFeedPhase,
        isSkipped: Bool,
        path: String,
        allowList: OnboardingAllowList = .default
    ) -> OnboardingGateProjection {
        let decision = GateEvaluator.evaluate(
            feed: feed,
            isSkipped: isSkipped,
            path: path,
            allowList: allowList
        )
        let anchors: [OnboardingAnchor]
        var failure: String?
        switch feed {
        case let .loaded(status):
            anchors = status.anchors
        case let .failed(message):
            anchors = []
            failure = message
        case .loading, .empty:
            anchors = []
        }
        return OnboardingGateProjection(decision: decision, anchors: anchors, errorMessage: failure)
    }
}
