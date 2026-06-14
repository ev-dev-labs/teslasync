import Foundation

// MARK: - Service / method / status presentation (web `SERVICE_CONFIG` + badge variant maps)

/// Static presentation catalog for API-call services, methods, and status codes — the
/// native peer of the web `SERVICE_CONFIG`, `METHOD_VARIANTS`, and the `statusBadgeVariant`
/// / `serviceBadgeConfig` helpers. Service labels are verbatim brand strings (not i18n
/// keys), exactly like the web; tones map to the shared `TSTone` status tokens.
public enum ApiLogsServiceCatalog {
    /// Display config for one service (web `SERVICE_CONFIG` entry). Tones are resolved
    /// through `TSTone` (a non-`Sendable` UI token), so this is a transient view value, not
    /// statically stored — the static catalog below holds only the `Sendable` label map.
    public struct ServiceConfig {
        public let label: String
        public let tone: TSTone
    }

    /// Web `SERVICE_CONFIG` labels — the friendly display string for each known service.
    private static let labels: [String: String] = [
        "teslasync-api": "TeslaSync API",
        "tesla-api": "Tesla API",
        "tesla-auth": "Tesla Auth",
        "geocoder-google": "Geocoder (Google)",
        "geocoder-nominatim": "Geocoder (Nominatim)",
        "geocoder-azure": "Geocoder (Azure)",
        "geocoder-search": "Geocoder (Search)",
        "github-releases": "GitHub Releases",
        "notify-generic": "Notifications",
        "system-dns-check": "DNS Health Check",
        "eia": "EIA"
    ]

    /// Web `KNOWN_SERVICES` — the static catalog of services the frontend knows the backend
    /// can write (stable order, used for the "{{known}} known" caption + dropdown union).
    public static let knownServices: [String] = [
        "teslasync-api", "tesla-api", "tesla-auth",
        "geocoder-google", "geocoder-nominatim", "geocoder-azure", "geocoder-search",
        "github-releases", "notify-generic", "system-dns-check", "eia"
    ]

    /// Web `serviceBadgeConfig(service)` — label + tone for a service, falling back to the
    /// raw id with a neutral tone for unknown services.
    public static func service(_ service: String) -> ServiceConfig {
        ServiceConfig(label: labels[service] ?? service, tone: serviceTone(service))
    }

    /// Web `SERVICE_CONFIG[service].variant` — info for API/auth services, warning for the
    /// geocoders, neutral for everything else (and unknown services).
    public static func serviceTone(_ service: String) -> TSTone {
        switch service {
        case "teslasync-api", "tesla-api", "tesla-auth": .info
        case "geocoder-google", "geocoder-nominatim", "geocoder-azure", "geocoder-search": .warning
        default: .neutral
        }
    }

    /// Web `METHOD_VARIANTS[method]` — GET success / POST info / PUT|PATCH warning /
    /// DELETE danger / else neutral.
    public static func methodTone(_ method: String) -> TSTone {
        switch method.uppercased() {
        case "GET": .success
        case "POST": .info
        case "PUT", "PATCH": .warning
        case "DELETE": .danger
        default: .neutral
        }
    }

    /// Web `statusBadgeVariant(code)` — nil neutral / <300 success / <400 info / <500
    /// warning / else danger.
    public static func statusTone(_ code: Int?) -> TSTone {
        guard let code, code != 0 else { return .neutral }
        if code < 300 { return .success }
        if code < 400 { return .info }
        if code < 500 { return .warning }
        return .danger
    }

    /// Web `deriveServiceOptions` — the Service-filter option list as the union of the
    /// static catalog, the live `by_service` keys, and the active selection, sorted
    /// alphabetically by label, with the localized "All Services" option pinned at the head.
    public static func serviceOptions(
        byService: [String: Int]?,
        activeService: String,
        allLabel: String
    ) -> [ApiLogsServiceOption] {
        var values = Set(knownServices)
        for key in (byService ?? [:]).keys {
            values.insert(key)
        }
        if !activeService.isEmpty { values.insert(activeService) }

        let tail = values
            .map { ApiLogsServiceOption(value: $0, label: service($0).label) }
            .sorted { lhs, rhs in
                lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending
            }

        return [ApiLogsServiceOption(value: "", label: allLabel)] + tail
    }
}
