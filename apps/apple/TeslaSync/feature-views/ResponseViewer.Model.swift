//
//  ResponseViewer.Model.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The value types and pure adapters behind the native `ResponseViewer`, the
//  SwiftUI parity of features/admin/components/ResponseViewer.tsx. Keeping the
//  inputs (`ApiResponse`, `HistoryEntry`) and the small web helpers
//  (`formatBytes`, `statusColor`/`statusBg`, the method chip palette) in plain,
//  `Equatable` value types lets the XCTest suite cover every branch without a
//  rendering host — the same approach the other P4 surfaces use.
//
//  The web component is presentational: it receives a materialised
//  `ApiResponse | null` plus a `loading` flag from its parent (the API
//  Playground page) and never fetches. So the leaf freshness axis
//  (fetch-error / stale / offline) is owned by that parent; this surface
//  reproduces the source's own branches — loading, empty, and the loaded
//  response with its success / redirect / error status styling.
//

import Foundation
import SwiftUI

// MARK: - Inputs (web `ApiResponse` / `HistoryEntry`)

/// A captured API response — the native mirror of the web `ApiResponse`.
///
/// The web shape carries both an untyped `body` and a `bodyText`; the view
/// pretty-prints the parsed object when the content type is JSON and otherwise
/// shows `bodyText`. Native receives the body as text (`bodyText`) and performs
/// the same decision against `contentType` in ``ResponseProjection`` — so the
/// untyped `body` field is intentionally not modelled.
public struct ApiResponse: Equatable, Sendable {
    /// HTTP status code (web `status`).
    public let status: Int
    /// HTTP status reason phrase (web `statusText`).
    public let statusText: String
    /// Response headers (web `headers: Record<string, string>`).
    public let headers: [String: String]
    /// The raw response body as text (web `bodyText`).
    public let bodyText: String
    /// Round-trip duration in milliseconds (web `duration`).
    public let durationMs: Int
    /// Response size in bytes (web `size`).
    public let size: Int
    /// The response `Content-Type` (web `contentType`).
    public let contentType: String

    public init(
        status: Int,
        statusText: String,
        headers: [String: String],
        bodyText: String,
        durationMs: Int,
        size: Int,
        contentType: String
    ) {
        self.status = status
        self.statusText = statusText
        self.headers = headers
        self.bodyText = bodyText
        self.durationMs = durationMs
        self.size = size
        self.contentType = contentType
    }
}

/// One entry in the recent-requests strip (web `HistoryEntry`).
public struct HistoryEntry: Equatable, Hashable, Sendable {
    /// HTTP method (web `method`).
    public let method: String
    /// Request path (web `path`).
    public let path: String
    /// Resulting HTTP status (web `status`).
    public let status: Int
    /// Round-trip duration in milliseconds (web `duration`).
    public let durationMs: Int
    /// ISO timestamp of the request (web `timestamp`).
    public let timestamp: String

    public init(method: String, path: String, status: Int, durationMs: Int, timestamp: String) {
        self.method = method
        self.path = path
        self.status = status
        self.durationMs = durationMs
        self.timestamp = timestamp
    }
}

// MARK: - Status classification (web `statusColor` / `statusBg`)

/// The semantic class of an HTTP status, mirroring the web `statusColor` /
/// `statusBg` thresholds: `< 300` success, `< 400` redirect, otherwise error.
/// Each case resolves to a generated status token (never a raw hex) so the
/// surface stays theme-aware across light / dark / high-contrast.
public enum ResponseStatusClass: String, CaseIterable, Sendable {
    case success
    case redirect
    case error

    /// Background fill opacity for the status bar (web `bg-{color}/10`).
    public static let backgroundOpacity = 0.10
    /// Border opacity for the status bar (web `border-{color}/20`).
    public static let borderOpacity = 0.20

    /// Classifies a status code using the web thresholds.
    public init(status: Int) {
        if status < 300 {
            self = .success
        } else if status < 400 {
            self = .redirect
        } else {
            self = .error
        }
    }

    /// The full-strength accent (web `text-green-400` / `amber-400` / `red-400`).
    public var tone: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .redirect: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        }
    }

    /// The status-bar background fill (web `bg-{color}/10`).
    public var backgroundFill: Color {
        tone.opacity(Self.backgroundOpacity)
    }

    /// The status-bar border (web `border-{color}/20`).
    public var borderStroke: Color {
        tone.opacity(Self.borderOpacity)
    }
}

// MARK: - Method palette (web history chip method colours)

/// The colour bucket for a history chip's HTTP method, mirroring the web
/// `h.method === 'GET' ? green : 'POST' ? blue : 'DELETE' ? red : amber` map.
public enum HTTPMethodTone: String, CaseIterable, Sendable {
    case get
    case post
    case delete
    case other

    /// Chip tint background opacity (web `bg-{color}/20`).
    public static let chipBackgroundOpacity = 0.20

    /// Buckets a method string (case-insensitive); anything outside the known
    /// verbs maps to ``other`` (the web `amber` fallback).
    public init(method: String) {
        switch method.uppercased() {
        case "GET": self = .get
        case "POST": self = .post
        case "DELETE": self = .delete
        default: self = .other
        }
    }

    /// The method accent. `POST` uses the brand blue (`chartSeriesSpeed`, the
    /// token equal to the web `blue-400`); the rest map to status tokens.
    public var color: Color {
        switch self {
        case .get: Color.TS.statusSuccess
        case .post: Color.TS.chartSeriesSpeed
        case .delete: Color.TS.statusDanger
        case .other: Color.TS.statusWarning
        }
    }

    /// The chip background fill (web `bg-{color}/20`).
    public var chipBackground: Color {
        color.opacity(Self.chipBackgroundOpacity)
    }
}

// MARK: - Byte formatting (web `formatBytes`)

/// Formats a byte count exactly like the web `formatBytes`: `< 1 KiB` as bytes,
/// `< 1 MiB` as one-decimal KB, otherwise one-decimal MB. The decimal uses the
/// canonical (non-localised) `.` separator so it matches the web output.
public enum ResponseByteFormat {
    public static func string(_ bytes: Int) -> String {
        if bytes < 1024 {
            return "\(bytes) B"
        }
        if bytes < 1024 * 1024 {
            return "\(oneDecimal(Double(bytes) / 1024)) KB"
        }
        return "\(oneDecimal(Double(bytes) / (1024 * 1024))) MB"
    }

    private static func oneDecimal(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}

// MARK: - Header row (web `Object.entries(headers)`)

/// A single response-header row, `Identifiable` by its (unique) name so the
/// list renders without index keys.
public struct ResponseHeaderItem: Identifiable, Equatable, Sendable {
    public let name: String
    public let value: String

    public var id: String {
        name
    }

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// views hold no hardcoded literals. Keys live in the "ResponseViewer" table
/// (`ResponseViewer.strings`), folded into the app `Localizable.xcstrings`
/// catalog at integration time.
public enum ResponseViewerStrings {
    public static let table = "ResponseViewer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
