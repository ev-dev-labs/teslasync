//
//  StatusHero.Model.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the at-a-glance status card. The web `<StatusHero>` is purely presentational: it takes its data as
//  plain props and renders, with no fetcher — so the native peer needs no data state-holder. What the
//  holder DOES own is the surface lifecycle: it carries the current ``StatusHeroInput`` (the props),
//  derives the pure ``StatusHeroProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), forwards the host's CTA `onClick` (web `cta.onClick`), and emits the surface's single
//  `view.opened` diagnostics event. No networking lives here.
//
//  i18n note: the web source hard-codes its copy as English literals (the five per-status default
//  headlines and the "Live" word). Native ships NO hardcoded prose, so this surface lifts those literals
//  into localizable keys resolved here through the P1/S10 facade — the per-status default headline (web
//  `cfg.defaultHeadline`) and the localized "Live" word (web `<span>Live</span>` / the `LiveIndicator`
//  label). The `headline` override, `subline`, and `cta.label` are caller-supplied (already localized,
//  like the web), so they are rendered verbatim.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`.
public typealias StatusHeroResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "StatusHero" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the derivation deterministic.
public enum StatusHeroStrings {
    public static let table = "StatusHero"

    public static let string: StatusHeroResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The per-status default headline — the localized peer of the web `STATUS_CONFIG[status]
    /// .defaultHeadline`. The fallbacks are byte-identical to the web English copy so the default render
    /// matches the source exactly.
    public static func defaultHeadline(for status: HeroStatus) -> String {
        switch status {
        case .healthy: string("statusHero.headline.healthy", "All systems operational")
        case .degraded: string("statusHero.headline.degraded", "Degraded performance")
        case .unhealthy: string("statusHero.headline.unhealthy", "Service outage")
        case .unknown: string("statusHero.headline.unknown", "Status unknown")
        case .maintenance: string("statusHero.headline.maintenance", "Scheduled maintenance")
        }
    }

    /// The localized "Live" word — the spoken peer of the web live chip, used in the VoiceOver label.
    /// The visible chip uses the shared ``TSLiveIndicator`` (which carries its own localized label); this
    /// key keeps the accessible label self-contained within the surface's table.
    public static var live: String {
        string("statusHero.live", "Live")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol StatusHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogStatusHeroTelemetry: StatusHeroTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - StatusHeroModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``StatusHeroInput`` (the web props),
/// derives the pure ``StatusHeroProjection`` as an observed read (the headline + "Live" word resolved
/// through the P1/S10 facade), forwards the host's CTA `onClick` (web `cta.onClick`), and emits
/// `view.opened` exactly once per instance. The web component has no fetcher, so neither does this
/// holder — ``update(_:)`` is the native peer of React re-rendering with new props, reassigning only
/// when the value actually changes so an unrelated re-render does not invalidate observers spuriously.
@MainActor
@Observable
public final class StatusHeroModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when status / headline / subline / live / cta change.
    public private(set) var input: StatusHeroInput

    /// The host's CTA action handler (web `cta.onClick`); `nil` when no CTA is supplied.
    @ObservationIgnored public let onActivate: (@MainActor () -> Void)?

    @ObservationIgnored private let telemetry: any StatusHeroTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: StatusHeroInput,
        onActivate: (@MainActor () -> Void)? = nil,
        telemetry: any StatusHeroTelemetry = OSLogStatusHeroTelemetry()
    ) {
        self.input = input
        self.onActivate = onActivate
        self.telemetry = telemetry
    }

    /// The resolved, view-ready card (web render output), with the headline + "Live" word resolved
    /// through the P1/S10 facade.
    public var projection: StatusHeroProjection {
        StatusHeroProjector.resolve(
            input,
            defaultHeadline: StatusHeroStrings.defaultHeadline(for:),
            liveLabel: StatusHeroStrings.live
        )
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the input actually changes so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: StatusHeroInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Invokes the host's CTA handler (web `cta.onClick`) — a no-op when no CTA was supplied.
    public func activate() {
        onActivate?()
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: StatusHeroSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear lifecycle;
    /// the once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
