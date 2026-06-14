import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/automations/pages/ActionBuilder.tsx`.
//
// The web `ActionBuilder` is a controlled form the parent `AutomationBuilder` page owns: it is
// fed `actions` + `channels` props and hands a fresh `actions` array back through `onChange`.
// Per the parity manifest this native unit "renders from navigation values / local state" (no
// API data sources), so the page owns the editable list itself through this `@Observable`
// model and resolves a typed render state (loading / empty / success / error) over an
// injectable seam — no networking lives here (ADR-004).
//
// The pure projection logic (the discriminated `AutomationAction` union, the default-action
// factory, the channel/command option projections, the set-setting value model, and the
// order-preserving command-params JSON engine) is REUSED from the module-public P4 layer
// (`ActionBuilderAdapter` / `ActionCatalog` / `ActionJSONParser`) so there is one source of
// truth; only the localization boundary differs (this page resolves every string from
// `Localizable.xcstrings`, the platform catalog).

// MARK: - Localization facade (web `t(key, default)` → Localizable.xcstrings)

/// Resolves the page's copy by key from the platform `Localizable.xcstrings` catalog, with the
/// web English value as a safety fallback if a key is somehow absent. Keys match the web names.
enum ActionBuilderPageStrings {
    /// Resolves `key` from `Localizable.xcstrings`; returns `fallback` only if the catalog has no
    /// entry (a missing dynamic key resolves to itself).
    static func localize(_ key: String, _ fallback: String) -> String {
        let value = String(localized: String.LocalizationValue(key), bundle: .main)
        return value == key ? fallback : value
    }
}

// MARK: - Editable row (lifted form state)

/// One editable action row: the action value plus the command-params editor's text + inline
/// error, lifted out of the view so the model is the single source of truth and is unit-testable
/// (the web kept `paramsText` / `paramsError` as local component state).
public struct ActionBuilderPageRow: Identifiable, Sendable, Equatable {
    public let id: UUID
    public var action: AutomationAction
    /// Web command-params textarea text (seeded from `command_params`).
    public var paramsText: String
    /// Web command-params inline error (`Params must be a JSON object.` / `Invalid JSON`).
    public var paramsError: String?

    public init(id: UUID = UUID(), action: AutomationAction, paramsText: String = "", paramsError: String? = nil) {
        self.id = id
        self.action = action
        self.paramsText = paramsText
        self.paramsError = paramsError
    }
}

// MARK: - Render state (manifest data states + no-blank-region robustness)

/// The page's typed render state. `success` and `error` are the manifest-declared data states;
/// `loading` and `empty` are added so no region ever renders blank (HIG `ContentUnavailableView`
/// / redacted skeleton). `error` is the web's only error surface — an invalid command-params
/// JSON edit (`paramsError`); `success` is the normal, all-valid render.
public enum ActionBuilderPageState: Sendable, Equatable {
    case loading
    case empty
    case success
    case error
}

// MARK: - Input seam (navigation values / local state)

/// The values the page is seeded with (web `actions` + `channels` props): the editable action
/// list and the notification channels the notify action can target.
public struct ActionBuilderPageInput: Sendable, Equatable {
    public var actions: [AutomationAction]
    public var channels: [NotificationChannelSummary]

    public init(actions: [AutomationAction] = [], channels: [NotificationChannelSummary] = []) {
        self.actions = actions
        self.channels = channels
    }
}

/// The seam that supplies the page's initial values (default = representative local state),
/// mirroring the sibling pages' injectable providers.
public protocol ActionBuilderPageProviding: Sendable {
    func load() async -> ActionBuilderPageInput
}

/// Representative local state for the default page (a command-with-params action, a notify
/// action, and a set-setting action over two channels) — the manifest's "navigation values /
/// local state" with no networking.
public struct DefaultActionBuilderPageData: ActionBuilderPageProviding {
    public init() {}

    public func load() async -> ActionBuilderPageInput {
        ActionBuilderPageInput(
            actions: [
                .command(
                    commandName: "set_charge_limit",
                    params: .object([ActionJSONMember("percent", .number("80"))])
                ),
                .notify(channelID: 1, template: "Car is warming up!"),
                .setSetting(key: "charge_limit", value: .number(80))
            ],
            channels: [
                NotificationChannelSummary(id: 1, name: "Home Discord", kind: .discord, enabled: true),
                NotificationChannelSummary(id: 2, name: "Pushover", kind: .pushover, enabled: false)
            ]
        )
    }
}

/// An empty seam (no actions) for the empty-state preview / test.
public struct EmptyActionBuilderPageData: ActionBuilderPageProviding {
    public init() {}

    public func load() async -> ActionBuilderPageInput {
        ActionBuilderPageInput()
    }
}

// MARK: - State holder (P1/S8 layer)

/// The ActionBuilder page's observable view-model. Owns the editable rows (web `actions`),
/// derives the channel + command option projections, applies the same add / remove / replace /
/// move / change-kind mutations the web callbacks do, and validates command-params JSON exactly
/// like the web edit effect. Pure form logic — no networking.
@MainActor
@Observable
public final class ActionBuilderPageModel {
    private enum Phase: Equatable {
        case loading
        case ready
    }

    /// The editable action rows (web `actions`, with lifted params text/error).
    public private(set) var rows: [ActionBuilderPageRow] = []

    /// The notification channels the notify action can target (web `channels` prop).
    public private(set) var channels: [NotificationChannelSummary] = []

    @ObservationIgnored private let provider: any ActionBuilderPageProviding
    private var phase: Phase = .loading

    public init(provider: any ActionBuilderPageProviding = DefaultActionBuilderPageData()) {
        self.provider = provider
    }

    // MARK: Derived render state

    /// The typed render state (web loading / content, plus the `paramsError` error surface).
    public var state: ActionBuilderPageState {
        switch phase {
        case .loading:
            return .loading
        case .ready:
            if rows.isEmpty { return .empty }
            return rows.contains { $0.paramsError != nil } ? .error : .success
        }
    }

    /// Whether any command row currently has an invalid-params error (drives the `error` state).
    public var hasValidationError: Bool {
        rows.contains { $0.paramsError != nil }
    }

    /// The current action values (web `actions`), stripped of the lifted editor state.
    public var actions: [AutomationAction] {
        rows.map(\.action)
    }

    // MARK: Derived projections (reused adapter)

    /// Web `defaultChannelId` memo: first enabled channel, else first channel, else 0.
    public var defaultChannelID: Int {
        ActionBuilderAdapter.defaultChannelID(in: channels)
    }

    /// Web `channelOptions` memo.
    public var channelOptions: [ChannelOption] {
        ActionBuilderAdapter.channelOptions(channels)
    }

    /// Web `commandOptions` memo (the "Select command..." sentinel + every grouped command),
    /// resolved from `Localizable.xcstrings`.
    public var commandOptions: [CommandOption] {
        ActionBuilderAdapter.commandOptions(localize: ActionBuilderPageStrings.localize)
    }

    /// The 1-based row position (move guards + index label).
    public func index(of id: UUID) -> Int? {
        rows.firstIndex { $0.id == id }
    }

    // MARK: Load / refresh

    /// Seeds the editable list from the provider (web initial `actions` prop).
    public func load() async {
        let input = await provider.load()
        apply(input)
    }

    /// Re-seeds from the provider (discards in-progress edits).
    public func refresh() async {
        phase = .loading
        await load()
    }

    private func apply(_ input: ActionBuilderPageInput) {
        channels = input.channels
        rows = input.actions.map { action in
            ActionBuilderPageRow(action: action, paramsText: paramsSeed(for: action))
        }
        phase = .ready
    }

    // MARK: Mutations (web addAction / removeAction / replaceAction / moveAction)

    /// Web `addAction`: append a default command action seeded with the default channel.
    public func addAction() {
        let action = ActionBuilderAdapter.defaultAction(.command, channelID: defaultChannelID)
        rows.append(ActionBuilderPageRow(action: action, paramsText: paramsSeed(for: action)))
    }

    /// Web `removeAction(index)`.
    public func removeAction(id: UUID) {
        rows.removeAll { $0.id == id }
    }

    /// Web action-type select: replace with a fresh default of the chosen kind, reseeding the
    /// command-params editor and clearing any prior error.
    public func changeKind(id: UUID, to kind: AutomationActionKind) {
        guard let index = index(of: id) else { return }
        let action = ActionBuilderAdapter.defaultAction(kind, channelID: defaultChannelID)
        rows[index].action = action
        rows[index].paramsText = paramsSeed(for: action)
        rows[index].paramsError = nil
    }

    /// Web `replaceAction(index, nextAction)` for the non-params field edits (command name,
    /// channel, message, setting key/type/value, target id).
    public func replaceAction(id: UUID, with action: AutomationAction) {
        guard let index = index(of: id) else { return }
        rows[index].action = action
    }

    /// Web `moveAction(index, direction)`: swap with the neighbor when in range.
    public func moveAction(id: UUID, _ direction: ActionBuilderMoveDirection) {
        guard let index = index(of: id) else { return }
        let target = index + direction.delta
        guard rows.indices.contains(target) else { return }
        rows.swapAt(index, target)
    }

    /// Whether a row can move in the given direction (web move guards).
    public func canMove(id: UUID, _ direction: ActionBuilderMoveDirection) -> Bool {
        guard let index = index(of: id) else { return false }
        return rows.indices.contains(index + direction.delta)
    }

    // MARK: Command-params editor (web textarea onChange effect)

    /// Web command-params edit handler: empty text clears params, a valid JSON object commits,
    /// and a non-object or malformed value sets the matching inline error without committing.
    public func updateParams(id: UUID, text: String) {
        guard let index = index(of: id), case let .command(commandName, _) = rows[index].action else { return }
        rows[index].paramsText = text
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            rows[index].paramsError = nil
            rows[index].action = .command(commandName: commandName, params: nil)
            return
        }
        do {
            let parsed = try ActionJSONParser.parse(text)
            guard parsed.isObject else {
                rows[index].paramsError = ActionBuilderPageStrings.localize(
                    "automations.builder.commandParamsObjectError",
                    "Params must be a JSON object."
                )
                return
            }
            rows[index].paramsError = nil
            rows[index].action = .command(commandName: commandName, params: parsed)
        } catch {
            rows[index].paramsError = ActionBuilderPageStrings.localize(
                "automations.builder.invalidJson",
                "Invalid JSON"
            )
        }
    }

    private func paramsSeed(for action: AutomationAction) -> String {
        guard case let .command(_, params) = action else { return "" }
        return ActionBuilderAdapter.commandParamsSeed(params)
    }
}

// MARK: - Move direction (web moveAction(index, -1 | 1))

/// The direction a row moves (web `moveAction(index, -1 | 1)`).
public enum ActionBuilderMoveDirection: Sendable, Equatable {
    case up
    case down

    var delta: Int {
        self == .up ? -1 : 1
    }
}
