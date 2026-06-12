// Pure, framework-free model + projection for the FSMHealthPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/FSMHealthPanel.tsx + its `@/types/fsm` FSMTransition type).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — its parent (the FSM monitoring page) fetches the
// `FSMTransition[]` and passes it down; the component's only hook is `useTranslation`. This file owns the
// part the web component computes from that prop inside its `useMemo`: the three health alerts (state
// flapping, stuck sessions, pod recoveries) and the parity `computeFlapIds` export. An empty alert list
// renders the friendly "all clear" panel (web `alerts.length === 0`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FSMHealthPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmhealthpanel

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** Em dash used as a neutral fallback for an unparseable timestamp (parity with the web invalid-date guard). */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object FSMHealthPanelRegistration {
    /** Stable surface id. */
    const val ID: String = "fsm-health-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); carries no fleet payload. */
    const val SLUG: String = "FSMHealthPanel"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('fsm.health.*')` keys, flattened to the generated Android catalog names. Referencing them in
// one place keeps the composable and the off-device test in lockstep with the catalog and documents the
// web → native key contract.

/** Panel heading — web `t('fsm.health.title', 'FSM Health')`. */
const val KEY_TITLE: String = "translation_fsm_health_title"

/** Healthy "no alerts" copy — web `t('fsm.health.allClear', …)`. */
const val KEY_ALL_CLEAR: String = "translation_fsm_health_allClear"

/** Flap card title — web `t('fsm.health.flapTitle', 'State Flapping')`. */
const val KEY_FLAP_TITLE: String = "translation_fsm_health_flapTitle"

/** Stuck card title — web `t('fsm.health.stuckTitle', 'Stuck Sessions')`. */
const val KEY_STUCK_TITLE: String = "translation_fsm_health_stuckTitle"

/** Recovery card title — web `t('fsm.health.recoveryTitle', 'Pod Recoveries')`. */
const val KEY_RECOVERY_TITLE: String = "translation_fsm_health_recoveryTitle"

/** Flap card message template (one `%1$s` count) — web `t('fsm.health.flapping', …, { count })`. */
const val KEY_FLAPPING: String = "translation_fsm_health_flapping"

/** Stuck card message template (one `%1$s` count) — web `t('fsm.health.stuck', …, { count })`. */
const val KEY_STUCK: String = "translation_fsm_health_stuck"

/** Recovery card message template (one `%1$s` count) — web `t('fsm.health.recoveries', …, { count })`. */
const val KEY_RECOVERIES: String = "translation_fsm_health_recoveries"

// ── Wire model (the web `@/types/fsm` FSMTransition) ──

/**
 * One finite-state-machine transition row — the native analogue of the web `FSMTransition` interface. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host. The optional freeform
 * `details` map from the web type is intentionally omitted: the panel never reads it.
 *
 * @property id stable transition id (web `id`); the unit the flap detector dedupes on.
 * @property vehicleId owning vehicle (web `vehicle_id`); part of the stuck-session instance key.
 * @property ts RFC-3339 occurrence time (web `ts`).
 * @property fsmName the FSM that transitioned (web `fsm_name`), e.g. `drive_session`.
 * @property fromState prior state (web `from_state`).
 * @property toState resulting state (web `to_state`); drives the stuck + recovery detectors.
 * @property trigger what caused the transition (web `trigger`).
 */
data class FSMTransition(
    val id: Long,
    val vehicleId: Long,
    val ts: String,
    val fsmName: String,
    val fromState: String,
    val toState: String,
    val trigger: String,
)

// ── Alert taxonomy (the web `HealthAlert`) ──

/** The kind of health alert — web `HealthAlert['type']` (`'flap' | 'stuck' | 'recovery'`). */
enum class FSMHealthAlertType {
    Flap,
    Stuck,
    Recovery,
}

/** Alert severity — web `HealthAlert['severity']` (`'warning' | 'info'`); drives the accent + tint. */
enum class FSMHealthSeverity {
    Warning,
    Info,
}

/**
 * Pure glyph key for an alert marker — the native analogue of the web `lucide-react` icon switch
 * (`flap → AlertTriangle`, `stuck → Timer`, `recovery → RotateCw`). The composable resolves each key to a
 * concrete `ImageVector`, keeping selection unit-testable off-device.
 */
enum class FSMHealthGlyph {
    AlertTriangle,
    Timer,
    RotateCw,
}

/**
 * One computed health alert — the native mirror of the web `HealthAlert`, minus the already-localized
 * message (resolved at the render boundary). Pure data so the detector is fully covered off-device.
 *
 * @property type which detector fired.
 * @property severity the alert severity (derived from [type] via [FSMHealthProjection.severityFor]).
 * @property count the alert's magnitude (flapped transitions / stuck sessions / recoveries).
 */
data class FSMHealthAlert(
    val type: FSMHealthAlertType,
    val severity: FSMHealthSeverity,
    val count: Int,
)

/**
 * The localized microcopy the projection folds into each card — the empty-state [allClear] line, the panel
 * [title], the three card titles, and the three `%1$s`-count message templates the web reads through
 * `useTranslation`. The composable builds this from `stringResource`; tests pass a deterministic instance.
 */
data class FSMHealthStrings(
    val title: String,
    val allClear: String,
    val flapTitle: String,
    val stuckTitle: String,
    val recoveryTitle: String,
    val flapMessage: String,
    val stuckMessage: String,
    val recoveryMessage: String,
)

/**
 * One fully projected, render-ready alert card — the native analogue of a single rendered web alert tile.
 * Pure data (no Compose types); the composable maps [glyph]/[severity] to an `ImageVector`/`Color`.
 *
 * @property type the underlying alert kind (stable list key).
 * @property title the localized card title.
 * @property message the localized message with the count interpolated (web `{{count}}`, raw — no grouping).
 * @property countText the big-number badge, grouped like the web `fmtInt(alert.count)`.
 * @property glyph the marker glyph key.
 * @property severity the accent/tint role.
 */
data class FSMHealthCard(
    val type: FSMHealthAlertType,
    val title: String,
    val message: String,
    val countText: String,
    val glyph: FSMHealthGlyph,
    val severity: FSMHealthSeverity,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo` alert
 * derivation plus its `computeFlapIds` export. Stateless and side-effect-free (a [nowMillis] seam replaces
 * `Date.now()`) so it is fully covered by the off-device unit gate.
 */
object FSMHealthProjection {
    /** Rolling flap window — web `60_000` ms. */
    private const val FLAP_WINDOW_MS: Long = 60_000L

    /** A flap fires on **more than** this many same-FSM transitions inside [FLAP_WINDOW_MS] — web `count > 5`. */
    private const val FLAP_THRESHOLD: Int = 5

    /** Stuck-session age threshold — web `4 * 60 * 60 * 1000` ms. */
    private const val FOUR_HOURS_MS: Long = 4L * 60L * 60L * 1_000L

    /** Session FSMs the stuck detector inspects — web `['drive_session', 'charge_session']`. */
    private val SESSION_TYPES: Set<String> = setOf("drive_session", "charge_session")

    /** States considered "stuck" when held past the age threshold — web `['pending', 'active']`. */
    private val STUCK_STATES: Set<String> = setOf("pending", "active")

    /** The post-restart recovery target state — web `tr.to_state === 'recovered'`. */
    private const val RECOVERED_STATE: String = "recovered"

    /** A timestamp paired with its transition id — the unit the windowing operates on. */
    private data class TsPoint(
        val millis: Long,
        val id: Long,
    )

    /**
     * Computes the ordered alert list for the supplied [transitions], reproducing the web `useMemo` exactly:
     * flapping (if any) first, then stuck sessions, then pod recoveries — each emitted only when its count is
     * positive. [nowMillis] replaces the web `Date.now()` so the stuck detector is deterministic in tests.
     *
     * Flap count parity: the web captures `flapped.size` the first time the accumulating set becomes
     * non-empty while iterating FSM groups in first-seen order — not the final total — so this does the same.
     */
    fun computeAlerts(
        transitions: List<FSMTransition>,
        nowMillis: Long,
    ): List<FSMHealthAlert> {
        val alerts = mutableListOf<FSMHealthAlert>()

        // ── Flap detection: >5 transitions of the same FSM within any rolling 1-minute window ──
        val flapped = LinkedHashSet<Long>()
        var flapAlertCount: Int? = null
        for ((_, points) in groupByFsm(transitions)) {
            flapped.addAll(flappedIdsInGroup(points))
            if (flapped.isNotEmpty() && flapAlertCount == null) flapAlertCount = flapped.size
        }
        flapAlertCount?.let { alerts.add(alertOf(FSMHealthAlertType.Flap, it)) }

        // ── Stuck detection: latest state of each session FSM instance is pending/active for >4 hours ──
        val instanceLatest = LinkedHashMap<String, FSMTransition>()
        for (tr in transitions) {
            if (tr.fsmName !in SESSION_TYPES) continue
            val key = "${tr.fsmName}:${tr.vehicleId}"
            val existing = instanceLatest[key]
            if (existing == null || parseTsMillis(tr.ts) > parseTsMillis(existing.ts)) {
                instanceLatest[key] = tr
            }
        }
        val stuckCount =
            instanceLatest.values.count { tr ->
                tr.toState in STUCK_STATES && (nowMillis - parseTsMillis(tr.ts)) > FOUR_HOURS_MS
            }
        if (stuckCount > 0) alerts.add(alertOf(FSMHealthAlertType.Stuck, stuckCount))

        // ── Recovery count: transitions whose resulting state is "recovered" ──
        val recoveryCount = transitions.count { it.toState == RECOVERED_STATE }
        if (recoveryCount > 0) alerts.add(alertOf(FSMHealthAlertType.Recovery, recoveryCount))

        return alerts
    }

    /**
     * The parity port of the web `computeFlapIds` export — the **full** set of transition ids flagged as
     * flapping across every FSM group (insertion-ordered), for a parent that wants to highlight them. Unlike
     * the alert count this is the complete set, not the first-group snapshot.
     */
    fun computeFlapIds(transitions: List<FSMTransition>): Set<Long> {
        val flapped = LinkedHashSet<Long>()
        for ((_, points) in groupByFsm(transitions)) flapped.addAll(flappedIdsInGroup(points))
        return flapped
    }

    /** Severity for an alert type — web `severity: 'warning' | 'info'`. */
    fun severityFor(type: FSMHealthAlertType): FSMHealthSeverity =
        when (type) {
            FSMHealthAlertType.Flap -> FSMHealthSeverity.Warning
            FSMHealthAlertType.Stuck -> FSMHealthSeverity.Warning
            FSMHealthAlertType.Recovery -> FSMHealthSeverity.Info
        }

    /** Marker glyph for an alert type — web `AlertTriangle | Timer | RotateCw`. */
    fun glyphFor(type: FSMHealthAlertType): FSMHealthGlyph =
        when (type) {
            FSMHealthAlertType.Flap -> FSMHealthGlyph.AlertTriangle
            FSMHealthAlertType.Stuck -> FSMHealthGlyph.Timer
            FSMHealthAlertType.Recovery -> FSMHealthGlyph.RotateCw
        }

    /** Localized title for an alert type. */
    fun titleFor(
        type: FSMHealthAlertType,
        strings: FSMHealthStrings,
    ): String =
        when (type) {
            FSMHealthAlertType.Flap -> strings.flapTitle
            FSMHealthAlertType.Stuck -> strings.stuckTitle
            FSMHealthAlertType.Recovery -> strings.recoveryTitle
        }

    /** Localized `%1$s`-count message template for an alert type. */
    fun messageTemplateFor(
        type: FSMHealthAlertType,
        strings: FSMHealthStrings,
    ): String =
        when (type) {
            FSMHealthAlertType.Flap -> strings.flapMessage
            FSMHealthAlertType.Stuck -> strings.stuckMessage
            FSMHealthAlertType.Recovery -> strings.recoveryMessage
        }

    /**
     * Projects [alerts] into render-ready [FSMHealthCard]s. The message interpolates the **raw** count (web
     * passes `{ count }` to i18next, which does not group), while [formatCount] produces the grouped big-number
     * badge (web `fmtInt(alert.count)`); injecting it keeps this locale-deterministic for tests.
     */
    fun cards(
        alerts: List<FSMHealthAlert>,
        strings: FSMHealthStrings,
        formatCount: (Int) -> String,
    ): List<FSMHealthCard> =
        alerts.map { alert ->
            FSMHealthCard(
                type = alert.type,
                title = titleFor(alert.type, strings),
                message = messageTemplateFor(alert.type, strings).format(alert.count.toString()),
                countText = formatCount(alert.count),
                glyph = glyphFor(alert.type),
                severity = alert.severity,
            )
        }

    private fun alertOf(
        type: FSMHealthAlertType,
        count: Int,
    ): FSMHealthAlert = FSMHealthAlert(type = type, severity = severityFor(type), count = count)

    /** Groups transitions by FSM name in first-seen order, each group sorted ascending by timestamp. */
    private fun groupByFsm(transitions: List<FSMTransition>): Map<String, List<TsPoint>> {
        val byType = LinkedHashMap<String, MutableList<TsPoint>>()
        for (tr in transitions) {
            byType.getOrPut(tr.fsmName) { mutableListOf() }.add(TsPoint(parseTsMillis(tr.ts), tr.id))
        }
        return byType.mapValues { (_, points) -> points.sortedBy { it.millis } }
    }

    /**
     * The ids flagged as flapping inside a single FSM group — the web inner double-loop. For each starting
     * point, count the run of points within the trailing 60s window; once a window exceeds the threshold,
     * every point in it is flagged. Points are pre-sorted ascending, so the window terminates at the first
     * point beyond it (the web `else break`).
     */
    private fun flappedIdsInGroup(points: List<TsPoint>): Set<Long> {
        val flagged = LinkedHashSet<Long>()
        for (i in points.indices) {
            val windowEnd = points[i].millis + FLAP_WINDOW_MS
            var count = 0
            var j = i
            while (j < points.size && points[j].millis <= windowEnd) {
                count++
                j++
            }
            if (count > FLAP_THRESHOLD) {
                var k = i
                while (k < points.size && points[k].millis <= windowEnd) {
                    flagged.add(points[k].id)
                    k++
                }
            }
        }
        return flagged
    }

    /**
     * Tolerant RFC-3339 → epoch-millis parse — the native analogue of the web `new Date(ts).getTime()`. Tries
     * an instant (`…Z`), then an offset date-time, then a zoneless local date-time treated as UTC. A blank or
     * unparseable input yields `0L` (epoch) so comparisons stay total; production timestamps are always valid.
     */
    internal fun parseTsMillis(ts: String): Long {
        if (ts.isBlank()) return 0L
        return tryMillis { Instant.parse(ts) }
            ?: tryMillis { OffsetDateTime.parse(ts).toInstant() }
            ?: tryMillis { LocalDateTime.parse(ts).toInstant(ZoneOffset.UTC) }
            ?: 0L
    }

    private inline fun tryMillis(block: () -> Instant): Long? =
        try {
            block().toEpochMilli()
        } catch (_: DateTimeParseException) {
            null
        }
}

// ── Lifecycle classifier (per-state coverage) ──

/**
 * The mutually-exclusive top-level surface the composable switches on — the native lifecycle chrome the
 * host's cache-then-network feed implies around the web component's all-clear/alerts branches. [Ready] then
 * internally renders the alert cards or the "all clear" panel from the computed alerts; [Loading]/[Error]
 * render the first-load skeleton and the retry surface.
 */
enum class FSMHealthSurface {
    Loading,
    Error,
    Ready,
}

/**
 * Classifies the lifecycle flags of a `UiState` into the surface to render. A first load with nothing cached
 * shows [Loading]; a hard error with no cached fallback shows [Error]; everything else (content, empty, and
 * stale/offline "last known") is [Ready] and lets the computed alerts decide all-clear-vs-cards. Loading
 * takes precedence over error so a refresh-with-skeleton never flashes the error surface.
 */
fun fsmHealthSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): FSMHealthSurface =
    when {
        isLoading -> FSMHealthSurface.Loading
        isError -> FSMHealthSurface.Error
        else -> FSMHealthSurface.Ready
    }
