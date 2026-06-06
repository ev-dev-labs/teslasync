import Foundation

/// Pure, dependency-free parser from a raw APNs `userInfo` dictionary into a typed
/// `PushNotification`. Lives apart from any OS callback so it is exhaustively
/// unit-tested: the same logic handles a tapped notification, a foreground
/// `willPresent`, and a silent background wake.
///
/// Wire shape (APNs): the reserved `aps` object carries `alert` (string or
/// `{title, subtitle, body}`), `category`, `content-available`, `thread-id`;
/// TeslaSync's own keys sit as siblings of `aps`: `category`, `deeplink`/`route`,
/// `vehicle_id`, `severity`, `id`. Top-level keys win over their `aps` echoes.
public enum PushPayloadParser {
    /// Parses `userInfo` into a `PushNotification`. `now` stamps `receivedAt` and
    /// seeds the fallback id, so tests are deterministic.
    public static func parse(_ userInfo: [AnyHashable: Any], now: Date = Date()) -> PushNotification {
        let aps = dictionary(userInfo["aps"]) ?? [:]
        let category = PushCategory.parse(string(userInfo["category"]) ?? string(aps["category"]))

        var title: String?
        var body: String?
        if let alert = dictionary(aps["alert"]) {
            title = string(alert["title"])
            body = string(alert["body"])
        } else if let alert = string(aps["alert"]) {
            body = alert
        }

        let deepLink = resolveDeepLink(userInfo)
        let routeString = string(userInfo["route"])
        let route = resolveRoute(deepLink: deepLink, routeString: routeString, category: category)

        return PushNotification(
            id: resolveID(userInfo, aps: aps, category: category, now: now),
            category: category,
            title: title,
            body: body,
            route: route,
            deepLink: deepLink,
            vehicleID: int64(userInfo["vehicle_id"]) ?? int64(aps["vehicle_id"]),
            severity: PushSeverity.parse(string(userInfo["severity"])),
            isContentAvailable: bool(aps["content-available"]),
            receivedAt: now
        )
    }

    // MARK: - Resolution

    private static func resolveDeepLink(_ userInfo: [AnyHashable: Any]) -> URL? {
        for key in ["deeplink", "deep_link", "url", "link"] {
            if let raw = string(userInfo[key]), let url = URL(string: raw) {
                return url
            }
        }
        return nil
    }

    private static func resolveRoute(deepLink: URL?, routeString: String?, category: PushCategory) -> AppRoute {
        if let deepLink, let route = AppRouteParser.parse(url: deepLink) {
            return route
        }
        if let routeString, let route = AppRouteParser.parse(path: routeString) {
            return route
        }
        return category.route
    }

    private static func resolveID(
        _ userInfo: [AnyHashable: Any],
        aps: [String: Any],
        category: PushCategory,
        now: Date
    ) -> String {
        if let explicit = string(userInfo["id"]) ?? string(userInfo["notification_id"]) ?? string(aps["thread-id"]) {
            return explicit
        }
        return "\(category.rawValue)-\(Int(now.timeIntervalSince1970 * 1000))"
    }

    // MARK: - Coercions (APNs values arrive as NSString / NSNumber)

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let text as String:
            text.isEmpty ? nil : text
        case let number as NSNumber:
            number.stringValue
        default:
            nil
        }
    }

    private static func int64(_ value: Any?) -> Int64? {
        switch value {
        case let number as NSNumber:
            number.int64Value
        case let text as String:
            Int64(text.trimmingCharacters(in: .whitespaces))
        default:
            nil
        }
    }

    private static func bool(_ value: Any?) -> Bool {
        switch value {
        case let number as NSNumber:
            number.boolValue
        case let text as String:
            text == "1" || text.lowercased() == "true"
        default:
            false
        }
    }

    private static func dictionary(_ value: Any?) -> [String: Any]? {
        if let typed = value as? [String: Any] {
            return typed
        }
        if let anyKeyed = value as? [AnyHashable: Any] {
            return anyKeyed.reduce(into: [String: Any]()) { result, pair in
                if let key = pair.key as? String {
                    result[key] = pair.value
                }
            }
        }
        return nil
    }
}
