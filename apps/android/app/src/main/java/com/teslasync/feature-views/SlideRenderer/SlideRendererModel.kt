// Pure, framework-free model + projection for the SlideRenderer feature view — the native analogue of
// everything the web component decides before returning JSX
// (web/src/features/analytics/components/review/SlideRenderer.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web SlideRenderer is a purely-presentational dispatcher. Its parent (the Year-in-Review page)
// fetches the `YearReview` document and passes it down with the current `slide` (a SlideDefinition:
// `type` / `bg` gradient / optional `field`) and `slideIndex`. `renderSlideContent()` switches on
// `slide.type` and renders one of ten child slide components inside an `AnimatePresence` + `motion.div`
// keyed by `slideIndex` (a fade + horizontal slide), over a `bg-gradient-to-br ${slide.bg}` background;
// an unknown `type` renders nothing (web `default: return null`).
//
// The ten child slides (TitleSlide … SummarySlide) are SEPARATE surfaces — each has its own P3 prompt
// and is out of scope here — so this file does NOT reproduce their bodies. Instead it owns exactly what
// `SlideRenderer.tsx` itself owns: the `type` → child dispatch, the drive-highlight branch logic (which
// drive, which i18n label, which emoji), the per-slide gradient, and the slide set. The composable hands
// the resolved [SlideContent] to a host-provided slot that wires the concrete child surfaces — the
// idiomatic Compose port of the web `import`-and-dispatch composition.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SlideRenderer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sliderenderer

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this surface.
 */
const val SLIDE_RENDERER_SLUG: String = "SlideRenderer"

/** Web `slide.field === 'longest'` sentinel — the only `field` value the drive-highlight branch tests. */
const val DRIVE_HIGHLIGHT_FIELD_LONGEST: String = "longest"

/** Web `slide.field ?? 'distance'` — the stat-hero default metric when a slide omits its `field`. */
const val DEFAULT_STAT_HERO_FIELD: String = "distance"

/** Web `emoji="🏔️"` for the longest-drive highlight. A decorative glyph, not an i18n string. */
const val EMOJI_LONGEST_DRIVE: String = "\uD83C\uDFD4\uFE0F"

/** Web `emoji="🌿"` for the most-efficient-drive highlight. A decorative glyph, not an i18n string. */
const val EMOJI_MOST_EFFICIENT: String = "\uD83C\uDF3F"

// ── Tailwind `*-900` gradient stops (web slide.bg) ──────────────────────────────────────────────────
// The web `slide.bg` values are Tailwind `bg-gradient-to-br from-…-900 via-…-900 to-…-900` utility
// strings — decorative per-slide chrome that carries no semantic meaning and has no design-token (P1/S9)
// equivalent. They are authored here as the exact Tailwind v3 `*-900` ARGB constants (the same approach
// the sibling YearReviewWidget uses for glyphs the shared sets do not provide), so the native slide
// backgrounds match the web pixel-for-pixel and the projection stays unit-testable off-device. The
// composable converts each [SlideBackground] stop to a Compose color + linear brush at the render edge.
const val TW_SLATE_900: Long = 0xFF0F172A
const val TW_BLUE_900: Long = 0xFF1E3A8A
const val TW_INDIGO_900: Long = 0xFF312E81
const val TW_VIOLET_900: Long = 0xFF4C1D95
const val TW_PURPLE_900: Long = 0xFF581C87
const val TW_FUCHSIA_900: Long = 0xFF701A75
const val TW_PINK_900: Long = 0xFF831843
const val TW_ROSE_900: Long = 0xFF881337
const val TW_RED_900: Long = 0xFF7F1D1D
const val TW_ORANGE_900: Long = 0xFF7C2D12
const val TW_AMBER_900: Long = 0xFF78350F
const val TW_YELLOW_900: Long = 0xFF713F12
const val TW_LIME_900: Long = 0xFF365314
const val TW_GREEN_900: Long = 0xFF14532D
const val TW_EMERALD_900: Long = 0xFF064E3B
const val TW_TEAL_900: Long = 0xFF134E4A
const val TW_CYAN_900: Long = 0xFF164E63
const val TW_SKY_900: Long = 0xFF0C4A6E

/**
 * One slide's diagonal (top-left → bottom-right, web `bg-gradient-to-br`) gradient — its three Tailwind
 * `*-900` stops as ARGB longs ([from] → [via] → [to]). Compose-free so [SLIDE_DEFS] is unit-testable; the
 * composable builds the `Brush.linearGradient` from these.
 */
data class SlideBackground(
    val from: Long,
    val via: Long,
    val to: Long,
)

/**
 * The native mirror of the web `SlideDefinition` (web/src/features/analytics/components/review/slides.ts):
 * the slide [type] the dispatch switches on, its [background] gradient (web `bg`), and the optional [field]
 * discriminator (web `field`) the stat-hero + drive-highlight branches read.
 */
data class SlideDefinition(
    val type: String,
    val background: SlideBackground,
    val field: String? = null,
)

/**
 * The canonical twelve-slide deck — a 1:1 port of the web `SLIDE_DEFS`
 * (web/src/features/analytics/components/review/slides.ts), in order, with each slide's Tailwind `*-900`
 * gradient resolved to a [SlideBackground]. The page builds this set and feeds SlideRenderer one slide at
 * a time; it is exposed here (the dispatch + gradient spec) so the surface, its previews, and its tests
 * share the exact deck the web renders.
 */
val SLIDE_DEFS: List<SlideDefinition> =
    listOf(
        // from-blue-900 via-indigo-900 to-slate-900
        SlideDefinition("title", SlideBackground(TW_BLUE_900, TW_INDIGO_900, TW_SLATE_900)),
        // from-emerald-900 via-green-900 to-teal-900
        SlideDefinition("stat-hero", SlideBackground(TW_EMERALD_900, TW_GREEN_900, TW_TEAL_900), field = "distance"),
        // from-purple-900 via-violet-900 to-indigo-900
        SlideDefinition("stat-chart", SlideBackground(TW_PURPLE_900, TW_VIOLET_900, TW_INDIGO_900), field = "drives"),
        // from-amber-900 via-orange-900 to-yellow-900
        SlideDefinition("drive-highlight", SlideBackground(TW_AMBER_900, TW_ORANGE_900, TW_YELLOW_900), field = "longest"),
        // from-cyan-900 via-sky-900 to-blue-900
        SlideDefinition("stat-hero", SlideBackground(TW_CYAN_900, TW_SKY_900, TW_BLUE_900), field = "energy"),
        // from-orange-900 via-red-900 to-pink-900
        SlideDefinition("charging-breakdown", SlideBackground(TW_ORANGE_900, TW_RED_900, TW_PINK_900)),
        // from-emerald-900 via-teal-900 to-cyan-900
        SlideDefinition("savings", SlideBackground(TW_EMERALD_900, TW_TEAL_900, TW_CYAN_900)),
        // from-green-900 via-emerald-900 to-lime-900
        SlideDefinition("environment", SlideBackground(TW_GREEN_900, TW_EMERALD_900, TW_LIME_900)),
        // from-indigo-900 via-blue-900 to-violet-900
        SlideDefinition("patterns", SlideBackground(TW_INDIGO_900, TW_BLUE_900, TW_VIOLET_900)),
        // from-teal-900 via-cyan-900 to-sky-900
        SlideDefinition("drive-highlight", SlideBackground(TW_TEAL_900, TW_CYAN_900, TW_SKY_900), field = "efficient"),
        // from-pink-900 via-rose-900 to-fuchsia-900
        SlideDefinition("comparisons", SlideBackground(TW_PINK_900, TW_ROSE_900, TW_FUCHSIA_900)),
        // from-blue-900 via-indigo-900 to-purple-900
        SlideDefinition("summary", SlideBackground(TW_BLUE_900, TW_INDIGO_900, TW_PURPLE_900)),
    )

/**
 * Web `buildSlides(data)` — returns the static [SLIDE_DEFS] regardless of [data] (the web helper ignores
 * its argument too). Kept for parity so a host can build the deck the same way the web page does.
 */
@Suppress("UNUSED_PARAMETER")
fun buildSlides(data: JsonElement?): List<SlideDefinition> = SLIDE_DEFS

/**
 * The ten slide kinds the web `switch (slide.type)` dispatches to, plus [Unknown] for the web
 * `default: return null` fall-through. Identity only — the concrete child body is rendered by the
 * host-provided slot, keeping this enum free of any Android or child-surface dependency.
 */
enum class SlideKind {
    Title,
    StatHero,
    StatChart,
    DriveHighlight,
    ChargingBreakdown,
    Savings,
    Environment,
    Patterns,
    Comparisons,
    Summary,
    Unknown,
}

/** Maps a web `slide.type` string to its [SlideKind]; an unrecognized type folds to [SlideKind.Unknown]. */
fun slideKindOf(type: String): SlideKind =
    when (type) {
        "title" -> SlideKind.Title
        "stat-hero" -> SlideKind.StatHero
        "stat-chart" -> SlideKind.StatChart
        "drive-highlight" -> SlideKind.DriveHighlight
        "charging-breakdown" -> SlideKind.ChargingBreakdown
        "savings" -> SlideKind.Savings
        "environment" -> SlideKind.Environment
        "patterns" -> SlideKind.Patterns
        "comparisons" -> SlideKind.Comparisons
        "summary" -> SlideKind.Summary
        else -> SlideKind.Unknown
    }

/** Which drive a drive-highlight slide shows — web `slide.field === 'longest' ? longest : efficient`. */
enum class DriveHighlightField { Longest, Efficient }

/** Web branch: `field === 'longest'` → [Longest]; every other value (incl. `'efficient'`/null) → [Efficient]. */
fun driveHighlightFieldOf(field: String?): DriveHighlightField =
    if (field == DRIVE_HIGHLIGHT_FIELD_LONGEST) DriveHighlightField.Longest else DriveHighlightField.Efficient

/**
 * The native mirror of the web `YearReviewDriveHighlight` (web/src/api/types.ts) — the one drive the
 * drive-highlight branch selects (`data.longest_drive` or `data.most_efficient_drive`) and hands to the
 * child slide. All distances/efficiencies are SI on the wire (km, Wh/km); conversion to display units is
 * the child surface's concern, so this carries the raw values verbatim.
 */
data class YearReviewDriveHighlight(
    val driveId: Long,
    val date: String,
    val distanceKm: Double,
    val durationMin: Double,
    val startAddress: String,
    val endAddress: String,
    val efficiencyWhKm: Double,
)

/**
 * Decodes a `longest_drive` / `most_efficient_drive` JSON value into a [YearReviewDriveHighlight], or
 * `null` when it is absent / JSON-null / not an object (web `YearReviewDriveHighlight | null`). Missing or
 * non-numeric fields collapse to zero / empty, mirroring the web optional reads.
 */
fun parseDriveHighlight(element: JsonElement?): YearReviewDriveHighlight? {
    val obj = element as? JsonObject ?: return null
    return YearReviewDriveHighlight(
        driveId = obj.longField("drive_id"),
        date = obj.stringField("date"),
        distanceKm = obj.doubleField("distance_km"),
        durationMin = obj.doubleField("duration_min"),
        startAddress = obj.stringField("start_address"),
        endAddress = obj.stringField("end_address"),
        efficiencyWhKm = obj.doubleField("efficiency_wh_km"),
    )
}

private fun JsonObject.doubleField(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.longField(key: String): Long =
    (this[key] as? JsonPrimitive)?.longOrNull
        ?: (this[key] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L

private fun JsonObject.stringField(key: String): String {
    val primitive = this[key] as? JsonPrimitive ?: return ""
    return if (primitive.isString) primitive.content else ""
}

/**
 * The localized strings SlideRenderer itself owns (the two web `t()` calls in `renderSlideContent`): the
 * drive-highlight labels passed to the child slide. Resolved through the P1/S10 i18n facade at the Compose
 * boundary; tests pass a deterministic instance so no English literal lives in native code.
 */
data class SlideRendererStrings(
    val longestDrive: String,
    val mostEfficient: String,
)

/**
 * The resolved dispatch result for one slide — the native analogue of the JSX `renderSlideContent()`
 * returns. Each variant names the child surface to render and carries exactly the props the web passes it:
 * the raw [data] document (web `data={data}`), the stat-hero `field`, or, for the drive-highlight branch,
 * the already-selected [YearReviewDriveHighlight] + the localized label + emoji that SlideRenderer resolves
 * itself. The host's slot maps each variant onto the concrete (out-of-scope) child composable.
 */
sealed interface SlideContent {
    /** Which child surface this resolves to. */
    val kind: SlideKind

    /** The Year-in-Review document threaded to the child (web `data` prop). */
    val data: JsonElement

    /** Web `<TitleSlide data={data} />`. */
    data class Title(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Title
    }

    /** Web `<StatHeroSlide data={data} field={slide.field ?? 'distance'} />`. */
    data class StatHero(
        override val data: JsonElement,
        val field: String,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.StatHero
    }

    /** Web `<StatChartSlide data={data} />`. */
    data class StatChart(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.StatChart
    }

    /**
     * Web `<DriveHighlightSlide drive={…} label={…} emoji={…} />`. SlideRenderer owns the [field] selection
     * (longest vs efficient), the resolved [drive], its localized [label], and the decorative [emoji].
     */
    data class DriveHighlight(
        override val data: JsonElement,
        val field: DriveHighlightField,
        val drive: YearReviewDriveHighlight?,
        val label: String,
        val emoji: String,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.DriveHighlight
    }

    /** Web `<ChargingBreakdownSlide data={data} />`. */
    data class ChargingBreakdown(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.ChargingBreakdown
    }

    /** Web `<SavingsSlide data={data} />`. */
    data class Savings(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Savings
    }

    /** Web `<EnvironmentSlide data={data} />`. */
    data class Environment(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Environment
    }

    /** Web `<PatternsSlide data={data} />`. */
    data class Patterns(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Patterns
    }

    /** Web `<ComparisonsSlide comparisons={data.comparisons} />` — the host reads `comparisons` off [data]. */
    data class Comparisons(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Comparisons
    }

    /** Web `<SummarySlide data={data} />`. */
    data class Summary(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Summary
    }

    /** Web `default: return null` — an unknown slide type renders no child body. */
    data class Unknown(
        override val data: JsonElement,
    ) : SlideContent {
        override val kind: SlideKind get() = SlideKind.Unknown
    }
}

/**
 * Pure dispatch from a [slide] + the [data] document to its [SlideContent] — a 1:1 port of the web
 * `renderSlideContent()` switch, including the drive-highlight branch (drive selection + label + emoji).
 * Stateless and side-effect-free so the whole dispatch is covered by the off-device unit gate; the
 * composable only animates the frame, paints the gradient, and renders the host slot for the result.
 */
object SlideRendererProjection {
    /** Resolve [slide] against [data], localizing the drive-highlight labels via [strings]. */
    fun resolve(
        slide: SlideDefinition,
        data: JsonElement,
        strings: SlideRendererStrings,
    ): SlideContent =
        when (slideKindOf(slide.type)) {
            SlideKind.Title -> SlideContent.Title(data)
            SlideKind.StatHero -> SlideContent.StatHero(data, slide.field ?: DEFAULT_STAT_HERO_FIELD)
            SlideKind.StatChart -> SlideContent.StatChart(data)
            SlideKind.DriveHighlight -> driveHighlight(slide, data, strings)
            SlideKind.ChargingBreakdown -> SlideContent.ChargingBreakdown(data)
            SlideKind.Savings -> SlideContent.Savings(data)
            SlideKind.Environment -> SlideContent.Environment(data)
            SlideKind.Patterns -> SlideContent.Patterns(data)
            SlideKind.Comparisons -> SlideContent.Comparisons(data)
            SlideKind.Summary -> SlideContent.Summary(data)
            SlideKind.Unknown -> SlideContent.Unknown(data)
        }

    /**
     * The web drive-highlight branch: `slide.field === 'longest'` reads `data.longest_drive` with the
     * "Longest Drive" label + 🏔️; anything else reads `data.most_efficient_drive` with the "Most Efficient
     * Drive" label + 🌿.
     */
    private fun driveHighlight(
        slide: SlideDefinition,
        data: JsonElement,
        strings: SlideRendererStrings,
    ): SlideContent.DriveHighlight {
        val obj = data as? JsonObject
        return when (driveHighlightFieldOf(slide.field)) {
            DriveHighlightField.Longest ->
                SlideContent.DriveHighlight(
                    data = data,
                    field = DriveHighlightField.Longest,
                    drive = parseDriveHighlight(obj?.get("longest_drive")),
                    label = strings.longestDrive,
                    emoji = EMOJI_LONGEST_DRIVE,
                )
            DriveHighlightField.Efficient ->
                SlideContent.DriveHighlight(
                    data = data,
                    field = DriveHighlightField.Efficient,
                    drive = parseDriveHighlight(obj?.get("most_efficient_drive")),
                    label = strings.mostEfficient,
                    emoji = EMOJI_MOST_EFFICIENT,
                )
        }
    }
}

/**
 * True when [data] is a populated Year-in-Review document — a non-empty JSON object. Mirrors the web page's
 * `data ?` gate (`!data` renders the empty surface) and the sibling YearReviewWidget's `parseYearReview`
 * truthiness: a null / non-object / empty-object payload carries no review and renders the empty state.
 */
fun hasReviewData(data: JsonElement?): Boolean = (data as? JsonObject)?.isNotEmpty() == true

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SLIDE_RENDERER_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordSlideRendererOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SLIDE_RENDERER_SLUG))
}
