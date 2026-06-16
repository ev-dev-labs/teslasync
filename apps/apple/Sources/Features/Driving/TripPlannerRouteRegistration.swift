import SwiftUI

/// Registers the native Trip Planner surface for the `.tripPlanner` route so the app shell's route host
/// renders it. The web route `/trip-planner` resolves to `.tripPlanner` directly through the canonical
/// path segment (`AppRoute.tripPlanner.pathSegment == "trip-planner"`), so registering here makes the
/// page reachable + deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the `@Observable`
/// model is built on the main actor here and captured, so the escaping registry closure never
/// constructs an isolated type.
public enum TripPlannerRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any TripPlannerDataSource = SampleTripPlannerDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = TripPlannerPageModel(dataSource: dataSource)
        registry.register(.tripPlanner) {
            TripPlannerPage(model: model)
        }
        return registry
    }
}
