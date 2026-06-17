import Foundation
import Observation

// MARK: - Transient feedback (web `useToast` success / error)

/// One transient feedback banner — the native counterpart of the web `toast.success` /
/// `toast.error`. `isError` drives the tone; `id` re-arms the auto-dismiss timer per emission.
public struct IncidentTimelineToast: Equatable, Sendable, Identifiable {
    public let id: UUID
    public let message: String
    public let isError: Bool

    public init(message: String, isError: Bool) {
        id = UUID()
        self.message = message
        self.isError = isError
    }
}

// MARK: - Page model (web useIncident + useAppendIncidentUpdate + usePatchIncident + form state)

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// loaded incident (web `useIncident(numericId)`), the append-update form fields (web `message` /
/// `nextStatus`), the resolve-confirm flag (web `confirmResolve`), the two in-flight mutation flags
/// (web `appendUpdate.isPending` / `patch.isPending`), and the transient toast (web `useToast`). The
/// numeric-id gate mirrors the web `Number(id) > 0 ? … : null`: an invalid id resolves straight to
/// the not-found state without a fetch (web disabled query → `!incident`).
@MainActor
@Observable
public final class IncidentTimelinePageModel {
    /// The parsed numeric incident id (web `numericId`); `nil` for an invalid route id.
    public let incidentID: Int64?
    /// The raw route id string shown verbatim in the not-found copy (web `Incident {id} not found`).
    public let rawID: String

    public private(set) var state: IncidentTimelineState = .loading
    public private(set) var incident: IncidentTimelineDetail?

    /// The append-update message (web controlled `message`). Two-way bound by the form textarea.
    public var message: String = ""
    /// The optional lifecycle transition the appended update carries (web `nextStatus`). Two-way
    /// bound by the form status picker.
    public var statusChange: IncidentTimelineStatusChange = .keep
    /// Whether the resolve-confirm dialog is presented (web `confirmResolve`). Two-way bound by the
    /// `.alert` presentation.
    public var confirmResolve: Bool = false

    public private(set) var isAppending = false
    public private(set) var isResolving = false
    public private(set) var toast: IncidentTimelineToast?

    @ObservationIgnored private let dataSource: any IncidentTimelineDataSource

    public init(
        incidentID: Int64?,
        rawID: String? = nil,
        dataSource: any IncidentTimelineDataSource = SampleIncidentTimelineDataSource()
    ) {
        self.incidentID = incidentID
        self.rawID = rawID ?? incidentID.map(String.init) ?? "—"
        self.dataSource = dataSource
    }

    // MARK: Derived (web memos)

    /// Whether the loaded incident is closed (web `isResolved`). Gates the Resolve control + the
    /// append-update form.
    public var isResolved: Bool {
        incident?.isResolved ?? false
    }

    /// Whether the append submit is disabled — only while a submit is in flight (web
    /// `disabled={appendUpdate.isPending}`). An empty message is intentionally NOT disabled here: the
    /// web keeps the submit tappable (its textarea `required` + the handler's "Update message is
    /// required." toast guard empty input), so `appendUpdate()` surfaces that validation toast.
    public var isAppendDisabled: Bool {
        isAppending
    }

    // MARK: Form input (web controlled `message`, capped at maxLength={4000})

    /// Sets the append message, clamped to the web `maxLength={4000}` (the shared `IncidentFieldBounds`
    /// the sibling `IncidentForm` enforces), so the native editor matches the web input-level cap.
    public func setMessage(_ value: String) {
        message = String(value.prefix(IncidentFieldBounds.messageMaxLength))
    }

    // MARK: Loading (web `useIncident`)

    /// Loads the incident (web `useIncident(numericId)`). An invalid id resolves straight to the
    /// not-found panel without a fetch (web disabled query → `!incident`).
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Re-runs the load while keeping any current content visible (the not-found panel's retry).
    public func refresh() async {
        await fetch()
    }

    private func fetch() async {
        guard let incidentID else {
            incident = nil
            state = .error(IncidentTimelineStrings.notFoundMessage(id: rawID))
            return
        }
        do {
            let loaded = try await dataSource.loadIncident(id: incidentID)
            incident = loaded
            state = .ready
        } catch {
            incident = nil
            state = .error(IncidentTimelineStrings.notFoundMessage(id: rawID))
        }
    }

    // MARK: Append update (web `handleAppend` → useAppendIncidentUpdate)

    /// Appends a timeline update (web `handleAppend`): the trimmed message is required (web
    /// `toast.error('Update message is required.')`), the optional status change advances the
    /// lifecycle (web `nextStatus || undefined`), and on success the form clears + the success toast
    /// shows (web `setMessage(''); setNextStatus(''); toast.success('Update added.')`).
    public func appendUpdate() async {
        guard let incident else { return }
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            toast = IncidentTimelineToast(message: IncidentTimelineStrings.toastRequired, isError: true)
            return
        }
        guard !isAppending else { return }
        isAppending = true
        defer { isAppending = false }
        do {
            let updated = try await dataSource.appendUpdate(
                id: incident.id,
                message: trimmed,
                status: statusChange.wireStatus
            )
            self.incident = updated
            message = ""
            statusChange = .keep
            toast = IncidentTimelineToast(message: IncidentTimelineStrings.toastAdded, isError: false)
        } catch {
            toast = IncidentTimelineToast(message: appendErrorMessage(error), isError: true)
        }
    }

    // MARK: Resolve (web `handleResolve` → usePatchIncident { resolved: true })

    /// Opens the resolve-confirm dialog (web `setConfirmResolve(true)`).
    public func requestResolve() {
        confirmResolve = true
    }

    /// Cancels the resolve-confirm dialog (web `onCancel`).
    public func cancelResolve() {
        confirmResolve = false
    }

    /// Resolves the incident (web `handleResolve`): patches `resolved: true`, applies the refreshed
    /// incident, shows the success toast, and closes the dialog (web `toast.success('Incident
    /// resolved.'); setConfirmResolve(false)`).
    public func resolve() async {
        guard let incident else { return }
        guard !isResolving else { return }
        isResolving = true
        defer { isResolving = false }
        do {
            let updated = try await dataSource.resolveIncident(id: incident.id)
            self.incident = updated
            toast = IncidentTimelineToast(message: IncidentTimelineStrings.toastResolved, isError: false)
            confirmResolve = false
        } catch {
            toast = IncidentTimelineToast(message: resolveErrorMessage(error), isError: true)
        }
    }

    // MARK: Toast lifecycle

    /// Clears the current toast (web `useToast` auto-dismiss / manual close).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Error copy (web `err instanceof Error ? err.message : fallback`)

    private func appendErrorMessage(_ error: Error) -> String {
        let described = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return described.isEmpty ? IncidentTimelineStrings.toastAppendFailed : described
    }

    private func resolveErrorMessage(_ error: Error) -> String {
        let described = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return described.isEmpty ? IncidentTimelineStrings.toastResolveFailed : described
    }
}
