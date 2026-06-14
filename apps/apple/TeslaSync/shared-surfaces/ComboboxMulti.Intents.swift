//
//  ComboboxMulti.Intents.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The interaction half of ``ComboboxMultiModel`` — kept in an extension so the stored state stays
//  within the lint type-body budget. It carries the verbatim ports of the web event handlers: the
//  derived reads (the selected-removed candidate set, the resolved listbox, the at-max flag, the
//  in-flight flag), the input + open/close + active-descendant intents (web `handleInputChange` /
//  `handleKeyDown` / `closeDropdown`), the add-chip / remove-chip / Backspace-removes-last commits (web
//  `addOption` / `removeAt`), the result-count + chip-removal announcements (web `useAnnouncer` effect +
//  imperative announce), the debounced + cancel-on-keystroke async loader (web `AbortController`), and
//  the source-snapshot application with the one-shot stale auto-refresh (the in-tree Combobox / UnitInput
//  P4 leaf precedent).
//

import Foundation

// MARK: - Derived reads (web render-time derivations)

public extension ComboboxMultiModel {
    /// Whether options come from an async loader (web `typeof options === 'function'`).
    var isAsync: Bool {
        if case .async = provider { return true }
        return false
    }

    /// The keys of the already-selected options (web `selectedKeys`) — used to hide chips from the
    /// dropdown and to reject duplicate adds.
    var selectedIDs: Set<String> {
        Set(selected.map(\.id))
    }

    /// The resolved options before the cap — static rows text-filtered locally (web `defaultFilter`) or
    /// async rows as the loader returned them, with the already-selected rows removed in both branches
    /// (web `base.filter((o) => !selectedKeys.has(...))`).
    var candidates: [ComboboxMultiItem] {
        let base: [ComboboxMultiItem] = switch provider {
        case .staticItems: ComboboxMultiProjector.filter(staticItems, query: query)
        case .async: loadedItems
        }
        return ComboboxMultiProjector.removeSelected(base, selectedIDs: selectedIDs)
    }

    /// `true` when a fetch is in flight (web `loading || asyncLoading`).
    var effectiveLoading: Bool {
        externalLoading || loadPhase == .loading
    }

    /// `true` when the selection cap is reached (web `atMax`).
    var atMax: Bool {
        ComboboxMultiProjector.atMax(selectedCount: selected.count, maxItems: config.maxItems)
    }

    /// The view-ready listbox — a pure function of the current state. A host-driven error message
    /// outranks an in-flight fetch, which outranks the async phase; the effective phase is folded here
    /// before the pure resolution.
    var listState: ComboboxMultiListState {
        let phase: ComboboxMultiListPhase = if let message = externalError, !message.isEmpty {
            .failed(message)
        } else if externalLoading {
            .loading
        } else {
            loadPhase
        }
        return ComboboxMultiProjector.resolveList(
            phase: phase,
            candidates: candidates,
            maxVisible: config.maxVisibleOptions,
            activeIndex: activeIndex,
            atMax: atMax
        )
    }
}

// MARK: - Input + open / close + active descendant (web handleInputChange / handleKeyDown)

public extension ComboboxMultiModel {
    /// Handles a keystroke (web `handleInputChange`): records the local text, opens the list, kicks an
    /// async fetch, re-clamps the highlight, and announces the new result count. Unlike the single-select
    /// sibling there is no host `onInputChange` — the typed text is purely local.
    func setQuery(_ text: String) {
        query = text
        if !isOpen, !config.disabled { isOpen = true }
        if isAsync { scheduleLoad(text) }
        reclampActive()
        announceResultCount()
    }

    /// Opens the listbox (web `handleInputFocus`). Fires the initial async fetch when the loader has
    /// nothing cached yet (web open effect).
    func open() {
        guard !config.disabled else { return }
        isOpen = true
        reclampActive()
        if isAsync, loadedItems.isEmpty, loadPhase != .loading { scheduleLoad(query) }
        announceResultCount()
    }

    /// Closes the listbox (web `closeDropdown`: Escape, click-outside, blur). The typed text and the
    /// chips are untouched — the multi field has no committed-selection label to revert to.
    func close() {
        isOpen = false
        activeIndex = -1
    }

    /// Toggles the listbox (web chevron `onClick`), re-asserting field focus when it opens.
    func toggleOpen() {
        if isOpen {
            close()
        } else {
            open()
            requestFocus()
        }
    }

    /// ArrowDown (web): opens a closed list, else advances the highlight with wraparound.
    func moveDown() {
        guard isOpen else { open(); return }
        activeIndex = ComboboxMultiProjector.nextIndex(current: activeIndex, count: listState.visible.count)
    }

    /// ArrowUp (web): opens a closed list, else retreats the highlight with wraparound.
    func moveUp() {
        guard isOpen else { open(); return }
        activeIndex = ComboboxMultiProjector.previousIndex(current: activeIndex, count: listState.visible.count)
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

// MARK: - Commits (web addOption / removeAt / Backspace)

public extension ComboboxMultiModel {
    /// Enter (web): adds the highlighted option as a chip when one is active in the open list.
    func addActive() {
        let visible = listState.visible
        guard isOpen, activeIndex >= 0, activeIndex < visible.count else { return }
        addOption(visible[activeIndex])
    }

    /// Adds one option as a chip (web `addOption`): a no-op at the cap or for an already-selected
    /// option; otherwise appends it, routes `onChange(next)`, clears the input, drops the highlight, and
    /// re-asserts field focus (the dropdown stays open for rapid multi-select). The added option then
    /// disappears from the dropdown via the selected-removed filter.
    func addOption(_ item: ComboboxMultiItem) {
        guard !atMax else { return }
        guard !selectedIDs.contains(item.id) else { return }
        selected.append(item)
        source.valueChanged(selected)
        query = ""
        activeIndex = -1
        requestFocus()
        reclampActive()
        announceResultCount()
    }

    /// Removes the chip at an index (web `removeAt`): drops it, routes `onChange(next)`, posts the
    /// polite "Removed {label}" announcement, and re-asserts field focus. The removed option re-appears
    /// in the dropdown (it is no longer in the selected set).
    func removeAt(_ index: Int) {
        guard index >= 0, index < selected.count else { return }
        let removed = selected.remove(at: index)
        source.valueChanged(selected)
        postAnnouncement(ComboboxMultiStrings.removedChip(removed.label))
        requestFocus()
        reclampActive()
        announceResultCount()
    }

    /// Removes a specific chip by identity (the view's per-chip × button).
    func remove(_ item: ComboboxMultiItem) {
        guard let index = selected.firstIndex(where: { $0.id == item.id }) else { return }
        removeAt(index)
    }

    /// Backspace at the empty input removes the trailing chip (web Backspace branch). A no-op while the
    /// user is mid-type, so deleting characters never eats a chip.
    func removeLast() {
        guard query.isEmpty, !selected.isEmpty else { return }
        removeAt(selected.count - 1)
    }

    /// Re-requests the feed (freshness chip + error retry): re-emits the snapshot and re-runs the async
    /// loader for the current query.
    func refresh() {
        source.refresh()
        if isAsync { scheduleLoad(query) }
    }
}

// MARK: - Announcement (web useAnnouncer effect + imperative announce)

extension ComboboxMultiModel {
    /// Announces the result count politely (web announce effect): only while open + not loading, and
    /// only when the message changed since the last announcement (web `lastAnnouncedRef`).
    func announceResultCount() {
        guard isOpen, !effectiveLoading else { return }
        let message = ComboboxMultiStrings.resultsCount(candidates.count)
        guard message != lastAnnounced else { return }
        lastAnnounced = message
        announcement = message
        announcer.announce(message)
    }

    /// Posts a one-off polite announcement (web imperative `announce(...)`, e.g. "Removed {label}"),
    /// bypassing the result-count dedupe.
    func postAnnouncement(_ message: String) {
        announcement = message
        announcer.announce(message)
    }

    /// Re-clamps the highlight after the candidate set changes (web active-index reset effect).
    func reclampActive() {
        let visibleCount = ComboboxMultiProjector.cap(
            candidates,
            maxVisible: config.maxVisibleOptions
        ).visible.count
        activeIndex = ComboboxMultiProjector.clampActive(index: activeIndex, count: visibleCount)
    }

    func requestFocus() {
        focusRequestCount += 1
    }
}

// MARK: - Async loader (web AbortController — newest keystroke wins)

extension ComboboxMultiModel {
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
    func finishLoad(_ items: [ComboboxMultiItem]) {
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

extension ComboboxMultiModel {
    /// Applies a coalesced snapshot from the seam — the web parent passing a fresh `value` / options /
    /// lifecycle. Syncs the controlled chips, the static rows, the parent loading / error lifecycle, and
    /// the connectivity axis; arms a one-shot auto-refresh on the stale transition (re-armed on return to
    /// live). The local input text is independent of the controlled value, so it is left untouched.
    func apply(_ snapshot: ComboboxMultiSnapshot) {
        selected = snapshot.selected
        staticItems = snapshot.staticItems
        externalLoading = snapshot.isLoading
        externalError = snapshot.errorMessage
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
