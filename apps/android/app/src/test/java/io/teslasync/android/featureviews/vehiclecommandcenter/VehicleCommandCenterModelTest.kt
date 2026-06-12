package io.teslasync.android.featureviews.vehiclecommandcenter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleCommandCenter's pure logic — the native mirror of every derivation
 * the web orchestrator performs (web/src/features/system/components/VehicleCommandCenter.tsx + its imported
 * commands.ts): the catalogue invariants, the latest-status map + `cmdStatus` + `timeAgo`, the search
 * filter, the category grouping, the favourites subset/seed/toggle + persistence, the dialog routing, the
 * toggle on/off read, and the asleep/battery header derivations. This is the surface's adapter unit test;
 * it runs in the :android:testReleaseUnitTest gate.
 */
class VehicleCommandCenterModelTest {
    private val catalog = DEFAULT_COMMAND_CATALOG

    private fun command(id: String): CommandCenterCommand = catalog.first { it.id == id }

    private fun logEntry(
        command: String,
        status: String,
        createdAt: String = "2026-06-12T12:00:00Z",
    ): CommandLogEntry =
        CommandLogEntry(
            id = 1L,
            vehicleId = 1L,
            command = command,
            params = "",
            status = status,
            error = "",
            createdAt = createdAt,
        )

    // ── Catalogue invariants (web `commands.ts`) ──────────────────────────────────────────────────────

    @Test
    fun catalogueHasEverySixtySevenEntry() {
        assertEquals(67, catalog.size)
    }

    @Test
    fun catalogueIdsAreUnique() {
        assertEquals(catalog.size, catalog.map { it.id }.toSet().size)
    }

    @Test
    fun everyCategoryIsRepresented() {
        val categories = catalog.map { it.category }.toSet()
        assertEquals(CommandCenterCategory.entries.toSet(), categories)
    }

    @Test
    fun categoryOrderListsAllFourteenCategoriesInWebOrder() {
        assertEquals(14, CATEGORY_ORDER.size)
        assertEquals(CommandCenterCategory.Security, CATEGORY_ORDER.first())
        assertEquals(CommandCenterCategory.Media, CATEGORY_ORDER.last())
    }

    @Test
    fun defaultFavouritesMatchTheWebSeed() {
        val expected = listOf("wake_up", "lock", "sentry", "climate", "frunk_open", "honk_horn")
        assertEquals(expected, VehicleCommandCenterProjection.defaultFavorites(catalog))
    }

    @Test
    fun everyToggleHasAnOffTwinAndCategory() {
        val toggles = catalog.filter { it.type == CommandType.Toggle }
        assertTrue(toggles.isNotEmpty())
        toggles.forEach { assertNotNull("toggle ${it.id} needs an off twin", it.commandOff) }
    }

    @Test
    fun eraseUserDataCarriesItsTypedConfirmation() {
        val erase = command("erase_user_data")
        assertTrue(erase.dangerous)
        assertEquals("ERASE", erase.confirm?.confirmInput)
    }

    // ── i18n facade (web `t(key, default)`) ───────────────────────────────────────────────────────────

    @Test
    fun foldCatalogKeyMatchesTheGeneratorNaming() {
        assertEquals("translation_commands_search_noResults", foldCatalogKey("commands.search.noResults"))
        assertEquals("translation_commands_cat_climateProtect", foldCatalogKey("commands.cat.climateProtect"))
    }

    @Test
    fun resolveOptionalPrefersACatalogHitOverTheFallback() {
        val lookup: (String) -> String? = { name -> if (name == "present") "Localized" else null }
        assertEquals("Localized", resolveOptional(lookup, "present", "Fallback"))
        assertEquals("Fallback", resolveOptional(lookup, "absent", "Fallback"))
    }

    @Test
    fun commandLabelFallsBackToTheWebDefaultWhenAbsent() {
        val empty: (String) -> String? = { null }
        assertEquals("Wake Up", commandLabel(command("wake_up"), empty))
        assertEquals("Wake vehicle", commandSublabel(command("wake_up"), empty))
    }

    @Test
    fun commandSublabelIsNullWhenTheCommandHasNone() {
        val empty: (String) -> String? = { null }
        assertNull(commandSublabel(command("lock"), empty))
    }

    @Test
    fun categoryLabelFallsBackToTheWebDefault() {
        val empty: (String) -> String? = { null }
        assertEquals("Security & Access", categoryLabel(CommandCenterCategory.Security, empty))
    }

    // ── Header derivations (web `isAsleep`, battery colour) ─────────────────────────────────────────────

    @Test
    fun isAsleepMatchesTheWebStates() {
        assertTrue(VehicleCommandCenterProjection.isAsleep("asleep"))
        assertTrue(VehicleCommandCenterProjection.isAsleep("offline"))
        assertFalse(VehicleCommandCenterProjection.isAsleep("online"))
    }

    @Test
    fun batteryAboveHalfMatchesTheWebThreshold() {
        assertTrue(VehicleCommandCenterProjection.batteryAboveHalf(51))
        assertFalse(VehicleCommandCenterProjection.batteryAboveHalf(50))
        assertFalse(VehicleCommandCenterProjection.batteryAboveHalf(null))
    }

    // ── Latest-status map + age + status (web `cmdMap` / `cmdStatus` / `timeAgo`) ────────────────────────

    @Test
    fun latestByCommandKeepsTheLastEntryPerCommand() {
        val map =
            VehicleCommandCenterProjection.latestByCommand(
                listOf(logEntry("lock", "error"), logEntry("lock", "success")),
            )
        assertEquals("success", map["lock"]?.status)
    }

    @Test
    fun commandAgeBucketsLikeTheWebTimeAgo() {
        assertEquals(CommandAge.JustNow, VehicleCommandCenterProjection.commandAge(30_000L))
        assertEquals(CommandAge.Minutes(5), VehicleCommandCenterProjection.commandAge(5 * 60_000L))
        assertEquals(CommandAge.Hours(2), VehicleCommandCenterProjection.commandAge(2 * 3_600_000L))
        assertEquals(CommandAge.Days(3), VehicleCommandCenterProjection.commandAge(3 * 86_400_000L))
    }

    @Test
    fun statusEntryFallsBackToTheToggleOffTwin() {
        val map = VehicleCommandCenterProjection.latestByCommand(listOf(logEntry("unlock", "success")))
        // lock's own command has no entry, so it falls back to its off twin (unlock).
        assertEquals("unlock", VehicleCommandCenterProjection.statusEntryFor(command("lock"), map)?.command)
    }

    @Test
    fun statusToneClassifiesTheBackendStatus() {
        assertEquals(CommandStatusTone.Success, CommandStatusTone.fromStatus("success"))
        assertEquals(CommandStatusTone.Error, CommandStatusTone.fromStatus("failed"))
        assertEquals(CommandStatusTone.None, CommandStatusTone.fromStatus(null))
    }

    // ── Dialog routing (web `requestDialog`) ────────────────────────────────────────────────────────────

    @Test
    fun dialogRoutingPrefersSelectThenInputThenConfirm() {
        assertEquals(DialogKind.Select, VehicleCommandCenterProjection.dialogKindFor(command("set_cop_temp")))
        assertEquals(DialogKind.Input, VehicleCommandCenterProjection.dialogKindFor(command("speed_limit_set")))
        assertEquals(DialogKind.Confirm, VehicleCommandCenterProjection.dialogKindFor(command("erase_user_data")))
        assertNull(VehicleCommandCenterProjection.dialogKindFor(command("wake_up")))
    }

    @Test
    fun tileTapRequestsADialogOnlyWhenOneIsRouted() {
        assertEquals(TileTap.RequestDialog, VehicleCommandCenterProjection.tileTap(command("erase_user_data")))
        assertEquals(TileTap.Execute, VehicleCommandCenterProjection.tileTap(command("wake_up")))
    }

    // ── Toggle read (web ToggleCommandTile `state[def.stateField]`) ─────────────────────────────────────

    @Test
    fun toggleIsOnReadsTheMappedStateField() {
        val state = vehicleState(isLocked = true, isCharging = false)
        assertTrue(VehicleCommandCenterProjection.toggleIsOn(command("lock"), state))
        assertFalse(VehicleCommandCenterProjection.toggleIsOn(command("charge"), state))
        assertFalse(VehicleCommandCenterProjection.toggleIsOn(command("wake_up"), state))
        assertFalse(VehicleCommandCenterProjection.toggleIsOn(command("lock"), null))
    }

    @Test
    fun toggleCommandPicksTheOffTwinWhenOn() {
        val locked = vehicleState(isLocked = true, isCharging = false)
        val unlocked = vehicleState(isLocked = false, isCharging = false)
        assertEquals("unlock", VehicleCommandCenterProjection.toggleCommandFor(command("lock"), locked))
        assertEquals("lock", VehicleCommandCenterProjection.toggleCommandFor(command("lock"), unlocked))
    }

    // ── Search filter (web `filteredCommands`) ──────────────────────────────────────────────────────────

    @Test
    fun filterIsNullWhileTheQueryIsBlank() {
        assertNull(VehicleCommandCenterProjection.filterCommands(catalog, "   ") { it.labels.labelFallback })
    }

    @Test
    fun filterMatchesLabelCategoryOrCommandName() {
        val byLabel = VehicleCommandCenterProjection.filterCommands(catalog, "sentry") { it.labels.labelFallback }
        assertTrue(byLabel!!.any { it.id == "sentry" })
        val byCategory = VehicleCommandCenterProjection.filterCommands(catalog, "charging") { it.labels.labelFallback }
        assertTrue(byCategory!!.all { it.category == CommandCenterCategory.Charging })
    }

    // ── Grouping (web `commandsByCategory` + CATEGORY_ORDER) ─────────────────────────────────────────────

    @Test
    fun groupedInOrderFollowsCategoryOrderAndSkipsEmpty() {
        val groups = VehicleCommandCenterProjection.groupedInOrder(catalog)
        assertEquals(14, groups.size)
        assertEquals(CommandCenterCategory.Security, groups.first().category)
        assertEquals(CommandCenterCategory.Media, groups.last().category)
        groups.forEach { assertTrue(it.commands.isNotEmpty()) }
    }

    @Test
    fun groupingSkipsCategoriesWithNoCommands() {
        val onlyMedia = catalog.filter { it.category == CommandCenterCategory.Media }
        val groups = VehicleCommandCenterProjection.groupedInOrder(onlyMedia)
        assertEquals(1, groups.size)
        assertEquals(CommandCenterCategory.Media, groups.single().category)
    }

    // ── Favourites (web `favorites` state + localStorage) ───────────────────────────────────────────────

    @Test
    fun favoriteCommandsKeepsCatalogueOrder() {
        val favorites = listOf("honk_horn", "wake_up")
        val resolved = VehicleCommandCenterProjection.favoriteCommands(favorites, catalog).map { it.id }
        // Catalogue order (wake_up before honk_horn), not favourites order.
        assertEquals(listOf("wake_up", "honk_horn"), resolved)
    }

    @Test
    fun toggleFavoriteAddsAndRemoves() {
        val added = VehicleCommandCenterProjection.toggleFavorite(emptyList(), "lock")
        assertEquals(listOf("lock"), added)
        assertEquals(emptyList<String>(), VehicleCommandCenterProjection.toggleFavorite(added, "lock"))
        assertTrue(VehicleCommandCenterProjection.isFavorite(added, "lock"))
    }

    @Test
    fun favouritesStorageKeyMatchesTheWebKey() {
        assertEquals("teslasync-cmd-favorites-7", favoritesStorageKey(7L))
    }

    @Test
    fun favouritesSerializeRoundTrips() {
        assertEquals(listOf("a", "b"), parseFavorites(serializeFavorites(listOf("a", "b"))))
        assertNull(parseFavorites(null))
        assertEquals(emptyList<String>(), parseFavorites(""))
    }

    @Test
    fun sessionFavouritesStoreReadsBackWhatItWrote() {
        SessionCommandFavoritesStore.clear()
        assertNull(SessionCommandFavoritesStore.read(9L))
        SessionCommandFavoritesStore.write(9L, listOf("lock", "sentry"))
        assertEquals(listOf("lock", "sentry"), SessionCommandFavoritesStore.read(9L))
        SessionCommandFavoritesStore.clear()
        assertNull(SessionCommandFavoritesStore.read(9L))
    }

    // ── Timestamp parsing (web ISO `created_at` / `updated_at`) ──────────────────────────────────────────

    @Test
    fun parsesIsoTimestampsAndRejectsGarbage() {
        assertNotNull(parseTimestampMillis("2026-06-12T12:00:00Z"))
        assertNotNull(parseTimestampMillis("2026-06-12T12:00:00+02:00"))
        assertNull(parseTimestampMillis("not-a-timestamp"))
    }

    private fun vehicleState(
        isLocked: Boolean,
        isCharging: Boolean,
    ): CommandCenterVehicleState =
        CommandCenterVehicleState(
            batteryLevel = 80,
            ratedRange = 300_000.0,
            isLocked = isLocked,
            isCharging = isCharging,
            isClimateOn = false,
            sentryMode = false,
            insideTemp = 21.0,
            speed = 0.0,
        )
}
