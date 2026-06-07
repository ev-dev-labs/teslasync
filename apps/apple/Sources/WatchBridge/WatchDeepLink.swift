import Foundation

/// Typed deep links the watch can ask the paired iPhone to open. They reuse the
/// app's `teslasync://` scheme and resolve through the very same `AppRouteParser`
/// the widgets and notifications use, so a renamed route can never silently break a
/// "open on iPhone" tap. Like the widget links, they carry only a route — no
/// identifiers, tokens, or query.
public enum WatchDeepLink: String, CaseIterable, Sendable {
    case dashboard
    case vehicles
    case charging
    case energy
    case notifications

    /// The canonical app route path segment this link targets. These match
    /// `AppRoute.pathSegment` one-to-one.
    public var routeSegment: String {
        switch self {
        case .dashboard: "dashboard"
        case .vehicles: "vehicles"
        case .charging: "charging"
        case .energy: "energy"
        case .notifications: "notifications"
        }
    }

    /// The `teslasync://<segment>` URL the watch hands the phone to open.
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
