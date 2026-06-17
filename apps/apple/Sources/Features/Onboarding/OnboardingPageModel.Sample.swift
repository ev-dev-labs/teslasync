import Foundation

// MARK: - Data source seam (web `useOnboardingStatus`)

/// Supplies the onboarding status the page renders (web `useOnboardingStatus` →
/// `GET /onboarding/status`). The production implementation binds the shared KMP repositories /
/// use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles to drive
/// the loading / in-progress / complete / failure states. Mirrors the sibling feature `*DataSource`
/// seams.
public protocol OnboardingDataSource: Sendable {
    func loadStatus() async throws -> OnboardingChecklistStatus
}

// MARK: - Sample seed (default until the KMP-backed source is injected)

/// A representative local seed used as the `OnboardingPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it is an
/// API-response-shaped fixture (Tesla connected and a vehicle synced, but telemetry not yet
/// flowing) so the checklist renders mid-flow out of the box.
public struct SampleOnboardingDataSource: OnboardingDataSource {
    public init() {}

    public func loadStatus() async throws -> OnboardingChecklistStatus {
        OnboardingChecklistStatus(teslaConnected: true, vehicleCount: 1, dataFlowing: false, isComplete: false)
    }
}

#if DEBUG
    /// Preview/test seam: a brand-new install — nothing connected yet (web first step `current`).
    public struct FreshInstallOnboardingDataSource: OnboardingDataSource {
        public init() {}

        public func loadStatus() async throws -> OnboardingChecklistStatus {
            OnboardingChecklistStatus(teslaConnected: false, vehicleCount: 0, dataFlowing: false, isComplete: false)
        }
    }

    /// Preview/test seam: every anchor satisfied — the "all set" / continue branch (web `isComplete`).
    public struct CompleteOnboardingDataSource: OnboardingDataSource {
        public init() {}

        public func loadStatus() async throws -> OnboardingChecklistStatus {
            OnboardingChecklistStatus(teslaConnected: true, vehicleCount: 2, dataFlowing: true, isComplete: true)
        }
    }

    /// Preview/test seam whose status load fails — exercises the web pessimistic degrade (the page
    /// still resolves to `.ready` with every anchor unmet rather than a blank error region).
    public struct FailingOnboardingDataSource: OnboardingDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadStatus() async throws -> OnboardingChecklistStatus {
            throw Failure()
        }
    }
#endif
