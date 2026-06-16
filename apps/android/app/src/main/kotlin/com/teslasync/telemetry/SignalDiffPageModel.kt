// Pure, framework-free model + projections for the SignalDiffPage telemetry surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/telemetry/pages/SignalDiffPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// shared-core models + the sibling feature-view projection), so the composable stays a thin render layer and every
// derivation is unit-tested off-device in the :android:testDebugUnitTest gate.
//
// The web page owns five concerns this file ports: (1) the local interaction state — the selected vehicle, the two
// `datetime-local` snapshot windows, the signal filter, and the active category chip (web `useUrlState`/`useState`);
// (2) the pinned-signal projection from the `pinned_items` rows (web `pinnedSignals` set, item_type='widget',
// context='signal-diff:vehicle:N'); (3) the filtered-row derivation feeding the "Changed signals" / "Visible after
// filter" stat cards (web `allRows` / `filteredRows`); (4) the window-span stat (web `|atB - atA| / 1000 s`); and
// (5) the bulk-action payloads — the CSV export (web `objectsToCSV` + `downloadCSV`) and the alert-studio
// `signals=` query payload. The per-row cell formatting + delta + sort logic is reused verbatim from the sibling
// SignalDiffTable feature-view projection (DRY), so the two telemetry surfaces can never drift.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin/feature surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signaldiff

import io.teslasync.android.featureviews.signalcomparecontrols.DiffCategory
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareTime
import io.teslasync.android.featureviews.signaldifftable.SignalDiffRowVm
import io.teslasync.android.featureviews.signaldifftable.SignalDiffTableProjection
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SignalDiffPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("signalDiff", "/signal-diff", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to
 * that destination (and its `/signal-diff` deep link) without the nav module depending on it. The pin helpers
 * reproduce the web page's `item_type='widget'` + `context='signal-diff:vehicle:N'` + `item_id='signal:NAME'`
 * convention verbatim so a pin round-trips across the web and native surfaces unchanged.
 */
object SignalDiffPageRegistration {
    /** The navigation destination id (Destinations.kt `page("signalDiff", "/signal-diff", …)`). */
    const val ROUTE_ID: String = "signalDiff"

    /** The web route this surface mirrors (deep-link + share target). */
    const val WEB_PATH: String = "/signal-diff"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "SignalDiffPage"

    /** The `item_id` prefix a pinned signal carries (web `signal:${row.name}`). */
    const val PIN_ITEM_PREFIX: String = "signal:"

    private const val PIN_CONTEXT_PREFIX: String = "signal-diff:vehicle:"
    private const val SHARE_BASE: String = "teslasync://app/signal-diff"

    /** The pinned-items `context` bucket for [vehicleId] (web `signal-diff:vehicle:${vehicleId}`). */
    fun pinContext(vehicleId: Long): String = "$PIN_CONTEXT_PREFIX$vehicleId"

    /** The pinned-items `item_id` for a signal [name] (web `signal:${row.name}`). */
    fun pinItemId(name: String): String = "$PIN_ITEM_PREFIX$name"

    /** The share-link base (the native deep-link analogue of the web permalink origin + pathname). */
    fun shareBase(): String = SHARE_BASE
}

private const val HOUR_MILLIS: Long = 3_600_000L
private const val SECONDS_DIVISOR: Double = 1_000.0

/** Em dash shown for an unresolved window span — the web `'—'` stat fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * The page's local interaction snapshot — the union of the web component's URL-synced state cells: the selected
 * [vehicleId] (`null` until resolved to the first vehicle, web `vehicleIdParam || vehicles?.[0]?.id`), the two
 * `datetime-local` snapshot windows [atA] / [atB] (web `a` / `b`), the signal [filter] (web `q`), and the active
 * [category] chip id or `null` (web `cat`). The windows/search/category are carried as the controls' own controlled
 * props so the `SignalCompareControls` change callbacks bind to this snapshot with no adapter.
 */
data class SignalDiffInteraction(
    val vehicleId: Long? = null,
    val atA: String = "",
    val atB: String = "",
    val filter: String = "",
    val category: String? = null,
)

/**
 * The default interaction at mount — Window A is one hour before [nowMillis] and Window B is "now", formatted as
 * `datetime-local` strings in [zone] (web `defaultAtA = toLocalDatetimeInput(now - 3600s)`,
 * `defaultAtB = toLocalDatetimeInput(now)`). [nowMillis] / [zone] are injected so the default is deterministic
 * under test, never read from a global clock here.
 */
fun defaultInteraction(
    nowMillis: Long,
    zone: ZoneId,
): SignalDiffInteraction =
    SignalDiffInteraction(
        atA = SignalCompareTime.toLocalDatetimeInput(nowMillis - HOUR_MILLIS, zone),
        atB = SignalCompareTime.toLocalDatetimeInput(nowMillis, zone),
    )

/**
 * Resolves the vehicle the page operates on — the web `vehicleId = vehicleIdParam || vehicles?.[0]?.id || 0`. An
 * explicit [selected] id wins; otherwise the first vehicle in [vehicles] (the live list) is used; a still-empty
 * list resolves to `0` (the disabled-query sentinel).
 */
fun resolveVehicleId(
    selected: Long?,
    vehicles: List<Vehicle>?,
): Long = selected ?: vehicles?.firstOrNull()?.id ?: 0L

/**
 * The pinned signal names from the `pinned_items` rows — the web `pinnedSignals` set. Only rows whose `item_id`
 * carries the `signal:` prefix contribute, each stripped back to its bare signal name (web
 * `p.item_id?.startsWith('signal:') ? p.item_id.slice('signal:'.length)`).
 */
fun pinnedSignalNames(items: List<PinnedItem>): Set<String> =
    items
        .mapNotNull { item ->
            if (item.itemId.startsWith(SignalDiffPageRegistration.PIN_ITEM_PREFIX)) {
                item.itemId.removePrefix(SignalDiffPageRegistration.PIN_ITEM_PREFIX)
            } else {
                null
            }
        }.toSet()

/**
 * The rows visible after the page's filters — the web `filteredRows`: the case-insensitive name filter (reused from
 * the sibling table projection) intersected with the active category prefix matcher (web `CATEGORY_PREFIXES`). A
 * blank filter + no category returns every row.
 */
fun visibleRows(
    rows: List<SignalDiffRowVm>,
    filter: String,
    category: String?,
): List<SignalDiffRowVm> {
    val byName = SignalDiffTableProjection.filterRows(rows, filter)
    val cat = DiffCategory.fromId(category) ?: return byName
    return byName.filter { cat.matches(it.name) }
}

/** Whether any page filter is active — the web `filterActive` (drives the empty-state copy + branch). */
fun filterActive(
    filter: String,
    category: String?,
): Boolean = filter.trim().isNotEmpty() || category != null

/**
 * The window span in seconds between the two ISO instants — the web
 * `Math.abs(new Date(atBIso) - new Date(atAIso)) / 1000`. A blank or unparseable instant yields `null` (the stat
 * renders the em-dash fallback).
 */
fun windowSpanSeconds(
    atAIso: String,
    atBIso: String,
): Double? {
    if (atAIso.isBlank() || atBIso.isBlank()) return null
    return runCatching {
        abs(Instant.parse(atBIso).toEpochMilli() - Instant.parse(atAIso).toEpochMilli()) / SECONDS_DIVISOR
    }.getOrNull()
}

/** Formats the window-span stat value — `"${seconds} s"`, integral when whole, or the em dash when unresolved. */
fun formatWindowSpan(seconds: Double?): String {
    if (seconds == null) return EM_DASH
    val whole = seconds.toLong()
    val isWhole = seconds - whole == 0.0
    val text = if (isWhole) whole.toString() else seconds.toString()
    return "$text s"
}

/**
 * The CSV export for the selected rows — the web bulk `Copy CSV` action (`objectsToCSV` of
 * `{signal, window_a, window_b, source_a, source_b}`). Values are the already-formatted display cells (the raw SI
 * the backend serves, formatted by the shared projection); fields are RFC-4180-quoted when they contain a comma,
 * quote, or newline so a value can never corrupt the row layout.
 */
fun buildDiffCsv(rows: List<SignalDiffRowVm>): String {
    val header = "signal,window_a,window_b,source_a,source_b"
    val body =
        rows.map { row ->
            listOf(row.name, row.valueA, row.valueB, row.sourceA.orEmpty(), row.sourceB.orEmpty())
                .joinToString(",") { csvField(it) }
        }
    return (listOf(header) + body).joinToString("\n")
}

/** RFC-4180 field quoting: wrap in quotes (doubling inner quotes) only when the value needs it. */
private fun csvField(value: String): String {
    val needsQuote = value.contains(',') || value.contains('"') || value.contains('\n')
    val escaped = value.replace("\"", "\"\"")
    return if (needsQuote) "\"$escaped\"" else escaped
}

/**
 * The alert-studio `signals=` query payload for the selected signal names — the web bulk `Add as alert rule`
 * action (`navigate('/alert-studio?signals=' + ids.join(','))`). The native surface stages this comma-joined
 * payload (the exact value the web hands the alert-studio route) for the alert-rule builder.
 */
fun alertSignalsPayload(names: Collection<String>): String = names.joinToString(",")

/**
 * The shareable deep link for the current view — the native analogue of the web permalink
 * (`origin + pathname + '?' + currentQuery`). Encodes the resolved [vehicleId] and the non-blank window / filter /
 * category cells of [interaction] as query params so a paste reopens the same comparison.
 */
fun buildShareLink(
    vehicleId: Long,
    interaction: SignalDiffInteraction,
): String {
    val params =
        buildList {
            if (vehicleId > 0L) add("vehicle" to vehicleId.toString())
            if (interaction.atA.isNotBlank()) add("a" to interaction.atA)
            if (interaction.atB.isNotBlank()) add("b" to interaction.atB)
            if (interaction.filter.isNotBlank()) add("q" to interaction.filter)
            interaction.category?.let { add("cat" to it) }
        }
    if (params.isEmpty()) return SignalDiffPageRegistration.shareBase()
    val query = params.joinToString("&") { (key, value) -> "$key=${encodeParam(value)}" }
    return "${SignalDiffPageRegistration.shareBase()}?$query"
}

private fun encodeParam(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SignalDiffPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, signal name, window, or value.
 */
fun recordSignalDiffPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SignalDiffPageRegistration.SLUG))
}
