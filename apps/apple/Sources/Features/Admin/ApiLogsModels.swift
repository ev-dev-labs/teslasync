import Foundation

// MARK: - Wire value types (web `APICallLog` / `APICallLogStats` / `APICallLogResponse`)

/// One API-call ledger row — the native peer of the web `APICallLog` (backed by
/// `GET /api-logs`). Field names/types mirror the wire 1:1 so the production KMP
/// dev-tools binding maps straight across. API-call metadata is unit-agnostic
/// control-plane data (no SI conversion applies); `durationMs` is a latency in
/// milliseconds and the timestamp is rendered at the display boundary by `ApiLogsFormat`.
public struct ApiCallLog: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let ts: String
    public let vehicleID: Int64?
    public let service: String
    public let httpMethod: String
    public let endpoint: String
    public let statusCode: Int?
    public let durationMs: Int
    public let errorMessage: String?
    public let rateLimited: Bool
    public let requestBody: String?
    public let responseBody: String?

    public init(
        id: Int64,
        ts: String,
        vehicleID: Int64? = nil,
        service: String,
        httpMethod: String,
        endpoint: String,
        statusCode: Int? = nil,
        durationMs: Int,
        errorMessage: String? = nil,
        rateLimited: Bool = false,
        requestBody: String? = nil,
        responseBody: String? = nil
    ) {
        self.id = id
        self.ts = ts
        self.vehicleID = vehicleID
        self.service = service
        self.httpMethod = httpMethod
        self.endpoint = endpoint
        self.statusCode = statusCode
        self.durationMs = durationMs
        self.errorMessage = errorMessage
        self.rateLimited = rateLimited
        self.requestBody = requestBody
        self.responseBody = responseBody
    }
}

/// Aggregate API-call statistics (web `APICallLogStats`, backed by `GET /api-logs/stats`).
/// `errorRate` is a percentage; `avgDurationMs` is a latency in milliseconds.
public struct ApiCallLogStats: Equatable, Sendable {
    public let totalCalls: Int
    public let byMethod: [String: Int]
    public let byService: [String: Int]
    public let errorRate: Double
    public let errorCount: Int
    public let avgDurationMs: Int
    public let last24h: Int

    public init(
        totalCalls: Int,
        byMethod: [String: Int] = [:],
        byService: [String: Int] = [:],
        errorRate: Double,
        errorCount: Int,
        avgDurationMs: Int,
        last24h: Int
    ) {
        self.totalCalls = totalCalls
        self.byMethod = byMethod
        self.byService = byService
        self.errorRate = errorRate
        self.errorCount = errorCount
        self.avgDurationMs = avgDurationMs
        self.last24h = last24h
    }
}

/// One page of API-call rows plus the total row count (web `APICallLogResponse`'s
/// `data` + `total`). The page model derives pagination + empty state from this.
public struct ApiCallLogPage: Equatable, Sendable {
    public let logs: [ApiCallLog]
    public let total: Int

    public init(logs: [ApiCallLog], total: Int) {
        self.logs = logs
        self.total = total
    }
}

// MARK: - Query (web `getAPICallLogs` params)

/// The filtered-list query the page builds from its filter row + page (web
/// `getAPICallLogs` params). Carried as a value type so the production data source maps
/// it to the snake_case query string and the model is unit-testable. Filters are
/// snake_case on the wire (DRY anti-pattern guard #8 — never camelCase params).
public struct ApiLogsQuery: Equatable, Sendable {
    public var limit: Int
    public var offset: Int
    public var method: String?
    public var status: String?
    public var endpoint: String?
    public var service: String?
    public var start: String?
    public var end: String?

    public init(
        limit: Int = 25,
        offset: Int = 0,
        method: String? = nil,
        status: String? = nil,
        endpoint: String? = nil,
        service: String? = nil,
        start: String? = nil,
        end: String? = nil
    ) {
        self.limit = limit
        self.offset = offset
        self.method = method
        self.status = status
        self.endpoint = endpoint
        self.service = service
        self.start = start
        self.end = end
    }

    /// Ports the web `getAPICallLogs` `URLSearchParams`: snake_case params, empty filters
    /// omitted. Used by the production adapter + asserted in tests so the backend contract
    /// (`GET /api-logs{qs}`) is reproduced exactly.
    public var queryString: String {
        var parts: [String] = []
        parts.append("limit=\(limit)")
        if offset > 0 { parts.append("offset=\(offset)") }
        if let method, !method.isEmpty { parts.append("method=\(method)") }
        if let status, !status.isEmpty { parts.append("status=\(status)") }
        if let endpoint, !endpoint.isEmpty { parts.append("endpoint=\(endpoint)") }
        if let service, !service.isEmpty { parts.append("service=\(service)") }
        if let start, !start.isEmpty { parts.append("start=\(start)") }
        if let end, !end.isEmpty { parts.append("end=\(end)") }
        return "?" + parts.joined(separator: "&")
    }
}

// MARK: - Filter option catalogs (web inline option arrays)

/// One Service-filter dropdown option (web `ServiceSelectOption`): a raw service value +
/// its display label.
public struct ApiLogsServiceOption: Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public var id: String {
        value
    }

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }
}

/// The HTTP-method filter choices (web `Select` options). The "all" case maps to the
/// localized "All Methods"; the rest render verbatim like the web.
public enum ApiLogsMethodFilter: String, CaseIterable, Identifiable, Sendable {
    case all = ""
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"

    public var id: String {
        rawValue
    }
}

/// The status-class filter choices (web `Select` options). The "all" case maps to the
/// localized "All Status"; the rest carry the web's hardcoded English labels verbatim.
public enum ApiLogsStatusFilter: String, CaseIterable, Identifiable, Sendable {
    case all = ""
    case success = "2xx"
    case redirect = "3xx"
    case clientError = "4xx"
    case serverError = "5xx"

    public var id: String {
        rawValue
    }

    /// Web hardcoded option label (rendered verbatim, not an i18n key).
    public var verbatimLabel: String {
        switch self {
        case .all: ""
        case .success: "2xx Success"
        case .redirect: "3xx Redirect"
        case .clientError: "4xx Client Error"
        case .serverError: "5xx Server Error"
        }
    }
}

// MARK: - Errors

/// Thrown by a data source when the API-call-log feed cannot be read — the native peer of
/// the web `logsError` / `statsError` branch that surfaces the "Failed to load data"
/// banner and the list error state.
public struct ApiLogsLoadFailure: Error {
    public let detail: String
    public init(detail: String) {
        self.detail = detail
    }
}
