//
//  TeslaCarViz.Model.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  live vehicle illustration. The web `<TeslaCarViz>` is purely presentational: it takes its data as plain
//  props and renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES
//  own is the current props (the derived ``TeslaCarVizProjection`` is an observed read, so SwiftUI
//  observation replaces the React re-render) and the single `view.opened` diagnostics event. No networking
//  lives here.
//
//  The web source renders a handful of literal status labels ("Charging" / "Not Charging" / "Locked" /
//  "Unlocked" / "Climate" / "Sentry"); those are lifted into the P1/S10 catalog here, joined by the native
//  a11y additions (the illustration's spoken summary, the per-model display name, and the battery / motion
//  phrases) so the Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "TeslaCarViz" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source's literal status labels are mirrored verbatim as fallbacks.
public enum TeslaCarVizStrings {
    public static let table = "TeslaCarViz"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a status dot's label (web `<StatusDot label>`), routing the dot's key + fallback through the
    /// facade so the visible row carries no hardcoded prose.
    public static func label(for dot: TeslaCarVizStatusDot) -> String {
        string(dot.labelKey, dot.labelFallback)
    }

    /// The accessibility element name for the whole illustration (native a11y addition — the web `<svg>` is
    /// unlabelled). Voiced once for the combined element, with the live state spoken as its value.
    public static var accessibilityLabel: String {
        string("teslaCarViz.a11y.label", "Vehicle status")
    }

    /// The localized display name for a model — the spoken / VoiceOver peer of the silhouette being drawn.
    public static func modelName(_ model: TeslaCarModel) -> String {
        switch model {
        case .model3: string("teslaCarViz.model.model3", "Model 3")
        case .modelS: string("teslaCarViz.model.modelS", "Model S")
        case .modelY: string("teslaCarViz.model.modelY", "Model Y")
        case .modelX: string("teslaCarViz.model.modelX", "Model X")
        case .cybertruck: string("teslaCarViz.model.cybertruck", "Cybertruck")
        }
    }

    /// The spoken battery phrase (native a11y peer of the visible `{batteryLevel}%` bar label).
    public static func batteryPhrase(percent: Int) -> String {
        String(format: string("teslaCarViz.a11y.battery", "Battery %d percent"), percent)
    }

    /// The spoken motion phrase — driving vs parked (native a11y peer of the web `driving` decorations).
    public static func motionPhrase(isDriving: Bool) -> String {
        isDriving
            ? string("teslaCarViz.a11y.driving", "Driving")
            : string("teslaCarViz.a11y.parked", "Parked")
    }

    /// The spoken climate phrase, added to the summary only when climate is on (web `{isClimateOn && …}`).
    public static var climateOnPhrase: String {
        string("teslaCarViz.a11y.climateOn", "Climate on")
    }

    /// The spoken sentry phrase, added to the summary only when Sentry is armed (web `{sentryMode && …}`).
    public static var sentryOnPhrase: String {
        string("teslaCarViz.a11y.sentryOn", "Sentry armed")
    }

    /// The combined VoiceOver value for the illustration — a single spoken sentence assembled from the live
    /// state, so the decorative SVG reads as one informative element rather than a pile of shapes. Mirrors
    /// the web's visible information (model, battery, charging, lock, climate, sentry, motion).
    public static func accessibilityValue(for projection: TeslaCarVizProjection) -> String {
        var parts: [String] = [
            modelName(projection.model),
            batteryPhrase(percent: projection.batteryPercent),
            label(for: chargingDot(in: projection)),
            label(for: lockDot(in: projection))
        ]
        if projection.isClimateOn { parts.append(climateOnPhrase) }
        if projection.sentryMode { parts.append(sentryOnPhrase) }
        parts.append(motionPhrase(isDriving: projection.isDriving))
        return parts.joined(separator: ", ")
    }

    private static func chargingDot(in projection: TeslaCarVizProjection) -> TeslaCarVizStatusDot {
        projection.statusDots.first { $0.id == TeslaCarVizProjector.chargingDotID }
            ?? TeslaCarVizStatusDot(
                id: TeslaCarVizProjector.chargingDotID,
                active: projection.isCharging,
                role: .success,
                labelKey: "teslaCarViz.status.notCharging",
                labelFallback: "Not Charging"
            )
    }

    private static func lockDot(in projection: TeslaCarVizProjection) -> TeslaCarVizStatusDot {
        projection.statusDots.first { $0.id == TeslaCarVizProjector.lockDotID }
            ?? TeslaCarVizStatusDot(
                id: TeslaCarVizProjector.lockDotID,
                active: projection.isLocked,
                role: .success,
                labelKey: "teslaCarViz.status.unlocked",
                labelFallback: "Unlocked"
            )
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TeslaCarVizTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTeslaCarVizTelemetry: TeslaCarVizTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - TeslaCarVizModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``TeslaCarVizInput`` (the web props), derives
/// the pure ``TeslaCarVizProjection`` as an observed read (SwiftUI observation replaces the React re-render),
/// and emits `view.opened` exactly once per instance. The web component has no fetcher, so neither does this
/// holder — its sole responsibility is to keep the props and the once-only diagnostics contract.
@MainActor
@Observable
public final class TeslaCarVizModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: TeslaCarVizInput

    @ObservationIgnored private let telemetry: any TeslaCarVizTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: TeslaCarVizInput,
        telemetry: any TeslaCarVizTelemetry = OSLogTeslaCarVizTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready illustration (web render output) — a pure function of the props.
    public var projection: TeslaCarVizProjection {
        TeslaCarVizProjector.resolve(input: input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// value actually changes so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: TeslaCarVizInput) {
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
            telemetry.viewOpened(surface: TeslaCarVizSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
