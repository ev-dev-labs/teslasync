//
//  SectionErrorBoundary.Adapter.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The testable, dependency-light core for the SectionErrorBoundary shared surface — the SwiftUI
//  parity of `components/feedback/SectionErrorBoundary.tsx`. That component wraps a section / widget
//  / chart in an error boundary so one render failure inside it doesn't blank out the whole page,
//  and it offers the three documented fallback modes of the underlying `ErrorBoundary`:
//    • the DEFAULT inline UI (web `<ErrorBoundary inline>`) — an alert tile with the failure reason
//      and a working Retry,
//    • a custom `fallbackTitle` (an alert tile with the caller's headline + the shared subtitle copy,
//      and NO Retry — exactly as the web branch omits it), and
//    • a fully custom `fallback` node (the caller renders whatever it wants; NO Retry).
//
//  Everything here is pure (Foundation only): the fallback mode (the web props), the caught render
//  failure (web `error`), the resolved fallback payload, the connectivity axis (the P4 leaf
//  contract), and the VoiceOver label builder. No store, no bundle, no rendered view, so each piece
//  is unit tested in isolation. The variant tint and the danger chrome are applied at the view
//  boundary (P1/S9 tokens), never here.
//
//  Parity note: SwiftUI has no render-time try/catch like a React error boundary, so the "caught"
//  signal is supplied by the host (the boundary's `error` input) exactly as the atomic
//  `TSSectionErrorBoundary` takes a `hasError` flag. This surface is the higher-level,
//  state-complete peer of that atomic — it adds the loading / empty / connectivity leaf states, the
//  three web fallback modes, the i18n facade, the state-holder, and the diagnostics seam.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias SectionErrorBoundaryResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Boundary text (verbatim runtime reason vs facade-resolved copy)

/// One line of boundary text. `verbatim` carries an already-resolved runtime string (the web caught
/// `error.message`, or the caller's `fallbackTitle`); `localized` carries a (key, English fallback)
/// pair the view resolves through the P1/S10 facade (the shared chrome copy). Keeping the projection
/// in terms of this enum means it stays pure and tests assert the keys directly.
public enum SectionBoundaryText: Sendable, Equatable {
    case verbatim(String)
    case localized(key: String, fallback: String)

    /// Resolves the line to a display string: a `verbatim` value is returned as-is (the caller /
    /// runtime already produced it); a `localized` line is resolved through the supplied facade (web
    /// `t(key, fallback)`). Pure, so it is asserted with an identity resolver.
    public func resolve(_ resolver: SectionErrorBoundaryResolve) -> String {
        switch self {
        case let .verbatim(value): value
        case let .localized(key, fallback): resolver(key, fallback)
        }
    }
}

// MARK: - Caught render failure (web `error`)

/// The render failure the boundary caught — the native mirror of the React `error` an
/// `ErrorBoundary` receives. `message` is the runtime failure reason shown verbatim (web
/// `error.message`); `name` correlates the boundary in diagnostics (web `name` prop logged as
/// `[ErrorBoundary:name]`). A `nil` boundary error means the guarded section is healthy.
public struct SectionBoundaryError: Sendable, Equatable {
    public let message: String

    public init(message: String) {
        self.message = message
    }
}

// MARK: - Fallback mode (the web props: default inline / `fallbackTitle` / `fallback`)

/// Which fallback the boundary shows when it catches a failure — the native mirror of the web
/// `SectionErrorBoundary` props. `inline` is the default (the underlying `ErrorBoundary` inline UI,
/// with a working Retry); `title` is the custom-headline alert (web `fallbackTitle`, NO Retry);
/// `custom` defers the entire node to the caller (web `fallback`, NO Retry).
public enum SectionBoundaryFallbackMode: Sendable, Equatable {
    case inline
    case title(String)
    case custom

    /// The resolved fallback payload for a caught `error`. Pure (no resolver): the copy is carried as
    /// `SectionBoundaryText` and resolved at the view boundary, so the branch is asserted directly.
    public func content(for error: SectionBoundaryError) -> SectionBoundaryFallbackContent {
        switch self {
        case .inline:
            SectionBoundaryFallbackContent(
                kind: .inline,
                headline: .localized(key: "errors.section.inlineTitle", fallback: "Component failed to load"),
                detail: .verbatim(error.message)
            )
        case let .title(headline):
            SectionBoundaryFallbackContent(
                kind: .title,
                headline: .verbatim(headline),
                detail: .localized(
                    key: "errors.section.subtitle",
                    fallback: "Other parts of the page should still work."
                )
            )
        case .custom:
            SectionBoundaryFallbackContent(kind: .custom, headline: nil, detail: nil)
        }
    }
}

// MARK: - Resolved fallback content (the `.caught` payload)

/// The fully-derived fallback — the recovery render of the surface. Reproduces the web fallbacks:
/// the danger-tinted leading icon, an optional emphasised headline line, an optional secondary
/// detail line, and whether the Retry affordance is offered (only the default inline mode shows it,
/// web parity). A pure value so the view is a function of it and snapshot tests assert it directly.
public struct SectionBoundaryFallbackContent: Sendable, Equatable {
    /// Which fallback shape to render — drives the view branch and the Retry gate.
    public enum Kind: Sendable, Equatable {
        case inline
        case title
        case custom
    }

    public let kind: Kind
    public let symbolName: String
    public let headline: SectionBoundaryText?
    public let detail: SectionBoundaryText?

    public init(
        kind: Kind,
        symbolName: String = "exclamationmark.triangle.fill",
        headline: SectionBoundaryText?,
        detail: SectionBoundaryText?
    ) {
        self.kind = kind
        self.symbolName = symbolName
        self.headline = headline
        self.detail = detail
    }

    /// Whether the Retry button is shown — only the default inline fallback offers it, exactly as the
    /// web `fallbackTitle` / `fallback` branches render no Retry.
    public var showsRetry: Bool {
        kind == .inline
    }
}

// MARK: - Connectivity (P4 leaf contract — orthogonal freshness axis)

/// The freshness of the live pipe the guarded section renders over — the native mirror of the
/// documented `OfflineBanner` (browser offline) and `LiveStaleDataBanner` (live feed disconnected
/// ≥ 2 min) consumers. `live` shows no freshness chip; `stale` auto-refreshes once on the
/// transition; `offline` keeps the last-known render with an offline chip.
public enum SectionBoundaryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Accessibility (testable seam)

/// Builds a fallback's combined VoiceOver label from already-resolved parts, so the spoken content
/// is asserted without rendering the view. Reads the headline (when present) then the detail as one
/// sentence; parts already ending in terminal punctuation are joined with a single space so the
/// sentence never doubles a period.
public enum SectionBoundaryAccessibility {
    public static func label(headline: String?, detail: String?) -> String {
        var parts: [String] = []
        if let headline, !headline.isEmpty {
            parts.append(headline)
        }
        if let detail, !detail.isEmpty {
            parts.append(detail)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}
