import Foundation
import Observation

// MARK: - Endpoint model (web `ParsedEndpoint`, trimmed to this unit's render set)

/// One API endpoint surfaced in the playground catalog. A pure value type carrying
/// only the fields this parity unit renders (method, path, category, summary). The
/// request builder and response viewer are separate parity units, out of scope here.
public struct ApiEndpoint: Identifiable, Hashable, Sendable {
    /// HTTP verb (web `ParsedEndpoint.method`).
    public enum Method: String, CaseIterable, Sendable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    public let method: Method
    public let path: String
    public let tag: String
    public let summary: String

    public var id: String {
        "\(method.rawValue) \(path)"
    }

    public init(method: Method, path: String, tag: String, summary: String) {
        self.method = method
        self.path = path
        self.tag = tag
        self.summary = summary
    }
}

// MARK: - Catalog seam (web fetch + parse of the OpenAPI document)

/// Supplies the endpoint catalog the page lists. The web page fetches and parses the
/// OpenAPI document; per the parity manifest this native unit renders from local
/// state, so the default provider returns the documented route catalog. The seam lets
/// previews and tests drive the loading / empty / error / success states.
public protocol ApiEndpointCatalogProviding: Sendable {
    func load() async throws -> [ApiEndpoint]
}

/// The documented TeslaSync API surface (source of truth: `internal/api/router.go`),
/// grouped by category. Static, vehicle-agnostic reference data — no networking.
public struct StaticApiEndpointCatalog: ApiEndpointCatalogProviding {
    public init() {}

    public func load() async throws -> [ApiEndpoint] {
        Self.endpoints
    }

    static let endpoints: [ApiEndpoint] = [
        ApiEndpoint(method: .get, path: "/vehicles", tag: "Vehicles", summary: "List all vehicles"),
        ApiEndpoint(
            method: .get,
            path: "/vehicles/{vehicleID}/state",
            tag: "Vehicles",
            summary: "Current vehicle state"
        ),
        ApiEndpoint(method: .get, path: "/vehicles/{vehicleID}/battery", tag: "Vehicles", summary: "Battery summary"),
        ApiEndpoint(method: .get, path: "/drives", tag: "Driving", summary: "List recent drives"),
        ApiEndpoint(
            method: .get,
            path: "/drives/{driveID}/telemetry",
            tag: "Driving",
            summary: "Drive telemetry series"
        ),
        ApiEndpoint(method: .get, path: "/charging", tag: "Charging", summary: "List charging sessions"),
        ApiEndpoint(
            method: .get,
            path: "/charging/{sessionID}/telemetry",
            tag: "Charging",
            summary: "Charging telemetry"
        ),
        ApiEndpoint(method: .get, path: "/analytics/fleet", tag: "Analytics", summary: "Fleet-wide statistics"),
        ApiEndpoint(
            method: .get,
            path: "/analytics/battery-degradation",
            tag: "Analytics",
            summary: "Battery degradation trend"
        ),
        ApiEndpoint(
            method: .get,
            path: "/signals/{vehicleID}/available",
            tag: "Signals",
            summary: "List available signals"
        ),
        ApiEndpoint(method: .get, path: "/signals/{vehicleID}/live", tag: "Signals", summary: "Live signal values"),
        ApiEndpoint(method: .get, path: "/alerts", tag: "Alerts", summary: "List alert rules"),
        ApiEndpoint(method: .post, path: "/alerts/rules", tag: "Alerts", summary: "Create an alert rule"),
        ApiEndpoint(method: .get, path: "/system/status", tag: "System", summary: "Service status overview"),
        ApiEndpoint(method: .get, path: "/system/version", tag: "System", summary: "Build and version info")
    ]
}

// MARK: - Page state (web PageContainer loading/error + endpoints query phases)

/// The page's data state for the endpoint catalog source (web `useQuery` phases plus
/// the empty-list case). Drives the loading / empty / error / success branches.
public enum ApiPlaygroundState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([ApiEndpoint])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to. Owns the catalog load state and
/// the selected endpoint; performs no networking itself (reads through the seam),
/// matching ADR-004 — the view layer holds no business logic.
@MainActor
@Observable
public final class ApiPlaygroundPageModel {
    public private(set) var state: ApiPlaygroundState = .loading
    public private(set) var selected: ApiEndpoint?

    @ObservationIgnored private let catalog: any ApiEndpointCatalogProviding

    public init(catalog: any ApiEndpointCatalogProviding = StaticApiEndpointCatalog()) {
        self.catalog = catalog
    }

    /// The loaded endpoints (empty unless the state is `.loaded`).
    public var endpoints: [ApiEndpoint] {
        if case let .loaded(list) = state { return list }
        return []
    }

    /// Endpoints grouped by category in first-seen order (web sidebar tag sections).
    public var groupedEndpoints: [(tag: String, endpoints: [ApiEndpoint])] {
        var order: [String] = []
        var buckets: [String: [ApiEndpoint]] = [:]
        for endpoint in endpoints {
            if buckets[endpoint.tag] == nil { order.append(endpoint.tag) }
            buckets[endpoint.tag, default: []].append(endpoint)
        }
        return order.map { (tag: $0, endpoints: buckets[$0] ?? []) }
    }

    /// Count surfaced by `playground.endpointCount` (web `allEndpoints.length`).
    public var endpointCount: Int {
        endpoints.count
    }

    /// Whether the count line is shown (web guards it behind `allEndpoints.length > 0`).
    public var showsEndpointCount: Bool {
        endpointCount > 0
    }

    /// Loads the catalog and resolves the terminal state (web OpenAPI spec query).
    public func load() async {
        state = .loading
        selected = nil
        do {
            let list = try await catalog.load()
            state = list.isEmpty ? .empty : .loaded(list)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Re-runs the load (web error-retry / refresh).
    public func refresh() async {
        await load()
    }

    /// Selects an endpoint to inspect (web `handleSelect`).
    public func select(_ endpoint: ApiEndpoint) {
        selected = endpoint
    }

    /// Clears the current selection (web reset to the select-an-endpoint prompt).
    public func clearSelection() {
        selected = nil
    }
}
