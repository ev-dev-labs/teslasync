//
//  Combobox.Model.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the polite-announcement seam (the
//  native parity of the web `useAnnouncer` `aria-live` region) for the combobox. The web `Combobox`
//  manages a rich interaction state — the open flag, the input text, the active-descendant index, the
//  async option cache + in-flight flag, and the result-count announcement — and routes the user's
//  selection / free-text / typing out through props. `ComboboxModel` owns exactly that state, derives
//  the view-ready ``ComboboxListState`` (an observed read), drives the debounced + cancel-on-keystroke
//  async loader (web `AbortController` → Swift `Task` cancellation), and emits `view.opened` once. The
//  interaction intents + the async loader + the source-snapshot application live in
//  `Combobox.Intents.swift` (an extension) to keep this type within the lint length budget. No
//  networking lives in the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter forwarding to the shared-core diagnostics sink (consent-gated
/// + redacted there). The slug is a static, non-identifying constant.
public protocol ComboboxTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogComboboxTelemetry: ComboboxTelemetry {
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
/// the user types). The view injects ``LiveComboboxAnnouncer``; tests inject a recording double; the
/// model default logs so previews never emit live speech.
@MainActor
public protocol ComboboxAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews + headless models run quietly.
@MainActor
public struct OSLogComboboxAnnouncer: ComboboxAnnouncer {
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
public typealias ComboboxAsyncLoader = @Sendable (_ query: String) async throws -> [ComboboxItem]

/// How the surface sources its options — the native peer of the web `options` prop union. `static` rows
/// arrive through the snapshot and are filtered locally (web `defaultFilter`); `async` rows come from a
/// debounced, cancellable loader that owns its own filtering.
public enum ComboboxOptionProvider {
    case staticItems
    case async(ComboboxAsyncLoader)
}

// MARK: - ComboboxModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. Owns the open flag, the input text, the active-descendant
/// index, the async option cache + load phase, the P4 connectivity axis, and the last polite
/// announcement; derives the view-ready ``ComboboxListState``; routes selection / free-text / typing
/// through the ``ComboboxSource`` seam (web `onChange` / `onFreeTextCommit` / `onInputChange`); and
/// emits `view.opened` once per instance.
@MainActor
@Observable
public final class ComboboxModel {
    /// The current props (web `props`).
    public private(set) var config: ComboboxConfig
    /// The selected option (web `value`); `nil` is nothing selected. `internal(set)` so the interaction
    /// intents in `Combobox.Intents.swift` can route it while staying read-only to external callers.
    public internal(set) var selection: ComboboxItem?
    /// The input text (web `inputValue`). Mutated through ``setQuery(_:)`` so every change runs the web
    /// `handleInputChange` side effects (open + filter + announce).
    public internal(set) var query: String
    /// Whether the listbox is open (web `open`).
    public internal(set) var isOpen: Bool
    /// The highlighted row index (web `activeIndex`); `-1` = none.
    public internal(set) var activeIndex: Int
    /// The async option-load lifecycle (web `asyncLoading`); `.loaded` for a static array.
    public internal(set) var loadPhase: ComboboxListPhase
    /// The P4 leaf connectivity axis (freshness chip).
    public internal(set) var connection: ComboboxConnection
    /// The most-recent polite live-region text (web announce). Observed so a UI test can read it.
    public internal(set) var announcement: String

    @ObservationIgnored var staticItems: [ComboboxItem]
    @ObservationIgnored var loadedItems: [ComboboxItem]
    @ObservationIgnored var externalLoading: Bool
    @ObservationIgnored var externalError: String?
    @ObservationIgnored let provider: ComboboxOptionProvider
    @ObservationIgnored let source: any ComboboxSource
    @ObservationIgnored let telemetry: any ComboboxTelemetry
    @ObservationIgnored let announcer: any ComboboxAnnouncer
    @ObservationIgnored let debounce: Duration
    @ObservationIgnored var loadTask: Task<Void, Never>?
    @ObservationIgnored var lastAnnounced: String
    @ObservationIgnored private var started: Bool
    @ObservationIgnored private var didEmitOpen: Bool

    public init(
        config: ComboboxConfig,
        provider: ComboboxOptionProvider,
        source: any ComboboxSource,
        debounce: Duration = ComboboxMeta.defaultAsyncDebounce,
        telemetry: any ComboboxTelemetry = OSLogComboboxTelemetry(),
        announcer: any ComboboxAnnouncer = OSLogComboboxAnnouncer()
    ) {
        self.config = config
        self.provider = provider
        self.source = source
        self.debounce = debounce
        self.telemetry = telemetry
        self.announcer = announcer
        selection = nil
        query = ""
        isOpen = false
        activeIndex = -1
        loadPhase = .loaded
        connection = .live
        announcement = ""
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
            telemetry.viewOpened(surface: ComboboxMeta.surfaceSlug)
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
