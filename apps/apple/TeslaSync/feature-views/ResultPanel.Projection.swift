//
//  ResultPanel.Projection.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  The pure, host-testable adapter: a devtool result outcome → a render-ready
//  projection. It is the native parity of the web `ResultPanel` branch selection
//  (`error ? … : hasData ? … : idle`) plus the `JSON.stringify(data, null, 2)`
//  formatting (delegated to `JSONValue`). Foundation-only — no SwiftUI, no
//  networking, no `Shared` import — so it compiles + runs under bare `swiftc` for
//  the executed adapter harness.
//

import Foundation

// MARK: - Outcome (the web `data` / `error` / `idle` inputs, made exclusive)

/// The result of a devtool invocation, as the source projects it. The web takes
/// loose `data?` + `error?` props and resolves a branch with error precedence; the
/// native seam collapses that to one exclusive outcome so the projection is total.
public enum ResultOutcome: Equatable, Sendable {
    /// No invocation yet (web: no `data`, no `error`) — renders the idle message.
    case idle(message: String?)
    /// An invocation is in flight (native chrome the web devtool implies while a
    /// request runs) — renders the loading state.
    case running
    /// A successful result (web `data != null`) — renders the pretty JSON + copy.
    case success(JSONValue)
    /// A failed invocation (web `error`) — renders the error message.
    case failure(message: String)
}

public extension ResultOutcome {
    /// Builds a success outcome from raw response text, parsing it into an
    /// order-preserving tree so the pretty output matches the web. Non-JSON text
    /// falls back to a JSON string value (quoted), matching `JSON.stringify` of a
    /// string `data` — a raw tool response still renders rather than vanishing.
    static func success(rawJSON: String) -> ResultOutcome {
        if let parsed = try? JSONValue.parse(rawJSON) {
            return .success(parsed)
        }
        return .success(.string(rawJSON))
    }
}

// MARK: - Input (title + outcome)

/// The inputs the surface renders. `title` is caller-supplied (the surface is
/// anonymous in the web source — the title is a prop, not a localized literal).
public struct ResultPanelInput: Equatable, Sendable {
    public let title: String
    public let outcome: ResultOutcome

    public init(title: String, outcome: ResultOutcome) {
        self.title = title
        self.outcome = outcome
    }
}

// MARK: - Variant (the web background-tint + body branch)

/// The mutually-exclusive render branch, mirroring the web `ResultPanel` body:
/// error (rose) → result (pretty JSON + copy) → idle (muted message), plus the
/// native loading branch the state matrix requires.
public enum ResultVariant: Equatable, Sendable {
    case loading
    case idle
    case result
    case error
}

// MARK: - Projection (render-ready strings)

/// The render-ready projection the view switches over. Holds the pre-formatted
/// pretty JSON (web `stringifiedData`), the error message, and the caller idle
/// override — every string the SwiftUI layer shows is already resolved here, so
/// the view is a pure function of the projection.
public struct ResultProjection: Equatable, Sendable {
    public let title: String
    public let variant: ResultVariant
    /// The two-space JSON serialization (web `stringifiedData`); `nil` unless `.result`.
    public let prettyJSON: String?
    /// The failure text (web `error`); `nil` unless `.error`.
    public let errorMessage: String?
    /// The caller's idle override (web `idleMessage`); `nil` → the view localizes
    /// the default. Kept optional here so the Foundation-only adapter holds no
    /// English literal — the i18n fallback lives at the display boundary (P1/S10).
    public let idleMessage: String?

    public init(
        title: String,
        variant: ResultVariant,
        prettyJSON: String? = nil,
        errorMessage: String? = nil,
        idleMessage: String? = nil
    ) {
        self.title = title
        self.variant = variant
        self.prettyJSON = prettyJSON
        self.errorMessage = errorMessage
        self.idleMessage = idleMessage
    }

    /// Whether a result body is present (web `hasData`) — gates the copy affordance.
    public var hasData: Bool {
        variant == .result
    }

    /// The text the copy button writes (web `CopyButton text={stringifiedData}`),
    /// available only when a result is shown.
    public var copyText: String? {
        hasData ? prettyJSON : nil
    }
}

// MARK: - Builder (outcome → projection)

/// Builds a `ResultProjection` from an outcome, applying the `JSON.stringify`
/// formatting at the boundary. This is THE adapter the executed harness exercises.
public enum ResultProjectionBuilder {
    public static func build(from input: ResultPanelInput) -> ResultProjection {
        switch input.outcome {
        case let .failure(message):
            ResultProjection(title: input.title, variant: .error, errorMessage: message)
        case let .success(value):
            ResultProjection(title: input.title, variant: .result, prettyJSON: value.prettyPrinted())
        case .running:
            ResultProjection(title: input.title, variant: .loading)
        case let .idle(message):
            ResultProjection(title: input.title, variant: .idle, idleMessage: message)
        }
    }
}
