// Off-device unit coverage for the Security Event Timeline feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the timeline projection (the web `deriveTimeline` consumer +
// `useTimelineLabels` analogue), the per-event title/subtitle selection across every kind × variant, the
// semantic glyph + accent classification (web `timelineIcon` + JSX marker color), the tolerant timestamp
// formatter (web `TimeStamp`), the top-level lifecycle classifier the composable switches on (per-state
// coverage incl. stale/offline), and the i18n key mirrors (a11y/label coverage). No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventtimeline

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

class EventTimelineModelTest {
    // Sentinel strings — each field carries its own name so a projection assertion is unambiguous about
    // which branch of useTimelineLabels was taken.
    private val strings =
        EventTimelineStrings(
            title = "title",
            noEvents = "noEvents",
            lockPositive = "lockPositive",
            lockPositiveDesc = "lockPositiveDesc",
            lockNegative = "lockNegative",
            lockNegativeDesc = "lockNegativeDesc",
            sentryPositive = "sentryPositive",
            sentryPositiveDesc = "sentryPositiveDesc",
            sentryNegative = "sentryNegative",
            sentryNegativeDesc = "sentryNegativeDesc",
            doorPositive = "doorPositive",
            doorNegative = "doorNegative",
        )

    /** Deterministic timestamp formatter standing in for the localized java.time one. */
    private val formatTime: (String) -> String = { iso -> "T:$iso" }

    private fun event(
        id: String = "e1",
        kind: TimelineEventKind = TimelineEventKind.Lock,
        variant: TimelineEventVariant = TimelineEventVariant.Positive,
        detail: String = "",
        timestamp: String = "2026-06-11T14:30:00Z",
    ) = TimelineEvent(id = id, kind = kind, variant = variant, detail = detail, timestamp = timestamp)

    private fun labels(event: TimelineEvent): EventTimelineLabels = EventTimelineProjection.labelsFor(event, strings)

    private fun glyph(
        kind: TimelineEventKind,
        variant: TimelineEventVariant,
    ): EventTimelineGlyph = EventTimelineProjection.glyphFor(kind, variant)

    // ── raw enum mapping (web string-union parsing) ──

    @Test
    fun kindFromRawMatchesWebUnionAndFoldsUnknown() {
        assertEquals(TimelineEventKind.Lock, TimelineEventKind.fromRaw("lock"))
        assertEquals(TimelineEventKind.Sentry, TimelineEventKind.fromRaw("SENTRY"))
        assertEquals(TimelineEventKind.Door, TimelineEventKind.fromRaw(" door "))
        assertEquals(TimelineEventKind.Lock, TimelineEventKind.fromRaw("mystery"))
    }

    @Test
    fun variantFromRawMatchesWebUnionAndFoldsUnknownToNeutral() {
        assertEquals(TimelineEventVariant.Positive, TimelineEventVariant.fromRaw("positive"))
        assertEquals(TimelineEventVariant.Negative, TimelineEventVariant.fromRaw("NEGATIVE"))
        assertEquals(TimelineEventVariant.Neutral, TimelineEventVariant.fromRaw("neutral"))
        assertEquals(TimelineEventVariant.Neutral, TimelineEventVariant.fromRaw("???"))
    }

    // ── labelsFor — the useTimelineLabels switch (title + subtitle per kind × variant) ──

    @Test
    fun lockLabelsPickPositiveElseNegativeCopy() {
        val pos = labels(event(kind = TimelineEventKind.Lock, variant = TimelineEventVariant.Positive))
        assertEquals(EventTimelineLabels("lockPositive", "lockPositiveDesc"), pos)
        val neg = labels(event(kind = TimelineEventKind.Lock, variant = TimelineEventVariant.Negative))
        assertEquals(EventTimelineLabels("lockNegative", "lockNegativeDesc"), neg)
    }

    @Test
    fun sentryLabelsPickPositiveElseNegativeCopy() {
        val pos = labels(event(kind = TimelineEventKind.Sentry, variant = TimelineEventVariant.Positive))
        assertEquals(EventTimelineLabels("sentryPositive", "sentryPositiveDesc"), pos)
        val neg = labels(event(kind = TimelineEventKind.Sentry, variant = TimelineEventVariant.Negative))
        assertEquals(EventTimelineLabels("sentryNegative", "sentryNegativeDesc"), neg)
    }

    @Test
    fun doorLabelTitleByVariantWithDetailSubtitle() {
        val pos =
            EventTimelineProjection.labelsFor(
                event(kind = TimelineEventKind.Door, variant = TimelineEventVariant.Positive, detail = "Front Left"),
                strings,
            )
        assertEquals(EventTimelineLabels("doorPositive", "Front Left"), pos)
        val neg =
            EventTimelineProjection.labelsFor(
                event(kind = TimelineEventKind.Door, variant = TimelineEventVariant.Negative, detail = "Rear Right"),
                strings,
            )
        assertEquals(EventTimelineLabels("doorNegative", "Rear Right"), neg)
    }

    @Test
    fun neutralVariantTakesTheNegativeLabelBranchLikeTheWebTernary() {
        // Web `ev.variant === 'positive' ? … : …` — neutral is not positive, so it takes the else (negative) copy.
        val lock = labels(event(kind = TimelineEventKind.Lock, variant = TimelineEventVariant.Neutral))
        assertEquals(EventTimelineLabels("lockNegative", "lockNegativeDesc"), lock)
        val sentry = labels(event(kind = TimelineEventKind.Sentry, variant = TimelineEventVariant.Neutral))
        assertEquals(EventTimelineLabels("sentryNegative", "sentryNegativeDesc"), sentry)
    }

    // ── glyphFor — the timelineIcon switch ──

    @Test
    fun glyphForMirrorsTheWebTimelineIconSwitch() {
        assertEquals(EventTimelineGlyph.Lock, glyph(TimelineEventKind.Lock, TimelineEventVariant.Positive))
        assertEquals(EventTimelineGlyph.Unlock, glyph(TimelineEventKind.Lock, TimelineEventVariant.Negative))
        assertEquals(EventTimelineGlyph.ShieldCheck, glyph(TimelineEventKind.Sentry, TimelineEventVariant.Positive))
        assertEquals(EventTimelineGlyph.ShieldAlert, glyph(TimelineEventKind.Sentry, TimelineEventVariant.Negative))
        assertEquals(EventTimelineGlyph.DoorClosed, glyph(TimelineEventKind.Door, TimelineEventVariant.Positive))
        assertEquals(EventTimelineGlyph.DoorOpen, glyph(TimelineEventKind.Door, TimelineEventVariant.Negative))
        // Neutral falls to the cautionary glyph (web ternary else-branch).
        assertEquals(EventTimelineGlyph.Unlock, glyph(TimelineEventKind.Lock, TimelineEventVariant.Neutral))
        assertEquals(EventTimelineGlyph.DoorOpen, glyph(TimelineEventKind.Door, TimelineEventVariant.Neutral))
    }

    @Test
    fun accentForMapsTheThreeWayMarkerColor() {
        assertEquals(TimelineAccentRole.Success, EventTimelineProjection.accentFor(TimelineEventVariant.Positive))
        assertEquals(TimelineAccentRole.Danger, EventTimelineProjection.accentFor(TimelineEventVariant.Negative))
        assertEquals(TimelineAccentRole.Muted, EventTimelineProjection.accentFor(TimelineEventVariant.Neutral))
    }

    // ── project — the adapter (cached events → render-ready rows) ──

    @Test
    fun projectMapsEventsToRowsPreservingOrder() {
        val events =
            listOf(
                event(
                    id = "a",
                    kind = TimelineEventKind.Sentry,
                    variant = TimelineEventVariant.Positive,
                    timestamp = "2026-01-01T00:00:00Z",
                ),
                event(
                    id = "b",
                    kind = TimelineEventKind.Door,
                    variant = TimelineEventVariant.Negative,
                    detail = "Trunk",
                    timestamp = "2025-12-31T00:00:00Z",
                ),
            )
        val rows = EventTimelineProjection.project(events, strings, formatTime)
        assertEquals(2, rows.size)
        assertEquals(listOf("a", "b"), rows.map { it.id })
        assertEquals(
            EventTimelineRow(
                id = "a",
                title = "sentryPositive",
                subtitle = "sentryPositiveDesc",
                time = "T:2026-01-01T00:00:00Z",
                glyph = EventTimelineGlyph.ShieldCheck,
                accent = TimelineAccentRole.Success,
            ),
            rows[0],
        )
        assertEquals(
            EventTimelineRow(
                id = "b",
                title = "doorNegative",
                subtitle = "Trunk",
                time = "T:2025-12-31T00:00:00Z",
                glyph = EventTimelineGlyph.DoorOpen,
                accent = TimelineAccentRole.Danger,
            ),
            rows[1],
        )
    }

    @Test
    fun projectTreatsNullAndEmptyAsTheEmptyState() {
        assertTrue(EventTimelineProjection.project(null, strings, formatTime).isEmpty())
        assertTrue(EventTimelineProjection.project(emptyList(), strings, formatTime).isEmpty())
    }

    @Test
    fun projectBlanksAnEmptyDoorDetailSubtitleToNull() {
        val rows =
            EventTimelineProjection.project(
                listOf(event(kind = TimelineEventKind.Door, variant = TimelineEventVariant.Positive, detail = "")),
                strings,
                formatTime,
            )
        assertNull(rows.single().subtitle)
    }

    // ── per-state lifecycle classifier ──

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(EventTimelineSurface.Loading, eventTimelineSurfaceFor(isLoading = true, isError = false))
        assertEquals(EventTimelineSurface.Error, eventTimelineSurfaceFor(isLoading = false, isError = true))
        // Loading wins over error so a refresh-with-skeleton never flashes the error surface.
        assertEquals(EventTimelineSurface.Loading, eventTimelineSurfaceFor(isLoading = true, isError = true))
        assertEquals(EventTimelineSurface.Ready, eventTimelineSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(EventTimelineSurface.Loading, surfaceFor(UiState.loading<List<TimelineEvent>>()))
        val error = UiState<List<TimelineEvent>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(EventTimelineSurface.Error, surfaceFor(error))
        assertEquals(EventTimelineSurface.Ready, surfaceFor(UiState(UiPhase.Content, data = listOf(event()))))
        assertEquals(EventTimelineSurface.Ready, surfaceFor(UiState(UiPhase.Empty, data = emptyList<TimelineEvent>())))
        // Stale/offline "last known" stays on the Ready surface (cached rows + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = listOf(event()),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(EventTimelineSurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── timestamp formatting (web TimeStamp) ──

    @Test
    fun timeFormattingIsTolerantAndGuardsInvalidInput() {
        val zone = ZoneId.of("UTC")
        val locale = Locale.US
        // A valid RFC-3339 instant formats to a non-empty localized string carrying the year.
        val formatted = EventTimeFormatting.format("2026-06-11T14:30:00Z", zone, locale)
        assertNotEquals(EM_DASH, formatted)
        assertTrue("expected the year in '$formatted'", formatted.contains("2026"))
        // A zoneless local date-time is tolerated (treated as UTC).
        assertNotEquals(EM_DASH, EventTimeFormatting.format("2026-06-11T14:30:00", zone, locale))
        // Blank / unparseable inputs fall back to the em dash, like the web invalid-date guard.
        assertEquals(EM_DASH, EventTimeFormatting.format("", zone, locale))
        assertEquals(EM_DASH, EventTimeFormatting.format("   ", zone, locale))
        assertEquals(EM_DASH, EventTimeFormatting.format("not-a-date", zone, locale))
    }

    // ── a11y / i18n key mirrors (every web `t('admin.security.timeline.*')` key) ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_admin_security_timeline_title", KEY_TITLE)
        assertEquals("translation_admin_security_timeline_noEvents", KEY_NO_EVENTS)
        assertEquals("translation_admin_security_timeline_lock_positive", KEY_LOCK_POSITIVE)
        assertEquals("translation_admin_security_timeline_lock_positiveDesc", KEY_LOCK_POSITIVE_DESC)
        assertEquals("translation_admin_security_timeline_lock_negative", KEY_LOCK_NEGATIVE)
        assertEquals("translation_admin_security_timeline_lock_negativeDesc", KEY_LOCK_NEGATIVE_DESC)
        assertEquals("translation_admin_security_timeline_sentry_positive", KEY_SENTRY_POSITIVE)
        assertEquals("translation_admin_security_timeline_sentry_positiveDesc", KEY_SENTRY_POSITIVE_DESC)
        assertEquals("translation_admin_security_timeline_sentry_negative", KEY_SENTRY_NEGATIVE)
        assertEquals("translation_admin_security_timeline_sentry_negativeDesc", KEY_SENTRY_NEGATIVE_DESC)
        assertEquals("translation_admin_security_timeline_door_positive", KEY_DOOR_POSITIVE)
        assertEquals("translation_admin_security_timeline_door_negative", KEY_DOOR_NEGATIVE)
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("EventTimeline", EventTimelineRegistration.SLUG)
        assertEquals("event-timeline", EventTimelineRegistration.ID)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `EventTimelineContent` does. */
    private fun surfaceFor(state: UiState<*>): EventTimelineSurface =
        eventTimelineSurfaceFor(isLoading = state.isLoading, isError = state.isError)

    private fun assertNotEquals(
        unexpected: String,
        actual: String,
    ) = assertFalse("expected not to equal '$unexpected'", unexpected == actual)
}
