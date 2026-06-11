// Pure, framework-free model + projection for the AchievementBadge feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/analytics/components/AchievementBadge.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// AchievementBadge is a purely presentational surface — the web component takes its `achievement` (and an
// optional `size`) as props from the lifetime-stats / achievements grid that owns the TanStack query, so
// this surface binds NO data hook of its own (its only `t()` call is the `lifetime.unlocked` label). As in
// the sibling ToolCard / StatusHeader ports, the cache-then-network lifecycle (loading / error / stale /
// offline) lives on the owning page, not here; modelling those states would invent behaviour the spec does
// not have (drift). The branches the web source actually defines — unlocked vs locked styling, the
// near-complete (`!unlocked && progress >= 0.8`) emphasis, the progress-ring-vs-icon composition, and the
// "✓ Unlocked" vs `{pct}%` status — are the complete state set this surface renders, and each is projected
// here.
//
// [AchievementData] mirrors the web `AchievementData` interface 1:1 (snake_case `unlocked_at` via
// @SerialName, every field defaulted) so the projection runs straight off the cached API JSON.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AchievementBadge — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ToolCard / StatusHeader surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.achievementbadge

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/**
 * One achievement — the native mirror of the web `AchievementData` interface
 * (web/src/features/analytics/components/AchievementBadge.tsx). `unlocked_at` keeps its snake_case wire
 * name via @SerialName and every field defaults so a partial or still-loading payload decodes without
 * error (the API list endpoint may carry extra columns; a decoder must ignore unknown keys).
 */
@Serializable
data class AchievementData(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val icon: String = "",
    val unlocked: Boolean = false,
    @SerialName("unlocked_at") val unlockedAt: String? = null,
    val progress: Double = 0.0,
    val target: Double = 0.0,
    val current: Double = 0.0,
)

/**
 * Badge size — the native analogue of the web `size?: 'sm' | 'md' | 'lg'` prop (default `'md'`). Selects
 * the ring diameter, stroke, icon size, and inter-element gap in the composable's geometry table; the
 * default and unknown-value fold to [Md] mirror the web default parameter.
 */
enum class AchievementBadgeSize {
    Sm,
    Md,
    Lg,
    ;

    companion object {
        /**
         * Maps a raw `size` prop to its [AchievementBadgeSize], reproducing the web typed union with its
         * `size = 'md'` default: an absent (`null`) or unrecognised value folds to [Md].
         */
        fun fromRaw(size: String?): AchievementBadgeSize =
            when (size) {
                "sm" -> Sm
                "md" -> Md
                "lg" -> Lg
                else -> Md
            }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property name the achievement name (web `achievement.name`); also the icon's accessibility label.
 * @property description the secondary one-line description (web `achievement.description`).
 * @property icon the emoji/glyph rendered in the badge (web `achievement.icon`).
 * @property unlocked whether the achievement is earned (web `achievement.unlocked`) — drives the gold
 *   accent vs the muted in-progress styling and the "✓ Unlocked" vs `{pct}%` status.
 * @property showProgressRing whether the progress ring is drawn (web renders it only when `!unlocked`).
 * @property isNearComplete the web `!unlocked && progress >= 0.8` emphasis: the ring switches to the
 *   accent color and the card pulses.
 * @property percent the integer progress percentage (web `Math.round(progress * 100)`), fed to the ring
 *   as its value and rendered as the `{pct}%` status when locked.
 */
data class AchievementBadgeDisplay(
    val name: String,
    val description: String,
    val icon: String,
    val unlocked: Boolean,
    val showProgressRing: Boolean,
    val isNearComplete: Boolean,
    val percent: Int,
)

/**
 * Pure projection from an [AchievementData] to its render-ready [AchievementBadgeDisplay] — a 1:1 port of
 * the three derivations the web component performs (`isNearComplete`, `pct`, and the unlocked/locked
 * branch) before returning JSX.
 */
object AchievementBadgeProjection {
    /** Web `progress >= 0.8`: the threshold above which an unearned achievement is "near complete". */
    const val NEAR_COMPLETE_THRESHOLD: Double = 0.8

    private const val PERCENT_SCALE = 100

    /** Select the render-ready view for [achievement]. */
    fun project(achievement: AchievementData): AchievementBadgeDisplay =
        AchievementBadgeDisplay(
            name = achievement.name,
            description = achievement.description,
            icon = achievement.icon,
            unlocked = achievement.unlocked,
            showProgressRing = !achievement.unlocked,
            isNearComplete = !achievement.unlocked && achievement.progress >= NEAR_COMPLETE_THRESHOLD,
            percent = percent(achievement.progress),
        )

    /**
     * The integer progress percentage the web renders, `Math.round(progress * 100)`. Kotlin's
     * [roundToInt] rounds halves towards positive infinity, matching JavaScript's `Math.round`.
     */
    fun percent(progress: Double): Int = (progress * PERCENT_SCALE).roundToInt()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * achievement name, progress, or unlocked timestamp — so a diagnostics line can never leak a user's
 * achievement posture.
 */
object AchievementBadgeDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "AchievementBadge"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
