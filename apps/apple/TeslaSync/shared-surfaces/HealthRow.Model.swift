//
//  HealthRow.Model.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the single-line health summary row. The web component binds NO data hook at all (not even
//  `useTranslation`) — it takes everything as props — so the native peer needs no data state-holder.
//  What the holder DOES own is the surface lifecycle: it carries the current ``HealthRowInputs``,
//  derives the pure ``HealthRowProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), composes the localized VoiceOver label + hint, and emits the surface's single
//  `view.opened` diagnostics event. No networking lives here; the derivation is the pure projection, so
//  the holder is a thin, testable shell.
//
//  i18n note: the web source carries almost no fixed copy — the label / summary are caller-supplied
//  strings (already localized by the caller, like the web), and the chevron + dot are decorative. The
//  one fixed string the web DOES compose is the link `aria-label` = "`{label} — {summary}`". The native
//  peer mirrors that as a localizable FORMAT (so the separator + word order translate) and adds the
//  Apple-HIG VoiceOver hints for the navigable variants (a native affordance the web omits). All of it
//  resolves through the P1/S10 facade so the Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "HealthRow" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the derivation deterministic.
public enum HealthRowStrings {
    public static let table = "HealthRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The combined VoiceOver label — the native peer of the web link `aria-label` (`{label} —
    /// {summary}`). Kept as a localizable format (`%1$@` / `%2$@`) so the separator + word order
    /// translate; the caller's already-localized `label` / `summary` are interpolated in.
    public static func accessibilityLabel(label: String, summary: String) -> String {
        let format = string("healthRow.accessibility.label", "%1$@ — %2$@")
        return String(format: format, label, summary)
    }

    /// The VoiceOver hint for an in-app navigable (internal link / button) row. The web source has no
    /// equivalent; this is a native HIG affordance so VoiceOver users know the row is actionable.
    public static var activateHint: String {
        string("healthRow.activate.hint", "Opens details")
    }

    /// The VoiceOver hint for a row that opens an external target out of the app (web `external`).
    public static var externalHint: String {
        string("healthRow.external.hint", "Opens in your browser")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol HealthRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogHealthRowTelemetry: HealthRowTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HealthRowModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``HealthRowInputs`` (the props), derives
/// the pure ``HealthRowProjection`` as an observed read, composes the localized VoiceOver label + hint,
/// and emits `view.opened` exactly once per instance. The web component has no fetcher, so neither does
/// this holder — `update(_:)` is the native peer of React re-rendering with new props, reassigning only
/// when the inputs actually change so an unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class HealthRowModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when status / label / summary / activation
    /// change.
    public private(set) var inputs: HealthRowInputs

    @ObservationIgnored private let telemetry: any HealthRowTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: HealthRowInputs,
        telemetry: any HealthRowTelemetry = OSLogHealthRowTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    /// The resolved, view-ready layout decisions (web render output).
    public var projection: HealthRowProjection {
        HealthRowProjector.resolve(inputs: inputs)
    }

    /// The combined VoiceOver label for the whole row — "`{label} — {summary}`", the native peer of the
    /// web link `aria-label`. Used for every variant so the dot's status colour (which VoiceOver cannot
    /// see) is conveyed by the summary text it already reads.
    public var accessibilityLabel: String {
        HealthRowStrings.accessibilityLabel(label: projection.label, summary: projection.summary)
    }

    /// The VoiceOver hint for a navigable row — the external-target hint when the row leaves the app
    /// (web `external`), the in-app hint otherwise, and `nil` when the row is an inert summary line.
    public var accessibilityHint: String? {
        guard projection.isNavigable else { return nil }
        return projection.opensExternally ? HealthRowStrings.externalHint : HealthRowStrings.activateHint
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: HealthRowInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: HealthRowSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear lifecycle;
    /// the once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
