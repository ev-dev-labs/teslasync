import Foundation
import Observation

/// The `@Observable` state holder the Ingest X-Ray page binds to (ADR-004 — no networking in
/// the view). Owns the operator's three selections (web `vehicleId` / `windowSel` / `bucketSel`
/// `useState`), the vehicle-list + X-Ray query states, and the fields-table sort (web
/// `useSortToggle('sample_count', 'desc')`), reading both feeds through the injected
/// `IngestXRayDataSource`. Mirrors the sibling self-contained admin page models
/// (`DLQInspectorPageModel`) while composing the P3 X-Ray component projections at the view.
///
/// The X-Ray is fetched only once a vehicle is selected (web `enabled: numericId > 0`); the view
/// drives `reloadData()` through a `.task(id: fetchKey)` so changing the vehicle, window, or
/// bucket re-fetches, exactly like the web query key.
@MainActor
@Observable
public final class IngestXRayPageModel {
    /// Web `limit: 100` — caps the returned `fields` rows (buckets are never truncated).
    public static let fieldsLimit = 100

    /// The vehicle-picker render phase (web `XRayControls` vehicle slot): a skeleton on the
    /// initial fetch, the inline error on failure, the empty hint when no vehicles exist, and
    /// the populated picker otherwise. The window + bucket selectors render in every phase.
    public enum ControlsPhase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    // MARK: Operator selections (web `useState`)

    public private(set) var vehicleID: Int?
    public private(set) var window: IngestXRayWindow = .h1
    public private(set) var bucket: IngestXRayBucket = .m1

    // MARK: Query states

    public private(set) var vehiclesState: IngestXRayVehiclesState = .loading
    public private(set) var dataState: IngestXRayDataState = .idle

    // MARK: Fields-table sort (web `useSortToggle('sample_count', 'desc')`)

    public private(set) var sortKey: XRayFieldsSortKey = .sampleCount
    public private(set) var sortDirection: XRaySortDirection = .descending

    @ObservationIgnored private let dataSource: any IngestXRayDataSource

    public init(dataSource: any IngestXRayDataSource = SampleIngestXRayDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived state

    /// The cached vehicle rows (empty unless the list is `.loaded`).
    public var vehicles: [XRayVehicleRef] {
        if case let .loaded(rows) = vehiclesState { return rows }
        return []
    }

    /// The vehicle-picker render phase derived from the list state.
    public var controlsPhase: ControlsPhase {
        switch vehiclesState {
        case .loading: .loading
        case .empty: .empty
        case let .error(message): .error(message)
        case .loaded: .content
        }
    }

    /// Whether a vehicle is selected (web `vehicleId === null` gate between the no-vehicle empty
    /// panel and the header/chart/fields panels).
    public var hasVehicle: Bool {
        vehicleID != nil
    }

    /// The loaded X-Ray (nil unless the query is `.loaded`).
    public var result: IngestXRayResult? {
        if case let .loaded(value) = dataState { return value }
        return nil
    }

    /// The header strip's summary (web `xray.data` → the three `StatCard`s). Nil until the first
    /// successful load, so the strip renders its skeleton/zero state.
    public var summary: IngestXRaySummary? {
        result?.summary
    }

    /// Whether the X-Ray query is on its initial in-flight load (web `xray.isLoading`).
    public var isDataLoading: Bool {
        if case .loading = dataState { return true }
        return false
    }

    /// The `.task(id:)` identity (web query key) — re-fetches on any selection change.
    public var fetchKey: IngestXRayFetchKey {
        IngestXRayFetchKey(vehicleID: vehicleID, window: window, bucket: bucket)
    }

    /// The sorted, display-formatted field rows the table renders (web `const sorted = [...].sort`
    /// + the column `render` callbacks). Re-derived by the view so a locale change or a sort
    /// toggle refreshes the projection.
    public func fieldRows(context: XRayFieldsRenderContext = XRayFieldsRenderContext()) -> [XRayFieldRow] {
        guard let result else { return [] }
        return XRayFieldsProjector.project(
            rows: result.fields,
            sortKey: sortKey,
            sortDirection: sortDirection,
            context: context
        )
    }

    // MARK: - Loading

    /// Mounts both feeds. Loads the vehicle list, then — if a vehicle is already selected (e.g. a
    /// deep link) — the X-Ray. The view also binds `reloadData()` to `fetchKey` for re-fetches.
    public func load() async {
        await loadVehicles()
        await reloadData()
    }

    /// Re-runs the vehicle-list query (web `useVehicles → GET /vehicles`). A previously-loaded
    /// list stays selectable through a transient failure is not required here — the picker simply
    /// surfaces loading / empty / error / content.
    public func loadVehicles() async {
        vehiclesState = .loading
        do {
            let rows = try await dataSource.loadVehicles()
            vehiclesState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            vehiclesState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the X-Ray query for the current selection (web `useIngestXRay`). No request is made
    /// without a selected vehicle (web `enabled: numericId > 0`) — the state resets to `.idle` so
    /// the no-vehicle empty panel shows instead.
    public func reloadData() async {
        guard let vehicleID else {
            dataState = .idle
            return
        }
        dataState = .loading
        do {
            let result = try await dataSource.loadXRay(
                vehicleID: vehicleID,
                window: window,
                bucket: bucket,
                limit: Self.fieldsLimit
            )
            dataState = result.isEmpty ? .empty : .loaded(result)
        } catch {
            dataState = .error(error.localizedDescription)
        }
    }

    // MARK: - Selections (web `setVehicleId` / `onWindowChange` / `onBucketChange`)

    /// Web `onVehicleChange` — selects (or clears) the vehicle. Clearing resets the X-Ray to
    /// `.idle` so the no-vehicle panel returns; the view's `.task(id: fetchKey)` performs the
    /// fetch when a vehicle is chosen.
    public func selectVehicle(_ id: Int?) {
        guard id != vehicleID else { return }
        vehicleID = id
        if id == nil {
            dataState = .idle
        }
    }

    /// Web `onWindowChange` — selects the observation window. The view re-fetches via `fetchKey`.
    public func selectWindow(_ window: IngestXRayWindow) {
        self.window = window
    }

    /// Web `onBucketChange` — selects the aggregation bucket. The view re-fetches via `fetchKey`.
    public func selectBucket(_ bucket: IngestXRayBucket) {
        self.bucket = bucket
    }

    /// Web `useSortToggle.onSort` — tapping the active column flips the direction; a new column
    /// selects it descending. Reuses the X-Ray fields component's pure transition.
    public func toggleSort(_ key: XRayFieldsSortKey) {
        let next = XRayFieldsModel.nextSort(current: sortKey, direction: sortDirection, tapped: key)
        sortKey = next.key
        sortDirection = next.direction
    }
}
