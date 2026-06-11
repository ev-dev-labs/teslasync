package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM verification of the APIUsageWidget's framework-free logic — the JSON parse adapter, the stat
 * projection (calls / average response / error rate / error count, with the danger-alert and "High"
 * chip branches), the [Resource.mapValue] preservation, the footprint flags, the registry metadata,
 * the diagnostics, and the [ApiUsageViewModel] per-state transitions (loading / loaded / empty /
 * error / stale-offline / refresh). Mirrors the web spec
 * (`web/src/features/dashboard/widgets/APIUsageWidget.tsx`) and the Windows parity test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class APIUsageWidgetTest {
    // ---- Parse adapter -------------------------------------------------------------

    @Test
    fun fromJson_reads_snake_case_fields() {
        val element =
            json(
                """
                {"total_calls":20000,"error_count":12,"error_rate":6.5,
                 "avg_duration_ms":42.5,"last_24h":12345,"by_method":{"GET":10}}
                """.trimIndent(),
            )
        val stats = ApiUsageStats.fromJson(element)
        assertEquals(12345, stats.last24h)
        assertEquals(42.5, stats.avgDurationMs, 0.0)
        assertEquals(6.5, stats.errorRate, 0.0)
        assertEquals(12, stats.errorCount)
        assertEquals(20000, stats.totalCalls)
        assertTrue(stats.hasData)
    }

    @Test
    fun fromJson_is_tolerant_of_missing_fields() {
        val stats = ApiUsageStats.fromJson(json("""{"last_24h":7}"""))
        assertEquals(7, stats.last24h)
        assertEquals(0.0, stats.avgDurationMs, 0.0)
        assertEquals(0, stats.errorCount)
        assertTrue(stats.hasData) // a present object renders (web shows zeros, not empty)
    }

    @Test
    fun fromJson_returns_empty_for_non_object() {
        val stats = ApiUsageStats.fromJson(json("[]"))
        assertFalse(stats.hasData)
        assertEquals(0, stats.last24h)
    }

    @Test
    fun fromJson_accepts_numeric_strings() {
        val stats = ApiUsageStats.fromJson(json("""{"last_24h":"50","error_rate":"3.5"}"""))
        assertEquals(50, stats.last24h)
        assertEquals(3.5, stats.errorRate, 0.0)
    }

    @Test
    fun empty_snapshot_has_no_data() {
        assertFalse(ApiUsageStats.EMPTY.hasData)
        assertTrue(stats().hasData)
    }

    // ---- Footprint flags (web isCompact / isWide) ----------------------------------

    @Test
    fun size_flags_match_web() {
        assertTrue(ApiUsageSize(1, 2).isCompact)
        assertEquals(2, ApiUsageSize(1, 2).gridColumns)
        assertFalse(ApiUsageSize(2, 2).isCompact)
        assertFalse(ApiUsageSize(2, 2).isWide)
        assertEquals(2, ApiUsageSize(2, 2).gridColumns)
        assertTrue(ApiUsageSize(3, 2).isWide)
        assertEquals(4, ApiUsageSize(3, 2).gridColumns)
        assertTrue(ApiUsageSize(4, 2).isWide)
    }

    // ---- Projection ----------------------------------------------------------------

    @Test
    fun project_formats_four_stats() {
        val view = ApiUsageProjection.project(stats(), ApiUsageSize(2, 2), strings(), Locale.US)
        assertEquals(4, view.stats.size)

        assertEquals("Total Calls (24h)", view.stats[0].label)
        assertEquals("12,345", view.stats[0].value) // web totalCalls reads data.last24h
        assertNull(view.stats[0].unit)
        assertFalse(view.stats[0].isAlert)

        assertEquals("Avg Response", view.stats[1].label)
        assertEquals("42.5", view.stats[1].value)
        assertEquals("ms", view.stats[1].unit)

        assertEquals("Error Rate", view.stats[2].label)
        assertEquals("6.5", view.stats[2].value)
        assertEquals("%", view.stats[2].unit)

        assertEquals("Errors", view.stats[3].label)
        assertEquals("12", view.stats[3].value)
        assertNull(view.stats[3].unit)
    }

    @Test
    fun project_flags_high_error_rate_with_alert_and_trend() {
        val view = ApiUsageProjection.project(stats(errorRate = 6.5, errorCount = 12), ApiUsageSize(2, 2), strings(), Locale.US)
        assertTrue(view.stats[2].isAlert) // error rate > 5 -> red value
        assertEquals("High", view.stats[2].trendLabel)
        assertTrue(view.stats[3].isAlert) // error count > 0 -> red value
        assertNull(view.stats[3].trendLabel) // no trend chip on the count tile
    }

    @Test
    fun project_does_not_flag_low_error_rate() {
        val view = ApiUsageProjection.project(stats(errorRate = 2.0, errorCount = 0), ApiUsageSize(2, 2), strings(), Locale.US)
        assertFalse(view.stats[2].isAlert)
        assertNull(view.stats[2].trendLabel)
        assertFalse(view.stats[3].isAlert)
    }

    @Test
    fun project_compact_reads_last24h_and_label() {
        val view = ApiUsageProjection.project(stats(last24h = 12345, errorRate = 2.0), ApiUsageSize(1, 2), strings(), Locale.US)
        assertTrue(view.isCompact)
        assertEquals("12,345", view.compactValue)
        assertEquals("Calls (24h)", view.compactLabel)
        assertFalse(view.showCompactError)
        assertEquals("", view.compactErrorText)
    }

    @Test
    fun project_compact_shows_error_line_when_high() {
        val view = ApiUsageProjection.project(stats(errorRate = 6.5), ApiUsageSize(1, 2), strings(), Locale.US)
        assertTrue(view.showCompactError)
        assertEquals("6.5% errors", view.compactErrorText)
    }

    @Test
    fun project_stats_have_non_blank_content_descriptions() {
        val view = ApiUsageProjection.project(stats(), ApiUsageSize(2, 2), strings(), Locale.US)
        view.stats.forEach { stat ->
            assertTrue(stat.contentDescription.isNotBlank())
            assertTrue(stat.contentDescription.contains(stat.label))
            assertTrue(stat.contentDescription.contains(stat.value))
        }
        assertTrue(view.compactContentDescription.contains("Calls (24h)"))
    }

    @Test
    fun project_compact_description_includes_errors_when_high() {
        val view = ApiUsageProjection.project(stats(last24h = 100, errorRate = 9.0), ApiUsageSize(1, 2), strings(), Locale.US)
        assertTrue(view.compactContentDescription.contains("Calls (24h)"))
        assertTrue(view.compactContentDescription.contains("errors"))
    }

    @Test
    fun projection_error_threshold_matches_web_constant() {
        assertEquals(5.0, ApiUsageProjection.ERROR_RATE_ALERT_THRESHOLD, 0.0)
    }

    // ---- Resource.mapValue (cache-then-network preservation) -----------------------

    @Test
    fun mapValue_preserves_status_and_parses_payload() {
        val element = json("""{"last_24h":10,"error_count":2}""")

        val cached = Resource.Loading<JsonElement>(element, 50L, true).mapValue(ApiUsageStats::fromJson)
        assertTrue(cached is Resource.Loading)
        assertEquals(10, cached.cached!!.last24h)
        assertTrue(cached.stale)

        val success = Resource.Success(element, 50L, false).mapValue(ApiUsageStats::fromJson)
        assertTrue(success is Resource.Success)
        assertEquals(2, (success as Resource.Success).data.errorCount)

        val offline = Resource.Error<JsonElement>(element, 50L, true, ApiError.Network()).mapValue(ApiUsageStats::fromJson)
        assertTrue(offline is Resource.Error)
        assertEquals(10, offline.cached!!.last24h)
        assertTrue(offline.stale)
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    @Test
    fun registration_matches_web_registry() {
        assertEquals("api-usage", ApiUsageRegistration.ID)
        assertEquals("system", ApiUsageRegistration.CATEGORY)
        assertEquals("APIUsageWidget", ApiUsageRegistration.SLUG)
        assertEquals(ApiUsageSize(2, 2), ApiUsageRegistration.defaultSize)
        assertEquals(ApiUsageSize(1, 2), ApiUsageRegistration.minSize)
        assertEquals(ApiUsageSize(4, 40), ApiUsageRegistration.maxSize)
        assertTrue(ApiUsageRegistration.DESCRIPTION.contains("error", ignoreCase = true))
    }

    @Test
    fun registration_bounds_check() {
        assertTrue(ApiUsageRegistration.isWithinBounds(ApiUsageSize(2, 2)))
        assertTrue(ApiUsageRegistration.isWithinBounds(ApiUsageSize(1, 2))) // min
        assertTrue(ApiUsageRegistration.isWithinBounds(ApiUsageSize(4, 40))) // max
        assertFalse(ApiUsageRegistration.isWithinBounds(ApiUsageSize(0, 2))) // below min cols
        assertFalse(ApiUsageRegistration.isWithinBounds(ApiUsageSize(5, 40))) // above max cols
        assertFalse(ApiUsageRegistration.isWithinBounds(ApiUsageSize(2, 41))) // above max rows
        assertFalse(ApiUsageRegistration.isWithinBounds(ApiUsageSize(2, 1))) // below min rows
    }

    @Test
    fun registration_clamps_to_bounds() {
        assertEquals(ApiUsageSize(1, 2), ApiUsageRegistration.clamp(ApiUsageSize(0, 0)))
        assertEquals(ApiUsageSize(4, 40), ApiUsageRegistration.clamp(ApiUsageSize(9, 99)))
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    @Test
    fun diagnostics_emits_view_opened_with_slug() {
        val logger = RecordingLogger()
        ApiUsageDiagnostics(logger).recordViewOpened()
        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events[0].first)
        assertEquals("APIUsageWidget", logger.events[0].second["slug"])
    }

    // ---- View-model state matrix ---------------------------------------------------

    @Test
    fun viewModel_loading_only_stays_loading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newViewModel(Resource.Loading(null, null, false))
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.stats.value.phase)
            assertFalse(vm.stats.value.hasData)
        }

    @Test
    fun viewModel_loaded_exposes_stats() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newViewModel(Resource.Loading(null, null, false), Resource.Success(stats(), 100L, false))
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            val state = vm.stats.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.hasData)
            assertEquals(12345, state.data!!.last24h)
            assertEquals(100L, state.fetchedAt)
            assertFalse(state.hasError)
        }

    @Test
    fun viewModel_loaded_without_payload_renders_empty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newViewModel(Resource.Success(ApiUsageStats.EMPTY, 100L, false))
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.stats.value.phase)
            assertTrue(vm.stats.value.isEmpty)
            assertFalse(
                vm.stats.value.data!!
                    .hasData,
            )
        }

    @Test
    fun viewModel_failure_without_cache_renders_error_with_retry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newViewModel(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            val state = vm.stats.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.canRetry)
        }

    @Test
    fun viewModel_failure_with_cache_stays_offline_with_retry() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeApiUsageSource(listOf(Resource.Loading(null, null, false), Resource.Success(stats(), 100L, false)))
            val vm = ApiUsageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            assertEquals(
                12345,
                vm.stats.value.data!!
                    .last24h,
            )

            source.emissions = listOf(Resource.Error(stats(last24h = 5), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.stats.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(5, state.data!!.last24h)
        }

    @Test
    fun viewModel_refresh_re_fetches_updated_rollup() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeApiUsageSource(listOf(Resource.Success(stats(last24h = 5), 100L, false)))
            val vm = ApiUsageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            assertEquals(
                5,
                vm.stats.value.data!!
                    .last24h,
            )

            source.emissions = listOf(Resource.Success(stats(last24h = 9876), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(
                9876,
                vm.stats.value.data!!
                    .last24h,
            )
        }

    // ---- Fakes / helpers -----------------------------------------------------------

    private fun newViewModelSource(vararg emissions: Resource<ApiUsageStats>) = FakeApiUsageSource(emissions.toList())

    private fun TestScope.newViewModel(vararg emissions: Resource<ApiUsageStats>): ApiUsageViewModel =
        ApiUsageViewModel(newViewModelSource(*emissions), RecordingLogger(), backgroundScope)

    private fun stats(
        last24h: Int = 12345,
        avgDurationMs: Double = 42.5,
        errorRate: Double = 6.5,
        errorCount: Int = 12,
        totalCalls: Int = 20000,
    ): ApiUsageStats = ApiUsageStats(last24h, avgDurationMs, errorRate, errorCount, totalCalls)

    private fun strings(): ApiUsageStrings =
        ApiUsageStrings(
            title = "API Usage",
            totalCalls = "Total Calls (24h)",
            avgResponse = "Avg Response",
            errorRate = "Error Rate",
            totalErrors = "Errors",
            high = "High",
            calls24h = "Calls (24h)",
            errors = "errors",
            noData = "No API usage data",
        )

    private fun json(raw: String): JsonElement = Json.parseToJsonElement(raw)

    private class FakeApiUsageSource(
        @Volatile var emissions: List<Resource<ApiUsageStats>>,
    ) : ApiUsageSource {
        override fun stream(): Flow<Resource<ApiUsageStats>> = flow { emissions.forEach { emit(it) } }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
