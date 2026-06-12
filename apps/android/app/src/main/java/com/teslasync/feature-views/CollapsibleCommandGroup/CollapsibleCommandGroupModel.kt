// Pure, framework-free model + i18n / persistence projection for the CollapsibleCommandGroup feature view —
// the native analogue of everything the web component derives before returning JSX
// (web/src/features/system/components/CollapsibleCommandGroup.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The web surface is a collapsible group header for one command category. Its only hook is `useTranslation`;
// it binds NO data feed, performs NO async work, and has NO loading / error / stale / offline branch — so (as
// in the sibling BatteryPill / CronParser ports) modelling those data-lifecycle phases would invent behaviour
// the source does not have. The branches the source actually defines are reproduced and tested here: the
// per-category label metadata (web `CATEGORY_META`), the session-storage open-state contract (the
// `teslasync-cat-{vehicleId}-{category}` key, the `stored !== null ? stored === 'true' : defaultOpen`
// initializer, and the `String(open)` write), and the `(count)` header label.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/CollapsibleCommandGroup — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.collapsiblecommandgroup

import io.teslasync.shared.core.diagnostics.Logger
import java.util.concurrent.ConcurrentHashMap

/**
 * One vehicle-command category — the native analogue of the web `CommandCategory` string union
 * (web/src/features/system/commands.ts). [wireName] is the exact web union value, used verbatim in the
 * persistence key so it stays byte-compatible with the web key; [labelKey] / [labelFallback] mirror the web
 * `CATEGORY_META[category]` `labelKey` / `fallback`, resolved through the i18n facade at the display
 * boundary.
 */
enum class CommandCategory(
    val wireName: String,
    val labelKey: String,
    val labelFallback: String,
) {
    Security("security", "commands.cat.security", "Security & Access"),
    Climate("climate", "commands.cat.climate", "Climate & Comfort"),
    ClimateProtection("climate_protection", "commands.cat.climateProtect", "Climate Protection"),
    Charging("charging", "commands.cat.charging", "Charging"),
    Doors("doors", "commands.cat.doors", "Doors & Trunk"),
    Drive("drive", "commands.cat.drive", "Drive"),
    Windows("windows", "commands.cat.windows", "Windows"),
    Sunroof("sunroof", "commands.cat.sunroof", "Sunroof"),
    Schedules("schedules", "commands.cat.schedules", "Schedules"),
    Alerts("alerts", "commands.cat.alerts", "Alerts & Location"),
    Navigation("navigation", "commands.cat.navigation", "Navigation"),
    Software("software", "commands.cat.software", "Software"),
    Vehicle("vehicle", "commands.cat.vehicle", "Vehicle"),
    Media("media", "commands.cat.media", "Media"),
    ;

    companion object {
        /** Resolve a [CommandCategory] from its web [wireName], or `null` when unknown. */
        fun fromWireName(wireName: String): CommandCategory? = entries.firstOrNull { it.wireName == wireName }
    }
}

// ── i18n facade (the native `t(key, default)` analogue; identical seam to the sibling ports) ──────────────

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/**
 * Folds a dotted web i18n key into the Android string-catalog resource name produced by
 * apps/shared/i18n/generators/gen-i18n.ts: a `translation_` prefix, every non-alphanumeric run collapsed to a
 * single underscore, and leading / trailing underscores trimmed. E.g. `commands.cat.climateProtect` →
 * `translation_commands_cat_climateProtect`.
 */
fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/** The Android catalog resource name for a category's label (the folded web `meta.labelKey`). */
fun categoryLabelResource(category: CommandCategory): String = foldCatalogKey(category.labelKey)

/**
 * The localized category label — the native analogue of web `t(meta.labelKey, meta.fallback)`. Resolves the
 * folded catalog key through [lookup], falling back to the web English default (`meta.fallback`).
 */
fun categoryLabel(
    category: CommandCategory,
    lookup: (String) -> String?,
): String = resolveOptional(lookup, categoryLabelResource(category), category.labelFallback)

// ── Persistence (the native session-storage analogue, keyed exactly like the web surface) ─────────────────

private const val STORAGE_PREFIX = "teslasync-cat-"
private const val OPEN_TRUE = "true"
private const val OPEN_FALSE = "false"

/**
 * The persistence key for one (vehicle, category) pair — byte-for-byte the web
 * `teslasync-cat-${vehicleId}-${category}` (the category segment is the [CommandCategory.wireName]).
 */
fun collapseStorageKey(
    vehicleId: Long,
    category: CommandCategory,
): String = "$STORAGE_PREFIX$vehicleId-${category.wireName}"

/**
 * The initial open state — a 1:1 port of the web `useState` initializer
 * `stored !== null ? stored === 'true' : defaultOpen`: a present value is open only when it is exactly
 * "true"; an absent (`null`) value defers to [defaultOpen].
 */
fun resolveInitialOpen(
    stored: String?,
    defaultOpen: Boolean,
): Boolean = if (stored != null) stored == OPEN_TRUE else defaultOpen

/** The serialized open state written back on toggle — the web `String(next)` ("true" / "false"). */
fun serializeOpen(open: Boolean): String = if (open) OPEN_TRUE else OPEN_FALSE

/** The header count label — the web `({count})`, with no locale grouping (web uses `String(count)`). */
fun countLabel(count: Int): String = "($count)"

/**
 * A by-key string store — the native seam for the web `sessionStorage` the surface uses to remember each
 * group's open state. Kept tiny and injectable so the open-state contract is unit-tested and the composable
 * can default to the process-scoped [SessionCommandGroupCollapseStore] (the closest analogue of a browser
 * session: it lives for the app process and is cleared on process death, exactly as session storage clears
 * when the tab closes).
 */
interface CommandGroupCollapseStore {
    /** The persisted value for [key], or `null` when absent — mirrors `sessionStorage.getItem`. */
    fun read(key: String): String?

    /** Persists [value] under [key] — mirrors `sessionStorage.setItem`. */
    fun write(
        key: String,
        value: String,
    )
}

/** Process-scoped [CommandGroupCollapseStore] backing the production composable. Thread-safe. */
object SessionCommandGroupCollapseStore : CommandGroupCollapseStore {
    private val entries = ConcurrentHashMap<String, String>()

    override fun read(key: String): String? = entries[key]

    override fun write(
        key: String,
        value: String,
    ) {
        entries[key] = value
    }

    /** Clears all remembered open states — used by instrumented tests for isolation between cases. */
    fun clear() {
        entries.clear()
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * vehicle id, the category, or the count — so a diagnostics line can never leak which vehicle or category a
 * user opened.
 */
object CollapsibleCommandGroupDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "CollapsibleCommandGroup"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
