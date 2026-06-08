//
//  OnboardingChecklistWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry metadata + i18n
//  facade (P1/S10) + the testable accessibility summary.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol OnboardingChecklistTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// screen view. Bridges 1:1 to the shared telemetry sink at the composition root.
public struct OSLogOnboardingChecklistTelemetry: OnboardingChecklistTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `VehicleStore` / alert-rule / notification
/// channel / theme flows plus the onboarding discovery flags); previews and tests
/// use `InMemoryOnboardingChecklistSource`. The view never talks to HTTP or
/// `UserDefaults` directly — `dismiss()` / `restart()` mutate the persisted flags
/// behind this seam (web `state.dismiss()` / `state.restart()`).
@MainActor
public protocol OnboardingChecklistSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChecklistUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persist "user dismissed the checklist" and re-emit (web `setChecklistDismissed(true)`).
    func dismiss()
    /// Clear the dismissed / completed flags and re-emit (web `restartChecklist()`).
    func restart()
}

/// The widget's observable view-model. Subscribes to an
/// `OnboardingChecklistSource`, recomputes the `ChecklistProjection` via
/// `ChecklistBuilder`, and exposes a render `Phase` + freshness for SwiftUI to
/// switch over. No networking lives here.
@MainActor
@Observable
public final class OnboardingChecklistModel {
    /// The mutually-exclusive render branches. `hidden` is the web
    /// `shouldHideChecklist` surface (dismissed or celebration-expired); `empty`
    /// is the web `totalCount === 0` branch; `content` renders the checklist.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case hidden
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChecklistConnection = .live
    public private(set) var projection: ChecklistProjection = .empty
    /// Whether the hidden state reached 100 % (web picks the celebratory copy).
    public private(set) var hiddenAllComplete = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any OnboardingChecklistSource
    @ObservationIgnored private let telemetry: any OnboardingChecklistTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any OnboardingChecklistSource,
        telemetry: any OnboardingChecklistTelemetry = OSLogOnboardingChecklistTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OnboardingChecklistWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached projection stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// Dismisses the checklist (web header / completion-footer dismiss).
    public func dismiss() {
        source.dismiss()
    }

    /// Restarts the checklist from the hidden state (web `Restart checklist`).
    public func restart() {
        source.restart()
    }

    private func apply(_ update: ChecklistUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        let resolved = Self.resolve(update, now: Date())
        projection = resolved.projection
        hiddenAllComplete = resolved.hiddenAllComplete
        phase = resolved.phase
    }

    /// One resolved render decision — the phase plus the computed projection and
    /// the celebratory flag the hidden state reads.
    private struct Resolution {
        let phase: Phase
        let projection: ChecklistProjection
        let hiddenAllComplete: Bool
    }

    /// Pure phase resolution. Whenever cached inputs exist the checklist renders
    /// (the web keeps the surface visible through background refreshes / errors);
    /// the skeleton only shows on the very first fetch and the error state only
    /// when a failure arrives with nothing cached.
    private static func resolve(_ update: ChecklistUpdate, now: Date) -> Resolution {
        guard let inputs = update.inputs else {
            switch update.status {
            case .loading:
                return Resolution(phase: .loading, projection: .empty, hiddenAllComplete: false)
            case let .failed(message):
                return Resolution(phase: .error(message), projection: .empty, hiddenAllComplete: false)
            case .loaded, .empty:
                return Resolution(phase: .empty, projection: .empty, hiddenAllComplete: false)
            }
        }

        let projection = ChecklistBuilder.buildProjection(from: inputs)

        let phase: Phase = if case .empty = update.status {
            .empty
        } else if ChecklistBuilder.shouldHide(
            dismissed: inputs.dismissed,
            allComplete: projection.allComplete,
            completedAt: inputs.completedAt,
            now: now
        ) {
            .hidden
        } else if projection.tasks.isEmpty {
            .empty
        } else {
            .content
        }
        return Resolution(phase: phase, projection: projection, hiddenAllComplete: projection.allComplete)
    }
}

// MARK: - In-memory source (previews + unit/UI tests)

/// In-memory source for previews + tests. Drive it with `push(_:)`; `dismiss()` /
/// `restart()` mutate the held inputs and re-emit so the surface transitions
/// exactly as the persisted-flag-backed production source would.
@MainActor
public final class InMemoryOnboardingChecklistSource: OnboardingChecklistSource {
    public var onUpdate: (@MainActor (ChecklistUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissCount = 0
    public private(set) var restartCount = 0

    private var current: ChecklistUpdate

    public init(initial: ChecklistUpdate = ChecklistUpdate()) {
        current = initial
    }

    public func start() {
        startCount += 1
        onUpdate?(current)
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        onUpdate?(current)
    }

    public func dismiss() {
        dismissCount += 1
        mutateInputs { $0.dismissed = true }
    }

    public func restart() {
        restartCount += 1
        mutateInputs {
            $0.dismissed = false
            $0.completedAt = nil
        }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ChecklistUpdate) {
        current = update
        onUpdate?(update)
    }

    private func mutateInputs(_ transform: (inout ChecklistInputs) -> Void) {
        var inputs = current.inputs ?? ChecklistInputs()
        transform(&inputs)
        current.inputs = inputs
        onUpdate?(current)
    }
}

// MARK: - Registry metadata (canonical: registry/system.ts → "onboarding-checklist")

//
// These small registry value types are the native analogue of the web
// `WidgetSize` / `WidgetDef`. They mirror the predecessor dashboard-widget
// surface verbatim; the integration step that folds this staged surface into the
// app target reconciles them with the single canonical definition.
//

/// A dashboard grid size in (columns × rows), matching the web `WidgetSize`.
public struct DashboardWidgetSize: Sendable, Equatable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// The dashboard registration for a draggable widget surface (web `WidgetDef`).
public struct DashboardWidgetRegistration: Sendable {
    public let id: String
    public let nameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the
    /// native grid honors the same constraints as the web registry.
    public func clamp(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "OnboardingChecklistWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum OnboardingChecklistStrings {
    public static let table = "OnboardingChecklistWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a printf-style key and substitutes positional arguments
    /// (web interpolation, e.g. `{{done}}/{{total}}`).
    public static func formatted(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the checklist. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum OnboardingChecklistAccessibility {
    /// "{done} of {total} steps complete. {task}, {completed|not started}. …"
    public static func summary(for projection: ChecklistProjection) -> String {
        var parts = [progressLabel(projection)]
        for task in projection.tasks {
            let status = task.complete
                ? OnboardingChecklistStrings.string("widget.checklist.taskComplete", "Completed")
                : OnboardingChecklistStrings.string("widget.checklist.taskIncomplete", "Not started")
            let title = OnboardingChecklistStrings.string(task.titleKey, task.titleFallback)
            parts.append("\(title), \(status)")
        }
        return parts.joined(separator: ". ")
    }

    /// "{done} of {total} steps complete" — the progress bar's spoken value.
    public static func progressLabel(_ projection: ChecklistProjection) -> String {
        OnboardingChecklistStrings.formatted(
            "widget.checklist.progressA11y",
            "%1$lld of %2$lld steps complete",
            projection.completeCount,
            projection.totalCount
        )
    }
}
