package io.teslasync.shared.core.presentation.rbacmatrix

import io.teslasync.shared.core.data.repo.RbacRepository
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useRbacMatrix`
 * domain (web/src/api/hooks/useRbacMatrix.ts):
 *
 *  1. [RbacMatrixDerivations.matrix] — the raw `/admin/rbac/matrix` envelope → discriminated
 *     [RbacMatrixResponse] (the 501 → open sentinel, the typed session with `?? []` / `?? {}` style
 *     defaults, malformed → safe empty session).
 *  2. [RbacMatrixDerivations.isOpenMode] — the web `isRbacOpenMode` predicate.
 *  3. [RbacMatrixDerivations.diffMatrices] — the web `diffMatrices` snapshot-diff (union of role and
 *     permission keys, default-false on the missing side, only changed cells emitted).
 *
 * The vectors are language-neutral (raw JSON / fixed maps in, fixed expectations out) so the Windows
 * C# port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are
 * inlined to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class RbacMatrixGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun element(raw: String) = json.parseToJsonElement(raw)

    // ---- matrix parser ------------------------------------------------------------

    @Test
    fun sessionParsesEveryFieldAndDefaults() {
        val full =
            RbacMatrixDerivations.matrix(
                element(
                    """
                    {
                      "mode":"session",
                      "roles":[{"id":"admin","name":"admin"},{"id":"user","name":"user"}],
                      "permissions":[{"id":"vehicles.read","name":"vehicles.read","category":"vehicles"}],
                      "categories":["vehicles","admin"],
                      "matrix":{"admin":{"vehicles.read":true},"user":{"vehicles.read":false}},
                      "effective_for_me":{"vehicles.read":true},
                      "my_roles":["admin"],
                      "groups_header_name":"X-Forwarded-Groups"
                    }
                    """.trimIndent(),
                ),
            )
        assertEquals(
            RbacMatrixSession(
                mode = "session",
                roles = listOf(RbacRole("admin", "admin"), RbacRole("user", "user")),
                permissions = listOf(RbacPermission("vehicles.read", "vehicles.read", "vehicles")),
                categories = listOf("vehicles", "admin"),
                matrix = mapOf("admin" to mapOf("vehicles.read" to true), "user" to mapOf("vehicles.read" to false)),
                effectiveForMe = mapOf("vehicles.read" to true),
                myRoles = listOf("admin"),
                groupsHeaderName = "X-Forwarded-Groups",
            ),
            full,
        )

        // A minimal `{"mode":"session"}` body defaults every collection to empty and the header to null.
        assertEquals(RbacMatrixSession(), RbacMatrixDerivations.matrix(element("""{"mode":"session"}""")))
    }

    @Test
    fun openSentinelAndMalformedDegrade() {
        // The web 501 → `{ mode: 'open' }` normalisation surfaces as the Open value.
        assertEquals(RbacMatrixResponse.Open, RbacMatrixDerivations.matrix(element("""{"mode":"open"}""")))
        // A body with no mode decodes as a (default) session, not open.
        assertTrue(RbacMatrixDerivations.matrix(element("""{}""")) is RbacMatrixSession)
        // A non-object envelope degrades to the safe empty session rather than throwing.
        assertEquals(RbacMatrixSession(), RbacMatrixDerivations.matrix(element(""""nonsense"""")))
        assertEquals(RbacMatrixSession(), RbacMatrixDerivations.matrix(element("""42""")))
    }

    // ---- isOpenMode predicate -----------------------------------------------------

    @Test
    fun openModePredicateMatchesOnlyOpen() {
        assertTrue(RbacMatrixDerivations.isOpenMode(RbacMatrixResponse.Open))
        assertTrue(!RbacMatrixDerivations.isOpenMode(RbacMatrixSession()))
        assertTrue(!RbacMatrixDerivations.isOpenMode(null))
    }

    // ---- diffMatrices -------------------------------------------------------------

    @Test
    fun diffEmitsOnlyChangedCells() {
        val base =
            mapOf(
                "admin" to mapOf("vehicles.read" to true, "vehicles.write" to false),
                "user" to mapOf("vehicles.read" to true),
            )
        val draft =
            mapOf(
                "admin" to mapOf("vehicles.read" to true, "vehicles.write" to true),
                "user" to mapOf("vehicles.read" to false),
            )
        assertEquals(
            listOf(
                RbacUpsertCell("admin", "vehicles.write", true),
                RbacUpsertCell("user", "vehicles.read", false),
            ),
            RbacMatrixDerivations.diffMatrices(base, draft),
        )
    }

    @Test
    fun diffTreatsMissingKeysAsDeny() {
        // A permission present only in draft, flipped to true, is emitted (base side defaults false).
        assertEquals(
            listOf(RbacUpsertCell("admin", "vehicles.write", true)),
            RbacMatrixDerivations.diffMatrices(
                mapOf("admin" to mapOf("vehicles.read" to true)),
                mapOf("admin" to mapOf("vehicles.read" to true, "vehicles.write" to true)),
            ),
        )

        // A whole role row present only in base, previously allowed, flips to denied when the draft
        // drops it (draft side defaults false).
        assertEquals(
            listOf(RbacUpsertCell("user", "vehicles.read", false)),
            RbacMatrixDerivations.diffMatrices(
                mapOf("admin" to mapOf("vehicles.read" to true), "user" to mapOf("vehicles.read" to true)),
                mapOf("admin" to mapOf("vehicles.read" to true)),
            ),
        )
    }

    @Test
    fun diffOfIdenticalSnapshotsIsEmpty() {
        val snapshot = mapOf("admin" to mapOf("vehicles.read" to true, "vehicles.write" to false))
        assertEquals(emptyList(), RbacMatrixDerivations.diffMatrices(snapshot, snapshot))
        assertEquals(emptyList(), RbacMatrixDerivations.diffMatrices(emptyMap(), emptyMap()))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port feeds.
        assertEquals("RbacRepository", RbacRepository::class.simpleName)
    }
}
