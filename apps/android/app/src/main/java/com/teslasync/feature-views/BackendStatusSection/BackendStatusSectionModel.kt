// Pure, framework-free model + projection for the Backend Status feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/BackendStatusSection.tsx). No Compose, no Android framework,
// no HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The three feeds arrive as their shared-layer payloads: `/system/health` and `/dev-tools/runtime-info`
// as raw verbatim server JSON from the S8 AdminStore (snake_case on the wire), and `/system/version` as the
// re-encoded JSON of the canonical S8 VersionInfo (the VersionInfoWidget precedent). So this file owns the
// parse + the client-side derivations the web component does inline: the per-component row mapping, the
// status colour band, the healthy-count badge, the connection-pool stat tiles, and the runtime KVList with
// its `version ?? extHealth.system ?? fallback` chain. Values stay SI / raw (none here are unit-bearing —
// counts, a Go version string, a seconds uptime, and an ISO instant); display formatting is this layer's job.
//
// i18n parity note — the web resolves every label through `useTranslation` with NATURAL-LANGUAGE keys
// (`t('Backend Status')`, `t('Max Open')`, …). Nine of those keys exist in the shared P1/S10 catalog
// (Status / Component / Latency / Failures / healthy / Open / Idle / Uptime / Goroutines) and resolve through
// `stringResource` at the Compose boundary. The remaining twelve (Backend Status, the description, Component
// Health, Database Connection Pool, System Runtime, No components found, Last Check, Max Open, In Use, Wait
// Count, Go Version, OS / Arch) are ABSENT from the catalog, so i18next renders the key verbatim in EVERY
// locale (key-as-default). To preserve exact display parity and avoid silent drift these are reproduced
// verbatim in [BackendStatusSectionStrings]'s preview/default factory and documented at the call site — the
// same precedent the sibling UptimeMonitorWidget sets for its non-catalog service labels. The live composable
// still routes every catalog-backed string through the facade; only the genuinely-absent keys fall back to
// the literal the web itself renders.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BackendStatusSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendstatussection

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no component status,
 * connection-pool figure, or version/runtime detail, so a diagnostics line can never leak the install's
 * backend health posture.
 */
const val BACKEND_STATUS_SECTION_SLUG: String = "BackendStatusSection"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BACKEND_STATUS_SECTION_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect. Mirrors the sibling feature-view surfaces' `surface`-keyed event.
 */
fun recordBackendStatusSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BACKEND_STATUS_SECTION_SLUG))
}

/**
 * Semantic colour band for a status token — the native port of the web `getStatusColor` /
 * `statusTextClass` switch. Mapped to a concrete colour at the render boundary so the pure projection stays
 * theme-stable. Case-insensitive, matching the web `(status ?? '').toLowerCase()`.
 */
enum class StatusTone { Ok, Warn, Down, Neutral }

/** Wire status tokens that render in the success band (web first `case` group). */
private val OK_TOKENS = setOf("healthy", "ok", "online", "connected", "ready", "sent", "completed")

/** Wire status tokens that render in the warning band. */
private val WARN_TOKENS = setOf("degraded", "warning", "pending", "queued", "processing")

/** Wire status tokens that render in the danger band. */
private val DOWN_TOKENS = setOf("unhealthy", "offline", "error", "down", "failed")

/** Map a status token to its [StatusTone] — the native port of the web colour switch. */
fun statusToneFor(status: String): StatusTone =
    when (status.trim().lowercase(Locale.ROOT)) {
        in OK_TOKENS -> StatusTone.Ok
        in WARN_TOKENS -> StatusTone.Warn
        in DOWN_TOKENS -> StatusTone.Down
        else -> StatusTone.Neutral
    }

/**
 * True for the two tokens the web healthy-count treats as healthy (`r.status === 'ok' || 'healthy'`).
 * Exact match (not the broader tone band) so the `{ok}/{n}` badge mirrors the web `okCount` precisely.
 */
fun isHealthyStatus(status: String): Boolean = status == STATUS_OK || status == STATUS_HEALTHY

private const val STATUS_OK = "ok"
private const val STATUS_HEALTHY = "healthy"

/** Stable column keys (shared with the web `Column.key`) so the hoisted [SortState] aligns with the header. */
object BackendStatusColumns {
    const val STATUS = "status"
    const val NAME = "name"
    const val LATENCY = "latency_ms"
    const val FAILURES = "failures"
    const val LAST_CHECK = "lastCheck"

    /** The three columns the web `DataTable` lets the operator sort (`sortable: true`). */
    val SORTABLE: Set<String> = setOf(NAME, LATENCY, FAILURES)
}

/**
 * One parsed component-health row — the native analogue of the web `ComponentRow`. [latencyMs] /
 * [failures] default to 0 (web `?? 0`); [lastCheck] is the raw ISO instant ('' when absent, web `?? ''`).
 */
data class ComponentRow(
    val name: String,
    val status: String,
    val latencyMs: Double,
    val failures: Long,
    val lastCheck: String,
)

/** The `system` runtime block off `/system/health` — every field nullable so an absent key falls through. */
data class SystemRuntime(
    val goVersion: String?,
    val uptimeSeconds: Long?,
    val goroutines: Long?,
)

/**
 * The parsed `/system/health` snapshot — the native analogue of the web `ExtendedHealthResponse` the
 * `getExtendedHealth` query resolves. [components] preserves wire iteration order (web `Object.entries`).
 */
data class HealthSnapshot(
    val components: List<ComponentRow>,
    val system: SystemRuntime?,
) {
    companion object {
        /** Parse [element] into a snapshot, or `null` when it is absent / not a JSON object (web `extHealth` undefined). */
        fun parse(element: JsonElement?): HealthSnapshot? {
            val obj = element as? JsonObject ?: return null
            val components =
                (obj["components"] as? JsonObject)
                    ?.mapNotNull { (name, value) ->
                        (value as? JsonObject)?.let { c ->
                            ComponentRow(
                                name = name,
                                status = c.stringField("status") ?: "",
                                latencyMs = c.doubleField("latency_ms") ?: 0.0,
                                failures = c.longField("consecutive_failures") ?: 0L,
                                lastCheck = c.stringField("last_check") ?: "",
                            )
                        }
                    }.orEmpty()
            val system =
                (obj["system"] as? JsonObject)?.let { s ->
                    SystemRuntime(
                        goVersion = s.stringField("go_version"),
                        uptimeSeconds = s.longField("uptime_seconds"),
                        goroutines = s.longField("goroutines"),
                    )
                }
            return HealthSnapshot(components = components, system = system)
        }
    }
}

/**
 * The parsed `/dev-tools/runtime-info` connection-pool snapshot — the native analogue of the web
 * `ConnectionPool`. Read from the canonical snake_case wire keys (`max_open` / `open` / `in_use` / `idle` /
 * `wait_count`, per internal/api/devtools/handler.go), each defaulting to 0; tolerant of the post-
 * `camelCaseKeys` variants the web type names so either shape decodes.
 */
data class PoolSnapshot(
    val maxOpen: Long,
    val open: Long,
    val inUse: Long,
    val idle: Long,
    val waitCount: Long,
) {
    companion object {
        /** Parse [element] into a pool snapshot, or `null` when absent / not an object (web `pool` undefined ⇒ section hidden). */
        fun parse(element: JsonElement?): PoolSnapshot? {
            val obj = element as? JsonObject ?: return null
            return PoolSnapshot(
                maxOpen = obj.longField("max_open") ?: obj.longField("maxOpen") ?: 0L,
                open = obj.longField("open") ?: 0L,
                inUse = obj.longField("in_use") ?: obj.longField("inUse") ?: 0L,
                idle = obj.longField("idle") ?: 0L,
                waitCount = obj.longField("wait_count") ?: obj.longField("waitCount") ?: 0L,
            )
        }
    }
}

/**
 * The parsed `/system/version` detail the runtime section reads — the native analogue of the web's reads
 * off `version.data`. [goVersion] / [os] / [arch] come from the canonical VersionInfo contract;
 * [uptimeSeconds] / [goroutines] are read by the same snake_case names the web uses but lie OUTSIDE the
 * typed contract, so they decode as `null` against the live re-encoded payload and the runtime row falls
 * through to `extHealth.system` exactly like the web `version?.x ?? extHealth?.system?.x` chain.
 */
data class VersionSnapshot(
    val goVersion: String?,
    val os: String?,
    val arch: String?,
    val uptimeSeconds: Long?,
    val goroutines: Long?,
) {
    companion object {
        /** Parse [element] into a version snapshot, or `null` when absent / not an object (web `version` undefined). */
        fun parse(element: JsonElement?): VersionSnapshot? {
            val obj = element as? JsonObject ?: return null
            return VersionSnapshot(
                goVersion = obj.stringField("go_version"),
                os = obj.stringField("os"),
                arch = obj.stringField("arch"),
                uptimeSeconds = obj.longField("uptime_seconds"),
                goroutines = obj.longField("goroutines"),
            )
        }
    }
}

/**
 * The combined snapshot the surface composes — the native analogue of the web's three hook results.
 * [isEmpty] is the native data-contract addition (the web shell only has loading + content): true only when
 * nothing at all resolved — no components, no pool, no system runtime, and no version — so the friendly
 * empty surface renders instead of a blank panel.
 */
data class BackendStatusData(
    val health: HealthSnapshot?,
    val pool: PoolSnapshot?,
    val version: VersionSnapshot?,
) {
    /** Web `extHealth?.system || version` ⇒ the runtime section renders. */
    val hasRuntime: Boolean get() = health?.system != null || version != null

    /** Web `pool && …` ⇒ the connection-pool section renders. */
    val hasPool: Boolean get() = pool != null

    /** True when there is no renderable data on any of the three sub-sections. */
    val isEmpty: Boolean get() = (health?.components.isNullOrEmpty()) && !hasPool && !hasRuntime

    companion object {
        /** Compose the three (possibly cached) feed payloads into one snapshot. */
        fun from(
            health: JsonElement?,
            pool: JsonElement?,
            version: JsonElement?,
        ): BackendStatusData =
            BackendStatusData(
                health = HealthSnapshot.parse(health),
                pool = PoolSnapshot.parse(pool),
                version = VersionSnapshot.parse(version),
            )
    }
}

/**
 * Localized labels the surface folds into its output. The catalog-backed labels arrive through the P1/S10
 * facade at the Compose boundary; the labels for keys absent from the catalog (see the file header) carry
 * the verbatim English the web's i18next key-as-default renders, so display parity holds with no silent
 * drift. [formatRelative] backs the header freshness chip.
 */
data class BackendStatusSectionStrings(
    val title: String,
    val description: String,
    val healthy: String,
    val componentHealth: String,
    val databaseConnectionPool: String,
    val systemRuntime: String,
    val noComponentsFound: String,
    val colStatus: String,
    val colComponent: String,
    val colLatency: String,
    val colFailures: String,
    val colLastCheck: String,
    val maxOpen: String,
    val open: String,
    val inUse: String,
    val idle: String,
    val waitCount: String,
    val goVersion: String,
    val uptime: String,
    val goroutines: String,
    val osArch: String,
    val refresh: String,
    val refreshing: String,
    val offline: String,
    val loading: String,
    val emptyMessage: String,
)

/** One render-ready component row — the parsed [ComponentRow] plus its formatted, localized cells. */
data class ComponentRowView(
    val name: String,
    val status: String,
    val tone: StatusTone,
    val latencyText: String,
    val failuresText: String,
    val failuresIsError: Boolean,
    val lastCheckText: String,
)

/** One connection-pool stat tile (web `StatCard`): a [label] and an already-formatted integer [value]. */
data class PoolStat(
    val key: String,
    val label: String,
    val value: String,
)

/** One runtime definition-list row (web `KVList` item): a [label] and an already-formatted [value]. */
data class RuntimeItem(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX (the `componentRows`/`okCount` reads, the pool stat grid, and the runtime KVList).
 * Pure data so the projection is unit-tested without a UI host.
 *
 * @property rows the (sorted) component rows; empty ⇒ the table shows the "No components found" message.
 * @property okCount the count of healthy components (web `okCount`).
 * @property total the component count (web `componentRows.length`).
 * @property badgeLabel the `{ok}/{total} healthy` chip text; `null` when there are no components (web `undefined`).
 * @property allHealthy whether every component is healthy (badge success vs warning, web `okCount === total`).
 * @property poolStats the five pool tiles, or `null` when no pool resolved (section hidden).
 * @property runtimeItems the four runtime rows, or `null` when neither system nor version resolved.
 * @property contentDescription the folded TalkBack summary of the badge + sections.
 */
data class BackendStatusDisplay(
    val rows: List<ComponentRowView>,
    val okCount: Int,
    val total: Int,
    val badgeLabel: String?,
    val allHealthy: Boolean,
    val poolStats: List<PoolStat>?,
    val runtimeItems: List<RuntimeItem>?,
    val contentDescription: String,
)

/**
 * Pure projection from a [BackendStatusData] to the render-ready [BackendStatusDisplay] — the native port
 * of the inline derivations in the web `BackendStatusSection`. Side-effect-free (the only ambient inputs,
 * [locale] + [zone], are injected) so the gate unit-tests it deterministically.
 */
object BackendStatusProjection {
    private const val DESC_SEPARATOR = ", "

    /** Project [data] for the localized [strings] with the given table [sort]. */
    fun project(
        data: BackendStatusData,
        strings: BackendStatusSectionStrings,
        sort: SortState = SortState(),
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): BackendStatusDisplay {
        val parsed = data.health?.components.orEmpty()
        val sorted = sortRows(parsed, sort)
        val rows =
            sorted.map { row ->
                ComponentRowView(
                    name = row.name,
                    status = row.status,
                    tone = statusToneFor(row.status),
                    latencyText = "${ChartFormat.number(row.latencyMs, LATENCY_DECIMALS, locale)} ms",
                    failuresText = formatInt(row.failures, locale),
                    failuresIsError = row.failures > 0,
                    lastCheckText = formatLastCheck(row.lastCheck, locale, zone),
                )
            }
        val total = parsed.size
        val okCount = parsed.count { isHealthyStatus(it.status) }
        val badgeLabel = if (total > 0) "$okCount/$total ${strings.healthy}" else null
        val poolStats = data.pool?.let { poolStats(it, strings, locale) }
        val runtimeItems = if (data.hasRuntime) runtimeItems(data, strings, locale) else null
        return BackendStatusDisplay(
            rows = rows,
            okCount = okCount,
            total = total,
            badgeLabel = badgeLabel,
            allHealthy = total > 0 && okCount == total,
            poolStats = poolStats,
            runtimeItems = runtimeItems,
            contentDescription = contentDescription(badgeLabel, poolStats, runtimeItems, strings),
        )
    }

    /**
     * Sort [rows] per [sort] — the native port of the web `DataTable` client sort over the three sortable
     * columns. A `null` key keeps wire/insertion order (web `Object.entries`). Name sorts case-insensitively;
     * latency / failures sort numerically. A stable sort preserves insertion order within ties.
     */
    fun sortRows(
        rows: List<ComponentRow>,
        sort: SortState,
    ): List<ComponentRow> {
        val comparator: Comparator<ComponentRow>? =
            when (sort.key) {
                BackendStatusColumns.NAME -> compareBy { it.name.lowercase(Locale.ROOT) }
                BackendStatusColumns.LATENCY -> compareBy { it.latencyMs }
                BackendStatusColumns.FAILURES -> compareBy { it.failures }
                else -> null
            }
        if (comparator == null) return rows
        val ordered = rows.sortedWith(comparator)
        return if (sort.direction == SortDirection.Desc) ordered.reversed() else ordered
    }

    /**
     * Human-readable uptime — the native port of the web `formatUptime`: `Xd Yh Zm` once past a day, `Yh Zm`
     * once past an hour, else `Zm`.
     */
    fun formatUptime(seconds: Long): String {
        val safe = seconds.coerceAtLeast(0)
        val days = safe / SECONDS_PER_DAY
        val hours = (safe % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        val mins = (safe % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return when {
            days > 0 -> "${days}d ${hours}h ${mins}m"
            hours > 0 -> "${hours}h ${mins}m"
            else -> "${mins}m"
        }
    }

    /** Integer with locale grouping — the native port of the web `fmtInt`. */
    fun formatInt(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", value)

    /**
     * Format an ISO `last_check` instant for display — the native port of the web `formatDateTime` (a
     * localized medium date + short time). A blank or unparseable value yields the em-dash, mirroring the
     * web `row.lastCheck ? formatDateTime(row.lastCheck) : '—'` guard. Tolerant of an RFC-3339 instant, an
     * offset date-time, then a zoneless local date-time treated as UTC.
     */
    fun formatLastCheck(
        iso: String,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = if (iso.isBlank()) null else parseInstant(iso)
        return if (instant == null) {
            EM_DASH
        } else {
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zone)
                .format(instant)
        }
    }

    private fun poolStats(
        pool: PoolSnapshot,
        strings: BackendStatusSectionStrings,
        locale: Locale,
    ): List<PoolStat> =
        listOf(
            PoolStat("max_open", strings.maxOpen, formatInt(pool.maxOpen, locale)),
            PoolStat("open", strings.open, formatInt(pool.open, locale)),
            PoolStat("in_use", strings.inUse, formatInt(pool.inUse, locale)),
            PoolStat("idle", strings.idle, formatInt(pool.idle, locale)),
            PoolStat("wait_count", strings.waitCount, formatInt(pool.waitCount, locale)),
        )

    private fun runtimeItems(
        data: BackendStatusData,
        strings: BackendStatusSectionStrings,
        locale: Locale,
    ): List<RuntimeItem> {
        val version = data.version
        val system = data.health?.system
        val goVersion = version?.goVersion ?: system?.goVersion ?: EM_DASH
        val uptimeSeconds = version?.uptimeSeconds ?: system?.uptimeSeconds ?: 0L
        val goroutines = version?.goroutines ?: system?.goroutines ?: 0L
        val osArch = if (version != null) "${version.os ?: EM_DASH} / ${version.arch ?: EM_DASH}" else EM_DASH
        return listOf(
            RuntimeItem(strings.goVersion, goVersion),
            RuntimeItem(strings.uptime, formatUptime(uptimeSeconds)),
            RuntimeItem(strings.goroutines, formatInt(goroutines, locale)),
            RuntimeItem(strings.osArch, osArch),
        )
    }

    private fun contentDescription(
        badgeLabel: String?,
        poolStats: List<PoolStat>?,
        runtimeItems: List<RuntimeItem>?,
        strings: BackendStatusSectionStrings,
    ): String {
        val parts = mutableListOf<String>()
        badgeLabel?.let { parts.add(it) }
        if (poolStats != null) {
            parts.add(strings.databaseConnectionPool)
            poolStats.forEach { parts.add("${it.label} ${it.value}") }
        }
        if (runtimeItems != null) {
            parts.add(strings.systemRuntime)
            runtimeItems.forEach { parts.add("${it.label} ${it.value}") }
        }
        return parts.joinToString(DESC_SEPARATOR)
    }

    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: java.time.format.DateTimeParseException) {
            null
        }

    private const val LATENCY_DECIMALS = 1
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L
}

private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
