// Pure, framework-free model + projection for the Subscriptions dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The subscriptions envelope arrives as a raw `JsonElement` (`/vehicles/{id}/subscriptions`,
// web `useVehicleSubscriptions`), so this file owns the decode (web `asString`/`Boolean(val)` null-safe
// reads), the `daysUntil` expiry math, the known-type + generic-array parse, and the compact/standard
// projection (active count, next expiry, the label/value/badge detail rows).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SubscriptionsWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.subscriptions

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import kotlin.math.ceil

private const val EM_DASH = "\u2014"

/** Locale-stable short month abbreviations — the en-US `toLocaleDateString({ month: 'short' })` the web
 * `formatDate` produces by default. Used by [SubscriptionsProjection.formatExpiryDate]. */
private val SHORT_MONTHS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Length of the leading `yyyy-MM-dd` slice of an ISO date/date-time string. */
private const val ISO_DATE_PREFIX_LENGTH: Int = 10

/** Milliseconds in a calendar day — the web `1000 * 60 * 60 * 24` divisor in `daysUntil`. */
private const val MILLIS_PER_DAY: Double = 86_400_000.0

/** Milliseconds in a second — scales a `yyyy-MM-dd` epoch-second to the epoch-milli the other parsers yield. */
private const val MILLIS_PER_SECOND: Long = 1_000L

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. [isCompact]
 * reproduces the web `size.cols <= 1` test that swaps the full subscription list for the compact
 * active-count hero.
 */
data class SubscriptionsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact active-count hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`subscriptions`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object SubscriptionsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "subscriptions"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SubscriptionsWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize: SubscriptionsSize = SubscriptionsSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize: SubscriptionsSize = SubscriptionsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: SubscriptionsSize = SubscriptionsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: SubscriptionsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SubscriptionsSize): SubscriptionsSize =
        SubscriptionsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One known Tesla subscription type to extract from the data envelope — the native mirror of an entry in the
 * web `SUBSCRIPTION_TYPES` array. [dataKey] is the snake_case envelope flag (web `data[sub.key]`),
 * [resourceKey] is the i18n catalog resource name the composable resolves the display label from, and
 * [fallback] is the literal used when the key is absent from the catalog (web `t(sub.labelKey, sub.fallback)`
 * — these label keys ship only as fallbacks, exactly as on web).
 */
data class SubscriptionTypeSpec(
    val dataKey: String,
    val resourceKey: String,
    val fallback: String,
)

/**
 * The six known subscription types, in the web `SUBSCRIPTION_TYPES` order. The composable resolves each
 * [SubscriptionTypeSpec.resourceKey] against the S10 catalog (falling back to [SubscriptionTypeSpec.fallback]
 * when absent — the catalog ships these as fallback-only, matching the web) and folds the resolved labels
 * into [SubscriptionsStrings.typeLabels].
 */
val SUBSCRIPTION_TYPES: List<SubscriptionTypeSpec> =
    listOf(
        SubscriptionTypeSpec("premium_connectivity", "translation_widget_subscriptions_premiumConnectivity", "Premium Connectivity"),
        SubscriptionTypeSpec("full_self_driving", "translation_widget_subscriptions_fsd", "Full Self-Driving"),
        SubscriptionTypeSpec("enhanced_autopilot", "translation_widget_subscriptions_enhancedAutopilot", "Enhanced Autopilot"),
        SubscriptionTypeSpec("standard_connectivity", "translation_widget_subscriptions_standardConnectivity", "Standard Connectivity"),
        SubscriptionTypeSpec("data_sharing", "translation_widget_subscriptions_dataSharing", "Data Sharing"),
        SubscriptionTypeSpec("satellite_connectivity", "translation_widget_subscriptions_satellite", "Satellite Connectivity"),
    )

/**
 * Localized labels the surface folds into its output — the web `t('widget.subscriptions.…')` keys plus the
 * resolved [typeLabels] (web `SUBSCRIPTION_TYPES[*].label`, keyed by [SubscriptionTypeSpec.dataKey]). The
 * pure parse + projection read these so they stay locale-stable; the composable builds this from
 * `stringResource` + the i18n fallback resolver, while tests pass a deterministic instance.
 */
data class SubscriptionsStrings(
    val title: String,
    val active: String,
    val expired: String,
    val activeCount: String,
    val noData: String,
    val unknown: String,
    val typeLabels: Map<String, String>,
)

/**
 * One parsed subscription — the native analogue of the web `ParsedSub`. [name] is the resolved display name,
 * [active] whether it is currently active (web expiry/flag/status logic), [expiryDate] the raw expiry string
 * (or `null`), [renewalType] the raw renewal descriptor (or `null`), and [daysLeft] the whole days until
 * expiry (web `daysUntil`, `null` when there is no parseable expiry).
 */
data class ParsedSub(
    val name: String,
    val active: Boolean,
    val expiryDate: String?,
    val renewalType: String?,
    val daysLeft: Int?,
)

/**
 * One projected, render-ready detail row — the native analogue of a web `DetailEntry`. Carries the resolved
 * [label], the already-formatted [value] (formatted expiry date, else renewal descriptor, else an em-dash —
 * web `sub.expiryDate ? fmtDate(...) : sub.renewalType ?? '—'`), and whether the subscription is [active]
 * (drives the success/error badge, web `badge.variant`).
 */
data class SubscriptionEntry(
    val label: String,
    val value: String,
    val active: Boolean,
)

/**
 * The fully projected, render-ready view of the subscriptions for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the projection
 * is unit-tested without a UI host. [entries] backs the standard detail list; [activeCount] + [nextExpiryLabel]
 * back the compact hero; [hasSubscriptions] chooses the compact hero vs. empty state; [emptyMessage] is the
 * web `noData` message; [contentDescription] folds the surface into one TalkBack phrase.
 */
data class SubscriptionsDisplay(
    val entries: List<SubscriptionEntry>,
    val activeCount: Int,
    val nextExpiryLabel: String?,
    val hasSubscriptions: Boolean,
    val emptyMessage: String,
    val contentDescription: String,
)

/**
 * Reads the `data` envelope out of the raw `…/subscriptions` [envelope] (web `infoResponse?.data ?? null`).
 * A non-object response, or a `data` that is absent / JSON-null, yields `null` (no subscriptions to parse).
 */
fun subscriptionsData(envelope: JsonElement?): JsonObject? = (envelope as? JsonObject)?.get("data") as? JsonObject

/**
 * Whether the subscriptions envelope carries a renderable `data` object (web `subsData != null`). Drives the
 * view-model empty classification so a resolved-but-empty envelope still shows the friendly empty state.
 */
fun hasSubscriptionsData(envelope: JsonElement?): Boolean = subscriptionsData(envelope) != null

/**
 * Whole days until [dateStr] relative to [nowMillis] — the web `daysUntil` (`Math.ceil((expiry - now) /
 * msPerDay)`). `null` when [dateStr] is null/blank or unparseable (web `isNaN` guard).
 */
fun daysUntil(
    dateStr: String?,
    nowMillis: Long,
): Int? {
    val expiry = parseDateMillis(dateStr) ?: return null
    return ceil((expiry - nowMillis) / MILLIS_PER_DAY).toInt()
}

/**
 * Parses an ISO date / date-time / instant [dateStr] to epoch milliseconds, mirroring the breadth of the web
 * `new Date(dateStr)`. Tries an instant (with `Z`/offset), an offset date-time, a zoneless date-time (read as
 * UTC for determinism), then a bare `yyyy-MM-dd` (UTC midnight, matching `new Date("2025-06-01")`). `null`
 * for a null/blank/unparseable value.
 */
internal fun parseDateMillis(dateStr: String?): Long? {
    val raw = dateStr?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { Instant.parse(raw).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .recoverCatching { LocalDate.parse(raw).atStartOfDay(ZoneOffset.UTC).toEpochSecond() * MILLIS_PER_SECOND }
        .getOrNull()
}

/**
 * Safely coerces a JSON value to a non-empty string — the native analogue of the web `asString`: a non-empty
 * string yields itself, a number yields its textual form, and everything else (boolean, object, array, null,
 * JSON-null, empty string) yields `null`.
 */
internal fun asString(element: JsonElement?): String? =
    when (val primitive = element as? JsonPrimitive) {
        null, JsonNull -> null
        else ->
            when {
                primitive.isString -> primitive.content.takeIf { it.isNotEmpty() }
                primitive.doubleOrNull != null -> primitive.content
                else -> null
            }
    }

/**
 * JS-style truthiness of a JSON value — the native analogue of `Boolean(val)`. `false`/`0`/`""`/null/JSON-null
 * are falsy; every other primitive, object, or array is truthy.
 */
internal fun jsTruthy(element: JsonElement?): Boolean =
    when (element) {
        null, JsonNull -> false
        is JsonPrimitive ->
            when {
                element.isString -> element.content.isNotEmpty()
                element.booleanOrNull != null -> element.booleanOrNull == true
                element.doubleOrNull != null -> element.doubleOrNull != 0.0
                else -> true
            }
        else -> true
    }

/** Web present-flag filter: skip when the flag is null/JSON-null, boolean `false`, or an empty string. */
private fun isPresentFlag(element: JsonElement?): Boolean =
    when {
        element == null || element is JsonNull -> false
        element !is JsonPrimitive -> true
        element.booleanOrNull == false -> false
        element.isString && element.content.isEmpty() -> false
        else -> true
    }

/**
 * Parses the `…/subscriptions` `data` object into the ordered list of [ParsedSub] — the native port of the
 * web `parseSubscriptions`. First the six known types (web `SUBSCRIPTION_TYPES`), then any generic
 * `subscriptions` array, de-duplicated case-insensitively by name (web `subs.some(...)`). [nowMillis] anchors
 * the `daysUntil` expiry math; [strings] supplies the resolved labels.
 */
fun parseSubscriptions(
    data: JsonObject?,
    strings: SubscriptionsStrings,
    nowMillis: Long,
): List<ParsedSub> {
    if (data == null) return emptyList()
    val subs = parseKnownTypes(data, strings, nowMillis).toMutableList()
    appendGenericArray(data, strings, nowMillis, subs)
    return subs
}

/** The six known subscription types present in [data], in web `SUBSCRIPTION_TYPES` order. */
private fun parseKnownTypes(
    data: JsonObject,
    strings: SubscriptionsStrings,
    nowMillis: Long,
): List<ParsedSub> =
    SUBSCRIPTION_TYPES.mapNotNull { spec ->
        val flag = data[spec.dataKey]
        if (!isPresentFlag(flag)) return@mapNotNull null
        val expiryDate = asString(data["${spec.dataKey}_expiry_date"] ?: data["${spec.dataKey}_expiry"])
        val days = daysUntil(expiryDate, nowMillis)
        val active = if (expiryDate != null) days != null && days > 0 else jsTruthy(flag)
        val renewal = asString(data["${spec.dataKey}_renewal"] ?: data["${spec.dataKey}_renewal_type"])
        ParsedSub(
            name = strings.typeLabels[spec.dataKey] ?: spec.fallback,
            active = active,
            expiryDate = expiryDate,
            renewalType = renewal,
            daysLeft = days,
        )
    }

/** Appends any generic `data.subscriptions` array rows to [subs], de-duplicated case-insensitively by name. */
private fun appendGenericArray(
    data: JsonObject,
    strings: SubscriptionsStrings,
    nowMillis: Long,
    subs: MutableList<ParsedSub>,
) {
    val array = data["subscriptions"] as? JsonArray ?: return
    for (rec in array.filterIsInstance<JsonObject>()) {
        val parsed = parseGenericRow(rec, strings, nowMillis)
        if (subs.none { it.name.equals(parsed.name, ignoreCase = true) }) {
            subs += parsed
        }
    }
}

/** One generic-array row — web name/expiry/status resolution with the `unknown` fallback name. */
private fun parseGenericRow(
    rec: JsonObject,
    strings: SubscriptionsStrings,
    nowMillis: Long,
): ParsedSub {
    val name = asString(rec["name"]) ?: asString(rec["type"]) ?: strings.unknown
    val expiryDate = asString(rec["expiry_date"]) ?: asString(rec["expiry"]) ?: asString(rec["end_date"])
    val days = daysUntil(expiryDate, nowMillis)
    val status = asString(rec["status"])
    val active =
        when {
            status != null -> status.lowercase() == "active"
            expiryDate != null -> days != null && days > 0
            else -> true
        }
    return ParsedSub(
        name = name,
        active = active,
        expiryDate = expiryDate,
        renewalType = asString(rec["renewal_type"]) ?: asString(rec["renewal"]),
        daysLeft = days,
    )
}

/**
 * Pure projection from a parsed subscription list to the render-ready [SubscriptionsDisplay] — the native port
 * of the inline derivation the web component performs before returning JSX (the detail entries, the active
 * count, and the soonest upcoming expiry).
 */
object SubscriptionsProjection {
    /** Parses [envelope] then [project]s it — the convenience the view-model + tests drive end to end. */
    fun projectEnvelope(
        envelope: JsonElement?,
        strings: SubscriptionsStrings,
        nowMillis: Long,
    ): SubscriptionsDisplay = project(parseSubscriptions(subscriptionsData(envelope), strings, nowMillis), strings)

    /**
     * Projects the already-[parsed] subscriptions using the localized [strings]. Builds the label/value/badge
     * detail rows (web `entries`), counts the active ones (web `activeCount`), and resolves the soonest
     * upcoming expiry label (web `nextExpiry`). An empty list yields an empty display whose message is the web
     * `noData` ("No subscriptions").
     */
    fun project(
        parsed: List<ParsedSub>,
        strings: SubscriptionsStrings,
    ): SubscriptionsDisplay {
        val entries = parsed.map { sub -> SubscriptionEntry(sub.name, entryValue(sub), sub.active) }
        val activeCount = parsed.count { it.active }
        val nextExpiry =
            parsed
                .filter { it.active && (it.daysLeft ?: 0) > 0 }
                .minByOrNull { it.daysLeft ?: Int.MAX_VALUE }
        val nextExpiryLabel = nextExpiry?.expiryDate?.let { formatExpiryDate(it) }
        val description =
            if (entries.isEmpty()) {
                strings.noData
            } else {
                entries.joinToString(", ") { "${it.label} ${it.value}" }
            }
        return SubscriptionsDisplay(
            entries = entries,
            activeCount = activeCount,
            nextExpiryLabel = nextExpiryLabel,
            hasSubscriptions = entries.isNotEmpty(),
            emptyMessage = strings.noData,
            contentDescription = description,
        )
    }

    /** Detail-row value: formatted expiry date when present, else the renewal descriptor, else an em-dash. */
    fun entryValue(sub: ParsedSub): String =
        when {
            sub.expiryDate != null -> formatExpiryDate(sub.expiryDate)
            else -> sub.renewalType ?: EM_DASH
        }

    /**
     * Formats a `yyyy-MM-dd[...]` expiry string as the web `formatDate` does by default — `MMM d, yyyy`
     * (en-US short month, numeric day + year), e.g. `Jun 1, 2025`. A null/blank/unparseable value yields the
     * em dash (web `if (!iso || isNaN) return '—'`). Locale-stable, API-safe, deterministic.
     */
    fun formatExpiryDate(date: String?): String {
        val parts = date?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
        if (parts == null || parts.size != 3) return EM_DASH
        val year = parts[0].toIntOrNull()
        val day = parts[2].toIntOrNull()
        val month = parts[1].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
        return if (year != null && day != null && month != null) "$month $day, $year" else EM_DASH
    }
}
