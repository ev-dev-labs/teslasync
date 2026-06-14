import Foundation

/// In-memory candidates seam for previews + unit/UI tests — the candidates peer of
/// `InMemoryImpersonationStatusProvider`. Emits an optional canned event on `load()` (when
/// `autoEmits`) or is driven manually via `push(_:)` to script multi-step flows. The view never
/// performs I/O, so this stands in for the production `ImpersonationStore.candidates` feed.
@MainActor
public final class InMemoryUsersCandidatesProvider: UsersCandidatesProviding {
    public var onCandidates: (@MainActor (UsersCandidatesEvent) -> Void)?
    public private(set) var loadCount = 0
    public private(set) var refreshCount = 0

    private let initial: UsersCandidatesEvent?
    private let refreshed: UsersCandidatesEvent?
    private let autoEmits: Bool

    public init(
        initial: UsersCandidatesEvent? = nil,
        refreshed: UsersCandidatesEvent? = nil,
        autoEmits: Bool = true
    ) {
        self.initial = initial
        self.refreshed = refreshed
        self.autoEmits = autoEmits
    }

    public func load() {
        loadCount += 1
        if autoEmits, let initial { onCandidates?(initial) }
    }

    public func refresh() {
        refreshCount += 1
        if autoEmits, let event = refreshed ?? initial { onCandidates?(event) }
    }

    /// Delivers a candidates event to the bound model (deterministic test/preview affordance).
    public func push(_ event: UsersCandidatesEvent) {
        onCandidates?(event)
    }
}

// MARK: - Representative seed (NOT production telemetry)

/// A representative local seed used as the page/preview default until the KMP-backed seams are
/// injected at composition time (web `useImpersonationStatus` + `useImpersonationCandidates`). The
/// subjects are opaque proxy-issued identifiers exactly as the backend returns them — rendered
/// verbatim, monospaced, on the page. NOT production data.
public enum SampleUsersData {
    public static let subjects: [ImpersonationSubject] = [
        ImpersonationSubject(subject: "ak-7f3c1d28-9b04-4a51-8e6f-2c9d77a1be40"),
        ImpersonationSubject(subject: "ak-2a9e54b7-1c33-4df0-bb18-6e0a3f9c21d5"),
        ImpersonationSubject(subject: "ak-c61b08fa-4e72-49a8-9f3d-5b7e10c4d9a2")
    ]
}

// MARK: - Sample factory (route default + populated preview)

public extension UsersPageModel {
    /// The sample model used as the route default and the populated preview/snapshot. Seeds a
    /// forward-auth (restricted), inactive status plus a representative candidates list so the page
    /// renders its actionable populated state out of the box. Production composition replaces these
    /// with seams over the shared KMP `ImpersonationStore`.
    static func sample(
        status: ImpersonationStatus = ImpersonationStatus(mode: .restricted, activeSubject: nil),
        candidates: UsersCandidatesEvent = .loaded(SampleUsersData.subjects)
    ) -> UsersPageModel {
        UsersPageModel(
            statusProvider: InMemoryImpersonationStatusProvider(initial: .loaded(status)),
            candidatesProvider: InMemoryUsersCandidatesProvider(initial: candidates),
            makeRowStarter: { InMemoryImpersonationStarter(outcome: .started) }
        )
    }
}
