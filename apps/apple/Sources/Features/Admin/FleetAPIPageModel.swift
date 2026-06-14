import Foundation
import Observation

/// The `@Observable` state holder the Fleet API page binds to (ADR-004 — no networking in the
/// view). Owns the page load state, the four read feeds (via the loaded snapshot), the
/// transient mutation notice, and the in-flight flags for the suspend + polling-config writes,
/// reading + writing through the injected `FleetAPIDataSource` seam. Mirrors the sibling
/// `FeatureFlagsPageModel`.
@MainActor
@Observable
public final class FleetAPIPageModel {
    public private(set) var state: FleetAPILoadState = .loading

    /// The last mutation outcome (web toast), rendered as a dismissible banner.
    public var notice: FleetAPINotice?

    public private(set) var isSuspendInFlight = false
    public private(set) var isPollingInFlight = false

    @ObservationIgnored private let dataSource: any FleetAPIDataSource

    public init(dataSource: any FleetAPIDataSource = SampleFleetAPIDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Endpoint catalog (web `pollingEndpoints` / `onDemandEndpoints` / `commandEndpoints`)

    /// Web `pollingEndpoints` keys (the streamed Fleet API polls).
    public nonisolated static let pollingKeys = [
        "vehicle_discovery", "charge_state", "climate_state", "drive_state",
        "location_data", "vehicle_state", "vehicle_config"
    ]

    /// Web `onDemandEndpoints` keys (the on-demand syncs).
    public nonisolated static let onDemandKeys = [
        "on_demand_vehicle_discovery", "on_demand_charge_state", "on_demand_climate_state",
        "on_demand_drive_state", "on_demand_location_data", "on_demand_vehicle_state",
        "on_demand_vehicle_config", "nearby_charging_sites", "release_notes",
        "recent_alerts", "service_data"
    ]

    /// Web `commandEndpoints` keys (the write commands).
    public nonisolated static let commandKeys = ["wake_up", "commands"]

    /// Web `allEndpointKeys` — the toggle universe (polls + on-demand + commands + capture).
    public nonisolated static let allEndpointKeys = pollingKeys + onDemandKeys + commandKeys + ["telemetry_capture"]

    // MARK: - Derived state

    /// The loaded snapshot (nil unless the state is `.loaded`).
    public var snapshot: FleetAPISnapshot? {
        if case let .loaded(value) = state { return value }
        return nil
    }

    public var settings: FleetAPISettings? {
        snapshot?.settings
    }

    public var polling: PollingConfig? {
        snapshot?.polling
    }

    public var capture: CaptureStats? {
        snapshot?.capture
    }

    public var version: VersionInfo? {
        snapshot?.version
    }

    /// Web `settings?.api_suspended` (absent settings reads as not suspended).
    public var isSuspended: Bool {
        settings?.apiSuspended ?? false
    }

    /// Web `enabledCount` — how many of the toggle universe are on.
    public var enabledCount: Int {
        guard let polling else { return 0 }
        return Self.allEndpointKeys.count { polling[$0] }
    }

    /// Web `totalCount = allEndpointKeys.size`.
    public var totalCount: Int {
        Self.allEndpointKeys.count
    }

    // MARK: - Loading (web `useSettings` + `usePollingConfig` + `useCaptureStats` + `useVersionInfo`)

    /// Mounts all four feeds (web renders every query side-by-side).
    public func load() async {
        state = .loading
        do {
            let snapshot = try await dataSource.load()
            state = .loaded(snapshot)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Re-reads the feeds after a mutation (web invalidates the queries). Keeps the current
    /// snapshot visible if the refresh fails — the mutation already set its own notice.
    public func refresh() async {
        guard let snapshot = try? await dataSource.load() else { return }
        state = .loaded(snapshot)
    }

    // MARK: - Mutations (web `useToggleAPISuspend` / `useUpdatePollingConfig`)

    /// Web polling toggle: suspends when currently active, resumes when suspended.
    public func toggleSuspend() async {
        guard !isSuspendInFlight else { return }
        let suspended = !isSuspended
        isSuspendInFlight = true
        do {
            try await dataSource.setAPISuspended(suspended)
            isSuspendInFlight = false
            notice = suspended ? .apiSuspended : .apiResumed
            await refresh()
        } catch {
            isSuspendInFlight = false
            notice = .suspendFailed
        }
    }

    /// Web `toggleEndpoint(key)` — flips one endpoint flag and persists the whole config.
    public func toggleEndpoint(_ key: String) async {
        guard let polling, !isPollingInFlight else { return }
        await write(polling.toggling(key))
    }

    /// Web retention `Select` `onChange` — persists the new capture retention window.
    public func setRetention(_ days: Int) async {
        guard let polling, !isPollingInFlight, days != polling.retentionDays else { return }
        await write(polling.settingRetention(days))
    }

    /// Persists a polling-config edit, mirroring the web mutation's success / error toasts.
    private func write(_ config: PollingConfig) async {
        isPollingInFlight = true
        do {
            try await dataSource.updatePollingConfig(config)
            isPollingInFlight = false
            notice = .pollingUpdated
            await refresh()
        } catch {
            isPollingInFlight = false
            notice = .pollingFailed
        }
    }

    /// Dismisses the active mutation banner.
    public func dismissNotice() {
        notice = nil
    }
}
