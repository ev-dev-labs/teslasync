//
//  CommandPalette.Model.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The observable state-holder (P1/S8) for the command palette — the native peer of the web component's
//  `useState` interaction state (`open` / `query` / `selectedIndex` / `mode` / `pendingCommand`) plus the
//  composed read hooks it folds. It binds the host feed through ``CommandPaletteSource``, derives the
//  render-ready ``CommandPaletteProjection`` (an observed read — SwiftUI observation replaces the React
//  re-render), debounces the live entity search (web `setTimeout(200)` + the `disabled` gate), runs the
//  keyboard navigation (web `handleInputKey` + the global Esc), routes a chosen row out through
//  ``CommandPaletteRunner`` (recording usage through the source), drives the P4 leaf phases + freshness axis,
//  and emits `view.opened` exactly once. No fetch and no navigation live in the view.
//

import Foundation
import Observation

// MARK: - CommandPalettePhase (P4 leaf contract)

/// The results-pane phase — the P4 always-render leaf states layered over the web component (which loads
/// progressively with no gate): `loading` while the composed feed resolves with nothing cached, `error` when
/// it fails, `content` otherwise (which may still render the friendly empty message).
public enum CommandPalettePhase: Sendable, Equatable {
    case loading
    case content
    case error(String)
}

// MARK: - CommandPaletteModel

/// The command palette's observable state-holder. Owns the interaction state, the bound snapshot, and the
/// derived projection; debounces search; dispatches activations; and emits `view.opened` once.
@MainActor
@Observable
public final class CommandPaletteModel {
    /// Whether the palette overlay is presented (web `open`).
    public private(set) var isOpen = false
    /// The raw input string, prefix included (web `query`).
    public private(set) var query = ""
    /// The keyboard cursor over the flattened visible list (web `selectedIndex`).
    public private(set) var selectedIndex = 0
    /// The interaction mode (web `mode`).
    public private(set) var mode: PaletteMode = .search
    /// The command awaiting a vehicle pick (web `pendingCommand`).
    public private(set) var pendingCommand: String?
    /// The bound host feed (the composed web hook value).
    public private(set) var snapshot = CommandPaletteSnapshot()

    @ObservationIgnored private let source: any CommandPaletteSource
    @ObservationIgnored private let runner: any CommandPaletteRunner
    @ObservationIgnored private let telemetry: any CommandPaletteTelemetry
    @ObservationIgnored private let copyProvider: @MainActor () -> PaletteCopy
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let onOpen: (@MainActor () -> Void)?
    @ObservationIgnored private let searchDebounce: Duration
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    public init(
        source: any CommandPaletteSource,
        runner: any CommandPaletteRunner = LoggingCommandPaletteRunner(),
        telemetry: any CommandPaletteTelemetry = OSLogCommandPaletteTelemetry(),
        copyProvider: @escaping @MainActor () -> PaletteCopy = { CommandPaletteStrings.makeCopy() },
        searchDebounce: Duration = .milliseconds(200),
        now: @escaping @Sendable () -> Date = { Date() },
        onOpen: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.runner = runner
        self.telemetry = telemetry
        self.copyProvider = copyProvider
        self.searchDebounce = searchDebounce
        self.now = now
        self.onOpen = onOpen
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The render-ready projection — a pure function of the snapshot + the interaction state (web render).
    public var projection: CommandPaletteProjection {
        CommandPaletteProjector.project(
            CommandPaletteProjectionInput(
                snapshot: snapshot,
                mode: mode,
                rawQuery: query,
                pendingCommand: pendingCommand,
                selectedIndex: selectedIndex,
                now: now()
            ),
            copy: copyProvider()
        )
    }

    /// The P4 leaf phase for the results pane.
    public var phase: CommandPalettePhase {
        if let message = snapshot.errorMessage { return .error(message) }
        let hasData = !snapshot.vehicles.isEmpty || !snapshot.navEntries.isEmpty
            || !snapshot.registryEntries.isEmpty || !snapshot.recentPages.isEmpty
        if snapshot.isLoading, !hasData { return .loading }
        return .content
    }

    /// The freshness axis (web has no peer) — drives the connectivity chip.
    public var connection: PaletteConnection {
        snapshot.connection
    }

    /// The active scope parsed from the current raw query (web `activeScope`).
    public var activeScope: PaletteScope? {
        PaletteScopes.parsePrefix(query).scope
    }

    // MARK: Lifecycle (once-only `view.opened`)

    /// Begin the surface, emit `view.opened` once, and start the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: CommandPaletteSurface.slug)
        }
        source.start()
    }

    /// Mark the surface inactive and cancel any pending debounce. The once-only `view.opened` is preserved.
    public func stop() {
        started = false
        searchTask?.cancel()
        searchTask = nil
        source.stop()
    }

    /// Re-request the composed feed (web refetch) — the error retry + the freshness chip refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    private func ingest(_ snapshot: CommandPaletteSnapshot) {
        self.snapshot = snapshot
        switch snapshot.connection {
        case .stale:
            guard !didAutoRefresh else { break }
            didAutoRefresh = true
            source.refresh()
        case .live:
            didAutoRefresh = false
        case .offline:
            break
        }
        selectedIndex = CommandPaletteProjector.clampSelectedIndex(selectedIndex, count: projection.items.count)
    }

    // MARK: Open / close (web `open` effect + `close`)

    /// Open the palette — reset to a fresh search (web open effect: clear query / selection / mode, focus).
    public func open() {
        isOpen = true
        query = ""
        selectedIndex = 0
        mode = .search
        pendingCommand = nil
        scheduleSearch()
        onOpen?()
    }

    /// Toggle the palette (web `toggle-command-palette` custom event).
    public func toggle() {
        if isOpen { close() } else { open() }
    }

    /// Close the palette (web `close`).
    public func close() {
        isOpen = false
        mode = .search
        pendingCommand = nil
    }

    /// Pop the vehicle-select step back to search (web `goBack`).
    public func goBack() {
        mode = .search
        pendingCommand = nil
        selectedIndex = 0
        query = ""
        scheduleSearch()
    }

    // MARK: Query (web controlled `Input` + scope reconstruction)

    /// Commit the field text — the web `onChange`: with an active scope the raw query keeps the prefix in
    /// front so the chip stays visible; otherwise the field text is the raw query.
    public func setScopedInput(_ next: String) {
        if let scope = activeScope {
            query = "\(PaletteScopes.meta(for: scope).prefix) \(next)"
        } else {
            query = next
        }
        onQueryChanged()
    }

    /// Set the raw query directly (the footer scope-hint chips type `"{prefix} "`).
    public func setRawQuery(_ next: String) {
        query = next
        onQueryChanged()
    }

    /// Clear the active scope chip + term (web first-Esc / Backspace-on-chip).
    public func clearScope() {
        query = ""
        selectedIndex = 0
        onQueryChanged()
    }

    private func onQueryChanged() {
        selectedIndex = 0
        scheduleSearch()
    }

    // MARK: Live search (web debounced `useGlobalSearch` + `disabled` gate)

    private func scheduleSearch() {
        searchTask?.cancel()
        let parsed = PaletteScopes.parsePrefix(query)
        let disabled = mode != .search || parsed.scope != nil
        let term = parsed.term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !disabled, !term.isEmpty else {
            source.search(term: "")
            return
        }
        let debounce = searchDebounce
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled, let self else { return }
            source.search(term: term)
        }
    }

    // MARK: Keyboard (web `handleInputKey` + global Esc)

    /// Highlight a row (web `onMouseEnter` / focus), clamped into range.
    public func setSelectedIndex(_ index: Int) {
        selectedIndex = CommandPaletteProjector.clampSelectedIndex(index, count: projection.items.count)
    }

    /// Arrow Down (web `Math.min(min(prev, max) + 1, max)`).
    public func moveDown() {
        let count = projection.items.count
        guard count > 0 else { return }
        let maxIndex = count - 1
        selectedIndex = min(min(selectedIndex, maxIndex) + 1, maxIndex)
    }

    /// Arrow Up (web `Math.max(min(prev, max) - 1, 0)`).
    public func moveUp() {
        let count = projection.items.count
        guard count > 0 else { return }
        let maxIndex = count - 1
        selectedIndex = max(min(selectedIndex, maxIndex) - 1, 0)
    }

    /// Enter — activate the highlighted row (web `displayItems[effectiveSelectedIndex].action()`).
    public func submitSelection() {
        let items = projection.items
        let index = CommandPaletteProjector.clampSelectedIndex(selectedIndex, count: items.count)
        guard items.indices.contains(index) else { return }
        activate(items[index])
    }

    /// Backspace — pop vehicle-select (empty query) or clear the scope chip (empty term). Returns whether it
    /// consumed the key (web `handleInputKey` Backspace branches).
    @discardableResult
    public func handleBackspace() -> Bool {
        let parsed = PaletteScopes.parsePrefix(query)
        if query.isEmpty, mode == .vehicleSelect {
            goBack()
            return true
        }
        if parsed.scope != nil, parsed.term.isEmpty, mode == .search {
            clearScope()
            return true
        }
        return false
    }

    /// Escape — pop vehicle-select, else clear an active scope, else close (web global Esc).
    public func handleEscape() {
        if mode == .vehicleSelect {
            goBack()
        } else if activeScope != nil {
            clearScope()
        } else {
            close()
        }
    }

    // MARK: Activation (web action callbacks)

    /// Dispatch a chosen row — records usage through the source (web `recordCommandUse` + `addRecentCommand`)
    /// and routes the side effect through the runner, then closes (except the command → vehicle-select step).
    public func activate(_ item: PaletteItem) {
        switch item.action {
        case let .navigate(path):
            recordAndClose(id: path) { $0.navigate(to: path) }
        case let .selectCommand(command):
            selectCommand(command)
        case let .executeCommand(command, vehicleID):
            recordAndClose(id: "cmd-\(command)") { $0.runVehicleCommand(command, vehicleID: vehicleID) }
        case let .switchVehicle(id):
            recordAndClose(id: "switch-vehicle-\(id)") { $0.switchVehicle(id: id) }
        case let .runRegistry(id):
            recordAndClose(id: id) { $0.runRegistry(id: id) }
        case let .openSearchResult(url):
            recordAndClose(id: url) { $0.openSearchResult(url: url) }
        case .noop:
            break
        }
    }

    /// Pick a vehicle command (web `selectCommand`): run it for a 1-vehicle fleet, else open vehicle-select.
    private func selectCommand(_ command: String) {
        let vehicles = snapshot.vehicles
        if vehicles.count == 1 {
            let vehicleID = vehicles[0].id
            recordAndClose(id: "cmd-\(command)") { $0.runVehicleCommand(command, vehicleID: vehicleID) }
        } else if vehicles.count > 1 {
            pendingCommand = command
            mode = .vehicleSelect
            selectedIndex = 0
            query = ""
            scheduleSearch()
        }
    }

    private func recordAndClose(id: String, _ run: (any CommandPaletteRunner) -> Void) {
        source.recordUse(id: id)
        run(runner)
        close()
    }

    /// Open the full search-results page for the active term (web `go('/search?q=…')`). No-op when the term
    /// is below the search floor.
    public func openAllResults() {
        let term = projection.scopedTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= CommandPaletteSurface.searchMinLength else { return }
        let encoded = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
        let path = "/search?q=\(encoded)"
        recordAndClose(id: path) { $0.navigate(to: path) }
    }
}
