import XCTest
@testable import TeslaSync

/// State-machine tests for `APIKeysPageModel` — every data state the page renders (loading
/// / empty / error / success), the create flow (reveal-on-success / keep-form-on-failure /
/// name-gating), the delete flow (clear-on-success / keep-open-on-failure / guarded cancel),
/// the revoke flow, the `isExpired` predicate, the permission wire fallback, and the
/// display-boundary `formatDate` ported from the web.
@MainActor
final class APIKeysPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: APIKeysDataSource {
        private(set) var keys: [APIKeyEntry]
        private let failLoad: Bool
        private let failCreate: Bool
        private let failDelete: Bool
        private let failRevoke: Bool
        private(set) var createCount = 0
        private(set) var deleteCount = 0
        private(set) var revokeCount = 0

        init(
            keys: [APIKeyEntry] = [],
            failLoad: Bool = false,
            failCreate: Bool = false,
            failDelete: Bool = false,
            failRevoke: Bool = false
        ) {
            self.keys = keys
            self.failLoad = failLoad
            self.failCreate = failCreate
            self.failDelete = failDelete
            self.failRevoke = failRevoke
        }

        func loadKeys() async throws -> [APIKeyEntry] {
            if failLoad { throw StubError() }
            return keys
        }

        func createKey(name: String, permissions: APIKeyPermission) async throws -> CreatedAPIKey {
            createCount += 1
            if failCreate { throw StubError() }
            let entry = APIKeyEntry(
                id: "new_\(createCount)",
                name: name,
                keyPrefix: "tsk_live_new",
                permissions: permissions,
                createdAt: "2026-06-14T12:00:00Z"
            )
            keys.insert(entry, at: 0)
            return CreatedAPIKey(entry: entry, key: "tsk_live_secret_token")
        }

        func deleteKey(id: String) async throws {
            deleteCount += 1
            if failDelete { throw StubError() }
            keys.removeAll { $0.id == id }
        }

        func revokeKey(id _: String) async throws {
            revokeCount += 1
            if failRevoke { throw StubError() }
        }
    }

    private func key(
        _ id: String,
        name: String = "App",
        permissions: APIKeyPermission = .read,
        expiresAt: String? = nil
    ) -> APIKeyEntry {
        APIKeyEntry(
            id: id,
            name: name,
            keyPrefix: "tsk_live_\(id)",
            permissions: permissions,
            createdAt: "2026-05-01T12:00:00Z",
            lastUsedAt: nil,
            expiresAt: expiresAt
        )
    }

    // MARK: - List states

    func testInitialStateIsLoading() {
        let model = APIKeysPageModel(dataSource: StubSource())
        XCTAssertEqual(model.listState, .loading)
        XCTAssertTrue(model.keys.isEmpty)
    }

    func testLoadSuccessPopulatesRows() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: [key("a"), key("b")]))
        await model.load()
        XCTAssertEqual(model.keys.count, 2)
        if case .loaded = model.listState {} else { XCTFail("expected loaded") }
    }

    func testLoadEmptySourceShowsEmpty() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: []))
        await model.load()
        XCTAssertEqual(model.listState, .empty)
    }

    func testLoadFailureShowsError() async {
        let model = APIKeysPageModel(dataSource: StubSource(failLoad: true))
        await model.load()
        if case .error = model.listState {} else { XCTFail("expected error") }
    }

    func testLoadIsNoOpOnceLoaded() async {
        let source = StubSource(keys: [key("a")])
        let model = APIKeysPageModel(dataSource: source)
        await model.load()
        await model.load() // guarded: should not reload
        XCTAssertEqual(model.keys.count, 1)
    }

    // MARK: - isExpired

    func testIsExpiredPredicate() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-06-14T00:00:00Z"))
        XCTAssertTrue(key("x", expiresAt: "2026-06-01T00:00:00Z").isExpired(now: now))
        XCTAssertFalse(key("x", expiresAt: "2026-07-01T00:00:00Z").isExpired(now: now))
        XCTAssertFalse(key("x", expiresAt: nil).isExpired(now: now))
    }

    func testModelIsExpiredUsesInjectedClock() async throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-06-14T00:00:00Z"))
        let model = APIKeysPageModel(
            dataSource: StubSource(keys: [key("legacy", expiresAt: "2026-01-01T00:00:00Z")]),
            now: { now }
        )
        await model.load()
        XCTAssertTrue(model.isExpired(model.keys[0]))
    }

    // MARK: - Create

    func testBeginCreateResetsForm() {
        let model = APIKeysPageModel(dataSource: StubSource())
        model.newName = "stale"
        model.beginCreate()
        XCTAssertTrue(model.createPresented)
        XCTAssertEqual(model.newName, "")
        XCTAssertEqual(model.newPermission, .read)
        XCTAssertFalse(model.hasGeneratedKey)
    }

    func testCanGenerateRequiresName() {
        let model = APIKeysPageModel(dataSource: StubSource())
        XCTAssertFalse(model.canGenerate)
        model.newName = "   "
        XCTAssertFalse(model.canGenerate)
        model.newName = "My App"
        XCTAssertTrue(model.canGenerate)
    }

    func testGenerateSuccessRevealsKeyAndReloads() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: []))
        await model.load()
        model.beginCreate()
        model.newName = "CI Token"
        model.newPermission = .readWrite
        await model.generate()
        XCTAssertEqual(model.generatedKey, "tsk_live_secret_token")
        XCTAssertTrue(model.hasGeneratedKey)
        XCTAssertEqual(model.newName, "") // cleared on success
        XCTAssertEqual(model.keys.count, 1) // list reloaded with the new key
        XCTAssertTrue(model.createPresented) // stays open on the reveal
    }

    func testGenerateFailureKeepsFormWithError() async {
        let model = APIKeysPageModel(dataSource: StubSource(failCreate: true))
        model.beginCreate()
        model.newName = "Doomed"
        await model.generate()
        XCTAssertNil(model.generatedKey)
        XCTAssertNotNil(model.createError)
        XCTAssertEqual(model.newName, "Doomed") // not cleared on failure
        XCTAssertTrue(model.createPresented)
    }

    func testCloseCreateClearsSecret() async {
        let model = APIKeysPageModel(dataSource: StubSource())
        model.beginCreate()
        model.newName = "Tmp"
        await model.generate()
        model.closeCreate()
        XCTAssertFalse(model.createPresented)
        XCTAssertNil(model.generatedKey)
    }

    // MARK: - Delete

    func testAskDeleteSetsTarget() {
        let model = APIKeysPageModel(dataSource: StubSource())
        model.askDelete(key("a"))
        XCTAssertEqual(model.deleteTarget?.id, "a")
    }

    func testConfirmDeleteSuccessClearsTargetAndReloads() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: [key("a"), key("b")]))
        await model.load()
        model.askDelete(model.keys[0])
        await model.confirmDelete()
        XCTAssertNil(model.deleteTarget)
        XCTAssertEqual(model.keys.count, 1)
    }

    func testConfirmDeleteFailureKeepsTargetWithError() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: [key("a")], failDelete: true))
        await model.load()
        model.askDelete(model.keys[0])
        await model.confirmDelete()
        XCTAssertEqual(model.deleteTarget?.id, "a")
        XCTAssertNotNil(model.deleteError)
    }

    func testCancelDeleteClearsTarget() {
        let model = APIKeysPageModel(dataSource: StubSource())
        model.askDelete(key("a"))
        model.cancelDelete()
        XCTAssertNil(model.deleteTarget)
    }

    // MARK: - Revoke

    func testRevokeInvokesSourceAndReloads() async {
        let source = StubSource(keys: [key("a")])
        let model = APIKeysPageModel(dataSource: source)
        await model.load()
        await model.revoke(model.keys[0])
        let count = await source.revokeCount
        XCTAssertEqual(count, 1)
        XCTAssertNil(model.revokingID)
    }

    func testRevokeFailureSetsError() async {
        let model = APIKeysPageModel(dataSource: StubSource(keys: [key("a")], failRevoke: true))
        await model.load()
        await model.revoke(model.keys[0])
        XCTAssertNotNil(model.revokeError)
        XCTAssertNil(model.revokingID)
    }

    // MARK: - Permission wire fallback (web `cfg[perm] ?? cfg.read`)

    func testPermissionWireFallback() {
        XCTAssertEqual(APIKeyPermission(wire: "read"), .read)
        XCTAssertEqual(APIKeyPermission(wire: "read-write"), .readWrite)
        XCTAssertEqual(APIKeyPermission(wire: "admin"), .admin)
        XCTAssertEqual(APIKeyPermission(wire: "nonsense"), .read)
    }

    // MARK: - Display formatter (web `formatDate`)

    func testFormatDate() {
        XCTAssertEqual(APIKeysFormat.date(nil), "—")
        XCTAssertEqual(APIKeysFormat.date("not-a-date"), "—")
        let formatted = APIKeysFormat.date("2026-06-14T12:00:00Z")
        XCTAssertNotEqual(formatted, "—")
        XCTAssertTrue(formatted.contains("2026"))
    }

    // MARK: - Delete message interpolation (web `{{name}}`)

    func testDeleteMessageInterpolatesName() {
        let message = APIKeysPage.deleteMessage(for: "Production Dashboard")
        XCTAssertTrue(message.contains("Production Dashboard"))
        XCTAssertFalse(message.contains("{{name}}"))
    }
}
