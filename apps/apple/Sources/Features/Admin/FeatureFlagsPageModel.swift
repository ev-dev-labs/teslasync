import Foundation
import Observation

/// The `@Observable` state holder the Feature Flags page binds to (ADR-004 — no
/// networking in the view). Owns the registry list state, the change-audit state, and
/// the create/edit + delete interaction state (form fields, in-flight + error flags),
/// reading + writing the four feeds through the injected `FeatureFlagsDataSource` seam.
/// Mirrors the sibling `AuditLogPageModel`.
@MainActor
@Observable
public final class FeatureFlagsPageModel {
    /// Web `useFlagChanges(null, 50)` — the recent-change feed window.
    public static let changesLimit = 50

    /// Why the editor's JSON value is invalid (web `parsed.error` cases).
    public enum EditorValueError: Equatable, Sendable {
        case none
        case empty
        case invalid
    }

    public private(set) var flagsState: FeatureFlagsListState = .loading
    public private(set) var changesState: FeatureFlagChangesState = .loading

    // Editor (web `FlagEditDrawer`) — `editing == nil` is create mode.
    public private(set) var editing: FeatureFlagEntry?
    public var editorPresented = false
    public var editorKey = ""
    public var editorValueText = ""
    public var editorReason = ""
    public private(set) var isSaving = false
    public private(set) var saveError: String?

    // Delete confirmation (web delete `Modal`).
    public var deleteTarget: FeatureFlagEntry?
    public var deleteReason = ""
    public private(set) var isDeleting = false
    public private(set) var deleteError: String?

    @ObservationIgnored private let dataSource: any FeatureFlagsDataSource

    public init(dataSource: any FeatureFlagsDataSource = SampleFeatureFlagsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived state

    /// The loaded registry rows (empty unless the state is `.loaded`).
    public var flags: [FeatureFlagEntry] {
        if case let .loaded(rows) = flagsState { return rows }
        return []
    }

    /// The loaded audit rows (empty unless the state is `.loaded`).
    public var changes: [FeatureFlagChange] {
        if case let .loaded(rows) = changesState { return rows }
        return []
    }

    /// Whether the editor is in edit (vs create) mode (web `editing = initial !== null`).
    public var isEditing: Bool {
        editing != nil
    }

    /// The parsed editor value (web `JSON.parse(valueInput)`); nil when empty / malformed.
    public var editorParsedValue: FlagJSONValue? {
        FlagJSONValue.parse(editorValueText)
    }

    /// The editor value validation result (web `parsed`).
    public var editorValueError: EditorValueError {
        if Self.trimmed(editorValueText).isEmpty { return .empty }
        return editorParsedValue == nil ? .invalid : .none
    }

    public var editorKeyValid: Bool {
        !Self.trimmed(editorKey).isEmpty
    }

    public var editorReasonValid: Bool {
        !Self.trimmed(editorReason).isEmpty
    }

    /// Web `canSave = parsed.ok && keyValid && reasonValid && !saving`.
    public var canSave: Bool {
        editorParsedValue != nil && editorKeyValid && editorReasonValid && !isSaving
    }

    /// Web delete button guard (`deleteReason.trim().length === 0 || isPending`), inverted.
    public var canConfirmDelete: Bool {
        deleteTarget != nil && !Self.trimmed(deleteReason).isEmpty && !isDeleting
    }

    // MARK: - Loading (web `useFlags` + `useFlagChanges`)

    /// Mounts both feeds (web renders the table + audit queries side-by-side).
    public func load() async {
        await reloadFlags()
        await reloadChanges()
    }

    /// Re-runs the registry query (web `useFlags → GET /system/flags`).
    public func reloadFlags() async {
        flagsState = .loading
        do {
            let rows = try await dataSource.loadFlags()
            flagsState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            flagsState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the change-audit query (web `useFlagChanges → GET /system/flags/changes`).
    public func reloadChanges() async {
        changesState = .loading
        do {
            let rows = try await dataSource.loadChanges(limit: Self.changesLimit)
            changesState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            changesState = .error(error.localizedDescription)
        }
    }

    // MARK: - Editor (web `handleCreate` / `handleEdit` / `handleSave`)

    /// Web `handleCreate` — opens the editor in create mode with empty fields.
    public func beginCreate() {
        editing = nil
        editorKey = ""
        editorValueText = ""
        editorReason = ""
        saveError = nil
        editorPresented = true
    }

    /// Web `handleEdit(row)` — opens the editor seeded from an existing flag.
    public func beginEdit(_ entry: FeatureFlagEntry) {
        editing = entry
        editorKey = entry.key
        editorValueText = entry.prettyValue
        editorReason = ""
        saveError = nil
        editorPresented = true
    }

    /// Web drawer `onClose`.
    public func closeEditor() {
        editorPresented = false
        editing = nil
    }

    /// Web `handleSave` — sets the flag (sudo-gated), then closes + refreshes both feeds.
    /// On failure the editor stays open so the operator can retry without re-typing.
    public func save() async {
        guard let value = editorParsedValue, editorKeyValid, editorReasonValid, !isSaving else { return }
        isSaving = true
        saveError = nil
        do {
            try await dataSource.setFlag(key: Self.trimmed(editorKey), value: value, reason: Self.trimmed(editorReason))
            isSaving = false
            editorPresented = false
            editing = nil
            await reloadFlags()
            await reloadChanges()
        } catch {
            saveError = error.localizedDescription
            isSaving = false
        }
    }

    // MARK: - Delete (web `handleAskDelete` / `handleConfirmDelete`)

    /// Web `handleAskDelete(row)` — opens the delete confirmation with an empty reason.
    public func askDelete(_ entry: FeatureFlagEntry) {
        deleteTarget = entry
        deleteReason = ""
        deleteError = nil
    }

    /// Web delete `Modal` `onClose` (ignored while a delete is in flight).
    public func cancelDelete() {
        guard !isDeleting else { return }
        deleteTarget = nil
        deleteReason = ""
        deleteError = nil
    }

    /// Web `handleConfirmDelete` — deletes the flag (sudo-gated, reason required), then
    /// dismisses + refreshes both feeds. On failure the dialog stays open for retry.
    public func confirmDelete() async {
        guard let target = deleteTarget, !Self.trimmed(deleteReason).isEmpty, !isDeleting else { return }
        isDeleting = true
        deleteError = nil
        do {
            try await dataSource.deleteFlag(key: target.key, reason: Self.trimmed(deleteReason))
            isDeleting = false
            deleteTarget = nil
            deleteReason = ""
            await reloadFlags()
            await reloadChanges()
        } catch {
            deleteError = error.localizedDescription
            isDeleting = false
        }
    }

    // MARK: - Primitives

    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
