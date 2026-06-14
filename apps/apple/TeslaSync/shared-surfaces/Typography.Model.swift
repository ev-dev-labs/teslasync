//
//  Typography.Model.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  typographic role system. The web `<Typography>` family is purely presentational: it takes its text +
//  role/granular options as plain props and renders, with no fetcher — so the native peer needs no data
//  state-holder. What the holder DOES own is the surface's rendered content (``TypographyContent`` — the
//  caller's text plus the resolved ``TypographyStyle``, an observed read so a reused element re-renders when
//  its props change) and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders no copy of its own (its text is a caller-supplied, already-localized prop), so the
//  only localized strings resolved here are the native a11y additions — the "never a blank box" empty-leaf
//  title + message — there are no web `t()` keys to mirror.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "Typography" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source is anonymous, so these are native a11y additions only.
public enum TypographyStrings {
    public static let table = "Typography"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Title of the empty leaf, shown when a host passes empty text so the surface never renders a bare box
    /// (native HIG; the web simply renders empty children).
    public static var emptyTitle: String {
        string("typography.empty.title", "Nothing to display")
    }

    /// Supporting line of the empty leaf.
    public static var emptyMessage: String {
        string("typography.empty.message", "Text appears here when it becomes available.")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TypographyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTypographyTelemetry: TypographyTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - TypographyContent (the holder's observed render state)

/// The resolved render state — the caller's text plus the style ``TypographyProjector`` derived for it. A
/// value type so the view, the state-holder, and `.onChange` agree on one shape and a reused element can
/// detect a prop change cheaply. ``isBlank`` drives the native empty-leaf branch (web renders empty
/// children; the native peer shows the "never a blank box" leaf).
public struct TypographyContent: Sendable, Equatable {
    /// The caller-supplied, already-localized text (web `children`), rendered verbatim.
    public let text: String
    /// The resolved style for the chosen role / granular composition.
    public let style: TypographyStyle

    public init(text: String, style: TypographyStyle) {
        self.text = text
        self.style = style
    }

    /// Whether the text is empty / whitespace-only — the trigger for the empty leaf.
    public var isBlank: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - TypographyModel (P1/S8) — render state + once-only telemetry

/// The surface's observable state-holder. It owns the current ``TypographyContent`` (reading it registers an
/// observation dependency, so the surface re-renders when the props change) and emits `view.opened` exactly
/// once per instance. The web component has no fetcher, so neither does this holder — there is no loading,
/// error, stale, or offline state to model.
@MainActor
@Observable
public final class TypographyModel {
    /// The current render state (web render output) — observed so a reused element re-renders on change.
    public private(set) var content: TypographyContent

    @ObservationIgnored private let telemetry: any TypographyTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        content: TypographyContent,
        telemetry: any TypographyTelemetry = OSLogTypographyTelemetry()
    ) {
        self.content = content
        self.telemetry = telemetry
    }

    /// Replaces the render state — the native peer of React re-rendering with new props. Reassigns only when
    /// the content actually changes so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ content: TypographyContent) {
        guard content != self.content else { return }
        self.content = content
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TypographySurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
