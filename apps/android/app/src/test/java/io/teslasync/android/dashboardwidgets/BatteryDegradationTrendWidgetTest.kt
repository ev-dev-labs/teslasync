package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import kotlin.time.Instant

/**
 * Framework-free unit tests for the BatteryDegradationTrend widget — the tolerant JSON parsing, the
 * `current_health_pct ?? current_health` fallback, the `chartData` map (including the repeated
 * `original` first-sample range), the `stats` projection (with the rate-gated Degradation chip), the
 * compact / empty / "needs more data" branches, the two-store cache-then-network adapter, and the
 * ViewModel bound to the real shared [VehiclesStore] + [EnergyStore] over fake repositories. These run
 * in the `:android:testReleaseUnitTest` gate and cover the behavior the composables only render.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryDegradationTrendWidgetTest {
    private val labels =
        BatteryDegradationLabels(soh = "SoH", degradation = "Degradation", cycles = "Cycles", perMonth = "mo")

    // ── effectiveHealth fallback (web `current_health_pct ?? current_health`) ────
    @Test
    fun effectiveHealthPrefersPctThenFallsBackKeepingZero() {
        assertEquals(90.0, snapshot(healthPct = 90.0, health = 85.0).effectiveHealth)
        assertEquals(85.0, snapshot(healthPct = null, health = 85.0).effectiveHealth)
        assertEquals(0.0, snapshot(healthPct = 0.0, health = 85.0).effectiveHealth)
        assertNull(snapshot(healthPct = null, health = null).effectiveHealth)
    }

    // ── JSON parsing (tolerant) ─────────────────────────────────────────────────
    @Test
    fun fromJsonReadsFieldsAndIsTolerant() {
        val parsed =
            BatteryDegradationSnapshot.fromJson(
                degradationJson(
                    healthPct = 91.5,
                    rate = 1.25,
                    cycles = 842.0,
                    trend = buildJsonArray { add(trendPoint("Jan", 99.0, 300.0)) },
                ),
            )
        assertEquals(91.5, parsed.currentHealthPct)
        assertEquals(1.25, parsed.degradationRatePctPerMonth)
        assertEquals(842.0, parsed.currentCycles)
        assertEquals(1, parsed.monthlyTrend.size)
        assertEquals("Jan", parsed.monthlyTrend[0].month)

        // A non-object body and a trend row without a month are dropped, never thrown.
        assertTrue(BatteryDegradationSnapshot.fromJson(JsonNull).isEmpty)
        val noMonth = degradationJson(trend = buildJsonArray { add(buildJsonObject { put("avg_health", 99.0) }) })
        assertTrue(BatteryDegradationSnapshot.fromJson(noMonth).monthlyTrend.isEmpty())
    }

    // ── isEmpty (web `currentHealth == null && chartData.length === 0`) ──────────
    @Test
    fun isEmptyOnlyWhenNoHealthAndNoTrend() {
        assertTrue(snapshot(healthPct = null, trend = emptyList()).isEmpty)
        assertFalse(snapshot(healthPct = 92.0, trend = emptyList()).isEmpty)
        assertFalse(snapshot(healthPct = null, trend = listOf(trend("Jan", 99.0, 300.0))).isEmpty)
    }

    // ── projection: chartData mapping + flags (web chartData / isCompact) ────────
    @Test
    fun projectMapsChartDataWithRepeatedOriginalRange() {
        val snap =
            snapshot(
                healthPct = 90.0,
                trend = listOf(trend("Jan", 99.0, 300.0), trend("Feb", 98.0, 290.0), trend("Mar", 97.0, 285.0)),
            )
        val display = BatteryDegradationProjection.project(snap, BatteryDegradationSize(2, 4))

        assertFalse(display.isCompact)
        assertFalse(display.isEmpty)
        assertTrue(display.hasTrend)
        assertEquals(listOf("Jan", "Feb", "Mar"), display.monthLabels)
        assertEquals(listOf(99.0, 98.0, 97.0), display.healthValues)
        // `original` is the first sample's range, repeated on every row (web chartData).
        assertEquals(listOf(300.0, 300.0, 300.0), display.points.map { it.original })
        assertEquals(285.0, display.points[2].range)
    }

    @Test
    fun projectHasTrendNeedsMoreThanOneSample() {
        assertFalse(BatteryDegradationProjection.project(snapshot(trend = listOf(trend("Jan", 99.0, 300.0))), STD).hasTrend)
        assertTrue(
            BatteryDegradationProjection
                .project(snapshot(trend = listOf(trend("Jan", 99.0, 300.0), trend("Feb", 98.0, 290.0))), STD)
                .hasTrend,
        )
    }

    @Test
    fun showDegradationOnlyWhenRatePresentAndPositive() {
        assertTrue(BatteryDegradationProjection.project(snapshot(rate = 1.2), STD).showDegradation)
        assertFalse(BatteryDegradationProjection.project(snapshot(rate = 0.0), STD).showDegradation)
        assertFalse(BatteryDegradationProjection.project(snapshot(rate = null), STD).showDegradation)
    }

    // ── stat formatting (web fmtNumber + '—' / '−' punctuation) ──────────────────
    @Test
    fun statValueFormattersMatchWebPunctuation() {
        assertEquals("92.3%", BatteryDegradationProjection.sohValue(92.34, Locale.US))
        assertEquals("\u2014", BatteryDegradationProjection.sohValue(null, Locale.US))
        assertEquals("\u22121.20%", BatteryDegradationProjection.degradationValue(1.2, Locale.US))
        assertEquals("1,234", BatteryDegradationProjection.cyclesValue(1234.0, Locale.US))
        assertEquals("\u2014", BatteryDegradationProjection.cyclesValue(null, Locale.US))
    }

    @Test
    fun statsInsertDegradationChipOnlyWhenPositive() {
        val withRate =
            BatteryDegradationProjection.stats(
                BatteryDegradationProjection.project(snapshot(healthPct = 92.0, rate = 1.2, cycles = 800.0), STD),
                labels,
                Locale.US,
            )
        assertEquals(listOf("SoH", "Degradation", "Cycles"), withRate.map { it.label })
        assertEquals("/mo", withRate[1].unit)
        assertEquals("\u22121.20%", withRate[1].value)

        val noRate =
            BatteryDegradationProjection.stats(
                BatteryDegradationProjection.project(snapshot(healthPct = 92.0, rate = 0.0, cycles = 800.0), STD),
                labels,
                Locale.US,
            )
        assertEquals(listOf("SoH", "Cycles"), noRate.map { it.label })
    }

    // ── size model + registry descriptor ────────────────────────────────────────
    @Test
    fun sizeModelIsCompactOnlyAtASingleCell() {
        assertTrue(BatteryDegradationSize(1, 1).isCompact)
        assertFalse(BatteryDegradationSize(1, 2).isCompact)
        assertFalse(BatteryDegradationSize(2, 1).isCompact)
        assertFalse(BatteryDegradationSize(2, 4).isCompact)
    }

    @Test
    fun descriptorMatchesWebRegistry() {
        assertEquals("battery-degradation-trend", BatteryDegradationTrendWidgetDescriptor.ID)
        assertEquals("battery", BatteryDegradationTrendWidgetDescriptor.CATEGORY)
        assertEquals("BatteryDegradationTrendWidget", BatteryDegradationTrendWidgetDescriptor.SURFACE_SLUG)
        assertEquals(BatteryDegradationSize(2, 4), BatteryDegradationTrendWidgetDescriptor.defaultSize)
        assertEquals(BatteryDegradationSize(1, 2), BatteryDegradationTrendWidgetDescriptor.minSize)
        assertEquals(BatteryDegradationSize(4, 40), BatteryDegradationTrendWidgetDescriptor.maxSize)
    }

    // ── id resolution (web `vehicleId ?? vehicles?.[0]?.id`) ─────────────────────
    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstVehicle() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3), vehicle(9))))
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(9))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    // ── two-store adapter (cache-then-network combine) ──────────────────────────
    @Test
    fun adapterEmitsEmptySnapshotWhenNoVehicleResolves() =
        runTest {
            val result =
                batteryDegradationResource(
                    vehicles = flowOf(success(JsonNull).asVehicles(emptyList())),
                    explicitVehicleId = null,
                    degradation = { flowOf(success(degradationJson(healthPct = 90.0))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached!!.isEmpty)
        }

    @Test
    fun adapterMergesVehicleAndDegradationIntoSuccess() =
        runTest {
            val result =
                batteryDegradationResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(42)), 100L, false)),
                    explicitVehicleId = null,
                    degradation = { id ->
                        assertEquals("42", id)
                        flowOf(success(degradationJson(healthPct = 88.5, trend = buildJsonArray { add(trendPoint("Jan", 99.0, 300.0)) })))
                    },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(88.5, result.cached!!.currentHealthPct)
            assertEquals(1, result.cached!!.monthlyTrend.size)
        }

    @Test
    fun adapterStaysLoadingWhileDegradationLoads() =
        runTest {
            val result =
                batteryDegradationResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(1)), 100L, false)),
                    explicitVehicleId = null,
                    degradation = { flowOf(Resource.Loading(null, null, false)) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterKeepsCachedDegradationOnErrorAsOffline() =
        runTest {
            val cached: JsonElement = degradationJson(healthPct = 80.0)
            val errored: Flow<Resource<JsonElement>> =
                flowOf(Resource.Error(cached, 50L, stale = true, error = ApiError.Network()))
            val result =
                batteryDegradationResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(1)), 100L, false)),
                    explicitVehicleId = null,
                    degradation = { errored },
                ).toList().last()
            assertTrue(result is Resource.Error)
            assertTrue(result.stale)
            assertEquals(80.0, result.cached!!.currentHealthPct)
        }

    @Test
    fun adapterHonorsExplicitVehicleIdOverFirstVehicle() =
        runTest {
            batteryDegradationResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(3), vehicle(9)), 100L, false)),
                explicitVehicleId = 9L,
                degradation = { id ->
                    assertEquals("9", id)
                    flowOf(success(degradationJson(healthPct = 90.0)))
                },
            ).toList().last()
        }

    // ── ViewModel bound to the real shared stores ───────────────────────────────
    @Test
    fun viewModelProjectsContentFromStores() =
        runTest(UnconfinedTestDispatcher()) {
            val vehiclesRepo = FakeDegradeVehiclesRepository()
            vehiclesRepo.vehicles.value = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            val energyRepo = FakeDegradeEnergyRepository()
            energyRepo.degradation.value =
                listOf(success(degradationJson(healthPct = 93.0, trend = buildJsonArray { add(trendPoint("Jan", 99.0, 300.0)) })))
            val viewModel =
                BatteryDegradationTrendWidgetViewModel(
                    VehiclesStore(vehiclesRepo, backgroundScope),
                    EnergyStore(energyRepo, backgroundScope),
                    DegradeRecordingLogger(),
                    backgroundScope,
                )
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(93.0, state.data!!.effectiveHealth)
        }

    @Test
    fun viewModelNoVehicleIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vehiclesRepo = FakeDegradeVehiclesRepository()
            vehiclesRepo.vehicles.value = listOf(Resource.Success(emptyList(), 100L, false))
            val viewModel =
                BatteryDegradationTrendWidgetViewModel(
                    VehiclesStore(vehiclesRepo, backgroundScope),
                    EnergyStore(FakeDegradeEnergyRepository(), backgroundScope),
                    DegradeRecordingLogger(),
                    backgroundScope,
                )
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, viewModel.state.value.phase)
        }

    @Test
    fun onAppearEmitsViewOpenedTelemetry() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = DegradeRecordingLogger()
            val viewModel =
                BatteryDegradationTrendWidgetViewModel(
                    VehiclesStore(FakeDegradeVehiclesRepository(), backgroundScope),
                    EnergyStore(FakeDegradeEnergyRepository(), backgroundScope),
                    logger,
                    backgroundScope,
                )
            viewModel.onAppear()
            val opened = logger.records.firstOrNull { it.first == "view.opened" }
            assertTrue(opened != null)
            assertEquals("BatteryDegradationTrendWidget", opened!!.second["surface"])
        }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private fun snapshot(
        healthPct: Double? = null,
        health: Double? = null,
        rate: Double? = null,
        cycles: Double? = null,
        trend: List<DegradationTrend> = emptyList(),
    ): BatteryDegradationSnapshot =
        BatteryDegradationSnapshot(
            hasData = true,
            currentHealthPct = healthPct,
            currentHealth = health,
            degradationRatePctPerMonth = rate,
            currentCycles = cycles,
            monthlyTrend = trend,
        )

    private fun trend(
        month: String,
        avgHealth: Double?,
        avgRange: Double?,
    ): DegradationTrend = DegradationTrend(month, avgHealth, avgRange)

    private fun success(payload: JsonElement): Resource<JsonElement> = Resource.Success(payload, fetchedAt = 100L, stale = false)

    private fun Resource<JsonElement>.asVehicles(vehicles: List<Vehicle>): Resource<List<Vehicle>> =
        Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun degradationJson(
        healthPct: Double? = null,
        health: Double? = null,
        rate: Double? = null,
        cycles: Double? = null,
        trend: JsonArray = buildJsonArray {},
    ): JsonObject =
        buildJsonObject {
            if (healthPct != null) put("current_health_pct", healthPct)
            if (health != null) put("current_health", health)
            if (rate != null) put("degradation_rate_pct_per_month", rate)
            if (cycles != null) put("current_cycles", cycles)
            put("monthly_trend", trend)
        }

    private fun trendPoint(
        month: String,
        avgHealth: Double?,
        avgRange: Double?,
    ): JsonObject =
        buildJsonObject {
            put("month", month)
            if (avgHealth != null) put("avg_health", avgHealth)
            if (avgRange != null) put("avg_range", avgRange)
        }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN$id",
        )

    private companion object {
        val STD = BatteryDegradationSize(2, 4)
    }
}

/** A [Logger] that records every event + fields, for telemetry assertions. */
private class DegradeRecordingLogger : Logger {
    val records = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        records.add(event to fields)
    }
}

/**
 * A fake [VehiclesRepository] whose `vehicles` read replays a hand-built emission list (the same shape
 * the real HTTP repo emits); every other read returns a benign loading feed and every mutation
 * succeeds. Only the surface this widget exercises is configurable.
 */
private class FakeDegradeVehiclesRepository : VehiclesRepository {
    val vehicles = MutableStateFlow<List<Resource<List<Vehicle>>>>(listOf(Resource.Loading(null, null, false)))

    private fun loading(): Flow<Resource<JsonElement>> = flowOf(Resource.Loading(null, null, false))

    override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehicles.value.forEach { emit(it) } }

    override fun vehicle(id: String): Flow<Resource<Vehicle>> = flowOf(Resource.Loading(null, null, false))

    override fun vehicleState(
        vehicleId: Long,
        asOf: String?,
    ): Flow<Resource<VehicleStateEnvelope>> = flowOf(Resource.Loading(null, null, false))

    override fun vehiclePositions(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun motorHistory(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun latestTirePressure(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun mediaLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun vehicleConfigLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun userPreferenceLatest(vehicleId: Long): Flow<Resource<JsonElement>> = loading()

    override fun vehicleMobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vehicleOptions(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vehicleSpecs(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vehicleSubscriptions(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun warrantyDetails(): Flow<Resource<JsonElement>> = loading()

    override suspend fun refreshVehicle(id: String): Result<Vehicle> = Result.failure(IllegalStateException("unused"))

    override suspend fun deleteVehicle(id: Long): Result<Unit> = Result.success(Unit)

    override suspend fun syncVehicles(): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun wakeVehicle(id: Long): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleOptions(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleSpecs(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshWarrantyDetails(): Result<JsonElement> = Result.success(JsonNull)
}

/**
 * A fake [EnergyRepository] whose `batteryDegradation` read replays a hand-built emission list; every
 * other read returns a benign loading feed and every mutation succeeds. Only the surface this widget
 * exercises is configurable.
 */
private class FakeDegradeEnergyRepository : EnergyRepository {
    val degradation = MutableStateFlow<List<Resource<JsonElement>>>(listOf(Resource.Loading(null, null, false)))

    private fun loading(): Flow<Resource<JsonElement>> = flowOf(Resource.Loading(null, null, false))

    override fun energyStats(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun batteryHealth(
        vehicleId: String,
        asOf: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> = flow { degradation.value.forEach { emit(it) } }

    override fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vampireDrainEvents(
        vehicleId: String,
        limit: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun projectedRange(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun sleepEfficiency(
        vehicleId: String,
        days: Int,
        startDate: String?,
        endDate: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergySites(): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyHistory(
        siteId: Long,
        period: String,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaBackupHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaWcChargingHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyLiveStatus(siteId: Long): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyLiveStatusHistory(
        siteId: Long,
        since: String?,
        until: String?,
        limit: Int?,
    ): Flow<Resource<JsonElement>> = loading()

    override suspend fun refreshTeslaEnergySites(): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergyHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaBackupHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaWcChargingHistory(
        siteId: Long,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement> = Result.success(JsonNull)
}
