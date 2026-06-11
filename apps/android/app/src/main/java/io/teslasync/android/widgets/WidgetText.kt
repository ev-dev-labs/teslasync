package io.teslasync.android.widgets

import android.content.Context
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.FreshnessAge

/**
 * Maps the pure widget models to localized strings (P3/A8, ADR-014). Kept out of the Glance
 * composables so the microcopy is centralized and the composables stay thin; every string is a
 * resource lookup, so the widgets honor the app locale (and the RTL ar/he fallbacks).
 */
object WidgetText {
    /** "Updated 5m ago" / "Updated just now" / em-dash — the freshness chip text for [freshness]. */
    fun freshnessLabel(
        context: Context,
        freshness: WidgetFreshness,
    ): String =
        when (val age = freshness.age) {
            FreshnessAge.Unknown -> context.getString(R.string.widget_freshness_unknown)
            FreshnessAge.JustNow -> context.getString(R.string.widget_freshness_just_now)
            is FreshnessAge.Seconds -> context.getString(R.string.widget_freshness_just_now)
            is FreshnessAge.Minutes -> context.getString(R.string.widget_freshness_minutes, age.value.toInt())
            is FreshnessAge.Hours -> context.getString(R.string.widget_freshness_hours, age.value.toInt())
            is FreshnessAge.Days -> context.getString(R.string.widget_freshness_days, age.value.toInt())
            is FreshnessAge.Weeks -> context.getString(R.string.widget_freshness_weeks, age.value.toInt())
        }

    /** The localized lifecycle label ("Charging", "Parked", …) for a vehicle [state]. */
    fun fsmStateLabel(
        context: Context,
        state: VehicleFsmState,
    ): String =
        context.getString(
            when (state) {
                VehicleFsmState.Driving -> R.string.widget_vehicle_state_driving
                VehicleFsmState.Charging -> R.string.widget_vehicle_state_charging
                VehicleFsmState.Parked -> R.string.widget_vehicle_state_parked
                VehicleFsmState.Asleep -> R.string.widget_vehicle_state_asleep
                VehicleFsmState.Online -> R.string.widget_vehicle_state_online
                VehicleFsmState.Offline -> R.string.widget_vehicle_state_offline
                VehicleFsmState.Unknown -> R.string.widget_vehicle_state_unknown
            },
        )

    /** The centered body message for a non-content [state] (loading / empty / error), or null. */
    fun bodyMessage(
        context: Context,
        state: WidgetRenderState,
        emptyMessage: String,
    ): String? =
        when (state) {
            WidgetRenderState.Loading -> context.getString(R.string.widget_state_loading)
            WidgetRenderState.Empty -> emptyMessage
            WidgetRenderState.Error -> context.getString(R.string.widget_state_error)
            WidgetRenderState.Content, WidgetRenderState.Stale, WidgetRenderState.Offline -> null
        }

    /** The short banner text for a non-content [state] (offline / stale / error), or null. */
    fun stateBannerText(
        context: Context,
        state: WidgetRenderState,
    ): String? =
        when (state) {
            WidgetRenderState.Offline -> context.getString(R.string.widget_banner_offline)
            WidgetRenderState.Stale -> context.getString(R.string.widget_banner_stale)
            WidgetRenderState.Error -> context.getString(R.string.widget_banner_error)
            WidgetRenderState.Loading, WidgetRenderState.Content, WidgetRenderState.Empty -> null
        }
}
