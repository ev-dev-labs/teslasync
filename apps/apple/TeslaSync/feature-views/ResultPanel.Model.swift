//
//  ResultPanel.Model.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  The state-holder seam (P1/S8), telemetry seam (P1/S11), clipboard seam, the
//  P1/S10 localization facade, and the surface's `@Observable` model. `ResultPanel`
//  is presentational (web "Data sources: none") — its "source" is the devtool that
//  produced the outcome, pushed in as `ResultPanelUpdate`s. The view performs no
//  networking; it is a pure function of the model's projection + freshness.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default logs via `os.Logger`; the app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(…))`, which is consent-gated + redacted.
public protocol ResultPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogResultPanelTelemetry: ResultPanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clipboard seam (web `navigator.clipboard.writeText`)

/// The clipboard the copy affordance writes through — abstracted so the copy
/// action is unit-testable with a spy and so the platform pasteboard stays out of
/// the view. Mirrors the web `CopyButton`'s `navigator.clipboard.writeText`.
@MainActor
public protocol ResultPanelClipboard {
    func copy(_ text: String)
}

/// The system pasteboard (`UIPasteboard` on iOS/iPadOS, `NSPasteboard` on macOS).
public struct SystemResultPanelClipboard: ResultPanelClipboard {
    public init() {}

    public func copy(_ text: String) {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip + connectivity banner the native state matrix requires.
public enum ResultConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One snapshot pushed by a `ResultPanelSource`: the outcome to render plus its
/// freshness. The model turns this into the projection + phase.
public struct ResultPanelUpdate: Sendable, Equatable {
    public var input: ResultPanelInput
    public var connection: ResultConnection
    public var updatedAt: Date?

    public init(
        input: ResultPanelInput,
        connection: ResultConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.input = input
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The app implements this over whatever devtool
/// harness produced the outcome (a shared state holder when the panel mirrors a
/// live query); previews + tests use `InMemoryResultPanelSource`. No HTTP here.
@MainActor
public protocol ResultPanelSource: AnyObject {
    var onUpdate: (@MainActor (ResultPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryResultPanelSource: ResultPanelSource {
    public var onUpdate: (@MainActor (ResultPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ResultPanelUpdate?

    public init(initial: ResultPanelUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ResultPanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ResultPanel" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum ResultPanelStrings {
    public static let table = "ResultPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `ResultPanelSource`,
/// rebuilds the `ResultProjection` via `ResultProjectionBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ResultPanelModel {
    /// The mutually-exclusive render branches (web body `error` / `hasData` / idle,
    /// plus the native loading branch from the state matrix).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ResultConnection = .live
    public private(set) var projection: ResultProjection
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ResultPanelSource
    @ObservationIgnored private let telemetry: any ResultPanelTelemetry
    @ObservationIgnored private let clipboard: any ResultPanelClipboard
    @ObservationIgnored private var started = false

    public init(
        source: any ResultPanelSource,
        telemetry: any ResultPanelTelemetry = OSLogResultPanelTelemetry(),
        clipboard: any ResultPanelClipboard = SystemResultPanelClipboard(),
        initialTitle: String = ""
    ) {
        self.source = source
        self.telemetry = telemetry
        self.clipboard = clipboard
        projection = ResultProjection(title: initialTitle, variant: .loading)
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ResultPanelView.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs / refreshes the underlying devtool invocation (wired to retry).
    public func refresh() {
        source.refresh()
    }

    /// Copies the rendered result to the clipboard (web `CopyButton`). Returns
    /// whether there was a result to copy, so the view can gate its "Copied" toggle.
    @discardableResult
    public func copyResult() -> Bool {
        guard let text = projection.copyText else { return false }
        clipboard.copy(text)
        return true
    }

    private func apply(_ update: ResultPanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = ResultProjectionBuilder.build(from: update.input)
        phase = Self.resolvePhase(projection)
    }

    /// Resolves the render phase from the projection variant. The web branch order
    /// (error → result → idle) is already encoded by the exclusive outcome; loading
    /// is the native in-flight branch.
    static func resolvePhase(_ projection: ResultProjection) -> Phase {
        switch projection.variant {
        case .loading:
            .loading
        case .idle:
            .empty
        case .result:
            .content
        case .error:
            .error(projection.errorMessage ?? "")
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver labels for the surface. Pure + public so the a11y content
/// is unit-testable without rendering the view.
public enum ResultPanelAccessibility {
    /// The spoken label for the whole panel in its current variant.
    public static func panelLabel(for projection: ResultProjection) -> String {
        switch projection.variant {
        case .loading:
            return "\(projection.title): \(ResultPanelStrings.string("devtools.resultPanel.loading", "Running…"))"
        case .idle:
            let message = projection.idleMessage
                ?? ResultPanelStrings.string("devtools.resultPanel.idle", "No result yet")
            return "\(projection.title): \(message)"
        case .result:
            let noun = ResultPanelStrings.string("devtools.resultPanel.resultAccessibility", "result")
            return "\(projection.title): \(noun)"
        case .error:
            let noun = ResultPanelStrings.string("devtools.resultPanel.errorAccessibility", "error")
            return "\(projection.title): \(noun). \(projection.errorMessage ?? "")"
        }
    }

    /// The spoken label for the copy button (web `CopyButton` aria-label).
    public static func copyLabel(copied: Bool) -> String {
        copied
            ? ResultPanelStrings.string("common.copyButton.copied", "Copied")
            : ResultPanelStrings.string("common.copyButton.copy", "Copy")
    }
}
