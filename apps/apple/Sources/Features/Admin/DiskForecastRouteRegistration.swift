import SwiftUI

/// Registers the native Disk Forecast surface so the app shell's route host renders it
/// (web `/admin/disk-forecast`). Mirrors `ApiPlaygroundRouteRegistration` /
/// `SettingsRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/disk-forecast`, which `AppRouteParser`
/// resolves to the top-level `.admin` route (the parser keys on the first path segment).
/// Until a native admin landing page + sub-router lands, this hosts the Disk Forecast
/// page directly on `.admin` (currently a pending route) so the page is reachable via
/// the System group sidebar entry and any `/admin/*` deep link. When the admin
/// sub-router lands this becomes a `/admin/disk-forecast` `NavigationDestination`.
public enum DiskForecastRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DiskForecastDataSource = SampleDiskForecastDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DiskForecastPageModel(dataSource: dataSource)
        registry.register(.admin) {
            DiskForecastPage(model: model)
        }
        return registry
    }
}
