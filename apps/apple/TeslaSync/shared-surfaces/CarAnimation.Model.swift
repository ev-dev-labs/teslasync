//
//  CarAnimation.Model.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  four motion marks. The web marks bind one display-boundary hook (`useMotionPreference`) and take their
//  data as plain props; there is no fetcher, so the native peer needs no data state-holder. What the holder
//  DOES own is the surface lifecycle: it carries the bound reduce-motion flag (the native peer of the web
//  `useReducedMotion()`, injected from the app's `\.accessibilityReduceMotion` environment), resolves each
//  mark's localized accessibility label, and emits the surface's single `view.opened` diagnostics event. No
//  networking lives here.
//
//  The web module resolves three localized strings of its own — the `role="img"` `aria-label`s for the
//  silhouette (`'Tesla vehicle illustration'`), the bolt (`'Charging'`), and the wheel (`'Loading'`) — so
//  those three keys are mirrored through the P1/S10 facade. The battery gauge has no `role`/`aria` in the
//  source (decorative), so it owns no key.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "CarAnimation" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time (the master catalog already carries `translation.carAnimation.*`); in test / preview
/// bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic.
public enum CarAnimationStrings {
    public static let table = "CarAnimation"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The silhouette's `role="img"` label (web `aria-label={t('carAnimation.tesla', ...)}`).
    public static var tesla: String {
        string("carAnimation.tesla", "Tesla vehicle illustration")
    }

    /// The charging bolt's label (web `aria-label={t('carAnimation.charging', 'Charging')}`).
    public static var charging: String {
        string("carAnimation.charging", "Charging")
    }

    /// The wheel loader's label (web `aria-label={t('carAnimation.loading', 'Loading')}`).
    public static var loading: String {
        string("carAnimation.loading", "Loading")
    }

    /// The localized `role="img"` label for a mark, or `nil` for the decorative battery gauge (web renders
    /// it with no `role`/`aria`).
    public static func label(for mark: CarAnimationMark) -> String? {
        switch mark {
        case .tesla: tesla
        case .chargingBolt: charging
        case .wheelSpin: loading
        case .batteryFill: nil
        }
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol CarAnimationTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCarAnimationTelemetry: CarAnimationTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - CarAnimationModel (P1/S8) — surface lifecycle + preference binding

/// The surface's observable state-holder, shared by all four marks. It owns the bound reduce-motion flag
/// (web `useReducedMotion()`, reassigned from the `\.accessibilityReduceMotion` environment by the view),
/// resolves each mark's localized accessibility label, and emits `view.opened` exactly once per instance.
/// The web marks have no fetcher, so neither does this holder — `update(reduceMotion:)` is the native peer of
/// React re-rendering with a new preference, reassigning only when the value actually changes so an
/// unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class CarAnimationModel {
    /// The bound Reduce Motion flag (web `useReducedMotion()`). Reassigned from the
    /// `\.accessibilityReduceMotion` environment by the view; a change re-derives every mark.
    public private(set) var reduceMotion: Bool

    @ObservationIgnored private let telemetry: any CarAnimationTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        reduceMotion: Bool = false,
        telemetry: any CarAnimationTelemetry = OSLogCarAnimationTelemetry()
    ) {
        self.reduceMotion = reduceMotion
        self.telemetry = telemetry
    }

    /// The localized `role="img"` label for a mark, or `nil` for the decorative battery gauge.
    public func accessibilityLabel(for mark: CarAnimationMark) -> String? {
        CarAnimationStrings.label(for: mark)
    }

    /// Replaces the bound Reduce Motion flag — called by the view when the `\.accessibilityReduceMotion`
    /// environment changes. Reassigns only when the value actually changes.
    public func update(reduceMotion: Bool) {
        guard reduceMotion != self.reduceMotion else { return }
        self.reduceMotion = reduceMotion
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: CarAnimationSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
