import Foundation
import Observation

// MARK: - Page model

/// The `@Observable` state holder the `TripPlannerPage` binds to (ADR-004 — no networking in the view).
/// Owns the route-input form (web `originText` / `destText` / `currentSOC` / `minArrivalSOC` /
/// `speedFactor`), the selected vehicle (web `useSelectedVehicle`), and the plan-result phase (web
/// `usePlanTrip` mutation). Conversion runs through the shared `Units` facade at the render boundary
/// only; the active unit preference is mirrored from the view environment so unit-dependent display
/// recomputes on change.
@MainActor
@Observable
public final class TripPlannerPageModel {
    // MARK: Form state (web component state)

    /// Web `originText` — the typed origin address.
    public var originText: String = ""
    /// Web `destText` — the typed destination address.
    public var destText: String = ""
    /// Web `currentSOC` (default 80) — the start state-of-charge percent.
    public var currentSOC: Double = 80
    /// Web `minArrivalSOC` (default 20) — the minimum acceptable arrival state-of-charge percent.
    public var minArrivalSOC: Double = 20
    /// Web `speedFactor` (default `1.0` == `.normal`) — the driving-speed preference.
    public var speedOption: TripSpeedOption = .normal

    // MARK: Result state (web `usePlanTrip` mutation + `plan`)

    /// The plan-result region phase (web mutation lifecycle: idle → planning → failed/loaded).
    public private(set) var planPhase: TripPlanPhase = .idle

    // MARK: Vehicle (web `useSelectedVehicle`)

    public private(set) var vehicles: [TripPlannerVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    // MARK: Display preferences

    /// The active display-unit preference, mirrored from the view environment (web `useUnits`).
    public var units: UnitPreferences = .metric
    /// The user's currency symbol (web `useFormatting().currencySymbol`, default `$`).
    public let currencySymbol: String

    @ObservationIgnored private let dataSource: any TripPlannerDataSource

    public init(
        dataSource: any TripPlannerDataSource = SampleTripPlannerDataSource(),
        currencySymbol: String = "$",
        initialPhase: TripPlanPhase = .idle
    ) {
        self.dataSource = dataSource
        self.currencySymbol = currencySymbol
        planPhase = initialPhase
    }

    // MARK: Derived

    public var selectedVehicle: TripPlannerVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// Web `canPlan = origin != null && destination != null && activeVehicle !== ''`. Here the typed
    /// origin/destination stand in for the geocoded locations (the rich autocomplete is the sibling
    /// `AddressInput` parity unit); a vehicle must be selected.
    public var canPlan: Bool {
        !trimmedOrigin.isEmpty && !trimmedDestination.isEmpty && selectedVehicleID != nil
    }

    /// Web `planMutation.isPending`.
    public var isPlanning: Bool {
        planPhase == .planning
    }

    /// Web `plan` (the loaded result, else `nil`).
    public var plan: TripPlan? {
        if case let .loaded(plan) = planPhase { return plan }
        return nil
    }

    /// The available driving-speed options (web `speedOptions`).
    public var speedOptions: [TripSpeedOption] {
        TripSpeedOption.allCases
    }

    private var trimmedOrigin: String {
        originText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedDestination: String {
        destText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Loading (web `useSelectedVehicle` → vehicle list + current battery)

    /// Loads the selectable vehicles (web `useVehicles` / `useSelectedVehicle`). Quiet — the form is
    /// usable immediately; a missing list just disables planning until a vehicle resolves.
    public func load() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
    }

    /// Selects a vehicle (web global `VehicleSelect`).
    public func selectVehicle(_ id: Int64) {
        guard vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
    }

    // MARK: Planning (web `handlePlan` + `planMutation.mutate`)

    /// Computes the trip plan (web `handlePlan`): builds the `TripPlanRequest` from the form state and
    /// runs the `usePlanTrip` mutation, transitioning `planPhase` through `planning` → `loaded`/`failed`.
    public func planTrip() async {
        guard canPlan, let vehicleID = selectedVehicleID else { return }
        let request = TripPlanRequest(
            vehicleID: vehicleID,
            origin: TripLocation(lat: 0, lng: 0, name: trimmedOrigin),
            destination: TripLocation(lat: 0, lng: 0, name: trimmedDestination),
            currentSoc: currentSOC,
            chargeLimitSoc: 90,
            minArrivalSoc: minArrivalSOC,
            speedFactor: speedOption.factor,
            includeWeather: true,
            preferSuperchargers: true
        )
        planPhase = .planning
        do {
            let plan = try await dataSource.planTrip(request)
            planPhase = .loaded(plan)
        } catch {
            planPhase = .failed(error.localizedDescription)
        }
    }

    // MARK: Send to car (web `handleSendToCar`)

    /// Pushes the planned destination to the vehicle's navigation (web `handleSendToCar` →
    /// `navigation_request`). Uses the plan's resolved destination coordinates; errors are swallowed
    /// (web ignores the rejection — surfaced only via the global toast).
    public func sendToCar() async {
        guard let vehicleID = selectedVehicleID, let destination = plan?.resolvedDestination else { return }
        try? await dataSource.sendToCar(vehicleID: vehicleID, destination: destination)
    }

    // MARK: Preferences

    /// Mirrors the active unit preference from the view environment (web `useUnits`).
    public func setUnits(_ preferences: UnitPreferences) {
        guard preferences != units else { return }
        units = preferences
    }

    /// Retries a failed plan (the error data state's Retry affordance).
    public func retry() async {
        await planTrip()
    }
}
