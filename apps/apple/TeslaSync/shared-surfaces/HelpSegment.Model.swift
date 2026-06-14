//
//  HelpSegment.Model.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the decoupled action handlers, and the
//  observable state-holder (P1/S8) for the footer help segment. The web `HelpSegment` is purely
//  presentational: it resolves its strings through `useTranslation` and its three buttons dispatch the
//  decoupled window events (`toggle-keyboard-shortcuts`, `dispatchTourLauncherOpen()`,
//  `open-feedback-modal`) so the Cmd+K palette and any other surface keep working unchanged. There is no
//  fetcher, so the native peer needs no data state-holder — what the holder DOES own is the i18n resolver,
//  the action handlers, and the single `view.opened` diagnostics event. No networking lives here.
//
//  Parity note: the native peer of the web window events is the injectable ``HelpSegmentActions`` — three
//  closures the host wires to its keyboard-shortcuts sheet, tour launcher, and feedback modal. The
//  defaults post the matching `NotificationCenter` notifications (the native peer of the decoupled window
//  events), so a host can either inject handlers or observe the notifications, exactly as the web surface
//  stays decoupled from the React tree.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "HelpSegment" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum HelpSegmentStrings {
    public static let table = "HelpSegment"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The P1/S10 facade as a `HelpSegmentResolve` closure — the default resolver the view injects into
    /// the state-holder. Tests inject an identity / fake resolver instead.
    public static let resolve: HelpSegmentResolve = { key, fallback in
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol HelpSegmentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogHelpSegmentTelemetry: HelpSegmentTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - HelpSegmentActions (decoupled handlers — web window events)

/// The three decoupled action handlers — the native peer of the web window-event dispatch. A host either
/// injects closures (routing to its keyboard-shortcuts sheet, tour launcher, and feedback modal) or relies
/// on the defaults, which post the matching ``Notification`` so any surface can observe them — exactly as
/// the web buttons stay decoupled from the React tree via `toggle-keyboard-shortcuts`,
/// `dispatchTourLauncherOpen()`, and `open-feedback-modal`.
public struct HelpSegmentActions: Sendable {
    /// Posted by the default shortcuts handler — the native peer of the web `toggle-keyboard-shortcuts`.
    public static let toggleShortcutsNotification = Notification.Name("teslasync:keyboard-shortcuts:toggle")
    /// Posted by the default tour handler — the native peer of the web `teslasync:tour:openLauncher`.
    public static let openTourLauncherNotification = Notification.Name("teslasync:tour:openLauncher")
    /// Posted by the default feedback handler — the native peer of the web `open-feedback-modal`.
    public static let openFeedbackNotification = Notification.Name("teslasync:feedback:open")

    public let openShortcuts: @MainActor () -> Void
    public let openTour: @MainActor () -> Void
    public let openFeedback: @MainActor () -> Void

    public init(
        openShortcuts: @escaping @MainActor () -> Void = HelpSegmentActions.post(toggleShortcutsNotification),
        openTour: @escaping @MainActor () -> Void = HelpSegmentActions.post(openTourLauncherNotification),
        openFeedback: @escaping @MainActor () -> Void = HelpSegmentActions.post(openFeedbackNotification)
    ) {
        self.openShortcuts = openShortcuts
        self.openTour = openTour
        self.openFeedback = openFeedback
    }

    /// Returns a handler that posts `name` on the default center — the decoupled broadcast a host can
    /// observe without the surface owning the destination.
    public static func post(_ name: Notification.Name) -> @MainActor () -> Void {
        { NotificationCenter.default.post(name: name, object: nil) }
    }

    /// Dispatches the handler for `action`.
    @MainActor
    public func perform(_ action: HelpSegmentAction) {
        switch action {
        case .shortcuts: openShortcuts()
        case .tour: openTour()
        case .feedback: openFeedback()
        }
    }
}

// MARK: - HelpSegmentModel (P1/S8) — facade + actions + telemetry

/// The surface's observable state-holder. The web component has no fetcher, so this holder owns no data —
/// it owns the i18n resolver (held here, not in the value types, so the projection stays pure + testable),
/// the decoupled ``HelpSegmentActions``, and the single `view.opened` diagnostics event. It derives the
/// pure ``HelpSegmentProjection`` for a requested density (the density is a view-level concern — the web
/// `iconOnly` prop crossed with the responsive breakpoint — so it is passed in, not stored, exactly as the
/// sibling `LiveTelemetrySegment` passes its `iconOnly` flag to `resolved(iconOnly:)`).
@MainActor
@Observable
public final class HelpSegmentModel {
    @ObservationIgnored private let resolver: HelpSegmentResolve
    @ObservationIgnored private let actions: HelpSegmentActions
    @ObservationIgnored private let telemetry: any HelpSegmentTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        resolve: @escaping HelpSegmentResolve = HelpSegmentStrings.resolve,
        actions: HelpSegmentActions = HelpSegmentActions(),
        telemetry: any HelpSegmentTelemetry = OSLogHelpSegmentTelemetry()
    ) {
        resolver = resolve
        self.actions = actions
        self.telemetry = telemetry
    }

    /// The resolved, view-ready segment for a density — a pure function of the density + the injected
    /// resolver (the native peer of the web render for a given `iconOnly` / breakpoint).
    public func projection(density: HelpSegmentDensity) -> HelpSegmentProjection {
        HelpSegmentProjector.resolve(density: density, resolve: resolver)
    }

    /// Triggers the decoupled host action for `action` — the native peer of the web button dispatching its
    /// window event.
    public func perform(_ action: HelpSegmentAction) {
        actions.perform(action)
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance (the segment always presents its three
    /// affordances, so the first appearance is the open moment).
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: HelpSegmentSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
