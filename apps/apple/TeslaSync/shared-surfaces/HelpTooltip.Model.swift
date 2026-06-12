//
//  HelpTooltip.Model.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  help "?" tooltip. The web `<HelpTooltip>` is a self-contained presentational primitive: it resolves one
//  string from its props, derives the trigger's accessible name and the "Learn more" label, and composes the
//  shared `<Tooltip>` whose `:focus-within` / hover reveal owns the open state. The native peer is the
//  `@Observable` ``HelpTooltipController``: it resolves the ``HelpTooltipContent`` through the pure
//  ``HelpTooltipProjector`` once at construction, exposes the derived accessible name (web `ariaLabel ??
//  t('help.tooltip.iconLabel')`) and learn-more label (web `learnMore.label ?? t('common.learnMore')`), owns
//  the popover open state (the web Tooltip reveal), and emits the single `view.opened` diagnostics event. No
//  networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` routed through keys

/// Resolves the surface's strings by key with the web English fallback, so the views and the state-holder
/// hold no hardcoded prose. Keys live in the "HelpTooltip" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic. Every `t(...)` call in `components/ui/HelpTooltip.tsx` is routed here.
public enum HelpTooltipStrings {
    public static let table = "HelpTooltip"

    /// The default bundle-backed resolver — the production wiring of ``HelpTooltipResolve``.
    public static let resolve: HelpTooltipResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The trigger's default accessible-name key (web `t('help.tooltip.iconLabel', 'More info')`).
    public static let iconLabelKey = "help.tooltip.iconLabel"
    /// The English fallback for the trigger's accessible name.
    public static let iconLabelDefault = "More info"

    /// The "Learn more" link's default-label key (web `t('common.learnMore', 'Learn more')`).
    public static let learnMoreKey = "common.learnMore"
    /// The English fallback for the "Learn more" link.
    public static let learnMoreDefault = "Learn more"

    /// The trigger's default accessible name (web `t('help.tooltip.iconLabel', 'More info')`).
    public static var iconLabel: String {
        resolve(iconLabelKey, iconLabelDefault)
    }

    /// The default "Learn more" link label (web `t('common.learnMore', 'Learn more')`).
    public static var learnMore: String {
        resolve(learnMoreKey, learnMoreDefault)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol HelpTooltipTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogHelpTooltipTelemetry: HelpTooltipTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HelpTooltipController (P1/S8) — state-holder + derived labels

/// The surface's observable state-holder — the native peer of the web component's resolution + reveal state.
/// It resolves the ``HelpTooltipContent`` once through the pure ``HelpTooltipProjector`` (the web `resolved`
/// computation), exposes the derived accessible name and learn-more label through the injected resolver
/// (defaulting to the P1/S10 facade), carries the immutable `placement` / `size` props for the view, owns the
/// popover open state (the web Tooltip's hover / focus reveal), and emits `view.opened` exactly once per
/// instance. ``hasContent`` is the native peer of the web `if (!resolved) return null` — when it is `false`
/// the view renders nothing and never emits telemetry.
@MainActor
@Observable
public final class HelpTooltipController {
    /// The resolved tooltip body, or `nil` when there is nothing to show (web `resolved` / `return null`).
    public let content: HelpTooltipContent?

    /// Where the tooltip appears relative to the trigger (web `placement`).
    public let placement: HelpTooltipPlacement

    /// The trigger glyph size (web `size`).
    public let size: HelpTooltipSize

    /// Whether the tooltip is currently revealed (web the Tooltip's `:focus-within` / hover open). Observed
    /// so the view shows / tears down the popover.
    public var isPresented: Bool = false

    @ObservationIgnored private let ariaLabelOverride: String?
    @ObservationIgnored private let resolve: HelpTooltipResolve
    @ObservationIgnored private let telemetry: any HelpTooltipTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder from the web props. Either `text` (plain copy) or `i18nKey` (+ `defaultValue`
    /// fallback) supplies the body — when `i18nKey` is set, `text` is ignored, exactly as the web ternary
    /// does. `ariaLabel` overrides the trigger's accessible name (web `ariaLabel`). `resolve` defaults to the
    /// P1/S10 facade; tests inject a deterministic resolver.
    public init(
        text: String? = nil,
        i18nKey: String? = nil,
        defaultValue: String? = nil,
        learnMore: HelpTooltipLearnMore? = nil,
        placement: HelpTooltipPlacement = .webDefault,
        size: HelpTooltipSize = .webDefault,
        ariaLabel: String? = nil,
        resolve: @escaping HelpTooltipResolve = HelpTooltipStrings.resolve,
        telemetry: any HelpTooltipTelemetry = OSLogHelpTooltipTelemetry()
    ) {
        content = HelpTooltipProjector.content(
            text: text,
            i18nKey: i18nKey,
            defaultValue: defaultValue,
            learnMore: learnMore,
            using: resolve
        )
        self.placement = placement
        self.size = size
        ariaLabelOverride = ariaLabel
        self.resolve = resolve
        self.telemetry = telemetry
    }

    // MARK: derived projections

    /// Whether the surface renders at all — the native peer of the web `if (!resolved) return null`. When
    /// `false` the view is an `EmptyView` and no telemetry fires.
    public var hasContent: Bool {
        content != nil
    }

    /// The trigger's accessible name — the web `ariaLabel ?? t('help.tooltip.iconLabel', 'More info')`.
    public var accessibilityLabel: String {
        ariaLabelOverride ?? resolve(HelpTooltipStrings.iconLabelKey, HelpTooltipStrings.iconLabelDefault)
    }

    /// The "Learn more" link's label — the web `learnMore.label ?? t('common.learnMore', 'Learn more')`.
    public var learnMoreLabel: String {
        content?.learnMore?.label ?? resolve(HelpTooltipStrings.learnMoreKey, HelpTooltipStrings.learnMoreDefault)
    }

    // MARK: reveal state (web Tooltip hover / focus reveal)

    /// Reveals the tooltip (web the Tooltip's hover / `:focus-within` open).
    public func present() {
        isPresented = true
    }

    /// Dismisses the tooltip — the native peer of the web blur / pointer-leave dismiss.
    public func dismiss() {
        isPresented = false
    }

    /// Toggles the tooltip (the native tap affordance — tap to reveal, tap again / tap-outside to dismiss).
    public func toggle() {
        isPresented.toggle()
    }

    // MARK: lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. A surface that renders nothing (web `return null`,
    /// ``hasContent`` is `false`) never reports an open. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per content-bearing instance.
    public func start() {
        guard hasContent else { return }
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: HelpTooltipSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
