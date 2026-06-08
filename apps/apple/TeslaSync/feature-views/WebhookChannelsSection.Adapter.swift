//
//  WebhookChannelsSection.Adapter.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The testable, dependency-free projection core for the Settings "Webhook
//  channels" surface — the faithful port of
//  features/settings/components/WebhookChannelsSection.tsx. Everything here is pure
//  (Foundation only) so it unit-tests without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web section reads `useWebhookChannels()` (the `kind=webhook` slice of the
//      notification channels) and renders a sorted list (web
//      `[...webhooks].sort((a, b) => a.name.localeCompare(b.name))`). `sorted(_:)`
//      reproduces that localized, case-insensitive ordering.
//    • The add/edit form validates exactly like the web `handleSubmit`: a non-empty
//      trimmed name, and a URL matching `^https?:\/\//i`. `validate(name:url:)` is the
//      single tested source of that rule, returning the web `nameRequired` /
//      `urlInvalid` message keys.
//    • The HTTP method UI offers POST / PUT / PATCH (web `HTTP_METHODS`) but the save
//      payload narrows to POST | PUT (web `SAVE_METHOD_FALLBACK`); `WebhookMethod`
//      models both the display set and that narrowing via `saveMethod`.
//    • The signature preview body is the static envelope the web `sampleBody`
//      memoizes; `sampleSignatureBody` reproduces it byte-for-byte so the previewed
//      HMAC matches the web's.
//

import Foundation

// MARK: - HTTP method (web `HttpMethod` + `HTTP_METHODS` + save narrowing)

/// The webhook HTTP method. The form offers `.post` / `.put` / `.patch` (web
/// `HTTP_METHODS`); persisted channels arrive as GET / POST / PUT from the backend
/// union. `saveMethod` narrows the selection to the POST | PUT the save payload
/// accepts (web `SAVE_METHOD_FALLBACK`, PATCH → POST).
public enum WebhookMethod: String, Sendable, Equatable, CaseIterable, Identifiable {
    case get
    case post
    case put
    case patch

    public var id: String {
        rawValue
    }

    /// The methods the add/edit form offers (web `HTTP_METHODS = ['POST','PUT','PATCH']`).
    public static let formOptions: [WebhookMethod] = [.post, .put, .patch]

    /// The uppercased wire label shown in the method badge / picker (web `.toUpperCase()`).
    public var display: String {
        rawValue.uppercased()
    }

    /// The method the save payload sends: PUT stays PUT, everything else (incl. PATCH
    /// and an unknown GET) falls back to POST (web `toSavePayload` narrowing).
    public var saveMethod: WebhookMethod {
        self == .put ? .put : .post
    }

    /// Maps a raw backend / form method string to a case (case-insensitive; unknown →
    /// `.post`, matching the web `fromChannel` default).
    public static func from(_ raw: String?) -> WebhookMethod {
        switch (raw ?? "POST").lowercased() {
        case "put": .put
        case "patch": .patch
        case "get": .get
        default: .post
        }
    }
}

// MARK: - Channel (web `NotificationChannelWebhook`, UI subset)

/// One webhook channel row. Mirrors the `NotificationChannelWebhook` fields the web
/// section actually reads — `headers` / `body_template` exist in the web union but
/// are not round-tripped or rendered (the web "Blocked-Path" note), so they are
/// intentionally omitted from the UI model.
public struct WebhookChannel: Sendable, Equatable, Identifiable {
    public var channelID: Int
    public var name: String
    public var enabled: Bool
    public var url: String
    public var method: WebhookMethod

    public var id: Int {
        channelID
    }

    public init(channelID: Int, name: String, enabled: Bool, url: String, method: WebhookMethod) {
        self.channelID = channelID
        self.name = name
        self.enabled = enabled
        self.url = url
        self.method = method
    }
}

// MARK: - Test result (web `WebhookTestResult`)

/// The structured outcome of a webhook test (web `WebhookTestResult`). The backend
/// returns the same shape on transport failures (`statusCode == 0`, `error` set) and
/// HTTP failures (`statusCode >= 400`, `success == false`), so the row renders both
/// uniformly.
public struct WebhookTestOutcome: Sendable, Equatable {
    public var success: Bool
    public var statusCode: Int
    public var latencyMs: Int
    public var bodyPreview: String?
    public var truncated: Bool
    public var signature: String?
    public var error: String?

    public init(
        success: Bool,
        statusCode: Int,
        latencyMs: Int,
        bodyPreview: String? = nil,
        truncated: Bool = false,
        signature: String? = nil,
        error: String? = nil
    ) {
        self.success = success
        self.statusCode = statusCode
        self.latencyMs = latencyMs
        self.bodyPreview = bodyPreview
        self.truncated = truncated
        self.signature = signature
        self.error = error
    }

    /// The transport-failure outcome the web builds in `useTestWebhookChannel`'s
    /// `onError` (`status_code: 0`, the thrown message).
    public static func transportFailure(_ message: String) -> WebhookTestOutcome {
        WebhookTestOutcome(success: false, statusCode: 0, latencyMs: 0, error: message)
    }
}

// MARK: - Form state (web `WebhookFormState`)

/// The add/edit form's editable state (web `WebhookFormState`). `id == nil` is the
/// "Add" flow; a non-nil id is "Edit". The secret box always starts blank on edit —
/// the backend never echoes the stored secret (web `fromChannel` comment).
public struct WebhookFormState: Sendable, Equatable {
    public var channelID: Int?
    public var name: String
    public var url: String
    public var method: WebhookMethod
    public var secret: String
    public var enabled: Bool

    public init(
        channelID: Int? = nil,
        name: String = "",
        url: String = "",
        method: WebhookMethod = .post,
        secret: String = "",
        enabled: Bool = true
    ) {
        self.channelID = channelID
        self.name = name
        self.url = url
        self.method = method
        self.secret = secret
        self.enabled = enabled
    }

    /// Whether this is the edit flow (web `isEdit = initial?.id !== null`).
    public var isEdit: Bool {
        channelID != nil
    }

    /// The blank "Add webhook" form (web `EMPTY_FORM`).
    public static let empty = WebhookFormState()

    /// Builds the edit form for a channel (web `fromChannel`): copies name / url /
    /// method / enabled, and starts the secret blank.
    public static func edit(_ channel: WebhookChannel) -> WebhookFormState {
        WebhookFormState(
            channelID: channel.channelID,
            name: channel.name,
            url: channel.url,
            method: channel.method,
            secret: "",
            enabled: channel.enabled
        )
    }
}

// MARK: - Save request (web `toSavePayload`)

/// The payload the save action carries (web `toSavePayload`). `method` is already
/// narrowed to the POST | PUT the backend accepts; sending an empty `secret` clears
/// the stored signing secret (web `bearer_token` repurpose).
public struct WebhookSaveRequest: Sendable, Equatable {
    public var channelID: Int?
    public var name: String
    public var url: String
    public var method: WebhookMethod
    public var secret: String
    public var enabled: Bool

    public init(
        channelID: Int?,
        name: String,
        url: String,
        method: WebhookMethod,
        secret: String,
        enabled: Bool
    ) {
        self.channelID = channelID
        self.name = name
        self.url = url
        self.method = method
        self.secret = secret
        self.enabled = enabled
    }
}

// MARK: - Action error (web mutation `onError`)

/// The error a webhook action reports back to the view (web mutation `onError`'s
/// thrown `Error`). Carries the user-facing message the form / row surfaces.
public struct WebhookActionError: Error, Sendable, Equatable {
    public var message: String

    public init(_ message: String) {
        self.message = message
    }
}

// MARK: - Validation (web `handleSubmit` guards)

/// The result of validating the add/edit form (web `handleSubmit`): either valid
/// with the composed save request, or an i18n message key + English fallback for the
/// first failing rule.
public enum WebhookValidation: Sendable, Equatable {
    case valid(WebhookSaveRequest)
    case invalid(key: String, fallback: String)
}

// MARK: - Render phase (web load envelope) + freshness

/// What the surface should render. The web distinguishes loading / error / empty /
/// list; the loading + error envelope is supplied by the bound source, mirroring the
/// web `isLoading` / `error` wiring from `useWebhookChannels`.
public enum WebhookPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web `isLoading` / resolved / `error`).
public enum WebhookLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + cached-data banner.
public enum WebhookConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Signature preview (web `SignaturePreview` state)

/// The live HMAC signature preview state (web `SignaturePreview`): idle until a
/// secret is entered, loading while the debounced request is in flight, then the
/// resolved signature or the failure message.
public enum WebhookSignatureState: Sendable, Equatable {
    case empty
    case loading
    case loaded(String)
    case failed(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projections the surface relies on: the sorted channel list,
/// the form validation, and the load-phase resolution. A faithful port of the web
/// component's `sortedWebhooks` / `handleSubmit` / `isLoading` reads.
public enum WebhookChannelsProjection {
    /// The channels sorted by name, localized + case-insensitive (web
    /// `[...webhooks].sort((a, b) => a.name.localeCompare(b.name))`).
    public static func sorted(_ channels: [WebhookChannel]) -> [WebhookChannel] {
        channels.sorted { lhs, rhs in
            lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    /// Whether a URL is `http://` or `https://` prefixed (web `isHttpsLike`,
    /// `/^https?:\/\//i`). Trims first; empty is not valid.
    public static func isHttpLike(_ url: String) -> Bool {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let lower = trimmed.lowercased()
        return lower.hasPrefix("http://") || lower.hasPrefix("https://")
    }

    /// Validates the form and composes the save request (web `handleSubmit` +
    /// `toSavePayload`). Trims name + url; requires a non-empty name and an
    /// http(s) URL; narrows the method to POST | PUT.
    public static func validate(_ form: WebhookFormState) -> WebhookValidation {
        let trimmedName = form.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedURL = form.url.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            return .invalid(key: "webhookChannels.form.nameRequired", fallback: "Name is required.")
        }
        if !isHttpLike(trimmedURL) {
            return .invalid(
                key: "webhookChannels.form.urlInvalid",
                fallback: "URL must start with http:// or https://."
            )
        }
        return .valid(
            WebhookSaveRequest(
                channelID: form.channelID,
                name: trimmedName,
                url: trimmedURL,
                method: form.method.saveMethod,
                secret: form.secret,
                enabled: form.enabled
            )
        )
    }

    /// Resolves the render phase from the bound load status + whether the (sorted)
    /// list is empty (web `isLoading ? … : error ? … : length === 0 ? empty : list`).
    public static func resolvePhase(_ status: WebhookLoadStatus, isEmpty: Bool) -> WebhookPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            isEmpty ? .empty : .content
        }
    }
}

// MARK: - Formatting (locale-aware integers)

/// Locale-aware integer formatting for the status code + latency the test-result
/// panel shows. Pure + testable.
public enum WebhookFormat {
    public static func integer(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
