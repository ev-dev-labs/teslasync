// The native Jetpack Compose + Material 3 globalShortcuts misc surface — a parity port of
// web/src/lib/globalShortcuts.tsx. The web `GlobalShortcuts(): null` is mounted once from `<Layout>`; it builds
// the catalogue of "global" shortcut definitions and pours them into the shortcut registry via `useShortcut(defs)`
// so the cheatsheet has a single source of truth, then returns null — "Returns nothing visible — its only job is
// to populate the registry."
//
// This port keeps that contract end to end. It is a REGISTRATION PROVIDER, not a visible view: mounted once from
// the host's root composable, it resolves the catalogue's localized prose, registers the resulting
// [ShortcutDefinition]s into the shared [ShortcutRegistry] (P1/S8) for the provider's lifetime, emits the one
// PII-safe `view.opened` diagnostic, and emits NO UI — exactly like the web component. The grouped cheatsheet that
// READS the registry is a SEPARATE surface (KeyboardShortcutsModal); rendering one here would duplicate that
// surface and invent UI the web spec does not have (honesty covenant: no parity shortcuts, no silent drift).
//
// Because the surface has no async data source (its only inputs are the i18n catalog + the static GOTO / command
// tables in [GlobalShortcutsProjection]), there is no loading / error / stale / offline lifecycle to render;
// modelling those would fabricate behaviour the web spec does not have (the same rationale the accepted QuickNav /
// QuickLinksSection ports document). The catalogue is never empty, so registration is guarded by
// [GlobalShortcutsProjection.isEmpty] and is otherwise unconditional.
//
// Lifecycle parity: the web `useShortcut` registers on mount and unregisters the same ids on unmount (its
// `useEffect` cleanup, StrictMode-safe via id dedupe). Here a [DisposableEffect] registers on entering composition
// and unregisters on leaving it; keyed on the resolved [ShortcutDefinition]s' structural value, it re-registers
// only when the catalogue actually changes (e.g. a locale switch re-resolves every description) — never on an
// incidental recomposition.
//
// i18n parity: every group title + description resolves through the generated catalog (P1/S10) at this Compose
// boundary — no English literal lives in native code. The web seed interpolates each goto target's raw English
// `GOTO_SHORTCUTS` label into "Go to {label}"; this port interpolates the SAME destination's localized nav title
// instead (e.g. Vehicles → "Fleet", Battery → "Battery Health"), so the description is fully localized rather than
// a hard-coded English literal — a documented, never-silent refinement (the same mapping the QuickLinks port uses).
// The key-cap tokens (Ctrl / K / `/` / `?` / Esc / g / the goto letters / T / E) are reproduced verbatim: they are
// keyboard key identifiers, not translatable copy, and the web does not translate them either.
//
// Accessibility: the surface emits no interactive elements (it renders nothing), so there is no TalkBack-facing
// node to label — the registered descriptions become accessible only when the separate cheatsheet reader renders
// them. The on-device GlobalShortcutsUiTest asserts the provider introduces no semantics node.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/misc-surfaces/globalShortcuts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.globalshortcuts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The globalShortcuts registration provider — the parity port of the web `GlobalShortcuts(): null`. Resolves the
 * localized shortcut catalogue, registers it into [registry] for the lifetime of the composition, records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11), and emits no UI (web `return null`). Mount once from the
 * host's root composable, mirroring the web component's single mount in `<Layout>`.
 *
 * @param registry the shared shortcut registry the catalogue is registered into; defaults to the app-wide
 *   [GlobalShortcutRegistry] (web module-level store). Tests pass a throwaway instance.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through; defaults to the
 *   app's `LocalDataContainer`.
 */
@Composable
fun GlobalShortcuts(
    registry: ShortcutRegistry = GlobalShortcutRegistry,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val definitions = GlobalShortcutsProjection.build(rememberShortcutStrings())

    LaunchedEffect(Unit) { GlobalShortcutsDiagnostics.recordViewOpened(logger) }

    DisposableEffect(registry, definitions) {
        if (definitions.isNotEmpty()) registry.register(definitions)
        onDispose { registry.unregister(definitions.map { it.id }) }
    }
    // Emits no visible UI — parity with the web component's `return null`; its only job is to populate the registry.
}

/**
 * Resolves every group title + description in the catalogue to a localized string (P1/S10), returning a pure
 * [ShortcutStrings] the projection folds over. All `stringResource` lookups happen here, at the Compose boundary,
 * so [GlobalShortcutsProjection.build] stays framework-free and off-device-testable.
 */
@Composable
private fun rememberShortcutStrings(): ShortcutStrings {
    val groups =
        mapOf(
            ShortcutGroup.Actions to stringResource(R.string.translation_shortcuts_groups_actions),
            ShortcutGroup.Navigation to stringResource(R.string.translation_shortcuts_groups_navigation),
            ShortcutGroup.Commands to stringResource(R.string.translation_shortcuts_groups_commands),
        )
    val texts =
        mapOf(
            ShortcutTextKey.OpenPalette to stringResource(R.string.translation_shortcuts_openPalette),
            ShortcutTextKey.OpenPaletteAlt to stringResource(R.string.translation_shortcuts_openPaletteAlt),
            ShortcutTextKey.OpenShortcuts to stringResource(R.string.translation_shortcuts_openShortcuts),
            ShortcutTextKey.Close to stringResource(R.string.translation_shortcuts_close),
        )
    val gotos =
        mapOf(
            GotoTarget.Dashboard to gotoDescription(GotoTarget.Dashboard),
            GotoTarget.Vehicles to gotoDescription(GotoTarget.Vehicles),
            GotoTarget.Charging to gotoDescription(GotoTarget.Charging),
            GotoTarget.Drives to gotoDescription(GotoTarget.Drives),
            GotoTarget.Trips to gotoDescription(GotoTarget.Trips),
            GotoTarget.Battery to gotoDescription(GotoTarget.Battery),
            GotoTarget.Analytics to gotoDescription(GotoTarget.Analytics),
            GotoTarget.Efficiency to gotoDescription(GotoTarget.Efficiency),
            GotoTarget.Settings to gotoDescription(GotoTarget.Settings),
            GotoTarget.Notifications to gotoDescription(GotoTarget.Notifications),
            GotoTarget.LiveSignals to gotoDescription(GotoTarget.LiveSignals),
            GotoTarget.Automations to gotoDescription(GotoTarget.Automations),
            GotoTarget.Commands to gotoDescription(GotoTarget.Commands),
            GotoTarget.Climate to gotoDescription(GotoTarget.Climate),
        )
    val commands =
        mapOf(
            CommandShortcut.ThemePicker to stringResource(R.string.translation_palette_cmd_themePicker),
            CommandShortcut.Shortcuts to stringResource(R.string.translation_palette_cmd_shortcuts),
            CommandShortcut.DashboardEdit to stringResource(R.string.translation_palette_cmd_dashboardEdit),
        )
    return remember(groups, texts, gotos, commands) { ResolvedShortcutStrings(groups, texts, gotos, commands) }
}

/**
 * The localized "Go to {label}" description for [target] — the web `t('shortcuts.goto', 'Go to {{label}}', { label
 * })`. The interpolated `label` is the target's localized nav title (P1/S10), not a hard-coded English literal.
 */
@Composable
private fun gotoDescription(target: GotoTarget): String =
    stringResource(R.string.translation_shortcuts_goto, stringResource(GOTO_LABEL_RES.getValue(target)))

/**
 * Goto target → localized nav-title resource (P1/S10). Mirrors the web `GOTO_SHORTCUTS` labels via the canonical
 * nav title for the same destination; the two web labels without a `nav.*` key resolve through their own catalog
 * titles (`Live Signals` → the live-signals widget title, `Automations` → the automations page title). A lookup
 * table (rather than a 14-arm `when`) keeps the resolver flat.
 */
private val GOTO_LABEL_RES: Map<GotoTarget, Int> =
    mapOf(
        GotoTarget.Dashboard to R.string.translation_nav_dashboard,
        GotoTarget.Vehicles to R.string.translation_nav_vehicles,
        GotoTarget.Charging to R.string.translation_nav_charging,
        GotoTarget.Drives to R.string.translation_nav_drives,
        GotoTarget.Trips to R.string.translation_nav_trips,
        GotoTarget.Battery to R.string.translation_nav_battery,
        GotoTarget.Analytics to R.string.translation_nav_analytics,
        GotoTarget.Efficiency to R.string.translation_nav_efficiency,
        GotoTarget.Settings to R.string.translation_nav_settings,
        GotoTarget.Notifications to R.string.translation_nav_notifications,
        GotoTarget.LiveSignals to R.string.translation_widget_liveSignals,
        GotoTarget.Automations to R.string.translation_automations_title,
        GotoTarget.Commands to R.string.translation_nav_commands,
        GotoTarget.Climate to R.string.translation_nav_climate,
    )

/**
 * The localized [ShortcutStrings] backed by the pre-resolved maps `rememberShortcutStrings` built. Pure (no
 * Compose), so the projection it feeds stays off-device-testable; `getValue` is total because every group / text /
 * goto / command tag in the catalogue is resolved into the maps above.
 */
private class ResolvedShortcutStrings(
    private val groups: Map<ShortcutGroup, String>,
    private val texts: Map<ShortcutTextKey, String>,
    private val gotos: Map<GotoTarget, String>,
    private val commands: Map<CommandShortcut, String>,
) : ShortcutStrings {
    override fun group(group: ShortcutGroup): String = groups.getValue(group)

    override fun description(description: ShortcutDescription): String =
        when (description) {
            is ShortcutDescription.Text -> texts.getValue(description.key)
            is ShortcutDescription.Goto -> gotos.getValue(description.target)
            is ShortcutDescription.Command -> commands.getValue(description.command)
        }
}
