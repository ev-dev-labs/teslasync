// Pure, framework-free model + projection for the ToggleCommandTile feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/ToggleCommandTile.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ToggleCommandTile is a purely presentational control. The hosting Vehicle Commands page owns the
// vehicle-state query and the command-log query, the favourites client-state, and the execute /
// request-dialog / toggle-favourite callbacks; it hands this surface a single command definition plus the
// per-tile `state`, `loading`, `lastStatus`, and `isFavorite` flags. So — exactly as the sibling CommandTile /
// InputCommandTile presentational ports document — the loading / empty / error / stale / offline DATA
// lifecycle lives on that owning page, not here; modelling those data states on a hook-less surface would
// invent behaviour the web spec lacks (honesty covenant: no silent drift). The only data source the web
// component itself binds is `useTranslation`, mapped natively to the generated i18n catalog (P1/S10): the
// static `commands.toggleFavorite` / `commands.on` / `commands.off` keys resolve in the composable, while the
// command's label arrives through the by-name catalog fold (the native analogue of the web
// `t(def.labelKey, def.labelFallback)` dynamic-key lookup, which on Android lives at the catalogue boundary —
// `stringResource` needs compile-time ids).
//
// What this surface genuinely varies — and what this file projects as pure, testable logic — is:
//   • the on/off state (web `def.stateField && state ? Boolean(state[def.stateField]) : localToggle`) —
//     see [ToggleCommandTileProjection.isOn];
//   • the tap outcome (web `handleClick`): ignore while loading, turn off when on, open the input dialog
//     when off + the command needs input, otherwise turn on — see [ToggleClickResolver];
//   • the last-status tone (web `lastStatus.startsWith('✓') ? green : red`, rendered only when truthy) —
//     see [CommandStatusLine];
//   • the semantic variant (web `def.variant ?? 'default'`) — see [ToggleVariant].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ToggleCommandTile — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.togglecommandtile

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The toggle tile's visual emphasis — the native analogue of the web `def.variant` typed union
 * (`'default' | 'danger' | 'success'`, default `'default'`). The web selects the active-state colour wash
 * from this (the `onStyles` map: default → neon-cyan, danger → neon-red, success → neon-green); the composable
 * maps it to the matching Material 3 design tokens (default → status.info, which is #00f0ff cyan in the dark
 * theme, danger → status.danger, success → status.success).
 */
enum class ToggleVariant {
    Default,
    Danger,
    Success,
    ;

    companion object {
        /**
         * Maps a raw `variant` value to its [ToggleVariant], reproducing the web `def.variant ?? 'default'`
         * default: an absent (`null`), blank, or unrecognised value folds to [Default]. Matching is exact +
         * case-sensitive, mirroring the web string union (the backend never emits a differently-cased value).
         */
        fun fromRaw(variant: String?): ToggleVariant =
            when (variant) {
                "danger" -> Danger
                "success" -> Success
                else -> Default
            }
    }
}

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
 * The outcome of tapping a toggle tile — the native analogue of the branches of the web `handleClick`. The
 * composable maps each case to the matching host callback (and the local on/off flip) so the tap logic stays a
 * pure, unit-tested function rather than branching inside the click lambda.
 */
enum class ToggleAction {
    /** Do nothing — web `if (loading) return`. */
    Ignore,

    /** The tile is on: run the off command — web `onExecute(def.commandOff!)`. */
    TurnOff,

    /** The tile is off and needs input: ask the host to open the dialog — web `onRequestDialog(def)`. */
    RequestDialog,

    /** The tile is off and needs no input: run the on command — web `onExecute(def.command, def.params)`. */
    TurnOn,
}

/**
 * The subset of the web `CommandDef` (web/src/features/system/commands.ts) this tile reads. The owning page
 * builds it from its command catalog and passes it in (web parity — the tile is presentational). The on/off
 * glyphs are render concerns supplied separately as `ImageVector`s (the web `def.icon` / `def.iconOff`), so
 * this model stays free of Compose types and is fully unit-testable.
 *
 * @property labelKey the i18n key for the primary label (web `def.labelKey`).
 * @property labelFallback the English fallback shown when the catalog has no entry (web `def.labelFallback`).
 * @property command the wire command run to turn the tile on (web `def.command`).
 * @property commandOff the wire command run to turn the tile off, or `null` (web `def.commandOff`).
 * @property stateField the vehicle-state field whose truthiness drives the controlled on/off state, or `null`
 *   for an uncontrolled (local-toggle) tile (web `def.stateField`).
 * @property hasInputConfig whether turning the tile on opens an input dialog rather than executing directly
 *   (web `def.inputConfig` truthiness).
 * @property variant the visual emphasis (web `def.variant`).
 * @property params the opaque parameter set forwarded to the host on turn-on (web `def.params`,
 *   `Record<string, unknown>`).
 */
data class ToggleCommandTileData(
    val labelKey: String,
    val labelFallback: String,
    val command: String,
    val commandOff: String? = null,
    val stateField: String? = null,
    val hasInputConfig: Boolean = false,
    val variant: ToggleVariant = ToggleVariant.Default,
    val params: Map<String, Any?> = emptyMap(),
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host, and each
 * instance is exactly what the thin composable renders (the per-state "snapshot").
 *
 * @property label the resolved primary label (web `t(def.labelKey, def.labelFallback)`).
 * @property isOn whether the tile reads as on (web `isOn`) — drives the icon, colour wash, dot, and ON/OFF line.
 * @property variant the visual emphasis driving the active colour wash.
 * @property statusLine the resolved last-status line, or `null` when there is no status to show.
 */
data class ToggleCommandTileDisplay(
    val label: String,
    val isOn: Boolean,
    val variant: ToggleVariant,
    val statusLine: CommandStatusLine?,
)

/**
 * Pure resolver for the tile tap, reproducing the web `handleClick` precedence exactly: a loading tile ignores
 * taps; an on tile turns off; an off tile that needs input opens the dialog; any other off tile turns on.
 * Side-effect-free, so the whole tap contract is covered by the off-device unit gate.
 */
object ToggleClickResolver {
    /** Resolve the tap [ToggleAction] for a tile that is [loading] and/or [isOn] and/or [hasInputConfig]. */
    fun resolve(
        loading: Boolean,
        isOn: Boolean,
        hasInputConfig: Boolean,
    ): ToggleAction =
        when {
            loading -> ToggleAction.Ignore
            isOn -> ToggleAction.TurnOff
            hasInputConfig -> ToggleAction.RequestDialog
            else -> ToggleAction.TurnOn
        }
}

/**
 * Pure projection from a [ToggleCommandTileData] (plus the runtime vehicle state, local toggle, and
 * `lastStatus`) to its render-ready [ToggleCommandTileDisplay] — a 1:1 port of the derivations the web
 * component performs before returning JSX. The i18n resolution is injected as a `(resourceName) -> String?`
 * [lookup] so the projection runs without Android; the composable supplies the real
 * `resources.getIdentifier`-backed lookup.
 */
object ToggleCommandTileProjection {
    /** Web `lastStatus.startsWith('✓')`: the marker a successful command result is prefixed with. */
    const val SUCCESS_PREFIX: String = "\u2713"

    /**
     * Resolves the on/off state exactly like the web `isOn` derivation:
     * `def.stateField && state ? Boolean(state[def.stateField]) : localToggle`. When the command names a
     * [stateField] and the [vehicleState] is present, the tile is controlled by that field's truthiness (a
     * missing key reads as off, mirroring `Boolean(undefined)`); otherwise it falls back to the uncontrolled
     * [localToggle].
     */
    fun isOn(
        stateField: String?,
        vehicleState: Map<String, Boolean?>?,
        localToggle: Boolean,
    ): Boolean =
        if (!stateField.isNullOrBlank() && vehicleState != null) {
            vehicleState[stateField] == true
        } else {
            localToggle
        }

    /** Projects [data] (+ runtime [vehicleState] / [localToggle] / [lastStatus]) into the render-ready view. */
    fun project(
        data: ToggleCommandTileData,
        vehicleState: Map<String, Boolean?>?,
        localToggle: Boolean,
        lastStatus: String?,
        lookup: (String) -> String?,
    ): ToggleCommandTileDisplay =
        ToggleCommandTileDisplay(
            label = resolveText(lookup, data.labelKey, data.labelFallback),
            isOn = isOn(data.stateField, vehicleState, localToggle),
            variant = data.variant,
            statusLine = statusLineFor(lastStatus),
        )

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
 * label, variant, on/off state, or last-status text — so a diagnostics line can never leak which command the
 * operator triggered.
 */
object ToggleCommandTileDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ToggleCommandTile"

    /** The web favourite-toggle i18n key (web `t('commands.toggleFavorite', 'Toggle favorite')`). */
    const val FAVORITE_LABEL_KEY: String = "commands.toggleFavorite"

    /** The web on-state i18n key (web `t('commands.on', 'ON')`). */
    const val ON_LABEL_KEY: String = "commands.on"

    /** The web off-state i18n key (web `t('commands.off', 'OFF')`). */
    const val OFF_LABEL_KEY: String = "commands.off"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
