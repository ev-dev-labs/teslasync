import SwiftUI

/// Registers the native Fleet Analytics surface for the `.analytics` route so the app shell's route
/// host renders it. The web route `/analytics` is the canonical path of the `.analytics` `AppRoute`
/// (its `pathSegment`) and the page is a primary tab, so Fleet Analytics is the route's rightful
/// owner. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on the main
/// actor here and captured, so the escaping registry closure never constructs an isolated type. The
/// Overview tab's quick links navigate through the injected `onNavigate` shell hook (web `<Link>`).
public enum AnalyticsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any AnalyticsDataSource = SampleAnalyticsDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = AnalyticsPageModel(dataSource: dataSource)
        registry.register(.analytics) {
            AnalyticsPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
