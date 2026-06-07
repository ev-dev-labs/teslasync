import AppIntents

/// Opens TeslaSync to the vehicles screen (optionally focused on a chosen
/// vehicle). A pure navigation intent: it foregrounds the app and hands the route
/// to it through `IntentBridge`, so no business logic is duplicated here.
public struct OpenVehicleIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.openVehicle.title"
    public static let description = IntentDescription("intent.openVehicle.description")
    public static let openAppWhenRun = true

    @Parameter(title: "intent.param.vehicle")
    public var vehicle: VehicleEntity?

    public init() {}

    public init(vehicle: VehicleEntity? = nil) {
        self.vehicle = vehicle
    }

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        IntentBridge.shared.requestRoute(.vehicles)
        if let vehicle {
            return .result(dialog: IntentDialog("intent.openVehicle.opening \(vehicle.name)"))
        }
        return .result(dialog: IntentDialog("intent.openVehicle.openingList"))
    }
}
