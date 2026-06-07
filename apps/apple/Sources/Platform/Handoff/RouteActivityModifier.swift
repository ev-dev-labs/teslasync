import SwiftUI

public extension View {
    /// Advertises the given route as the current user activity so the system can
    /// offer Handoff to another device, index it for Spotlight, and learn it for
    /// Siri prediction. Passing `nil` makes the activity inactive.
    func advertiseRouteActivity(_ route: AppRoute?) -> some View {
        userActivity(HandoffActivity.routeActivityType, isActive: route != nil) { activity in
            guard let route else { return }
            HandoffActivity.configure(activity, for: route)
        }
    }

    /// Restores a route from an incoming Handoff / Universal Link / Spotlight
    /// continuation, calling `action` with the resolved route.
    func onContinueRouteActivity(perform action: @escaping (AppRoute) -> Void) -> some View {
        onContinueUserActivity(HandoffActivity.routeActivityType) { activity in
            if let route = HandoffActivity.route(from: activity) {
                action(route)
            }
        }
    }
}
