import Foundation

// MARK: - Wire value types (web `RbacRole` / `RbacPermission` / `RbacMatrixSessionResponse`)

/// One RBAC role — the native peer of the web `RbacRole` (`internal/api/rbac/handler.go`).
/// `id` is the upstream proxy group name verbatim (or the implicit `user` default); `name`
/// is the matrix-column label. Role/permission metadata is control-plane data — no SI units.
public struct RbacRole: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// One RBAC permission catalog entry (web `RbacPermission`). `id` is a stable, lowercase,
/// dotted string (e.g. `fleet.read`); the matrix groups rows by `category` and renders
/// `name` as the user-visible label.
public struct RbacPermission: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let category: String

    public init(id: String, name: String, category: String) {
        self.id = id
        self.name = name
        self.category = category
    }
}

/// The session matrix payload (web `RbacMatrixSessionResponse`). `matrix[roleID][permID]`
/// is true when the role grants the permission; a missing row or cell both mean "deny".
/// `effectiveForMe` is the merged grant map for the calling subject across `myRoles`.
public struct RbacMatrixSession: Equatable, Sendable {
    public let roles: [RbacRole]
    public let permissions: [RbacPermission]
    public let categories: [String]
    public let matrix: [String: [String: Bool]]
    public let effectiveForMe: [String: Bool]
    public let myRoles: [String]
    public let groupsHeaderName: String?

    public init(
        roles: [RbacRole],
        permissions: [RbacPermission],
        categories: [String],
        matrix: [String: [String: Bool]],
        effectiveForMe: [String: Bool],
        myRoles: [String],
        groupsHeaderName: String? = nil
    ) {
        self.roles = roles
        self.permissions = permissions
        self.categories = categories
        self.matrix = matrix
        self.effectiveForMe = effectiveForMe
        self.myRoles = myRoles
        self.groupsHeaderName = groupsHeaderName
    }

    /// Web `Object.values(effective_for_me).filter(Boolean).length`.
    public var effectiveAllowedCount: Int {
        effectiveForMe.values.count(where: { $0 })
    }

    /// Web `payload.permissions.length` (the effective-pill denominator).
    public var permissionCount: Int {
        permissions.count
    }
}

/// One cell in a `PUT /admin/rbac/matrix` batch (web `RbacUpsertCell`). The SPA sends only
/// the cells the operator actually toggled, so realistic payloads are tiny.
public struct RbacUpsertCell: Hashable, Sendable {
    public let roleID: String
    public let permissionID: String
    public let allowed: Bool

    public init(roleID: String, permissionID: String, allowed: Bool) {
        self.roleID = roleID
        self.permissionID = permissionID
        self.allowed = allowed
    }
}

/// One ordered permission category bucket (web `permsByCategory` + `orderedCategories`):
/// the category key (rendered via `rbac.category.{cat}` with a raw fallback) and its rows.
public struct RbacPermissionGroup: Identifiable, Equatable, Sendable {
    public let category: String
    public let permissions: [RbacPermission]

    public var id: String {
        category
    }

    public init(category: String, permissions: [RbacPermission]) {
        self.category = category
        self.permissions = permissions
    }
}

// MARK: - Data source seam (web `useRbacMatrix` / `useUpsertRbacCells`)

/// The result of the matrix query (web `RbacMatrixResponse`): either a session payload or
/// the synthetic open-mode envelope the hook substitutes for the backend `AUTH_MODE_OPEN`
/// sentinel, so the page renders the forward-auth notice instead of a query failure.
public enum RbacMatrixResult: Equatable, Sendable {
    case session(RbacMatrixSession)
    case openMode
}

/// A matrix endpoint error carrying the optional API `code` (web `isApiError(err) ? err.code`)
/// so the page can surface the code, falling back to the generic copy when absent.
public struct RbacApiError: Error, Equatable, Sendable {
    public let code: String?

    public init(code: String? = nil) {
        self.code = code
    }
}

/// Supplies the matrix feed and performs the sudo-gated cell upserts the page drives. The
/// production implementation binds the shared KMP RBAC endpoints (`GET`/`PUT
/// /admin/rbac/matrix`, ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive every data state. Mirrors the sibling `FeatureFlagsDataSource` seam.
public protocol RbacMatrixDataSource: Sendable {
    /// Web `useRbacMatrix → GET /admin/rbac/matrix` (open-mode mapped to `.openMode`).
    func loadMatrix() async throws -> RbacMatrixResult
    /// Web `useUpsertRbacCells → PUT /admin/rbac/matrix`.
    func upsertCells(_ cells: [RbacUpsertCell]) async throws
}

// MARK: - Page state (web `matrixQuery` phases + AUTH_MODE_OPEN branch)

/// The single query state driving the whole page (web `matrixQuery`): `.openMode` is the
/// forward-auth notice, `.empty` is a successful load with zero roles, `.error` carries
/// the optional API code, `.loaded` carries a populated session.
public enum RbacMatrixState: Equatable, Sendable {
    case loading
    case openMode
    case error(String?)
    case empty
    case loaded(RbacMatrixSession)
}

// MARK: - Pure matrix logic (web `snapshotToDraft` / `diffMatrices` / `isRbacOpenMode` / `permsByCategory`)

/// The page's pure, testable matrix algebra ported 1:1 from the web module functions. Kept
/// vendor-agnostic + `Sendable`-free of UI so the model and tests share one source of truth.
public enum RbacMatrix {
    /// Web `snapshotToDraft` — a deep copy of the server matrix so editing never mutates the
    /// snapshot the dirty-diff is computed against.
    public static func snapshotToDraft(_ matrix: [String: [String: Bool]]) -> [String: [String: Bool]] {
        var cells: [String: [String: Bool]] = [:]
        for (roleID, row) in matrix {
            cells[roleID] = row
        }
        return cells
    }

    /// Web `diffMatrices` — the cells whose `allowed` value changed between two snapshots. A
    /// missing row/cell on either side reads as `false`. Sorted for deterministic batches.
    public static func diffMatrices(
        base: [String: [String: Bool]],
        draft: [String: [String: Bool]]
    ) -> [RbacUpsertCell] {
        var cells: [RbacUpsertCell] = []
        let roleIDs = Set(base.keys).union(draft.keys)
        for roleID in roleIDs {
            let baseRow = base[roleID] ?? [:]
            let draftRow = draft[roleID] ?? [:]
            let permIDs = Set(baseRow.keys).union(draftRow.keys)
            for permID in permIDs where (baseRow[permID] ?? false) != (draftRow[permID] ?? false) {
                cells.append(RbacUpsertCell(roleID: roleID, permissionID: permID, allowed: draftRow[permID] ?? false))
            }
        }
        return cells.sorted { lhs, rhs in
            lhs.roleID == rhs.roleID ? lhs.permissionID < rhs.permissionID : lhs.roleID < rhs.roleID
        }
    }

    /// Web `isRbacOpenMode` — narrows the open-mode envelope from the matrix query result.
    public static func isRbacOpenMode(_ result: RbacMatrixResult) -> Bool {
        if case .openMode = result {
            return true
        }
        return false
    }

    /// Web `permsByCategory` + `orderedCategories` — permissions grouped into the payload's
    /// declared category order (falling back to first-seen order), dropping empty buckets.
    public static func groupedPermissions(_ session: RbacMatrixSession) -> [RbacPermissionGroup] {
        var byCategory: [String: [RbacPermission]] = [:]
        var firstSeen: [String] = []
        for perm in session.permissions {
            if byCategory[perm.category] == nil {
                firstSeen.append(perm.category)
            }
            byCategory[perm.category, default: []].append(perm)
        }
        let ordered = session.categories.isEmpty ? firstSeen : session.categories
        return ordered.compactMap { category in
            let items = byCategory[category] ?? []
            return items.isEmpty ? nil : RbacPermissionGroup(category: category, permissions: items)
        }
    }
}
