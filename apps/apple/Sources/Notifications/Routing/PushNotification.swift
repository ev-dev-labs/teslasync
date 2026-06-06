import Foundation

/// The severity TeslaSync attaches to an alert push. Mirrors the web
/// `('info' | 'warn' | 'critical')` severity; `warn` is normalised to `warning`.
/// `critical` is the only severity allowed to bypass quiet hours.
public enum PushSeverity: String, Codable, CaseIterable, Sendable {
    case info
    case warning
    case critical

    /// Parses a server severity string, mapping the web `warn` spelling to
    /// `warning`; unknown/empty values resolve to `nil`.
    public static func parse(_ raw: String?) -> PushSeverity? {
        switch raw?.lowercased() {
        case "info": .info
        case "warn", "warning": .warning
        case "critical", "crit": .critical
        default: nil
        }
    }

    /// Whether this severity may break through quiet hours / the foreground mute.
    public var bypassesQuietHours: Bool {
        self == .critical
    }
}

/// A parsed, Shared-free APNs notification: the routed view it should open plus
/// the display + diagnostic metadata the coordinator and foreground banner read.
/// Produced by `PushPayloadParser` from the raw `userInfo`, so the rest of the app
/// never touches `[AnyHashable: Any]`.
public struct PushNotification: Equatable, Sendable, Identifiable {
    public let id: String
    public let category: PushCategory
    public let title: String?
    public let body: String?
    /// The route a tap opens — an explicit payload deep link when present, else the
    /// category's default route.
    public let route: AppRoute
    public let deepLink: URL?
    public let vehicleID: Int64?
    public let severity: PushSeverity?
    /// A silent/background push (`aps.content-available == 1`) carrying no alert —
    /// used to wake the app to refresh, not to show UI.
    public let isContentAvailable: Bool
    public let receivedAt: Date

    public init(
        id: String,
        category: PushCategory,
        title: String? = nil,
        body: String? = nil,
        route: AppRoute,
        deepLink: URL? = nil,
        vehicleID: Int64? = nil,
        severity: PushSeverity? = nil,
        isContentAvailable: Bool = false,
        receivedAt: Date = Date()
    ) {
        self.id = id
        self.category = category
        self.title = title
        self.body = body
        self.route = route
        self.deepLink = deepLink
        self.vehicleID = vehicleID
        self.severity = severity
        self.isContentAvailable = isContentAvailable
        self.receivedAt = receivedAt
    }

    /// Whether this push has any user-visible alert content (vs. a silent refresh).
    public var hasAlertContent: Bool {
        !(title?.isEmpty ?? true) || !(body?.isEmpty ?? true)
    }
}
