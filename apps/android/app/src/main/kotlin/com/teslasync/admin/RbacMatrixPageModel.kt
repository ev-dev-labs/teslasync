// Pure, framework-free model + derivations for the RbacMatrixPage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/RbacMatrixPage.tsx, the provider-agnostic "who can do what" matrix). No
// Compose, no Android framework, no HTTP lives here: every type is exercised off-device, keeping the
// composable a thin render layer.
//
// The matrix document arrives as the shared, already-decoded S8 payload
// (io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse — an Open | Session union the KMP
// core parses from `GET /admin/rbac/matrix`). So this file owns only the client-side derivations the web
// component does inline: the editable draft snapshot (web `snapshotToDraft`), the permission grouping +
// category ordering (web `permsByCategory` + `orderedCategories`), the "effective for me" tally (web
// `EffectivePill`), and the open-mode predicate re-exposed under the web name `isRbacOpenMode`. No RBAC
// field is unit-bearing (ids, names, a category string, booleans), so there is no SI conversion here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling FeedbackQueuePage / ApiLogsPage admin surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.rbac

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixDerivations
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixSession
import io.teslasync.shared.core.presentation.rbacmatrix.RbacPermission

/**
 * Canonical metadata for this surface. The web page is an admin route that is currently un-wired in
 * `web/src/App.tsx` (it has no canonical web path), so it is not a navigable [io.teslasync.android.navigation.Destination];
 * the native shell registers it directly by its stable [ROUTE_ID]. This object carries the cross-cutting
 * concerns the surface owes: the [ROUTE_ID] the host wires into the nav graph and the diagnostics [SLUG]
 * emitted with the one-shot `view.opened` event (P1/S11).
 */
object RbacMatrixRegistration {
    /** The native navigation destination id this surface registers under (no web route exists). */
    const val ROUTE_ID: String = "RbacMatrixPage"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RbacMatrixPage"
}

/**
 * The operator's in-progress edit of the matrix — `[role_id][perm_id] -> allowed`. Mirrors the web
 * `MatrixDraft` (which mirrors the server shape) so diffing the draft against the loaded snapshot stays a
 * straight delegation to the shared [RbacMatrixDerivations.diffMatrices]. Immutable: [toggled] returns a new
 * draft so Compose sees a fresh reference and recomposes only the changed cell's column.
 */
data class MatrixDraft(
    val cells: Map<String, Map<String, Boolean>> = emptyMap(),
) {
    /** Whether [roleId] grants [permId] in this draft; a missing row/cell reads as denied (web `?? false`). */
    fun isAllowed(
        roleId: String,
        permId: String,
    ): Boolean = cells[roleId]?.get(permId) ?: false

    /** Returns a copy with `[roleId][permId]` set to [next] (web `handleToggle`'s immutable row spread). */
    fun toggled(
        roleId: String,
        permId: String,
        next: Boolean,
    ): MatrixDraft {
        val row = cells[roleId].orEmpty().toMutableMap().apply { this[permId] = next }
        return copy(cells = cells.toMutableMap().apply { this[roleId] = row })
    }
}

/** Builds an editable [MatrixDraft] from a server snapshot, deep-copying each row (web `snapshotToDraft`). */
fun snapshotToDraft(matrix: Map<String, Map<String, Boolean>>): MatrixDraft =
    MatrixDraft(cells = matrix.mapValues { (_, row) -> row.toMap() })

/**
 * Groups permissions by their category, preserving first-seen order so the section order is deterministic —
 * the web `permsByCategory` (a `Map<category, permission[]>`).
 */
fun permsByCategory(permissions: List<RbacPermission>): Map<String, List<RbacPermission>> {
    val out = LinkedHashMap<String, MutableList<RbacPermission>>()
    for (perm in permissions) {
        out.getOrPut(perm.category) { mutableListOf() }.add(perm)
    }
    return out
}

/**
 * The ordered category sections for [payload] — the server-declared [RbacMatrixSession.categories] when
 * present, else the encounter order from [permsByCategory] (the web `orderedCategories` fallback). Empty
 * sections are dropped by the render layer.
 */
fun orderedCategories(payload: RbacMatrixSession): List<String> {
    val grouped = permsByCategory(payload.permissions)
    return if (payload.categories.isNotEmpty()) payload.categories else grouped.keys.toList()
}

/** Permissions the calling subject can exercise right now across their roles — web `EffectivePill` numerator. */
fun effectiveAllowedCount(payload: RbacMatrixSession): Int = payload.effectiveForMe.values.count { it }

/** Total permission count — the web `EffectivePill` denominator (`payload.permissions.length`). */
fun effectiveTotal(payload: RbacMatrixSession): Int = payload.permissions.size

/** Whether the matrix has any role columns — gates the native Empty phase (web `payload.roles.length === 0`). */
val RbacMatrixSession.hasNoRoles: Boolean get() = roles.isEmpty()

/**
 * The web `isRbacOpenMode` predicate, re-exposed under the same name for the native call sites — `true`
 * only once the read resolves to the open (no-forward-auth) sentinel. A not-yet-resolved `null` is `false`
 * (web `data?.mode === 'open'`). Pure delegation to [RbacMatrixDerivations.isOpenMode].
 */
fun isRbacOpenMode(response: RbacMatrixResponse?): Boolean = RbacMatrixDerivations.isOpenMode(response)

/** Narrows a [RbacMatrixResponse] to its [RbacMatrixSession], or an empty session for Open / null. */
fun RbacMatrixResponse?.asSession(): RbacMatrixSession = this as? RbacMatrixSession ?: RbacMatrixSession()

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no matrix content. */
internal fun recordRbacMatrixOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to RbacMatrixRegistration.SLUG))
}
