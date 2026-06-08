//
//  RequestBuilder.Adapter.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  The testable projection core for the API-playground request builder: a faithful
//  port of the data shapes + pure logic in features/admin/components/RequestBuilder.tsx
//  (the OpenAPI endpoint model, the `buildUrl` path/query assembler, the request-body
//  seed, the `encodeURIComponent` encoder, the `JSON.stringify(_, null, 2)` printer,
//  the header builder, and the field prompt rules). Everything here is pure and
//  dependency-free (no SwiftUI) so it can be unit-tested without a bundle or a view.
//

import Foundation

// MARK: - HTTP method (web ParsedEndpoint.method union)

/// The five methods the web `ParsedEndpoint` models, with the destructive flag and
/// the semantic accent role the web `METHOD_COLORS` map encodes (the view resolves
/// the role to a design token, keeping this layer SwiftUI-free).
public enum HTTPMethod: String, Sendable, Equatable, CaseIterable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
    case patch = "PATCH"

    /// Web `isDestructive = endpoint.method !== 'GET'` — anything mutating needs a
    /// confirm step before it is sent.
    public var isDestructive: Bool {
        self != .get
    }

    /// The web `METHOD_COLORS` mapping, expressed as a token-agnostic role.
    public var accentRole: RequestAccentRole {
        switch self {
        case .get: .success
        case .post: .info
        case .put: .warning
        case .delete: .danger
        case .patch: .accent
        }
    }

    /// Parses a raw method string (integration boundary); unknown values are nil so
    /// the caller can apply the web's neutral fallback.
    public static func parse(_ raw: String) -> HTTPMethod? {
        HTTPMethod(rawValue: raw.uppercased())
    }
}

/// Token-agnostic accent role (web `METHOD_COLORS` semantics). The view maps each
/// case to a `Color.TS.*` token so the adapter carries no SwiftUI dependency.
public enum RequestAccentRole: Sendable, Equatable {
    case success, info, warning, danger, accent, neutral
}

// MARK: - Endpoint model (web ParsedEndpoint / ParsedParam / ParsedBody)

/// Where a parameter is carried (web `'path' | 'query'`).
public enum ParameterLocation: String, Sendable, Equatable {
    case path
    case query
}

/// A single OpenAPI parameter (web `ParsedParam`).
public struct EndpointParameter: Sendable, Equatable, Identifiable {
    public let name: String
    public let location: ParameterLocation
    public let required: Bool
    public let type: String
    public let description: String
    public let defaultValue: String?

    public var id: String {
        "\(location.rawValue):\(name)"
    }

    public init(
        name: String,
        location: ParameterLocation,
        required: Bool,
        type: String,
        description: String = "",
        defaultValue: String? = nil
    ) {
        self.name = name
        self.location = location
        self.required = required
        self.type = type
        self.description = description
        self.defaultValue = defaultValue
    }
}

/// The request body descriptor (web `ParsedBody`). `example` is an ordered JSON tree
/// so the seed printer reproduces JS object-key order exactly.
public struct RequestBody: Sendable, Equatable {
    public let contentType: String
    public let example: RequestJSON?

    public init(contentType: String, example: RequestJSON? = nil) {
        self.contentType = contentType
        self.example = example
    }
}

/// A parsed endpoint (web `ParsedEndpoint`), trimmed to the fields the request
/// builder consumes (method, path, summary, description, parameters, requestBody).
public struct ParsedEndpoint: Sendable, Equatable {
    public let method: HTTPMethod
    public let path: String
    public let summary: String
    public let description: String
    public let parameters: [EndpointParameter]
    public let requestBody: RequestBody?

    public init(
        method: HTTPMethod,
        path: String,
        summary: String = "",
        description: String = "",
        parameters: [EndpointParameter] = [],
        requestBody: RequestBody? = nil
    ) {
        self.method = method
        self.path = path
        self.summary = summary
        self.description = description
        self.parameters = parameters
        self.requestBody = requestBody
    }

    /// Web `pathParams = endpoint.parameters.filter(p => p.in === 'path')`.
    public var pathParameters: [EndpointParameter] {
        parameters.filter { $0.location == .path }
    }

    /// Web `queryParams = endpoint.parameters.filter(p => p.in === 'query')`.
    public var queryParameters: [EndpointParameter] {
        parameters.filter { $0.location == .query }
    }
}

// MARK: - Ordered JSON value (web example payload)

/// An order-preserving JSON value, so `RequestJSONFormatter` reproduces the web
/// `JSON.stringify(example, null, 2)` output byte-for-byte (Swift dictionaries do
/// not preserve insertion order; JS objects do).
public indirect enum RequestJSON: Sendable, Equatable {
    case object([RequestJSONMember])
    case array([RequestJSON])
    case string(String)
    /// Stored as its canonical lexical form so integers print without a `.0` tail,
    /// exactly as the JS source value would serialize.
    case number(String)
    case bool(Bool)
    case null
}

/// One ordered `key: value` entry of a `RequestJSON.object`.
public struct RequestJSONMember: Sendable, Equatable {
    public let key: String
    public let value: RequestJSON

    public init(_ key: String, _ value: RequestJSON) {
        self.key = key
        self.value = value
    }
}

// MARK: - JSON pretty printer (web JSON.stringify(_, null, 2))

/// Reproduces `JSON.stringify(value, null, 2)`: two-space indent, `,\n`-separated
/// members/elements, empty `{}` / `[]` collapsed, JSON string escaping.
public enum RequestJSONFormatter {
    public static func pretty(_ value: RequestJSON, indent: Int = 2) -> String {
        render(value, level: 0, indent: indent)
    }

    private static func render(_ value: RequestJSON, level: Int, indent: Int) -> String {
        let inner = String(repeating: " ", count: indent * (level + 1))
        let outer = String(repeating: " ", count: indent * level)
        switch value {
        case .null:
            return "null"
        case let .bool(flag):
            return flag ? "true" : "false"
        case let .number(text):
            return text
        case let .string(text):
            return escape(text)
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let body = items
                .map { inner + render($0, level: level + 1, indent: indent) }
                .joined(separator: ",\n")
            return "[\n\(body)\n\(outer)]"
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let body = members
                .map { inner + escape($0.key) + ": " + render($0.value, level: level + 1, indent: indent) }
                .joined(separator: ",\n")
            return "{\n\(body)\n\(outer)}"
        }
    }

    /// JSON string escaping matching `JSON.stringify`: quote-wrapped, with `"`, `\`,
    /// the named control escapes, and `\u00XX` for the remaining C0 controls.
    static func escape(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }
}

// MARK: - Request assembly (web buildUrl / body seed / headers / defaults)

/// The pure request-assembly helpers ported from `RequestBuilder.tsx`.
public enum RequestBuilderAdapter {
    /// Characters `encodeURIComponent` leaves un-escaped: unreserved + `!~*'()`.
    private static let componentAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    )

    /// Web `encodeURIComponent(value)`.
    public static func encodeComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? value
    }

    /// Web `buildUrl()` — substitutes `{name}` path params (empty value keeps the
    /// `{name}` token) and appends an `&`-joined, encoded query string for the query
    /// params that carry a value. Returns the relative path the host sends; the
    /// `/api/v1` shown in the URL bar is added by `displayURL`.
    public static func relativeURL(endpoint: ParsedEndpoint, params: [String: String]) -> String {
        var url = endpoint.path
        for parameter in endpoint.pathParameters {
            let raw = params[parameter.name] ?? ""
            let value = raw.isEmpty ? "{\(parameter.name)}" : raw
            url = replacingFirst("{\(parameter.name)}", with: value, in: url)
        }
        let query = endpoint.queryParameters
            .filter { !(params[$0.name] ?? "").isEmpty }
            .map { "\($0.name)=\(encodeComponent(params[$0.name] ?? ""))" }
        return query.isEmpty ? url : "\(url)?\(query.joined(separator: "&"))"
    }

    /// The full path shown in the URL bar (web `/api/v1{buildUrl()}`).
    public static func displayURL(endpoint: ParsedEndpoint, params: [String: String]) -> String {
        "/api/v1" + relativeURL(endpoint: endpoint, params: params)
    }

    /// Web body-seed effect: pretty-printed example, an empty-object skeleton when a
    /// body is required without an example, or empty when there is no body.
    public static func seedBody(for body: RequestBody?) -> String {
        guard let body else { return "" }
        if let example = body.example {
            return RequestJSONFormatter.pretty(example)
        }
        return "{\n  \n}"
    }

    /// Web defaults effect: seed `params` from each parameter's `default`.
    public static func defaultParameters(for endpoint: ParsedEndpoint) -> [String: String] {
        var defaults: [String: String] = [:]
        for parameter in endpoint.parameters {
            if let value = parameter.defaultValue {
                defaults[parameter.name] = value
            }
        }
        return defaults
    }

    /// Web `handleSend` header assembly: a trimmed, non-empty API key becomes the
    /// `X-API-Key` header; otherwise no custom headers (session auth).
    public static func headers(apiKey: String) -> [String: String] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? [:] : ["X-API-Key": trimmed]
    }

    /// Web path-param prompt: `p.description || p.type`.
    public static func pathPrompt(_ parameter: EndpointParameter) -> String {
        parameter.description.isEmpty ? parameter.type : parameter.description
    }

    /// Web query-param prompt:
    /// `p.description || `${p.type}${p.default != null ? ` (default: ${p.default})` : ''}``.
    public static func queryPrompt(_ parameter: EndpointParameter) -> String {
        if !parameter.description.isEmpty { return parameter.description }
        if let value = parameter.defaultValue {
            return "\(parameter.type) (default: \(value))"
        }
        return parameter.type
    }

    /// Replaces only the first occurrence of `target`, matching JS `String.replace`
    /// with a string (non-global) first argument.
    private static func replacingFirst(_ target: String, with replacement: String, in source: String) -> String {
        guard let range = source.range(of: target) else { return source }
        return source.replacingCharacters(in: range, with: replacement)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`, reachable from the
/// dependency-free projection layer and its tests.
public enum RequestBuilderSurface {
    public static let slug = "RequestBuilder"
}

// MARK: - Accessibility summaries (VoiceOver)

/// Builds the surface's VoiceOver summaries through an injected localizer
/// (`(key, fallback) -> String`) so they are testable without a bundle.
public enum RequestBuilderAccessibility {
    /// "<Request URL>: GET /api/v1/vehicles".
    public static func urlSummary(
        method: HTTPMethod,
        displayURL: String,
        localize: (String, String) -> String
    ) -> String {
        "\(localize("a11y.requestBuilder.url", "Request URL")): \(method.rawValue) \(displayURL)"
    }

    /// The destructive-confirm prompt read aloud when the banner appears.
    public static func confirmSummary(
        method: HTTPMethod,
        localize: (String, String) -> String
    ) -> String {
        let format = localize(
            "playground.confirmDestructive",
            "This is a %@ request. Are you sure you want to send it?"
        )
        return String(format: format, method.rawValue)
    }
}
