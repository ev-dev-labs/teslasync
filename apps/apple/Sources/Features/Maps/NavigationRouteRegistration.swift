import SwiftUI

/// Navigation registration for the parity unit `NavigationRoutePage` (web route `/navigation`). The web
/// route resolves to the maps domain (`AppRoute.maps`, pathSegment `maps`, Vehicle group): the existing
/// `/location` alias and a new `/navigation` alias both map to `.maps` via `AppRouteParser`, and this
/// registration hosts `NavigationRoutePage` on that route so the app shell's route host renders it. The
/// `@Observable` model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type — mirroring the sibling `…RouteRegistration` factories.
public enum NavigationRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any NavigationRouteDataSource = SampleNavigationRouteDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = NavigationRoutePageModel(dataSource: dataSource)
        registry.register(.maps) {
            NavigationRoutePage(model: model)
        }
        return registry
    }

    /// Builds the screen with the given data source (default = sample), for hosts that want a
    /// ready-built screen without constructing the model.
    @MainActor
    public static func make(
        dataSource: any NavigationRouteDataSource = SampleNavigationRouteDataSource()
    ) -> NavigationRoutePage {
        NavigationRoutePage(model: NavigationRoutePageModel(dataSource: dataSource))
    }
}
