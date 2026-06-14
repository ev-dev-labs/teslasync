//
//  WidgetFlowDiagram.Model.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  flow-diagram primitive. The web `<WidgetFlowDiagram>` is purely presentational: it takes its data as
//  plain props and draws an SVG, with no fetcher — so the native peer needs no data state-holder. What the
//  holder DOES own is the current ``WidgetFlowInput`` (the props, observed so a rebind re-renders), the
//  derived ``WidgetFlowDiagramProjection`` as an observed read (SwiftUI observation replaces the React
//  re-render), and the single `view.opened` diagnostics event. No networking, no SwiftUI here.
//
//  The web source renders no `t()` calls (it is anonymous): its only own strings are the empty-leaf
//  default `emptyMessage = 'No flow data available'` (a literal) and the SVG `aria-label="Energy flow
//  diagram"`. Both are resolved here through the P1/S10 facade with those English fallbacks, alongside the
//  native a11y / HIG additions (the empty-leaf supporting hint), so the Swift sources hold no hardcoded
//  prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetFlowDiagram" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic.
public enum WidgetFlowDiagramStrings {
    public static let table = "WidgetFlowDiagram"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web default `emptyMessage = 'No flow data available'` (the surface's
    /// only own copy literal). The host may override it via the view's `emptyMessage` prop.
    public static var emptyMessage: String {
        string("widgetFlowDiagram.empty", "No flow data available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single `<EmptyState>` line).
    public static var emptyHint: String {
        string("widgetFlowDiagram.emptyHint", "Flow appears here once data is available.")
    }

    /// VoiceOver label for the diagram graphic — the web `aria-label="Energy flow diagram"` on the `<svg>`.
    public static var accessibilityLabel: String {
        string("widgetFlowDiagram.accessibilityLabel", "Energy flow diagram")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant — never PII such as a
/// node value.
public protocol WidgetFlowDiagramTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event
/// carrying only the public surface slug.
public struct OSLogWidgetFlowDiagramTelemetry: WidgetFlowDiagramTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - WidgetFlowDiagramModel (P1/S8) — props + derivation

/// The surface's observable state-holder. It owns the current ``WidgetFlowInput`` (the web props), derives
/// the pure ``WidgetFlowDiagramProjection`` as an observed read (SwiftUI observation replaces the React
/// re-render), and emits `view.opened` exactly once per instance. The web component has no fetcher, so
/// neither does this holder.
@MainActor
@Observable
public final class WidgetFlowDiagramModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: WidgetFlowInput

    @ObservationIgnored private let telemetry: any WidgetFlowDiagramTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: WidgetFlowInput,
        telemetry: any WidgetFlowDiagramTelemetry = OSLogWidgetFlowDiagramTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The resolved, view-ready render decision (web render output) — a pure function of the props.
    public var projection: WidgetFlowDiagramProjection {
        WidgetFlowDiagramProjector.resolve(input)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// props actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: WidgetFlowInput) {
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
            telemetry.viewOpened(surface: WidgetFlowDiagramSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
