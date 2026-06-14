//
//  ComboboxMulti.Model.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the polite-announcement seam (the
//  native parity of the web `useAnnouncer` `aria-live` region) for the multi-select combobox. The web
//  `ComboboxMulti` manages a rich interaction state — the open flag, the local input text, the
//  active-descendant index, the async option cache + in-flight flag, and the result-count / chip-removal
//  announcements — and routes the user's edited `value` array out through `onChange`.
//  `ComboboxMultiModel` owns exactly that state, derives the view-ready ``ComboboxMultiListState`` (an
//  observed read), drives the debounced + cancel-on-keystroke async loader (web `AbortController` →
//  Swift `Task` cancellation), and emits `view.opened` once. The interaction intents + the async loader
//  + the source-snapshot application live in `ComboboxMulti.Intents.swift` (an extension) to keep this
//  type within the lint length budget. No networking lives in the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter forwarding to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol ComboboxMultiTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogComboboxMultiTelemetry: ComboboxMultiTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement seam (native parity of the web `useAnnouncer` live region)

/// Posts a polite announcement to the assistive technology — the native boundary that replaces the web
/// component's `useAnnouncer` `aria-live="polite"` region (the "5 results" / "No results" feedback as
/// the user types, and the "Removed {label}" feedback on a chip removal). The view injects
/// ``LiveComboboxMultiAnnouncer``; tests inject a recording double; the model default logs so previews
/// never emit live speech.
@MainActor
public protocol ComboboxMultiAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews + headless models run quietly.
@MainActor
public struct OSLogComboboxMultiAnnouncer: ComboboxMultiAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - Option provider (web `options` prop: array OR async loader)

/// An async option loader — the native peer of the web `(query, signal) => Promise<readonly T[]>`. The
/// model debounces it and cancels the in-flight `Task` on the next keystroke (the web `AbortController`
/// abort), so the loader's structured-cancellation honours the same "newest keystroke wins" contract.
public typealias ComboboxMultiAsyncLoader = @Sendable (_ query: String) async throws -> [ComboboxMultiItem]

/// How the surface sources its options — the native peer of the web `options` prop union. `static` rows
/// arrive through the snapshot and are filtered locally (web `defaultFilter`); `async` rows come from a
/// debounced, cancellable loader that owns its own filtering. Both branches then drop already-selected
/// rows (web `selectedKeys` removal).
public enum ComboboxMultiOptionProvider {
    case staticItems
    case async(ComboboxMultiAsyncLoader)
}

// MARK: - ComboboxMultiModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. Owns the selected chips, the local input text, the open flag,
/// the active-descendant index, the async option cache + load phase, the P4 connectivity axis, and the
/// last polite announcement; derives the view-ready ``ComboboxMultiListState``; routes the edited value
/// array through the ``ComboboxMultiSource`` seam (web `onChange`); and emits `view.opened` once per
/// instance.
@MainActor
@Observable
public final class ComboboxMultiModel {
    /// The current props (web `props`).
    public private(set) var config: ComboboxMultiConfig
    /// The selected chips (web `value`). `internal(set)` so the interaction intents in
    /// `ComboboxMulti.Intents.swift` can route them while staying read-only to external callers.
    public internal(set) var selected: [ComboboxMultiItem]
    /// The local input text (web `inputText`) — "what to filter / add next", never a committed value.
    public internal(set) var query: String
    /// Whether the listbox is open (web `open`).
    public internal(set) var isOpen: Bool
    /// The highlighted row index (web `activeIndex`); `-1` = none.
    public internal(set) var activeIndex: Int
    /// The async option-load lifecycle (web `asyncLoading`); `.loaded` for a static array.
    public internal(set) var loadPhase: ComboboxMultiListPhase
    /// The P4 leaf connectivity axis (freshness chip).
    public internal(set) var connection: ComboboxMultiConnection
    /// The most-recent polite live-region text (web announce). Observed so a UI test can read it.
    public internal(set) var announcement: String
    /// A monotonically-increasing token the view observes to re-assert keyboard focus after an add /
    /// remove — the native peer of the web `inputRef.current?.focus()` calls.
    public internal(set) var focusRequestCount: Int

    @ObservationIgnored var staticItems: [ComboboxMultiItem]
    @ObservationIgnored var loadedItems: [ComboboxMultiItem]
    @ObservationIgnored var externalLoading: Bool
    @ObservationIgnored var externalError: String?
    @ObservationIgnored let provider: ComboboxMultiOptionProvider
    @ObservationIgnored let source: any ComboboxMultiSource
    @ObservationIgnored let telemetry: any ComboboxMultiTelemetry
    @ObservationIgnored let announcer: any ComboboxMultiAnnouncer
    @ObservationIgnored let debounce: Duration
    @ObservationIgnored var loadTask: Task<Void, Never>?
    @ObservationIgnored var lastAnnounced: String
    @ObservationIgnored private var started: Bool
    @ObservationIgnored private var didEmitOpen: Bool

    public init(
        config: ComboboxMultiConfig,
        provider: ComboboxMultiOptionProvider,
        source: any ComboboxMultiSource,
        debounce: Duration = ComboboxMultiMeta.defaultAsyncDebounce,
        telemetry: any ComboboxMultiTelemetry = OSLogComboboxMultiTelemetry(),
        announcer: any ComboboxMultiAnnouncer = OSLogComboboxMultiAnnouncer()
    ) {
        self.config = config
        self.provider = provider
        self.source = source
        self.debounce = debounce
        self.telemetry = telemetry
        self.announcer = announcer
        selected = []
        query = ""
        isOpen = false
        activeIndex = -1
        loadPhase = .loaded
        connection = .live
        announcement = ""
        focusRequestCount = 0
        staticItems = []
        loadedItems = []
        externalLoading = false
        externalError = nil
        lastAnnounced = ""
        started = false
        didEmitOpen = false
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ComboboxMultiMeta.surfaceSlug)
        }
        source.start()
    }

    /// Marks the surface inactive and cancels any in-flight fetch. Symmetric with ``start()``; the
    /// once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
        loadTask?.cancel()
        loadTask = nil
        source.stop()
    }
}
