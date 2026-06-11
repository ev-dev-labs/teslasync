// Pure, framework-free model + projection for the VehicleUpgrades ("Upgrades & Sharing") dashboard widget —
// the native analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer. This file owns the `/vehicles/{id}/upgrades` envelope decode (web `asString` /
// `u.eligible !== false`), the `parseUpgrades` known-array + top-level-keys parse, the `daysUntil` expiry
// math over the drive's share links, the active-link / nearest-expiry derivation, and the compact / standard
// projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VehicleUpgradesWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling SubscriptionsWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleupgrades

import io.teslasync.shared.core.presentation.sharing.ShareToken
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

/** Em dash shown for a missing value — the web `'—'` fallback (`fmtDate(...) ?? '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Currency prefix the web prepends to an upgrade's price (`${'$'}{upgrade.price}`). */
private const val PRICE_PREFIX: String = "$"

/** The web `parseUpgrades` literal fallback name (`asString(u.name) ?? asString(u.title) ?? 'Unknown Upgrade'`). */
private const val DEFAULT_UNKNOWN_UPGRADE: String = "Unknown Upgrade"

/** Milliseconds in a calendar day — the web `1000 * 60 * 60 * 24` divisor in `daysUntil`. */
private const val MILLIS_PER_DAY: Double = 86_400_000.0

/** Milliseconds in a second — scales a `yyyy-MM-dd` epoch-second to the epoch-milli the other parsers yield. */
private const val MILLIS_PER_SECOND: Long = 1_000L

/** Length of the leading `yyyy-MM-dd` slice of an ISO date / date-time string. */
private const val ISO_DATE_PREFIX_LENGTH: Int = 10

/** Locale-stable short month abbreviations — the en-US `toLocaleDateString({ month: 'short' })` the web
 * `formatDate` produces by default. Used by [formatExpiryDate]. */
private val SHORT_MONTHS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. [isCompact]
 * reproduces the web `size.cols <= 1` test that swaps the full layout for the centered upgrade-count tile;
 * [isWide] reproduces `size.cols >= 3`, which reveals the per-row eligibility caption.
 */
data class VehicleUpgradesSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact upgrade-count tile. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): show the per-row eligibility caption. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`vehicle-upgrades`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object VehicleUpgradesRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vehicle-upgrades"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleUpgradesWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize: VehicleUpgradesSize = VehicleUpgradesSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize: VehicleUpgradesSize = VehicleUpgradesSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: VehicleUpgradesSize = VehicleUpgradesSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: VehicleUpgradesSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VehicleUpgradesSize): VehicleUpgradesSize =
        VehicleUpgradesSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One parsed OTA upgrade — the native analogue of the web `ParsedUpgrade`. [name] is the resolved display
 * name, [price] the raw price/cost descriptor (or `null`), [description] the raw description/summary (or
 * `null`), and [eligible] whether the upgrade is currently applicable (web `u.eligible !== false`).
 */
data class ParsedUpgrade(
    val name: String,
    val price: String?,
    val description: String?,
    val eligible: Boolean,
)

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
 * Whether an upgrade's `eligible` flag is truthy — the native analogue of the web `u.eligible !== false`:
 * eligible unless the value is the JSON boolean literal `false`. An absent key, JSON-null, a string (even
 * `"false"`), a number, or any object/array is therefore eligible (strict inequality with `false`).
 */
internal fun isEligible(element: JsonElement?): Boolean =
    when (val primitive = element as? JsonPrimitive) {
        null, JsonNull -> true
        else -> if (primitive.isString) true else primitive.booleanOrNull != false
    }

/**
 * Reads the `data` envelope out of the raw `/vehicles/{id}/upgrades` [envelope] (web `envelope?.data ?? null`).
 * A non-object response, or a `data` that is absent / JSON-null, yields `null` (no upgrades to parse).
 */
fun upgradesData(envelope: JsonElement?): JsonElement? {
    val data = (envelope as? JsonObject)?.get("data")
    return data?.takeUnless { it is JsonNull }
}

/**
 * Parses the upgrades `data` object into the ordered list of [ParsedUpgrade] — the native port of the web
 * `parseUpgrades`. A `data.upgrades` array is preferred (each object mapped); otherwise every top-level object
 * value is treated as an individual upgrade keyed by its property name. [unknownName] is the web literal
 * fallback used when an array entry has no name/title. A null / non-object [data] yields an empty list.
 */
fun parseUpgrades(
    data: JsonElement?,
    unknownName: String = DEFAULT_UNKNOWN_UPGRADE,
): List<ParsedUpgrade> {
    val obj = data as? JsonObject ?: return emptyList()
    val array = obj["upgrades"] as? JsonArray
    return if (array != null) parseUpgradeArray(array, unknownName) else parseTopLevel(obj)
}

/** The web "upgrades is an array" branch: each object entry mapped to a [ParsedUpgrade]. */
private fun parseUpgradeArray(
    array: JsonArray,
    unknownName: String,
): List<ParsedUpgrade> =
    array.filterIsInstance<JsonObject>().map { entry ->
        ParsedUpgrade(
            name = asString(entry["name"]) ?: asString(entry["title"]) ?: unknownName,
            price = asString(entry["price"]) ?: asString(entry["cost"]),
            description = asString(entry["description"]) ?: asString(entry["summary"]),
            eligible = isEligible(entry["eligible"]),
        )
    }

/** The web fallback branch: every top-level object value is an upgrade, named by its property key. */
private fun parseTopLevel(obj: JsonObject): List<ParsedUpgrade> =
    obj.mapNotNull { (key, value) ->
        val rec = value as? JsonObject ?: return@mapNotNull null
        ParsedUpgrade(
            name = asString(rec["name"]) ?: key,
            price = asString(rec["price"]) ?: asString(rec["cost"]),
            description = asString(rec["description"]) ?: asString(rec["summary"]),
            eligible = isEligible(rec["eligible"]),
        )
    }

/**
 * Whole days until [dateStr] relative to [nowMillis] — the web `daysUntil` (`Math.ceil((expiry - now) /
 * msPerDay)`). `null` when [dateStr] is null / blank or unparseable (web `isNaN` guard).
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
 * UTC for determinism), then a bare `yyyy-MM-dd` (UTC midnight). `null` for a null / blank / unparseable value.
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
 * Formats a `yyyy-MM-dd[...]` expiry string as the web `formatDate` does by default — `MMM d, yyyy` (en-US
 * short month, numeric day + year), e.g. `Jun 1, 2025`. A null / blank / unparseable value yields the em dash
 * (web `fmtDate(...) ?? '—'`). Locale-stable, API-safe, deterministic.
 */
fun formatExpiryDate(date: String?): String {
    val parts = date?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
    if (parts == null || parts.size != 3) return EM_DASH
    val year = parts[0].toIntOrNull()
    val month = parts[1].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
    val day = parts[2].toIntOrNull()
    return if (year != null && month != null && day != null) "$month $day, $year" else EM_DASH
}

/**
 * The active share links among [links] relative to [nowMillis] — the web `activeShareLinks` filter: a link
 * with no expiry is active; otherwise it is active when its expiry is unparseable or strictly in the future
 * (`days == null || days > 0`).
 */
fun activeShareLinks(
    links: List<ShareToken>,
    nowMillis: Long,
): List<ShareToken> =
    links.filter { link ->
        val expiry = link.expiresAt
        if (expiry.isNullOrBlank()) {
            true
        } else {
            val days = daysUntil(expiry, nowMillis)
            days == null || days > 0
        }
    }

/**
 * The active share link with the soonest upcoming expiry — the web `nearestExpiry` (the active links that
 * carry an expiry, sorted ascending by `daysUntil`, first one). `null` when no active link has an expiry.
 */
fun nearestExpiry(
    active: List<ShareToken>,
    nowMillis: Long,
): ShareToken? =
    active
        .filter { !it.expiresAt.isNullOrBlank() }
        .minByOrNull { daysUntil(it.expiresAt, nowMillis) ?: Int.MAX_VALUE }

/**
 * The cache-then-network snapshot folded from the active vehicle's upgrades envelope + its most-recent drive's
 * share links — the native port of the web `upgradesData` + `shareLinks` reads in `VehicleUpgradesWidget.tsx`.
 * Pure data (no Compose), so the parse + projection are unit-tested directly. The upgrades feed is primary
 * (it drives the surface's loading / freshness / error contract, web `shellProps`); [shareLinks] only enriches
 * the share-links section, exactly as the web `useShareLinks` feed never gates the `WidgetShell`.
 *
 * @property upgradesData the `data` object of the upgrades envelope (web `envelope?.data ?? null`), or `null`.
 * @property shareLinks the active vehicle's most-recent drive's share rows (web `shareLinksData ?? []`).
 */
data class VehicleUpgradesSnapshot(
    val upgradesData: JsonElement?,
    val shareLinks: List<ShareToken>,
) {
    companion object {
        /** The fully-empty snapshot (no upgrades data, no share links): the surface's friendly empty content. */
        val EMPTY: VehicleUpgradesSnapshot = VehicleUpgradesSnapshot(upgradesData = null, shareLinks = emptyList())
    }
}

/**
 * Whether the snapshot has nothing to render — no parsed upgrades AND no share-link rows. Drives the
 * view-model's empty classification so a resolved-but-empty payload still shows the friendly inline empties
 * (web "All upgrades applied" + "No active share links") rather than a blank box.
 */
fun VehicleUpgradesSnapshot.hasNoContent(): Boolean = parseUpgrades(upgradesData).isEmpty() && shareLinks.isEmpty()

/**
 * The localized chrome strings the surface folds into its projection — the web `t('widget.upgrades.…')` keys.
 * The pure projection reads these so the rendered + accessibility text stays locale-stable; the composable
 * builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class VehicleUpgradesStrings(
    val title: String,
    val available: String,
    val upToDate: String,
    val upgradesHeading: String,
    val eligible: String,
    val notEligible: String,
    val allApplied: String,
    val shareLinksHeading: String,
    val activeLinks: String,
    val nearestExpiry: String,
    val noShareLinks: String,
)

/**
 * One projected, render-ready upgrade row — the native analogue of a web upgrade list item. Carries the
 * resolved [name], the formatted [priceLabel] (`${'$'}<price>`, or `null` when absent), the optional
 * [description], whether it is [eligible] (drives the success / neutral badge, web `badge.variant`), the
 * localized [eligibilityLabel], and the folded one-phrase [contentDescription] for TalkBack.
 */
data class UpgradeRow(
    val name: String,
    val priceLabel: String?,
    val description: String?,
    val eligible: Boolean,
    val eligibilityLabel: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the upgrades + sharing surface for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the parsed upgrades, the eligible
 * count, the active share links + nearest expiry, and the compact / wide branches). Pure data (no Compose
 * types) so every branch is unit-tested directly.
 *
 * @property upgrades the render-ready upgrade rows (web `upgrades.map(...)`).
 * @property eligibleCount the number of eligible upgrades (web `eligibleCount`), shown by the compact tile.
 * @property hasUpgrades whether any upgrade resolved (web `upgrades.length > 0`).
 * @property activeShareLinkCount the count of active share links (web `activeShareLinks.length`).
 * @property nearestExpiryLabel the formatted soonest-expiry date (web `fmtDate(nearestExpiry.expires_at)`), or
 *   `null` when no active link has an expiry.
 * @property hasActiveShareLinks whether any share link is active (web `activeShareLinks.length > 0`).
 * @property isCompact the single-column footprint flag (the centered upgrade-count tile).
 * @property isWide the ≥3-column footprint flag (reveals the per-row eligibility caption).
 * @property compactDescription the compact tile's folded TalkBack phrase (count + "available", or "Up to date").
 */
data class VehicleUpgradesDisplay(
    val upgrades: List<UpgradeRow>,
    val eligibleCount: Int,
    val hasUpgrades: Boolean,
    val activeShareLinkCount: Int,
    val nearestExpiryLabel: String?,
    val hasActiveShareLinks: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val compactDescription: String,
)

/**
 * Pure projection from a decoded [VehicleUpgradesSnapshot] to the render-ready [VehicleUpgradesDisplay] — the
 * native port of the inline derivation the web component performs before returning JSX. Side-effect-free so
 * the gate unit-tests it without a device. [nowMillis] anchors the `daysUntil` expiry math (tests pin it).
 */
object VehicleUpgradesProjection {
    /** Project [snapshot] for [size] using the localized [strings], anchoring expiry math at [nowMillis]. */
    fun project(
        snapshot: VehicleUpgradesSnapshot,
        size: VehicleUpgradesSize,
        strings: VehicleUpgradesStrings,
        nowMillis: Long,
    ): VehicleUpgradesDisplay {
        val parsed = parseUpgrades(snapshot.upgradesData)
        val rows = parsed.map { buildRow(it, strings) }
        val eligibleCount = parsed.count { it.eligible }
        val active = activeShareLinks(snapshot.shareLinks, nowMillis)
        val nearestLabel = nearestExpiry(active, nowMillis)?.let { formatExpiryDate(it.expiresAt) }
        return VehicleUpgradesDisplay(
            upgrades = rows,
            eligibleCount = eligibleCount,
            hasUpgrades = rows.isNotEmpty(),
            activeShareLinkCount = active.size,
            nearestExpiryLabel = nearestLabel,
            hasActiveShareLinks = active.isNotEmpty(),
            isCompact = size.isCompact,
            isWide = size.isWide,
            compactDescription = if (rows.isNotEmpty()) "$eligibleCount ${strings.available}" else strings.upToDate,
        )
    }

    /** Builds one render-ready [UpgradeRow] from a [parsed] upgrade + the localized [strings]. */
    private fun buildRow(
        parsed: ParsedUpgrade,
        strings: VehicleUpgradesStrings,
    ): UpgradeRow {
        val priceLabel = parsed.price?.let { PRICE_PREFIX + it }
        val eligibilityLabel = if (parsed.eligible) strings.eligible else strings.notEligible
        val description =
            buildString {
                append(parsed.name)
                priceLabel?.let {
                    append(", ")
                    append(it)
                }
                append(", ")
                append(eligibilityLabel)
            }
        return UpgradeRow(
            name = parsed.name,
            priceLabel = priceLabel,
            description = parsed.description,
            eligible = parsed.eligible,
            eligibilityLabel = eligibilityLabel,
            contentDescription = description,
        )
    }
}
