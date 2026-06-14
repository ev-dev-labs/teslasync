import XCTest
@testable import TeslaSync

/// State-machine tests for `UsersPageModel` — the native parity holder for the admin "Subjects"
/// impersonation page (`web/src/features/admin/pages/UsersPage.tsx`). Covers every data state the
/// single panel renders (loading / empty / error / success), the open-mode override (web
/// `isImpersonationOpenMode`), the active-session gate fanned into each embedded row button (web
/// `disabled={active}`), and the candidates retry.
@MainActor
final class UsersPageModelTests: XCTestCase {
    private func restricted(active: String? = nil) -> ImpersonationStatusEvent {
        .loaded(ImpersonationStatus(mode: .restricted, activeSubject: active))
    }

    private func make(
        status: ImpersonationStatusEvent,
        candidates: UsersCandidatesEvent
    ) -> UsersPageModel {
        UsersPageModel(
            statusProvider: InMemoryImpersonationStatusProvider(initial: status),
            candidatesProvider: InMemoryUsersCandidatesProvider(initial: candidates)
        )
    }

    private let seed = SampleUsersData.subjects

    // MARK: - Initial state

    func testInitialStateIsLoading() {
        let model = make(status: .loading, candidates: .loading)
        XCTAssertEqual(model.panelState, .loading)
        XCTAssertFalse(model.isOpenMode)
        XCTAssertFalse(model.isActive)
        XCTAssertTrue(model.subjects.isEmpty)
    }

    // MARK: - Success

    func testLoadSuccessPopulatesSubjects() {
        let model = make(status: restricted(), candidates: .loaded(seed))
        model.load()
        XCTAssertEqual(model.panelState, .loaded(seed))
        XCTAssertEqual(model.subjects, seed)
        XCTAssertFalse(model.isOpenMode)
        XCTAssertFalse(model.isActive)
    }

    // MARK: - Empty

    func testEmptyCandidatesYieldsEmptyState() {
        let model = make(status: restricted(), candidates: .loaded([]))
        model.load()
        XCTAssertEqual(model.panelState, .empty)
        XCTAssertTrue(model.subjects.isEmpty)
    }

    func testCandidatesOpenSentinelYieldsEmptyState() {
        let model = make(status: restricted(), candidates: .openMode)
        model.load()
        XCTAssertEqual(model.panelState, .empty)
    }

    // MARK: - Error

    func testCandidatesFailureYieldsErrorState() {
        let model = make(status: restricted(), candidates: .failed(message: "boom"))
        model.load()
        XCTAssertEqual(model.panelState, .error("boom"))
    }

    func testRetryCandidatesShowsLoadingThenRefetches() {
        let candidates = InMemoryUsersCandidatesProvider(
            initial: .failed(message: "boom"),
            refreshed: .loaded(seed)
        )
        let model = UsersPageModel(
            statusProvider: InMemoryImpersonationStatusProvider(initial: restricted()),
            candidatesProvider: candidates
        )
        model.load()
        XCTAssertEqual(model.panelState, .error("boom"))
        model.retryCandidates()
        XCTAssertEqual(model.panelState, .loaded(seed))
        XCTAssertEqual(candidates.refreshCount, 1)
    }

    // MARK: - Open mode (web `isImpersonationOpenMode` override)

    func testOpenModeOverridesCandidates() {
        let model = make(status: .loaded(ImpersonationStatus(mode: .open)), candidates: .loaded(seed))
        model.load()
        XCTAssertTrue(model.isOpenMode)
        XCTAssertEqual(model.panelState, .openMode)
    }

    func testOpenModeIsFalseWhileStatusLoading() {
        let model = make(status: .loading, candidates: .loaded(seed))
        model.load()
        XCTAssertFalse(model.isOpenMode)
        XCTAssertEqual(model.panelState, .loaded(seed))
    }

    // MARK: - Active gate (web `disabled={active}` fanned into each row)

    func testActiveStatusDisablesRowButtons() {
        let status = InMemoryImpersonationStatusProvider(initial: restricted())
        let model = UsersPageModel(
            statusProvider: status,
            candidatesProvider: InMemoryUsersCandidatesProvider(initial: .loaded(seed))
        )
        model.load()
        let row = model.rowModel(for: seed[0].subject)
        row.start()
        XCTAssertEqual(row.availability, .available)
        XCTAssertTrue(row.canStart)

        status.push(.loaded(ImpersonationStatus(mode: .restricted, activeSubject: "ak-other-admin")))
        XCTAssertTrue(model.isActive)
        XCTAssertEqual(row.availability, .alreadyActive(subject: "ak-other-admin"))
        XCTAssertFalse(row.canStart)
    }

    func testRowModelIsMemoisedPerSubject() {
        let model = make(status: restricted(), candidates: .loaded(seed))
        model.load()
        let first = model.rowModel(for: seed[0].subject)
        let again = model.rowModel(for: seed[0].subject)
        XCTAssertTrue(first === again)
    }

    func testRowModelCarriesSubjectIdentity() {
        let model = make(status: restricted(), candidates: .loaded(seed))
        model.load()
        let row = model.rowModel(for: seed[1].subject)
        XCTAssertEqual(row.subject, seed[1].subject)
    }
}
