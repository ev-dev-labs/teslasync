// Pure, framework-free model + projection for the InputCommandTile feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/InputCommandTile.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// InputCommandTile is a purely presentational surface — the web component takes its command definition (and
// the loading / favorite / last-status flags plus the two callbacks) as props from the VehicleCommandCenter,
// which owns the command audit query. So this surface binds NO data feed of its own; its only `t()` calls are
// the `commands.toggleFavorite` accessibility label and the dynamic `t(def.labelKey, def.labelFallback)` /
// `t(def.sublabelKey, def.sublabelFallback)` text. As in the sibling AchievementBadge port, the
// cache-then-network lifecycle (loading / error / empty / stale / offline) lives on the owning page, not here;
// modelling those states would invent behaviour the spec does not have. The branches the web source actually
// defines — the loading spinner, the `default|danger|success` variant accent, the favorite toggle, the
// optional sublabel, and the `lastStatus.startsWith('✓')` success-vs-failure status line — are the complete
// state set this surface renders, and each is projected here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/InputCommandTile — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge / AlertCard surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inputcommandtile

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The command tile's visual emphasis — the native analogue of the web `def.variant` typed union
 * (`'default' | 'danger' | 'success'`, default `'default'`). The web uses it only for the hover border tint;
 * on a touch surface (no hover) the composable maps it to a persistent panel accent so a destructive command
 * still reads as distinct.
 */
enum class CommandTileVariant {
    Default,
    Danger,
    Success,
    ;

    companion object {
        /**
         * Maps a raw `variant` value to its [CommandTileVariant], reproducing the web `def.variant ?? 'default'`
         * default: an absent (`null`), blank, or unrecognised value folds to [Default]. Matching is exact +
         * case-sensitive, mirroring the web string union (the backend never emits a differently-cased value).
         */
        fun fromRaw(variant: String?): CommandTileVariant =
            when (variant) {
                "danger" -> Danger
                "success" -> Success
                else -> Default
            }
    }
}

/**
 * The subset of the web `CommandDef` (web/src/features/system/commands.ts) this tile reads. The owning page
 * builds it from its command catalog and passes it in (web parity — the tile is presentational). The icon is
 * a render concern supplied separately as an `ImageVector`, so this model stays free of Compose types and is
 * fully unit-testable.
 *
 * @property labelKey the i18n key for the primary label (web `def.labelKey`).
 * @property labelFallback the English fallback shown when the catalog has no entry (web `def.labelFallback`).
 * @property sublabelKey the optional i18n key for the secondary line (web `def.sublabelKey`).
 * @property sublabelFallback the optional secondary text; its presence gates the sublabel line
 *   (web `def.sublabelFallback && …`).
 * @property variant the visual emphasis (web `def.variant`).
 */
data class CommandTileData(
    val labelKey: String,
    val labelFallback: String,
    val sublabelKey: String? = null,
    val sublabelFallback: String? = null,
    val variant: CommandTileVariant = CommandTileVariant.Default,
)

/** The outcome a [CommandStatusLine] reports — the web `lastStatus.startsWith('✓')` success-vs-failure split. */
enum class CommandOutcome {
    Success,
    Failure,
}

/**
 * A render-ready status line — the native analogue of the web `lastStatus` span. [text] is shown verbatim
 * (it already carries its `✓` / `✗` marker from the command result); [outcome] selects the green/red token at
 * the render boundary.
 */
data class CommandStatusLine(
    val text: String,
    val outcome: CommandOutcome,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host, and each
 * instance is exactly what the thin composable renders (the per-state "snapshot").
 *
 * @property label the resolved primary label (web `t(def.labelKey, def.labelFallback)`).
 * @property sublabel the resolved secondary line, or `null` when the source has no sublabel.
 * @property variant the visual emphasis driving the panel accent.
 * @property statusLine the resolved last-status line, or `null` when there is no status to show.
 */
data class InputCommandTileDisplay(
    val label: String,
    val sublabel: String?,
    val variant: CommandTileVariant,
    val statusLine: CommandStatusLine?,
)

/**
 * Pure projection from a [CommandTileData] (plus the runtime `lastStatus`) to its render-ready
 * [InputCommandTileDisplay] — a 1:1 port of the derivations the web component performs before returning JSX.
 * The i18n resolution is injected as a `(resourceName) -> String?` [lookup] so the projection runs without
 * Android; the composable supplies the real `resources.getIdentifier`-backed lookup.
 */
object InputCommandTileProjection {
    /** Web `lastStatus.startsWith('✓')`: the marker a successful command result is prefixed with. */
    const val SUCCESS_PREFIX: String = "\u2713"

    /** Projects [data] (+ [lastStatus]) into the render-ready [InputCommandTileDisplay] via [lookup]. */
    fun project(
        data: CommandTileData,
        lastStatus: String?,
        lookup: (String) -> String?,
    ): InputCommandTileDisplay =
        InputCommandTileDisplay(
            label = resolveText(lookup, data.labelKey, data.labelFallback),
            sublabel = sublabel(data, lookup),
            variant = data.variant,
            statusLine = statusLineFor(lastStatus),
        )

    /**
     * The resolved sublabel, or `null` when the source carries none. Mirrors the web gate `def.sublabelFallback
     * && (…)`: a blank/absent fallback hides the line; otherwise the text resolves through the (possibly null)
     * `def.sublabelKey ?? ''` key, falling back to the provided text.
     */
    fun sublabel(
        data: CommandTileData,
        lookup: (String) -> String?,
    ): String? {
        val fallback = data.sublabelFallback
        if (fallback.isNullOrBlank()) return null
        return resolveText(lookup, data.sublabelKey.orEmpty(), fallback)
    }

    /**
     * Classifies the runtime `lastStatus` exactly like the web span: a `null`/blank value renders nothing; a
     * value starting with the `✓` [SUCCESS_PREFIX] is a [CommandOutcome.Success], anything else a
     * [CommandOutcome.Failure]. The raw text is preserved for verbatim display.
     */
    fun statusLineFor(lastStatus: String?): CommandStatusLine? {
        if (lastStatus.isNullOrBlank()) return null
        val outcome = if (lastStatus.startsWith(SUCCESS_PREFIX)) CommandOutcome.Success else CommandOutcome.Failure
        return CommandStatusLine(lastStatus, outcome)
    }

    /**
     * Resolves a single label through the catalog by folded resource name, falling back to [fallback] when the
     * key is blank or the catalog has no (non-blank) entry — the native analogue of the web `t(key, fallback)`.
     */
    fun resolveText(
        lookup: (String) -> String?,
        key: String,
        fallback: String,
    ): String {
        if (key.isBlank()) return fallback
        return lookup(foldCatalogKey(key))?.takeIf { it.isNotBlank() } ?: fallback
    }
}

// The catalog generator folds the web dotted i18n keys into Android resource names by prefixing `translation_`
// and replacing every run of non-identifier characters with a single underscore (e.g. `commands.toggleFavorite`
// -> `translation_commands_toggleFavorite`). Kept top-level + identical to the sibling surfaces so the fold is
// shared, deterministic, and unit-tested.
private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/** Folds a web dotted catalog [webKey] into its Android `translation_*` resource name. */
fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the command
 * label, variant, or last-status text — so a diagnostics line can never leak which command a user triggered.
 */
object InputCommandTileDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "InputCommandTile"

    /** The web favorite-toggle i18n key (web `t('commands.toggleFavorite', 'Toggle favorite')`). */
    const val FAVORITE_LABEL_KEY: String = "commands.toggleFavorite"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
