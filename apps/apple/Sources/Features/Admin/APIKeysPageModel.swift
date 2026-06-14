import Foundation
import Observation

/// The `@Observable` state holder the API Keys page binds to (ADR-004 — no networking in
/// the view). Owns the key-list state plus the create (web `Modal`) and delete (web
/// `ConfirmDialog`) interaction state, and reads + writes the four feeds through the
/// injected `APIKeysDataSource` seam. Mirrors the sibling `FeatureFlagsPageModel`.
@MainActor
@Observable
public final class APIKeysPageModel {
    public private(set) var listState: APIKeysListState = .loading

    // Create modal (web `showCreate` / `newName` / `newPerm` / `generatedKey`).
    public var createPresented = false
    public var newName = ""
    public var newPermission: APIKeyPermission = .read
    public private(set) var generatedKey: String?
    public private(set) var isCreating = false
    public private(set) var createError: String?

    // Delete confirmation (web `deleteTarget`).
    public private(set) var deleteTarget: APIKeyEntry?
    public private(set) var isDeleting = false
    public private(set) var deleteError: String?

    // Revoke action (web `revokeMut`) — tracked per-row so only the acted row disables.
    public private(set) var revokingID: String?
    public private(set) var revokeError: String?

    @ObservationIgnored private let dataSource: any APIKeysDataSource
    @ObservationIgnored private let now: () -> Date

    public init(
        dataSource: any APIKeysDataSource = SampleAPIKeysDataSource(),
        now: @escaping () -> Date = Date.init
    ) {
        self.dataSource = dataSource
        self.now = now
    }

    // MARK: - Derived state

    /// The loaded key rows (empty unless the state is `.loaded`).
    public var keys: [APIKeyEntry] {
        if case let .loaded(rows) = listState { return rows }
        return []
    }

    /// Whether the create modal is showing the freshly generated secret (web
    /// `generatedKey != null`), which swaps the form for the reveal + the modal title.
    public var hasGeneratedKey: Bool {
        generatedKey != nil
    }

    /// Web `disabled={!newName.trim()}` (Generate), inverted, also gated on the in-flight
    /// create so a double-tap can't fire two requests.
    public var canGenerate: Bool {
        !newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isCreating
    }

    /// Web `isExpired(k)` against the model's clock.
    public func isExpired(_ entry: APIKeyEntry) -> Bool {
        entry.isExpired(now: now())
    }

    /// Whether a revoke is in flight for this specific row.
    public func isRevoking(_ entry: APIKeyEntry) -> Bool {
        revokingID == entry.id
    }

    // MARK: - Loading (web `useApiKeys`)

    /// Mounts the list (no-op once already loaded so navigating back doesn't re-flash).
    public func load() async {
        if case .loaded = listState { return }
        await reload()
    }

    /// Re-runs the list query (web `useApiKeys → GET /api-keys`).
    public func reload() async {
        listState = .loading
        do {
            let rows = try await dataSource.loadKeys()
            listState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            listState = .error(error.localizedDescription)
        }
    }

    // MARK: - Create (web `setShowCreate` / `createMut`)

    /// Web "Create Key" header action: opens the modal with a cleared form and clears any
    /// previously generated secret (`onClick={() => { setShowCreate(true); setGeneratedKey(null); }}`).
    public func beginCreate() {
        newName = ""
        newPermission = .read
        generatedKey = nil
        createError = nil
        createPresented = true
    }

    /// Web modal `onClose` (also the "Done" / "Cancel" buttons): closes + clears the secret.
    public func closeCreate() {
        guard !isCreating else { return }
        createPresented = false
        generatedKey = nil
        createError = nil
        newName = ""
    }

    /// Web "Generate Key" — `createMut.mutate({ name, permissions }, { onSuccess })`. On
    /// success it reveals the one-time secret, clears the name, and refreshes the list
    /// (web `invalidateQueries`); the modal stays open on the reveal. On failure the form
    /// stays open with the error so the operator can retry without re-typing.
    public func generate() async {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isCreating else { return }
        isCreating = true
        createError = nil
        do {
            let created = try await dataSource.createKey(name: trimmed, permissions: newPermission)
            generatedKey = created.key
            newName = ""
            isCreating = false
            await reload()
        } catch {
            createError = error.localizedDescription
            isCreating = false
        }
    }

    // MARK: - Delete (web `setDeleteTarget` / `deleteMut`)

    /// Web row trash action `onClick={() => setDeleteTarget(k)}`.
    public func askDelete(_ entry: APIKeyEntry) {
        deleteTarget = entry
        deleteError = nil
    }

    /// Web `ConfirmDialog` `onCancel` (ignored while a delete is in flight).
    public func cancelDelete() {
        guard !isDeleting else { return }
        deleteTarget = nil
        deleteError = nil
    }

    /// Web `onConfirm` — `deleteMut.mutate(id, { onSuccess: () => setDeleteTarget(null) })`,
    /// then refresh. On failure the dialog stays open carrying the error.
    public func confirmDelete() async {
        guard let target = deleteTarget, !isDeleting else { return }
        isDeleting = true
        deleteError = nil
        do {
            try await dataSource.deleteKey(id: target.id)
            isDeleting = false
            deleteTarget = nil
            await reload()
        } catch {
            deleteError = error.localizedDescription
            isDeleting = false
        }
    }

    // MARK: - Revoke (web `revokeMut`)

    /// Web row revoke action `onClick={() => revokeMut.mutate(k.id)}`, then refresh.
    public func revoke(_ entry: APIKeyEntry) async {
        guard revokingID == nil else { return }
        revokingID = entry.id
        revokeError = nil
        do {
            try await dataSource.revokeKey(id: entry.id)
            revokingID = nil
            await reload()
        } catch {
            revokeError = error.localizedDescription
            revokingID = nil
        }
    }
}
