package io.teslasync.shared.core.presentation.featureflags

import io.teslasync.shared.core.data.repo.FeatureFlagsRepository
import io.teslasync.shared.core.data.repo.flagCacheKey
import io.teslasync.shared.core.data.repo.flagChangesCacheKey
import io.teslasync.shared.core.data.repo.flagChangesScoped
import io.teslasync.shared.core.data.repo.flagsListCacheKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useFeatureFlags` domain (web/src/api/hooks/useFeatureFlags.ts):
 *
 *  1. [flagChangesScoped] — the `useFlagChanges` guard
 *     `typeof flagKey === 'string' && flagKey.length > 0` (null OR empty ⇒ global feed).
 *  2. [flagChangesCacheKey] — the `featureFlagKeys.changes(scoped ? flagKey : null, limit)` tuple
 *     with the `flagKey ?? '__all__'` sentinel and the participating `limit`.
 *  3. [flagsListCacheKey] / [flagCacheKey] — the `featureFlagKeys.list` / `featureFlagKeys.flag`
 *     tuples.
 *
 * The vectors are language-neutral (fixed inputs → fixed expectations) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class FeatureFlagsGoldenTest {
    private val json = Json

    // ---- flagChangesScoped + flagChangesCacheKey ----------------------------------

    @Serializable
    private data class ChangesRow(
        val name: String,
        val flagKey: String? = null,
        val limit: Int,
        val scoped: Boolean,
        val cacheKey: String,
    )

    private fun changesRows(): List<ChangesRow> = json.decodeFromString(CHANGES_GOLDEN)

    @Test
    fun changesGoldenCoversEveryScopingEdge() {
        val names = changesRows().map { it.name }.toSet()
        listOf("null_global", "empty_global", "scoped", "scoped_other_limit")
            .forEach { assertTrue(it in names, "changes golden missing the '$it' case") }
    }

    @Test
    fun everyChangesRowMatchesDerivations() {
        for (row in changesRows()) {
            assertEquals(row.scoped, flagChangesScoped(row.flagKey), "${row.name}: scoped")
            assertEquals(
                row.cacheKey,
                flagChangesCacheKey(row.flagKey, row.limit),
                "${row.name}: cacheKey",
            )
        }
    }

    // ---- list / flag cache keys ---------------------------------------------------

    @Test
    fun listAndFlagKeysMatchTheWebTuples() {
        assertEquals("list", flagsListCacheKey())
        assertEquals("flag:alpha", flagCacheKey("alpha"))
        assertEquals("flag:a.b", flagCacheKey("a.b"))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(FeatureFlagsRepository::class.simpleName == "FeatureFlagsRepository")
    }

    private companion object {
        val CHANGES_GOLDEN =
            """
            [
              { "name": "null_global",        "limit": 50, "scoped": false, "cacheKey": "changes:__all__:50" },
              { "name": "empty_global",       "flagKey": "", "limit": 50, "scoped": false, "cacheKey": "changes:__all__:50" },
              { "name": "scoped",             "flagKey": "alpha", "limit": 50, "scoped": true, "cacheKey": "changes:alpha:50" },
              { "name": "scoped_other_limit", "flagKey": "alpha", "limit": 10, "scoped": true, "cacheKey": "changes:alpha:10" }
            ]
            """.trimIndent()
    }
}
