import Foundation

/// Deep-link / path parsing for `AppRoute`, preserving the aliases & redirects
/// from `web/src/App.tsx`. Pure + unit-tested.
public enum AppRouteParser {
    /// Path → route redirects (web aliases like `/battery/health` → energy).
    static let aliases: [String: AppRoute] = [
        "/": .dashboard,
        "/battery": .energy,
        "/battery/health": .energy,
        "/charging/curves": .charging,
        "/performance": .driving,
        "/statistics": .analytics,
        "/location": .maps,
        "/alerts": .notifications,
        "/signals": .telemetry,
        "/devtools": .admin,
        "/admin/telemetry/coverage": .fleetTelemetryCoverage,
        "/admin/live-signals": .liveSignals,
        "/admin/schema-drift": .schemaDrift,
        "/admin/audit-log": .auditLog,
        "/admin/flags": .featureFlags,
        "/account": .settings
    ]

    /// Resolves a URL path (with optional IDs after the segment) to a route.
    public static func parse(path rawPath: String) -> AppRoute? {
        let normalized = normalize(rawPath)
        if let alias = aliases[normalized] { return alias }
        let segment = firstSegment(of: normalized)
        return AppRoute.allCases.first { $0.pathSegment == segment }
    }

    /// Resolves a custom-scheme (`teslasync://charging`) or universal link.
    public static func parse(url: URL) -> AppRoute? {
        if url.path.isEmpty || url.path == "/", let host = url.host?.lowercased() {
            if let direct = AppRoute.allCases.first(where: { $0.pathSegment == host }) {
                return direct
            }
            if let alias = aliases["/" + host] { return alias }
        }
        return parse(path: url.path)
    }

    static func normalize(_ path: String) -> String {
        var clean = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.hasPrefix("/") { clean = "/" + clean }
        if clean.count > 1, clean.hasSuffix("/") { clean.removeLast() }
        return clean.lowercased()
    }

    static func firstSegment(of normalizedPath: String) -> String {
        normalizedPath.split(separator: "/").first.map(String.init) ?? ""
    }
}
