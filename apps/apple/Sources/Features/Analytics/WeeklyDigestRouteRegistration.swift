import SwiftUI

/// Registers the native Weekly Digest surface for the `.weeklyDigest` route so the app shell's route
/// host renders it. The web route `/weekly-digest` is the canonical path of the `.weeklyDigest`
/// `AppRoute` (its `pathSegment`) — linked from the Fleet Analytics quick links — so the Weekly Digest
/// page is the route's rightful owner. Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
public enum WeeklyDigestRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any WeeklyDigestDataSource = SampleWeeklyDigestDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = WeeklyDigestPageModel(dataSource: dataSource)
        registry.register(.weeklyDigest) {
            WeeklyDigestPage(model: model)
        }
        return registry
    }
}
