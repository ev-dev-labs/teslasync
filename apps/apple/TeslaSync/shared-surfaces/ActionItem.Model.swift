//
//  ActionItem.Model.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the single operator-task row. The web `<ActionItem>` is purely presentational: it takes its data as
//  plain props and renders, with no fetcher — so the native peer needs no data state-holder. What the
//  holder DOES own is the surface lifecycle: it carries the current ``ActionItemInput`` (the props),
//  derives the pure ``ActionItemProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), composes the localized VoiceOver CTA hint, and emits the surface's single `view.opened`
//  diagnostics event. No networking lives here; the derivation is the pure projection, so the holder is
//  a thin, testable shell.
//
//  i18n note: the web source renders NO translated copy — its `title`, `description`, and `cta.label`
//  are caller-supplied (already-localized) props, and the icon / chevron are decorative. The only
//  strings this surface owns are the native a11y additions: the localized severity word used to name the
//  colour-encoded severity for VoiceOver, and the CTA navigation hints (in-app vs. external) — an
//  Apple-HIG affordance the web omits. They resolve here through the P1/S10 facade so the Swift sources
//  hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<ActionItem>` is anonymous (its copy is caller-supplied props), so the only strings this surface
/// owns are the native a11y additions resolved through ``ActionItemStrings``.
public typealias ActionItemResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "ActionItem" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the derivation deterministic.
public enum ActionItemStrings {
    public static let table = "ActionItem"

    public static let string: ActionItemResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized severity word announced to VoiceOver for a tier — the accessible parity of the
    /// web's colour-only severity signal. The fallback is the human word for the token (`Information` /
    /// `Warning` / `Error`), so VoiceOver names the severity the colour encodes for a sighted user.
    public static func severity(for severity: ActionSeverity) -> String {
        switch severity {
        case .info: string("actionItem.severity.info", "Information")
        case .warn: string("actionItem.severity.warn", "Warning")
        case .error: string("actionItem.severity.error", "Error")
        }
    }

    /// The VoiceOver hint for a CTA that navigates in-app (web internal `<Link to>`) or fires a handler
    /// (web `<button onClick>`). The web source has no equivalent; this is a native HIG affordance so
    /// VoiceOver users know the affordance is actionable.
    public static var activateHint: String {
        string("actionItem.activate.hint", "Opens details")
    }

    /// The VoiceOver hint for a CTA that opens an external target out of the app (web `external`).
    public static var externalHint: String {
        string("actionItem.external.hint", "Opens in your browser")
    }

    /// The CTA hint for a kind — the external-target hint when the CTA leaves the app (web `external`),
    /// the in-app hint otherwise.
    public static func hint(for kind: ActionItemCTAKind) -> String {
        kind.opensExternally ? externalHint : activateHint
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ActionItemTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogActionItemTelemetry: ActionItemTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ActionItemModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``ActionItemInput`` (the props), derives
/// the pure ``ActionItemProjection`` as an observed read (with the severity word resolved through the
/// P1/S10 facade), composes the localized CTA VoiceOver hint, and emits `view.opened` exactly once per
/// instance. The web component has no fetcher, so neither does this holder — ``update(_:)`` is the native
/// peer of React re-rendering with new props, reassigning only when the inputs actually change so an
/// unrelated re-render does not invalidate observers spuriously.
@MainActor
@Observable
public final class ActionItemModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when severity / title / description / cta change.
    public private(set) var input: ActionItemInput

    @ObservationIgnored private let telemetry: any ActionItemTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: ActionItemInput,
        telemetry: any ActionItemTelemetry = OSLogActionItemTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready layout decisions (web render output), with the severity word resolved
    /// through the P1/S10 facade.
    public var projection: ActionItemProjection {
        ActionItemProjector.resolve(input: input, severityWord: ActionItemStrings.severity(for:))
    }

    /// The VoiceOver hint for the trailing CTA — the external-target hint when it leaves the app (web
    /// `external`), the in-app hint otherwise, and `nil` when there is no CTA.
    public var ctaAccessibilityHint: String? {
        guard let cta = projection.cta else { return nil }
        return ActionItemStrings.hint(for: cta.kind)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: ActionItemInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ActionItemSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear lifecycle;
    /// the once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
