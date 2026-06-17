import SwiftUI

/// Registers the native web-parity Settings surface for the `.settingsPage` route so the app
/// shell's route host renders it (web `/settings`). Mirrors the sibling `*RouteRegistration`
/// enums: the `@Observable` model is built on the main actor here and captured, so the
/// escaping registry closure never constructs an isolated type.
///
/// The web `/settings` route is also exposed as a deep-link alias to this dedicated route
/// (`AppRouteParser`), keeping the page reachable + deep-linkable. The Data Export card
/// navigates through the injected `onNavigate` shell hook (web `<a href="/data-export">`),
/// distinct from the platform-native `AppSettingsView` consolidated preferences surface that
/// owns the `.settings` route.
public enum SettingsPageRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SettingsPageDataSource = SampleSettingsPageDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SettingsPageModel(dataSource: dataSource)
        registry.register(.settingsPage) {
            SettingsPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
