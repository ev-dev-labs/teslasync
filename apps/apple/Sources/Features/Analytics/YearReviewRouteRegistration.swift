import SwiftUI

/// Registers the native Year-in-Review story for the `.yearReview` route so the app shell's route
/// host renders it, and so the deep link `/year-review/:year` resolves through `AppRouteParser`
/// (the `year-review` path segment matches the route, IDs after it are tolerated). Mirrors the
/// sibling analytics `*RouteRegistration` enums: the `@Observable` model is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type. `onExit`
/// is the native equivalent of the web `navigate(-1)` close affordance (the shell routes it back to
/// the analytics surface, the web parent of this hidden route).
public enum YearReviewRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any YearReviewDataSource = SampleYearReviewDataSource(),
        onExit: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = YearReviewPageModel(dataSource: dataSource)
        registry.register(.yearReview) {
            YearReviewPage(model: model, onExit: onExit)
        }
        return registry
    }
}
