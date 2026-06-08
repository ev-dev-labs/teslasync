//
//  SuggestedPrompts.Model.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility content for the chatbot suggestion strip. The view
//  binds through `SuggestedPromptsModel`; no networking lives in the view.
//
//  The web `SuggestedPrompts` is a presentational component that reads an in-process
//  `getChatSuggestions()` const and reports picks through an `onPick` callback. The
//  native surface keeps that contract — the chip pick stays the view's `onPick`
//  closure — and adds the P4 leaf lifecycle the surface contract requires: the
//  suggestions arrive through a `SuggestedPromptsSource` (the production app wires it
//  to the future backend-fed suggestions endpoint the web source's doc comment
//  anticipates; previews/tests use `InMemorySuggestedPromptsSource`), and the model
//  layers a render `phase` (loading / empty / error / content) plus an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared-core diagnostics sink (consent-gated + redacted there). The slug is a
/// static, non-identifying constant.
public protocol SuggestedPromptsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event.
public struct OSLogSuggestedPromptsTelemetry: SuggestedPromptsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the suggestion feed, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum SuggestedPromptsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013) — the orthogonal
/// connectivity axis rendered as the freshness chip + banner. `live` hides the
/// banner; `stale` / `offline` show it (cached chips stay visible behind it).
public enum SuggestedPromptsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SuggestedPromptsSource`: the cached
/// suggestions plus the load / connection status and the reference time. The model
/// turns this into the `SuggestedPromptsProjection` + render phase.
public struct SuggestedPromptsUpdate: Sendable, Equatable {
    public var status: SuggestedPromptsLoadStatus
    public var connection: SuggestedPromptsConnection
    public var suggestions: [ChatSuggestion]?
    public var updatedAt: Date?

    public init(
        status: SuggestedPromptsLoadStatus = .loading,
        connection: SuggestedPromptsConnection = .live,
        suggestions: [ChatSuggestion]? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.suggestions = suggestions
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the future chatbot-suggestions store); previews and
/// tests use `InMemorySuggestedPromptsSource`. The view never talks to the network
/// directly.
@MainActor
public protocol SuggestedPromptsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SuggestedPromptsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `SuggestedPromptsSource`,
/// recomputes the projection via `SuggestedPromptsAdapter`, exposes a render `phase`
/// + the resolved chips and the `connection` axis, and auto-refreshes once when the
/// feed transitions to stale.
@MainActor
@Observable
public final class SuggestedPromptsModel {
    /// The mutually-exclusive render branches (web shell loading / empty + the chip
    /// strip, plus the P4 leaf error state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SuggestedPromptsConnection = .live
    public private(set) var projection: SuggestedPromptsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SuggestedPromptsSource
    @ObservationIgnored private let telemetry: any SuggestedPromptsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SuggestedPromptsSource,
        telemetry: any SuggestedPromptsTelemetry = OSLogSuggestedPromptsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SuggestedPrompts.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (the stale/offline banner refresh + the
    /// error retry). Cached chips stay visible while it resolves.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SuggestedPromptsUpdate) {
        updatedAt = update.updatedAt
        projection = SuggestedPromptsAdapter.project(update.suggestions ?? [])
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
        let previous = connection
        connection = update.connection
        // Stale → one-shot auto-refresh on the transition (re-fetch the feed).
        if update.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Resolves the render phase. The initial fetch shows the loading chrome; once any
    /// chips are known they stay rendered (cached behind refresh / errors), matching
    /// the web component, which always has its const suggestions available.
    static func resolvePhase(status: SuggestedPromptsLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySuggestedPromptsSource: SuggestedPromptsSource {
    public var onUpdate: (@MainActor (SuggestedPromptsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SuggestedPromptsUpdate?

    public init(initial: SuggestedPromptsUpdate? = nil) {
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
    public func push(_ update: SuggestedPromptsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SuggestedPrompts" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SuggestedPromptsStrings {
    public static let table = "SuggestedPrompts"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility content (testable seam)

/// Builds the VoiceOver content spoken for the strip and its chips. Pure + public so
/// the a11y label content is unit-tested without rendering the view.
public enum SuggestedPromptsAccessibility {
    /// The container label — the web `aria-label` on the `<ul>` ("Suggested prompts").
    public static func containerLabel() -> String {
        SuggestedPromptsStrings.string("chatbot.aria.suggestions", "Suggested prompts")
    }

    /// The per-chip spoken label — the resolved prompt text (web button content).
    public static func chipLabel(for text: String) -> String {
        text
    }

    /// The per-chip spoken hint — explains the web behaviour (fills the input without
    /// auto-submitting) so VoiceOver users know a tap edits rather than sends.
    public static func chipHint() -> String {
        SuggestedPromptsStrings.string("chatbot.suggestion.hint", "Inserts this prompt into the message field")
    }
}
