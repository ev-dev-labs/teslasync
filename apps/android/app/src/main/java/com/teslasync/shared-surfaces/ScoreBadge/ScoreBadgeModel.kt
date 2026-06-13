// Pure, framework-free model + projection + diagnostics for the ScoreBadge shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/ScoreBadge.tsx) plus
// the shared scale it delegates to (web/src/lib/scoreScale.ts) before it paints. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive — a letter-grade pill (A+ / A / B / C / D / F / —). The parent owns
//     the score, passes it in as a prop (`score` to be mapped, or a pre-computed `grade`), and the
//     component's only hook is useTranslation. So there is no data port to bind (no P1/S8 state holder, no
//     Source/ViewModel); modelling one would invent a fetch the web spec does not have (honesty covenant:
//     no scope narrowing, no silent drift). The sibling presentational ports BatteryDelta / Distance / Speed
//     document the same rationale (composable + model, no Source).
//   • `numericToGrade(score)` (web scoreScale.ts) maps a 0–100 number to a letter via the default
//     thresholds (90→A+, 80→A, 65→B, 50→C, 35→D, 0→F), or to `—` when the input is null / non-finite
//     (the web `score == null || !Number.isFinite(score)` guard). Callers may override the thresholds
//     (Wh/km efficiency, latency, anything ordered) — reproduced by [numericToGrade]'s `thresholds` arg.
//   • `gradeInfo(grade)` (web scoreScale.ts) is the pre-computed path: the caller already mapped score →
//     grade and the badge only colours + renders the letter. Native mirror: [projectGrade].
//   • Colour comes from the shared `GRADE_PALETTE` so any badge with the same letter has the same colour
//     everywhere — reproduced here as a [ScoreTone] per grade, mapped onto the per-theme design tokens at
//     the Compose boundary (never a raw hex in the view).
//   • The accessible label is `t('score.aria', 'Score {{grade}}', { grade })` (overridable by the
//     `ariaLabel` prop) — reproduced as the localized `score.aria` key carrying the grade label.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders one number the parent already holds. Its real, fully reproduced
// states are the seven grade branches (A+ / A / B / C / D / F) and the `—` "no score" branch, across the
// three display sizes; each is reduced here and asserted in the off-device test.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): the score is a unitless 0–100 rating, so —
// like the web component, which renders only the grade letter — this projection performs no display-unit
// conversion and the surface needs no live formatter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ScoreBadge — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling BatteryDelta / Distance surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.scorebadge

import io.teslasync.shared.core.diagnostics.Logger

/** The em-dash shown for the "no score" grade — the web `'—'` sentinel label. */
const val SCORE_BADGE_DASH: String = "\u2014"

/**
 * Display size — the native tag for the web `size` prop. The web `SIZE_CLASS` maps each to a Tailwind type
 * step; this surface maps each onto the generated (P1/S9) type ramp at the Compose boundary rather than
 * porting the raw pixel values.
 *   - [Sm] (web `'sm'`, `text-xs`) — inline next to other text.
 *   - [Md] (web `'md'`, default, `text-xl`) — list rows.
 *   - [Lg] (web `'lg'`, `text-3xl`) — section headers.
 */
enum class ScoreBadgeSize {
    /** Web `size="sm"` — the inline ≈12sp step. */
    Sm,

    /** Web `size="md"` (default) — the list-row step. */
    Md,

    /** Web `size="lg"` — the section-header step. */
    Lg,
}

/**
 * A letter grade — the native mirror of the web `ScoreGrade` union (`'A+' | 'A' | 'B' | 'C' | 'D' | 'F' |
 * '—'`). [label] is the visible text the badge renders and the value interpolated into the accessible
 * `score.aria` string.
 */
enum class ScoreGrade(
    val label: String,
) {
    /** Web `'A+'`. */
    APlus("A+"),

    /** Web `'A'`. */
    A("A"),

    /** Web `'B'`. */
    B("B"),

    /** Web `'C'`. */
    C("C"),

    /** Web `'D'`. */
    D("D"),

    /** Web `'F'`. */
    F("F"),

    /** Web `'—'` — the null / non-finite "no score" sentinel. */
    Dash(SCORE_BADGE_DASH),
}

/**
 * The render-ready tone a grade paints with — the native mirror of the web `GRADE_PALETTE` colours. The
 * render boundary maps this onto a per-theme [androidx.compose.ui.graphics.Color] from the P1/S9 tokens
 * (never a raw hex); keeping it an enum lets the off-device test assert the choice without a Compose host.
 *
 * Web hex → token, exact in the brand (dark) theme and theme-aware in light / high-contrast:
 *   - A+ / A `#10b981` → [Success] (`status.success`)
 *   - B `#00f0ff` → [Info] (`status.info`)
 *   - C `#f59e0b` → [Warning] (`status.warning`)
 *   - D `#ef4444` and F `#b91c1c` → [Danger] (`status.danger`). The web uses two distinct reds for D and F;
 *     the token system encodes a single semantic "danger" red (which, in the high-contrast theme, is exactly
 *     the web F `#b91c1c`), so both failing grades share it and the letter — the badge itself — carries the
 *     D-vs-F distinction, matching the web's "the letter IS the badge" intent.
 *   - — `#6b7280` → [Muted] (the scheme's muted on-surface colour), the "no score" sentinel.
 */
enum class ScoreTone {
    /** A+ / A — web `#10b981`, `status.success`. */
    Success,

    /** B — web `#00f0ff`, `status.info`. */
    Info,

    /** C — web `#f59e0b`, `status.warning`. */
    Warning,

    /** D / F — web `#ef4444` / `#b91c1c`, `status.danger`. */
    Danger,

    /** — — web `#6b7280`, the muted on-surface colour. */
    Muted,
}

/**
 * The looked-up info for a grade — the native mirror of the web `ScoreGradeInfo` (`label`, `color`,
 * `numeric`). [color] is replaced by the render-agnostic [tone] (Android maps tone → token); [numeric] is
 * preserved verbatim from the web palette so the ported shape stays faithful and testable (it is the
 * averaging weight the web shares with `averageGrade`, `null` for the "no data" sentinel).
 *
 * @property grade the letter (web `label`).
 * @property tone the render tone (web `color`, mapped to a token at the boundary).
 * @property numeric the averaging weight (web `numeric`); `null` for [ScoreGrade.Dash].
 */
data class ScoreGradeInfo(
    val grade: ScoreGrade,
    val tone: ScoreTone,
    val numeric: Double?,
)

/**
 * One default-scale threshold — the native mirror of a web `{ min, label }` entry. The lower bound is
 * inclusive (web `score >= t.min`).
 */
data class ScoreThreshold(
    val min: Double,
    val label: ScoreGrade,
)

/**
 * The default 0–100 thresholds — a verbatim port of the web `DEFAULT_SCORE_THRESHOLDS` (lower bound
 * inclusive, highest match wins).
 */
val DEFAULT_SCORE_THRESHOLDS: List<ScoreThreshold> =
    listOf(
        ScoreThreshold(90.0, ScoreGrade.APlus),
        ScoreThreshold(80.0, ScoreGrade.A),
        ScoreThreshold(65.0, ScoreGrade.B),
        ScoreThreshold(50.0, ScoreGrade.C),
        ScoreThreshold(35.0, ScoreGrade.D),
        ScoreThreshold(0.0, ScoreGrade.F),
    )

/** The shared grade → (tone, numeric) palette — a verbatim port of the web `GRADE_PALETTE`. */
private val GRADE_PALETTE: Map<ScoreGrade, ScoreGradeInfo> =
    mapOf(
        ScoreGrade.APlus to ScoreGradeInfo(ScoreGrade.APlus, ScoreTone.Success, 4.5),
        ScoreGrade.A to ScoreGradeInfo(ScoreGrade.A, ScoreTone.Success, 4.0),
        ScoreGrade.B to ScoreGradeInfo(ScoreGrade.B, ScoreTone.Info, 3.0),
        ScoreGrade.C to ScoreGradeInfo(ScoreGrade.C, ScoreTone.Warning, 2.0),
        ScoreGrade.D to ScoreGradeInfo(ScoreGrade.D, ScoreTone.Danger, 1.0),
        ScoreGrade.F to ScoreGradeInfo(ScoreGrade.F, ScoreTone.Danger, 0.5),
        ScoreGrade.Dash to ScoreGradeInfo(ScoreGrade.Dash, ScoreTone.Muted, null),
    )

/**
 * Map a 0–100 [score] to a letter grade — a 1:1 port of the web `numericToGrade`. A `null` or non-finite
 * score (the web `score == null || !Number.isFinite(score)` guard) maps to [ScoreGrade.Dash]; otherwise the
 * [thresholds] are evaluated highest-first so the first inclusive match wins, falling through to
 * [ScoreGrade.F]. Callers may override [thresholds] for a non-default scale (web `thresholds` arg).
 */
fun numericToGrade(
    score: Double?,
    thresholds: List<ScoreThreshold> = DEFAULT_SCORE_THRESHOLDS,
): ScoreGradeInfo {
    if (score == null || !score.isFinite()) return gradeInfo(ScoreGrade.Dash)
    // Evaluated highest-first so the first inclusive match wins; nothing matches ⇒ F (the web fallback).
    val grade = thresholds.sortedByDescending { it.min }.firstOrNull { score >= it.min }?.label ?: ScoreGrade.F
    return gradeInfo(grade)
}

/** Look up the [ScoreGradeInfo] (tone + numeric) for a known [grade] — a 1:1 port of the web `gradeInfo`. */
fun gradeInfo(grade: ScoreGrade): ScoreGradeInfo = GRADE_PALETTE.getValue(grade)

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs, derived
 * purely so every branch is covered off-device. The view only resolves the tone colour, the size's type
 * style, and the accessible string, then draws the [grade] letter.
 *
 * @property grade the letter the badge renders (web `info.label`).
 * @property tone the render tone (web `info.color`, mapped to a token at the boundary).
 */
data class ScoreBadgeProjection(
    val grade: ScoreGrade,
    val tone: ScoreTone,
) {
    /** The visible text — the grade letter (web `{info.label}`). */
    val visibleLabel: String get() = grade.label
}

/** Reduce an [info] into the render-ready [ScoreBadgeProjection]. */
private fun project(info: ScoreGradeInfo): ScoreBadgeProjection = ScoreBadgeProjection(grade = info.grade, tone = info.tone)

/**
 * Reduce a numeric [score] (mapped via [thresholds]) into the render-ready [ScoreBadgeProjection] — the
 * native mirror of the web `<ScoreBadge score={…} thresholds={…} />` path. Pure (no Compose).
 */
fun projectScore(
    score: Double?,
    thresholds: List<ScoreThreshold> = DEFAULT_SCORE_THRESHOLDS,
): ScoreBadgeProjection = project(numericToGrade(score, thresholds))

/**
 * Reduce a pre-computed [grade] into the render-ready [ScoreBadgeProjection] — the native mirror of the web
 * `<ScoreBadge grade={…} />` path. Pure (no Compose).
 */
fun projectGrade(grade: ScoreGrade): ScoreBadgeProjection = project(gradeInfo(grade))

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * score or grade — so a diagnostics line can never leak a vehicle's drive/charge quality.
 */
object ScoreBadgeDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "ScoreBadge"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
