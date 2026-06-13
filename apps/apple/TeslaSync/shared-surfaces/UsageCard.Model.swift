//
//  UsageCard.Model.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  usage card. The web `UsageCard` is purely presentational — it takes its data as plain props and calls
//  no `t()` of its own — so the native peer needs no data state-holder. What the holder DOES own is the
//  surface lifecycle: it carries the current ``UsageCardInput`` + the host-supplied `onNavigate` seam,
//  derives the pure ``UsageCardProjection`` + the localized VoiceOver labels as observed reads (SwiftUI
//  observation replaces the React re-render), and emits the surface's single `view.opened` diagnostics
//  event. No networking lives here.
//
//  The web source is anonymous: its only own copy is the hardcoded English empty-state default
//  ("No data to display yet."), localized here as an improvement. Everything else resolved in this file is
//  a native accessibility addition (the budget percent value, the external-link hint, the combined band /
//  detail / banner labels) — there are no web `t()` keys to mirror, because the source has none.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "UsageCard" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum UsageCardStrings {
    public static let table = "UsageCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-state default — the localized peer of the web hardcoded `'No data to display yet.'`.
    public static var defaultEmptyMessage: String {
        string("usageCard.empty.default", "No data to display yet.")
    }

    /// The budget bar's VoiceOver value — the spoken peer of the web `aria-valuenow`. `%1$d` is the
    /// rounded percentage; VoiceOver reads "8%" as "8 percent".
    public static func budgetPercentValue(_ percent: Int) -> String {
        String(format: string("usageCard.budget.percentValue", "%1$d%%"), percent)
    }

    /// The VoiceOver hint announced on an external footer link — the spoken peer of the web
    /// `target="_blank"` (native a11y addition; the web has no equivalent text).
    public static var externalLinkHint: String {
        string("usageCard.footer.externalHint", "Opens in browser")
    }

    /// The combined VoiceOver label for the callout banner — its title then description read as one
    /// element (the spoken peer of the web `role="status"` region). `%1$@` is the title, `%2$@` the
    /// description (positional so a translation may reorder them).
    public static func bannerAccessibilityLabel(title: String, description: String) -> String {
        String(format: string("usageCard.banner.label", "%1$@. %2$@"), title, description)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol UsageCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogUsageCardTelemetry: UsageCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - UsageCardModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``UsageCardInput`` (the web props) + the
/// host-supplied `onNavigate` seam (the native peer of react-router navigation for internal footer
/// links), derives the pure ``UsageCardProjection`` + the resolved empty message + the localized VoiceOver
/// labels as observed reads, and emits `view.opened` exactly once per instance. The web component has no
/// fetcher, so neither does this holder — `update(_:onNavigate:)` is the native peer of React re-rendering
/// with new props, reassigning only when the inputs actually change so an unrelated re-render does not
/// invalidate observers spuriously.
@MainActor
@Observable
public final class UsageCardModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: UsageCardInput

    @ObservationIgnored private var onNavigate: (@MainActor (UsageCardFooterLink) -> Void)?
    @ObservationIgnored private let telemetry: any UsageCardTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: UsageCardInput,
        onNavigate: (@MainActor (UsageCardFooterLink) -> Void)? = nil,
        telemetry: any UsageCardTelemetry = OSLogUsageCardTelemetry()
    ) {
        self.input = input
        self.onNavigate = onNavigate
        self.telemetry = telemetry
    }

    /// The resolved, view-ready card (web render output).
    public var projection: UsageCardProjection {
        UsageCardProjector.resolve(input)
    }

    /// The empty-state copy — web `emptyMessage ?? 'No data to display yet.'`, localized.
    public var resolvedEmptyMessage: String {
        input.emptyMessage ?? UsageCardStrings.defaultEmptyMessage
    }

    /// The budget bar's VoiceOver value for a resolved projection — "8%", spoken as "8 percent".
    public func budgetAccessibilityValue(_ budget: UsageCardBudgetProjection) -> String {
        UsageCardStrings.budgetPercentValue(budget.accessibilityValuePercent)
    }

    /// The combined VoiceOver label for the callout banner — "Title. Description".
    public func bannerAccessibilityLabel(_ banner: UsageCardBannerProjection) -> String {
        UsageCardStrings.bannerAccessibilityLabel(title: banner.title, description: banner.description)
    }

    /// Routes an internal footer-link tap to the host (web react-router navigation). The view hands back
    /// the view-ready ``UsageCardFooterLinkProjection``; this maps it to the raw prop link (by id) so the
    /// host's seam keeps the original props shape. External links open their URL directly in the view, so
    /// they never reach this seam.
    public func navigate(to link: UsageCardFooterLinkProjection) {
        guard let raw = input.footer.first(where: { $0.id == link.id }) else { return }
        onNavigate?(raw)
    }

    /// Replaces the props + the host closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(
        _ input: UsageCardInput,
        onNavigate: (@MainActor (UsageCardFooterLink) -> Void)?
    ) {
        self.onNavigate = onNavigate
        if input != self.input {
            self.input = input
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: UsageCardSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
