package io.teslasync.android.dashboard.widgets.sleepefficiency

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SleepEfficiencyWidget's pure logic — the JSON parse adapter, the
 * `efficiencyColor` band heuristic, the gauge + stats projection (incl. the compact branch), the total
 * sleep-hours roll-up, the registry metadata, the size flags, and the cache-then-network `Resource`
 * mapper. Mirrors the web spec (web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx).
 */
class SleepEfficiencyProjectionTest {
    private fun labels(): SleepEfficiencyLabels =
        SleepEfficiencyLabels(
            efficiency = "Efficiency",
            avgDrain = "Avg Drain/Day",
            totalSleep = "Total Sleep",
            hours = "h",
            wakeEvents = "Wake Events",
        )

    private fun snapshot(
        sleepEfficiencyPct: Double = 92.5,
        sentryOffDrainRate: Double = 0.1,
        stateDistribution: List<SleepStateBucket> =
            listOf(
                SleepStateBucket("asleep", 480.0),
                SleepStateBucket("offline", 60.0),
                SleepStateBucket("online", 30.0),
            ),
        recentEventCount: Int = 2,
    ): SleepEfficiencySnapshot =
        SleepEfficiencySnapshot(
            sleepEfficiencyPct = sleepEfficiencyPct,
            sentryOffDrainRate = sentryOffDrainRate,
            stateDistribution = stateDistribution,
            recentEventCount = recentEventCount,
        )

    private fun project(
        snapshot: SleepEfficiencySnapshot,
        compact: Boolean = false,
    ): SleepEfficiencyDisplay = SleepEfficiencyProjection.project(snapshot, labels(), compact, Locale.US)

    // ---- Parse adapter (web SleepEfficiencyData shape) ------------------------------

    @Test
    fun fromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """
                {
                  "sleep_efficiency_pct": 92.5,
                  "sentry_off_drain_rate": 0.1,
                  "time_to_sleep_avg_min": 18,
                  "state_distribution": [
                    {"state": "asleep", "total_minutes": 480},
                    {"state": "offline", "total_minutes": 60},
                    {"state": "online", "total_minutes": 30}
                  ],
                  "recent_events": [{"id": 1}, {"id": 2}, {"id": 3}]
                }
                """.trimIndent(),
            )

        val s = requireNotNull(SleepEfficiencySnapshot.fromJson(json))

        assertEquals(92.5, s.sleepEfficiencyPct, EPS)
        assertEquals(0.1, s.sentryOffDrainRate, EPS)
        assertEquals(3, s.stateDistribution.size)
        assertEquals("asleep", s.stateDistribution[0].state)
        assertEquals(480.0, s.stateDistribution[0].totalMinutes, EPS)
        assertEquals(3, s.recentEventCount)
    }

    @Test
    fun fromJson_defaultsMissingFieldsToZeroAndEmpty() {
        val s = requireNotNull(SleepEfficiencySnapshot.fromJson(Json.parseToJsonElement("{}")))

        assertEquals(0.0, s.sleepEfficiencyPct, EPS)
        assertEquals(0.0, s.sentryOffDrainRate, EPS)
        assertTrue(s.stateDistribution.isEmpty())
        assertEquals(0, s.recentEventCount)
    }

    @Test
    fun fromJson_decodesAllZeroBodyAsContent() {
        // The backend returns an all-zero body when there is no sleep data yet; the web `data ?` gate is
        // truthy so the gauge renders at 0 % rather than the empty state.
        val s =
            requireNotNull(
                SleepEfficiencySnapshot.fromJson(
                    Json.parseToJsonElement(
                        """{"sleep_efficiency_pct":0,"sentry_off_drain_rate":0,"state_distribution":[],"recent_events":[]}""",
                    ),
                ),
            )
        assertEquals(0.0, s.sleepEfficiencyPct, EPS)
        assertEquals(0, s.recentEventCount)
    }

    @Test
    fun fromJson_skipsMalformedStateDistributionEntries() {
        val json =
            Json.parseToJsonElement(
                """
                {"state_distribution": [
                  {"state": "asleep", "total_minutes": 120},
                  {"total_minutes": 60},
                  "garbage",
                  {"state": "drive"}
                ]}
                """.trimIndent(),
            )

        val s = requireNotNull(SleepEfficiencySnapshot.fromJson(json))

        // The entry without a `state` and the non-object element are dropped; the state-only entry keeps
        // a zero `total_minutes` (web `s.total_minutes ?? 0`).
        assertEquals(2, s.stateDistribution.size)
        assertEquals("asleep", s.stateDistribution[0].state)
        assertEquals(120.0, s.stateDistribution[0].totalMinutes, EPS)
        assertEquals("drive", s.stateDistribution[1].state)
        assertEquals(0.0, s.stateDistribution[1].totalMinutes, EPS)
    }

    @Test
    fun fromJson_returnsNullForNonObjectBody() {
        assertNull(SleepEfficiencySnapshot.fromJson(Json.parseToJsonElement("null")))
        assertNull(SleepEfficiencySnapshot.fromJson(Json.parseToJsonElement("[]")))
    }

    // ---- band heuristic (web efficiencyColor) ---------------------------------------

    @Test
    fun bandFor_matchesWebThresholds() {
        assertEquals(EfficiencyBand.Good, SleepEfficiencyProjection.bandFor(100.0))
        assertEquals(EfficiencyBand.Good, SleepEfficiencyProjection.bandFor(95.1))
        // Strictly `> 95` for green: exactly 95 is amber.
        assertEquals(EfficiencyBand.Fair, SleepEfficiencyProjection.bandFor(95.0))
        assertEquals(EfficiencyBand.Fair, SleepEfficiencyProjection.bandFor(85.1))
        // Strictly `> 85` for amber: exactly 85 is red.
        assertEquals(EfficiencyBand.Poor, SleepEfficiencyProjection.bandFor(85.0))
        assertEquals(EfficiencyBand.Poor, SleepEfficiencyProjection.bandFor(0.0))
    }

    // ---- total sleep hours (web sleepMinutes / 60) ----------------------------------

    @Test
    fun totalSleepHours_sumsAsleepAndOfflineOnly() {
        // 480 asleep + 60 offline = 540 minutes; the 30-minute online bucket is ignored.
        assertEquals(9.0, SleepEfficiencyProjection.totalSleepHours(snapshot()), EPS)
    }

    @Test
    fun totalSleepHours_emptyDistributionIsZero() {
        assertEquals(0.0, SleepEfficiencyProjection.totalSleepHours(snapshot(stateDistribution = emptyList())), EPS)
    }

    // ---- projection (web gauge + stats) ---------------------------------------------

    @Test
    fun project_buildsGaugeBandLabelAndDecimals() {
        val view = project(snapshot(sleepEfficiencyPct = 92.5))

        assertEquals(92.5, view.efficiencyValue, EPS)
        assertEquals("Efficiency", view.efficiencyLabel)
        assertEquals("%", view.efficiencyUnit)
        assertEquals(EfficiencyBand.Fair, view.band)
        // A fractional efficiency keeps two decimals (web RadialGauge `getGlobalPrecision()`).
        assertEquals(2, view.efficiencyDecimals)
    }

    @Test
    fun project_wholeEfficiencyUsesZeroDecimals() {
        val view = project(snapshot(sleepEfficiencyPct = 96.0))
        assertEquals(EfficiencyBand.Good, view.band)
        // A whole efficiency drops the fraction (web RadialGauge `Number.isInteger(clamped) ? 0`).
        assertEquals(0, view.efficiencyDecimals)
    }

    @Test
    fun project_buildsThreeStatsInWebOrder() {
        val view = project(snapshot(sentryOffDrainRate = 0.1, recentEventCount = 2))

        assertEquals(3, view.stats.size)
        // Avg Drain/Day = sentry-off %/hr × 24, formatted at two decimals (web `fmtNumber(…, 2)`).
        assertStat(view.stats[0], "avgDrain", "Avg Drain/Day", "2.40", "%")
        // Total Sleep = (480 + 60) / 60 = 9 hours, formatted at zero decimals (web `fmtNumber(…, 0)`).
        assertStat(view.stats[1], "totalSleep", "Total Sleep", "9", "h")
        // Wake Events = recent_events.length, the raw count with no unit (web `{wakeEventsCount}`).
        assertStat(view.stats[2], "wakeEvents", "Wake Events", "2", null)
    }

    @Test
    fun project_compactBlanksLabelAndDropsStats() {
        val view = project(snapshot(sleepEfficiencyPct = 92.5), compact = true)

        // Web `WidgetGaugeHero compact`: the label is blanked and the stat row is hidden, but the gauge
        // value + band still render.
        assertEquals("", view.efficiencyLabel)
        assertTrue(view.stats.isEmpty())
        assertEquals(92.5, view.efficiencyValue, EPS)
        assertEquals(EfficiencyBand.Fair, view.band)
    }

    // ---- registry metadata (web registry/energy.ts) ---------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("sleep-efficiency", SleepEfficiencyRegistration.ID)
        assertEquals("energy", SleepEfficiencyRegistration.CATEGORY)
        assertEquals("SleepEfficiencyWidget", SleepEfficiencyRegistration.SLUG)
        assertEquals(SleepEfficiencySize(cols = 1, rows = 2), SleepEfficiencyRegistration.defaultSize)
        assertEquals(SleepEfficiencySize(cols = 1, rows = 2), SleepEfficiencyRegistration.minSize)
        assertEquals(SleepEfficiencySize(cols = 3, rows = 40), SleepEfficiencyRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(SleepEfficiencyRegistration.withinBounds(SleepEfficiencySize(cols = 1, rows = 2)))
        assertTrue(SleepEfficiencyRegistration.withinBounds(SleepEfficiencySize(cols = 3, rows = 40)))
        assertFalse(SleepEfficiencyRegistration.withinBounds(SleepEfficiencySize(cols = 0, rows = 1)))
        assertFalse(SleepEfficiencyRegistration.withinBounds(SleepEfficiencySize(cols = 4, rows = 50)))
        assertEquals(
            SleepEfficiencySize(cols = 1, rows = 2),
            SleepEfficiencyRegistration.clamp(SleepEfficiencySize(cols = 0, rows = 0)),
        )
        assertEquals(
            SleepEfficiencySize(cols = 3, rows = 40),
            SleepEfficiencyRegistration.clamp(SleepEfficiencySize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun size_isCompactMatchesWeb() {
        // Web `isCompact = size.cols <= 1`.
        assertTrue(SleepEfficiencySize(cols = 1, rows = 2).isCompact)
        assertFalse(SleepEfficiencySize(cols = 2, rows = 2).isCompact)
        assertFalse(SleepEfficiencySize(cols = 3, rows = 4).isCompact)
    }

    // ---- Resource mapper (cache-then-network preservation) --------------------------

    @Test
    fun resourceMapper_parsesPayloadAndPreservesStatus() {
        val json = Json.parseToJsonElement("""{"sleep_efficiency_pct":88,"recent_events":[{"id":1}]}""")

        val cached = Resource.Loading(cached = json, fetchedAt = NOW, stale = true).toSleepEfficiencySnapshot()
        assertTrue(cached is Resource.Loading)
        assertTrue(cached.stale)
        assertEquals(88.0, requireNotNull(cached.cached).sleepEfficiencyPct, EPS)

        val offline =
            Resource.Error(cached = json, fetchedAt = NOW, stale = true, error = ApiError.Network()).toSleepEfficiencySnapshot()
        assertTrue(offline is Resource.Error)
        assertEquals(1, requireNotNull(offline.cached).recentEventCount)
    }

    @Test
    fun resourceMapper_successWithNonObjectBecomesNullSnapshot() {
        val mapped =
            Resource.Success(data = Json.parseToJsonElement("null"), fetchedAt = NOW, stale = false).toSleepEfficiencySnapshot()
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data)
    }

    private fun assertStat(
        stat: SleepEfficiencyStat,
        key: String,
        label: String,
        value: String,
        unit: String?,
    ) {
        assertEquals(key, stat.key)
        assertEquals(label, stat.label)
        assertEquals(value, stat.value)
        assertEquals(unit, stat.unit)
    }

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
    }
}
