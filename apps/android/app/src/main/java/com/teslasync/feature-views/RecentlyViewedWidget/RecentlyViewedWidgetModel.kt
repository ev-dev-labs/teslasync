// Pure, framework-free model + projection for the Recently Viewed feature view — the native analogue of
// everything the web component computes before returning JSX
// (web/src/features/dashboard/components/RecentlyViewedWidget.tsx + its backing client store
// web/src/lib/recentPages.ts). No Compose, no Android, no HTTP: every type here is unit-tested off-device
// in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web widget reads a privacy-sensitive, client-side LRU of recently visited routes (localStorage,
// newest-first, capped at RECENT_PAGES_MAX) and renders the top RECENT_PAGES_DISPLAY_LIMIT as clickable
// links — each an icon (chosen by page "kind"), the captured title, and a short relative-time label
// (`Just now` / `Xm` / `Xh` / `Xd`) — or, when empty, a plain non-actionable hint. This file owns the
// kind taxonomy + its web wire strings, the entry shape, the relative-time formatter (a verbatim port of
// the web `formatRelative`), the defensive store decoder (a verbatim port of the web `load()`), and the
// newest-first/limit/relative projection to render-ready rows.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentlyViewedWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentlyviewed

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L

private const val KEY_PATH = "path"
private const val KEY_TITLE = "title"
private const val KEY_KIND = "kind"
private const val KEY_REF_ID = "ref_id"
private const val KEY_VISITED_AT = "visited_at"

/**
 * Coarse category for a recorded page — the native mirror of the web `RecentPageKind` union. Drives the
 * icon shown per row. [wire] is the exact string the web store persists (`web/src/lib/recentPages.ts`),
 * so a list serialized by any client decodes identically; an unknown/forward-compatible kind read from
 * storage surfaces as [Page] (web "unknown kinds … are surfaced as `'page'`").
 */
enum class RecentPageKind(
    val wire: String,
) {
    Page("page"),
    Vehicle("vehicle"),
    Drive("drive"),
    Trip("trip"),
    Charging("charging"),
    Geofence("geofence"),
    YearReview("year-review"),
    ;

    companion object {
        /** Resolve a persisted [wire] string to its kind, defaulting to [Page] for unknown values. */
        fun fromWire(wire: String): RecentPageKind = entries.firstOrNull { it.wire == wire } ?: Page
    }
}

/**
 * One recorded visit — the native mirror of the web `RecentEntry`. [path] is the pathname (used for both
 * navigation and dedup), [title] the captured display title, [kind] the coarse category, [refId] the
 * optional captured id when the path carried an `:id`-style param, and [visitedAt] the epoch-millisecond
 * stamp of the most recent visit.
 */
data class RecentPageEntry(
    val path: String,
    val title: String,
    val kind: RecentPageKind,
    val visitedAt: Long,
    val refId: String? = null,
)

/**
 * One projected, render-ready row — the native analogue of the JSX the web `entries.map(...)` emits per
 * entry. Pure data (no Compose types): the navigation [path], the display [title] (web title, with a
 * path fallback so a row is never blank), the [kind] (selects the row glyph at the Compose boundary), the
 * already-formatted [relativeLabel] (web `formatRelative`), and a folded TalkBack [contentDescription] so
 * the whole row reads as a single node.
 */
data class RecentlyViewedRow(
    val path: String,
    val title: String,
    val kind: RecentPageKind,
    val relativeLabel: String,
    val contentDescription: String,
)

/**
 * The six localized strings the surface folds in — the web `t('recentPages.*', default)` calls. The
 * composable builds this from the i18n catalog (P1/S10) via `stringResource`; tests pass a deterministic
 * instance.
 */
data class RecentlyViewedStrings(
    val widgetTitle: String,
    val empty: String,
    val justNow: String,
    val shortMinute: String,
    val shortHour: String,
    val shortDay: String,
)

/**
 * Canonical metadata for this surface. The web source is a dashboard *component* (not a registry grid
 * widget), so there is no registry id/footprint to mirror — only the diagnostics [SLUG] (P1/S11), the
 * display cap + storage cap (web `RECENT_PAGES_DISPLAY_LIMIT` / `RECENT_PAGES_MAX`), and the persisted
 * store coordinates the read-only [RecentPagesStore] binds to.
 */
object RecentlyViewedRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RecentlyViewedWidget"

    /** Default number of rows shown (web `RECENT_PAGES_DISPLAY_LIMIT`). */
    const val DISPLAY_LIMIT = 5

    /** Hard cap on entries read from the store (web `RECENT_PAGES_MAX`). */
    const val MAX_ENTRIES = 50

    /** SharedPreferences file the recent-pages list is persisted in (client-side only, never synced). */
    const val PREFS_NAME = "teslasync_recent_pages"

    /** Versioned entry key inside [PREFS_NAME] (mirrors the web `teslasync:recent-pages:v1` storage key). */
    const val STORAGE_KEY = "teslasync:recent-pages:v1"
}

/**
 * Render a visit's age relative to [nowMillis] exactly as the web `formatRelative` does: under a minute
 * is [RecentlyViewedStrings.justNow], under an hour is `Xm`, under a day is `Xh`, otherwise `Xd`. A
 * future-dated stamp clamps to zero ("just now"), never a negative age.
 */
fun formatRelative(
    visitedAtMillis: Long,
    nowMillis: Long,
    strings: RecentlyViewedStrings,
): String {
    val diffMs = (nowMillis - visitedAtMillis).coerceAtLeast(0L)
    val minutes = diffMs / MILLIS_PER_MINUTE
    val hours = minutes / MINUTES_PER_HOUR
    val days = hours / HOURS_PER_DAY
    return when {
        minutes < 1L -> strings.justNow
        minutes < MINUTES_PER_HOUR -> "$minutes${strings.shortMinute}"
        hours < HOURS_PER_DAY -> "$hours${strings.shortHour}"
        else -> "$days${strings.shortDay}"
    }
}

/**
 * Decoder for the persisted recent-pages JSON — a verbatim port of the web `load()`: it tolerates a
 * null/blank/corrupt value (returning an empty list rather than throwing), accepts only well-formed
 * entries (a non-blank string `path`, string `title`, string `kind`, and a finite numeric `visited_at`),
 * preserves the stored newest-first order, and stops at [RecentlyViewedRegistration.MAX_ENTRIES]. Pure +
 * JVM-testable so the "cached → projection" adapter path is covered off-device.
 */
object RecentPagesCodec {
    private val json = Json { ignoreUnknownKeys = true }

    /** Decode [raw] into the recent-page entries, returning an empty list for any malformed input. */
    fun decode(raw: String?): List<RecentPageEntry> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { parseArray(raw) }.getOrDefault(emptyList())
    }

    private fun parseArray(raw: String): List<RecentPageEntry> {
        val array = json.parseToJsonElement(raw) as? JsonArray ?: return emptyList()
        return array
            .asSequence()
            .mapNotNull { element -> (element as? JsonObject)?.let(::parseEntry) }
            .take(RecentlyViewedRegistration.MAX_ENTRIES)
            .toList()
    }

    // Each required field is validated as its own guard clause: the per-field early returns read far more
    // clearly than one folded condition, so ReturnCount is suppressed for this single decoder.
    @Suppress("ReturnCount")
    private fun parseEntry(obj: JsonObject): RecentPageEntry? {
        val path = obj.stringField(KEY_PATH)?.takeIf { it.isNotBlank() } ?: return null
        val title = obj.stringField(KEY_TITLE) ?: return null
        val kind = obj.stringField(KEY_KIND) ?: return null
        val visitedAt = obj.finiteLongField(KEY_VISITED_AT) ?: return null
        return RecentPageEntry(
            path = path,
            title = title,
            kind = RecentPageKind.fromWire(kind),
            visitedAt = visitedAt,
            refId = obj.stringField(KEY_REF_ID),
        )
    }

    /** Read [name] as a JSON string primitive (web `typeof x === 'string'`); any other shape is null. */
    private fun JsonObject.stringField(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Read [name] as a finite numeric primitive in milliseconds (web `Number.isFinite`); else null. */
    private fun JsonObject.finiteLongField(name: String): Long? {
        val value = (this[name] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
        return value?.takeIf { it.isFinite() }?.toLong()
    }
}

/**
 * Pure projection from decoded [RecentPageEntry]s to render-ready [RecentlyViewedRow]s — the native port
 * of the web component's render body (`useRecentPages(limit)` + the per-entry `<Link>` mapping). Kept
 * framework-free so every branch is unit-tested without a UI host.
 */
object RecentlyViewedProjection {
    /**
     * The entries actually shown: newest-first then capped at [limit]. The web relies on the recorder's
     * insertion order (it `unshift`es each new visit); the native projection makes that invariant explicit
     * by sorting on [RecentPageEntry.visitedAt] descending before slicing — identical output for
     * well-formed data, robust against an out-of-order store.
     */
    fun visible(
        entries: List<RecentPageEntry>,
        limit: Int,
    ): List<RecentPageEntry> = entries.sortedByDescending { it.visitedAt }.take(limit.coerceAtLeast(0))

    /** Map already-[visible] entries to render-ready rows, formatting each age against [nowMillis]. */
    fun rows(
        entries: List<RecentPageEntry>,
        nowMillis: Long,
        strings: RecentlyViewedStrings,
    ): List<RecentlyViewedRow> = entries.map { row(it, nowMillis, strings) }

    /** Project a single entry: title (with a path fallback) + relative age + a folded content description. */
    fun row(
        entry: RecentPageEntry,
        nowMillis: Long,
        strings: RecentlyViewedStrings,
    ): RecentlyViewedRow {
        val title = entry.title.ifBlank { entry.path }
        val relative = formatRelative(entry.visitedAt, nowMillis, strings)
        return RecentlyViewedRow(
            path = entry.path,
            title = title,
            kind = entry.kind,
            relativeLabel = relative,
            contentDescription = "$title, $relative",
        )
    }

    /** Convenience for tests + the render layer: decode-ready entries → newest-first, capped, formatted rows. */
    fun project(
        entries: List<RecentPageEntry>,
        limit: Int,
        nowMillis: Long,
        strings: RecentlyViewedStrings,
    ): List<RecentlyViewedRow> = rows(visible(entries, limit), nowMillis, strings)
}
