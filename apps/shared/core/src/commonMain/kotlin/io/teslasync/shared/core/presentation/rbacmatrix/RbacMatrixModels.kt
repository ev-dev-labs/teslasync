package io.teslasync.shared.core.presentation.rbacmatrix

import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * One RBAC permission — the cross-platform port of the web `RbacPermission` interface
 * (web/src/api/types.ts). [id] is the stable permission key the grant map is indexed by; [name] is
 * the matrix-row label (currently identical to [id]); [category] groups permissions into the
 * column sections the SPA renders. No field is display-unit-bearing, so it round-trips verbatim
 * with no SI conversion (S5).
 */
@Serializable
public data class RbacPermission(
    @SerialName("id") public val id: String,
    @SerialName("name") public val name: String,
    @SerialName("category") public val category: String,
)

/**
 * One RBAC role identity — the cross-platform port of the web `RbacRole` interface
 * (web/src/api/types.ts). [id] is the upstream proxy group name verbatim (or the implicit `user`
 * default when no groups header is configured); [name] is the matrix-column label, currently
 * identical to [id] but split out so a future display-label pass does not break the contract.
 */
@Serializable
public data class RbacRole(
    @SerialName("id") public val id: String,
    @SerialName("name") public val name: String,
)

/**
 * A single changed `(role, permission, allowed)` binding in a `PUT /admin/rbac/matrix` batch — the
 * cross-platform port of the web `RbacUpsertCell` interface (web/src/api/types.ts). The SPA sends
 * only the cells the operator actually toggled (the backend caps a request at
 * `MaxRBACUpsertCells` = 1000), so realistic payloads are tiny. Serialized to
 * `{"role_id":…,"permission_id":…,"allowed":…}` byte-for-byte with the web `JSON.stringify` body.
 */
@Serializable
public data class RbacUpsertCell(
    @SerialName("role_id") public val roleId: String,
    @SerialName("permission_id") public val permissionId: String,
    @SerialName("allowed") public val allowed: Boolean,
)

/**
 * The `PUT /admin/rbac/matrix` request body — the port of the web `RbacUpsertRequest` interface
 * (web/src/api/types.ts): a single [cells] array (the backend treats an empty batch as a no-op).
 */
@Serializable
public data class RbacUpsertRequest(
    @SerialName("cells") public val cells: List<RbacUpsertCell>,
)

/**
 * The forward-auth session payload of `GET /admin/rbac/matrix` — the port of the web
 * `RbacMatrixSessionResponse` interface (web/src/api/types.ts). Decoded directly from the server
 * envelope when `mode` is not `open`.
 *
 * [matrix]`[role_id][perm_id]` is `true` when the role grants the permission; a missing role row OR
 * a missing permission cell within a row both mean "no opinion → deny". [effectiveForMe] is the
 * merged grant map for the calling subject across [myRoles] — the SPA renders it as a "what I can do
 * right now" pill. [groupsHeaderName] is the configured proxy groups-header name (absent when no
 * groups header is configured). Every collection defaults to empty and the header to `null` so a
 * payload that omits a key decodes to the safe value rather than failing the whole read.
 *
 * @property mode the verbatim wire discriminator; always `session` for this variant.
 * @property roles the matrix columns (one per known role).
 * @property permissions the matrix rows (one per application permission).
 * @property categories the ordered permission-category section labels.
 * @property matrix the `role_id → permission_id → allowed` grant map.
 * @property effectiveForMe the caller's merged grant map across [myRoles].
 * @property myRoles the caller's own role ids.
 * @property groupsHeaderName the configured proxy groups-header name, or `null`.
 */
@Serializable
public data class RbacMatrixSession(
    @SerialName("mode") public val mode: String = RbacMatrixResponse.SESSION,
    @SerialName("roles") public val roles: List<RbacRole> = emptyList(),
    @SerialName("permissions") public val permissions: List<RbacPermission> = emptyList(),
    @SerialName("categories") public val categories: List<String> = emptyList(),
    @SerialName("matrix") public val matrix: Map<String, Map<String, Boolean>> = emptyMap(),
    @SerialName("effective_for_me") public val effectiveForMe: Map<String, Boolean> = emptyMap(),
    @SerialName("my_roles") public val myRoles: List<String> = emptyList(),
    @SerialName("groups_header_name") public val groupsHeaderName: String? = null,
) : RbacMatrixResponse {
    override val modeDiscriminator: String get() = mode
}

/**
 * The discriminated `GET /admin/rbac/matrix` result — the cross-platform port of the web
 * `RbacMatrixResponse` union (web/src/api/types.ts), surfaced by `useRbacMatrix`
 * (web/src/api/hooks/useRbacMatrix.ts).
 *
 *  - [Open] mirrors `{ mode: 'open' }`: the deployment runs in open (no-forward-auth) mode, where
 *    the matrix endpoint answers `501 AUTH_MODE_OPEN`. The web hook normalises that 501 into this
 *    value so the page renders its "feature requires forward-auth" empty state without treating it
 *    as an error; the data layer reproduces that by mapping the `AUTH_MODE_OPEN` code to an open
 *    sentinel that reads as a successful no-op.
 *  - [RbacMatrixSession] mirrors `{ mode: 'session', … }`: the full matrix document.
 *
 * The `mode` string is the discriminator, matched (not enum-decoded) exactly as the web union
 * compares against the literals, so an unknown/future mode degrades to the safe session rendering
 * rather than failing the read. No field is display-unit-bearing, so values round-trip verbatim
 * with no SI conversion (S5).
 */
public sealed interface RbacMatrixResponse {
    /** The verbatim wire discriminator (`open` | `session`). */
    public val modeDiscriminator: String

    /** Open (no-forward-auth) deployment: the RBAC matrix is unavailable. */
    public data object Open : RbacMatrixResponse {
        override val modeDiscriminator: String get() = OPEN
    }

    public companion object {
        public const val OPEN: String = "open"
        public const val SESSION: String = "session"
    }
}

/**
 * Pure, side-effect-free derivations ported from the web `useRbacMatrix` hook domain
 * (web/src/api/hooks/useRbacMatrix.ts). Extracted so the KMP data port, its golden vectors, and the
 * future Windows C# port all derive identically (ADR-004) and can never drift.
 *
 * [matrix] parses the raw server envelope into the discriminated [RbacMatrixResponse]; [isOpenMode]
 * is the web `isRbacOpenMode` predicate; [diffMatrices] is the web `diffMatrices` snapshot-diff that
 * computes the minimal `(role, permission, allowed)` upsert batch. Every parser is total — a missing
 * or malformed envelope degrades to the safe value (an empty session) rather than throwing.
 */
public object RbacMatrixDerivations {
    /**
     * The sentinel error `code` the backend returns (inside a `501`) for the matrix endpoint in open
     * mode — mirrored verbatim from `auth.AuthModeOpenCode` so the data layer matches it without
     * snake-vs-camel drift. Treated as "feature unavailable", NOT an error: it is mapped to the open
     * sentinel that reads as a successful no-op.
     */
    public const val AUTH_MODE_OPEN_CODE: String = "AUTH_MODE_OPEN"

    private val json = defaultApiJson

    private val emptySession = RbacMatrixSession()

    /**
     * Parses the `GET /admin/rbac/matrix` envelope into a [RbacMatrixResponse]. An `open` mode
     * yields [RbacMatrixResponse.Open] (the web 501 → `{ mode: 'open' }` normalisation); anything
     * else is decoded into a [RbacMatrixSession] with every absent key defaulted to its safe empty
     * value — verbatim with the web `queryFn` returning the typed session body. A non-object or
     * malformed envelope degrades to an empty session rather than throwing, so a corrupt cache row
     * can never cancel the read.
     */
    public fun matrix(payload: JsonElement): RbacMatrixResponse {
        val obj = payload as? JsonObject ?: return emptySession
        if (modeOf(obj) == RbacMatrixResponse.OPEN) return RbacMatrixResponse.Open
        return try {
            json.decodeFromJsonElement(RbacMatrixSession.serializer(), obj)
        } catch (e: SerializationException) {
            emptySession
        }
    }

    /**
     * `true` when [response] is the open-mode value — the web `isRbacOpenMode`. A `null`
     * (not-yet-resolved) value is `false`, mirroring the web `data?.mode === 'open'`.
     */
    public fun isOpenMode(response: RbacMatrixResponse?): Boolean = response is RbacMatrixResponse.Open

    /**
     * Returns the cells whose `allowed` value changed between two matrix snapshots — verbatim with
     * the web `diffMatrices` (web/src/api/hooks/useRbacMatrix.ts). The role/permission key sets are
     * the UNION of both snapshots; a key present in only one snapshot defaults to `false` on the
     * missing side (the web `?? false`), so a removed row/cell that flips a previously-allowed grant
     * to denied is still emitted. Iteration order follows the union's encounter order
     * (`base` keys first, then any new `draft` keys), matching the web `Set` insertion order, so the
     * emitted batch is deterministic for fixed inputs.
     */
    public fun diffMatrices(
        base: Map<String, Map<String, Boolean>>,
        draft: Map<String, Map<String, Boolean>>,
    ): List<RbacUpsertCell> {
        val cells = mutableListOf<RbacUpsertCell>()
        val roleIds =
            LinkedHashSet<String>().apply {
                addAll(base.keys)
                addAll(draft.keys)
            }
        for (roleId in roleIds) {
            val baseRow = base[roleId] ?: emptyMap()
            val draftRow = draft[roleId] ?: emptyMap()
            val permIds =
                LinkedHashSet<String>().apply {
                    addAll(baseRow.keys)
                    addAll(draftRow.keys)
                }
            for (permId in permIds) {
                val baseAllowed = baseRow[permId] ?: false
                val draftAllowed = draftRow[permId] ?: false
                if (baseAllowed != draftAllowed) {
                    cells += RbacUpsertCell(roleId = roleId, permissionId = permId, allowed = draftAllowed)
                }
            }
        }
        return cells
    }

    private fun modeOf(obj: JsonObject): String? = (obj["mode"] as? JsonPrimitive)?.contentOrNull
}
