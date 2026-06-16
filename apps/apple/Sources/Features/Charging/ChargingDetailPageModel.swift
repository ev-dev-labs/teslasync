import Foundation
import Observation

// MARK: - Data source seam (web `useChargingSessionDetail` + `useChargeTelemetry` + `useVehicle` + `useChargingTelemetryLatest`)

/// Supplies every datum the page renders. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the
/// sibling feature `*DataSource` seams.
///
/// Method ↔ web map: `loadSession` ← `useChargingSessionDetail(sessionId)` /
/// `GET /charging/{id}`; `loadTelemetry` ← `useChargeTelemetry(session.id)` /
/// `GET /charging/{sessionId}/telemetry`; `loadVehicle` ← `useVehicle(vehicle_id)` /
/// `GET /vehicles/{id}`; `loadLatestTelemetry` ← `useChargingTelemetryLatest(vehicle_id)`
/// / `GET /charging-telemetry/latest?vehicle_id`.
public protocol ChargingDetailDataSource: Sendable {
    func loadSession(sessionID: Int64) async throws -> ChargingSessionDetail
    func loadTelemetry(sessionID: Int64) async throws -> [ChargeTelemetryReading]
    func loadVehicle(vehicleID: Int64) async throws -> ChargingDetailVehicle?
    func loadLatestTelemetry(vehicleID: Int64) async throws -> ChargingTelemetryLatest?
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the session, its charge telemetry, the owning vehicle, and the latest live
/// charging parameters (web's four hooks). The session fetch resolves the page phase (web
/// `isLoading || !session ? Skeleton : body`); the telemetry / vehicle / live queries are
/// best-effort and never block the page, exactly as the web's independent hooks behave —
/// each panel then renders its own success vs. empty from the bound state.
@MainActor
@Observable
public final class ChargingDetailPageModel {
    /// The charge-session id this page details (web route `:id`).
    public let sessionID: Int64

    public private(set) var phase: ChargingDetailPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var session: ChargingSessionDetail?
    public private(set) var telemetry: [ChargeTelemetryReading] = []
    public private(set) var vehicle: ChargingDetailVehicle?
    public private(set) var live: ChargingTelemetryLatest?

    @ObservationIgnored private let dataSource: any ChargingDetailDataSource

    public init(
        sessionID: Int64,
        dataSource: any ChargingDetailDataSource = SampleChargingDetailDataSource()
    ) {
        self.sessionID = sessionID
        self.dataSource = dataSource
    }

    /// Web `hasTelemetry = !!telemetry && telemetry.length > 0` — gates measured vs.
    /// synthesized curve and the time-series charts' success vs. empty.
    public var hasTelemetry: Bool {
        !telemetry.isEmpty
    }

    // MARK: Loading

    /// Loads the session then its secondary sources (web's four hooks). A session-fetch
    /// failure surfaces the retryable error region; the others degrade to empty.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        do {
            let loaded = try await dataSource.loadSession(sessionID: sessionID)
            session = loaded
            telemetry = (try? await dataSource.loadTelemetry(sessionID: sessionID)) ?? []
            vehicle = try? await dataSource.loadVehicle(vehicleID: loaded.vehicleID)
            live = try? await dataSource.loadLatestTelemetry(vehicleID: loaded.vehicleID)
            phase = .ready
        } catch {
            phase = .error(error.localizedDescription)
        }
    }
}
