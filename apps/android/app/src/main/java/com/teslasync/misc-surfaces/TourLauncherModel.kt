// Pure, framework-free model + registry + projection + diagnostics for the TourLauncher misc surface — the
// native analogue of the data the web component owns (web/src/features/onboarding/TourLauncher.tsx via
// web/src/lib/tourRegistry.ts). No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// TourLauncher is a modal that lists every registered onboarding tour. The web component reads three pure /
// synchronous things — the static `listTours()` registry, the per-tour completion flag (`isTourCompleted`,
// a localStorage read), and whether each tour matches the current route (`isRecommendedForRoute`, against
// `useLocation().pathname`) — and renders one row per tour: a check vs play glyph, the title + an optional
// "Recommended for this page" chip and "Completed" badge, the one-line description, and a Start/Replay
// action. This file owns exactly that data + decision surface:
//   - [TourLauncherRegistry] reproduces the web `TOURS` map in the web `TOUR_ORDER` display order.
//   - [TourRouteMatch] reproduces the web `isRecommendedForRoute` string-vs-RegExp semantics verbatim.
//   - [TourCompletions] + [TourStorage] reproduce the web localStorage key scheme
//     (`teslasync:tour:v{version}:{id}` ⇒ completed/skipped) so a completion written by the tour player is
//     read back identically, and `resetAllTours()` clears the same key space.
//   - [TourLauncherProjection.rows] folds the three inputs into the render-ready [TourRow] list.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/misc-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.tourlauncher

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The persisted completion state of a tour — the native analogue of the web localStorage value
 * (`'completed' | 'skipped'`). The launcher treats either as "done" (a check + a Replay action); the
 * distinction is preserved so a future surface can tell a finished tour from a skipped one.
 */
enum class TourCompletionStatus {
    /** The user walked every step (web `markTourCompleted`). */
    Completed,

    /** The user closed the tour mid-way (web `markTourSkipped`). */
    Skipped,
}

/**
 * Where the launcher highlights a tour as "Recommended for this page" — the native analogue of a web
 * `TourDefinition.routeMatch` (a string prefix or a `RegExp`). [matches] reproduces the web
 * `isRecommendedForRoute` semantics 1:1 so the recommended row never drifts from the web.
 */
sealed interface TourRouteMatch {
    /** Whether [pathname] (web `useLocation().pathname`) recommends this tour. */
    fun matches(pathname: String): Boolean

    /**
     * The web string `routeMatch === '/'` special case: the root tour is recommended only on the exact
     * dashboard path, never on a nested route.
     */
    data object Root : TourRouteMatch {
        override fun matches(pathname: String): Boolean = pathname == "/"
    }

    /**
     * The web non-root string `routeMatch`: recommended on the exact path or any `prefix/`-rooted subtree
     * (web `pathname === prefix || pathname.startsWith(`${'$'}{prefix}/`)`). Unused by the shipped registry
     * (every non-root tour uses a [Pattern]) but kept for 1:1 parity with the web `isRecommendedForRoute`.
     */
    data class Prefix(
        val prefix: String,
    ) : TourRouteMatch {
        override fun matches(pathname: String): Boolean = pathname == prefix || pathname.startsWith("$prefix/")
    }

    /**
     * The web `RegExp` `routeMatch`: recommended wherever `regex.test(pathname)` is true. Kotlin
     * [Regex.containsMatchIn] reproduces JS `RegExp.test` (a search, not a full match), so the same
     * `^/…`-anchored patterns behave identically.
     */
    data class Pattern(
        val regex: Regex,
    ) : TourRouteMatch {
        override fun matches(pathname: String): Boolean = regex.containsMatchIn(pathname)
    }
}

/**
 * One registered onboarding tour, as far as the launcher is concerned — the launcher-relevant subset of the
 * web `TourDefinition` (it never reads `steps`, which belong to the tour player). [id] is the stable registry
 * key used for storage, projection, telemetry, and i18n lookup; [version] bumps invalidate a stored
 * completion (web "bump to silently invalidate", same key scheme); [routeMatch] drives the recommended chip.
 *
 * @property id stable identifier (web `id`) — storage key, registry lookup, telemetry, i18n title/description.
 * @property routeMatch where the launcher highlights this tour as recommended (web `routeMatch`).
 * @property version content version (web `version`) — a stored completion at an older version reads as not done.
 */
data class TourDefinition(
    val id: String,
    val routeMatch: TourRouteMatch,
    val version: Int,
) {
    /** Whether this tour is recommended for [pathname] — the web `isRecommendedForRoute(def, pathname)`. */
    fun isRecommendedForRoute(pathname: String): Boolean = routeMatch.matches(pathname)
}

/**
 * The persisted-completion storage scheme — the native analogue of the web `tourRegistry` localStorage keys.
 * Centralised so [TourCompletions], the store, and "reset all" all agree on the exact key space (covenant:
 * no silent drift — a completion written here must read back identically).
 */
object TourStorage {
    /** Web `STORAGE_PREFIX`. Every key this surface owns starts with `"$PREFIX:"`. */
    const val PREFIX: String = "teslasync:tour"

    /** Prefix of a per-tour completion key (`teslasync:tour:v{version}:{id}`) — excludes the list-seen key. */
    const val COMPLETION_PREFIX: String = "$PREFIX:v"

    /** Web `LIST_SEEN_KEY` — set once the launcher has been opened (web `markTourListSeen`). */
    const val LIST_SEEN_KEY: String = "$PREFIX:list-seen"

    /** Web legacy single-flag removed by `resetAllTours()` so a pre-migration completion is fully cleared. */
    const val LEGACY_COMPLETED_KEY: String = "teslasync-tour-completed"

    /** The boolean value the list-seen flag stores (web `'true'`). */
    const val SEEN_VALUE: String = "true"

    /** Web `storageKey(id, version)` — `teslasync:tour:v{version}:{id}`. */
    fun completionKey(
        id: String,
        version: Int,
    ): String = "$PREFIX:v$version:$id"

    /** Whether [key] belongs to this surface's key space — the "reset all tours" clear predicate. */
    fun isOwnedKey(key: String): Boolean = key.startsWith("$PREFIX:") || key == LEGACY_COMPLETED_KEY
}

/**
 * An immutable snapshot of the persisted per-tour completion flags — the native analogue of reading the web
 * localStorage tour keys. [isCompleted] is the web `isTourCompleted(id, version)` (a flag exists for the
 * current version), the only completion read the launcher needs.
 *
 * @property entries completion status keyed by the [TourStorage.completionKey] storage key.
 */
data class TourCompletions(
    val entries: Map<String, TourCompletionStatus> = emptyMap(),
) {
    /** Web `isTourCompleted(id, version)`: a completed/skipped flag exists for this tour at this version. */
    fun isCompleted(
        id: String,
        version: Int,
    ): Boolean = entries.containsKey(TourStorage.completionKey(id, version))

    companion object {
        /** The empty snapshot — nothing stored yet (the cold-start / post-reset state). */
        val EMPTY: TourCompletions = TourCompletions()

        /**
         * Projects a raw persisted key→value map (web localStorage) onto a [TourCompletions]. Only per-tour
         * completion keys carrying a recognised `completed`/`skipped` value are kept, so the list-seen flag,
         * the legacy key, and any unrelated preference are ignored (web reads the version-scoped key directly).
         */
        fun fromStorage(stored: Map<String, String>): TourCompletions =
            TourCompletions(
                stored
                    .asSequence()
                    .filter { (key, _) -> key.startsWith(TourStorage.COMPLETION_PREFIX) }
                    .mapNotNull { (key, value) -> parseStatus(value)?.let { key to it } }
                    .toMap(),
            )

        private fun parseStatus(value: String): TourCompletionStatus? =
            when (value) {
                "completed" -> TourCompletionStatus.Completed
                "skipped" -> TourCompletionStatus.Skipped
                else -> null
            }
    }
}

/**
 * The registry of onboarding tours the launcher lists — the native port of the web `TOURS` map iterated in
 * the web `TOUR_ORDER`. Only the launcher-relevant fields are carried (id, route match, version); the i18n
 * title/description resolve at the Compose boundary by [id], and the step scripts belong to the tour player.
 */
object TourLauncherRegistry {
    /**
     * Every tour in the web `TOUR_ORDER` display order: main, vehicles, drives, charging, alerts,
     * automations, settings, debugger. Route matches + versions are copied verbatim from the web tour
     * definitions so the recommended row and version-scoped completion stay identical across platforms.
     */
    val TOURS: List<TourDefinition> =
        listOf(
            TourDefinition("main", TourRouteMatch.Root, version = 2),
            TourDefinition("vehicles", TourRouteMatch.Pattern(Regex("^/vehicles")), version = 1),
            TourDefinition("drives", TourRouteMatch.Pattern(Regex("^/drives")), version = 1),
            TourDefinition(
                "charging",
                TourRouteMatch.Pattern(Regex("^/(charging|cost-analysis|charging-curve|smart-charge)")),
                version = 1,
            ),
            TourDefinition("alerts", TourRouteMatch.Pattern(Regex("^/notifications/(alerts|studio)")), version = 1),
            TourDefinition("automations", TourRouteMatch.Pattern(Regex("^/automations")), version = 1),
            TourDefinition("settings", TourRouteMatch.Pattern(Regex("^/settings")), version = 1),
            TourDefinition(
                "debugger",
                TourRouteMatch.Pattern(
                    Regex(
                        "^/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|" +
                            "mqtt-inspector|signal-log|redis-signals)",
                    ),
                ),
                version = 1,
            ),
        )
}

/**
 * One render-ready launcher row — the pure projection of a [TourDefinition] against the completion snapshot
 * and the current route. The composable maps [id] to its localized title/description and draws the
 * completed/recommended affordances; no Compose or Android types leak into this layer.
 *
 * @property id the tour id (web `def.id`) — the i18n + telemetry key.
 * @property version the tour version (web `def.version`) — start/replay completion is scoped to it.
 * @property completed web `isTourCompleted(def.id, def.version)` — check glyph, "Completed" badge, Replay.
 * @property recommended web `isRecommendedForRoute(def, pathname)` — primary highlight + Sparkles chip.
 */
data class TourRow(
    val id: String,
    val version: Int,
    val completed: Boolean,
    val recommended: Boolean,
)

/** Folds the registry + completion snapshot + current route into the render-ready [TourRow] list. */
object TourLauncherProjection {
    /**
     * The launcher's per-row computation — the web `tours.map((def) => { completed; recommended; … })`. Pure
     * and order-preserving (the registry order is the display order), so the whole list is verified off-device.
     */
    fun rows(
        definitions: List<TourDefinition>,
        completions: TourCompletions,
        pathname: String,
    ): List<TourRow> =
        definitions.map { def ->
            TourRow(
                id = def.id,
                version = def.version,
                completed = completions.isCompleted(def.id, def.version),
                recommended = def.isRecommendedForRoute(pathname),
            )
        }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries only the surface [SLUG] (and, for
 * the start/reset actions, the non-PII tour id) — never a path or any user data — so a diagnostics line can
 * never leak where the user is or which tours they have taken.
 */
object TourLauncherDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "tour-launcher"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TourLauncher"

    private const val VIEW_OPENED: String = "view.opened"
    private const val LAUNCHER_OPENED: String = "tourLauncher.opened"
    private const val TOUR_START: String = "tourLauncher.start"
    private const val RESET_ALL: String = "tourLauncher.resetAll"
    private const val SURFACE_KEY: String = "surface"
    private const val TOUR_KEY: String = "tour"

    /** Emits the one mandated `view.opened` diagnostic for this surface (P1/S11). Call once on first composition. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }

    /** Records that the launcher modal was opened (web `markTourListSeen` moment). Carries only the slug. */
    fun recordLauncherOpened(logger: Logger) {
        logger.info(LAUNCHER_OPENED, mapOf(SURFACE_KEY to SLUG))
    }

    /** Records a Start/Replay action (web `dispatchTourStart`). Carries only the non-PII tour [id]. */
    fun recordTourStart(
        logger: Logger,
        id: String,
    ) {
        logger.info(TOUR_START, mapOf(SURFACE_KEY to SLUG, TOUR_KEY to id))
    }

    /** Records the "Reset all tours" action (web `resetAllTours`). Carries only the slug. */
    fun recordResetAll(logger: Logger) {
        logger.info(RESET_ALL, mapOf(SURFACE_KEY to SLUG))
    }
}
