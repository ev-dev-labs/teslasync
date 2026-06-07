import Foundation

/// Defines the `NSUserActivity` that carries the user's current TeslaSync route so
/// it can be **continued on another device** (Handoff), restored from a Universal
/// Link, surfaced by Siri prediction, and indexed by Spotlight.
///
/// The activity carries only a route segment in `userInfo` — never a VIN,
/// location, token, or any PII (ADR-005). Route parsing reuses the same
/// `AppRouteParser` the deep-link + widget paths use, so a renamed route can never
/// silently break continuation.
public enum HandoffActivity {
    /// Activity type for "continue the current page". Must match the
    /// `NSUserActivityTypes` array in both Info.plists.
    public static let routeActivityType = "io.teslasync.app.route"

    /// `userInfo` key holding the route's canonical path segment.
    public static let routeKey = "route"

    /// Default Universal Link host used for `webpageURL` continuation. Overridable
    /// via the `TeslaSyncWebBaseURL` Info.plist key so a deployment can point at
    /// its own domain (must be listed in the app's associated-domains entitlement).
    public static let defaultWebHost = "app.teslasync.io"

    /// Builds the advertised activity for `route`, eligible for Handoff, Spotlight
    /// search, and prediction.
    public static func activity(
        for route: AppRoute,
        bundle: Bundle = .main
    ) -> NSUserActivity {
        let activity = NSUserActivity(activityType: routeActivityType)
        configure(activity, for: route, bundle: bundle)
        return activity
    }

    /// Populates a (possibly system-reused) activity object for `route`. Used by the
    /// SwiftUI `.advertiseRouteActivity` modifier, which hands back one activity to
    /// reconfigure as the selection changes.
    public static func configure(
        _ activity: NSUserActivity,
        for route: AppRoute,
        bundle: Bundle = .main
    ) {
        activity.title = localizedTitle(for: route)
        activity.userInfo = [routeKey: route.pathSegment]
        activity.requiredUserInfoKeys = [routeKey]
        activity.isEligibleForHandoff = true
        activity.isEligibleForSearch = true
        #if os(iOS)
            activity.isEligibleForPrediction = true
        #endif
        activity.persistentIdentifier = "\(routeActivityType).\(route.pathSegment)"
        activity.webpageURL = webURL(for: route, bundle: bundle)
    }

    /// Resolves the route an incoming activity should restore: prefer the explicit
    /// `userInfo` segment, then fall back to the `webpageURL` (Universal Link).
    public static func route(from activity: NSUserActivity) -> AppRoute? {
        let segment = activity.userInfo?[routeKey] as? String
        if let segment, let route = AppRouteParser.parse(path: "/" + segment) {
            return route
        }
        if let url = activity.webpageURL {
            return AppRouteParser.parse(url: url)
        }
        return nil
    }

    /// The Universal Link that continues `route` on the web / another device.
    public static func webURL(for route: AppRoute, bundle: Bundle = .main) -> URL? {
        let host = (bundle.object(forInfoDictionaryKey: "TeslaSyncWebBaseURL") as? String)
            .flatMap(URL.init(string:))?.host ?? defaultWebHost
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = route.path
        return components.url
    }

    private static func localizedTitle(for route: AppRoute) -> String {
        String(localized: String.LocalizationValue("route." + route.rawValue), bundle: .main)
    }
}
