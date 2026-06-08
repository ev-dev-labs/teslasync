#if canImport(Shared)
    import Foundation
    import Shared

    /// Production `DrivetrainHealthProvider` backing the dashboard widget with the
    /// shared KMP state holders — `DrivingStore.drivetrainHealth` (web
    /// `useDrivetrainHealth`) and `VehiclesStore.motorLatest` (web `useMotorLatest`).
    ///
    /// Both feeds emit `Resource<JsonElement>` (cache-then-network). This adapter
    /// bridges each flow with `FlowBridge`, projects every emission into a
    /// `LoadableState` via the facade helper, decodes the JSON payloads with the pure
    /// `DrivetrainHealthDecoder` (host-tested in `DrivetrainHealthWidget.swift`), and
    /// composes the widget view state — honoring cached-while-refreshing and
    /// staleness (ADR-013). The view never sees HTTP; it binds only to this seam.
    ///
    /// KMP-interop surface — the `Resource` / `StateFlow` Swift symbol names and the
    /// `JsonElement` → JSON-text extraction — is finalized against the built
    /// `Shared.xcframework` on the macOS gate (see `apps/macos-pending-verifications.md`),
    /// mirroring the proven `VehicleSettingsModel` / `StateHolderModel` / `FlowBridge`
    /// bindings. The `#if canImport(Shared)` guard keeps the Shared-free host gates
    /// compiling this surface to nothing when the framework is absent.
    @MainActor
    public final class LiveDrivetrainHealthProvider: DrivetrainHealthProvider {
        private let drivingStore: DrivingStore
        private let vehiclesStore: VehiclesStore
        private let vehicleID: Int64

        private var onState: ((DrivetrainHealthViewState) -> Void)?
        private var healthState: LoadableState<DrivetrainHealthReading> = .idle
        private var motorState: LoadableState<DrivetrainMotorReading> = .idle
        private var healthTask: Task<Void, Never>?
        private var motorTask: Task<Void, Never>?

        public init(drivingStore: DrivingStore, vehiclesStore: VehiclesStore, vehicleID: Int64) {
            self.drivingStore = drivingStore
            self.vehiclesStore = vehiclesStore
            self.vehicleID = vehicleID
        }

        public func start(onState: @escaping (DrivetrainHealthViewState) -> Void) {
            self.onState = onState
            subscribe()
        }

        public func stop() {
            healthTask?.cancel()
            healthTask = nil
            motorTask?.cancel()
            motorTask = nil
        }

        /// No per-feed refresh is exposed by the shared stores, so re-subscribing
        /// re-reads each feed cache-then-network (the same effect as the web refetch).
        public func refresh() {
            stop()
            subscribe()
        }

        private func subscribe() {
            let healthFlow = drivingStore.drivetrainHealth(vehicleId: String(vehicleID))
            let motorFlow = vehiclesStore.motorLatest(vehicleId: vehicleID)

            healthTask = collect(healthFlow) { [weak self] resource in
                guard let self else { return }
                healthState = LoadableState.from(resource) { Self.reading($0) }
                emit()
            }
            motorTask = collect(motorFlow) { [weak self] resource in
                guard let self else { return }
                motorState = LoadableState.from(resource) { Self.motor($0) }
                emit()
            }
        }

        private func collect(
            _ flow: Shared.Kotlinx_coroutines_coreStateFlow,
            _ onResource: @escaping (Shared.Resource) -> Void
        ) -> Task<Void, Never> {
            Task { @MainActor [weak self] in
                guard self != nil else { return }
                do {
                    for try await value in FlowBridge.stream(from: flow) {
                        if Task.isCancelled { break }
                        if let resource = value as? Shared.Resource {
                            onResource(resource)
                        }
                    }
                } catch {
                    // A `StateFlow` never completes or fails; this guards the throwing
                    // bridge signature. A terminal error simply ends the subscription.
                }
            }
        }

        private func emit() {
            let projection = DrivetrainHealthProjection(health: healthState.value, motor: motorState.value)
            let isLoading = healthState.isLoading || motorState.isLoading
            let isStale = healthState.isStale || motorState.isStale
            let failed = healthState.error != nil || motorState.error != nil

            if !projection.hasData {
                if isLoading {
                    onState?(.loading(cached: nil))
                } else if failed {
                    onState?(.failed(message: nil, cached: nil))
                } else {
                    onState?(.empty(freshness: isStale ? .stale : .offline))
                }
                return
            }

            if failed {
                onState?(.failed(message: nil, cached: projection))
                return
            }
            if isLoading {
                onState?(.loading(cached: projection))
                return
            }
            onState?(.loaded(projection, freshness: isStale ? .stale : .fresh))
        }

        private static func reading(_ raw: Any) -> DrivetrainHealthReading? {
            DrivetrainHealthDecoder.reading(from: jsonData(raw))
        }

        private static func motor(_ raw: Any) -> DrivetrainMotorReading? {
            DrivetrainHealthDecoder.motor(from: jsonData(raw))
        }

        /// `kotlinx.serialization.json.JsonElement.toString()` emits valid JSON; the
        /// bridged Obj-C `description` forwards to it. Pinned on the macOS gate.
        private static func jsonData(_ raw: Any) -> Data? {
            String(describing: raw).data(using: .utf8)
        }
    }
#endif
