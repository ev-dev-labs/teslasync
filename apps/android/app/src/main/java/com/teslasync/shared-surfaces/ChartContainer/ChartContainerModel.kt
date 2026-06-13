// Pure, framework-free model + projection for the ChartContainer shared surface — the native analogue of
// everything the web component derives before returning JSX (web/src/components/charts/ChartContainer.tsx).
// No Compose, no Android framework, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these pure functions.
//
// The web ChartContainer is a chart *frame* that is also an optional annotation host. As a frame it draws a
// title/subtitle header, an action toolbar (export menu + fullscreen), a height-bound body that switches
// between loading / empty / content, and a visually-hidden a11y `<table>` fallback built from `data` +
// `dataColumns`. When an `annotations` config is supplied it additionally fetches the durable chart
// annotations (web `useChartAnnotationsAsData`), adds an "Add annotation" + "Hide/Show annotations" toggle to
// the toolbar, renders a mobile marker row + an AnnotationList footer, hosts the AddAnnotationPopover, and
// feeds the visible annotations to the function-children render-prop.
//
// This file owns the data derivations behind that frame, split so each is unit-tested without a UI host:
//   • [chartBodyStatus]           — host loading/empty/content selection (web `loading ? … : empty ? … : …`).
//   • [chartTableHeader]/[chartTableRows]/[hasFallbackTable] — the a11y `<table>` projection (web fallback).
//   • [classifyAnnotationFeed]    — the annotation cache-then-network [UiState] → render surface (loading /
//                                   content / empty / stale / offline / hard-error), so EVERY state the
//                                   annotation data source can carry renders a non-blank affordance (P3).
//   • [visibleAnnotations]        — the hidden-toggle gate over the fetched rows (web `!hidden ? rows : []`).
//   • [ChartHiddenSeries]         — the legend-toggle state (web `useHiddenSeries`), threaded to the children.
//   • [composeAccessibleDescription] / [annotationFeedAnnouncement] — the a11y label derivations.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web frame's "error" is a render-time
// `SectionErrorBoundary` around the children, and its annotation overlay simply omits markers on a failed
// fetch. The P3 contract instead requires every data source to render every state, so the annotation feed's
// stale / offline / hard-error states surface as an explicit freshness chip + an inline retry affordance
// (never blanking the chart body, because the annotations are an overlay over host-owned content). The web
// `localStorage` persistence of the hide toggle maps to an injected [ChartHiddenPrefs] seam (see Source);
// the web URL-persisted hidden-series state maps to the in-memory [ChartHiddenSeries] (the host may persist
// it later — a documented divergence, not a silent one).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ChartContainer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling AnomalyInlineRow / AddAnnotationPopover surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartcontainer

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id,
 * annotation text, or any chart payload, so a diagnostics line can never leak the operator's fleet state.
 */
const val CHART_CONTAINER_SLUG: String = "ChartContainer"

/** The em dash the a11y fallback table renders for a `null`/absent cell (web `raw == null ? '—'`). */
internal const val EM_DASH: String = "\u2014"

/**
 * The annotation-integration config — the native port of the web `ChartAnnotationsConfig`. When supplied to
 * [io.teslasync.android.sharedsurfaces.chartcontainer], the container takes ownership of the full annotation
 * flow (fetch, add, delete, hide), exactly as the web container does when given the `annotations` prop.
 *
 * @property vehicleId scope the fetched rows to a vehicle (plus fleet-wide rows); `null` lists everything.
 * @property scope the chart bucket the annotations belong to (web `scope`, e.g. `cost`, `battery`).
 * @property chartId stable id for persisting the hide toggle; defaults to the chart title (web `chartId ?? title`).
 */
data class ChartAnnotationsConfig(
    val scope: String,
    val vehicleId: Long? = null,
    val chartId: String? = null,
) {
    /** The list-filter the annotation feed is opened with (web `{ vehicleId, scope }`). */
    fun listParams(): AnnotationListParams = AnnotationListParams(vehicleId = vehicleId, scope = scope)

    /** The persistence key for the hide toggle — the chart id, or the [title] fallback (web `chartId ?? title`). */
    fun hiddenStorageKey(title: String): String = chartId ?: title
}

// ── a11y fallback table (web `data` + `dataColumns`) ──────────────────────────────────────────────────────

/**
 * One row of the a11y fallback table — the port of the web `ChartDataRow` (`Record<string, …>`). Keys match
 * the [ChartDataColumn.key]s; a `null` value renders as the [EM_DASH] empty marker so a sparse series does not
 * hide gaps from assistive technology.
 */
typealias ChartDataRow = Map<String, Any?>

/**
 * A column definition for the a11y fallback table — the port of the web `ChartDataColumn`. [format] is the
 * unit-aware per-cell formatter (web `(v) => formatKWh(v as number)`); when omitted the value is coerced to a
 * string and `null` renders as the [EM_DASH].
 */
data class ChartDataColumn(
    val key: String,
    val label: String,
    val format: ((Any?) -> String)? = null,
)

/** The header cells of the fallback table — each column's pre-localized [ChartDataColumn.label]. */
fun chartTableHeader(columns: List<ChartDataColumn>): List<String> = columns.map { it.label }

/** Formats one fallback-table cell — the web `col.format ? col.format(raw) : raw == null ? '—' : String(raw)`. */
fun formatChartCell(
    raw: Any?,
    format: ((Any?) -> String)?,
): String =
    when {
        format != null -> format(raw)
        raw == null -> EM_DASH
        else -> raw.toString()
    }

/** Projects the [data] rows onto the fallback table's string cells in [columns] order (web `<tbody>` map). */
fun chartTableRows(
    data: List<ChartDataRow>,
    columns: List<ChartDataColumn>,
): List<List<String>> = data.map { row -> columns.map { col -> formatChartCell(row[col.key], col.format) } }

/**
 * Whether the caller supplied enough to render the structured fallback `<table>` — the web
 * `data && data.length > 0 && dataColumns && dataColumns.length > 0`. When false the body still carries its
 * accessible name; only the structured table is omitted.
 */
fun hasFallbackTable(
    data: List<ChartDataRow>?,
    columns: List<ChartDataColumn>?,
): Boolean = !data.isNullOrEmpty() && !columns.isNullOrEmpty()

/**
 * Merges the required [ariaLabel] (web `role="img" aria-label`) with the optional [ariaDescription] (web
 * figcaption prose) into the single accessible name the chart body exposes. Either may stand alone; a blank
 * description is dropped so the body never announces a trailing separator.
 */
fun composeAccessibleDescription(
    ariaLabel: String,
    ariaDescription: String?,
): String =
    if (ariaDescription.isNullOrBlank()) {
        ariaLabel
    } else {
        "$ariaLabel. $ariaDescription"
    }

// ── chart body status (host loading / empty / content) ────────────────────────────────────────────────────

/**
 * The host-driven body state — the web `loading ? <Spinner/> : empty ? <EmptyState/> : children`, extended
 * with an explicit [Error] so the P3 contract's hard-error state renders a `QueryError`-equivalent with retry
 * (the web frame's error is a render-time `SectionErrorBoundary` around the children; an explicit host error
 * flag is the native idiom, mirroring the sibling MonthlyCostChart). The chart content (the function-children)
 * is host-owned, so its loading/empty/error are host inputs, not a fetched feed; the container never blanks the
 * body for an annotation-overlay failure.
 */
enum class ChartBodyStatus {
    /** A host load is in flight — render the spinner chrome. */
    Loading,

    /** The host load failed — render the error chrome with a retry affordance (web `errors.section.chartTitle`). */
    Error,

    /** The host resolved no chart data — render the friendly empty state (web `chart.noData`). */
    Empty,

    /** There is chart content to render — invoke the children. */
    Content,
}

/** Selects the [ChartBodyStatus] from the host's loading/error/empty flags — loading wins, then error, then empty. */
fun chartBodyStatus(
    loading: Boolean,
    error: Boolean,
    empty: Boolean,
): ChartBodyStatus =
    when {
        loading -> ChartBodyStatus.Loading
        error -> ChartBodyStatus.Error
        empty -> ChartBodyStatus.Empty
        else -> ChartBodyStatus.Content
    }

// ── annotation cache-then-network feed → render surface ───────────────────────────────────────────────────

/**
 * The render-ready classification of the annotation feed's [UiState] — a closed set the view switches on so
 * every branch is exhaustively covered and unit-tested off-device. Maps the cache-then-network contract onto
 * the P3 loading / content / empty / stale / offline / error vocabulary. The fetched rows are retained on
 * [Offline] so a network failure still shows last-known markers + an offline chip rather than blanking them.
 */
sealed interface AnnotationFeed {
    /** A first load is in flight with nothing cached — markers are not drawn yet (the overlay's loading). */
    data object Loading : AnnotationFeed

    /** Fresh rows resolved — markers + the footer list render (the overlay's content). */
    data class Ready(
        val annotations: List<DataAnnotation>,
    ) : AnnotationFeed

    /** Resolved empty — no annotations exist yet; the "Add" affordance still invites creating one. */
    data object Empty : AnnotationFeed

    /** Last-known rows shown because the refresh is stale/offline — a freshness chip + retry; [offline] picks the copy. */
    data class Offline(
        val annotations: List<DataAnnotation>,
        val offline: Boolean,
    ) : AnnotationFeed

    /** A hard failure with nothing cached — an inline error affordance with retry (the chart body is untouched). */
    data class Failed(
        val offline: Boolean,
    ) : AnnotationFeed
}

/**
 * Selects the render-ready [AnnotationFeed] for the annotation [state]. Pure: the staleness/offline decision
 * reads the [UiState] freshness flags the shared `toUiState` already computed (ADR-013), so this is fully
 * deterministic. Order matters — a hard error wins over a stale cache, a retained cache wins over a fresh
 * loading skeleton, and an honest empty resolves before a content fallback.
 */
fun classifyAnnotationFeed(state: UiState<List<DataAnnotation>>): AnnotationFeed {
    val rows = state.data ?: emptyList()
    val offline = state.errorKind == ErrorKind.Network
    return when {
        state.isError -> AnnotationFeed.Failed(offline)
        state.stale && state.hasData -> AnnotationFeed.Offline(rows, offline)
        state.isLoading -> AnnotationFeed.Loading
        state.isEmpty -> AnnotationFeed.Empty
        else -> AnnotationFeed.Ready(rows)
    }
}

/** The rows the feed has fetched (cached or fresh) — the source for the footer AnnotationList (web `fetchedAnnotations`). */
fun AnnotationFeed.fetched(): List<DataAnnotation> =
    when (this) {
        is AnnotationFeed.Ready -> annotations
        is AnnotationFeed.Offline -> annotations
        AnnotationFeed.Loading, AnnotationFeed.Empty, is AnnotationFeed.Failed -> emptyList()
    }

/** True when the feed should offer a retry affordance — a stale/offline cache or a hard failure (web has none; P3 adds it). */
fun AnnotationFeed.canRetry(): Boolean = this is AnnotationFeed.Offline || this is AnnotationFeed.Failed

/**
 * The annotations the chart overlay + the function-children render — the web `annotationsEnabled && !hidden ?
 * fetchedAnnotations : []`. Hiding collapses the visible set to empty so children that draw reference lines
 * naturally render nothing, while the footer list (which reads [AnnotationFeed.fetched]) still shows the roster.
 */
fun visibleAnnotations(
    enabled: Boolean,
    hidden: Boolean,
    fetched: List<DataAnnotation>,
): List<DataAnnotation> = if (enabled && !hidden) fetched else emptyList()

/** The mobile marker row renders only when the overlay is enabled, not hidden, and has visible rows (web `showMarkerRow`). */
fun showMarkerRow(
    enabled: Boolean,
    hidden: Boolean,
    visible: List<DataAnnotation>,
): Boolean = enabled && !hidden && visible.isNotEmpty()

/**
 * Formats an annotation's ISO-8601 [timestamp] to a stable `YYYY-MM-DD` label for the footer list (the
 * timestamp column the web AnnotationList shows). Tolerant of a full instant, an offset date-time, a zoneless
 * local date-time, or a bare date — read in UTC like the web `new Date(...).toLocaleDateString()` baseline;
 * an unparseable/blank value falls back to the raw input so the list never shows an empty cell. Pure (clock-
 * free), so it is covered off-device.
 */
fun formatAnnotationDate(timestamp: String): String {
    if (timestamp.isBlank()) return timestamp
    val parsed =
        runCatching { Instant.parse(timestamp).atZone(ZoneOffset.UTC).toLocalDate() }
            .recoverCatching { OffsetDateTime.parse(timestamp).atZoneSameInstant(ZoneOffset.UTC).toLocalDate() }
            .recoverCatching { LocalDateTime.parse(timestamp).toLocalDate() }
            .recoverCatching { LocalDate.parse(timestamp) }
            .getOrNull()
    return parsed?.format(DateTimeFormatter.ISO_LOCAL_DATE) ?: timestamp
}

// ── hidden-series legend toggle (web `useHiddenSeries`) ───────────────────────────────────────────────────

/**
 * The legend-toggle state threaded to the function-children — the native port of the web `useHiddenSeries`
 * render-prop value. Children read [isHidden] to set `hide=` on each `<Line>`/`<Bar>`/`<Area>`. The web
 * persists this in the URL; the native port keeps it in-memory (the host may persist it later — a documented
 * divergence, not a silent one).
 */
data class ChartHiddenSeries(
    val hidden: Set<String> = emptySet(),
) {
    /** Whether the series [key] is currently toggled off (web `hiddenSeries.isHidden('foo')`). */
    fun isHidden(key: String): Boolean = key in hidden

    /** Returns the next state with [key]'s visibility flipped (web legend click). */
    fun toggle(key: String): ChartHiddenSeries = copy(hidden = if (key in hidden) hidden - key else hidden + key)
}

// ── a11y announcements for the annotation overlay status ──────────────────────────────────────────────────

/** The already-localized fragments [annotationFeedAnnouncement] composes — resolved by the view from i18n (P1/S10). */
data class AnnotationFeedLabels(
    val stale: String,
    val offline: String,
    val error: String,
)

/**
 * Builds the polite a11y announcement for the annotation overlay's status per [feed], or `null` when the
 * overlay carries no status to announce (loading / fresh content / honest-empty, whose chrome is announced
 * elsewhere). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun annotationFeedAnnouncement(
    feed: AnnotationFeed,
    labels: AnnotationFeedLabels,
): String? =
    when (feed) {
        AnnotationFeed.Loading, is AnnotationFeed.Ready, AnnotationFeed.Empty -> null
        is AnnotationFeed.Offline -> if (feed.offline) labels.offline else labels.stale
        is AnnotationFeed.Failed -> labels.error
    }
