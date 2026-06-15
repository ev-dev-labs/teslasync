import SwiftUI

/// Registers the native Feedback Queue surface for the `.feedbackQueue` route so the
/// app shell's route host renders it (web `/admin/feedback`). Mirrors
/// `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/feedback`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar
/// entry), keeping the page reachable + deep-linkable without displacing the sibling
/// admin pages.
public enum FeedbackQueueRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any FeedbackQueueDataSource = SampleFeedbackQueueDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = FeedbackQueuePageModel(dataSource: dataSource)
        registry.register(.feedbackQueue) {
            FeedbackQueuePage(model: model)
        }
        return registry
    }
}
