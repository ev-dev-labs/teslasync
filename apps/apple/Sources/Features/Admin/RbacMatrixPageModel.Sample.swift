import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleFeatureFlagsDataSource`) and so Edit → toggle → Save visibly mutates the matrix in
/// previews. An `actor` so its mutable state stays isolated + `Sendable` (the upserts the
/// page drives are real). Production replaces it with the RBAC adapter over the shared core.
public actor SampleRbacMatrixDataSource: RbacMatrixDataSource {
    private var matrix: [String: [String: Bool]]

    public init() {
        matrix = Self.seedMatrix
    }

    public func loadMatrix() async throws -> RbacMatrixResult {
        .session(RbacMatrixSession(
            roles: Self.seedRoles,
            permissions: Self.seedPermissions,
            categories: Self.seedCategories,
            matrix: matrix,
            effectiveForMe: Self.seedEffectiveForMe,
            myRoles: Self.seedMyRoles,
            groupsHeaderName: "X-Forwarded-Groups"
        ))
    }

    public func upsertCells(_ cells: [RbacUpsertCell]) async throws {
        for cell in cells {
            var row = matrix[cell.roleID] ?? [:]
            row[cell.permissionID] = cell.allowed
            matrix[cell.roleID] = row
        }
    }

    static let seedRoles: [RbacRole] = [
        RbacRole(id: "admin", name: "admin"),
        RbacRole(id: "operator", name: "operator"),
        RbacRole(id: "viewer", name: "viewer")
    ]

    static let seedCategories = ["fleet", "commands", "automation", "notifications", "admin"]

    static let seedPermissions: [RbacPermission] = [
        RbacPermission(id: "fleet.read", name: "Read fleet state", category: "fleet"),
        RbacPermission(id: "fleet.export", name: "Export fleet data", category: "fleet"),
        RbacPermission(id: "commands.send", name: "Send vehicle commands", category: "commands"),
        RbacPermission(id: "commands.unlock", name: "Unlock vehicles", category: "commands"),
        RbacPermission(id: "automation.manage", name: "Manage automations", category: "automation"),
        RbacPermission(id: "notifications.manage", name: "Manage alert rules", category: "notifications"),
        RbacPermission(id: "admin.rbac", name: "Edit RBAC matrix", category: "admin")
    ]

    static let seedMyRoles = ["admin"]

    static let seedEffectiveForMe: [String: Bool] = [
        "fleet.read": true,
        "fleet.export": true,
        "commands.send": true,
        "commands.unlock": true,
        "automation.manage": true,
        "notifications.manage": true,
        "admin.rbac": true
    ]

    static let seedMatrix: [String: [String: Bool]] = [
        "admin": [
            "fleet.read": true,
            "fleet.export": true,
            "commands.send": true,
            "commands.unlock": true,
            "automation.manage": true,
            "notifications.manage": true,
            "admin.rbac": true
        ],
        "operator": [
            "fleet.read": true,
            "fleet.export": true,
            "commands.send": true,
            "commands.unlock": false,
            "automation.manage": true,
            "notifications.manage": true,
            "admin.rbac": false
        ],
        "viewer": [
            "fleet.read": true,
            "fleet.export": false,
            "commands.send": false,
            "commands.unlock": false,
            "automation.manage": false,
            "notifications.manage": false,
            "admin.rbac": false
        ]
    ]
}
