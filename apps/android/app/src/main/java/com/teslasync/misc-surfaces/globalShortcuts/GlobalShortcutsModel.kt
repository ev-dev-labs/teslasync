// Pure, framework-free model + projection + registry + diagnostics for the globalShortcuts misc surface — the
// native analogue of the data + composition the web module owns (web/src/lib/globalShortcuts.tsx). No Compose, no
// Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin resolve-and-register layer.
//
// globalShortcuts is a REGISTRATION PROVIDER, not a visible view. The web `GlobalShortcuts(): null` is mounted once
// from `<Layout>`; its only job is to pour every "global" shortcut into the shortcut registry so the cheatsheet has
// a single source of truth, then it returns null ("Returns nothing visible — its only job is to populate the
// registry"). The grouped cheatsheet that READS the registry is a SEPARATE surface (KeyboardShortcutsModal); giving
// this surface a visible cheatsheet would duplicate that surface and invent UI the web spec does not have (honesty
// covenant: no parity shortcuts, no silent drift). So the faithful native port reproduces the DATA (the 21 grouped
// definitions) + the registration behaviour, and renders nothing — exactly like the web component.
//
// Because the surface has no async data source (its only inputs are the i18n catalog + the static GOTO / command
// tables), there is no loading / error / stale / offline lifecycle to model; inventing those would fabricate
// behaviour the web spec does not have (the same rationale the accepted QuickNav / QuickLinksSection ports document).
// What the surface genuinely owns is its catalogue: the 21 shortcut definitions, in the exact web order
// (universals → navigation → commands), each carrying the web id, the key-cap tokens, the group, and the scope.
//
// This pure file owns the parts the web `useMemo` derives before `useShortcut(defs)`:
//   • the four universal app keys (web `universals`) — Ctrl+K / `/` / `?` / Esc;
//   • the `g + letter` navigation table (web `Object.entries(GOTO_SHORTCUTS).map(...)`) — 14 informational entries;
//   • every command-palette entry that declares a `shortcut` hint (web `commandRegistry.filter(c => c.shortcut)`);
//   • the registry the definitions are registered into (web `useShortcutRegistry`'s external store), as a
//     StateFlow-backed P1/S8 state holder so the reader surface folds onto one source of truth;
//   • the pure projection [GlobalShortcutsProjection.build] that resolves the catalogue into [ShortcutDefinition]s
//     given a [ShortcutStrings] resolver — the composable supplies the i18n-backed resolver, tests supply a fake.
//
// i18n parity: the user-facing prose (group titles + descriptions) resolves through the generated catalog (P1/S10)
// at the Compose boundary — no English literal lives in native code. The key-cap tokens (`Ctrl`, `K`, `/`, `?`,
// `Esc`, `g`, the goto letters, `T`/`E`) are reproduced verbatim from the web source: they are keyboard key
// identifiers, not translatable copy, and the web does not translate them either.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/misc-surfaces/globalShortcuts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (hyphen + lower-case segments are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.globalshortcuts

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Visibility scope of a registered shortcut — the native analogue of the web `ShortcutScope`
 * (`'global' | 'route' | 'page'`). Every entry this surface seeds is [Global] (the web `scope: 'global'`); the
 * other arms exist so the reader surface can describe route/page-scoped entries other surfaces register later.
 */
enum class ShortcutScope {
    /** Always visible — the web `'global'`. Every globalShortcuts seed entry is global. */
    Global,

    /** Visible only on a matching route — the web `'route'`. */
    Route,

    /** Visible only on the single owning page — the web `'page'`. */
    Page,
}

/**
 * One registered shortcut as the registry stores it — the display-relevant projection of the web
 * `ShortcutDefinition` (web/src/hooks/useShortcutRegistry.ts). The seed entries are informational (no handler),
 * so only the cheatsheet-facing fields are modelled.
 *
 * @property id stable id, also the registry dedupe key + the reader's list key (web `id`).
 * @property keys key-cap tokens, each rendered as its own chip (web `keys`), e.g. `["Ctrl", "K"]` or `["g", "d"]`.
 * @property description already-resolved, localized description shown in the cheatsheet (web `description`).
 * @property group already-resolved, localized group the entry renders under (web `group`).
 * @property scope visibility scope (web `scope`); always [ShortcutScope.Global] for this surface.
 */
data class ShortcutDefinition(
    val id: String,
    val keys: List<String>,
    val description: String,
    val group: String,
    val scope: ShortcutScope,
)

/**
 * The shortcut registry — the native analogue of the web `useShortcutRegistry` external store
 * (web/src/hooks/useShortcutRegistry.ts). A tiny observable holder of [ShortcutDefinition]s so the seed
 * (globalShortcuts) declares every global hotkey and the cheatsheet reader folds onto a single source of truth.
 *
 * Reads are exposed as a hot [StateFlow] of the current entries in registration order; writes are id-keyed and
 * last-writer-wins (web `entries.set(def.id, def)`), so the React-StrictMode-safe mount → cleanup → mount sequence
 * ends with the same final state as a single mount. [MutableStateFlow.update] makes register/unregister atomic.
 *
 * The default app-wide instance is [GlobalShortcutRegistry]; tests construct throwaway instances so the singleton
 * is never polluted across cases.
 */
class ShortcutRegistry {
    private val entries = MutableStateFlow<List<ShortcutDefinition>>(emptyList())

    /** The current registered definitions, in registration order — the reader surface's single source of truth. */
    val shortcuts: StateFlow<List<ShortcutDefinition>> = entries.asStateFlow()

    /**
     * Registers [defs], replacing any existing entries with the same [ShortcutDefinition.id] (last-writer-wins,
     * web `registerShortcut`). Insertion order is preserved; re-registering the same ids is idempotent.
     */
    fun register(defs: List<ShortcutDefinition>) {
        if (defs.isEmpty()) return
        entries.update { current ->
            val byId = LinkedHashMap<String, ShortcutDefinition>(current.size + defs.size)
            current.forEach { byId[it.id] = it }
            defs.forEach { byId[it.id] = it }
            byId.values.toList()
        }
    }

    /** Removes the entries with the given [ids] — the web `unregisterShortcut` cleanup the seed runs on unmount. */
    fun unregister(ids: List<String>) {
        if (ids.isEmpty()) return
        val removed = ids.toHashSet()
        entries.update { current -> current.filterNot { it.id in removed } }
    }

    /** Clears every entry — the holder analogue of the web `_resetShortcutRegistry` test helper. */
    fun reset() {
        entries.value = emptyList()
    }
}

/** The app-wide registry singleton — the native analogue of the web module-level `store` the seed populates. */
val GlobalShortcutRegistry = ShortcutRegistry()

/**
 * The group a seed entry renders under in the cheatsheet — the native analogue of the web `groupActions` /
 * `groupNavigation` / `groupCommands` labels. The enum is the framework-free tag; the composable resolves each to
 * its localized group title (P1/S10) via [ShortcutStrings.group].
 */
enum class ShortcutGroup {
    /** Web `t('shortcuts.groups.actions', 'Actions')` — the four universal app keys. */
    Actions,

    /** Web `t('shortcuts.groups.navigation', 'Navigation (press g then…)')` — the `g + letter` table. */
    Navigation,

    /** Web `t('shortcuts.groups.commands', 'Commands')` — the command-palette shortcut hints. */
    Commands,
}

/**
 * A universal app-key description — the four fixed `t('shortcuts.*')` strings the web `universals` block uses.
 * The enum is the framework-free tag; the composable resolves each to its catalog string via [ShortcutStrings].
 */
enum class ShortcutTextKey {
    /** Web `t('shortcuts.openPalette', 'Open command palette')` — Ctrl+K. */
    OpenPalette,

    /** Web `t('shortcuts.openPaletteAlt', 'Open command palette')` — `/`. */
    OpenPaletteAlt,

    /** Web `t('shortcuts.openShortcuts', 'Show keyboard shortcuts')` — `?`. */
    OpenShortcuts,

    /** Web `t('shortcuts.close', 'Close modal / cancel')` — Esc. */
    Close,
}

/**
 * One `g + letter` navigation target — the native analogue of a web `GOTO_SHORTCUTS` entry
 * (web/src/hooks/useKeyboardShortcuts.ts). The table is mirrored faithfully, in the exact web insertion order, so
 * the ids (`global.goto.{key}`) and the key-cap tokens (`["g", key]`) match the web one-for-one.
 *
 * The web seed uses only [key] (for the id + key tokens) and the target's label (for the "Go to {label}"
 * description, resolved at the Compose boundary to the destination's localized nav title). [path] is the upstream
 * web URL the table carries; this surface does not navigate (its seed entries are informational, with no handler),
 * so [path] is mirrored for fidelity to the source table rather than consumed here.
 *
 * @property key the single trigger letter pressed after `g` (web `GOTO_SHORTCUTS` map key).
 * @property path the web URL the target navigates to (web `target.path`) — informational here.
 */
enum class GotoTarget(
    val key: String,
    val path: String,
) {
    /** Web `'d': { path: '/', label: 'Dashboard' }`. */
    Dashboard("d", "/"),

    /** Web `'v': { path: '/vehicles', label: 'Vehicles' }`. */
    Vehicles("v", "/vehicles"),

    /** Web `'c': { path: '/charging', label: 'Charging' }`. */
    Charging("c", "/charging"),

    /** Web `'r': { path: '/drives', label: 'Drives' }`. */
    Drives("r", "/drives"),

    /** Web `'t': { path: '/trips', label: 'Trips' }`. */
    Trips("t", "/trips"),

    /** Web `'b': { path: '/battery', label: 'Battery & Energy' }`. */
    Battery("b", "/battery"),

    /** Web `'a': { path: '/analytics', label: 'Analytics' }`. */
    Analytics("a", "/analytics"),

    /** Web `'e': { path: '/efficiency', label: 'Efficiency' }`. */
    Efficiency("e", "/efficiency"),

    /** Web `'s': { path: '/settings', label: 'Settings' }`. */
    Settings("s", "/settings"),

    /** Web `'n': { path: '/notifications/inbox', label: 'Notifications' }`. */
    Notifications("n", "/notifications/inbox"),

    /** Web `'l': { path: '/live-signals', label: 'Live Signals' }`. */
    LiveSignals("l", "/live-signals"),

    /** Web `'o': { path: '/automations', label: 'Automations' }`. */
    Automations("o", "/automations"),

    /** Web `'x': { path: '/commands', label: 'Commands' }`. */
    Commands("x", "/commands"),

    /** Web `'i': { path: '/climate', label: 'Climate' }`. */
    Climate("i", "/climate"),
}

/**
 * One command-palette entry that declares a `shortcut` hint — the native analogue of a web `commandRegistry` entry
 * surviving `filter(c => c.shortcut)` (web/src/lib/commandRegistry.ts). Mirrored in the exact web registry order.
 *
 * @property commandId the web command id (web `c.id`); the seed builds the def id as `global.palette.cmd.{commandId}`.
 * @property shortcut the display-only key-cap hint (web `c.shortcut`), the single chip the entry renders.
 */
enum class CommandShortcut(
    val commandId: String,
    val shortcut: String,
) {
    /** Web `{ id: 'pref.themePicker', shortcut: 'T', labelKey: 'palette.cmd.themePicker' }`. */
    ThemePicker("pref.themePicker", "T"),

    /** Web `{ id: 'action.shortcuts', shortcut: '?', labelKey: 'palette.cmd.shortcuts' }`. */
    Shortcuts("action.shortcuts", "?"),

    /** Web `{ id: 'action.dashboard.edit', shortcut: 'E', labelKey: 'palette.cmd.dashboardEdit' }`. */
    DashboardEdit("action.dashboard.edit", "E"),
}

/**
 * The description source for a seed entry — resolved to a localized string at the Compose boundary by
 * [ShortcutStrings.description]. Keeping the source framework-free (an enum/target tag rather than a resolved
 * string) lets the whole catalogue be unit-tested off-device while the composable owns the i18n lookup.
 */
sealed interface ShortcutDescription {
    /** A fixed universal-key description (web `t('shortcuts.*')`). */
    data class Text(
        val key: ShortcutTextKey,
    ) : ShortcutDescription

    /** A `g + letter` navigation description (web `t('shortcuts.goto', 'Go to {{label}}', { label })`). */
    data class Goto(
        val target: GotoTarget,
    ) : ShortcutDescription

    /** A command-palette description (web `t(c.labelKey, c.labelFallback)`). */
    data class Command(
        val command: CommandShortcut,
    ) : ShortcutDescription
}

/**
 * One framework-free shortcut blueprint — everything about a seed entry that does NOT depend on resources: the web
 * id, the key-cap tokens, the group tag, the scope, and the description source. The composable resolves the group +
 * description to localized strings and folds each blueprint into a [ShortcutDefinition] for the registry.
 *
 * @property id the web definition id (the registry dedupe key).
 * @property keys the key-cap tokens (web `keys`).
 * @property group the group tag (resolved to a localized title by [ShortcutStrings.group]).
 * @property scope the visibility scope (web `scope`); always [ShortcutScope.Global] here.
 * @property description the description source (resolved to a localized string by [ShortcutStrings.description]).
 */
data class GlobalShortcutBlueprint(
    val id: String,
    val keys: List<String>,
    val group: ShortcutGroup,
    val scope: ShortcutScope,
    val description: ShortcutDescription,
)

/**
 * Resolves the framework-free description/group tags to localized strings (P1/S10). The composable implements this
 * with `stringResource`; unit tests implement it with a deterministic fake so the pure projection
 * [GlobalShortcutsProjection.build] is verified end to end off-device.
 */
interface ShortcutStrings {
    /** The localized group title for [group] (web `t('shortcuts.groups.*')`). */
    fun group(group: ShortcutGroup): String

    /** The localized description for [description] (web `t('shortcuts.*')` / `t('shortcuts.goto', …)` / `t(labelKey)`). */
    fun description(description: ShortcutDescription): String
}

/**
 * The static shortcut catalogue + its projection — the native analogue of the web `defs` the `useMemo` builds
 * before `useShortcut(defs)`. globalShortcuts has no data source, so the "projection" is a fixed catalogue rather
 * than a transform of fetched data; it is exposed (and unit-tested) here so the composable never hard-codes the
 * list inline and the ids / key tokens / groups / scope / order are verified off-device.
 */
object GlobalShortcutsProjection {
    /** Web id prefix for every goto entry (`global.goto.{key}`). */
    private const val GOTO_ID_PREFIX = "global.goto."

    /** Web id prefix for every command entry (`global.palette.cmd.{commandId}`). */
    private const val COMMAND_ID_PREFIX = "global.palette.cmd."

    /** The `g` lead key every navigation chord starts with (web `keys: ['g', key]`). */
    private const val GOTO_LEAD_KEY = "g"

    /**
     * The four universal app keys — the web `universals` block, in order: Ctrl+K, `/`, `?`, Esc. All in the
     * [ShortcutGroup.Actions] group with [ShortcutScope.Global] scope.
     */
    val universals: List<GlobalShortcutBlueprint> =
        listOf(
            GlobalShortcutBlueprint(
                id = "global.palette.ctrlk",
                keys = listOf("Ctrl", "K"),
                group = ShortcutGroup.Actions,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Text(ShortcutTextKey.OpenPalette),
            ),
            GlobalShortcutBlueprint(
                id = "global.palette.slash",
                keys = listOf("/"),
                group = ShortcutGroup.Actions,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Text(ShortcutTextKey.OpenPaletteAlt),
            ),
            GlobalShortcutBlueprint(
                id = "global.shortcuts.help",
                keys = listOf("?"),
                group = ShortcutGroup.Actions,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Text(ShortcutTextKey.OpenShortcuts),
            ),
            GlobalShortcutBlueprint(
                id = "global.shortcuts.escape",
                keys = listOf("Esc"),
                group = ShortcutGroup.Actions,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Text(ShortcutTextKey.Close),
            ),
        )

    /**
     * The `g + letter` navigation table — the web `Object.entries(GOTO_SHORTCUTS).map(...)`, in the exact web
     * order. Each entry id is `global.goto.{key}`, its tokens are `["g", key]`, and it is an informational
     * [ShortcutGroup.Navigation] / [ShortcutScope.Global] entry.
     */
    val navigation: List<GlobalShortcutBlueprint> =
        GotoTarget.entries.map { target ->
            GlobalShortcutBlueprint(
                id = GOTO_ID_PREFIX + target.key,
                keys = listOf(GOTO_LEAD_KEY, target.key),
                group = ShortcutGroup.Navigation,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Goto(target),
            )
        }

    /**
     * The command-palette shortcut hints — the web `commandRegistry.filter(c => c.shortcut).map(...)`, in registry
     * order. Each entry id is `global.palette.cmd.{commandId}`, its single token is the command's `shortcut`, and
     * it is an informational [ShortcutGroup.Commands] / [ShortcutScope.Global] entry.
     */
    val commands: List<GlobalShortcutBlueprint> =
        CommandShortcut.entries.map { command ->
            GlobalShortcutBlueprint(
                id = COMMAND_ID_PREFIX + command.commandId,
                keys = listOf(command.shortcut),
                group = ShortcutGroup.Commands,
                scope = ShortcutScope.Global,
                description = ShortcutDescription.Command(command),
            )
        }

    /**
     * THE catalogue the seed registers — the web `[...universals, ...navigation, ...palette]`, 21 entries in that
     * exact order. This is the single ordered list the composable resolves and registers.
     */
    val blueprints: List<GlobalShortcutBlueprint> = universals + navigation + commands

    /**
     * True when there is nothing to register — the defensive guard for the registration effect. Always `false` for
     * the static catalogue; exposed for the guard + its test so an empty catalogue is a no-op rather than a crash.
     */
    val isEmpty: Boolean get() = blueprints.isEmpty()

    /**
     * Resolves the catalogue into registry-ready [ShortcutDefinition]s using [strings] — the native analogue of the
     * web `useMemo` body that bakes each `t(...)` call into the `description` / `group` before `useShortcut(defs)`.
     * Pure (no Compose, no Android): the composable passes a `stringResource`-backed [strings]; tests pass a fake.
     */
    fun build(strings: ShortcutStrings): List<ShortcutDefinition> =
        blueprints.map { blueprint ->
            ShortcutDefinition(
                id = blueprint.id,
                keys = blueprint.keys,
                description = strings.description(blueprint.description),
                group = strings.group(blueprint.group),
                scope = blueprint.scope,
            )
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any user data
 * (globalShortcuts has none) — so a diagnostics line can never leak anything about the user.
 */
object GlobalShortcutsDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "global-shortcuts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "globalShortcuts"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
