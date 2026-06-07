import AppIntents

/// Opens TeslaSync to the live map. Navigation-only: it foregrounds the app and
/// the in-app map screen owns all location handling and privacy.
public struct OpenLiveMapIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.openLiveMap.title"
    public static let description = IntentDescription("intent.openLiveMap.description")
    public static let openAppWhenRun = true

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        IntentBridge.shared.requestRoute(.maps)
        return .result(dialog: IntentDialog("intent.openLiveMap.opening"))
    }
}
