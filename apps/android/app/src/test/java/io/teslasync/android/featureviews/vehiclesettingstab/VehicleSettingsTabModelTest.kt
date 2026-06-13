package io.teslasync.android.featureviews.vehiclesettingstab

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSetting
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the VehicleSettingsTab surface's pure logic — the native analogue of the web
 * component's pre-JSX derivations (web/src/features/vehicles/components/VehicleSettingsTab.tsx): the static
 * descriptor whitelist, the effective-value -> draft codec (with the datetime-local <-> RFC3339 conversion),
 * the draft validation (the web `parseDraft`), and the cache-then-network -> display projection across every
 * state (loading / content / hard error / stale-offline) plus the per-row dirty + source-pill + reset
 * gating. Runs in the :android:testReleaseUnitTest gate.
 */
class VehicleSettingsTabModelTest {
    // ── Descriptor whitelist ─────────────────────────────────────────────────────────

    @Test
    fun descriptorsMirrorTheWebWhitelistInOrder() {
        assertEquals(
            listOf("nickname", "mute_until", "charge_cost_tariff_id", "units_distance", "units_temperature", "units_energy"),
            VEHICLE_SETTING_DESCRIPTORS.map { it.key },
        )
        assertEquals(VehicleSettingKind.Text, descriptorForKey("nickname")?.kind)
        assertEquals(VehicleSettingKind.Timestamp, descriptorForKey("mute_until")?.kind)
        assertEquals(VehicleSettingKind.Select, descriptorForKey("units_distance")?.kind)
        assertEquals(64, descriptorForKey("nickname")?.maxLength)
        assertEquals(listOf("mi", "km"), descriptorForKey("units_distance")?.options?.map { it.value })
        assertNull(descriptorForKey("not_a_key"))
    }

    // ── effectiveToDraft (web `effectiveToDraft`) ─────────────────────────────────────

    @Test
    fun effectiveToDraftRendersTextSelectAndAbsentValues() {
        val text = descriptorForKey("nickname")!!
        val select = descriptorForKey("units_distance")!!
        assertEquals("Snowball", effectiveToDraft(text, setting("nickname", JsonPrimitive("Snowball"), EffectiveSettingSource.OVERRIDE)))
        // A non-string value is stringified (web `String(v)`); an absent value is the empty string.
        assertEquals("42", effectiveToDraft(text, setting("nickname", JsonPrimitive(42), EffectiveSettingSource.USER)))
        assertEquals("", effectiveToDraft(text, setting("nickname", JsonNull, EffectiveSettingSource.DEFAULT)))
        assertEquals("", effectiveToDraft(text, null))
        assertEquals("mi", effectiveToDraft(select, setting("units_distance", JsonPrimitive("mi"), EffectiveSettingSource.USER)))
    }

    @Test
    fun effectiveToDraftRendersTimestampAsLocalShapeAndBlankForAbsent() {
        val mute = descriptorForKey("mute_until")!!
        val effective = setting("mute_until", JsonPrimitive("2025-12-31T23:59:00.000Z"), EffectiveSettingSource.OVERRIDE)
        val local = effectiveToDraft(mute, effective)
        assertTrue("got '$local'", local.matches(LOCAL_INPUT_REGEX))
        assertEquals("", effectiveToDraft(mute, setting("mute_until", JsonNull, EffectiveSettingSource.DEFAULT)))
        assertEquals("", effectiveToDraft(mute, null))
    }

    // ── parseDraft (web `parseDraft`) ─────────────────────────────────────────────────

    @Test
    fun parseDraftRejectsABlankDraftAsRequired() {
        assertEquals(DraftParse.Invalid(VehicleSettingValidation.Required), parseDraft(descriptorForKey("nickname")!!, "   "))
    }

    @Test
    fun parseDraftAcceptsTextAndTrimsIt() {
        val parsed = parseDraft(descriptorForKey("nickname")!!, "  Stardust  ")
        assertTrue(parsed is DraftParse.Valid)
        assertEquals("Stardust", (parsed as DraftParse.Valid).value.jsonPrimitive.contentOrNull)
    }

    @Test
    fun parseDraftGuardsTheSelectOptionSet() {
        val distance = descriptorForKey("units_distance")!!
        assertEquals(DraftParse.Valid(JsonPrimitive("km")), parseDraft(distance, "km"))
        assertEquals(DraftParse.Invalid(VehicleSettingValidation.Invalid), parseDraft(distance, "lightyears"))
    }

    @Test
    fun parseDraftConvertsAValidTimestampToRfc3339AndRejectsGarbage() {
        val mute = descriptorForKey("mute_until")!!
        val parsed = parseDraft(mute, "2025-06-15T12:30")
        assertTrue(parsed is DraftParse.Valid)
        val iso = (parsed as DraftParse.Valid).value.jsonPrimitive.contentOrNull
        // The forwarded value is an RFC3339 instant string parseable back into an Instant (web `toISOString`).
        assertEquals(false, runCatching { Instant.parse(iso) }.isFailure)
        assertEquals(DraftParse.Invalid(VehicleSettingValidation.InvalidDate), parseDraft(mute, "not-a-date"))
    }

    @Test
    fun datetimeLocalRoundTripsWithRfc3339() {
        val iso = "2025-12-31T23:59:00.000Z"
        val local = rfc3339ToLocalInput(iso)
        assertTrue(local.matches(LOCAL_INPUT_REGEX))
        val back = localInputToRfc3339(local)
        assertNull(localInputToRfc3339(""))
        assertNull(localInputToRfc3339("garbage"))
        // Re-deriving the local shape from the round-tripped instant yields the same wall-clock string.
        assertEquals(local, rfc3339ToLocalInput(back))
    }

    // ── Projection (cache-then-network -> display) ─────────────────────────────────────

    @Test
    fun projectLoadingWithNoCacheShowsLoadingAndDefaultRows() {
        val display = VehicleSettingsTabProjection.project(state(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
        assertEquals(VehicleSettingsTabStatus.Loading, display.status)
        assertEquals(VEHICLE_SETTING_DESCRIPTORS.size, display.rows.size)
        assertTrue(display.rows.all { it.source == EffectiveSettingSource.DEFAULT })
    }

    @Test
    fun projectSuccessRendersEveryRowWithItsResolvedSourcePill() {
        val display = VehicleSettingsTabProjection.project(state(success(defaultPayload())))
        assertEquals(VehicleSettingsTabStatus.Ready, display.status)
        assertFalse(display.stale)
        // Pills mirror the payload: 1 override, 2 user, 3 default — exactly the web row-rendering assertion.
        assertEquals(1, display.rows.count { it.source == EffectiveSettingSource.OVERRIDE })
        assertEquals(2, display.rows.count { it.source == EffectiveSettingSource.USER })
        assertEquals(3, display.rows.count { it.source == EffectiveSettingSource.DEFAULT })
        assertEquals("Snowball", display.rows.first { it.key == "nickname" }.draft)
    }

    @Test
    fun projectHardErrorWithNoCacheShowsErrorAndRetry() {
        val display =
            VehicleSettingsTabProjection.project(
                state(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
            )
        assertEquals(VehicleSettingsTabStatus.Error, display.status)
        assertEquals(ErrorKind.Network, display.errorKind)
        assertTrue(display.canRetry)
    }

    @Test
    fun projectErrorWithCacheKeepsRowsStaleAndOffline() {
        val display =
            VehicleSettingsTabProjection.project(
                state(Resource.Error(cached = defaultPayload(), fetchedAt = 5L, stale = true, error = ApiError.Timeout())),
            )
        assertEquals(VehicleSettingsTabStatus.Ready, display.status)
        assertTrue(display.stale)
        assertTrue(display.offline)
        assertTrue(display.canRetry)
        assertTrue(display.isDegraded)
    }

    @Test
    fun projectMarksARowDirtyAndSaveableOnlyWhenTheDraftDiffers() {
        val server = success(defaultPayload())
        // An edited nickname differs from the "Snowball" override -> dirty + can save.
        val edited = VehicleSettingsTabProjection.project(state(server, drafts = mapOf("nickname" to "Stardust")))
        val nickname = edited.rows.first { it.key == "nickname" }
        assertTrue(nickname.isDirty)
        assertTrue(nickname.canSave)
        // A draft equal to the effective value is not dirty.
        val same = VehicleSettingsTabProjection.project(state(server, drafts = mapOf("nickname" to "Snowball")))
        assertFalse(same.rows.first { it.key == "nickname" }.isDirty)
        // A save in flight suppresses canSave.
        val savingState = state(server, drafts = mapOf("nickname" to "Stardust"), saving = setOf("nickname"))
        val saving = VehicleSettingsTabProjection.project(savingState)
        assertFalse(saving.rows.first { it.key == "nickname" }.canSave)
    }

    @Test
    fun resetIsEnabledOnlyForAnOverrideRow() {
        val display = VehicleSettingsTabProjection.project(state(success(defaultPayload())))
        // nickname is an override -> reset enabled; mute_until is a default -> reset disabled (web parity).
        assertTrue(display.rows.first { it.key == "nickname" }.canReset)
        assertFalse(display.rows.first { it.key == "mute_until" }.canReset)
    }

    @Test
    fun inFlightSetsSurfaceThePerRowSavingAndResettingFlags() {
        val display =
            VehicleSettingsTabProjection.project(
                state(success(defaultPayload()), saving = setOf("nickname"), resetting = setOf("units_distance")),
            )
        assertTrue(display.rows.first { it.key == "nickname" }.saving)
        assertTrue(display.rows.first { it.key == "units_distance" }.resetting)
        // A resetting row cannot also be reset again.
        assertFalse(display.rows.first { it.key == "units_distance" }.canReset)
    }

    @Test
    fun diagnosticsSlugIsTheSurfaceName() {
        assertEquals("VehicleSettingsTab", VehicleSettingsTabDiagnostics.SLUG)
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────

    private fun state(
        settings: Resource<VehicleSettingsResponse>,
        drafts: Map<String, String> = emptyMap(),
        validation: Map<String, VehicleSettingValidation> = emptyMap(),
        saving: Set<String> = emptySet(),
        resetting: Set<String> = emptySet(),
    ): VehicleSettingsTabState =
        VehicleSettingsTabState(
            settings = settings,
            drafts = drafts,
            validation = validation,
            savingKeys = saving,
            resettingKeys = resetting,
        )

    private fun setting(
        key: String,
        value: JsonElement,
        source: EffectiveSettingSource,
    ): EffectiveSetting = EffectiveSetting(key = key, value = value, source = source)

    private fun defaultPayload(): VehicleSettingsResponse =
        VehicleSettingsResponse(
            listOf(
                setting("nickname", JsonPrimitive("Snowball"), EffectiveSettingSource.OVERRIDE),
                setting("mute_until", JsonNull, EffectiveSettingSource.DEFAULT),
                setting("charge_cost_tariff_id", JsonPrimitive(""), EffectiveSettingSource.DEFAULT),
                setting("units_distance", JsonPrimitive("mi"), EffectiveSettingSource.USER),
                setting("units_temperature", JsonPrimitive("F"), EffectiveSettingSource.USER),
                setting("units_energy", JsonPrimitive("kWh"), EffectiveSettingSource.DEFAULT),
            ),
        )

    private fun <T> success(value: T): Resource<T> = Resource.Success(value, fetchedAt = 1L, stale = false)

    private companion object {
        val LOCAL_INPUT_REGEX = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$""")
    }
}
