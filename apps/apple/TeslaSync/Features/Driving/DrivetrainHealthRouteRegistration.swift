import SwiftUI

/// Registers the native Drivetrain Health surface for the `.drivetrainHealth` route so the app shell's
/// route host renders it. The web route `/drivetrain-health` resolves to `.drivetrainHealth` directly
/// through the canonical path segment (`AppRoute.drivetrainHealth.pathSegment == "drivetrain-health"`),
/// so registering here makes the page reachable + deep-linkable from the sidebar, the iPhone "More"
/// list, and universal links. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is
/// built on the main actor here and captured, so the escaping registry closure never constructs an
/// isolated type.
public enum DrivetrainHealthRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DrivetrainHealthPageDataSource = SampleDrivetrainHealthDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DrivetrainHealthPageModel(dataSource: dataSource)
        registry.register(.drivetrainHealth) {
            DrivetrainHealthPage(model: model)
        }
        return registry
    }
}
