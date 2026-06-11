package io.teslasync.android.widgets

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.FreshnessStatus
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.freshnessStatus
import io.teslasync.android.components.datadisplay.relativeAge

/**
 * The freshness of a widget's cached value — the "last updated / stale" surface (P3/A8, ADR-013).
 * Pure data so the Glance layer only maps it to localized text and color; the 2-minute stale window
 * is the shared backend cross-pod contract reused from the A2 data-display freshness helpers (DRY).
 *
 * @property fetchedAtMillis the cached value's `fetched_at` stamp, or `null` when nothing is cached.
 * @property ageSeconds seconds since [fetchedAtMillis] (floored at 0), or `null` when no stamp.
 * @property status the fresh / stale / offline / unknown tier of [ageSeconds].
 * @property age the coarse, i18n-friendly relative-age bucket for the "updated X ago" label.
 */
data class WidgetFreshness(
    val fetchedAtMillis: Long?,
    val ageSeconds: Long?,
    val status: FreshnessStatus,
    val age: FreshnessAge,
) {
    /** True once the value is at/over the stale window (drives the stale chip + offline labelling). */
    val isStale: Boolean get() = status == FreshnessStatus.Stale || status == FreshnessStatus.Offline

    companion object {
        /** Freshness with no timestamp (cold widget / no cache). */
        val Unknown: WidgetFreshness =
            WidgetFreshness(
                fetchedAtMillis = null,
                ageSeconds = null,
                status = FreshnessStatus.Unknown,
                age = FreshnessAge.Unknown,
            )

        /**
         * Builds the freshness of a value stamped [fetchedAtMillis], measured against [nowMillis],
         * reusing the shared age / stale-tier helpers so the widget and the in-app pages agree.
         */
        fun of(
            fetchedAtMillis: Long?,
            nowMillis: Long,
        ): WidgetFreshness {
            val ageSeconds = computeAgeSeconds(fetchedAtMillis, nowMillis)
            return WidgetFreshness(
                fetchedAtMillis = fetchedAtMillis,
                ageSeconds = ageSeconds,
                status = freshnessStatus(ageSeconds),
                age = relativeAge(ageSeconds),
            )
        }
    }
}
