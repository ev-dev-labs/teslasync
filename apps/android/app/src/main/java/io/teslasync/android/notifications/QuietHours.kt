package io.teslasync.android.notifications

/**
 * A local-time daily quiet-hours window during which background system notifications are suppressed
 * (P3/A6). Times are expressed as minutes-of-day (0..1439) so the model is framework-free and fully
 * unit-tested. The window may wrap past midnight (e.g. 22:00–07:00 = 1320..420).
 *
 * Quiet hours only silence the OS notification surface — a foreground in-app banner still shows and a
 * critical breakthrough still rings — so a user is never deprived of a notification, only of the
 * interruption. A zero-length window (start == end) is treated as "never quiet" so a misconfiguration
 * cannot accidentally silence everything.
 */
data class QuietHours(
    val enabled: Boolean,
    val startMinuteOfDay: Int,
    val endMinuteOfDay: Int,
) {
    /** True when [nowMinuteOfDay] (local time-of-day, 0..1439) falls inside the active window. */
    fun isQuiet(nowMinuteOfDay: Int): Boolean {
        if (!enabled || startMinuteOfDay == endMinuteOfDay) return false
        return if (startMinuteOfDay < endMinuteOfDay) {
            nowMinuteOfDay in startMinuteOfDay until endMinuteOfDay
        } else {
            nowMinuteOfDay >= startMinuteOfDay || nowMinuteOfDay < endMinuteOfDay
        }
    }

    companion object {
        /** Quiet hours turned off. */
        val Disabled = QuietHours(enabled = false, startMinuteOfDay = 0, endMinuteOfDay = 0)
    }
}
