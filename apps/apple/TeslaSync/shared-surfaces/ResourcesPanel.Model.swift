//
//  ResourcesPanel.Model.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the server-resources at-a-glance panel. The web component binds NO data hook at all (not even
//  `useTranslation`) — it takes everything as props — so the native peer needs no data state-holder.
//  What the holder DOES own is the surface lifecycle: it carries the current ``ResourcesPanelInputs``,
//  derives the pure ``ResourcesPanelProjection`` as an observed read (SwiftUI observation replaces the
//  React re-render), exposes the localized panel title + empty message, and emits the surface's single
//  `view.opened` diagnostics event. No networking lives here; the derivation is the pure projection, so
//  the holder is a thin, testable shell.
//
//  i18n note: the web source carries exactly one fixed string — the panel heading "Resources". The row
//  `label` / `valueText` / `metaText` are caller-supplied (already localized by the caller, like the
//  web). The native peer resolves the heading through the P1/S10 facade and ADDS, as Apple-HIG VoiceOver
//  affordances the web omits, a friendly empty-state message and a localizable "usage" format that lets
//  VoiceOver speak a bar's percent ("73 % used"). All of it resolves through the facade so the Swift
//  sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "ResourcesPanel" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the derivation deterministic.
public enum ResourcesPanelStrings {
    public static let table = "ResourcesPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The panel heading — the native peer of the web `<h3>Resources</h3>` (the source's one fixed
    /// string). Used as the heading text and the panel's accessibility label.
    public static var title: String {
        string("resourcesPanel.title", "Resources")
    }

    /// The friendly empty-state message shown when `rows` is empty. The web renders an empty container;
    /// this is a DISCLOSED native HIG addition so the panel is never a blank box.
    public static var emptyMessage: String {
        string("resourcesPanel.empty.message", "No resources to report")
    }

    /// The spoken "usage" clause for a row that has a bar — the native peer of the web `aria-valuenow`,
    /// kept as a localizable format (`%d`) so the word order + percent glyph translate.
    public static func usageValue(percent: Int) -> String {
        let format = string("resourcesPanel.row.usage", "%d%% used")
        return String(format: format, percent)
    }

    /// The combined VoiceOver value for one row — the value, the optional sub-label, and the optional
    /// "usage" clause, joined so VoiceOver reads "1.8 GB, of 8 GB, 73 % used". The caller's
    /// already-localized `value` / `meta` are passed through; the percent clause is localized here.
    public static func rowAccessibilityValue(value: String, meta: String?, percent: Int?) -> String {
        var parts = [value]
        if let meta, !meta.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(meta)
        }
        if let percent {
            parts.append(usageValue(percent: percent))
        }
        let separator = string("resourcesPanel.row.accessibilityseparator", ", ")
        return parts.joined(separator: separator)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ResourcesPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogResourcesPanelTelemetry: ResourcesPanelTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ResourcesPanelModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``ResourcesPanelInputs`` (the props),
/// derives the pure ``ResourcesPanelProjection`` as an observed read, exposes the localized title +
/// empty message, and emits `view.opened` exactly once per instance. The web component has no fetcher,
/// so neither does this holder — `update(_:)` is the native peer of React re-rendering with new props,
/// reassigning only when the inputs actually change so an unrelated re-render does not invalidate
/// observers.
@MainActor
@Observable
public final class ResourcesPanelModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the rows / footnote change.
    public private(set) var inputs: ResourcesPanelInputs

    @ObservationIgnored private let telemetry: any ResourcesPanelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: ResourcesPanelInputs,
        telemetry: any ResourcesPanelTelemetry = OSLogResourcesPanelTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    /// The resolved, view-ready layout decisions (web render output).
    public var projection: ResourcesPanelProjection {
        ResourcesPanelProjector.resolve(inputs: inputs)
    }

    /// The localized panel heading (web `<h3>Resources</h3>`).
    public var title: String {
        ResourcesPanelStrings.title
    }

    /// The localized friendly empty-state message (DISCLOSED native HIG addition).
    public var emptyMessage: String {
        ResourcesPanelStrings.emptyMessage
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: ResourcesPanelInputs) {
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
            telemetry.viewOpened(surface: ResourcesPanelSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear lifecycle;
    /// the once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
