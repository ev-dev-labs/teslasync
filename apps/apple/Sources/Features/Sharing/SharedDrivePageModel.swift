import Foundation
import Observation

// MARK: - Data source seam (web `useSharedDrive` → `GET /share/{token}`)

/// Supplies the public shared-drive report for a token. The production implementation binds the
/// shared KMP repository/use-case (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to exercise the loading / success / empty / expired states. Mirrors the sibling
/// `*DataSource` seams. Method ↔ web map: `loadSharedDrive` ← `useSharedDrive(token)` /
/// `GET /share/{token}` (the public, pre-auth endpoint). It returns the raw wire union so the model
/// normalizes to SI exactly where the web page calls `normalizeSharedDriveData`.
public protocol SharedDriveDataSource: Sendable {
    func loadSharedDrive(token: String) async throws -> SharedDriveWire
}

// MARK: - Page phase (web `isLoading ? Spinner : error || !data ? Expired : report`)

/// The page's top-level phase. The web page shows the full-screen spinner while loading, the
/// expired view on a fetch error OR missing data, and the branded report otherwise.
public enum SharedDrivePhase: Equatable, Sendable {
    case loading
    case ready
    /// Web `error || !data` — the share link is unavailable (expired / revoked / empty token).
    case expired
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). It owns
/// the share token, drives the public fetch (web `useSharedDrive`, `retry: false`), and normalizes
/// the wire union to one SI `SharedDrivePayload` (web `normalizeSharedDriveData` memo) the report
/// reads. An empty token resolves straight to `.expired` without a request, matching the web query's
/// `enabled: !!token` + `error || !data` gate. The map points + chart-ready data are derived from
/// the normalized payload so the sections read them without recomputing per render.
@MainActor
@Observable
public final class SharedDrivePageModel {
    /// The share token this report renders (web route `/s/:token`).
    public let token: String

    public private(set) var phase: SharedDrivePhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    /// The normalized SI report (web `data` memo), or `nil` until the fetch resolves.
    public private(set) var payload: SharedDrivePayload?

    @ObservationIgnored private let dataSource: any SharedDriveDataSource

    public init(
        token: String,
        dataSource: any SharedDriveDataSource = SampleSharedDriveDataSource()
    ) {
        self.token = token
        self.dataSource = dataSource
    }

    // MARK: Derived (web `useMemo` map/chart selectors)

    /// Web `mapPoints` memo — the route vertices, or empty when none.
    public var mapPoints: [SharedMapPoint] {
        payload?.mapPoints ?? []
    }

    /// Web hero-map gate: the hero map renders only when the route has at least two vertices.
    public var hasRoute: Bool {
        mapPoints.count > 1
    }

    /// Web `elevation_profile` memo source.
    public var elevationProfile: [SharedElevationPoint] {
        payload?.elevationProfile ?? []
    }

    /// Web `speed_profile` memo source.
    public var speedProfile: [SharedSpeedPoint] {
        payload?.speedProfile ?? []
    }

    /// Web `mapPoints.length === 0 && elevationData.length === 0 && speedData.length === 0` —
    /// the no-route-data empty branch.
    public var hasNoRouteData: Bool {
        mapPoints.isEmpty && elevationProfile.isEmpty && speedProfile.isEmpty
    }

    // MARK: Loading

    /// Loads + normalizes the report (web `useSharedDrive`). An empty token or a fetch failure
    /// resolves to the expired view (web `error || !data`).
    public func load() async {
        phase = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    private func fetch() async {
        guard !token.isEmpty else {
            payload = nil
            phase = .expired
            return
        }
        do {
            let normalized = try await dataSource.loadSharedDrive(token: token).normalized()
            payload = normalized
            phase = .ready
        } catch {
            payload = nil
            phase = .expired
        }
    }
}
