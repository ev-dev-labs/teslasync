// Pure, framework-free model + projection for the Command Quick Actions dashboard widget — the native
// analogue of the data + composition the web component derives before returning JSX
// (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The widget reads no unit-bearing values (commands carry no SI
// quantities), so there is no display-unit conversion at this boundary — only footprint-driven
// composition + i18n.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/CommandQuickActionsWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandquickactions

import io.teslasync.android.components.datadisplay.FreshnessAge

/**
 * The widget's grid footprint (columns x rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` logic in the web source: a single 1x1 cell renders the compact icon-only grid,
 * three-or-more columns render the full eight-command grid, otherwise the six-command grid.
 */
data class CommandQuickActionsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single 1x1 cell (web `size.cols <= 1 && size.rows <= 1`): icon-only, no title. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1

    /** True at three or more columns (web `size.cols >= 3`): show every command. */
    val isWide: Boolean get() = cols >= 3
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/commands.ts (`command-quick-actions`). A dashboard grid
 * host binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object CommandQuickActionsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "command-quick-actions"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "commands"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "CommandQuickActionsWidget"

    /** Default footprint: 2 columns x 2 rows. */
    val defaultSize = CommandQuickActionsSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column x 2 rows. */
    val minSize = CommandQuickActionsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns x 40 rows. */
    val maxSize = CommandQuickActionsSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: CommandQuickActionsSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: CommandQuickActionsSize): CommandQuickActionsSize =
        CommandQuickActionsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Glyph family for a command button; mapped to a concrete `ImageVector` at the render boundary. */
enum class CommandQuickActionsGlyph { Lock, Unlock, ClimateOn, ClimateOff, Frunk, Horn, Flash, Trunk, Zap }

/**
 * Semantic accent family for a command icon — the native analogue of the web per-command Tailwind text
 * color (`text-neon-green`, `text-neon-red`, …). Mapped to a concrete `Color` at the render boundary so
 * this pure model stays free of Compose types.
 */
enum class CommandQuickActionsAccent { Green, Red, Cyan, Blue, Purple, Amber, Yellow, Indigo }

/** The localized-label selector for a [QuickCommand] (web `labelKey`/`labelFallback`). */
enum class CommandLabelKey { Lock, Unlock, ClimateOn, ClimateOff, Frunk, Horn, Flash, Trunk }

/**
 * One quick-command definition — the native counterpart of the web `QuickCommand` interface. [id] is the
 * stable widget-local key (web `id`), [command] is the backend action name placed in the command body
 * (web `command`, e.g. `actuate_frunk`), [glyph] + [accent] drive the render boundary, and [labelKey]
 * names the localized label resolved through [CommandQuickActionsStrings].
 */
data class QuickCommand(
    val id: String,
    val command: String,
    val glyph: CommandQuickActionsGlyph,
    val accent: CommandQuickActionsAccent,
    val labelKey: CommandLabelKey,
)

/**
 * The eight quick commands, in the web source's order
 * (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx `COMMANDS`). The backend action
 * names match the web `command` field verbatim so the native surface dispatches the identical command.
 */
val COMMAND_QUICK_ACTIONS: List<QuickCommand> =
    listOf(
        QuickCommand("lock", "lock", CommandQuickActionsGlyph.Lock, CommandQuickActionsAccent.Green, CommandLabelKey.Lock),
        QuickCommand("unlock", "unlock", CommandQuickActionsGlyph.Unlock, CommandQuickActionsAccent.Red, CommandLabelKey.Unlock),
        QuickCommand(
            "climate_on",
            "climate_on",
            CommandQuickActionsGlyph.ClimateOn,
            CommandQuickActionsAccent.Cyan,
            CommandLabelKey.ClimateOn,
        ),
        QuickCommand(
            "climate_off",
            "climate_off",
            CommandQuickActionsGlyph.ClimateOff,
            CommandQuickActionsAccent.Blue,
            CommandLabelKey.ClimateOff,
        ),
        QuickCommand(
            "frunk",
            "actuate_frunk",
            CommandQuickActionsGlyph.Frunk,
            CommandQuickActionsAccent.Purple,
            CommandLabelKey.Frunk,
        ),
        QuickCommand("honk", "honk_horn", CommandQuickActionsGlyph.Horn, CommandQuickActionsAccent.Amber, CommandLabelKey.Horn),
        QuickCommand("flash", "flash_lights", CommandQuickActionsGlyph.Flash, CommandQuickActionsAccent.Yellow, CommandLabelKey.Flash),
        QuickCommand(
            "trunk",
            "actuate_trunk",
            CommandQuickActionsGlyph.Trunk,
            CommandQuickActionsAccent.Indigo,
            CommandLabelKey.Trunk,
        ),
    )

/**
 * The resolved scope of the surface — the native union of what the web component derives from
 * `useVehicles`: the [vehicleId] the command buttons target (web `vehicleId ?? vehicles?.[0]?.id ?? 0`).
 * A [vehicleId] of `0` models the web `id === 0` branch (no vehicle resolved → empty state). Pure data
 * so the projection is unit-tested without a UI host.
 */
data class CommandQuickActionsSnapshot(
    val vehicleId: Long,
) {
    /** True when a vehicle resolved (web `id ? grid : <EmptyState>` gate). */
    val hasVehicle: Boolean get() = vehicleId > 0L
}

/**
 * One render-ready command button — the native counterpart of the web per-command `<Button>` (a leading
 * glyph or in-flight spinner, an accent, a localized label, and a TalkBack name equal to the label, web
 * `aria-label={t(cmd.labelKey, cmd.labelFallback)}`). [isRunning] mirrors `activeCommand === cmd.command`
 * (spinner instead of icon); the owning [CommandQuickActionsDisplay.anyRunning] disables every button
 * while one is in flight (web `disabled={!!activeCommand}`). Pure data — no Compose types.
 */
data class CommandQuickActionsButton(
    val id: String,
    val command: String,
    val glyph: CommandQuickActionsGlyph,
    val accent: CommandQuickActionsAccent,
    val label: String,
    val isRunning: Boolean,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the command grid for one footprint + active-command — the
 * native analogue of everything the web component computes before returning JSX (the `isCompact`/`isWide`
 * flags, the `visibleCommands` slice, the per-button `isRunning`, and the `disabled={!!activeCommand}`
 * gate). Pure data so the projection is unit-tested without a UI host.
 */
data class CommandQuickActionsDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val columns: Int,
    val showLabels: Boolean,
    val anyRunning: Boolean,
    val buttons: List<CommandQuickActionsButton>,
)

/**
 * Localized labels the surface folds into its output. The pure [CommandQuickActionsProjection] reads the
 * eight command labels; the composable chrome additionally reads [title] / [emptyMessage] /
 * [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative]. The composable builds this from
 * `stringResource`; tests pass a deterministic instance. Keeping i18n out of the projection lets the
 * projection stay a pure, locale-stable function.
 */
data class CommandQuickActionsStrings(
    val title: String,
    val emptyMessage: String,
    val lock: String,
    val unlock: String,
    val climateOn: String,
    val climateOff: String,
    val frunk: String,
    val horn: String,
    val flash: String,
    val trunk: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
) {
    /** The localized label for [key] (web `t(cmd.labelKey, cmd.labelFallback)`). */
    fun labelFor(key: CommandLabelKey): String =
        when (key) {
            CommandLabelKey.Lock -> lock
            CommandLabelKey.Unlock -> unlock
            CommandLabelKey.ClimateOn -> climateOn
            CommandLabelKey.ClimateOff -> climateOff
            CommandLabelKey.Frunk -> frunk
            CommandLabelKey.Horn -> horn
            CommandLabelKey.Flash -> flash
            CommandLabelKey.Trunk -> trunk
        }
}

/**
 * Pure projection from a footprint + active-command to the [CommandQuickActionsDisplay] — the native port
 * of the web component's `isCompact`/`isWide` flags, its `visibleCommands` slice, and its per-button
 * `isRunning` / `disabled={!!activeCommand}` derivation. No Compose, no clock; unit-tested end to end.
 */
object CommandQuickActionsProjection {
    /** Columns at the compact 1x1 footprint (web `grid-cols-2`). */
    const val COMPACT_COLUMNS = 2

    /** Columns at the wide (>=3 cols) footprint (web `@xs:grid-cols-4`). */
    const val WIDE_COLUMNS = 4

    /** Columns at the default footprint (web `@xs:grid-cols-3`). */
    const val DEFAULT_COLUMNS = 3

    /** Commands shown at the compact footprint (web `COMMANDS.slice(0, 4)`). */
    const val COMPACT_COMMANDS = 4

    /** Commands shown at the default footprint (web `COMMANDS.slice(0, 6)`). */
    const val DEFAULT_COMMANDS = 6

    /**
     * Project the grid for [size] + the in-flight [activeCommand] using the localized [strings].
     * Reproduces the web `visibleCommands = isCompact ? slice(0,4) : isWide ? all : slice(0,6)` and
     * `disabled={!!activeCommand}`.
     */
    fun project(
        size: CommandQuickActionsSize,
        activeCommand: String?,
        strings: CommandQuickActionsStrings,
    ): CommandQuickActionsDisplay {
        val isCompact = size.isCompact
        val isWide = size.isWide
        val visible =
            when {
                isCompact -> COMMAND_QUICK_ACTIONS.take(COMPACT_COMMANDS)
                isWide -> COMMAND_QUICK_ACTIONS
                else -> COMMAND_QUICK_ACTIONS.take(DEFAULT_COMMANDS)
            }
        val columns =
            when {
                isCompact -> COMPACT_COLUMNS
                isWide -> WIDE_COLUMNS
                else -> DEFAULT_COLUMNS
            }
        val buttons =
            visible.map { cmd ->
                val label = strings.labelFor(cmd.labelKey)
                CommandQuickActionsButton(
                    id = cmd.id,
                    command = cmd.command,
                    glyph = cmd.glyph,
                    accent = cmd.accent,
                    label = label,
                    isRunning = activeCommand == cmd.command,
                    contentDescription = label,
                )
            }
        return CommandQuickActionsDisplay(
            isCompact = isCompact,
            isWide = isWide,
            columns = columns,
            showLabels = !isCompact,
            anyRunning = activeCommand != null,
            buttons = buttons,
        )
    }
}
