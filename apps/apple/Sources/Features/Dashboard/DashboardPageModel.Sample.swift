import Foundation

// MARK: - Data source seam (web `useAuthStatus` + `useVehicles` + `useSyncVehicles`)

/// Supplies every datum the Command Center renders and performs its vehicle sync. The
/// production implementation binds the shared KMP repositories/use-cases (ADR-004 — the view
/// holds no networking); previews and tests inject doubles to drive the loading / onboarding /
/// connected / error states. Mirrors the sibling feature `*DataSource` seams.
///
/// Method ↔ web map: `loadAuthStatus` ← `useAuthStatus` / `GET /auth/status`; `loadVehicles`
/// ← `useVehicles` / `GET /vehicles`; `syncVehicles` ← `useSyncVehicles` /
/// `POST /vehicles/sync` (returns the refreshed garage).
public protocol DashboardDataSource: Sendable {
    func loadAuthStatus() async throws -> DashboardAuthStatus
    func loadVehicles() async throws -> [DashboardVehicle]
    func syncVehicles() async throws -> [DashboardVehicle]
}

// MARK: - Sample seed (default until the KMP-backed source is injected)

/// A representative local seed used as the `DashboardPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production data — it is an
/// API-response-shaped fixture (a connected account with two vehicles) so the surface renders
/// its populated dashboard out of the box.
public struct SampleDashboardDataSource: DashboardDataSource {
    public init() {}

    public func loadAuthStatus() async throws -> DashboardAuthStatus {
        DashboardAuthStatus(authenticated: true)
    }

    public func loadVehicles() async throws -> [DashboardVehicle] {
        [
            DashboardVehicle(id: 1, displayName: "Rocinante", model: "Model 3"),
            DashboardVehicle(id: 2, displayName: "Tachi", model: "Model Y")
        ]
    }

    public func syncVehicles() async throws -> [DashboardVehicle] {
        try await loadVehicles()
    }
}

#if DEBUG
    /// Preview/test seam: connected account with no vehicles yet — drives the "sync" onboarding
    /// (web `authenticated && vehicles.length === 0`). A sync returns one vehicle so the
    /// success body then renders.
    public struct SyncNeededDashboardDataSource: DashboardDataSource {
        public init() {}

        public func loadAuthStatus() async throws -> DashboardAuthStatus {
            DashboardAuthStatus(authenticated: true)
        }

        public func loadVehicles() async throws -> [DashboardVehicle] { [] }

        public func syncVehicles() async throws -> [DashboardVehicle] {
            [DashboardVehicle(id: 1, displayName: "Rocinante", model: "Model 3")]
        }
    }

    /// Preview/test seam: no Tesla account connected — drives the auth warning banner + the
    /// "connect" onboarding (web `!auth.authenticated`).
    public struct NotConnectedDashboardDataSource: DashboardDataSource {
        public init() {}

        public func loadAuthStatus() async throws -> DashboardAuthStatus {
            DashboardAuthStatus(authenticated: false)
        }

        public func loadVehicles() async throws -> [DashboardVehicle] { [] }
        public func syncVehicles() async throws -> [DashboardVehicle] { [] }
    }

    /// Preview/test seam whose vehicle-list load fails — drives the error region (web
    /// `error.loadFailed`).
    public struct FailingDashboardDataSource: DashboardDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadAuthStatus() async throws -> DashboardAuthStatus {
            DashboardAuthStatus(authenticated: true)
        }

        public func loadVehicles() async throws -> [DashboardVehicle] { throw Failure() }
        public func syncVehicles() async throws -> [DashboardVehicle] { throw Failure() }
    }
#endif
