// Pure, framework-free model + projection for the CommandTile feature view — the native analogue of every
// derivation the web component performs before returning JSX (web/src/features/system/components/CommandTile.tsx).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// CommandTile is a purely presentational control. The hosting Commands page owns the vehicle-state query and the
// command-log query, the favourites client-state, and the execute / request-dialog / toggle-favourite callbacks;
// it hands this surface a single command definition plus the per-tile `loading`, `lastStatus`, and `isFavorite`
// flags. So — exactly as the sibling ToolCard / QuickNav / AddWidgetButton presentational ports document — the
// loading / empty / error / stale / offline DATA lifecycle lives on that owning page, not here; modelling those
// data states on a hook-less surface would invent behaviour the web spec does not have (honesty covenant: no
// silent drift). The only data source the web component itself binds is `useTranslation`, mapped natively to the
// generated i18n catalog (P1/S10): its own `commands.toggleFavorite` key resolves in the composable, while each
// command's label/sublabel arrive already-resolved on the [CommandTileDef] (the native analogue of the web
// `t(def.labelKey, def.labelFallback)` dynamic-key lookup, which on Android lives at the command-catalogue
// boundary — `stringResource` needs compile-time ids).
//
// What this surface genuinely varies — and what this file projects as pure, testable logic — is:
//   • the tap outcome (web `handleClick`): ignore while loading, request the confirm dialog when dangerous,
//     otherwise execute — see [CommandTileClickResolver];
//   • the last-status tone (web `lastStatus.startsWith('✓') ? green : red`, rendered only when truthy) —
//     see [CommandStatusTone];
//   • the semantic variant (web `def.variant ?? 'default'`) — see [CommandVariant].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CommandTile — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandtile

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CommandTileRegistration {
    /** Stable surface id. */
    const val ID: String = "command-tile"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandTile"
}

/**
 * Semantic emphasis of a command tile — the native analogue of the web `def.variant` union
 * (`'default' | 'danger' | 'success'`). On web it selects only a pointer-hover border tint (the `hoverStyles`
 * map); there is no hover on touch, so the composable maps it to a static, subtle [GlassPanel] accent border so
 * the variant's meaning (a destructive vs. confirming action) still reads on Android. The accent token mirrors
 * the web neon hex per variant (dark-theme tokens equal the web hexes): danger → status.danger (#EF4444),
 * success → status.success (#10B981), default → the standard panel outline (web's un-hovered border).
 */
enum class CommandVariant {
    Default,
    Danger,
    Success,
    ;

    companion object {
        /**
         * Maps a raw `variant` value to its [CommandVariant], reproducing the web `def.variant ?? 'default'`
         * fallback: a `null`, blank, or unknown value folds to [Default]. Tolerant of case/whitespace; the web
         * union is exact lowercase, but folding a stray casing to default is the same safe outcome.
         */
        fun fromRaw(raw: String?): CommandVariant =
            when (raw?.trim()?.lowercase(Locale.ROOT)) {
                "danger" -> Danger
                "success" -> Success
                else -> Default
            }
    }
}

/**
 * Tone of the optional `lastStatus` line — the native analogue of the web
 * `lastStatus.startsWith('✓') ? 'text-neon-green/60' : 'text-neon-red/60'` decision, gated by the web
 * `{lastStatus && …}` truthiness check. The composable resolves each case to a design-token color
 * (success → status.success, error → status.danger) and renders the raw status text verbatim, exactly like web.
 */
enum class CommandStatusTone {
    /** No status line — web `lastStatus` is `undefined`/empty (falsy), so nothing renders. */
    None,

    /** A success result — web `lastStatus.startsWith('✓')`. */
    Success,

    /** A failure result — web `else` branch. */
    Error,
    ;

    companion object {
        /** The success sentinel the backend prefixes onto a successful command result — web `'✓'`. */
        const val SUCCESS_PREFIX: String = "\u2713"

        /**
         * Classifies a raw `lastStatus` exactly like the web render: a `null`/blank status is [None] (web's
         * falsy `{lastStatus && …}` guard), a status beginning with the [SUCCESS_PREFIX] is [Success], and any
         * other non-blank status is [Error] (web's `else`).
         */
        fun fromStatus(status: String?): CommandStatusTone =
            when {
                status.isNullOrBlank() -> None
                status.startsWith(SUCCESS_PREFIX) -> Success
                else -> Error
            }
    }
}

/**
 * The outcome of tapping a command tile — the native analogue of the three branches of the web `handleClick`.
 * The composable maps each case to the matching host callback so the tap logic stays a pure, unit-tested
 * function rather than branching inside the click lambda.
 */
enum class CommandTileAction {
    /** Do nothing — web `if (loading) return`. */
    Ignore,

    /** Ask the host to open the confirm dialog — web `if (def.dangerous) { onRequestDialog(def); return; }`. */
    RequestDialog,

    /** Run the command immediately — web `onExecute(def.command, def.params)`. */
    Execute,
}

/**
 * Pure resolver for the tile tap, reproducing the web `handleClick` precedence exactly: a loading tile ignores
 * taps, a dangerous tile routes to the confirm dialog, and any other tile executes. Side-effect-free, so the
 * whole tap contract is covered by the off-device unit gate.
 */
object CommandTileClickResolver {
    /** Resolve the tap [CommandTileAction] for a tile that is [loading] and/or [dangerous]. */
    fun resolve(
        loading: Boolean,
        dangerous: Boolean,
    ): CommandTileAction =
        when {
            loading -> CommandTileAction.Ignore
            dangerous -> CommandTileAction.RequestDialog
            else -> CommandTileAction.Execute
        }
}

/**
 * One render-ready command definition — the native analogue of the parts of the web `CommandDef` this
 * presentational tile reads. Pure data (no Compose types): the composable receives the command glyph as a
 * separate `ImageVector` argument (the web `def.icon`), resolves [variant] to a panel accent, and forwards
 * [command] + [params] to the host's execute callback verbatim.
 *
 * @property id stable command id (web `def.id`) — used as the diagnostics/test handle, never shown.
 * @property command the wire command name passed to the host on execute (web `def.command`).
 * @property label the already-localized primary label (web `t(def.labelKey, def.labelFallback)`).
 * @property sublabel the already-localized secondary label, or `null` when the command has none
 *   (web `def.sublabelFallback && t(def.sublabelKey ?? '', def.sublabelFallback)`).
 * @property variant the semantic emphasis (web `def.variant ?? 'default'`).
 * @property dangerous whether the command needs confirmation — drives the warning indicator + dialog routing
 *   (web `def.dangerous`).
 * @property params the opaque parameter set forwarded to the host on execute (web `def.params`,
 *   `Record<string, unknown>`).
 */
data class CommandTileDef(
    val id: String,
    val command: String,
    val label: String,
    val sublabel: String? = null,
    val variant: CommandVariant = CommandVariant.Default,
    val dangerous: Boolean = false,
    val params: Map<String, Any?> = emptyMap(),
)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CommandTileRegistration.SLUG] (P1/S11).
 * Carries only the surface slug — never the command name, params, or favourite state — so a diagnostics line can
 * never leak which command the operator was looking at. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
object CommandTileDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to CommandTileRegistration.SLUG))
    }
}
