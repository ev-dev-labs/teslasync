//
//  RequestBuilder.Model.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for the
//  API-playground request builder. The view binds through `RequestBuilderModel`, which
//  owns the editable request state (params, body, API key, confirm step) the web
//  `useState`/`useEffect` hooks hold, and hands a `SendRequest` to the host on send
//  (the web `onSend` callback). No networking lives here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; production injects an adapter that forwards
/// to the shared-core `Telemetry.track(.screenView(screen:…))` (ADR-016).
public protocol RequestBuilderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogRequestBuilderTelemetry: RequestBuilderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "RequestBuilder" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum RequestBuilderStrings {
    public static let table = "RequestBuilder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The destructive-confirm sentence with the method interpolated (web i18next
    /// `{{method}}` interpolation).
    public static func confirmMessage(method: RequestBuilderHTTPMethod) -> String {
        let format = string(
            "playground.confirmDestructive",
            "This is a %@ request. Are you sure you want to send it?"
        )
        return String(format: format, method.rawValue)
    }
}

// MARK: - Send payload (web onSend arguments)

/// The request the host should issue (web `onSend(url, method, body?, headers)`).
public struct SendRequest: Sendable, Equatable {
    public let url: String
    public let method: RequestBuilderHTTPMethod
    public let body: String?
    public let headers: [String: String]

    public init(url: String, method: RequestBuilderHTTPMethod, body: String?, headers: [String: String]) {
        self.url = url
        self.method = method
        self.body = body
        self.headers = headers
    }
}

// MARK: - State holder (P1/S8 layer)

/// The request builder's observable view-model. Owns the editable request state
/// (web `params` / `body` / `apiKey` / `confirmOpen` + the `loading` prop), derives
/// the URL on read (the web `buildUrl` memo), gates destructive sends behind a
/// confirm step, and emits the `view.opened` diagnostics event once.
@MainActor
@Observable
public final class RequestBuilderModel {
    /// The endpoint being composed (web `endpoint` prop).
    public private(set) var endpoint: RequestBuilderParsedEndpoint

    /// Current path/query parameter values (web `params`).
    public var params: [String: String]

    /// The request body text (web `body`).
    public var body: String

    /// The optional `X-API-Key` value (web `apiKey`).
    public var apiKey: String

    /// Whether the destructive-action confirm row is showing (web `confirmOpen`).
    public private(set) var confirmOpen: Bool

    /// Whether a send is in flight (web `loading` prop) — disables the send control.
    public var isLoading: Bool

    @ObservationIgnored private let telemetry: any RequestBuilderTelemetry
    @ObservationIgnored private let onSend: (SendRequest) -> Void
    @ObservationIgnored private var started = false

    public init(
        endpoint: RequestBuilderParsedEndpoint,
        loading: Bool = false,
        telemetry: any RequestBuilderTelemetry = OSLogRequestBuilderTelemetry(),
        onSend: @escaping (SendRequest) -> Void = { _ in }
    ) {
        self.endpoint = endpoint
        params = RequestBuilderAdapter.defaultParameters(for: endpoint)
        body = RequestBuilderAdapter.seedBody(for: endpoint.requestBody)
        apiKey = ""
        confirmOpen = false
        isLoading = loading
        self.telemetry = telemetry
        self.onSend = onSend
    }

    /// Web "reset state when endpoint changes" effect: re-seed params + body and drop
    /// the confirm step. The API key is intentionally preserved (the web effect does
    /// not clear it).
    public func apply(endpoint: RequestBuilderParsedEndpoint) {
        self.endpoint = endpoint
        params = RequestBuilderAdapter.defaultParameters(for: endpoint)
        body = RequestBuilderAdapter.seedBody(for: endpoint.requestBody)
        confirmOpen = false
    }

    /// The relative path handed to the host (web `buildUrl()`).
    public var relativeURL: String {
        RequestBuilderAdapter.relativeURL(endpoint: endpoint, params: params)
    }

    /// The full path shown in the URL bar (web `/api/v1{buildUrl()}`).
    public var displayURL: String {
        RequestBuilderAdapter.displayURL(endpoint: endpoint, params: params)
    }

    public var pathParameters: [EndpointParameter] {
        endpoint.pathParameters
    }

    public var queryParameters: [EndpointParameter] {
        endpoint.queryParameters
    }

    /// Web `isDestructive` — non-GET requests need confirmation.
    public var isDestructive: Bool {
        endpoint.method.isDestructive
    }

    /// Web `handleSend`: a first press on a destructive request opens the confirm row;
    /// the next press (or a GET) builds the headers + payload and hands it to the host.
    public func send() {
        if isDestructive, !confirmOpen {
            confirmOpen = true
            return
        }
        confirmOpen = false
        let payload = SendRequest(
            url: relativeURL,
            method: endpoint.method,
            body: body.isEmpty ? nil : body,
            headers: RequestBuilderAdapter.headers(apiKey: apiKey)
        )
        onSend(payload)
    }

    /// Web `handleCancel` — dismiss the confirm row.
    public func cancel() {
        confirmOpen = false
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RequestBuilderSurface.slug)
    }
}
