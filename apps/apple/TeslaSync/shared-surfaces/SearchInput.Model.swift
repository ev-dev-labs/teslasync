//
//  SearchInput.Model.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  debounced search field. The web `<SearchInput>` buffers local typing state (web `local`), tracks focus +
//  the recent-searches dropdown, debounces `onChange`, and drives the history list off `localStorage`; the
//  native peer owns that same interaction state here and binds the history through the ``SearchInputHistoryStore``
//  seam. The derived ``SearchInputProjection`` is an observed read (SwiftUI observation replaces the React
//  re-render). No networking lives here — the only data source is the synchronous history store.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "SearchInput" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The first four keys mirror the web `t()` calls verbatim; the rest are native
/// a11y additions the web gets "for free" from the DOM (the field role, the row hint, the empty leaf).
public enum SearchInputStrings {
    public static let table = "SearchInput"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The clear-button label fallback (web `t('common.clear', 'Clear')`).
    public static var clearLabel: String {
        string("common.clear", "Clear")
    }

    /// The recent-searches dropdown heading + listbox label (web `t('search.history.title', 'Recent
    /// searches')`).
    public static var historyTitle: String {
        string("search.history.title", "Recent searches")
    }

    /// The clear-history action label (web `t('search.history.clear', 'Clear history')`).
    public static var clearHistory: String {
        string("search.history.clear", "Clear history")
    }

    /// The per-row remove label (web `t('search.history.removeAria', 'Remove "{{query}}" from search
    /// history', { query })`). The `%@` token is the row's query.
    public static func removeAria(_ query: String) -> String {
        let format = string("search.history.removeAria", "Remove \"%@\" from search history")
        return String(format: format, locale: .current, query)
    }

    /// The VoiceOver label for the field itself (native a11y addition — the web `<input type="search">`
    /// surfaces its role to AT automatically).
    public static var fieldLabel: String {
        string("searchInput.a11y.fieldLabel", "Search")
    }

    /// The VoiceOver hint for a history-enabled field (native a11y addition — the spoken peer of the web
    /// `role="combobox"` + `aria-autocomplete="list"`).
    public static var fieldHint: String {
        string("searchInput.a11y.fieldHint", "Recent searches appear when the field is empty.")
    }

    /// The VoiceOver hint for a recent-search row (native a11y addition — the action a tap performs).
    public static var selectHint: String {
        string("searchInput.a11y.selectHint", "Search for this term")
    }

    /// Title of the empty-history leaf (native "never a blank box" addition; the web simply renders no
    /// dropdown when the scope has no entries).
    public static var emptyTitle: String {
        string("searchInput.history.empty", "No recent searches")
    }

    /// Supporting line of the empty-history leaf.
    public static var emptyMessage: String {
        string("searchInput.history.emptyMessage", "Searches you make appear here for quick access.")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant — no query text, which
/// is PII, is ever emitted.
public protocol SearchInputTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSearchInputTelemetry: SearchInputTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - SearchInputModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the props (``SearchInputInput``), the buffered local text
/// (web `local`), the focus flag (web `isFocused`), the cached recent-searches entries (web `entries`), and
/// the keyboard-highlighted row (web `activeIdx`); derives the pure ``SearchInputProjection`` as an
/// observed read; debounces `onChange` (web `setTimeout(debounceMs)`); and binds the history through the
/// ``SearchInputHistoryStore`` seam. It emits `view.opened` exactly once per instance. No fetch lives here.
@MainActor
@Observable
public final class SearchInputModel {
    /// The current props (web `props`). Reading it (or the projection) registers an observation dependency.
    public private(set) var input: SearchInputInput
    /// The buffered local text (web `local`), seeded from `value` and re-synced when `value` changes.
    public private(set) var local: String
    /// Whether the field is focused (web `isFocused`); gates the recent-searches dropdown.
    public private(set) var isFocused = false
    /// The cached recent-searches rows, newest-first (web `entries`).
    public private(set) var entries: [String] = []
    /// The keyboard-highlighted row, or `-1` for none (web `activeIdx`).
    public private(set) var activeIndex = -1
    /// A monotonically-increasing token the view observes to re-assert keyboard focus after a row select /
    /// remove / clear-all — the native peer of the web `inputRef.current?.focus()` calls.
    public private(set) var focusRequestCount = 0

    @ObservationIgnored private var onChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let store: any SearchInputHistoryStore
    @ObservationIgnored private let telemetry: any SearchInputTelemetry
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SearchInputInput,
        onChange: (@MainActor (String) -> Void)? = nil,
        store: any SearchInputHistoryStore = UserDefaultsSearchInputHistoryStore(),
        telemetry: any SearchInputTelemetry = OSLogSearchInputTelemetry()
    ) {
        self.input = input
        local = input.value
        self.onChange = onChange
        self.store = store
        self.telemetry = telemetry
    }

    /// The resolved, view-ready field (web render output) — a pure function of the props + interaction state.
    public var projection: SearchInputProjection {
        SearchInputProjector.resolve(
            input: input,
            local: local,
            isFocused: isFocused,
            entries: entries,
            activeIndex: activeIndex
        )
    }

    // MARK: Lifecycle (once-only `view.opened`)

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SearchInputSurface.slug)
        }
    }

    /// Marks the surface inactive and cancels any pending debounce. Symmetric with ``start()``; the
    /// once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
        debounceTask?.cancel()
        debounceTask = nil
    }

    // MARK: Typing + debounce (web `local` + `setTimeout(debounceMs)`)

    /// Buffers a keystroke — the web `handleInputChange`: store the text, clear the active row, and (re)arm
    /// the debounce so `onChange` fires once the user pauses.
    public func setLocal(_ next: String) {
        local = next
        activeIndex = -1
        armDebounce()
    }

    /// Flushes any pending debounced emit immediately (test seam + the native peer of the field committing
    /// on disappear). Emits only when the buffered text still differs from the committed value.
    public func flushPendingChange() {
        debounceTask?.cancel()
        debounceTask = nil
        emitIfChanged()
    }

    private func armDebounce() {
        debounceTask?.cancel()
        let interval = max(0, input.debounce)
        debounceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(interval))
            guard !Task.isCancelled, let self else { return }
            emitIfChanged()
        }
    }

    private func emitIfChanged() {
        guard SearchInputProjector.shouldEmitDebounced(local: local, value: input.value) else { return }
        onChange?(local)
    }

    // MARK: Focus (web `handleFocus` / `handleWrapperBlur`)

    /// Reflects a focus-state change — the web `handleFocus` (refresh entries, open) on gain and
    /// `handleWrapperBlur` (close, commit the current query to history) on loss.
    public func setFocused(_ focused: Bool) {
        if focused {
            refreshEntries()
            isFocused = true
            activeIndex = -1
        } else {
            isFocused = false
            activeIndex = -1
            commitToHistory()
        }
    }

    // MARK: Clear (web `handleClear`)

    /// Clears the field — the web `handleClear`: reset the text + active row, refresh the entries (so the
    /// dropdown can reappear while focused), and arm the debounce so the parent receives `onChange('')`.
    public func clear() {
        local = ""
        activeIndex = -1
        refreshEntries()
        armDebounce()
    }

    // MARK: History (web `searchHistory` interactions)

    /// Reloads the cached recent searches for the current scope — the web `refreshEntries`. History-less
    /// fields resolve to an empty list.
    public func refreshEntries() {
        guard let scope = input.historyScope, !scope.isEmpty else {
            entries = []
            return
        }
        entries = store.recent(scope: scope, max: input.maxHistory)
    }

    /// Selects a recent search — the web `selectEntry`: adopt the text, emit `onChange` immediately
    /// (skipping the debounce so the parent sees the chosen query at once), re-record it to the top of the
    /// history, clear the active row, and re-assert field focus so the user can keep refining.
    public func selectEntry(_ entry: String) {
        local = entry
        debounceTask?.cancel()
        debounceTask = nil
        onChange?(entry)
        if let scope = input.historyScope, !scope.isEmpty {
            store.record(scope: scope, query: entry)
        }
        activeIndex = -1
        requestFocus()
    }

    /// Removes one recent search — the web `handleRemoveEntry`: delete it, reload the list, clamp the
    /// active row into range, and re-assert focus.
    public func removeEntry(_ entry: String) {
        guard let scope = input.historyScope, !scope.isEmpty else { return }
        store.remove(scope: scope, query: entry)
        let next = store.recent(scope: scope, max: input.maxHistory)
        entries = next
        activeIndex = SearchInputProjector.clampActiveIndex(activeIndex, count: next.count)
        requestFocus()
    }

    /// Wipes the scope's history — the web `handleClearAll`: clear the store + the cached list, reset the
    /// active row, and re-assert focus.
    public func clearAll() {
        guard let scope = input.historyScope, !scope.isEmpty else { return }
        store.clear(scope: scope)
        entries = []
        activeIndex = -1
        requestFocus()
    }

    private func commitToHistory() {
        guard let scope = input.historyScope, !scope.isEmpty else { return }
        if SearchInputProjector.shouldRecord(historyScope: scope, query: local) {
            store.record(scope: scope, query: local)
        }
    }

    // MARK: Keyboard (web `handleInputKeyDown`)

    /// Arrow Down — the web `setActiveIdx(min(prev + 1, len - 1))`, only while the dropdown is visible.
    public func moveActiveDown() {
        guard projection.dropdownVisible else { return }
        activeIndex = SearchInputProjector.nextActiveDown(current: activeIndex, count: entries.count)
    }

    /// Arrow Up — the web `setActiveIdx(max(prev - 1, -1))`, only while the dropdown is visible.
    public func moveActiveUp() {
        guard projection.dropdownVisible else { return }
        activeIndex = SearchInputProjector.nextActiveUp(current: activeIndex)
    }

    /// Enter — the web Enter branch: select the highlighted row when one is active in the open dropdown,
    /// otherwise record the current query (when it clears the scope's min-length floor).
    public func submit() {
        if projection.dropdownVisible, SearchInputProjector.isSelectableIndex(activeIndex, count: entries.count) {
            selectEntry(entries[activeIndex])
        } else {
            commitToHistory()
        }
    }

    /// Escape — the web Escape branch: collapse the dropdown (and clear the active row) while keeping the
    /// field's keyboard focus.
    public func escape() {
        guard projection.dropdownVisible else { return }
        isFocused = false
        activeIndex = -1
    }

    /// Highlights a row under the pointer — the web `onMouseEnter={() => setActiveIdx(i)}`. A `nil` index
    /// (pointer leaving the row) clears the highlight, matching the web resting state.
    public func highlight(_ index: Int?) {
        activeIndex = index ?? -1
    }

    private func requestFocus() {
        focusRequestCount += 1
    }

    // MARK: Props update (React re-render with new props)

    /// Replaces the props + the page closure — the native peer of React re-rendering. The closure is always
    /// refreshed (it is recreated each parent render); when the controlled `value` changes the buffered
    /// `local` re-syncs to it (the web `useEffect(() => setLocal(value), [value])`).
    public func update(_ newInput: SearchInputInput, onChange: (@MainActor (String) -> Void)?) {
        self.onChange = onChange
        let valueChanged = newInput.value != input.value
        if newInput != input {
            input = newInput
        }
        if valueChanged {
            local = newInput.value
        }
    }
}
