//
//  EndpointSidebar.Models.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  Domain value types for the API-playground endpoint sidebar — a faithful port
//  of the web exports in features/admin/components/EndpointSidebar.tsx
//  (`ParsedParam`, `ParsedBody`, `ParsedEndpoint`) plus the HTTP method enum and
//  the grouped projection the native list renders. Pure value types — no SwiftUI,
//  no networking — so the projection adapter can be unit-tested in isolation.
//

import Foundation

// MARK: - HTTP method (web `ParsedEndpoint['method']` union)

/// The HTTP verbs the playground recognises, mirroring the web method union
/// `'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'`. Unknown verbs coming from a
/// custom OpenAPI document fold into `.other`, mirroring the web badge's
/// `METHOD_COLORS[method] ?? <neutral>` fallback.
public enum HTTPMethod: Sendable, Equatable, Hashable {
    case get
    case post
    case put
    case delete
    case patch
    case other(String)

    /// The wire token rendered in the method badge (always upper-cased, as the
    /// web `MethodBadge` prints `{method}` verbatim from the spec).
    public var token: String {
        switch self {
        case .get: "GET"
        case .post: "POST"
        case .put: "PUT"
        case .delete: "DELETE"
        case .patch: "PATCH"
        case let .other(raw): raw.uppercased()
        }
    }

    /// Parses a verb from any casing; blanks/unknowns map to `.other`.
    public init(token: String) {
        switch token.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "GET": self = .get
        case "POST": self = .post
        case "PUT": self = .put
        case "DELETE": self = .delete
        case "PATCH": self = .patch
        case let raw: self = .other(raw)
        }
    }
}

// MARK: - Parameter (web `ParsedParam`)

/// A parsed path/query parameter — a 1:1 mirror of the web `ParsedParam` shape
/// the OpenAPI parser produces. Carried by `ParsedEndpoint` so the same value
/// type can back the broader request builder, not just the sidebar.
public struct ParsedParam: Sendable, Equatable, Identifiable {
    /// Where the parameter is supplied (web `'path' | 'query'`).
    public enum Location: String, Sendable, Equatable {
        case path
        case query
    }

    public var name: String
    public var location: Location
    public var required: Bool
    public var type: String
    public var detail: String
    public var defaultValue: String?

    public var id: String {
        "\(location.rawValue):\(name)"
    }

    public init(
        name: String,
        location: Location,
        required: Bool = false,
        type: String = "string",
        detail: String = "",
        defaultValue: String? = nil
    ) {
        self.name = name
        self.location = location
        self.required = required
        self.type = type
        self.detail = detail
        self.defaultValue = defaultValue
    }
}

// MARK: - Request body (web `ParsedBody`)

/// A parsed request body descriptor — mirrors the web `ParsedBody` shape. The
/// JSON example/schema are kept as already-rendered strings so this stays a pure
/// value type (the web holds `unknown`/`Record<string, unknown>`).
public struct ParsedBody: Sendable, Equatable {
    public var contentType: String
    public var example: String?
    public var schemaSummary: String?

    public init(contentType: String, example: String? = nil, schemaSummary: String? = nil) {
        self.contentType = contentType
        self.example = example
        self.schemaSummary = schemaSummary
    }
}

// MARK: - Response descriptor (web `responses[status].description`)

/// One documented response row (web `Record<string, { description: string }>`,
/// flattened to an ordered, list-friendly value type).
public struct ParsedResponse: Sendable, Equatable, Identifiable {
    public var status: String
    public var detail: String

    public var id: String {
        status
    }

    public init(status: String, detail: String) {
        self.status = status
        self.detail = detail
    }
}

// MARK: - Endpoint (web `ParsedEndpoint`)

/// A parsed API endpoint — the faithful native port of the web `ParsedEndpoint`.
/// `id` reproduces the web list key `` `${ep.method}-${ep.path}` `` so selection
/// identity matches the web `selected?.path === ep.path && selected?.method === ep.method`.
public struct ParsedEndpoint: Sendable, Equatable, Identifiable {
    public var method: HTTPMethod
    public var path: String
    public var tag: String
    public var summary: String
    public var detail: String
    public var operationId: String
    public var parameters: [ParsedParam]
    public var requestBody: ParsedBody?
    public var responses: [ParsedResponse]

    public var id: String {
        "\(method.token)-\(path)"
    }

    public init(
        method: HTTPMethod,
        path: String,
        tag: String,
        summary: String = "",
        detail: String = "",
        operationId: String = "",
        parameters: [ParsedParam] = [],
        requestBody: ParsedBody? = nil,
        responses: [ParsedResponse] = []
    ) {
        self.method = method
        self.path = path
        self.tag = tag
        self.summary = summary
        self.detail = detail
        self.operationId = operationId
        self.parameters = parameters
        self.requestBody = requestBody
        self.responses = responses
    }
}

// MARK: - Grouped projection (web `grouped` Map<tag, endpoints[]>)

/// One collapsible tag group — the native projection of the web `grouped`
/// `Map<string, ParsedEndpoint[]>` entry, carrying the resolved
/// `isInitiallyExpanded` so the view never recomputes the open heuristic.
public struct EndpointTagGroup: Sendable, Equatable, Identifiable {
    public var tag: String
    public var endpoints: [ParsedEndpoint]
    public var isInitiallyExpanded: Bool

    public var id: String {
        tag
    }

    /// Web `{endpoints.length}` count chip value.
    public var count: Int {
        endpoints.count
    }

    public init(tag: String, endpoints: [ParsedEndpoint], isInitiallyExpanded: Bool) {
        self.tag = tag
        self.endpoints = endpoints
        self.isInitiallyExpanded = isInitiallyExpanded
    }
}

/// The full sidebar projection: the ordered tag groups plus the `filtered`
/// count the web prints in the "{n} endpoints" header.
public struct EndpointSidebarProjection: Sendable, Equatable {
    /// Fallback tag for endpoints with no tag (web `ep.tag || 'Other'`).
    public static let untaggedTag = "Other"
    /// Web heuristic threshold: groups auto-open when there are `<= 5` of them.
    public static let autoExpandGroupLimit = 5

    public var groups: [EndpointTagGroup]
    public var filteredCount: Int

    /// Web `filtered.length === 0` → render the "No matching endpoints" state.
    public var hasNoMatches: Bool {
        groups.isEmpty
    }

    public init(groups: [EndpointTagGroup], filteredCount: Int) {
        self.groups = groups
        self.filteredCount = filteredCount
    }
}
