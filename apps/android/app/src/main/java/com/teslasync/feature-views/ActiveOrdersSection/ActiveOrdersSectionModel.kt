// Pure, framework-free model + projection for the ActiveOrdersSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/ActiveOrdersSection.tsx). The projection logic carries no Compose,
// Android, or HTTP types, so it is fully exercised off-device in the :android:testReleaseUnitTest gate and the
// composable stays a thin render layer. The only non-logic declarations are the co-located lucide glyph
// vectors (static ImageVector values), authored locally exactly as the sibling feature-view surfaces do.
//
// The web component reads `useTeslaUserOrders()` (the orders envelope + its `fetched_at` stamp) and renders a
// grid of order cards, falling back to an empty state. This file owns the derivations the web component
// computes inline: the status-badge variant (web `orderStatusVariant` — DELIVER → success, READY/TRANSPORT →
// info, CANCEL/REJECT → danger, PENDING/ORDER → warning, else neutral), the humanized status label (web
// `formatOrderStatus` — underscores → spaces, Title Case), the model fallback (web `order.model || '—'`), the
// optional VIN / delivery-date / upgradable guards, the localized "Synced" stamp (web `formatDateTime`), and
// the localized delivery date (web `useDateFormat().formatDate`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ActiveOrdersSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.activeorderssection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaOrder
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an unknown/blank value — the web `'—'` / invalid-date fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ActiveOrdersSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "active-orders-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ActiveOrdersSection"
}

/**
 * The semantic status lane of a Tesla order — the vendor-neutral classification of the raw backend status
 * string, mirroring the web `orderStatusVariant` precedence. The render layer maps this to a status
 * [io.teslasync.android.components.ui.BadgeVariant]; the model stays free of Compose color types.
 */
enum class OrderStatusKind {
    /** Delivered / delivery complete (web `DELIVER` → success). */
    Delivered,

    /** Ready for / in transport (web `READY` / `TRANSPORT` → info). */
    InTransit,

    /** Cancelled or rejected (web `CANCEL` / `REJECT` → danger). */
    Cancelled,

    /** Ordered / pending (web `PENDING` / `ORDER` → warning). */
    Pending,

    /** Anything else (web fallback → neutral). */
    Neutral,
    ;

    companion object {
        /**
         * Classifies a raw status key exactly like the web `orderStatusVariant`: a null/blank value is
         * [Neutral]; otherwise the uppercased string is matched against the same substrings in the same
         * precedence (deliver ▸ ready/transport ▸ cancel/reject ▸ pending/order ▸ neutral).
         */
        fun from(status: String?): OrderStatusKind {
            if (status.isNullOrBlank()) return Neutral
            val upper = status.uppercase(Locale.ROOT)
            return when {
                upper.contains("DELIVER") -> Delivered
                upper.contains("READY") || upper.contains("TRANSPORT") -> InTransit
                upper.contains("CANCEL") || upper.contains("REJECT") -> Cancelled
                upper.contains("PENDING") || upper.contains("ORDER") -> Pending
                else -> Neutral
            }
        }
    }
}

/**
 * One fully projected, render-ready order — the native analogue of one card the web component maps. Pure data
 * (no Compose types): the composable resolves [statusKind] to a token color/badge and lays out the rows.
 *
 * @property orderId the raw order reference, shown monospace (web `order.order_id`).
 * @property model the model display label, already falling back to [EM_DASH] for a blank value (web `|| '—'`).
 * @property statusKind the status-badge lane (web `orderStatusVariant`).
 * @property statusLabel the humanized status label (web `formatOrderStatus`).
 * @property vin the optional VIN, shown monospace when present (web `order.vin &&`).
 * @property hasVin whether the VIN row renders.
 * @property deliveryDateLabel the localized delivery date when present, else `null`.
 * @property hasDeliveryDate whether the delivery-date row renders (web `order.delivery_date &&`).
 * @property isUpgradable whether the "Upgradable" chip renders (web `order.is_upgradable &&`).
 */
data class OrderView(
    val orderId: String,
    val model: String,
    val statusKind: OrderStatusKind,
    val statusLabel: String,
    val vin: String?,
    val hasVin: Boolean,
    val deliveryDateLabel: String?,
    val hasDeliveryDate: Boolean,
    val isUpgradable: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free (the [ZoneId]/[Locale] are injected) so it is fully covered by the
 * off-device unit gate.
 */
object ActiveOrdersProjection {
    /** Whether the envelope has ever been fetched (web `ordersData?.fetched_at` truthiness). */
    fun hasFetched(envelope: TeslaOrdersEnvelope?): Boolean = !envelope?.fetchedAt.isNullOrBlank()

    /** Whether the envelope resolves to "no orders" (web `(ordersData?.orders ?? []).length > 0` is false). */
    fun isEmpty(envelope: TeslaOrdersEnvelope?): Boolean = envelope?.orders.isNullOrEmpty()

    /** Projects every order in [envelope] into render-ready [OrderView]s, in received order (web `.map`). */
    fun orders(
        envelope: TeslaOrdersEnvelope?,
        zone: ZoneId,
        locale: Locale,
    ): List<OrderView> = envelope?.orders.orEmpty().map { projectOrder(it, zone, locale) }

    /** Projects a single [order] into the render-ready [OrderView]. */
    fun projectOrder(
        order: TeslaOrder,
        zone: ZoneId,
        locale: Locale,
    ): OrderView {
        val hasDelivery = !order.deliveryDate.isNullOrBlank()
        return OrderView(
            orderId = order.orderId,
            model = order.model.ifBlank { EM_DASH },
            statusKind = OrderStatusKind.from(order.status),
            statusLabel = formatStatus(order.status),
            vin = order.vin,
            hasVin = !order.vin.isNullOrBlank(),
            deliveryDateLabel = if (hasDelivery) formatDeliveryDate(order.deliveryDate, zone, locale) else null,
            hasDeliveryDate = hasDelivery,
            isUpgradable = order.isUpgradable,
        )
    }

    /**
     * Humanizes a raw status key exactly like the web `formatOrderStatus`: underscores become spaces, the
     * whole string is lowercased, then the first letter of every word is upper-cased (Title Case). A
     * null/blank value yields [EM_DASH].
     */
    fun formatStatus(status: String?): String {
        if (status.isNullOrBlank()) return EM_DASH
        return status
            .replace('_', ' ')
            .lowercase(Locale.ROOT)
            .split(' ')
            .joinToString(" ") { word ->
                word.replaceFirstChar { ch -> ch.titlecase(Locale.ROOT) }
            }
    }

    /**
     * Localized "medium date, short time" formatter for the header sync stamp — the native analogue of the web
     * `formatDateTime`. A blank or unparseable input yields [EM_DASH].
     */
    fun formatSynced(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(iso) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /**
     * Localized "medium date" formatter for an order's delivery date — the native analogue of the web
     * `useDateFormat().formatDate`. Accepts a calendar date (`YYYY-MM-DD`) or a full timestamp; a present but
     * unparseable value falls back to its trimmed raw form (the row only renders when a value is present, so
     * this is never [EM_DASH] in practice). A blank value yields [EM_DASH].
     */
    fun formatDeliveryDate(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val raw = iso?.trim().orEmpty()
        if (raw.isEmpty()) return EM_DASH
        val date = parseLocalDate(raw) ?: parseInstant(raw)?.atZone(zone)?.toLocalDate()
        return date?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) ?: raw
    }

    private fun parseLocalDate(raw: String): LocalDate? = tryParse { LocalDate.parse(raw) }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val instantParsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String?): Instant? = if (raw.isNullOrBlank()) null else instantParsers.firstNotNullOfOrNull { it(raw) }

    private fun <T> tryParse(block: () -> T): T? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ActiveOrdersSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordActiveOrdersSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ActiveOrdersSectionRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws five lucide icons (ShoppingCart, RefreshCw, Package, Calendar, Info). Android has no
// bundled lucide set, and feature views may not expand the shared icon library from a surface prompt
// (allowed-files), so the four not already in the shared `TeslaGlyphs` set are authored here as 24×24 stroked
// vectors in the shared monochrome style — recolored at render time by the `Icon` composable's tint, exactly
// as the sibling surfaces author their local glyphs. The web `Info` reuses the shared `TeslaGlyphs.Info`.

/** The web header `ShoppingCart` (lucide) — a cart body on two wheels. */
val ShoppingCartGlyph: ImageVector =
    strokedGlyph("ShoppingCart") {
        moveTo(2f, 3f)
        lineTo(4.2f, 3f)
        lineTo(6.6f, 15f)
        lineTo(18.5f, 15f)
        lineTo(20.5f, 6.5f)
        lineTo(5.2f, 6.5f)
        wheel(8.5f, 19.5f, 1.3f)
        wheel(18f, 19.5f, 1.3f)
    }

/** The web Refresh `RefreshCw` (lucide) — a circular refresh arrow with a head. */
val RefreshGlyph: ImageVector =
    strokedGlyph("Refresh") {
        moveTo(21f, 12f)
        arcToRelative(9f, 9f, 0f, true, true, -9f, -9f)
        arcToRelative(9.75f, 9.75f, 0f, false, true, 6.74f, 2.74f)
        lineTo(21f, 8f)
        moveTo(21f, 3f)
        verticalLineToRelative(5f)
        horizontalLineToRelative(-5f)
    }

/** The web per-order `Package` (lucide) — a box with a top fold + center seam. */
val PackageGlyph: ImageVector =
    strokedGlyph("Package") {
        moveTo(12f, 2.5f)
        lineTo(20.5f, 7f)
        lineTo(20.5f, 17f)
        lineTo(12f, 21.5f)
        lineTo(3.5f, 17f)
        lineTo(3.5f, 7f)
        close()
        moveTo(3.5f, 7f)
        lineTo(12f, 11.5f)
        lineTo(20.5f, 7f)
        moveTo(12f, 11.5f)
        lineTo(12f, 21.5f)
    }

/** The web delivery-date `Calendar` (lucide) — a header-divided grid with two top ticks. */
val CalendarGlyph: ImageVector =
    strokedGlyph("Calendar") {
        rectanglePath(3.5f, 4.5f, 20.5f, 20.5f)
        moveTo(3.5f, 9f)
        lineTo(20.5f, 9f)
        moveTo(8f, 2.5f)
        lineTo(8f, 6f)
        moveTo(16f, 2.5f)
        lineTo(16f, 6f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** A closed rectangle from ([left], [top]) to ([right], [bottom]) — the calendar body. */
private fun PathBuilder.rectanglePath(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** A small wheel circle of radius [r] centered at ([cx], [cy]), two semicircular arcs. */
private fun PathBuilder.wheel(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
