import SwiftUI

/// Registers the native Timeline surface for the `.timeline` route so the app shell's route host
/// renders it. The web route `/timeline` resolves to the `.timeline` `AppRoute` (its default
/// `pathSegment` is `timeline`), so registering here makes the page reachable + deep-linkable and
/// adds the Insights sidebar entry. Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry
/// closure never constructs an isolated type.
public enum TimelineRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any TimelineDataSource = SampleTimelineDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = TimelinePageModel(dataSource: dataSource)
        registry.register(.timeline) {
            TimelinePage(model: model)
        }
        return registry
    }
}
