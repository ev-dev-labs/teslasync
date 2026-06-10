package io.teslasync.shared.core.presentation.systemqueues

import io.teslasync.shared.core.data.repo.queueJobsCacheKey
import io.teslasync.shared.core.data.repo.queueJobsEnabled
import io.teslasync.shared.core.data.repo.queueJobsPath
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the three client-side derivations ported from the web `useSystemQueues`
 * domain — the per-worker jobs path (`useQueueJobs`'s
 * `/system/queues/${encodeURIComponent(worker)}/jobs`), the cache/feed key (web
 * `queueKeys.jobs(worker)`, keyed by worker alone), and the drawer `enabled` gate (`enabled` &&
 * a worker is selected). The vectors are language-neutral (plain JSON in / JSON out) so the C#
 * Windows port and the KMP core can load the identical set and cannot drift (ADR-004). The fixture
 * is inlined here (rather than a separate `apps/shared/spec` file) to stay within this slice's
 * allowed file scope; the C# port mirrors these exact rows.
 *
 * Web contract reproduced row-for-row:
 *  - path: the worker segment is percent-encoded exactly as `encodeURIComponent` encodes it;
 *  - key : two limits for the same worker share one slot (the limit is not in the web query key);
 *  - gate: the jobs query fetches only when enabled AND a non-blank worker is selected.
 */
class SystemQueuesGoldenTest {
    @Serializable
    private data class PathRow(
        val name: String,
        val worker: String,
        val path: String,
        val key: String,
    )

    @Serializable
    private data class GateRow(
        val name: String,
        val worker: String,
        val enabled: Boolean,
        val expected: Boolean,
    )

    private val json = Json

    @Test
    fun jobsPathAndKeyMatchEveryGoldenRow() {
        val rows: List<PathRow> = json.decodeFromString(PATH_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("plain", "space", "slash").forEach { assertTrue(it in names, "path golden missing '$it'") }
        for (row in rows) {
            assertEquals(row.path, queueJobsPath(row.worker), "queueJobsPath('${row.name}')")
            assertEquals(row.key, queueJobsCacheKey(row.worker), "queueJobsCacheKey('${row.name}')")
        }
    }

    @Test
    fun jobsEnabledGateMatchesEveryGoldenRow() {
        val rows: List<GateRow> = json.decodeFromString(GATE_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("enabled_worker", "disabled_flag", "blank_worker", "whitespace_worker").forEach {
            assertTrue(it in names, "gate golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(row.expected, queueJobsEnabled(row.worker, row.enabled), "queueJobsEnabled('${row.name}')")
        }
    }

    private companion object {
        val PATH_GOLDEN =
            """
            [
              { "name": "plain", "worker": "notification", "path": "/system/queues/notification/jobs", "key": "jobs:notification" },
              { "name": "space", "worker": "a b",          "path": "/system/queues/a%20b/jobs",        "key": "jobs:a b" },
              { "name": "slash", "worker": "a/b",          "path": "/system/queues/a%2Fb/jobs",        "key": "jobs:a/b" }
            ]
            """.trimIndent()

        val GATE_GOLDEN =
            """
            [
              { "name": "enabled_worker",    "worker": "export", "enabled": true,  "expected": true },
              { "name": "disabled_flag",     "worker": "export", "enabled": false, "expected": false },
              { "name": "blank_worker",      "worker": "",       "enabled": true,  "expected": false },
              { "name": "whitespace_worker", "worker": "   ",     "enabled": true,  "expected": false }
            ]
            """.trimIndent()
    }
}
