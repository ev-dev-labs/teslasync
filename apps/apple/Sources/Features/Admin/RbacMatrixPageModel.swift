import Foundation
import Observation

/// The `@Observable` state holder the RBAC matrix page binds to (ADR-004 — no networking in
/// the view). Owns the single query state (loading / open-mode / error / empty / loaded), the
/// read-only⇄edit toggle, the draft cell map, and the in-flight + error flags for the
/// sudo-gated save, reading + writing through the injected `RbacMatrixDataSource` seam.
/// Mirrors the sibling `FeatureFlagsPageModel`.
@MainActor
@Observable
public final class RbacMatrixPageModel {
    public private(set) var state: RbacMatrixState = .loading

    /// Whether the matrix is in edit mode (web `editing`). Read-only by default — the Edit
    /// toggle flips cells into checkboxes; Save diffs the draft against the snapshot.
    public private(set) var editing = false

    /// The draft cell map (web `draft.cells`): `[roleID][permID] → allowed`. Mirrors the
    /// server shape so diffing against the snapshot stays straightforward.
    public private(set) var draft: [String: [String: Bool]] = [:]

    public private(set) var isSaving = false

    /// Whether the last save failed (web `submitError != null`).
    public private(set) var submitFailed = false

    /// The API code from the last save failure, or `nil` to use the generic copy
    /// (web `code ?? t('rbac.errors.saveGeneric')`).
    public private(set) var submitErrorCode: String?

    @ObservationIgnored private let dataSource: any RbacMatrixDataSource

    public init(dataSource: any RbacMatrixDataSource = SampleRbacMatrixDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived state

    /// The loaded session, or `nil` for the loading / open-mode / error / empty phases.
    public var session: RbacMatrixSession? {
        if case let .loaded(session) = state {
            return session
        }
        return nil
    }

    /// The changed cells between the snapshot and the draft (web `diffMatrices`).
    public var dirtyCells: [RbacUpsertCell] {
        guard let session else {
            return []
        }
        return RbacMatrix.diffMatrices(base: session.matrix, draft: draft)
    }

    /// Web `dirtyCount` — the Save button's badge + disabled guard.
    public var dirtyCount: Int {
        dirtyCells.count
    }

    /// Web `canSave`-adjacent guard for the Save button (`!isPending && dirtyCount > 0`).
    public var canSave: Bool {
        !isSaving && dirtyCount > 0
    }

    /// The current cell value the grid renders (web `draft.cells[roleID]?.[permID] ?? false`).
    /// Read + edit modes both read the draft, which is resynced to the snapshot on every load.
    public func cellAllowed(roleID: String, permID: String) -> Bool {
        draft[roleID]?[permID] ?? false
    }

    // MARK: - Loading (web `useRbacMatrix`)

    /// Runs the matrix query (web `matrixQuery`). Open-mode maps to `.openMode`; a successful
    /// load resyncs the draft (unless mid-edit) and lands on `.empty` / `.loaded`.
    public func load() async {
        state = .loading
        do {
            let result = try await dataSource.loadMatrix()
            apply(result)
        } catch {
            state = .error((error as? RbacApiError)?.code)
        }
    }

    private func apply(_ result: RbacMatrixResult) {
        if RbacMatrix.isRbacOpenMode(result) {
            state = .openMode
            return
        }
        guard case let .session(session) = result else {
            state = .openMode
            return
        }
        if !editing {
            draft = RbacMatrix.snapshotToDraft(session.matrix)
        }
        state = session.roles.isEmpty ? .empty : .loaded(session)
    }

    // MARK: - Editing (web `handleEnterEdit` / `handleCancelEdit` / `handleToggle`)

    /// Web `handleEnterEdit` — seeds the draft from the snapshot and flips to edit mode.
    public func beginEdit() {
        guard let session else {
            return
        }
        submitFailed = false
        submitErrorCode = nil
        draft = RbacMatrix.snapshotToDraft(session.matrix)
        editing = true
    }

    /// Web `handleCancelEdit` — drops the draft back to the snapshot and exits edit mode.
    public func cancelEdit() {
        editing = false
        if let session {
            draft = RbacMatrix.snapshotToDraft(session.matrix)
        }
        submitFailed = false
        submitErrorCode = nil
    }

    /// Web `handleToggle` — sets a single draft cell (only meaningful in edit mode).
    public func toggle(roleID: String, permID: String, allowed: Bool) {
        var row = draft[roleID] ?? [:]
        row[permID] = allowed
        draft[roleID] = row
    }

    // MARK: - Saving (web `handleSave`)

    /// Web `handleSave` — diffs the draft, PUTs only the changed cells (sudo-gated upstream),
    /// then exits edit mode + refetches. An empty diff is a no-op exit. On failure the matrix
    /// stays in edit mode so the operator can retry without losing their toggles.
    public func save() async {
        guard session != nil, !isSaving else {
            return
        }
        submitFailed = false
        submitErrorCode = nil
        let cells = dirtyCells
        if cells.isEmpty {
            editing = false
            return
        }
        isSaving = true
        do {
            try await dataSource.upsertCells(cells)
            isSaving = false
            editing = false
            await load()
        } catch {
            submitFailed = true
            submitErrorCode = (error as? RbacApiError)?.code
            isSaving = false
        }
    }
}
