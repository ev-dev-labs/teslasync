package io.teslasync.android.miscsurfaces.globalshortcuts

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the globalShortcuts surface's pure logic — the native analogue of the catalogue +
 * `useMemo` the web module owns (web/src/lib/globalShortcuts.tsx): the 21-entry shortcut catalogue in the exact web
 * order (universals → navigation → commands), every web id + key-cap token + group + scope, the mirrored
 * `GOTO_SHORTCUTS` table, the pure [GlobalShortcutsProjection.build] projection, the [ShortcutRegistry] register /
 * unregister / dedupe contract (web `useShortcutRegistry`), and the PII-safe `view.opened` diagnostic. Runs in the
 * offline `:android:testReleaseUnitTest` gate; the Compose registration + accessibility are covered on-device by
 * GlobalShortcutsUiTest.
 */
class GlobalShortcutsProjectionTest {
    // ── Catalogue: size + order (web `[...universals, ...navigation, ...palette]`) ───────────────────

    @Test
    fun catalogueHasTwentyOneEntriesInWebOrder() {
        val blueprints = GlobalShortcutsProjection.blueprints

        assertEquals(21, blueprints.size)
        assertEquals(4, GlobalShortcutsProjection.universals.size)
        assertEquals(14, GlobalShortcutsProjection.navigation.size)
        assertEquals(3, GlobalShortcutsProjection.commands.size)
        // Universals first, then navigation, then commands — the exact web spread order.
        assertEquals(
            GlobalShortcutsProjection.universals +
                GlobalShortcutsProjection.navigation +
                GlobalShortcutsProjection.commands,
            blueprints,
        )
    }

    @Test
    fun everyEntryIsGlobalScoped() {
        // The web seed sets `scope: 'global'` on every definition.
        assertTrue(GlobalShortcutsProjection.blueprints.all { it.scope == ShortcutScope.Global })
    }

    @Test
    fun everyIdIsUniqueSoTheRegistryNeverCollides() {
        val ids = GlobalShortcutsProjection.blueprints.map { it.id }
        assertEquals("ids must be unique (registry dedupe key)", ids.size, ids.toSet().size)
    }

    @Test
    fun catalogueIsNeverEmpty() {
        assertFalse(GlobalShortcutsProjection.isEmpty)
        assertTrue(GlobalShortcutsProjection.blueprints.isNotEmpty())
    }

    // ── Universals: ids + key-cap tokens + group (web `universals`) ──────────────────────────────────

    @Test
    fun universalsCarryTheWebIdsKeysAndGroup() {
        val byId = GlobalShortcutsProjection.universals.associateBy { it.id }

        assertEquals(listOf("Ctrl", "K"), byId.getValue("global.palette.ctrlk").keys)
        assertEquals(listOf("/"), byId.getValue("global.palette.slash").keys)
        assertEquals(listOf("?"), byId.getValue("global.shortcuts.help").keys)
        assertEquals(listOf("Esc"), byId.getValue("global.shortcuts.escape").keys)

        assertTrue(GlobalShortcutsProjection.universals.all { it.group == ShortcutGroup.Actions })
        assertEquals(
            listOf(
                ShortcutDescription.Text(ShortcutTextKey.OpenPalette),
                ShortcutDescription.Text(ShortcutTextKey.OpenPaletteAlt),
                ShortcutDescription.Text(ShortcutTextKey.OpenShortcuts),
                ShortcutDescription.Text(ShortcutTextKey.Close),
            ),
            GlobalShortcutsProjection.universals.map { it.description },
        )
    }

    // ── Navigation: the `g + letter` table mirrors GOTO_SHORTCUTS exactly ────────────────────────────

    @Test
    fun gotoTableMirrorsTheWebGotoShortcutsKeysAndPathsInOrder() {
        val expected =
            listOf(
                "d" to "/",
                "v" to "/vehicles",
                "c" to "/charging",
                "r" to "/drives",
                "t" to "/trips",
                "b" to "/battery",
                "a" to "/analytics",
                "e" to "/efficiency",
                "s" to "/settings",
                "n" to "/notifications/inbox",
                "l" to "/live-signals",
                "o" to "/automations",
                "x" to "/commands",
                "i" to "/climate",
            )

        assertEquals(expected, GotoTarget.entries.map { it.key to it.path })
    }

    @Test
    fun navigationEntriesCarryGlobalGotoIdsAndGThenLetterTokens() {
        GlobalShortcutsProjection.navigation.forEachIndexed { index, blueprint ->
            val target = GotoTarget.entries[index]
            assertEquals("global.goto.${target.key}", blueprint.id)
            assertEquals(listOf("g", target.key), blueprint.keys)
            assertEquals(ShortcutGroup.Navigation, blueprint.group)
            assertEquals(ShortcutDescription.Goto(target), blueprint.description)
        }
    }

    @Test
    fun navigationKeysAreSingleLowercaseLetters() {
        GotoTarget.entries.forEach { target ->
            assertEquals("goto key must be one char", 1, target.key.length)
            assertEquals("goto key must be lower-case", target.key.lowercase(), target.key)
        }
    }

    // ── Commands: the palette `shortcut` hints mirror commandRegistry.filter(c => c.shortcut) ─────────

    @Test
    fun commandEntriesCarryTheWebIdsKeysAndGroup() {
        val expected =
            listOf(
                Triple("global.palette.cmd.pref.themePicker", listOf("T"), CommandShortcut.ThemePicker),
                Triple("global.palette.cmd.action.shortcuts", listOf("?"), CommandShortcut.Shortcuts),
                Triple("global.palette.cmd.action.dashboard.edit", listOf("E"), CommandShortcut.DashboardEdit),
            )

        assertEquals(
            expected,
            GlobalShortcutsProjection.commands.map { Triple(it.id, it.keys, (it.description as ShortcutDescription.Command).command) },
        )
        assertTrue(GlobalShortcutsProjection.commands.all { it.group == ShortcutGroup.Commands })
    }

    // ── Pure projection: build() bakes the resolver's strings into ShortcutDefinitions ───────────────

    @Test
    fun buildResolvesEveryBlueprintPreservingIdKeysScopeAndOrder() {
        val defs = GlobalShortcutsProjection.build(FakeShortcutStrings)

        assertEquals(GlobalShortcutsProjection.blueprints.size, defs.size)
        defs.forEachIndexed { index, def ->
            val blueprint = GlobalShortcutsProjection.blueprints[index]
            assertEquals(blueprint.id, def.id)
            assertEquals(blueprint.keys, def.keys)
            assertEquals(blueprint.scope, def.scope)
            assertEquals(FakeShortcutStrings.group(blueprint.group), def.group)
            assertEquals(FakeShortcutStrings.description(blueprint.description), def.description)
        }
    }

    @Test
    fun buildProducesTheExpectedFirstAndLastDefinitions() {
        val defs = GlobalShortcutsProjection.build(FakeShortcutStrings)

        assertEquals(
            ShortcutDefinition(
                id = "global.palette.ctrlk",
                keys = listOf("Ctrl", "K"),
                description = "text:OpenPalette",
                group = "group:Actions",
                scope = ShortcutScope.Global,
            ),
            defs.first(),
        )
        assertEquals(
            ShortcutDefinition(
                id = "global.palette.cmd.action.dashboard.edit",
                keys = listOf("E"),
                description = "cmd:DashboardEdit",
                group = "group:Commands",
                scope = ShortcutScope.Global,
            ),
            defs.last(),
        )
    }

    // ── Registry: register / unregister / dedupe / reset (web useShortcutRegistry) ────────────────────

    @Test
    fun registryStartsEmpty() {
        assertEquals(emptyList<ShortcutDefinition>(), ShortcutRegistry().shortcuts.value)
    }

    @Test
    fun registerSeedsTheCatalogueInOrder() {
        val registry = ShortcutRegistry()
        val defs = GlobalShortcutsProjection.build(FakeShortcutStrings)

        registry.register(defs)

        assertEquals(defs, registry.shortcuts.value)
    }

    @Test
    fun registerIsLastWriterWinsByIdAndPreservesInsertionOrder() {
        val registry = ShortcutRegistry()
        val first = def("a", "one")
        val second = def("b", "two")
        registry.register(listOf(first, second))

        // Re-registering id "a" replaces the entry in place (web `entries.set(def.id, def)`), order unchanged.
        registry.register(listOf(def("a", "one-prime")))

        assertEquals(listOf(def("a", "one-prime"), second), registry.shortcuts.value)
    }

    @Test
    fun unregisterRemovesOnlyTheGivenIdsAndIsTheCleanupForReRegistration() {
        val registry = ShortcutRegistry()
        val defs = GlobalShortcutsProjection.build(FakeShortcutStrings)
        registry.register(defs)

        registry.unregister(defs.map { it.id })

        assertEquals(emptyList<ShortcutDefinition>(), registry.shortcuts.value)
    }

    @Test
    fun unregisterLeavesUnrelatedEntriesIntact() {
        val registry = ShortcutRegistry()
        registry.register(listOf(def("a", "one"), def("b", "two"), def("c", "three")))

        registry.unregister(listOf("b"))

        assertEquals(listOf(def("a", "one"), def("c", "three")), registry.shortcuts.value)
    }

    @Test
    fun emptyRegisterAndUnregisterAreNoOps() {
        val registry = ShortcutRegistry()
        registry.register(listOf(def("a", "one")))

        registry.register(emptyList())
        registry.unregister(emptyList())

        assertEquals(listOf(def("a", "one")), registry.shortcuts.value)
    }

    @Test
    fun resetClearsEveryEntry() {
        val registry = ShortcutRegistry()
        registry.register(GlobalShortcutsProjection.build(FakeShortcutStrings))

        registry.reset()

        assertTrue(registry.shortcuts.value.isEmpty())
    }

    // ── Diagnostics: PII-safe view.opened with the prompt-mandated slug ───────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        GlobalShortcutsDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "globalShortcuts"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("globalShortcuts", GlobalShortcutsDiagnostics.SLUG)
        assertEquals("global-shortcuts", GlobalShortcutsDiagnostics.ID)
    }

    private fun def(
        id: String,
        description: String,
    ): ShortcutDefinition =
        ShortcutDefinition(
            id = id,
            keys = listOf("g", id),
            description = description,
            group = "group:Navigation",
            scope = ShortcutScope.Global,
        )

    /** Deterministic resolver so the pure [GlobalShortcutsProjection.build] is verified without a Compose host. */
    private object FakeShortcutStrings : ShortcutStrings {
        override fun group(group: ShortcutGroup): String = "group:${group.name}"

        override fun description(description: ShortcutDescription): String =
            when (description) {
                is ShortcutDescription.Text -> "text:${description.key.name}"
                is ShortcutDescription.Goto -> "goto:${description.target.name}"
                is ShortcutDescription.Command -> "cmd:${description.command.name}"
            }
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
