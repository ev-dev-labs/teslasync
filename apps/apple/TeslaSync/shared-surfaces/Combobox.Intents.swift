//
//  Combobox.Intents.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The interaction half of ``ComboboxModel`` — kept in an extension so the stored state stays within
//  the lint type-body budget. It carries the verbatim ports of the web event handlers: the derived
//  reads (the resolved listbox, the candidate set, the in-flight flag), the input + open/close + active
//  descendant intents (web `handleInputChange` / `handleKeyDown` / `closeWithoutCommit`), the selection
//  / free-text / clear commits (web `commitOption` / `commitFreeText` / `handleClear`), the
//  result-count announcement (web `useAnnouncer` effect), the debounced + cancel-on-keystroke async
//  loader (web `AbortController`), and the source-snapshot application with the one-shot stale
//  auto-refresh (the in-tree UnitInput P4 leaf precedent).
//

import Foundation

// MARK: - Derived reads (web render-time derivations)

public extension ComboboxModel {
    /// Whether options come from an async loader (web `typeof options === 'function'`).
    var isAsync: Bool {
        if case .async = provider { return true }
        return false
    }

    /// The resolved options before the cap — static rows filtered locally (web `defaultFilter`), async
    /// rows as the loader returned them (the loader owns its own filtering).
    var candidates: [ComboboxItem] {
        switch provider {
        case .staticItems: ComboboxProjector.filter(staticItems, query: query)
        case .async: loadedItems
        }
    }

    /// `true` when a fetch is in flight (web `loading || asyncLoading`).
    var effectiveLoading: Bool {
        externalLoading || loadPhase == .loading
    }

    /// The view-ready listbox — a pure function of the current state. A host-driven error message
    /// outranks an in-flight fetch, which outranks the async phase; the effective phase is folded here
    /// before the pure resolution.
    var listState: ComboboxListState {
        let phase: ComboboxListPhase = if let message = externalError, !message.isEmpty {
            .failed(message)
        } else if externalLoading {
            .loading
        } else {
            loadPhase
        }
        return ComboboxProjector.resolveList(
            phase: phase,
            candidates: candidates,
            maxVisible: config.maxVisibleOptions,
            activeIndex: activeIndex,
            selection: selection
        )
    }

    /// `true` when the clear (×) button renders (web `!noClearButton && !disabled && (value || text)`).
    var showsClear: Bool {
        !config.noClearButton && !config.disabled && (selection != nil || !query.isEmpty)
    }
}

// MARK: - Input + open / close + active descendant (web handleInputChange / handleKeyDown)

public extension ComboboxModel {
    /// Handles a keystroke (web `handleInputChange`): records the text, opens the list, forwards the
    /// keystroke to the host (web `onInputChange`), kicks an async fetch, re-clamps the highlight, and
    /// announces the new result count.
    func setQuery(_ text: String) {
        query = text
        if !isOpen, !config.disabled { isOpen = true }
        source.inputChanged(text)
        if isAsync { scheduleLoad(text) }
        reclampActive()
        announceResultCount()
    }

    /// Opens the listbox (web `setOpen(true)` on focus / click). Fires the initial async fetch when the
    /// loader has nothing cached yet (web open effect).
    func open() {
        guard !config.disabled else { return }
        isOpen = true
        reclampActive()
        if isAsync, loadedItems.isEmpty, loadPhase != .loading { scheduleLoad(query) }
        announceResultCount()
    }

    /// Closes the listbox WITHOUT committing (web `closeWithoutCommit`: Escape, click-outside, blur) —
    /// reverts the visible text to the selected option's label.
    func close() {
        isOpen = false
        activeIndex = -1
        query = selection?.label ?? ""
    }

    /// Toggles the listbox (web chevron `onClick`).
    func toggleOpen() {
        if isOpen { close() } else { open() }
    }

    /// ArrowDown (web): opens a closed list, else advances the highlight with wraparound.
    func moveDown() {
        guard isOpen else { open(); return }
        activeIndex = ComboboxProjector.nextIndex(current: activeIndex, count: listState.visible.count)
    }

    /// ArrowUp (web): opens a closed list, else retreats the highlight with wraparound.
    func moveUp() {
        guard isOpen else { open(); return }
        activeIndex = ComboboxProjector.previousIndex(current: activeIndex, count: listState.visible.count)
    }

    /// Home (web): jumps the highlight to the first row.
    func moveHome() {
        guard isOpen else { return }
        activeIndex = listState.visible.isEmpty ? -1 : 0
    }

    /// End (web): jumps the highlight to the last row.
    func moveEnd() {
        guard isOpen else { return }
        activeIndex = listState.visible.isEmpty ? -1 : listState.visible.count - 1
    }
}

// MARK: - Commits (web commitOption / commitFreeText / handleClear)

public extension ComboboxModel {
    /// Enter (web): commits the highlighted option, or — when `allowFreeText` and the field is
    /// non-empty — commits the raw typed text.
    func commitActive() {
        let visible = listState.visible
        if activeIndex >= 0, activeIndex < visible.count {
            select(visible[activeIndex])
        } else if config.allowFreeText {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { commitFreeText(trimmed) }
        }
    }

    /// Commits one option (web `commitOption`): routes `onChange(option)`, sets the visible text to its
    /// label, and closes.
    func select(_ item: ComboboxItem) {
        source.selectionChanged(item)
        selection = item
        query = item.label
        isOpen = false
        activeIndex = -1
    }

    /// Commits raw typed text (web `commitFreeText`): routes `onFreeTextCommit(text)`, clears the
    /// structured selection via `onChange(null)`, and closes — keeping the typed text in the field.
    func commitFreeText(_ text: String) {
        source.freeTextCommitted(text)
        source.selectionChanged(nil)
        selection = nil
        isOpen = false
        activeIndex = -1
    }

    /// Clears the selection (web `handleClear`): routes `onChange(null)`, empties the field, reopens the
    /// list, and re-fetches for an async loader.
    func clear() {
        source.selectionChanged(nil)
        selection = nil
        query = ""
        activeIndex = -1
        isOpen = true
        source.inputChanged("")
        if isAsync { scheduleLoad("") }
        announceResultCount()
    }

    /// Re-requests the feed (freshness chip + error retry): re-emits the snapshot and re-runs the async
    /// loader for the current query.
    func refresh() {
        source.refresh()
        if isAsync { scheduleLoad(query) }
    }
}

// MARK: - Announcement (web useAnnouncer effect)

extension ComboboxModel {
    /// Announces the result count politely (web announce effect): only while open + not loading, and
    /// only when the message changed since the last announcement (web `lastAnnouncedRef`).
    func announceResultCount() {
        guard isOpen, !effectiveLoading else { return }
        let message = ComboboxStrings.resultsCount(candidates.count)
        guard message != lastAnnounced else { return }
        lastAnnounced = message
        announcement = message
        announcer.announce(message)
    }

    /// Re-clamps the highlight after the candidate set changes (web active-index reset effect).
    func reclampActive() {
        let visibleCount = ComboboxProjector.cap(
            candidates,
            maxVisible: config.maxVisibleOptions
        ).visible.count
        activeIndex = ComboboxProjector.clampActive(index: activeIndex, count: visibleCount)
    }
}

// MARK: - Async loader (web AbortController — newest keystroke wins)

extension ComboboxModel {
    /// Debounces + (re)starts the async fetch, cancelling the previous in-flight `Task` so only the
    /// newest keystroke resolves (the web `AbortController` abort-on-keystroke). Cancellation is
    /// swallowed; any other failure becomes the `.failed` phase (web loader reject → swallowed to `[]`,
    /// surfaced here as the P4 retry affordance).
    func scheduleLoad(_ text: String) {
        guard case let .async(loader) = provider else { return }
        loadTask?.cancel()
        let pause = debounce
        loadTask = Task { [weak self] in
            do {
                try await Task.sleep(for: pause)
                try Task.checkCancellation()
                self?.markLoading()
                let items = try await loader(text)
                try Task.checkCancellation()
                self?.finishLoad(items)
            } catch is CancellationError {
                // Superseded by a newer keystroke — drop silently.
            } catch {
                self?.failLoad(error)
            }
        }
    }

    /// Marks the fetch in flight (web `setAsyncLoading(true)`).
    func markLoading() {
        loadPhase = .loading
    }

    /// Applies a resolved option set (web async resolve): caches the rows, marks loaded, re-clamps the
    /// highlight, and announces the new count.
    func finishLoad(_ items: [ComboboxItem]) {
        loadedItems = items
        loadPhase = .loaded
        reclampActive()
        announceResultCount()
    }

    /// Applies a loader failure (web loader reject): drops the cache and records the reason for the P4
    /// error affordance, then announces (the web folds error to an empty "No results").
    func failLoad(_ error: Error) {
        loadedItems = []
        loadPhase = .failed(error.localizedDescription)
        activeIndex = -1
        announceResultCount()
    }
}

// MARK: - Source snapshot application (web parent render + P4 leaf)

extension ComboboxModel {
    /// Applies a coalesced snapshot from the seam — the web parent passing a fresh `value` / options /
    /// lifecycle. Syncs the controlled selection (re-syncing the visible text only while closed, the
    /// web focus guard), the static rows, the parent loading / error lifecycle, and the connectivity
    /// axis; arms a one-shot auto-refresh on the stale transition (re-armed on return to live).
    func apply(_ snapshot: ComboboxSnapshot) {
        selection = snapshot.selection
        staticItems = snapshot.staticItems
        externalLoading = snapshot.isLoading
        externalError = snapshot.errorMessage
        if !isOpen { query = snapshot.selection?.label ?? "" }
        let previous = connection
        connection = snapshot.connection
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
            if isAsync { scheduleLoad(query) }
        }
        reclampActive()
        announceResultCount()
    }
}
