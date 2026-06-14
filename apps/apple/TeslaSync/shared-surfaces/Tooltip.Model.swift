//
//  Tooltip.Model.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  hover / focus tooltip. The web `<Tooltip>` is a self-contained presentational primitive: it takes a
//  `content` node, a `side`, an optional `multiline`, and a trigger (`children`), mints a stable `useId` for
//  `role="tooltip"` + `aria-describedby`, and lets its `:hover` / `:focus-within` CSS own the reveal. The
//  native peer is the `@Observable` ``TooltipController``: it carries the immutable `side` / `wrap` props and
//  the plain-text body (the authoritative VoiceOver description — the web `aria-describedby` content), owns
//  the tap / programmatic reveal state (the web hover / focus reveal is added at the view layer), resolves
//  the localized bubble role through the injected resolver (defaulting to the P1/S10 facade), and emits the
//  single `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` routed through keys

/// Resolves the surface's strings by key with the web English fallback, so the views and the state-holder
/// hold no hardcoded prose. Keys live in the "Tooltip" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic. The web `<Tooltip>` extracts no `t()` keys of its own (the body is
/// caller-supplied and resolved against the caller's key); the one surface-owned string is the localized
/// VoiceOver role for the floating bubble — the native peer of the web `role="tooltip"`, which the platform
/// does not speak for a custom view.
public enum TooltipStrings {
    public static let table = "Tooltip"

    /// The default bundle-backed resolver — the production wiring of ``TooltipResolve``.
    public static let resolve: TooltipResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The floating bubble's VoiceOver role key (native peer of the web `role="tooltip"`).
    public static let roleKey = "tooltip.a11y.role"
    /// The English fallback for the bubble's VoiceOver role.
    public static let roleDefault = "Tooltip"

    /// The localized bubble role (web `role="tooltip"`).
    public static var role: String {
        resolve(roleKey, roleDefault)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TooltipTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTooltipTelemetry: TooltipTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - TooltipController (P1/S8) — state-holder + derived projections

/// The surface's observable state-holder — the native peer of the web component's props + reveal state. It
/// carries the immutable `side` / `wrap` props and the plain-text body, owns the reveal open state (the tap /
/// programmatic peer of the web hover / `:focus-within` reveal — pointer hover is layered on at the view),
/// exposes the derived accessibility description (web `aria-describedby` content) and localized bubble role
/// (web `role="tooltip"`) through the injected resolver, and emits `view.opened` exactly once per
/// content-bearing instance. ``hasContent`` is the native peer of the P4 "never a blank box" rule — when it
/// is `false` (empty / whitespace body) no bubble renders and no telemetry fires.
@MainActor
@Observable
public final class TooltipController {
    /// Where the tooltip appears relative to the trigger (web `side`).
    public let side: TooltipSide

    /// Whether the body wraps onto multiple lines (web `multiline`).
    public let wrap: TooltipWrap

    /// The tooltip body as plain text — the authoritative VoiceOver description (web `aria-describedby`
    /// content) and the string the default bubble renders. Rich content (the web `ReactNode` escape hatch) is
    /// supplied at the view layer; this text remains the spoken announcement.
    public let text: String

    /// Whether the tooltip is currently revealed by tap / programmatically (the native peer of the web
    /// reveal); the view ORs this with pointer hover. Observed so the view shows / tears down the bubble.
    public var isPresented: Bool = false

    @ObservationIgnored private let resolve: TooltipResolve
    @ObservationIgnored private let telemetry: any TooltipTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder from the web props. `text` is the body (the web `content` as text);
    /// `side` / `wrap` carry the `side` / `multiline` props. `resolve` defaults to the P1/S10 facade; tests
    /// inject a deterministic resolver. `telemetry` defaults to the `os.Logger` sink.
    public init(
        text: String,
        side: TooltipSide = .webDefault,
        wrap: TooltipWrap = .webDefault,
        resolve: @escaping TooltipResolve = TooltipStrings.resolve,
        telemetry: any TooltipTelemetry = OSLogTooltipTelemetry()
    ) {
        self.text = text
        self.side = side
        self.wrap = wrap
        self.resolve = resolve
        self.telemetry = telemetry
    }

    // MARK: derived projections

    /// Whether a bubble renders at all — the native peer of the P4 "never a blank box" rule. When `false`
    /// (empty / whitespace body) the view shows only the trigger and no telemetry fires.
    public var hasContent: Bool {
        TooltipProjector.shouldRenderBubble(content: text)
    }

    /// The trigger's accessibility description — the web `aria-describedby` content (announced after the
    /// trigger's own name). `nil` when the body is empty / whitespace (no description, no bubble).
    public var accessibilityDescription: String? {
        TooltipProjector.accessibilityDescription(text)
    }

    /// The floating bubble's localized VoiceOver role — the web `role="tooltip"`.
    public var roleDescription: String {
        resolve(TooltipStrings.roleKey, TooltipStrings.roleDefault)
    }

    // MARK: reveal state (web hover / focus reveal)

    /// Reveals the tooltip (web the hover / `:focus-within` open).
    public func present() {
        isPresented = true
    }

    /// Dismisses the tooltip — the native peer of the web pointer-leave / blur dismiss.
    public func dismiss() {
        isPresented = false
    }

    /// Toggles the tooltip (the native tap affordance — tap to reveal, tap again / tap-outside to dismiss;
    /// the web `:focus-within` peer for touch, where tapping the trigger grants focus).
    public func toggle() {
        isPresented.toggle()
    }

    // MARK: lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. A surface that renders nothing (empty body,
    /// ``hasContent`` is `false`) never reports an open. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per content-bearing instance.
    public func start() {
        guard hasContent else { return }
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TooltipSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
