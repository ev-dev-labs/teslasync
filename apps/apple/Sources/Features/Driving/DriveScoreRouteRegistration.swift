import SwiftUI

/// Registers the native Drive Score surface for the `.driving` route so the app shell's route host
/// renders it. The web route `/drive-score` resolves to `.driving` through `AppRouteParser.aliases`
/// (`"/drive-score": .driving`), so registering here makes the page reachable + deep-linkable without
/// a new route case. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built
/// on the main actor here and captured, so the escaping registry closure never constructs an isolated
/// type.
public enum DriveScoreRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DriveScoreDataSource = SampleDriveScoreDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DriveScorePageModel(dataSource: dataSource)
        registry.register(.driving) {
            DriveScorePage(model: model)
        }
        return registry
    }
}
