// Pure, framework-free model + projection for the Recently Unlocked Achievements dashboard widget — the
// native analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/RecentlyUnlockedAchievements.tsx). No Compose, no Android, no HTTP:
// every type here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer. The achievements arrive inside the raw `/analytics/lifetime` payload, so this file
// owns the decode (web `data?.achievements ?? []`), the `unlocked && unlocked_at` filter, the
// `unlocked_at desc` sort, and the footprint slice (web `isWide ? 5 : 3`). Achievements carry no SI/unit
// values (counts, emoji, ISO timestamps, names), so there is no display-boundary conversion here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RecentlyUnlockedAchievements — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

import io.teslasync.shared.core.presentation.achievementunlocks.LifetimeAchievement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.OffsetDateTime

/** The single column count at/above which the wide badge cap applies (web `size.cols >= 3`). */
private const val WIDE_COLS = 3

/** Most-recent badges shown when wide (web `isWide ? 5`). */
private const val WIDE_LIMIT = 5

/** Most-recent badges shown otherwise (web `: 3`). */
private const val NARROW_LIMIT = 3

/** The JSON object key the lifetime payload nests the achievements array under (web `data.achievements`). */
private const val ACHIEVEMENTS_KEY = "achievements"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isWide] branch reproduces the web `size.cols >= 3` test that raises the badge cap from 3 to 5; the web
 * component renders the same badge strip at every footprint, so the only size-derived value is [limit].
 */
data class RecentlyUnlockedSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at three or more columns (web `isWide`): show up to five badges instead of three. */
    val isWide: Boolean get() = cols >= WIDE_COLS

    /** Maximum badges rendered for this footprint (web `const limit = isWide ? 5 : 3`). */
    val limit: Int get() = if (isWide) WIDE_LIMIT else NARROW_LIMIT
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`recently-unlocked-achievements`). A dashboard
 * grid host binds this surface with the same [ID] and honours the same min/max footprint, so the native +
 * web grids stay in lockstep.
 */
object RecentlyUnlockedAchievementsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "recently-unlocked-achievements"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RecentlyUnlockedAchievements"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = RecentlyUnlockedSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = RecentlyUnlockedSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 4 rows (web `maxSize`). */
    val maxSize = RecentlyUnlockedSize(cols = 4, rows = 4)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: RecentlyUnlockedSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RecentlyUnlockedSize): RecentlyUnlockedSize =
        RecentlyUnlockedSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output (the web `t('…')` calls). The pure
 * [RecentlyUnlockedProjection] reads [unlocked] (the per-badge "✓ Unlocked" status) and [viewNamed] (the
 * per-badge `aria-label`, web `t('achievements.viewNamed', …, { name })`); the composable chrome reads
 * [title] / [disabled] / [noneYet]. The composable builds this from `stringResource`; tests pass a
 * deterministic instance. Keeping i18n out of the projection lets the projection stay a pure, locale-stable
 * function.
 */
data class RecentlyUnlockedStrings(
    val title: String,
    val disabled: String,
    val noneYet: String,
    val unlocked: String,
    val viewNamed: (String) -> String,
)

/**
 * One projected, render-ready achievement badge — the native analogue of a web `AchievementBadge` (size
 * `sm`) wrapped in its deep-link button. Pure data (no Compose types): the [icon] emoji, the [name], the
 * [unlockedLabel] ("✓ Unlocked"), and the [contentDescription] folding the web button `aria-label`
 * ("View achievement: {name}") for TalkBack. [id] backs the list key + the deep-link target.
 */
data class RecentlyUnlockedBadge(
    val id: String,
    val icon: String,
    val name: String,
    val unlockedLabel: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the recent unlocks for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. [hasItems] mirrors the web `recent.length > 0` gate that
 * chooses the badge strip over the "none yet" empty state.
 */
data class RecentlyUnlockedDisplay(
    val hasItems: Boolean,
    val badges: List<RecentlyUnlockedBadge>,
    val emptyMessage: String,
)

private val ACHIEVEMENTS_JSON =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

/**
 * Decodes the `achievements` array out of the raw `/analytics/lifetime` [json] (SI/unitless, snake_case on
 * the wire) into the shared [LifetimeAchievement] model. A non-object input, a missing/non-array
 * `achievements` field, or an individually-undecodable entry all collapse gracefully — reproducing the web
 * optional-chaining (`data?.achievements ?? []`) so one malformed row never drops the whole strip.
 */
fun parseAchievements(json: JsonElement?): List<LifetimeAchievement> {
    val array = (json as? JsonObject)?.get(ACHIEVEMENTS_KEY) as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        runCatching { ACHIEVEMENTS_JSON.decodeFromJsonElement(LifetimeAchievement.serializer(), element) }.getOrNull()
    }
}

/**
 * True when at least one achievement is unlocked with a timestamp — the native mirror of the web
 * `recent.length > 0` gate (the empty state shows otherwise). Size-independent: the footprint slice only
 * caps how many badges render, never whether any exist.
 */
fun hasRecentUnlocks(achievements: List<LifetimeAchievement>): Boolean = achievements.any { it.unlocked && !it.unlockedAt.isNullOrBlank() }

/**
 * Pure projection from the decoded [LifetimeAchievement] list to the render-ready [RecentlyUnlockedDisplay]
 * — the native port of the inline `useMemo` derivation in the web source: keep only the unlocked, dated
 * achievements (`a.unlocked && a.unlocked_at`), sort newest-first by `unlocked_at`, take the footprint's
 * limit (web `slice(0, limit)`), and fold each into a deep-linkable badge.
 */
object RecentlyUnlockedProjection {
    /** Project [achievements] for [size] using the localized [strings]. */
    fun project(
        achievements: List<LifetimeAchievement>,
        size: RecentlyUnlockedSize,
        strings: RecentlyUnlockedStrings,
    ): RecentlyUnlockedDisplay {
        val badges =
            achievements
                .filter { it.unlocked && !it.unlockedAt.isNullOrBlank() }
                .sortedByDescending { parseEpochMillis(it.unlockedAt) ?: Long.MIN_VALUE }
                .take(size.limit)
                .map { achievement -> badge(achievement, strings) }
        return RecentlyUnlockedDisplay(
            hasItems = badges.isNotEmpty(),
            badges = badges,
            emptyMessage = strings.noneYet,
        )
    }

    private fun badge(
        achievement: LifetimeAchievement,
        strings: RecentlyUnlockedStrings,
    ): RecentlyUnlockedBadge =
        RecentlyUnlockedBadge(
            id = achievement.id,
            icon = achievement.icon,
            name = achievement.name,
            unlockedLabel = strings.unlocked,
            contentDescription = strings.viewNamed(achievement.name),
        )
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and compares
 * via `Date.parse`). Returns `null` for a blank/absent or unparseable value so the descending sort folds it
 * to the oldest position instead of throwing.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}
