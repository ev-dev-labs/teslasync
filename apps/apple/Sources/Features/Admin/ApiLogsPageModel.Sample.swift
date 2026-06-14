import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed source
/// is injected at composition time. It is NOT production telemetry — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling Audit Log's
/// `SampleAuditLogDataSource`). Production replaces it with the dev-tools API adapter.
public struct SampleApiLogsDataSource: ApiLogsDataSource {
    public init() {}

    public func loadStats() async throws -> ApiCallLogStats {
        ApiCallLogStats(
            totalCalls: 18482,
            byMethod: ["GET": 14201, "POST": 3810, "PUT": 322, "DELETE": 149],
            byService: [
                "teslasync-api": 9204,
                "tesla-api": 6118,
                "geocoder-google": 1842,
                "github-releases": 612,
                "notify-generic": 706
            ],
            errorRate: 2.4,
            errorCount: 443,
            avgDurationMs: 218,
            last24h: 1204
        )
    }

    public func loadLogs(_ query: ApiLogsQuery) async throws -> ApiCallLogPage {
        let filtered = Self.seed.filter { row in
            if let method = query.method, !method.isEmpty, row.httpMethod != method { return false }
            if let service = query.service, !service.isEmpty, row.service != service { return false }
            if let endpoint = query.endpoint, !endpoint.isEmpty,
               !row.endpoint.localizedCaseInsensitiveContains(endpoint) { return false }
            if let status = query.status, !status.isEmpty, Self.statusClass(row.statusCode) != status {
                return false
            }
            return true
        }
        let start = max(0, query.offset)
        let end = min(filtered.count, start + query.limit)
        let pageRows = start < end ? Array(filtered[start ..< end]) : []
        return ApiCallLogPage(logs: pageRows, total: filtered.count)
    }

    /// Web status-class derivation (`${Math.floor(code / 100)}xx`) used by the filter.
    static func statusClass(_ code: Int?) -> String {
        guard let code, code > 0 else { return "" }
        return "\(code / 100)xx"
    }

    static let seed: [ApiCallLog] = [
        ApiCallLog(
            id: 90412,
            ts: "2026-06-13T17:42:09Z",
            vehicleID: 3,
            service: "tesla-api",
            httpMethod: "GET",
            endpoint: "/api/1/vehicles/3/vehicle_data",
            statusCode: 200,
            durationMs: 184,
            errorMessage: nil,
            rateLimited: false,
            requestBody: nil,
            responseBody: "{\"response\":{\"state\":\"online\",\"charge\":{\"battery_level\":72}}}"
        ),
        ApiCallLog(
            id: 90411,
            ts: "2026-06-13T17:41:55Z",
            vehicleID: 3,
            service: "tesla-api",
            httpMethod: "POST",
            endpoint: "/api/1/vehicles/3/command/charge_start",
            statusCode: 408,
            durationMs: 30021,
            errorMessage: "vehicle asleep — command timed out after 30s",
            rateLimited: false,
            requestBody: "{\"wake\":true}",
            responseBody: nil
        ),
        ApiCallLog(
            id: 90410,
            ts: "2026-06-13T17:38:02Z",
            vehicleID: nil,
            service: "geocoder-google",
            httpMethod: "GET",
            endpoint: "/maps/api/geocode/json?latlng=37.42,-122.08",
            statusCode: 200,
            durationMs: 96,
            errorMessage: nil,
            rateLimited: false,
            requestBody: nil,
            responseBody: "{\"results\":[{\"formatted_address\":\"Mountain View, CA\"}]}"
        ),
        ApiCallLog(
            id: 90409,
            ts: "2026-06-13T17:30:48Z",
            vehicleID: nil,
            service: "teslasync-api",
            httpMethod: "GET",
            endpoint: "/api/v1/analytics/fleet",
            statusCode: 200,
            durationMs: 42,
            errorMessage: nil,
            rateLimited: false,
            requestBody: nil,
            responseBody: "{\"active_vehicles\":2,\"drives_today\":5}"
        ),
        ApiCallLog(
            id: 90408,
            ts: "2026-06-13T17:22:13Z",
            vehicleID: nil,
            service: "github-releases",
            httpMethod: "GET",
            endpoint: "/repos/ev-dev-labs/teslasync/releases/latest",
            statusCode: 304,
            durationMs: 71,
            errorMessage: nil,
            rateLimited: false,
            requestBody: nil,
            responseBody: nil
        ),
        ApiCallLog(
            id: 90407,
            ts: "2026-06-13T17:05:31Z",
            vehicleID: nil,
            service: "geocoder-google",
            httpMethod: "GET",
            endpoint: "/maps/api/geocode/json?latlng=37.33,-122.03",
            statusCode: 429,
            durationMs: 12,
            errorMessage: "rate limit exceeded — backing off",
            rateLimited: true,
            requestBody: nil,
            responseBody: "{\"status\":\"OVER_QUERY_LIMIT\"}"
        ),
        ApiCallLog(
            id: 90406,
            ts: "2026-06-13T16:58:09Z",
            vehicleID: nil,
            service: "notify-generic",
            httpMethod: "POST",
            endpoint: "/hooks/notify",
            statusCode: 500,
            durationMs: 511,
            errorMessage: "upstream webhook returned 500",
            rateLimited: false,
            requestBody: "{\"event\":\"charge_complete\",\"vehicle_id\":3}",
            responseBody: "{\"error\":\"internal\"}"
        ),
        ApiCallLog(
            id: 90405,
            ts: "2026-06-13T16:40:27Z",
            vehicleID: 3,
            service: "tesla-auth",
            httpMethod: "POST",
            endpoint: "/oauth2/v3/token",
            statusCode: 200,
            durationMs: 233,
            errorMessage: nil,
            rateLimited: false,
            requestBody: "{\"grant_type\":\"refresh_token\"}",
            responseBody: "{\"access_token\":\"***\",\"expires_in\":28800}"
        ),
        ApiCallLog(
            id: 90404,
            ts: "2026-06-13T16:11:50Z",
            vehicleID: 7,
            service: "teslasync-api",
            httpMethod: "DELETE",
            endpoint: "/api/v1/alerts/rules/42",
            statusCode: 204,
            durationMs: 38,
            errorMessage: nil,
            rateLimited: false,
            requestBody: nil,
            responseBody: nil
        )
    ]
}
