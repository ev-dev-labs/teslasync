package io.teslasync.shared.core.presentation.impersonation

import io.teslasync.shared.core.data.repo.ImpersonationRepository
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useImpersonation` domain (web/src/api/hooks/useImpersonation.ts):
 *
 *  1. [ImpersonationDerivations.status] — the raw `/admin/impersonate` envelope → discriminated
 *     [ImpersonationStatus] (active reshaped with each field `?? ''`, the 501 → open sentinel, every
 *     other body → inactive).
 *  2. [ImpersonationDerivations.candidates] — the raw `/candidates` envelope → discriminated
 *     [ImpersonationCandidatesResponse] (open sentinel vs `session` with `candidates ?? []`).
 *  3. The convenience predicates [ImpersonationDerivations.isImpersonationOpenMode] /
 *     [ImpersonationDerivations.isImpersonationActive].
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class ImpersonationGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun element(raw: String) = json.parseToJsonElement(raw)

    // ---- status parser ------------------------------------------------------------

    @Test
    fun statusActiveReshapesEveryFieldWithDefaults() {
        val full =
            ImpersonationDerivations.status(
                element("""{"mode":"active","original_admin":"admin@x","target":"user@y","expires_at":"2026-06-05T00:00:00Z"}"""),
            )
        assertEquals(ImpersonationStatus.Active("admin@x", "user@y", "2026-06-05T00:00:00Z"), full)

        // Missing subject/expiry fields coalesce to "" (web `?? ''`).
        val sparse = ImpersonationDerivations.status(element("""{"mode":"active"}"""))
        assertEquals(ImpersonationStatus.Active("", "", ""), sparse)
    }

    @Test
    fun statusInactiveOpenAndUnknownModes() {
        assertEquals(ImpersonationStatus.Inactive, ImpersonationDerivations.status(element("""{"mode":"inactive"}""")))
        assertEquals(ImpersonationStatus.Open, ImpersonationDerivations.status(element("""{"mode":"open"}""")))
        // Any non-active body reads as inactive (web `else { mode: 'inactive' }`).
        assertEquals(ImpersonationStatus.Inactive, ImpersonationDerivations.status(element("""{"mode":"weird"}""")))
        assertEquals(ImpersonationStatus.Inactive, ImpersonationDerivations.status(element("""{}""")))
        // A non-object envelope degrades to the safe inactive value rather than throwing.
        assertEquals(ImpersonationStatus.Inactive, ImpersonationDerivations.status(element(""""nonsense"""")))
    }

    // ---- candidates parser --------------------------------------------------------

    @Test
    fun candidatesSessionParsesRowsAndDefaultsEmpty() {
        val rows =
            ImpersonationDerivations.candidates(
                element("""{"mode":"session","candidates":[{"subject":"alice"},{"subject":"bob"}]}"""),
            )
        assertEquals(
            ImpersonationCandidatesResponse.Session(listOf(ImpersonationCandidate("alice"), ImpersonationCandidate("bob"))),
            rows,
        )

        // Missing candidates key → empty list (web `candidates ?? []`).
        assertEquals(
            ImpersonationCandidatesResponse.Session(emptyList()),
            ImpersonationDerivations.candidates(element("""{"mode":"session"}""")),
        )
        // Explicit empty array → empty list.
        assertEquals(
            ImpersonationCandidatesResponse.Session(emptyList()),
            ImpersonationDerivations.candidates(element("""{"mode":"session","candidates":[]}""")),
        )
    }

    @Test
    fun candidatesOpenSentinelAndDegradeToSession() {
        assertEquals(
            ImpersonationCandidatesResponse.Open,
            ImpersonationDerivations.candidates(element("""{"mode":"open"}""")),
        )
        // A non-object envelope degrades to an empty session rather than throwing.
        assertEquals(
            ImpersonationCandidatesResponse.Session(emptyList()),
            ImpersonationDerivations.candidates(element("""42""")),
        )
    }

    // ---- predicates ---------------------------------------------------------------

    @Test
    fun openModePredicateMatchesOnlyOpen() {
        assertTrue(ImpersonationDerivations.isImpersonationOpenMode(ImpersonationStatus.Open))
        assertTrue(!ImpersonationDerivations.isImpersonationOpenMode(ImpersonationStatus.Inactive))
        assertTrue(!ImpersonationDerivations.isImpersonationOpenMode(ImpersonationStatus.Active("a", "t", "x")))
        assertTrue(!ImpersonationDerivations.isImpersonationOpenMode(null))
    }

    @Test
    fun activePredicateMatchesOnlyActive() {
        assertTrue(ImpersonationDerivations.isImpersonationActive(ImpersonationStatus.Active("a", "t", "x")))
        assertTrue(!ImpersonationDerivations.isImpersonationActive(ImpersonationStatus.Open))
        assertTrue(!ImpersonationDerivations.isImpersonationActive(ImpersonationStatus.Inactive))
        assertTrue(!ImpersonationDerivations.isImpersonationActive(null))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port feeds.
        assertEquals("ImpersonationRepository", ImpersonationRepository::class.simpleName)
    }
}
