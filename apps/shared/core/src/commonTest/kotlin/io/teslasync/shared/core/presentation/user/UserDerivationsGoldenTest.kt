package io.teslasync.shared.core.presentation.user

import io.teslasync.shared.core.data.repo.myActivityQuery
import io.teslasync.shared.core.data.repo.updateUserBody
import io.teslasync.shared.core.data.repo.userActivityCacheKey
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Golden vectors locking the pure request-shape derivations ported from the web `useUser` domain
 * (web/src/api/hooks/useUser.ts): the `/users/me/activity` query (the web `buildActivityQuery`), its
 * params-object cache key (the web `userKeys.myActivity(params)` tuple), and the `PUT /users/me`
 * body (the web `JSON.stringify({ displayName })`). The vectors are language-neutral (typed inputs in
 * / resolved wire shape out) so the C# Windows port and the KMP core load the identical set and
 * cannot drift (ADR-004). They are inlined here (matching the lightweight
 * `SettingsDerivationsGoldenTest` precedent); the C# port mirrors these exact rows.
 *
 * Web contract reproduced verbatim:
 *  - `myActivityQuery` includes `start`/`end` only when present AND non-empty (the web
 *    `if (params.start)` truthy guard drops `''`), and `limit`/`offset` whenever non-null (the web
 *    `!= null` guard, so an explicit `0` is sent); snake_case keys, insertion-ordered;
 *  - `userActivityCacheKey` → `me:activity:<start>:<end>:<limit>:<offset>` (absent fields collapse to
 *    `''`), so two param sets collide exactly when the web query keys do;
 *  - `updateUserBody` → `{"displayName":"<str>"}` — the one camelCase body in the API surface.
 */
class UserDerivationsGoldenTest {
    @Test
    fun activityQueryIsEmptyForDefaultParams() {
        assertEquals(emptyMap(), myActivityQuery(MyActivityParams()))
    }

    @Test
    fun activityQueryDropsEmptyStartAndEndButKeepsZeroLimitOffset() {
        // start/end use the web truthy guard: a present-but-empty string is dropped.
        assertEquals(emptyMap(), myActivityQuery(MyActivityParams(start = "", end = "")))
        // limit/offset use the web `!= null` guard: an explicit 0 IS sent.
        assertEquals(mapOf("limit" to "0", "offset" to "0"), myActivityQuery(MyActivityParams(limit = 0, offset = 0)))
    }

    @Test
    fun activityQueryEmitsSnakeCaseKeysInInsertionOrder() {
        val q =
            myActivityQuery(
                MyActivityParams(start = "2026-01-01", end = "2026-02-01", limit = 50, offset = 10),
            )
        assertEquals(
            mapOf("start" to "2026-01-01", "end" to "2026-02-01", "limit" to "50", "offset" to "10"),
            q,
        )
        assertEquals(listOf("start", "end", "limit", "offset"), q.keys.toList())
    }

    @Test
    fun activityQueryEmitsOnlyPresentFields() {
        assertEquals(mapOf("start" to "2026-03-01"), myActivityQuery(MyActivityParams(start = "2026-03-01")))
        assertEquals(mapOf("offset" to "100"), myActivityQuery(MyActivityParams(offset = 100)))
    }

    @Test
    fun activityCacheKeyCollapsesAbsentFields() {
        assertEquals("me:activity::::", userActivityCacheKey(MyActivityParams()))
        assertEquals(
            "me:activity:2026-01-01:2026-02-01:50:10",
            userActivityCacheKey(MyActivityParams(start = "2026-01-01", end = "2026-02-01", limit = 50, offset = 10)),
        )
    }

    @Test
    fun activityCacheKeyIsPerParams() {
        // Distinct params caches independently; identical params collide (the web tuple equality).
        assertEquals(
            userActivityCacheKey(MyActivityParams(limit = 50)),
            userActivityCacheKey(MyActivityParams(limit = 50)),
        )
        assertEquals(
            false,
            userActivityCacheKey(MyActivityParams(limit = 50)) == userActivityCacheKey(MyActivityParams(limit = 25)),
        )
    }

    @Test
    fun updateUserBodyMatchesWebStringify() {
        assertEquals("""{"displayName":"Atul"}""", updateUserBody("Atul").toString())
        assertEquals("""{"displayName":""}""", updateUserBody("").toString())
    }
}
