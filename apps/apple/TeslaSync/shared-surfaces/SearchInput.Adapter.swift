//
//  SearchInput.Adapter.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The Foundation-only core for the debounced search field — the SwiftUI parity of
//  `components/forms/SearchInput.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the props value type (``SearchInputInput``), the view-ready ``SearchInputProjection``, and
//  the pure ``SearchInputProjector`` that resolves the clear-button visibility (web `local ? <clear/>`), the
//  recent-searches dropdown visibility (web `dropdownVisible`), the active-row arithmetic (web Arrow
//  Up/Down + the post-remove clamp), the debounce emit decision (web `local !== value`), and the
//  record-to-history predicate (web `local.trim().length >= MIN_QUERY_LEN`). No SwiftUI and no
//  `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<SearchInput>` is a PRESENTATIONAL FORM PRIMITIVE. Its only data source
//  is the synchronous, local `@/lib/searchHistory` (localStorage) recent-searches list — there is no
//  fetch, no React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch
//  (there is nothing to fetch, fail, age, or lose connectivity to; localStorage reads are synchronous and
//  swallow their own failures into an empty list). Inventing such chrome would fabricate states the source
//  does not have, so this surface reproduces only the source's REAL branches — exactly as the sibling
//  presentational primitives Accordion (0203), ActiveFilterChips (0147), TagInput (0160), MetricCard
//  (0095), and InlineCallout (0124) did. The real branches: the empty field (no clear, no dropdown), the
//  filled field (trailing clear), the history-less field (no scope), the focused-empty recent-searches
//  dropdown (populated), the keyboard-highlighted row, the per-row remove + clear-all, and the native
//  "never a blank box" empty-history leaf.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum SearchInputSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "SearchInput"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The production
/// app passes the P1/S10 facade; tests pass an identity resolver. Kept as a plain closure so the pure core
/// has no dependency on a bundle.
public typealias SearchInputResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SearchInputInput (web props, closure-free)

/// The component's props — the native peer of `SearchInputProps`, minus the `onChange` closure (held by the
/// view + the state-holder). A value type so the view, the state-holder, and the pure projection agree on
/// one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when the page rebinds (e.g. a
/// consumer resets the controlled `value`).
public struct SearchInputInput: Sendable, Equatable {
    /// The current committed value the parent controls (web `value`). Seeds the buffered local text.
    public let value: String
    /// The hint shown when the field is empty (web `placeholder`), or `nil` for none. // parity:allow web prop name
    public let prompt: String?
    /// The debounce window before `onChange` fires (web `debounceMs / 1000`, default `0.25`s).
    public let debounce: TimeInterval
    /// Auto-focus the field on mount (web `autoFocus`).
    public let autoFocus: Bool
    /// An explicit accessible label for the clear button (web `clearLabel`); falls back to `common.clear`.
    public let clearLabel: String?
    /// The recent-searches storage scope (web `historyScope`), or `nil` to keep the field history-less.
    public let historyScope: String?
    /// Whether focusing the empty field reveals the recent-searches dropdown (web `showHistoryOnFocus`).
    public let showHistoryOnFocus: Bool
    /// Maximum history entries rendered in the dropdown (web `maxHistory`, default `8`).
    public let maxHistory: Int

    public init(
        value: String,
        prompt: String? = nil,
        debounce: TimeInterval = SearchInputProjector.defaultDebounce,
        autoFocus: Bool = false,
        clearLabel: String? = nil,
        historyScope: String? = nil,
        showHistoryOnFocus: Bool = true,
        maxHistory: Int = SearchInputHistory.defaultReturn
    ) {
        self.value = value
        self.prompt = prompt
        self.debounce = debounce
        self.autoFocus = autoFocus
        self.clearLabel = clearLabel
        self.historyScope = historyScope
        self.showHistoryOnFocus = showHistoryOnFocus
        self.maxHistory = maxHistory
    }

    /// Whether the field exposes the recent-searches history at all (web `Boolean(historyScope)`). A scope
    /// that is `nil` or empty keeps the field history-less, exactly like the web `historyEnabled`.
    public var historyEnabled: Bool {
        SearchInputProjector.historyEnabled(historyScope: historyScope)
    }
}

// MARK: - SearchInputProjection (view-ready)

/// The resolved, view-ready field state — everything the SwiftUI body needs as a pure function of the props
/// + the buffered local text + the focus flag + the recent-searches entries + the active row index (no
/// derivation in the view). `value` is the web `local`; `showsClearButton` is the web `{local ? <clear/>}`;
/// `dropdownVisible` is the web `dropdownVisible`; `entries` / `activeIndex` drive the recent-searches list.
public struct SearchInputProjection: Sendable, Equatable {
    /// The text the field renders — the buffered local value (web `local`).
    public let value: String
    /// The hint to show when empty (web `placeholder`). // parity:allow web prop name
    public let prompt: String?
    /// Whether the trailing clear button renders (web `{local ? <clear/> : undefined}`).
    public let showsClearButton: Bool
    /// Whether the field exposes recent-searches history (web `historyEnabled`).
    public let historyEnabled: Bool
    /// Whether the recent-searches dropdown renders (web `dropdownVisible`).
    public let dropdownVisible: Bool
    /// The recent-searches rows, newest-first (web `entries`).
    public let entries: [String]
    /// The keyboard-highlighted row, or `-1` for none (web `activeIdx`).
    public let activeIndex: Int

    public init(
        value: String,
        prompt: String?,
        showsClearButton: Bool,
        historyEnabled: Bool,
        dropdownVisible: Bool,
        entries: [String],
        activeIndex: Int
    ) {
        self.value = value
        self.prompt = prompt
        self.showsClearButton = showsClearButton
        self.historyEnabled = historyEnabled
        self.dropdownVisible = dropdownVisible
        self.entries = entries
        self.activeIndex = activeIndex
    }
}

// MARK: - SearchInputProjector (web render body + interaction arithmetic)

/// The pure projection from the props + the interaction state to the view-ready model — the surface's data
/// adapter in the "state → projection" sense the acceptance calls for: it takes the props a page already
/// holds plus the buffered text / focus / cached entries (no fetch, no clock) and derives the rendered
/// field. Unit tested across the clear-button visibility, the dropdown-visibility rule, the active-row
/// arithmetic, the debounce emit decision, and the record predicate.
public enum SearchInputProjector {
    /// The default debounce window — the web `debounceMs = 250` expressed in seconds.
    public static let defaultDebounce: TimeInterval = 0.25

    /// Whether the field exposes recent-searches history — the web `Boolean(historyScope)`, treating an
    /// empty scope string as history-less.
    public static func historyEnabled(historyScope: String?) -> Bool {
        guard let scope = historyScope else { return false }
        return !scope.isEmpty
    }

    /// Whether the trailing clear button renders — the web `local ? <clear/> : undefined`.
    public static func showsClearButton(local: String) -> Bool {
        !local.isEmpty
    }

    /// Whether the recent-searches dropdown renders — the verbatim port of the web `dropdownVisible`:
    /// `Boolean(historyScope) && showHistoryOnFocus && isFocused && local === '' && entries.length > 0`.
    public static func dropdownVisible(
        historyScope: String?,
        showHistoryOnFocus: Bool,
        isFocused: Bool,
        local: String,
        entryCount: Int
    ) -> Bool {
        historyEnabled(historyScope: historyScope)
            && showHistoryOnFocus
            && isFocused
            && local.isEmpty
            && entryCount > 0
    }

    /// The next highlighted row when pressing Arrow Down — the web `Math.min(prev + 1, entries.length - 1)`.
    public static func nextActiveDown(current: Int, count: Int) -> Int {
        min(current + 1, count - 1)
    }

    /// The next highlighted row when pressing Arrow Up — the web `Math.max(prev - 1, -1)` (`-1` clears it).
    public static func nextActiveUp(current: Int) -> Int {
        max(current - 1, -1)
    }

    /// The highlighted row after a row removal — the web `Math.min(prev, next.length - 1)`, so the cursor
    /// stays in range as the list shrinks (and collapses to `-1` when the list empties).
    public static func clampActiveIndex(_ index: Int, count: Int) -> Int {
        min(index, count - 1)
    }

    /// Whether the debounced `onChange` should fire — the web `if (local === value) return` guard inverted:
    /// emit only when the buffered text actually differs from the committed value.
    public static func shouldEmitDebounced(local: String, value: String) -> Bool {
        local != value
    }

    /// Whether a query should be recorded to history — the web `historyScope && local.trim().length >=
    /// MIN_QUERY_LEN`. Trimming + the min-length floor mirror `recordSearch`, so a blur / Enter on
    /// whitespace or a single character is a no-op.
    public static func shouldRecord(historyScope: String?, query: String) -> Bool {
        guard historyEnabled(historyScope: historyScope) else { return false }
        return query.trimmingCharacters(in: .whitespacesAndNewlines).count >= SearchInputHistory.minQueryLen
    }

    /// The resolved accessible label for the clear button — the web `clearLabel ?? t('common.clear',
    /// 'Clear')`. The fallback (the localized `common.clear`) is supplied by the caller so the pure core
    /// stays bundle-free.
    public static func clearAccessibilityLabel(explicit: String?, fallback: String) -> String {
        explicit ?? fallback
    }

    /// Whether a row index addresses a real entry — the web `activeIdx >= 0 && activeIdx < entries.length`.
    public static func isSelectableIndex(_ index: Int, count: Int) -> Bool {
        index >= 0 && index < count
    }

    /// Resolves the whole field from the props + the interaction state — the native peer of the web
    /// component's render decision.
    public static func resolve(
        input: SearchInputInput,
        local: String,
        isFocused: Bool,
        entries: [String],
        activeIndex: Int
    ) -> SearchInputProjection {
        SearchInputProjection(
            value: local,
            prompt: input.prompt,
            showsClearButton: showsClearButton(local: local),
            historyEnabled: historyEnabled(historyScope: input.historyScope),
            dropdownVisible: dropdownVisible(
                historyScope: input.historyScope,
                showHistoryOnFocus: input.showHistoryOnFocus,
                isFocused: isFocused,
                local: local,
                entryCount: entries.count
            ),
            entries: entries,
            activeIndex: activeIndex
        )
    }
}
