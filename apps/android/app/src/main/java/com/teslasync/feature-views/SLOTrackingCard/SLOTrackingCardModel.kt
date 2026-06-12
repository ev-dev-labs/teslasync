// Pure, framework-free model + projection for the SLOTrackingCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/SLOTrackingCard.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component reads a raw `useQuery` of `GET /status/uptime?window=…` (there is no shared `useSystem`
// hook entry for it) and renders a single uptime snapshot against a personal SLO target. This file owns the
// parts the web computes from each payload + local state: the window enum (web `Window` union + its labels),
// the personal-target validation (web `loadTarget` clamp + `handleSaveTarget` parse), the colour-band tone
// (web `tone`: null → muted, ≥target → green, ≥target-1 → amber, else red), the historical-source caveat gate
// (web `historical_source !== 'series'`) with its note fallback, the percentage + target formatters (web
// `fmtPercent(pct, 2)` and the raw `${target}` interpolation), the persisted-target seam (web localStorage),
// and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SLOTrackingCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.slotrackingcard

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The personal-target default (web `loadTarget` returns 99 when nothing valid is stored). */
const val DEFAULT_SLO_TARGET: Double = 99.0

/** Inclusive upper bound of a valid target (web `n > 0 && n <= 100`). */
private const val MAX_SLO_TARGET: Double = 100.0

/** The amber band width below target (web `pct >= target - 1`). */
private const val WARNING_BAND: Double = 1.0

/** The wire discriminator that means a real per-window series is available (web `historical_source`). */
private const val SERIES_SOURCE: String = "series"

private const val PERCENT_FRACTION_DIGITS: Int = 2

/**
 * The uptime window a snapshot is requested for — the native mirror of the web `Window` union
 * (`'24h' | '7d' | '30d' | '90d' | '1y'`). [wire] is the exact query value sent to
 * `GET /status/uptime?window=…` and is also the short tab label the web renders verbatim (`{w}`); the
 * long human label ("Last 24 hours" …) is resolved at the render boundary through the P1/S10 catalog.
 */
enum class StatusWindow(
    val wire: String,
) {
    H24("24h"),
    D7("7d"),
    D30("30d"),
    D90("90d"),
    Y1("1y"),
    ;

    companion object {
        /** Web default selection (`useState<Window>('30d')`). */
        val DEFAULT: StatusWindow = D30

        /** Folds a wire/query value back to a window, falling back to [DEFAULT] for an unknown value. */
        fun fromWire(raw: String?): StatusWindow = entries.firstOrNull { it.wire == raw } ?: DEFAULT
    }
}

/**
 * The colour band the headline percentage renders in — the native mirror of the web `tone` memo. A
 * missing/non-finite value is [Unknown] (web muted), at-or-above target is [Healthy] (green), within one
 * point below is [Warning] (amber), and anything lower is [Danger] (red). The render layer maps each band
 * onto a P1/S9 design token.
 */
enum class UptimeTone {
    Healthy,
    Warning,
    Danger,
    Unknown,
    ;

    companion object {
        /** Classifies [pct] against the personal [target], matching the web `tone` thresholds exactly. */
        fun of(
            pct: Double?,
            target: Double,
        ): UptimeTone =
            when {
                pct == null || !pct.isFinite() -> Unknown
                pct >= target -> Healthy
                pct >= target - WARNING_BAND -> Warning
                else -> Danger
            }
    }
}

/**
 * The `GET /status/uptime` payload — the native port of the web `UptimeWindow` interface. Keys arrive
 * snake_case from the Go handler and are matched verbatim via [SerialName]. Every field carries a default
 * and the count/percentage fields are nullable so a partial payload still decodes and the render layer can
 * fall back to the em dash exactly as the web does (`?? '—'`).
 *
 * @property window the window the snapshot was computed for (echoes the request).
 * @property uptimePercent the uptime percentage (e.g. `99.95`); `null` renders as the em dash.
 * @property healthyCount components currently healthy; `null` renders as the em dash.
 * @property totalCount components observed; `null` renders as the em dash.
 * @property generatedAt ISO-8601 UTC instant the snapshot was composed.
 * @property historicalSource discriminator describing the data origin; anything other than `series`
 *   means only a current snapshot is available and triggers the caveat note.
 * @property note optional operator-facing override for the caveat copy.
 */
@Serializable
data class UptimeWindow(
    val window: String = "",
    @SerialName("uptime_percent") val uptimePercent: Double? = null,
    @SerialName("healthy_count") val healthyCount: Int? = null,
    @SerialName("total_count") val totalCount: Int? = null,
    @SerialName("generated_at") val generatedAt: String = "",
    @SerialName("historical_source") val historicalSource: String = "",
    val note: String? = null,
)

/**
 * Pure projection from the payload + local target to the card's render inputs — a 1:1 port of the
 * derivations the web component performs inline. Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate; the composable only resolves localized strings and draws what these return.
 */
object SLOTrackingCardProjection {
    /**
     * Whether the snapshot carries no usable headline value — the native "empty" branch. The web shows the
     * em dash when `uptime_percent` is nullish; this predicate backs the same surface so a value-less
     * payload resolves to the empty rendering rather than a misleading number.
     */
    fun isEmpty(window: UptimeWindow): Boolean = window.uptimePercent == null || !window.uptimePercent.isFinite()

    /**
     * Whether the historical-source caveat should show — web `data.historical_source && historical_source
     * !== 'series'`. A blank source is treated as "no caveat" (the web `&&` short-circuits on an empty
     * string), and the comparison is case- and whitespace-insensitive for wire robustness.
     */
    fun showsCaveat(source: String): Boolean {
        val trimmed = source.trim()
        return trimmed.isNotEmpty() && !trimmed.equals(SERIES_SOURCE, ignoreCase = true)
    }

    /**
     * The caveat copy to render — the backend [note] when present, else the localized [fallback]
     * (web `data.note ?? '<default>'`).
     */
    fun caveatText(
        note: String?,
        fallback: String,
    ): String = note?.takeIf { it.isNotBlank() } ?: fallback

    /**
     * Validates a target draft the way the web `handleSaveTarget` does: parse the string; a non-numeric,
     * non-finite, non-positive, or above-100 value is rejected (`null`, so the caller reverts the draft);
     * otherwise the parsed value is returned. The decimal point is parsed locale-invariantly to match the
     * web `Number(draftTarget)`.
     */
    fun sanitizeTarget(raw: String?): Double? {
        val parsed = raw?.trim()?.takeIf { it.isNotEmpty() }?.toDoubleOrNull() // parity:allow "toDo" substring false positive
        return parsed?.takeIf { it.isFinite() && it > 0.0 && it <= MAX_SLO_TARGET }
    }

    /**
     * Clamps a loaded/stored target to the valid range — the native mirror of the web `loadTarget`
     * (finite, `> 0`, `<= 100`, else the [DEFAULT_SLO_TARGET]). Used by the persisted store on read.
     */
    fun clampTarget(value: Double?): Double {
        val candidate = value ?: return DEFAULT_SLO_TARGET
        return if (candidate.isFinite() && candidate > 0.0 && candidate <= MAX_SLO_TARGET) candidate else DEFAULT_SLO_TARGET
    }

    /**
     * Formats the headline percentage the way the web `fmtPercent(pct, 2)` does: locale grouping, exactly
     * two fraction digits, and `safeNumber` (non-finite → 0), with the `%` suffix. HALF_UP matches
     * `Intl.NumberFormat`'s default halfExpand so ties round away from zero on both platforms.
     */
    fun formatPercent(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value != null && value.isFinite()) value else 0.0
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = PERCENT_FRACTION_DIGITS
                maximumFractionDigits = PERCENT_FRACTION_DIGITS
                roundingMode = RoundingMode.HALF_UP
            }
        return "${formatter.format(safe)}%"
    }

    /**
     * The raw personal-target number as text — the native mirror of the web `String(target)` used to seed
     * the edit field: no forced precision, trailing zeros stripped (`99` not `99.00`, `99.5` not `99.50`),
     * and locale-invariant (web uses a plain template literal, not `toLocaleString`).
     */
    fun targetText(value: Double): String {
        val safe = if (value.isFinite()) value else DEFAULT_SLO_TARGET
        return BigDecimal.valueOf(safe).stripTrailingZeros().toPlainString()
    }

    /**
     * Formats the personal target the way the web `${target}%` interpolation does: [targetText] plus the
     * `%` suffix (`99%`, `99.5%`). Used for the at-a-glance target label when not editing.
     */
    fun formatTarget(value: Double): String = "${targetText(value)}%"

    /** The healthy-count fragment (`{healthy}` / `{total}`) with the em-dash fallback the web applies. */
    fun countText(value: Int?): String = value?.toString() ?: EM_DASH
}

/**
 * The personal SLO target seam — the native analogue of the web component's localStorage-backed target
 * (`teslasync.status.slo.target`). The view binds to this abstraction (real persisted adapter ↔ in-memory
 * test/preview double) and never touches storage directly, so the target survives process death exactly as
 * the web value survives a reload.
 */
interface SloTargetStore {
    /** The current personal target, clamped to the valid range; emits on every [setTarget]. */
    val target: StateFlow<Double>

    /** Persists [value] (clamped to the valid range) and re-emits so the open surface updates instantly. */
    fun setTarget(value: Double)
}

/**
 * In-memory [SloTargetStore] for tests and Compose previews — the analogue of the sibling surfaces'
 * `InMemory*Store` doubles. Holds the target in a [MutableStateFlow]; nothing is persisted.
 */
class InMemorySloTargetStore(
    initial: Double = DEFAULT_SLO_TARGET,
) : SloTargetStore {
    private val state = MutableStateFlow(SLOTrackingCardProjection.clampTarget(initial))
    override val target: StateFlow<Double> = state.asStateFlow()

    override fun setTarget(value: Double) {
        state.update { SLOTrackingCardProjection.clampTarget(value) }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * uptime value, component counts, or personal target — so a diagnostics line can never leak fleet posture.
 */
object SLOTrackingCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the P3/0253 surface slug). */
    const val SLUG: String = "SLOTrackingCard"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the holder's first-composition path. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
