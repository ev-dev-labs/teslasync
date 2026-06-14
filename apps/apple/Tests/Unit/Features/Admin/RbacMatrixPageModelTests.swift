import SwiftUI
import XCTest
@testable import TeslaSync

/// State-machine tests for `RbacMatrixPageModel` — every data state the page renders
/// (loading / open-mode / empty / error / loaded), the read-only⇄edit toggle + draft
/// algebra, the dirty-diff save (success + failure), and the pure matrix logic ported from
/// the web (`snapshotToDraft` / `diffMatrices` / `isRbacOpenMode` / `permsByCategory`).
/// Mirrors the sibling `FeatureFlagsPageModelTests`.
@MainActor final class RbacMatrixPageModelTests: XCTestCase {
    private actor StubSource: RbacMatrixDataSource {
        private var matrix: [String: [String: Bool]]
        private let roles: [RbacRole]
        private let permissions: [RbacPermission]
        private let openMode: Bool
        private let loadFails: Bool
        private let loadCode: String?
        private let upsertFails: Bool
        private let upsertCode: String?
        private(set) var upserts: [[RbacUpsertCell]] = []

        init(
            roles: [RbacRole] = [],
            permissions: [RbacPermission] = [],
            matrix: [String: [String: Bool]] = [:],
            openMode: Bool = false,
            loadFails: Bool = false,
            loadCode: String? = nil,
            upsertFails: Bool = false,
            upsertCode: String? = nil
        ) {
            self.roles = roles
            self.permissions = permissions
            self.matrix = matrix
            self.openMode = openMode
            self.loadFails = loadFails
            self.loadCode = loadCode
            self.upsertFails = upsertFails
            self.upsertCode = upsertCode
        }

        func loadMatrix() async throws -> RbacMatrixResult {
            if loadFails { throw RbacApiError(code: loadCode) }
            if openMode { return .openMode }
            return .session(RbacMatrixSession(
                roles: roles,
                permissions: permissions,
                categories: [],
                matrix: matrix,
                effectiveForMe: ["a.read": true, "a.write": false],
                myRoles: ["admin"],
                groupsHeaderName: "X-Groups"
            ))
        }

        func upsertCells(_ cells: [RbacUpsertCell]) async throws {
            if upsertFails { throw RbacApiError(code: upsertCode) }
            upserts.append(cells)
            for cell in cells {
                var row = matrix[cell.roleID] ?? [:]
                row[cell.permissionID] = cell.allowed
                matrix[cell.roleID] = row
            }
        }
    }

    private static let roles = [RbacRole(id: "admin", name: "admin"), RbacRole(id: "viewer", name: "viewer")]
    private static let perms = [
        RbacPermission(id: "a.read", name: "Read", category: "a"),
        RbacPermission(id: "a.write", name: "Write", category: "a")
    ]
    private static let matrix: [String: [String: Bool]] = [
        "admin": ["a.read": true, "a.write": true],
        "viewer": ["a.read": true, "a.write": false]
    ]

    private func loadedModel() -> StubSource {
        StubSource(roles: Self.roles, permissions: Self.perms, matrix: Self.matrix)
    }

    // MARK: - Data states

    func testInitialStateIsLoading() {
        let model = RbacMatrixPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertNil(model.session)
        XCTAssertFalse(model.editing)
    }

    func testLoadOpenModeYieldsOpenModeState() async {
        let model = RbacMatrixPageModel(dataSource: StubSource(openMode: true))
        await model.load()
        XCTAssertEqual(model.state, .openMode)
    }

    func testLoadEmptyRosterYieldsEmptyState() async {
        let model = RbacMatrixPageModel(dataSource: StubSource(roles: [], permissions: []))
        await model.load()
        XCTAssertEqual(model.state, .empty)
    }

    func testLoadFailureYieldsErrorWithCode() async {
        let model = RbacMatrixPageModel(dataSource: StubSource(loadFails: true, loadCode: "INTERNAL"))
        await model.load()
        XCTAssertEqual(model.state, .error("INTERNAL"))
    }

    func testLoadSuccessSyncsDraftFromSnapshot() async {
        let model = RbacMatrixPageModel(dataSource: loadedModel())
        await model.load()
        guard case .loaded = model.state else { return XCTFail("expected loaded") }
        XCTAssertTrue(model.cellAllowed(roleID: "admin", permID: "a.write"))
        XCTAssertFalse(model.cellAllowed(roleID: "viewer", permID: "a.write"))
        XCTAssertEqual(model.dirtyCount, 0)
    }

    // MARK: - Editing + draft

    func testBeginEditSeedsDraftAndToggleTracksDirty() async {
        let model = RbacMatrixPageModel(dataSource: loadedModel())
        await model.load()
        model.beginEdit()
        XCTAssertTrue(model.editing)
        XCTAssertEqual(model.dirtyCount, 0)

        model.toggle(roleID: "viewer", permID: "a.write", allowed: true)
        XCTAssertTrue(model.cellAllowed(roleID: "viewer", permID: "a.write"))
        XCTAssertEqual(model.dirtyCount, 1)
        XCTAssertTrue(model.canSave)
        XCTAssertEqual(model.dirtyCells.first, RbacUpsertCell(roleID: "viewer", permissionID: "a.write", allowed: true))
    }

    func testCancelEditRestoresSnapshot() async {
        let model = RbacMatrixPageModel(dataSource: loadedModel())
        await model.load()
        model.beginEdit()
        model.toggle(roleID: "viewer", permID: "a.write", allowed: true)
        model.cancelEdit()
        XCTAssertFalse(model.editing)
        XCTAssertFalse(model.cellAllowed(roleID: "viewer", permID: "a.write"))
        XCTAssertEqual(model.dirtyCount, 0)
    }

    // MARK: - Saving

    func testSaveNoChangesExitsWithoutUpsert() async {
        let source = loadedModel()
        let model = RbacMatrixPageModel(dataSource: source)
        await model.load()
        model.beginEdit()
        await model.save()
        XCTAssertFalse(model.editing)
        let upserts = await source.upserts
        XCTAssertTrue(upserts.isEmpty)
    }

    func testSaveSuccessUpsertsDiffAndExitsEdit() async {
        let source = loadedModel()
        let model = RbacMatrixPageModel(dataSource: source)
        await model.load()
        model.beginEdit()
        model.toggle(roleID: "viewer", permID: "a.write", allowed: true)
        await model.save()
        XCTAssertFalse(model.editing)
        XCTAssertFalse(model.submitFailed)
        let upserts = await source.upserts
        XCTAssertEqual(upserts.count, 1)
        XCTAssertEqual(upserts.first?.first, RbacUpsertCell(roleID: "viewer", permissionID: "a.write", allowed: true))
        XCTAssertTrue(model.cellAllowed(roleID: "viewer", permID: "a.write"))
        XCTAssertEqual(model.dirtyCount, 0)
    }

    func testSaveFailureKeepsEditingAndSetsError() async {
        let source = StubSource(
            roles: Self.roles, permissions: Self.perms, matrix: Self.matrix,
            upsertFails: true, upsertCode: "RBAC_CONFLICT"
        )
        let model = RbacMatrixPageModel(dataSource: source)
        await model.load()
        model.beginEdit()
        model.toggle(roleID: "viewer", permID: "a.write", allowed: true)
        await model.save()
        XCTAssertTrue(model.editing)
        XCTAssertTrue(model.submitFailed)
        XCTAssertEqual(model.submitErrorCode, "RBAC_CONFLICT")
        XCTAssertFalse(model.isSaving)
    }
}

/// Pure matrix-algebra tests (split into an extension so the primary `XCTestCase` body stays
/// within the lint budget).
extension RbacMatrixPageModelTests {
    func testDiffMatricesDetectsChangesTreatingMissingAsFalse() {
        let base: [String: [String: Bool]] = ["r": ["p1": true, "p2": false]]
        let draft: [String: [String: Bool]] = ["r": ["p1": false, "p2": true], "r2": ["p3": true]]
        let cells = RbacMatrix.diffMatrices(base: base, draft: draft)
        XCTAssertEqual(cells.count, 3)
        // Deterministic ordering: sorted by role then permission.
        XCTAssertEqual(cells[0], RbacUpsertCell(roleID: "r", permissionID: "p1", allowed: false))
        XCTAssertEqual(cells[1], RbacUpsertCell(roleID: "r", permissionID: "p2", allowed: true))
        XCTAssertEqual(cells[2], RbacUpsertCell(roleID: "r2", permissionID: "p3", allowed: true))
    }

    func testSnapshotToDraftIsADeepCopy() {
        let matrix = ["r": ["p": true]]
        var draft = RbacMatrix.snapshotToDraft(matrix)
        draft["r"]?["p"] = false
        XCTAssertTrue(matrix["r"]?["p"] == true)
        XCTAssertEqual(RbacMatrix.diffMatrices(base: matrix, draft: draft).count, 1)
    }

    func testIsRbacOpenModeNarrowsEnvelope() {
        XCTAssertTrue(RbacMatrix.isRbacOpenMode(.openMode))
        let session = RbacMatrixSession(
            roles: [], permissions: [], categories: [], matrix: [:], effectiveForMe: [:], myRoles: []
        )
        XCTAssertFalse(RbacMatrix.isRbacOpenMode(.session(session)))
    }

    func testGroupedPermissionsRespectsCategoryOrderAndDropsEmpty() {
        let session = RbacMatrixSession(
            roles: [],
            permissions: [
                RbacPermission(id: "f.r", name: "Read", category: "fleet"),
                RbacPermission(id: "c.s", name: "Send", category: "commands"),
                RbacPermission(id: "f.w", name: "Write", category: "fleet")
            ],
            categories: ["commands", "fleet", "empty"],
            matrix: [:], effectiveForMe: [:], myRoles: []
        )
        let groups = RbacMatrix.groupedPermissions(session)
        XCTAssertEqual(groups.map(\.category), ["commands", "fleet"])
        XCTAssertEqual(groups[1].permissions.count, 2)
    }

    func testGroupedPermissionsFallsBackToFirstSeenOrder() {
        let session = RbacMatrixSession(
            roles: [],
            permissions: [
                RbacPermission(id: "b.x", name: "X", category: "beta"),
                RbacPermission(id: "a.y", name: "Y", category: "alpha")
            ],
            categories: [], matrix: [:], effectiveForMe: [:], myRoles: []
        )
        XCTAssertEqual(RbacMatrix.groupedPermissions(session).map(\.category), ["beta", "alpha"])
    }

    func testEffectiveAllowedCount() {
        let session = RbacMatrixSession(
            roles: [], permissions: [], categories: [], matrix: [:],
            effectiveForMe: ["a": true, "b": false, "c": true], myRoles: []
        )
        XCTAssertEqual(session.effectiveAllowedCount, 2)
    }

    func testCategoryLabelFallsBackToRawCategory() {
        XCTAssertEqual(rbacCategoryLabel("totally.unknown.category"), "totally.unknown.category")
    }

    func testSampleDataSourceSeedsAndUpserts() async throws {
        let source = SampleRbacMatrixDataSource()
        guard case let .session(session) = try await source.loadMatrix() else {
            return XCTFail("expected session")
        }
        XCTAssertFalse(session.roles.isEmpty)
        XCTAssertFalse(session.permissions.isEmpty)
        XCTAssertFalse(session.matrix.isEmpty)

        try await source.upsertCells([RbacUpsertCell(roleID: "viewer", permissionID: "fleet.export", allowed: true)])
        guard case let .session(updated) = try await source.loadMatrix() else {
            return XCTFail("expected session")
        }
        XCTAssertTrue(updated.matrix["viewer"]?["fleet.export"] == true)
    }
}
