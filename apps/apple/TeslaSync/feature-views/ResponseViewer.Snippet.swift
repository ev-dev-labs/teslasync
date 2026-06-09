//
//  ResponseViewer.Snippet.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The code-snippet generator — the pure parity of the web `generateSnippet`
//  (cURL / JavaScript / Python / Go). It is exported from the web source
//  (`export { SnippetPanel, ... }`) and is the sole origin of the
//  `Code Snippet` / `Copy` i18n keys, so it is part of this surface's
//  deliverable. Kept free of SwiftUI so every branch is unit-testable.
//

import Foundation

// MARK: - Snippet format (web `'curl' | 'javascript' | 'python' | 'go'`)

/// A target language for the generated request snippet. The display labels are
/// the product names the web hardcodes (`cURL`, `JavaScript`, `Python`, `Go`) —
/// not localised, matching the source.
public enum SnippetFormat: String, CaseIterable, Sendable, Identifiable {
    case curl
    case javascript
    case python
    case go

    public var id: String {
        rawValue
    }

    /// The picker label (web `formats[].label`).
    public var label: String {
        switch self {
        case .curl: "cURL"
        case .javascript: "JavaScript"
        case .python: "Python"
        case .go: "Go"
        }
    }
}

// MARK: - Generator (web `generateSnippet`)

/// Generates a copy-pasteable request snippet for a method/URL/body in the
/// requested language, byte-for-byte faithful to the web `generateSnippet`
/// (including the auth note and the GET special-casing).
public enum ResponseSnippet {
    /// The cURL auth hint prepended to the command (web `authNote`).
    static let curlAuthNote = "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies"

    /// Produces the snippet for `format`. Mirrors the web `switch (format)`.
    public static func generate(
        method: String,
        url: String,
        format: SnippetFormat,
        body: String?
    ) -> String {
        switch format {
        case .curl: curl(method: method, url: url, body: body)
        case .javascript: javascript(method: method, url: url, body: body)
        case .python: python(method: method, url: url, body: body)
        case .go: go(method: method, url: url, body: body)
        }
    }

    /// Web `body && method !== 'GET'`: a non-empty body on a non-GET request.
    static func hasBody(_ body: String?, method: String) -> Bool {
        guard let body, !body.isEmpty else { return false }
        return method != "GET"
    }

    // MARK: Per-language builders

    static func curl(method: String, url: String, body: String?) -> String {
        var parts = ["curl -X \(method) '\(url)'"]
        if hasBody(body, method: method), let body {
            parts.append("  -H 'Content-Type: application/json'")
            parts.append("  -d '\(body)'")
        }
        return curlAuthNote + "\n" + parts.joined(separator: " \\\n")
    }

    static func javascript(method: String, url: String, body: String?) -> String {
        var lines = [
            "// Auth: include credentials or X-API-Key header",
            "const response = await fetch('\(url)', {",
            "  method: '\(method)',"
        ]
        if hasBody(body, method: method), let body {
            lines.append("  headers: { 'Content-Type': 'application/json' },")
            lines.append("  body: JSON.stringify(\(body)),")
        }
        lines.append("});")
        lines.append("const data = await response.json();")
        return lines.joined(separator: "\n")
    }

    static func python(method: String, url: String, body: String?) -> String {
        var jsonArg = ""
        if hasBody(body, method: method), let body {
            jsonArg = ", json=\(body)"
        }
        return [
            "# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}",
            "import requests",
            "",
            "response = requests.\(method.lowercased())('\(url)'\(jsonArg))",
            "data = response.json()"
        ].joined(separator: "\n")
    }

    static func go(method: String, url: String, body: String?) -> String {
        if method == "GET" {
            return [
                "// Auth: add X-API-Key header to the request",
                "resp, err := http.Get(\"\(url)\")",
                "if err != nil { log.Fatal(err) }",
                "defer resp.Body.Close()"
            ].joined(separator: "\n")
        }
        let bodyLiteral = body ?? "{}"
        return [
            "// Auth: add X-API-Key header to the request",
            "body := strings.NewReader(`\(bodyLiteral)`)",
            "req, _ := http.NewRequest(\"\(method)\", \"\(url)\", body)",
            "req.Header.Set(\"Content-Type\", \"application/json\")",
            "resp, err := http.DefaultClient.Do(req)",
            "if err != nil { log.Fatal(err) }",
            "defer resp.Body.Close()"
        ].joined(separator: "\n")
    }
}
