// Pure, framework-free model + projection for the DBHealthPage system surface — the native analogue of everything
// the web page derives before it returns JSX (web/src/features/system/pages/DBHealthPage.tsx, the database-health
// dashboard). No Compose, no Android framework, no HTTP lives here: every type is exercised off-device, keeping the
// composable a thin render layer.
//
// The three reads the page binds arrive as the shared S8 AdminStore's cache-then-network values — the raw verbatim
// server JSON (`GET /dev-tools/db-stats` ▸ dbStats(), `GET /dev-tools/migration-status` ▸ migrations(),
// `GET /dev-tools/runtime-info` ▸ connectionPool()). So this file owns the parse + the client-side derivations the
// web component does inline: the table sort (web `sortedTables` useMemo), the top-15 chart series (web `chartData`
// useMemo), the large-table count (web `largeTables`), the pool-usage percentage (web `poolUsage`), and the
// `{version, dirty}`/`{currentVersion}` field-name reconciliation (web `migrationData?.version ?? currentVersion`).
// The values are byte counts / row counts / a migration version / pool gauges the backend already computed — none
// are unit-bearing — so there is no SI conversion here (S5); byte + locale-number formatting is applied at the
// render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling SystemStatusPage /
// DiagnosticPage surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.dbhealth

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Bytes past which a table is "large" — web `LARGE_TABLE_THRESHOLD = 100 * 1024 * 1024`. */
internal const val LARGE_TABLE_THRESHOLD_BYTES: Long = 100L * 1024 * 1024

/** Number of tables in the top-N bar chart — web `chartData` `.slice(0, 15)`. */
internal const val CHART_TOP_N: Int = 15

/** Max table-name length before truncation in the chart — web `name.length > 20 ? slice(0,18)+'…'`. */
private const val CHART_NAME_MAX: Int = 20
private const val CHART_NAME_KEEP: Int = 18

/** Recent-migrations window shown in the migration panel — web `migrations.slice(-5).reverse()`. */
internal const val RECENT_MIGRATIONS_LIMIT: Int = 5

/** Pool-usage percentage past which the usage bar turns danger-red — web `poolUsage >= 80`. */
internal const val POOL_USAGE_DANGER_PERCENT: Int = 80

/**
 * Canonical metadata for this surface. The web page is a top-level routed surface (`/db-health`), so this object
 * carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (the
 * pre-existing `Destinations.page("dbHealth", "/db-health", NavGroup.System)` row), and the diagnostics [SLUG]
 * emitted with the one-shot `view.opened` event (P1/S11).
 */
object DBHealthPageRegistration {
    /** The navigation destination id (Destinations.kt `page("dbHealth", "/db-health", …)`). */
    const val ROUTE_ID: String = "dbHealth"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/db-health"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DBHealthPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no database data. */
internal fun recordDBHealthPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DBHealthPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * The lifecycle a single bound feed can be in, projected from a shared-core `Resource` by the view-model so the
 * framework-free model stays HTTP-free. Each of the page's three reads carries its own phase so a still-loading or
 * failed sibling read renders its own loading / empty / error surface rather than blanking the whole dashboard
 * (web: each `useQuery` has its own `isLoading` / `data` gate).
 */
enum class SourcePhase { Loading, Content, Empty, Error }

/** The table-list sort key — the native mirror of the web `SortKey = 'size' | 'rows' | 'name'` union. */
enum class TableSortKey { Size, Rows, Name }

/**
 * One database table row — the native mirror of the web `TableInfo`. The backend `db-stats` read currently returns
 * only [name] + [rowCount] (+ schema); [sizeBytes] / [indexCount] / [lastVacuum] stay nullable so the render
 * boundary applies the web `?? '—'` fallbacks honestly rather than fabricating a zero, and so the logic still works
 * if a future backend adds them.
 */
data class DbTable(
    val name: String,
    val schema: String?,
    val rowCount: Long,
    val sizeBytes: Long?,
    val indexCount: Int?,
    val lastVacuum: String?,
) {
    /** Whether this table exceeds the large-table threshold — web `(tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD`. */
    val isLarge: Boolean get() = (sizeBytes ?: 0L) > LARGE_TABLE_THRESHOLD_BYTES
}

/** One applied migration — the native mirror of the web `MigrationInfo`. */
data class MigrationEntry(
    val version: String,
    val name: String,
    val appliedAt: String?,
)

/**
 * The migration-status payload — the native mirror of the web `MigrationStatus`. [version] reconciles the backend's
 * `version` and the web type's `currentVersion` (web `migrationData?.version ?? migrationData?.currentVersion`).
 * The backend currently returns only `{version, dirty}`, so [pending] defaults to 0 and [migrations] to empty (web
 * `?? 0` / `?? []`).
 */
data class MigrationStatusData(
    val version: String,
    val dirty: Boolean,
    val pending: Int,
    val migrations: List<MigrationEntry>,
) {
    /** The five most-recent migrations, newest first — web `migrations.slice(-5).reverse()`. */
    val recentMigrations: List<MigrationEntry>
        get() = migrations.takeLast(RECENT_MIGRATIONS_LIMIT).asReversed()
}

/**
 * The connection-pool gauges — the native mirror of the web `ConnectionPool`. The backend `runtime-info` read does
 * not return `wait_duration_ms`, so [waitDurationMs] defaults to 0 (web `pool.waitDurationMs ?? 0`).
 */
data class PoolStats(
    val maxOpen: Long,
    val open: Long,
    val inUse: Long,
    val idle: Long,
    val waitCount: Long,
    val waitDurationMs: Long,
) {
    /** Pool utilisation 0–100 — web `Math.min((inUse / maxOpen) * 100, 100)`; 0 when [maxOpen] is non-positive. */
    val usagePercent: Int
        get() = if (maxOpen > 0L) ((inUse.asDouble() / maxOpen.asDouble()) * 100.0).coerceIn(0.0, 100.0).toInt() else 0

    /** Whether utilisation is in the danger band — web `poolUsage >= 80`. */
    val usageIsDanger: Boolean get() = usagePercent >= POOL_USAGE_DANGER_PERCENT
}

/** One bar in the top-N table-size chart: a (possibly truncated) [label] and its [rows] value. */
data class TableChartBar(
    val label: String,
    val rows: Long,
)

/**
 * The render-ready projection of all three reads the surface binds — every field the page draws, derived once in
 * one pure pass so the composable never re-derives. The db-stats read drives the page's outer phase
 * (cards / chart / table); [migrationPhase] + [poolPhase] carry the sidebar panels' own loading / empty / error
 * sub-states so they never blank. [isEmpty] gates the page Empty phase: db-stats resolved but carried no tables and
 * a zero database size (a structurally empty payload).
 */
data class DBHealthData(
    val tables: List<DbTable>,
    val tableCount: Int,
    val databaseSizeBytes: Long,
    val migrationPhase: SourcePhase,
    val migration: MigrationStatusData?,
    val poolPhase: SourcePhase,
    val pool: PoolStats?,
) {
    /** Count of tables over the large-table threshold — web `largeTables`. */
    val largeTableCount: Int get() = tables.count { it.isLarge }

    /** Total database size formatted for display — web `dbSizeDisplay` (`formatBytes(Number(databaseSize)||0)`). */
    val databaseSizeDisplay: String get() = formatBytes(databaseSizeBytes)

    /** Migration version for the summary card + sidebar — web `String(migrationVersion)`, `'—'` when absent. */
    val migrationVersionDisplay: String get() = migration?.version ?: EM_DASH

    /** The page Empty-phase gate: db-stats resolved but carried nothing renderable. */
    val isEmpty: Boolean get() = tables.isEmpty() && tableCount == 0 && databaseSizeBytes == 0L

    /** Tables sorted by [key] — web `sortedTables` (size ▸ `sizeBytes ?? rowCount` desc, rows desc, name asc). */
    fun sortedTables(key: TableSortKey): List<DbTable> =
        when (key) {
            TableSortKey.Size -> tables.sortedByDescending { it.sizeBytes ?: it.rowCount }
            TableSortKey.Rows -> tables.sortedByDescending { it.rowCount }
            TableSortKey.Name -> tables.sortedBy { it.name.lowercase() }
        }

    /** Top-15 tables by row count, newest names truncated — web `chartData` (sort by rowCount desc, slice 15). */
    fun chartBars(): List<TableChartBar> =
        tables
            .sortedByDescending { it.rowCount }
            .take(CHART_TOP_N)
            .map { TableChartBar(label = truncateName(it.name), rows = it.rowCount) }

    companion object {
        val EMPTY: DBHealthData =
            DBHealthData(
                tables = emptyList(),
                tableCount = 0,
                databaseSizeBytes = 0L,
                migrationPhase = SourcePhase.Loading,
                migration = null,
                poolPhase = SourcePhase.Loading,
                pool = null,
            )

        /**
         * Folds the three cached reads into the render-ready model. [statsJson] is the spine (drives the page
         * phase, set by the view-model's outer projection). For the two sidebar feeds the view-model passes only
         * the raw cached JSON plus the two ADR-013 first-load flags ([migrationLoadingNoCache] /
         * [migrationErrorNoCache] etc. = `Resource.Loading|Error` with no cache); this object owns the
         * Loading ▸ Error ▸ Empty ▸ Content decision so the per-panel sub-state derivation stays framework-free and
         * unit-tested. A feed that is loading/failing but has a cached value falls through to its parse (offline ⇒
         * last-known content), never blanking (web each-`useQuery` `isLoading` / `data` gate).
         */
        fun from(
            statsJson: JsonElement?,
            migrationJson: JsonElement?,
            migrationLoadingNoCache: Boolean,
            migrationErrorNoCache: Boolean,
            poolJson: JsonElement?,
            poolLoadingNoCache: Boolean,
            poolErrorNoCache: Boolean,
        ): DBHealthData {
            val statsObj = statsJson as? JsonObject
            val migration = parseMigration(migrationJson as? JsonObject)
            val pool = parsePool(poolJson as? JsonObject)
            return DBHealthData(
                tables = parseTables(statsObj),
                tableCount = statsObj?.int("table_count") ?: statsObj?.int("tableCount") ?: 0,
                databaseSizeBytes = statsObj?.long("database_size") ?: statsObj?.long("databaseSize") ?: 0L,
                migrationPhase = phaseOf(migrationLoadingNoCache, migrationErrorNoCache, migration != null),
                migration = migration,
                poolPhase = phaseOf(poolLoadingNoCache, poolErrorNoCache, pool != null),
                pool = pool,
            )
        }

        /** Resolves a sidebar feed's [SourcePhase] from its first-load flags + whether its payload parsed. */
        private fun phaseOf(
            loadingNoCache: Boolean,
            errorNoCache: Boolean,
            hasContent: Boolean,
        ): SourcePhase =
            when {
                loadingNoCache -> SourcePhase.Loading
                errorNoCache -> SourcePhase.Error
                hasContent -> SourcePhase.Content
                else -> SourcePhase.Empty
            }

        private fun parseTables(stats: JsonObject?): List<DbTable> {
            val arr = stats?.get("tables") as? JsonArray ?: return emptyList()
            return arr.mapNotNull { it as? JsonObject }.mapNotNull { obj ->
                val name = obj.string("name") ?: return@mapNotNull null
                DbTable(
                    name = name,
                    schema = obj.string("schema"),
                    rowCount = obj.long("row_count") ?: obj.long("rowCount") ?: 0L,
                    sizeBytes = obj.long("size_bytes") ?: obj.long("sizeBytes"),
                    indexCount = obj.int("index_count") ?: obj.int("indexCount"),
                    lastVacuum = obj.string("last_vacuum") ?: obj.string("lastVacuum"),
                )
            }
        }

        /**
         * Parses the migration payload, returning `null` when the read carried no version at all (drives the
         * sidebar's "Migration data unavailable" empty). The web reconciles the backend `version` with the
         * `currentVersion` field name and defaults `pending`/`migrations`.
         */
        private fun parseMigration(obj: JsonObject?): MigrationStatusData? {
            if (obj == null) return null
            val version = obj.string("version") ?: obj.string("currentVersion") ?: obj.string("current_version") ?: return null
            val migrations =
                (obj["migrations"] as? JsonArray).orEmptyArray().mapNotNull { it as? JsonObject }.mapNotNull { m ->
                    val v = m.string("version") ?: return@mapNotNull null
                    MigrationEntry(
                        version = v,
                        name = m.string("name") ?: "",
                        appliedAt = m.string("applied_at") ?: m.string("appliedAt"),
                    )
                }
            return MigrationStatusData(
                version = version,
                dirty = obj.bool("dirty") ?: false,
                pending = obj.int("pending") ?: 0,
                migrations = migrations,
            )
        }

        /**
         * Parses the pool payload, returning `null` when the read carried no `max_open` gauge (drives the sidebar's
         * "Connection pool data unavailable" empty — web `pool?.maxOpen != null`).
         */
        private fun parsePool(obj: JsonObject?): PoolStats? {
            if (obj == null) return null
            val maxOpen = obj.long("max_open") ?: obj.long("maxOpen") ?: return null
            return PoolStats(
                maxOpen = maxOpen,
                open = obj.long("open") ?: 0L,
                inUse = obj.long("in_use") ?: obj.long("inUse") ?: 0L,
                idle = obj.long("idle") ?: 0L,
                waitCount = obj.long("wait_count") ?: obj.long("waitCount") ?: 0L,
                waitDurationMs = obj.long("wait_duration_ms") ?: obj.long("waitDurationMs") ?: 0L,
            )
        }
    }
}

/**
 * Human-readable byte size — the native port of the web `formatBytes`. Mirrors its thresholds and precision
 * (`B` integer, `KB`/`MB` one decimal, `GB` two decimals) so the dashboard reads identically across platforms.
 */
fun formatBytes(bytes: Long): String {
    val kb = 1024.0
    val mb = kb * 1024
    val gb = mb * 1024
    val b = bytes.asDouble()
    return when {
        bytes < 1024L -> "$bytes B"
        b < mb -> "${oneDecimal(b / kb)} KB"
        b < gb -> "${oneDecimal(b / mb)} MB"
        else -> "${twoDecimal(b / gb)} GB"
    }
}

private fun oneDecimal(value: Double): String = String.format(java.util.Locale.ROOT, "%.1f", value)

private fun twoDecimal(value: Double): String = String.format(java.util.Locale.ROOT, "%.2f", value)

/** Truncates a chart table name to fit the axis — web `name.length > 20 ? slice(0,18)+'…' : name`. */
private fun truncateName(name: String): String =
    if (name.length > CHART_NAME_MAX) name.take(CHART_NAME_KEEP) + "\u2026" else name

// ── JsonElement read helpers (mirroring the sibling SystemStatusPageModel accessors) ────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.intOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull

private fun JsonArray?.orEmptyArray(): List<JsonElement> = this ?: emptyList()

/** Widens a [Long] to a [Double] via `* 1.0` (mirrors the sibling pages' numeric helper). */
internal fun Long.asDouble(): Double = this * 1.0
