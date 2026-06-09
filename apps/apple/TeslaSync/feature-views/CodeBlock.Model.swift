//
//  CodeBlock.Model.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + clipboard seam + i18n facade (P1/S10)
//  for the chatbot fenced-code block. The view binds through `CodeBlockModel`; no networking lives in the
//  view. SwiftUI parity of features/system/components/chatbot/CodeBlock.tsx.
//
//  The web leaf is purely presentational — `MarkdownRenderer` hands it the `language` + `text` props. The
//  native model owns the lifecycle: it observes the bound source for the snippet, projects it into a
//  `CodeBlockProjection`, resolves the render phase (loading / content / empty / error), applies the
//  freshness envelope (stale / offline), routes copy-to-clipboard through an injected pasteboard, and emits
//  `view.opened` once on first appearance. Kept SwiftUI-free (Foundation + Observation + OSLog + the
//  platform pasteboard only) so the model + the projection it drives compile and run on a plain host and
//  are pinned by unit tests; the SwiftUI chrome layers on top in CodeBlock.swift / CodeBlock.Views.swift.
//

import Foundation
import Observation
import OSLog

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol CodeBlockTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogCodeBlockTelemetry: CodeBlockTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clipboard seam (web CodeBlock CopyButton)

/// The copy-to-clipboard seam behind the copy affordance — the native parity of the web CodeBlock's
/// `<CopyButton text=…>`. Injected so tests assert the copied payload without touching the system
/// pasteboard.
@MainActor
public protocol CodeBlockPasteboard: AnyObject {
    func copy(_ text: String)
}

/// The platform pasteboard (UIPasteboard / NSPasteboard).
@MainActor
public final class SystemCodeBlockPasteboard: CodeBlockPasteboard {
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

/// In-memory pasteboard for previews + tests; records every copied payload.
@MainActor
public final class InMemoryCodeBlockPasteboard: CodeBlockPasteboard {
    public private(set) var copied: [String] = []

    public init() {}

    public func copy(_ text: String) {
        copied.append(text)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state holders
/// — wiring it to the chatbot fenced-code stream. Previews + tests use `InMemoryCodeBlockSource`. The view
/// never reads the network directly.
@MainActor
public protocol CodeBlockSource: AnyObject {
    var onUpdate: (@MainActor (CodeBlockUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the snippet (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Observes the bound source for the snippet, projects it into a
/// `CodeBlockProjection`, resolves the render phase, applies the freshness envelope, routes copy-to-
/// clipboard, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class CodeBlockModel {
    public private(set) var phase: CodeBlockRenderPhase = .loading
    public private(set) var connection: CodeBlockConnection = .live
    /// The projected snippet rendered in the `content` phase. Retained across a transient failure / stale /
    /// offline episode so the last-known snippet stays visible (cached) rather than flashing to a spinner.
    public private(set) var projection: CodeBlockProjection?
    public private(set) var updatedAt: Date?
    /// Whether a refresh is in flight — drives the header's subtle freshness affordance.
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any CodeBlockSource
    @ObservationIgnored private let telemetry: any CodeBlockTelemetry
    @ObservationIgnored private let pasteboard: any CodeBlockPasteboard
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CodeBlockSource,
        telemetry: any CodeBlockTelemetry = OSLogCodeBlockTelemetry(),
        pasteboard: any CodeBlockPasteboard = SystemCodeBlockPasteboard()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.pasteboard = pasteboard
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Convenience initializer for a ready, live snippet (call sites / previews / simple hosts).
    public convenience init(
        language: String? = nil,
        text: String,
        telemetry: any CodeBlockTelemetry = OSLogCodeBlockTelemetry(),
        pasteboard: any CodeBlockPasteboard = SystemCodeBlockPasteboard()
    ) {
        let snapshot = CodeBlockSnapshot(language: language, text: text)
        let seed = CodeBlockUpdate(content: .ready(snapshot), connection: .live, updatedAt: Date())
        self.init(
            source: InMemoryCodeBlockSource(initial: seed),
            telemetry: telemetry,
            pasteboard: pasteboard
        )
    }

    /// The spoken status of the surface for the current phase (the surface's VoiceOver summary).
    public var accessibilitySummary: String {
        switch phase {
        case .loading:
            CodeBlockStrings.string("codeBlock.a11y.loading", "Loading code")
        case .content:
            projection?.accessibilityLabel ?? CodeBlockStrings.string("codeBlock.a11y.content", "Code block")
        case .empty:
            CodeBlockStrings.string("codeBlock.a11y.empty", "No code to show")
        case .error:
            CodeBlockStrings.string("codeBlock.a11y.error", "Couldn't load the code")
        }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CodeBlockSurface.slug)
        source.start()
    }

    /// Stops observing.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry / the stale auto-refresh: re-reads the snippet through the bound source.
    public func refresh() {
        source.refresh()
    }

    /// Copies the snippet's raw text to the clipboard (web CodeBlock CopyButton). A no-op when there is no
    /// rendered snippet to copy.
    public func copy() {
        guard let projection else { return }
        pasteboard.copy(projection.copyPayload)
    }

    private func apply(_ update: CodeBlockUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = Self.isFetching(for: update.content, connection: update.connection)
        let hadProjection = projection != nil
        switch update.content {
        case .idle, .failed:
            break // keep the cached projection visible (offline / transient-failure resilience)
        case let .ready(snapshot):
            projection = snapshot.hasContent ? CodeBlockProjector.project(snapshot) : nil
        }
        phase = Self.resolvePhase(for: update.content, hasCachedContent: hadProjection)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached snippet and does not refetch.
    private func handleAutoRefresh(for connection: CodeBlockConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    /// Resolves the render phase. The skeleton shows only on the initial fetch with nothing cached; a
    /// resolved-but-blank snippet is the empty state; a failure with a cached snippet keeps showing it
    /// (offline / transient-failure resilience) and only falls to the error state with nothing cached.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be unit-tested
    /// from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        for content: CodeBlockContentStatus,
        hasCachedContent: Bool
    ) -> CodeBlockRenderPhase {
        switch content {
        case .idle:
            hasCachedContent ? .content : .loading
        case let .ready(snapshot):
            snapshot.hasContent ? .content : .empty
        case let .failed(message):
            hasCachedContent ? .content : .error(message)
        }
    }

    /// Whether a refresh is conceptually in flight: the host is still resolving the snippet (`idle`) or the
    /// feed is reconnecting (`stale`). Offline is settled-on-cache, so it does not show the fetching state.
    private nonisolated static func isFetching(
        for content: CodeBlockContentStatus,
        connection: CodeBlockConnection
    ) -> Bool {
        if case .idle = content { return true }
        return connection == .stale
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`, records the
/// lifecycle counts, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCodeBlockSource: CodeBlockSource {
    public var onUpdate: (@MainActor (CodeBlockUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CodeBlockUpdate?

    public init(initial: CodeBlockUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: CodeBlockUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the view + projection hold no
/// hardcoded literals. The web source is anonymous (it renders only the snippet + computes `langLabel`),
/// so every key here backs native chrome; they live in the "CodeBlock" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time, keeping each parallel surface prompt
/// self-contained. `string` is Foundation-only so the projector can resolve the accessibility label; the
/// SwiftUI `text(_:_:)` helper lives in the view file.
public enum CodeBlockStrings {
    public static let table = "CodeBlock"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
