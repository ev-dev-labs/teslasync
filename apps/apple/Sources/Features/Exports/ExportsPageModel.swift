import Foundation
import Observation

// MARK: - List state (web PageContainer query phases)

/// The list state for the export-jobs feed. `.empty` is a successful load with zero rows
/// (web `jobs.length === 0` → `EmptyState`); `.error` is a generic retryable failure (web
/// `ErrorDisplay`); `.loaded` carries one or more rows; `.loading` shows the skeletons.
public enum ExportsListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([ExportJobSummary])
}

/// The select-all checkbox tri-state (web `useBulkSelection.masterState`): `none` when no
/// visible row is selected, `all` when every visible row is, `some` (indeterminate)
/// otherwise. Named `SelectAll` rather than the web's "master" term per the repo's
/// inclusive-language lint.
public enum ExportsSelectAllState: Sendable, Equatable {
    case none
    case some
    case all
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the list state, the bulk selection (web `useBulkSelection`), and the
/// in-flight delete flag, reading the jobs + performing the delete through the injected
/// `ExportsDataSource` seam. All display derivations (select-all state, selection noun,
/// download URL) are pure so they unit-test without a view.
@MainActor
@Observable
public final class ExportsPageModel {
    public private(set) var state: ExportsListState = .loading

    /// The selected job ids (web `useBulkSelection` `selectedIds: Set<string>`).
    public private(set) var selectedIDs: Set<String> = []

    /// Whether a bulk delete is in flight (web per-action toolbar spinner).
    public private(set) var isDeleting = false

    /// Backend origin used to build the binary download URL at the display boundary
    /// (web resolves the relative `/api/v1/...` href against the page origin). Defaults
    /// to the documented local dev origin; production injects the bootstrapped base.
    @ObservationIgnored public let apiBaseURL: URL

    @ObservationIgnored private let dataSource: any ExportsDataSource

    public init(
        dataSource: any ExportsDataSource = SampleExportsDataSource(),
        apiBaseURL: URL = URL(string: "http://localhost:8080")!
    ) {
        self.dataSource = dataSource
        self.apiBaseURL = apiBaseURL
    }

    // MARK: Derived list accessors

    /// The loaded jobs (empty unless the state is `.loaded`).
    public var jobs: [ExportJobSummary] {
        if case let .loaded(jobs) = state { return jobs }
        return []
    }

    /// The ids of the currently-visible rows (web `visibleIds = jobs.map(j => j.id)`).
    public var visibleIDs: [String] {
        jobs.map(\.id)
    }

    // MARK: Bulk selection (web `useBulkSelection`)

    public func isSelected(_ id: String) -> Bool {
        selectedIDs.contains(id)
    }

    /// Flips a single id between selected / not (web `sel.toggle(id)`).
    public func toggle(_ id: String) {
        if selectedIDs.contains(id) { selectedIDs.remove(id) } else { selectedIDs.insert(id) }
    }

    /// Sets the selection state of a single id explicitly (web `sel.setSelected`).
    public func setSelected(_ id: String, _ on: Bool) {
        if on { selectedIDs.insert(id) } else { selectedIDs.remove(id) }
    }

    /// The select-all checkbox state over the visible rows (web `sel.masterState`).
    public var selectAllState: ExportsSelectAllState {
        let visible = visibleIDs
        guard !visible.isEmpty else { return .none }
        let selectedVisible = visible.reduce(into: 0) { count, id in
            if selectedIDs.contains(id) { count += 1 }
        }
        if selectedVisible == 0 { return .none }
        return selectedVisible == visible.count ? .all : .some
    }

    /// Gmail-style select-all toggle (web `sel.toggleAll(visibleIds)`): if every visible
    /// row is already selected, deselect them all; otherwise select all visible rows.
    public func toggleAll() {
        let visible = visibleIDs
        guard !visible.isEmpty else { return }
        if selectAllState == .all {
            visible.forEach { selectedIDs.remove($0) }
        } else {
            visible.forEach { selectedIDs.insert($0) }
        }
    }

    /// Drops every selection (web `sel.clear()`).
    public func clearSelection() {
        selectedIDs.removeAll()
    }

    /// The number of selected rows (web `selectedIds.length`).
    public var selectedCount: Int {
        selectedIDs.count
    }

    /// Whether the bulk toolbar shows (web `count > 0`).
    public var hasSelection: Bool {
        !selectedIDs.isEmpty
    }

    /// The pluralized noun key for the selection count (web `itemNoun` one/other).
    public var selectionNounKey: String {
        selectedCount == 1 ? "exportsList.noun.one" : "exportsList.noun.other"
    }

    // MARK: Download (web `exportDownloadUrl`, ready-only)

    /// The relative download href for a ready job (web `<a href={exportDownloadUrl(id)}>`),
    /// else nil — the link only renders for `ready` jobs.
    public func downloadHref(for job: ExportJobSummary) -> String? {
        job.isDownloadable ? exportDownloadUrl(job.id) : nil
    }

    /// The absolute download URL the native link opens (web `<a href>` resolved against
    /// the origin) — nil unless the job is ready.
    public func downloadURL(for job: ExportJobSummary) -> URL? {
        guard let href = downloadHref(for: job) else { return nil }
        return URL(string: href, relativeTo: apiBaseURL)?.absoluteURL
    }

    // MARK: Intents

    /// Loads the export jobs, resolving the terminal list state (web `useExportJobs`).
    public func load() async {
        state = .loading
        do {
            let jobs = try await dataSource.loadJobs()
            pruneSelection(against: jobs)
            state = jobs.isEmpty ? .empty : .loaded(jobs)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Loads on first appearance / re-tries on reappear until a populated state is
    /// reached (web query auto-fetch). Idempotent for the already-loaded state.
    public func loadIfNeeded() async {
        if case .loaded = state { return }
        await load()
    }

    /// Re-runs the query (web error-retry / poll refetch).
    public func refresh() async {
        await load()
    }

    /// Web `bulkDelete.mutateAsync(ids)` then `sel.clear()` — deletes the selected jobs,
    /// drops them locally, and clears the selection. On failure the selection is
    /// preserved so the user can retry (web leaves the toolbar mounted on error).
    public func deleteSelected() async {
        let ids = selectedIDs
        guard !ids.isEmpty else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            _ = try await dataSource.bulkDelete(ids: Array(ids))
            let remaining = jobs.filter { !ids.contains($0.id) }
            selectedIDs.removeAll()
            state = remaining.isEmpty ? .empty : .loaded(remaining)
        } catch {
            // Selection preserved for retry; the list is unchanged (web mutation error).
        }
    }

    /// Drops any selected ids no longer present after a (re)load (web selection prune).
    private func pruneSelection(against jobs: [ExportJobSummary]) {
        let present = Set(jobs.map(\.id))
        selectedIDs = selectedIDs.intersection(present)
    }
}
