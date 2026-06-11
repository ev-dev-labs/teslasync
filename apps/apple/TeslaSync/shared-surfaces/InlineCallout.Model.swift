//
//  InlineCallout.Model.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the contextual callout. The web `<InlineCallout>` is purely presentational: it takes its data as
//  plain props and renders, with no fetcher — so the native peer needs no data state-holder. What the
//  holder DOES own is the surface lifecycle: it carries the current ``InlineCalloutInput`` (the props),
//  derives the pure ``InlineCalloutProjection`` as an observed read (SwiftUI observation replaces the
//  React re-render), forwards the host's in-app `onClick` (web `action.onClick`), and emits the
//  surface's single `view.opened` diagnostics event. No networking lives here.
//
//  i18n note: the web source renders NO translated copy — its `children` (the body) and `action.label`
//  are caller-supplied, and the icon / chevron are decorative. The only strings this surface owns are
//  the localized severity words used for the VoiceOver label (the accessible parity of the web's
//  colour-only severity tier); they resolve here through the P1/S10 facade so the Swift sources hold no
//  hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`.
public typealias InlineCalloutResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "InlineCallout" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the labels deterministic.
public enum InlineCalloutStrings {
    public static let table = "InlineCallout"

    public static let string: InlineCalloutResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized severity word announced to VoiceOver for a variant — the accessible parity of the
    /// web's colour-only severity signal. The fallback is the capitalized token (`Info` / `Success` /
    /// `Warning` / `Danger`), matching the sibling `KpiOverviewStrings` convention.
    public static func severity(for variant: InlineCalloutVariant) -> String {
        string("inlineCallout.severity.\(variant.rawValue)", variant.rawValue.capitalized)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol InlineCalloutTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogInlineCalloutTelemetry: InlineCalloutTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - InlineCalloutModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``InlineCalloutInput`` (the web props),
/// derives the pure ``InlineCalloutProjection`` as an observed read, forwards the host's in-app
/// `onClick` (web `action.onClick`), and emits `view.opened` exactly once per instance. The web
/// component has no fetcher, so neither does this holder — ``update(_:)`` is the native peer of React
/// re-rendering with new props, reassigning only when the value actually changes so an unrelated
/// re-render does not invalidate observers spuriously.
@MainActor
@Observable
public final class InlineCalloutModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: InlineCalloutInput

    /// The host's in-app action handler (web `action.onClick`); `nil` for the link / status wrappers.
    @ObservationIgnored public let onActivate: (@MainActor () -> Void)?

    @ObservationIgnored private let telemetry: any InlineCalloutTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: InlineCalloutInput,
        onActivate: (@MainActor () -> Void)? = nil,
        telemetry: any InlineCalloutTelemetry = OSLogInlineCalloutTelemetry()
    ) {
        self.input = input
        self.onActivate = onActivate
        self.telemetry = telemetry
    }

    /// The resolved, view-ready callout (web render output), with the severity word resolved through the
    /// P1/S10 facade.
    public var projection: InlineCalloutProjection {
        InlineCalloutProjector.resolve(input, severity: InlineCalloutStrings.severity(for:))
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: InlineCalloutInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Invokes the host's in-app handler (web `action.onClick`) — a no-op when none supplied (the link /
    /// status wrappers).
    public func activate() {
        onActivate?()
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: InlineCalloutSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
