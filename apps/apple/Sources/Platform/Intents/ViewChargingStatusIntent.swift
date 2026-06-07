import AppIntents
import SwiftUI

/// Reports the vehicle's charging status from the cached snapshot — answered
/// locally with no networking and no PII, so Siri can speak it hands-free. Falls
/// back to a clear "no data" dialog rather than an empty result.
public struct ViewChargingStatusIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.charging.title"
    public static let description = IntentDescription("intent.charging.description")
    public static let openAppWhenRun = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        guard let charging = IntentSnapshotReader.current()?.charging else {
            return .result(
                dialog: IntentDialog("intent.charging.noData"),
                view: EmptyView()
            )
        }
        let dialog: IntentDialog = charging.isActive
            ? IntentDialog("intent.charging.activeSpoken \(charging.batteryDisplay) \(charging.powerDisplay ?? "")")
            : IntentDialog("intent.charging.idleSpoken \(charging.batteryDisplay)")
        return .result(dialog: dialog, view: ChargingStatusSnippet(summary: charging))
    }
}
