// Pure, framework-free model + projection for the XRayHeader feature view — the native analogue of
// everything the web component derives from its props before returning JSX
// (web/src/features/admin/components/ingest-xray/XRayHeader.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (`IngestXRayPage` via `useIngestXRay`) loads
// the `IngestXRayResponse` and passes the aggregate summary (`total_samples`, `unique_fields`) plus the
// selected `windowSel` down. This file owns the parts the web computes inline: the locale-grouped
// integer formatting (web `fmtInt`), the window → human-label mapping (web `WINDOW_LABEL`), and the
// three render-ready stat cards.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/XRayHeader — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xrayheader

import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

/** Em dash held as the freshness "unknown age" fallback (the relative-age chip's blank tier). */
internal const val EM_DASH: String = "\u2014"

/** Identity of the surface for diagnostics + registry (P1/S11). */
object XRayHeaderRegistration {
    /** Stable surface id. */
    const val ID: String = "xray-header"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "XRayHeader"
}

/**
 * The observation windows the X-Ray page offers — the native mirror of the web `IngestXRayWindow`
 * literal union (`'5m' | '15m' | '1h' | '6h' | '24h'`). [wire] is the exact server token (matching the
 * web literal); [defaultLabel] is the human label.
 *
 * [defaultLabel] is a verbatim 1:1 port of the web `WINDOW_LABEL` constant. The web renders the window
 * via `t('admin.xray.windowLabel.${windowSel}', WINDOW_LABEL[windowSel])`, but `admin.xray.windowLabel.*`
 * is NOT a key in the i18n catalog (en.json) — it is only ever the code-level fallback, so this constant
 * is what the web actually displays. It is data derived from the window selection (not one of the six
 * `admin.xray.stats.*` microcopy strings, which DO resolve through the i18n facade at the render boundary).
 */
enum class XRayWindow(
    val wire: String,
    val defaultLabel: String,
) {
    M5("5m", "5 minutes"),
    M15("15m", "15 minutes"),
    H1("1h", "1 hour"),
    H6("6h", "6 hours"),
    H24("24h", "24 hours"),
    ;

    companion object {
        /** Resolves a server token to its [XRayWindow]; an unknown token folds to [H1] (the web default). */
        fun fromWire(wire: String): XRayWindow = entries.firstOrNull { it.wire == wire } ?: H1
    }
}

/**
 * The aggregate-summary slice the header reads from the web `IngestXRayResponse` — only `total_samples`
 * and `unique_fields`, the two counts the three cards summarise (the buckets + field-stat sections feed
 * the sibling chart/table surfaces, not this strip). Pure data so the projection is unit-tested without
 * a UI host.
 */
data class IngestXRaySummary(
    val totalSamples: Long,
    val uniqueFields: Long,
)

/**
 * The already-localized microcopy the strip renders — the six `admin.xray.stats.*` keys resolved through
 * the P1/S10 i18n facade at the Compose boundary, plus the resolved [windowValue] (the human window
 * label). The web component is anonymous (its parent resolves every string via `useTranslation`), so
 * these arrive as props here, keeping the strip free of any hardcoded microcopy literal.
 */
data class XRayHeaderLabels(
    val samplesLabel: String,
    val samplesSublabel: String,
    val fieldsLabel: String,
    val fieldsSublabel: String,
    val windowLabel: String,
    val windowSublabel: String,
    val windowValue: String,
)

/**
 * One fully projected, render-ready stat card — the native analogue of a single web `<StatCard>`. Pure
 * data (no Compose types); the composable maps it to the shared `StatCard` and pairs it with an icon.
 */
data class XRayHeaderStat(
    val label: String,
    val value: String,
    val sublabel: String,
)

/**
 * The three projected cards in web render order — samples, fields, window. Mirrors the web `<Grid>` of
 * three `<StatCard>`s; [asList] yields them in order for the composable's grid.
 */
data class XRayHeaderStats(
    val samples: XRayHeaderStat,
    val fields: XRayHeaderStat,
    val window: XRayHeaderStat,
) {
    /** The three cards in render order (samples, fields, window). */
    fun asList(): List<XRayHeaderStat> = listOf(samples, fields, window)
}

/**
 * The pure projection the composable renders — the native mirror of the web component's inline value
 * selection. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object XRayHeaderProjection {
    /**
     * Projects the aggregate [summary] + localized [labels] onto the three render-ready cards, reproducing
     * the web value selection: samples = `fmtInt(total_samples ?? 0)`, fields = `fmtInt(unique_fields ?? 0)`,
     * window = the resolved window label (echoed back immediately, independent of load state). A `null`
     * [summary] yields zero counts — the web `data?.… ?? 0` nullish fallback — so the strip is never blank.
     * The dedicated loading surface (skeleton chrome) is the composable's concern, not this projection.
     */
    fun project(
        summary: IngestXRaySummary?,
        labels: XRayHeaderLabels,
        locale: Locale = Locale.getDefault(),
    ): XRayHeaderStats =
        XRayHeaderStats(
            samples =
                XRayHeaderStat(
                    label = labels.samplesLabel,
                    value = formatInt(summary?.totalSamples ?: 0L, locale),
                    sublabel = labels.samplesSublabel,
                ),
            fields =
                XRayHeaderStat(
                    label = labels.fieldsLabel,
                    value = formatInt(summary?.uniqueFields ?: 0L, locale),
                    sublabel = labels.fieldsSublabel,
                ),
            window =
                XRayHeaderStat(
                    label = labels.windowLabel,
                    value = labels.windowValue,
                    sublabel = labels.windowSublabel,
                ),
        )

    /**
     * True when the summary carries no samples at all — the empty/"no rows" condition. A `null` summary or
     * a zero sample count both count as empty, mirroring the web `data?.total_samples ?? 0` falling to 0.
     */
    fun isEmpty(summary: IngestXRaySummary?): Boolean = (summary?.totalSamples ?: 0L) <= 0L

    /**
     * Locale-aware integer formatting with grouping separators — the native analogue of the web `fmtInt`
     * (`Number.toLocaleString` at 0 fraction digits): `formatInt(1234567, Locale.US)` → `"1,234,567"`.
     */
    fun formatInt(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = NumberFormat.getIntegerInstance(locale).format(value)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [XRayHeaderRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect. Carries no vehicle id or sample counts, so a diagnostics line can
 * never leak the fleet's ingest posture.
 */
fun recordXRayHeaderOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to XRayHeaderRegistration.SLUG))
}
