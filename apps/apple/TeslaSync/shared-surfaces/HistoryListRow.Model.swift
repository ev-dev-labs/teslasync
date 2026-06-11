//
//  HistoryListRow.Model.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the slot-based history row. The web component binds NO data hook at all (not even
//  `useTranslation`) — it takes everything as props / slot nodes — so the native peer needs no data
//  state-holder. What the holder DOES own is the surface lifecycle: it carries the current
//  ``HistoryListRowInputs``, derives the pure ``HistoryListRowProjection`` as an observed read
//  (SwiftUI observation replaces the React re-render), exposes the localized VoiceOver hint, and emits
//  the surface's single `view.opened` diagnostics event. No networking lives here; the derivation is
//  the pure projection, so the holder is a thin, testable shell.
//
//  i18n note: the web source carries ZERO user-facing copy (the chevron is decorative, the row has no
//  aria-label, the slot content is caller-composed). The native peer adds exactly ONE string — the
//  VoiceOver hint announced on an interactive (link / button) row — which the web omits but Apple HIG
//  expects on a navigable element. It resolves through the P1/S10 facade so the Swift sources hold no
//  hardcoded prose, keeping the "no English literals in native code" contract.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "HistoryListRow" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the derivation deterministic.
public enum HistoryListRowStrings {
    public static let table = "HistoryListRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The VoiceOver hint for an interactive (link / button) row. The web source has no equivalent
    /// (the row carries no `aria-label` / hint); this is a native HIG affordance so VoiceOver users
    /// know the row is actionable beyond its slotted content.
    public static var activateHint: String {
        string("historyListRow.activate.hint", "Opens details")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol HistoryListRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogHistoryListRowTelemetry: HistoryListRowTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HistoryListRowModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``HistoryListRowInputs`` (the structural
/// props), derives the pure ``HistoryListRowProjection`` as an observed read, exposes the localized
/// VoiceOver hint, and emits `view.opened` exactly once per instance. The web component has no
/// fetcher, so neither does this holder — `update(_:)` is the native peer of React re-rendering with
/// new props, reassigning only when the inputs actually change so an unrelated re-render does not
/// invalidate observers.
@MainActor
@Observable
public final class HistoryListRowModel {
    /// The current structural props (web `props`). Reading it (or anything derived from it) registers
    /// an observation dependency, so the surface re-renders when slot presence / glow / activation /
    /// selection change.
    public private(set) var inputs: HistoryListRowInputs

    @ObservationIgnored private let telemetry: any HistoryListRowTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: HistoryListRowInputs = HistoryListRowInputs(),
        telemetry: any HistoryListRowTelemetry = OSLogHistoryListRowTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    /// The resolved, view-ready layout decisions (web render output).
    public var projection: HistoryListRowProjection {
        HistoryListRowProjector.resolve(inputs: inputs)
    }

    /// The VoiceOver hint for the interactive row, or `nil` when the row is inert (non-navigable rows
    /// get no hint — only their slotted controls are interactive).
    public var accessibilityHint: String? {
        projection.isNavigable ? HistoryListRowStrings.activateHint : nil
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: HistoryListRowInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance, never again on a
    /// later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: HistoryListRowSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear
    /// lifecycle; the once-only `view.opened` contract is preserved (a later ``start()`` does not
    /// re-emit).
    public func stop() {
        started = false
    }
}
