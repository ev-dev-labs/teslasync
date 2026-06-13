// Pure, framework-free model + projection + diagnostics for the SourceLayerBadge shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/SourceLayerBadge.tsx)
// before it paints. No Compose, no Android framework, no platform clock, no HTTP: every declaration here is
// exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer over
// these pure functions (the accepted sibling-surface contract — see FreshnessIndicator / Delta).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive: a debugger-only badge showing where a live signal value came from. The
//     parent owns the `source` layer string + an optional `ageMs` and passes them in as props; the only hook
//     is `useTranslation` (i18n), so there is NO data port to bind — no P1/S8 state holder, no Source/
//     ViewModel. Modelling a fetch would invent behaviour the web spec does not have (honesty covenant: no
//     scope narrowing, no silent drift). The sibling presentational ports FreshnessIndicator / BatteryDelta /
//     AnimatedNumber document the same rationale (composable + model, no Source).
//   • Five source variants, each a fixed glyph + tint: l1 → "L1" (success/green), l2 → "L2" (info/blue),
//     log → "LOG" (muted), stale → "STALE" (warning/amber), and an unknown fallback → "—" (muted) for a null
//     / unrecognised layer ([SignalSourceLayer] + [sourceLayerGlyph] + [sourceLayerTint]). The lowercase
//     normalisation tolerates any backend casing exactly as the web `(source ?? 'unknown').toLowerCase()` does.
//   • `formatAge(ms)` → null when the age is absent, else a compact read-out: "{ms} ms" (< 1 s),
//     "{s} s" (< 1 min), "{min} min" (< 1 h), "{h} h" (< 1 d), "{d} d" — reproduced verbatim by
//     [formatSourceAge], including the web `Math.round` for the minute bucket and the `toFixed(1)` one-decimal
//     forms. The web `toFixed` is locale-independent (always a "." separator), so the decimal forms are
//     rendered with [Locale.ROOT] for byte-for-byte parity; the "ms"/"s"/"min"/"h"/"d" suffixes are unit
//     symbols the web hardcodes with no `t()` call (the prompt extracts ZERO i18n keys for them), so they are
//     symbol constants here, exactly like the unknown em-dash glyph — not localized microcopy.
//   • Tooltip / accessible description: the localized layer description, with " ({age}: {ageText})" appended
//     when an age is present (web `${desc} (${t('sourceLayer.age')}: ${ageText})`). The render layer resolves
//     the description + the "age" label from the shared P1/S10 catalog
//     (translation_sourceLayer_{l1,l2,log,stale,unknown}_desc + translation_sourceLayer_age); the model carries
//     only the layer + the formatted age so it stays framework-free and fully unit-tested.
//
// The surface's reproduced STATES are the five source-layer branches the web renders: l1 (the live, freshest
// state), l2 and log (cross-pod / durable-history reads), stale (the genuine amber "older than the freshness
// window" branch the prompt calls out), and unknown — the null / unrecognised-layer branch that doubles as
// the empty AND pre-data branch (a parent that has not yet resolved a layer passes null, exactly as the web
// `source ?? 'unknown'` path renders the muted "—" badge). The generic loading / error / offline lifecycle is
// intentionally absent: this surface fetches nothing, so a spinner or a retry affordance would fabricate
// behaviour the web spec does not have. Each branch is reduced here and asserted off-device, which therefore
// doubles as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SourceLayerBadge — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations alongside the namesake projection.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sourcelayerbadge

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToLong

/** The glyph shown for the unknown layer (web `STYLE.unknown.label = '—'`). A typographic symbol, not a word. */
const val SOURCE_LAYER_UNKNOWN_GLYPH: String = "\u2014"

/**
 * The layer a live signal value was satisfied from — the native mirror of the web `SignalSource`
 * (`'l1' | 'l2' | 'log' | 'stale' | string`). The render boundary maps this onto the glyph, the tint, and the
 * localized description. Any unrecognised / null backend value collapses to [Unknown] (web
 * `STYLE[key] ?? STYLE.unknown`).
 */
enum class SignalSourceLayer {
    /** Web `l1` — read from the in-process SignalStore (hot path, freshest). Green/success tint. */
    L1,

    /** Web `l2` — read from the Redis cross-pod cache (legacy entry, freshness unknown). Blue/info tint. */
    L2,

    /** Web `log` — replayed from signal_log (durable history). Muted tint. */
    Log,

    /** Web `stale` — Redis-backed value older than the 2-minute freshness window. Amber/warning tint. */
    Stale,

    /** Web fallback — null / unrecognised layer. Muted tint, em-dash glyph. */
    Unknown,
}

/**
 * Semantic tint role for a [SignalSourceLayer] — kept framework-free (no Compose `Color`) so the off-device
 * gate verifies the layer → tint mapping without a Compose host. The render boundary resolves each role to a
 * per-theme colour drawn from the TeslaTokens status palette / the Material scheme, so light / dark /
 * high-contrast all stay correct (mirrors the web background-15, text-200, border-30 alpha tints).
 */
enum class SourceLayerTint {
    /** Green — the freshest L1 read (web emerald). */
    Success,

    /** Blue — the L2 cross-pod cache read (web blue). */
    Info,

    /** Amber — the stale read past the freshness window (web amber). */
    Warning,

    /** Muted on-surface-variant — the log replay and the unknown fallback (web `--surface-2`/`--text-secondary`). */
    Muted,
}

/**
 * The fully reduced, render-ready projection of the badge — everything the composable needs, derived purely so
 * every branch is covered off-device. The view only resolves the tint colour, the localized description, and
 * lays out the glyph.
 *
 * @property layer the parsed source layer (web `key`), driving the glyph + tint + which description to resolve.
 * @property glyph the short uppercase chip label (web `style.label`): "L1" / "L2" / "LOG" / "STALE" / "—".
 * @property tint the semantic tint role the render layer maps onto a per-theme colour.
 * @property ageText the compact formatted age appended to the tooltip, or `null` when no age was supplied.
 */
data class SourceLayerProjection(
    val layer: SignalSourceLayer,
    val glyph: String,
    val tint: SourceLayerTint,
    val ageText: String?,
)

private const val MILLIS_PER_SECOND: Double = 1_000.0
private const val MILLIS_PER_MINUTE: Double = 60_000.0
private const val MILLIS_PER_HOUR: Double = 3_600_000.0
private const val MILLIS_PER_DAY: Double = 86_400_000.0

/**
 * Parses the backend source-layer string onto [SignalSourceLayer] — the native mirror of the web
 * `(source ?? 'unknown').toLowerCase()` lookup. Trims + lowercases so any backend casing/whitespace resolves,
 * and tolerates unknown / null values by falling back to [SignalSourceLayer.Unknown] (web
 * `STYLE[key] ?? STYLE.unknown`).
 */
fun parseSourceLayer(source: String?): SignalSourceLayer =
    when (source?.trim()?.lowercase(Locale.ROOT)) {
        "l1" -> SignalSourceLayer.L1
        "l2" -> SignalSourceLayer.L2
        "log" -> SignalSourceLayer.Log
        "stale" -> SignalSourceLayer.Stale
        else -> SignalSourceLayer.Unknown
    }

/** The short uppercase chip glyph for a [layer] — web `style.label` ("L1" / "L2" / "LOG" / "STALE" / "—"). */
fun sourceLayerGlyph(layer: SignalSourceLayer): String =
    when (layer) {
        SignalSourceLayer.L1 -> "L1"
        SignalSourceLayer.L2 -> "L2"
        SignalSourceLayer.Log -> "LOG"
        SignalSourceLayer.Stale -> "STALE"
        SignalSourceLayer.Unknown -> SOURCE_LAYER_UNKNOWN_GLYPH
    }

/**
 * The semantic tint role for a [layer] — the native mirror of the web per-variant tint (l1 → emerald,
 * l2 → blue, stale → amber, log + unknown → muted). The render boundary resolves the role to a per-theme
 * colour so the badge stays legible in every theme.
 */
fun sourceLayerTint(layer: SignalSourceLayer): SourceLayerTint =
    when (layer) {
        SignalSourceLayer.L1 -> SourceLayerTint.Success
        SignalSourceLayer.L2 -> SourceLayerTint.Info
        SignalSourceLayer.Stale -> SourceLayerTint.Warning
        SignalSourceLayer.Log -> SourceLayerTint.Muted
        SignalSourceLayer.Unknown -> SourceLayerTint.Muted
    }

/**
 * Human-readable age for a value in milliseconds — the native mirror of the web `formatAge`. Returns `null`
 * when [ageMs] is absent (web `ms == null || !Number.isFinite(ms)`; a `Long` is always finite, so only the
 * null case applies). Otherwise: "{ms} ms" (< 1 s), "{s} s" (< 1 min, one decimal), "{min} min" (< 1 h,
 * rounded), "{h} h" (< 1 d, one decimal), "{d} d" (one decimal). The minute bucket uses round-half-up
 * ([roundToLong] ties toward +∞, matching the web `Math.round`); the decimal forms format with [Locale.ROOT]
 * so the "." separator matches the web `toFixed(1)` byte-for-byte regardless of the device locale (the web
 * `toFixed` is locale-independent, so there is deliberately no locale knob to drift the separator).
 */
fun formatSourceAge(ageMs: Long?): String? {
    if (ageMs == null) return null
    return when {
        ageMs < MILLIS_PER_SECOND -> "$ageMs ms"
        ageMs < MILLIS_PER_MINUTE -> "${oneDecimal(ageMs / MILLIS_PER_SECOND)} s"
        ageMs < MILLIS_PER_HOUR -> "${(ageMs / MILLIS_PER_MINUTE).roundToLong()} min"
        ageMs < MILLIS_PER_DAY -> "${oneDecimal(ageMs / MILLIS_PER_HOUR)} h"
        else -> "${oneDecimal(ageMs / MILLIS_PER_DAY)} d"
    }
}

/** One-decimal fixed formatting — the native mirror of the web `Number.toFixed(1)` (locale-stable "."). */
private fun oneDecimal(value: Double): String = String.format(Locale.ROOT, "%.1f", value)

/**
 * Reduce a [source] layer string + an optional [ageMs] into the render-ready [SourceLayerProjection]. Pure
 * (no Compose), so every branch — l1 / l2 / log / stale / unknown, with and without an age — is covered by the
 * off-device gate and the composable stays a thin render layer.
 */
fun projectSourceLayerBadge(
    source: String?,
    ageMs: Long?,
): SourceLayerProjection {
    val layer = parseSourceLayer(source)
    return SourceLayerProjection(
        layer = layer,
        glyph = sourceLayerGlyph(layer),
        tint = sourceLayerTint(layer),
        ageText = formatSourceAge(ageMs),
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the source
 * layer or the age — so a diagnostics line can never leak which signal a power user was inspecting or how
 * fresh it was. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * once per surface open.
 */
object SourceLayerBadgeDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "SourceLayerBadge"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
