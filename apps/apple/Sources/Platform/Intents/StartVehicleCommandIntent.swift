import AppIntents

/// Starts a vehicle command (wake, climate, lock, charge, …) from Siri / Shortcuts.
///
/// Safety contract (ADR-005): the command is gated by `VehicleCommandGate`
/// (requires a session AND backend permission), then **confirmed** before it runs.
/// The privileged execution happens in-app — the intent only enqueues a
/// non-personal `VehicleCommandRequest` via `IntentBridge` and foregrounds the app,
/// so no tokens, VIN, or location ever touch the out-of-process intent.
public struct StartVehicleCommandIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.command.title"
    public static let description = IntentDescription("intent.command.description")
    public static let openAppWhenRun = true
    /// The device must be unlocked to start a physical command.
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "intent.param.command")
    public var command: VehicleCommandKind

    @Parameter(title: "intent.param.vehicle")
    public var vehicle: VehicleEntity?

    public init() {}

    public init(command: VehicleCommandKind, vehicle: VehicleEntity? = nil) {
        self.command = command
        self.vehicle = vehicle
    }

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let bridge = IntentBridge.shared
        let decision = VehicleCommandGate.evaluate(
            command,
            isAuthenticated: bridge.isAuthenticated,
            permitted: bridge.permittedCommands
        )
        if let error = IntentGateError.error(for: decision, kind: command) {
            throw error
        }

        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog(command.confirmationPromptResource)
        )

        bridge.enqueueCommand(VehicleCommandRequest(kind: command, vehicleID: vehicle?.id))
        return .result(dialog: IntentDialog("intent.command.started \(String(localized: command.titleResource))"))
    }
}
