import Foundation
import Observation

/// Native SwiftUI parity state holder for `web/src/features/admin/pages/UsersPage.tsx` —
/// the admin "Subjects" impersonation page (web route is intentionally `(unrouted)`; the
/// native surface registers it for navigation, see `UsersRouteRegistration`).
///
/// The web page binds four hook-domain values (names preserved at the Swift call sites):
///  - `useImpersonationStatus`   → the gating status (open / inactive / active);
///  - `isImpersonationOpenMode`  → `open`   (renders the open-mode note instead of the list);
///  - `isImpersonationActive`    → `active` (disables every row's Impersonate action);
///  - `useImpersonationCandidates({ enabled: !open })` → the impersonatable subjects.
///
/// This holder reproduces that composition over two seams (ADR-004 — no networking in the
/// view): an `ImpersonationStatusProviding` (shared with `UserImpersonateButton`) that drives
/// the `isOpenMode` / `isActive` derivations, and a `UsersCandidatesProviding` that drives the
/// loading / empty / error / success states of the list. Production injects seams backed by the
/// shared KMP `ImpersonationStore` (P1/S8); previews and tests inject in-memory doubles.
@MainActor
@Observable
public final class UsersPageModel {
    /// The settled load phase of the gating status (web `useImpersonationStatus`).
    public private(set) var statusPhase: ImpersonationStatusPhase = .loading

    /// The settled load phase of the candidates feed (web `useImpersonationCandidates`).
    public private(set) var candidatesPhase: UsersCandidatesEvent = .loading

    @ObservationIgnored private let statusProvider: any ImpersonationStatusProviding
    @ObservationIgnored private let candidatesProvider: any UsersCandidatesProviding
    @ObservationIgnored private let makeRowStarter: @MainActor () -> any ImpersonationStarting

    /// Per-subject status relays so every embedded `UserImpersonateButton` gates on the SAME
    /// status the page resolved (web passes `disabled={active}` down to each row).
    @ObservationIgnored private var rowRelays: [String: UsersRowStatusRelay] = [:]
    /// Per-subject button view-models, memoised so a re-render never rebinds the row seams.
    @ObservationIgnored private var rowModels: [String: UserImpersonateButtonModel] = [:]
    @ObservationIgnored private var lastStatusEvent: ImpersonationStatusEvent = .loading
    @ObservationIgnored private var didLoad = false

    public init(
        statusProvider: any ImpersonationStatusProviding,
        candidatesProvider: any UsersCandidatesProviding,
        makeRowStarter: @escaping @MainActor () -> any ImpersonationStarting = { InMemoryImpersonationStarter() }
    ) {
        self.statusProvider = statusProvider
        self.candidatesProvider = candidatesProvider
        self.makeRowStarter = makeRowStarter
        statusProvider.onStatus = { [weak self] event in self?.applyStatus(event) }
        candidatesProvider.onCandidates = { [weak self] event in self?.applyCandidates(event) }
    }

    // MARK: - Derived projections (web `open` / `active` / page branch)

    /// Whether the install is open-access (web `isImpersonationOpenMode(status.data)`). `false`
    /// until the status resolves, exactly as the web `status?.mode === 'open'` reads `undefined`.
    public var isOpenMode: Bool {
        statusPhase.status?.mode == .open
    }

    /// Whether a session is already active (web `isImpersonationActive(status.data)`). When `true`
    /// every row's Impersonate action is disabled.
    public var isActive: Bool {
        statusPhase.status?.activeSubject != nil
    }

    /// The single panel's body state (web `GlassPanel` branch). Open-mode wins over every
    /// candidates phase, mirroring the web `open ? … : isLoading ? … : isError ? … : empty ? … : list`.
    public var panelState: UsersPanelState {
        if isOpenMode { return .openMode }
        switch candidatesPhase {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .openMode:
            // Candidates normalised to open without the status resolving to open yet — the web
            // `mode !== 'session'` branch yields an empty subject list.
            return .empty
        case let .loaded(subjects):
            return subjects.isEmpty ? .empty : .loaded(subjects)
        }
    }

    /// The resolved subjects (empty unless the candidates feed loaded a non-empty list).
    public var subjects: [ImpersonationSubject] {
        if case let .loaded(subjects) = candidatesPhase { return subjects }
        return []
    }

    // MARK: - Lifecycle

    /// Mounts both queries (web query mount). Idempotent — safe to call from `.task` on every
    /// re-appearance. `candidates` is requested alongside `status` because the web `enabled: !open`
    /// is `true` until the status first resolves to open.
    public func load() {
        guard !didLoad else { return }
        didLoad = true
        statusProvider.load()
        candidatesProvider.load()
    }

    /// Re-fetches both feeds (web error-retry / invalidate-all).
    public func refresh() {
        statusProvider.refresh()
        candidatesProvider.refresh()
    }

    /// Retries just the candidates feed (web `ErrorDisplay` `onRetry={() => candidates.refetch()}`).
    public func retryCandidates() {
        candidatesPhase = .loading
        candidatesProvider.refresh()
    }

    // MARK: - Row composition (web `<UserImpersonateButton subject disabled={active} />`)

    /// The memoised button view-model for a subject's row. Each row binds a dedicated status relay
    /// (fed the page's resolved status) and its own start mutation, so the embedded
    /// `UserImpersonateButton` gates and starts independently — the native parity of the web row.
    public func rowModel(for subject: String) -> UserImpersonateButtonModel {
        if let model = rowModels[subject] { return model }
        let relay = UsersRowStatusRelay(initial: lastStatusEvent)
        rowRelays[subject] = relay
        let model = UserImpersonateButtonModel(
            subject: subject,
            disabledByParent: false,
            statusProvider: relay,
            starter: makeRowStarter(),
            onStarted: { [weak self] _ in self?.handleRowStarted() }
        )
        rowModels[subject] = model
        return model
    }

    // MARK: - Seam handlers

    private func applyStatus(_ event: ImpersonationStatusEvent) {
        lastStatusEvent = event
        switch event {
        case .loading:
            statusPhase = .loading
        case let .loaded(status):
            statusPhase = .loaded(status)
        case .empty:
            statusPhase = .empty
        case let .failed(message):
            statusPhase = .failed(message: message)
        case .offline:
            break
        }
        for relay in rowRelays.values { relay.deliver(event) }
    }

    private func applyCandidates(_ event: UsersCandidatesEvent) {
        candidatesPhase = event
        if case let .loaded(subjects) = event {
            for subject in subjects where rowModels[subject.subject] == nil {
                _ = rowModel(for: subject.subject)
            }
        }
    }

    private func handleRowStarted() {
        // Web start mutation invalidates every query; re-read both feeds as the new principal.
        refresh()
    }
}

// MARK: - Candidates seam (web `useImpersonationCandidates` → GET /admin/impersonate/candidates)

/// One impersonatable subject — the native parity of the web `ImpersonationCandidate`. The opaque
/// proxy-issued `subject` is rendered verbatim (a future display-name column would not change this).
public struct ImpersonationSubject: Sendable, Equatable, Identifiable {
    public let subject: String
    public var id: String { subject }

    public init(subject: String) {
        self.subject = subject
    }
}

/// A candidates update delivered by the seam — mirrors the web query lifecycle plus the open-mode
/// normalisation (`{ mode: 'open' }` from the 501) folded to a distinct case so the page never
/// renders a blank region.
public enum UsersCandidatesEvent: Sendable, Equatable {
    case loading
    case loaded([ImpersonationSubject])
    case openMode
    case failed(message: String)
}

/// The seam the page binds through for the candidates list (web `useImpersonationCandidates`). The
/// production app implements this over the shared P1/S8 `ImpersonationStore.candidates`; previews
/// and tests inject `InMemoryUsersCandidatesProvider`. No I/O ever lives in the view.
@MainActor
public protocol UsersCandidatesProviding: AnyObject {
    var onCandidates: (@MainActor (UsersCandidatesEvent) -> Void)? { get set }
    /// Begins the initial candidates load (web query mount).
    func load()
    /// Re-fetches the candidates (retry / refresh).
    func refresh()
}

// MARK: - Panel state (web `GlassPanel` branch)

/// The single panel's body state. `.openMode` is the web `open` branch note; the other four are the
/// declared data states of the candidates feed (loading / empty / error / success).
public enum UsersPanelState: Sendable, Equatable {
    case openMode
    case loading
    case empty
    case error(String)
    case loaded([ImpersonationSubject])
}

// MARK: - Row status relay (fans the page status into each embedded row button)

/// An `ImpersonationStatusProviding` the page feeds: it forwards the page's resolved status to one
/// embedded `UserImpersonateButton`, so a row disables itself the moment a session becomes active
/// — the native parity of the web `disabled={active}` prop, kept live rather than snapshot.
@MainActor
public final class UsersRowStatusRelay: ImpersonationStatusProviding {
    public var onStatus: (@MainActor (ImpersonationStatusEvent) -> Void)?
    private var last: ImpersonationStatusEvent

    public init(initial: ImpersonationStatusEvent = .loading) {
        last = initial
    }

    public func load() {
        onStatus?(last)
    }

    public func refresh() {
        onStatus?(last)
    }

    /// Delivers the page's latest status to the bound row button and remembers it for a later
    /// `load()` (the button's on-appear status mount).
    func deliver(_ event: ImpersonationStatusEvent) {
        last = event
        onStatus?(event)
    }
}
