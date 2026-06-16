import SwiftUI

/// Registers the native Period Comparison surface for the `.periodCompare` route so the app
/// shell's route host renders it (web `/period-compare`). Mirrors the sibling
/// `FleetCompareRouteRegistration`: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route `/period-compare` is single-segment, so it resolves directly via the route's
/// `pathSegment` (no alias needed), keeping the page reachable + deep-linkable. The disambiguation
/// banner's dismissal is persisted across launches (web localStorage
/// `phase40.compareBanner.dismissed.period`), and its CTA navigates to the Fleet comparison page
/// through the injected `onNavigate` shell hook.
public enum PeriodCompareRouteRegistration {
    /// Web localStorage key for the period-compare disambiguation banner dismissal.
    private static let bannerDismissedKey = "phase40.compareBanner.dismissed.period"

    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any PeriodCompareDataSource = SamplePeriodCompareDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let dismissed = UserDefaults.standard.bool(forKey: bannerDismissedKey)
        let model = PeriodComparePageModel(
            dataSource: dataSource,
            bannerVisible: !dismissed,
            onDismissBanner: { UserDefaults.standard.set(true, forKey: bannerDismissedKey) }
        )
        registry.register(.periodCompare) {
            PeriodComparePage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
