import AppIntents
import SwiftUI

/// Speaks the most recent open alert from the cached snapshot (no networking, no
/// PII) and offers a glanceable snippet. Reports "all clear" when there are no
/// open alerts rather than failing.
public struct ShowLatestAlertIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.alert.title"
    public static let description = IntentDescription("intent.alert.description")
    public static let openAppWhenRun = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        guard let alerts = IntentSnapshotReader.current()?.alerts, alerts.openCount > 0 else {
            return .result(dialog: IntentDialog("intent.alert.allClear"), view: EmptyView())
        }
        let dialog: IntentDialog = alerts.latestTitle.map {
            IntentDialog("intent.alert.latestSpoken \($0)")
        } ?? IntentDialog("intent.alert.openCount \(alerts.openCount)")
        return .result(dialog: dialog, view: LatestAlertSnippet(summary: alerts))
    }
}
