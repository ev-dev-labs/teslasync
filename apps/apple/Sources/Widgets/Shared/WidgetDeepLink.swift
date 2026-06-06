import Foundation

/// Typed deep links from each widget into the matching app route. Building the URL
/// here (one enum) keeps every widget's `widgetURL`/`Link` honest and lets a single
/// test assert each link resolves through the app's `AppRouteParser` to the right
/// `AppRoute`, so a renamed route can never silently break a widget tap.
public enum WidgetDeepLink: String, CaseIterable, Sendable {
    case vehicleStatus
    case charging
    case recentDrive
    case alerts
    case energy
    case systemHealth

    /// The canonical app route path segment this link targets. These match
    /// `AppRoute.pathSegment` (and the `AppRouteParser` aliases) one-to-one.
    public var routeSegment: String {
        switch self {
        case .vehicleStatus: "vehicles"
        case .charging: "charging"
        case .recentDrive: "trips"
        case .alerts: "notifications"
        case .energy: "energy"
        case .systemHealth: "system"
        }
    }

    /// The `teslasync://<segment>` URL the system opens the app with on tap.
    public var url: URL {
        var components = URLComponents()
        components.scheme = WidgetURLScheme.scheme
        components.host = routeSegment
        return components.url ?? fallbackURL
    }

    private var fallbackURL: URL {
        URL(string: "\(WidgetURLScheme.scheme)://") ?? URL(fileURLWithPath: "/")
    }
}
