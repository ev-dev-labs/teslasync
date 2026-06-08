//
//  MarkdownRenderer.Model.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) + clipboard seam
//  for the chatbot markdown renderer. The view binds through `MarkdownRendererModel`; no networking lives
//  in the view. SwiftUI parity of features/system/components/chatbot/MarkdownRenderer.tsx.
//
//  The web component takes its markdown `children` as a prop and only "suspends" while the react-markdown
//  chunk loads (rendering the raw text meanwhile). The native model owns that lifecycle: it observes the
//  bound source for the message content, parses it via `MarkdownParser`, exposes the render phase + the
//  live-state freshness envelope, routes copy-to-clipboard through an injected pasteboard, and emits
//  `view.opened` once on first appearance.
//

import Foundation
import Observation
import OSLog
import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated + redacted there.
public protocol MarkdownRendererTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogMarkdownRendererTelemetry: MarkdownRendererTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clipboard seam (web CodeBlock CopyButton)

/// The copy-to-clipboard seam behind the fenced-code copy affordance — the native parity of the web
/// CodeBlock's `<CopyButton text=…>`. Injected so tests assert the copied payload without touching the
/// system pasteboard.
@MainActor
public protocol MarkdownRendererPasteboard: AnyObject {
    func copy(_ text: String)
}

/// The platform pasteboard (UIPasteboard / NSPasteboard).
@MainActor
public final class SystemMarkdownPasteboard: MarkdownRendererPasteboard {
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
public final class InMemoryMarkdownPasteboard: MarkdownRendererPasteboard {
    public private(set) var copied: [String] = []

    public init() {}

    public func copy(_ text: String) {
        copied.append(text)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the view holds no hardcoded
/// literals. The web source is anonymous (it renders only the prose), so every key here backs native
/// chrome; they live in the "MarkdownRenderer" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time, keeping each parallel surface prompt self-contained.
public enum MarkdownRendererStrings {
    public static let table = "MarkdownRenderer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projection's injected, pre-localized copy from the catalog.
    public static func copy() -> MarkdownRendererCopy {
        MarkdownRendererCopy(
            documentLabel: string("markdownRenderer.a11y.document", "Formatted message"),
            loadingLabel: string("markdownRenderer.a11y.loading", "Loading message"),
            emptyLabel: string("markdownRenderer.a11y.empty", "No message content"),
            errorLabel: string("markdownRenderer.a11y.error", "Couldn't load the message")
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — wiring it to the chatbot message stream. Previews + tests use
/// `InMemoryMarkdownRendererSource`. The view never reads the network directly.
@MainActor
public protocol MarkdownRendererSource: AnyObject {
    var onUpdate: (@MainActor (MarkdownRendererUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the message content (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Observes the bound source for the message content, parses it into
/// a `MarkdownDocument`, resolves the render phase (loading / ready / empty / error), applies the freshness
/// envelope, routes copy-to-clipboard, and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class MarkdownRendererModel {
    public private(set) var phase: MarkdownRenderPhase = .loading
    public private(set) var connection: MarkdownConnection = .live
    /// The parsed document rendered in the `ready` phase.
    public private(set) var document = MarkdownDocument.empty
    /// The raw markdown shown by the loading fallback (web `whitespace-pre-wrap` Suspense fallback).
    public private(set) var rawText = ""
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MarkdownRendererSource
    @ObservationIgnored private let telemetry: any MarkdownRendererTelemetry
    @ObservationIgnored private let pasteboard: any MarkdownRendererPasteboard
    @ObservationIgnored private let copy: MarkdownRendererCopy
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any MarkdownRendererSource,
        telemetry: any MarkdownRendererTelemetry = OSLogMarkdownRendererTelemetry(),
        pasteboard: any MarkdownRendererPasteboard = SystemMarkdownPasteboard(),
        copy: MarkdownRendererCopy = MarkdownRendererStrings.copy()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.pasteboard = pasteboard
        self.copy = copy
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Convenience initializer for a ready, live markdown string (call sites / previews / simple hosts).
    public convenience init(
        markdown: String,
        telemetry: any MarkdownRendererTelemetry = OSLogMarkdownRendererTelemetry(),
        pasteboard: any MarkdownRendererPasteboard = SystemMarkdownPasteboard(),
        copy: MarkdownRendererCopy = MarkdownRendererStrings.copy()
    ) {
        let seed = MarkdownRendererUpdate(content: .ready(markdown), connection: .live, updatedAt: Date())
        self.init(
            source: InMemoryMarkdownRendererSource(initial: seed),
            telemetry: telemetry,
            pasteboard: pasteboard,
            copy: copy
        )
    }

    /// The spoken status of the surface for the current phase.
    public var accessibilitySummary: String {
        MarkdownRendererAccessibility.summary(for: phase, copy: copy)
    }

    /// Structural counts for the rendered document (diagnostics).
    public var documentStats: MarkdownDocumentStats {
        MarkdownDocumentStats.make(document)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MarkdownRendererSurface.slug)
        source.start()
    }

    /// Stops observing.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry: re-reads the message content through the bound source.
    public func retry() {
        source.refresh()
    }

    /// Copies a fenced code block's raw text to the clipboard (web CodeBlock CopyButton).
    public func copyCode(_ text: String) {
        pasteboard.copy(text)
    }

    private func apply(_ update: MarkdownRendererUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        recompute(from: update.content)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves `rawText` / `document` / `phase` from the bound content status.
    private func recompute(from content: MarkdownContentStatus) {
        switch content {
        case .idle:
            rawText = ""
            document = .empty
            phase = .loading
        case let .preparing(raw):
            rawText = raw
            document = .empty
            phase = .loading
        case let .ready(raw):
            rawText = raw
            document = MarkdownParser.parse(raw)
            phase = document.isEmpty ? .empty : .ready
        case let .failed(message):
            document = .empty
            phase = .error(message)
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached document and does not refetch.
    private func handleAutoRefresh(for connection: MarkdownConnection) {
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
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`, records
/// the lifecycle counts, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryMarkdownRendererSource: MarkdownRendererSource {
    public var onUpdate: (@MainActor (MarkdownRendererUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MarkdownRendererUpdate?

    public init(initial: MarkdownRendererUpdate? = nil) {
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
    public func push(_ update: MarkdownRendererUpdate) {
        onUpdate?(update)
    }
}
