import Foundation
import Observation

// MARK: - Data source seam (web `useVehicles` + `useVehicleState` + `useLocationSnapshotLatest` + `useVehicleCommand`)

/// Supplies every datum the Glance page renders and performs its commands. The production
/// implementation binds the shared KMP repositories/use-cases (ADR-004 — the view holds no
/// networking); previews and tests inject doubles to drive the loading / empty / error /
/// success states. Mirrors the sibling feature `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useVehicles` / `GET /vehicles`; `loadState` ←
/// `useVehicleState` / `GET /vehicles/{id}/state`; `loadLocation` ←
/// `useLocationSnapshotLatest` / `GET /location-snapshots/latest?vehicle_id`; `send` ←
/// `useVehicleCommand` / `POST /vehicles/{id}/command { command }`.
public protocol GlanceDataSource: Sendable {
    func loadVehicles() async throws -> [GlanceVehicle]
    func loadState(vehicleID: Int64) async throws -> GlanceVehicleState?
    func loadLocation(vehicleID: Int64) async throws -> GlanceLocation?
    func send(command: GlanceCommand, vehicleID: Int64) async throws
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the vehicle list + the resolved selection (web `?vehicle_id` query param, falling
/// back to the first vehicle), the selected vehicle's live state + latest location, and the
/// in-flight command. The view reads everything from here; it always renders the populated
/// glance once a vehicle exists, with each metric degrading to an em dash exactly as the
/// web page's `?? '—'` fallbacks do.
@MainActor
@Observable
public final class GlancePageModel {
    public private(set) var phase: GlancePhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [GlanceVehicle] = []
    public private(set) var vehicle: GlanceVehicle?
    public private(set) var state: GlanceVehicleState?
    public private(set) var location: GlanceLocation?

    /// When the displayed state was last refreshed — drives the freshness chip (web query
    /// `dataUpdatedAt`).
    public private(set) var updatedAt: Date?

    /// The command currently being sent, so its action button shows a spinner and the rest
    /// stay disabled (web `sendCommand.isPending` + `variables.command`).
    public private(set) var commandInFlight: GlanceCommand?

    /// The deep-link `?vehicle_id` the page opened with (web `searchParams.get`).
    @ObservationIgnored public let preferredVehicleID: Int64?

    @ObservationIgnored private let dataSource: any GlanceDataSource

    public init(
        dataSource: any GlanceDataSource = SampleGlanceDataSource(),
        preferredVehicleID: Int64? = nil
    ) {
        self.dataSource = dataSource
        self.preferredVehicleID = preferredVehicleID
    }

    // MARK: Derivations (web inline)

    /// Web `isOnline = state?.state === 'online' || state?.state === 'parked'`.
    public var isOnline: Bool {
        state?.isOnline ?? false
    }

    /// Web `canSendCommands = isOnline && !sendCommand.isPending`.
    public var canSendCommands: Bool {
        isOnline && commandInFlight == nil
    }

    /// Web `getLocationLabel(location, t)` resolved to its label case.
    public var locationLabel: GlanceLocationLabel {
        GlanceLocationLabel.resolve(location)
    }

    /// Whether the displayed values are older than the freshness window (ADR-013).
    public var isStale: Bool {
        GlanceFormat.isStale(updatedAt)
    }

    // MARK: Loading

    /// Loads the vehicle list, resolves the selected vehicle (web `?vehicle_id` → match,
    /// else first), then its state + location. A vehicle-list failure is the only one that
    /// surfaces the retryable error region (web `PageContainer error={vehiclesError}`); the
    /// state / location queries degrade to `nil` so the page still renders (web `?? '—'`).
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
            vehicles = try await dataSource.loadVehicles()
        } catch {
            phase = .error(error.localizedDescription)
            return
        }
        vehicle = resolveVehicle(from: vehicles)
        await loadDetails()
        phase = .ready
    }

    /// Web vehicle resolution: the `?vehicle_id` match if present, otherwise the first
    /// vehicle, otherwise `nil` (the no-vehicle empty state).
    private func resolveVehicle(from list: [GlanceVehicle]) -> GlanceVehicle? {
        guard !list.isEmpty else { return nil }
        if let preferredVehicleID, let match = list.first(where: { $0.id == preferredVehicleID }) {
            return match
        }
        return list.first
    }

    private func loadDetails() async {
        guard let id = vehicle?.id else {
            state = nil
            location = nil
            updatedAt = nil
            return
        }
        // The web `useVehicleState` / `useLocationSnapshotLatest` queries fail soft (the page
        // renders with `?? '—'`), so a throw here degrades to `nil`, never the error region.
        state = (try? await dataSource.loadState(vehicleID: id)) ?? nil
        location = (try? await dataSource.loadLocation(vehicleID: id)) ?? nil
        updatedAt = Date()
    }

    // MARK: Commands (web `sendCommand.mutate`)

    /// Sends a quick-action command for the selected vehicle (web `useVehicleCommand`),
    /// then refreshes the state so the lock / climate toggles reflect the new value (web
    /// invalidates `vehicleKeys.state`). No-ops when commands are disabled (web
    /// `disabled={!canSendCommands}`).
    public func send(_ command: GlanceCommand) async {
        guard let id = vehicle?.id, canSendCommands else { return }
        commandInFlight = command
        defer { commandInFlight = nil }
        do {
            try await dataSource.send(command: command, vehicleID: id)
            state = (try? await dataSource.loadState(vehicleID: id)) ?? state
            updatedAt = Date()
        } catch {
            // Web surfaces a toast and leaves the page intact; the action simply ends.
        }
    }
}
