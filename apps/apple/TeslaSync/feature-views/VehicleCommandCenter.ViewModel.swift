//
//  VehicleCommandCenter.ViewModel.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The surface's observable view-model (P1/S8). Subscribes to a `VehicleCommandSource`,
//  projects the header + stats + status + toggle states via `VehicleCommandProjector`, owns
//  the UI state the web component owns (search / favorites / active dialog / last result)
//  and exposes the intents the tiles + dialogs call back through. No networking lives here.
//

import Foundation
import Observation

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `VehicleCommandSource`,
/// projects the header + telemetry stats + per-command status + toggle states via
/// `VehicleCommandProjector`, owns the UI state the web component owns (search,
/// favorites, the active dialog, the last command result) and exposes the intents
/// the tiles + dialogs call back through. No networking lives here.
@MainActor
@Observable
public final class VehicleCommandCenterModel {
    /// The top-level render branch. The web center always renders its chrome once it
    /// has the vehicle + state props; `loading` only covers the pre-first-snapshot
    /// window (skeleton chrome), then `content` renders the full composition with the
    /// command-status / freshness / feedback sub-states layered inside.
    public enum Phase: Equatable {
        case loading
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var projection: VehicleCommandCenterProjection?
    public private(set) var commandStatus: VCCLoadStatus = .loading
    public private(set) var connection: VCCConnection = .live
    public private(set) var isFetching = false
    /// The last command outcome banner (web `lastResult`).
    public private(set) var lastResult: VCCCommandResult?
    /// The catalog id currently in flight (web `cmd.isPending` per tile).
    public private(set) var executingCommandID: String?
    /// The active input / select / confirm dialog (web `activeDialog`).
    public private(set) var activeDialog: VCCDialogRequest?
    /// The per-vehicle favorite ids (web `favorites`).
    public private(set) var favorites: Set<String>
    /// The live search query (web `search`). Two-way bound by the view.
    public var search: String = "" {
        didSet { searchTrimmedCache = search.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    @ObservationIgnored private var searchTrimmedCache = ""
    @ObservationIgnored private let source: any VehicleCommandSource
    @ObservationIgnored private let favoritesStore: any VehicleCommandFavoritesStore
    @ObservationIgnored private let feedback: any VehicleCommandFeedback
    @ObservationIgnored private let telemetry: any VehicleCommandCenterTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleCommandSource,
        favoritesStore: any VehicleCommandFavoritesStore = InMemoryVehicleCommandFavoritesStore(),
        feedback: any VehicleCommandFeedback = OSLogVehicleCommandFeedback(),
        telemetry: any VehicleCommandCenterTelemetry = OSLogVehicleCommandCenterTelemetry()
    ) {
        self.source = source
        self.favoritesStore = favoritesStore
        self.feedback = feedback
        self.telemetry = telemetry
        favorites = Self.initialFavorites(from: favoritesStore)
        source.onUpdate = { [weak self] update in self?.apply(update) }
        source.onCommandResult = { [weak self] result in self?.applyResult(result) }
    }

    /// The favorites seeded from the store, falling back to the catalog defaults when
    /// nothing is stored yet (web `COMMANDS.filter(c => c.defaultFavorite)`).
    private static func initialFavorites(from store: any VehicleCommandFavoritesStore) -> Set<String> {
        if let stored = store.load() {
            return Set(stored)
        }
        return Set(VehicleCommandCatalog.defaultFavoriteIDs)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleCommandCenterSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a status refresh (web invalidate / `refetchInterval`). Wired to the
    /// command-status error retry + the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes once when data has gone stale but is not already fetching — the
    /// native parity of the web stale-query self-refresh.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    // MARK: Derived display state

    /// The trimmed search query (web `search.trim()`).
    public var trimmedSearch: String {
        searchTrimmedCache
    }

    /// Web `isAsleep` (vehicle is asleep / offline).
    public var isAsleep: Bool {
        projection?.isAsleep ?? false
    }

    /// Web `isStale && !isAsleep` — the stale-data banner gate.
    public var showsStaleBanner: Bool {
        connection == .stale && !isAsleep
    }

    /// The relative age label for the stale banner + freshness chip (web `ageLabel`).
    public var ageLabel: String {
        projection?.ageLabel ?? "—"
    }

    /// The favorite commands in catalog order (web `FavoritesBar` source).
    public var favoriteCommands: [VehicleCommand] {
        VehicleCommandCatalog.all.filter { favorites.contains($0.id) }
    }

    /// The header telemetry stats (web battery / range / temperature row).
    public var stats: [VCCStat] {
        projection?.stats ?? []
    }

    /// The category groups in `CATEGORY_ORDER`, each non-empty (web group render).
    public var commandGroups: [VehicleCommandGroup] {
        VehicleCommandCatalog.groups
    }

    /// The flat search results, or `nil` when the box is empty (web `filteredCommands`
    /// memo returns `null` while `!search.trim()`).
    public var filteredCommands: [VehicleCommand]? {
        guard !trimmedSearch.isEmpty else { return nil }
        return VehicleCommandFilter.match(query: trimmedSearch, in: VehicleCommandCatalog.all)
    }

    /// Whether the search box has a query with no matches (web `commands.search.noResults`).
    public var hasNoSearchResults: Bool {
        if let filtered = filteredCommands {
            return filtered.isEmpty
        }
        return false
    }

    /// The annotated last-status line for a command (web `cmdStatus`): the command's
    /// own status, falling back to the toggle's off-token status, formatted
    /// `✓ 2m ago` / `✗ 2m ago`.
    public func statusLine(for command: VehicleCommand) -> String? {
        guard let projection else { return nil }
        if let line = projection.statusByCommand[command.command] {
            return line
        }
        if let off = command.commandOff {
            return projection.statusByCommand[off]
        }
        return nil
    }

    /// The bound on/off state for a toggle command (web `state[stateField]`).
    public func isOn(_ command: VehicleCommand) -> Bool {
        guard let field = command.stateField else { return false }
        return projection?.toggleStates[field] ?? false
    }

    /// Whether the given command is the one currently in flight (web per-tile loading).
    public func isExecuting(_ command: VehicleCommand) -> Bool {
        executingCommandID == command.id
    }

    /// Whether any command is in flight (web `cmd.isPending || wakeMut.isPending`).
    public var isBusy: Bool {
        executingCommandID != nil
    }

    public func isFavorite(_ command: VehicleCommand) -> Bool {
        favorites.contains(command.id)
    }

    // MARK: Intents (web handlers)

    /// Activates a command (web tile click). Toggles resolve the on/off token from the
    /// bound state; commands needing a dialog (select / input / dangerous-confirm) open
    /// it; everything else dispatches immediately. Turning a toggle ON that also needs a
    /// PIN opens the input dialog (web `ToggleCommandTile` off→input path).
    public func activate(_ command: VehicleCommand) {
        guard !isBusy else { return }
        lastResult = nil

        if command.kind == .toggle {
            activateToggle(command)
            return
        }
        if let request = dialogRequest(for: command) {
            activeDialog = request
            return
        }
        dispatch(command: command, token: command.command, params: command.basePlanParams())
    }

    private func activateToggle(_ command: VehicleCommand) {
        let currentlyOn = isOn(command)
        if currentlyOn {
            let offToken = command.commandOff ?? command.command
            dispatch(command: command, token: offToken, params: VCCParams())
        } else if command.dialog != nil {
            activeDialog = dialogRequest(for: command)
        } else {
            dispatch(command: command, token: command.command, params: command.basePlanParams())
        }
    }

    /// Builds the dialog request for a command that needs one, else `nil` (web
    /// `requestDialog`: select > input > dangerous-confirm).
    private func dialogRequest(for command: VehicleCommand) -> VCCDialogRequest? {
        guard let dialog = command.dialog else {
            return command.isDangerous ? VCCDialogRequest(kind: .confirm, command: command) : nil
        }
        switch dialog {
        case .select: return VCCDialogRequest(kind: .select, command: command)
        case .input: return VCCDialogRequest(kind: .input, command: command)
        }
    }

    /// Submits the input dialog (web `handleInputSubmit`): builds the params from the
    /// command's plan + the entered field values, dispatches, and closes the dialog.
    public func submitInput(_ values: [String: String]) {
        guard let request = activeDialog, request.kind == .input else { return }
        let command = request.command
        let params = VehicleCommandParamAssembler.assemble(command: command, values: values)
        dispatch(command: command, token: command.command, params: params)
        cancelDialog()
    }

    /// Submits the select dialog (web `handleSelectSubmit`).
    public func submitSelect(_ value: String) {
        guard let request = activeDialog, request.kind == .select,
              case let .select(config) = request.command.dialog else { return }
        var params = request.command.basePlanParams()
        params.values[config.paramName] = .string(value)
        dispatch(command: request.command, token: request.command.command, params: params)
        cancelDialog()
    }

    /// Confirms the dangerous-action dialog (web `handleConfirmSubmit`).
    public func confirm() {
        guard let request = activeDialog, request.kind == .confirm else { return }
        dispatch(command: request.command, token: request.command.command, params: request.command.basePlanParams())
        cancelDialog()
    }

    /// Closes the active dialog (web `closeDialog`).
    public func cancelDialog() {
        activeDialog = nil
    }

    /// Toggles a command's favorite membership and persists it (web `toggleFavorite`).
    public func toggleFavorite(_ command: VehicleCommand) {
        if favorites.contains(command.id) {
            favorites.remove(command.id)
        } else {
            favorites.insert(command.id)
        }
        favoritesStore.save(orderedFavorites())
    }

    /// Favorites serialised in catalog order so persistence is deterministic.
    private func orderedFavorites() -> [String] {
        VehicleCommandCatalog.all.map(\.id).filter { favorites.contains($0) }
    }

    // MARK: Dispatch + seam handlers

    private func dispatch(command: VehicleCommand, token: String, params: VCCParams) {
        executingCommandID = command.id
        source.execute(VCCInvocation(commandID: command.id, command: token, params: params))
    }

    private func apply(_ update: VCCUpdate) {
        projection = VehicleCommandProjector.project(update: update)
        commandStatus = update.commandStatus
        connection = update.connection
        isFetching = update.isFetching
        phase = .content
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh; reset once live so a later stale episode
    /// re-triggers exactly once. Offline keeps cached readings without hammering an
    /// unreachable backend.
    private func handleAutoRefresh(for connection: VCCConnection) {
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

    private func applyResult(_ result: VCCCommandResult) {
        executingCommandID = nil
        lastResult = result
        emitFeedback(for: result)
        source.refresh()
    }

    /// Routes the outcome to the toast seam with the web copy, including the wake
    /// special-case (web `wakeMut` shows "<name> is waking up" / "Failed to wake …").
    private func emitFeedback(for result: VCCCommandResult) {
        let name = projection?.vehicleName ?? ""
        if result.commandID == VehicleCommandCatalog.wakeCommandID {
            if result.success {
                feedback.success(VehicleCommandCenterStrings.format("commands.wakeUpStarted", "%@ is waking up", name))
            } else {
                feedback.failure(
                    VehicleCommandCenterStrings.format(
                        "commands.wakeFailed",
                        "Failed to wake %1$@: %2$@",
                        name,
                        result.message
                    )
                )
            }
            return
        }
        if result.success {
            feedback.success(VehicleCommandCenterStrings.format("commands.sentTo", "Command sent to %@", name))
        } else {
            let message = result.message.isEmpty
                ? VehicleCommandCenterStrings.format("commands.failedOn", "Command failed on %@", name)
                : VehicleCommandCenterStrings.format("commands.failedDetail", "Command failed: %@", result.message)
            feedback.failure(message)
        }
    }
}
