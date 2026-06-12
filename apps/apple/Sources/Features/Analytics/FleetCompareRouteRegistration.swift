import SwiftUI

/// Registers the native Fleet Comparison surface for the `.fleetCompare` route so the app
/// shell's route host renders it (web `/vehicle-comparison`). Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route `/vehicle-comparison` resolves to this dedicated route directly via the
/// route's `pathSegment` (no alias needed), keeping the page reachable + deep-linkable. The
/// disambiguation banner's dismissal is persisted across launches (web localStorage
/// `phase40.compareBanner.dismissed.fleet`), and the two CTAs (Manage vehicles / Period
/// comparison) navigate through the injected `onNavigate` shell hook.
public enum FleetCompareRouteRegistration {
    /// Web localStorage key for the period-compare disambiguation banner dismissal.
    private static let bannerDismissedKey = "phase40.compareBanner.dismissed.fleet"

    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any FleetCompareDataSource = SampleFleetCompareDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let dismissed = UserDefaults.standard.bool(forKey: bannerDismissedKey)
        let model = FleetComparePageModel(
            dataSource: dataSource,
            bannerVisible: !dismissed,
            onDismissBanner: { UserDefaults.standard.set(true, forKey: bannerDismissedKey) }
        )
        registry.register(.fleetCompare) {
            FleetComparePage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
