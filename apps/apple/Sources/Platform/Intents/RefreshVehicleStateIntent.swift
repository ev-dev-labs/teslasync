import AppIntents

/// Requests a fresh pull of vehicle state. The live refresh runs **in-app** (where
/// the authenticated session + SSE live), so the intent records the request via
/// `IntentBridge`, foregrounds the app, and reports back. Requires a session.
public struct RefreshVehicleStateIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.refresh.title"
    public static let description = IntentDescription("intent.refresh.description")
    public static let openAppWhenRun = true

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        guard IntentBridge.shared.isAuthenticated else {
            throw TeslaSyncIntentError.needsAuthentication
        }
        IntentBridge.shared.requestRefresh()
        IntentBridge.shared.requestRoute(.vehicles)
        return .result(dialog: IntentDialog("intent.refresh.started"))
    }
}
