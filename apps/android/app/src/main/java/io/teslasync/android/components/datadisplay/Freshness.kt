package io.teslasync.android.components.datadisplay

/*
 * Framework-free freshness + relative-time logic — the Android counterpart of the web
 * FreshnessIndicator, DataFreshness, and LiveIndicator helpers. Kept pure (no Compose,
 * no platform clock) so it runs in the :android:testDebugUnitTest gate and the composables
 * stay a thin render layer.
 *
 * The 2-minute stale window matches the backend cross-pod live-state contract (ADR-013): a
 * cached/live value older than DEFAULT_STALE_SECONDS is surfaced as stale, and one older than
 * DEFAULT_OFFLINE_SECONDS as offline, so the UI never paints stale data as live.
 */

/** Age tier of a single data point. */
enum class FreshnessStatus { Fresh, Stale, Offline, Unknown }

/** Default seconds before a value is considered stale (2 minutes — ADR-013). */
const val DEFAULT_STALE_SECONDS: Long = 120

/** Default seconds before a value is considered offline (10 minutes). */
const val DEFAULT_OFFLINE_SECONDS: Long = 600

/**
 * Coarse, i18n-friendly bucket for a relative age. The composable maps each bucket to a
 * localized string so the pure logic carries no English microcopy.
 */
sealed interface FreshnessAge {
    /** No timestamp available. */
    data object Unknown : FreshnessAge

    /** Younger than 10 seconds — held stable as "just now". */
    data object JustNow : FreshnessAge

    data class Seconds(
        val value: Long,
    ) : FreshnessAge

    data class Minutes(
        val value: Long,
    ) : FreshnessAge

    data class Hours(
        val value: Long,
    ) : FreshnessAge

    data class Days(
        val value: Long,
    ) : FreshnessAge

    data class Weeks(
        val value: Long,
    ) : FreshnessAge
}

/** Seconds between [timestampMillis] and [nowMillis], floored at 0; `null` when no timestamp. */
fun computeAgeSeconds(
    timestampMillis: Long?,
    nowMillis: Long,
): Long? {
    if (timestampMillis == null) return null
    val deltaMs = nowMillis - timestampMillis
    return if (deltaMs <= 0L) 0L else deltaMs / 1000L
}

/** Classifies an [ageSeconds] into fresh / stale / offline / unknown. */
fun freshnessStatus(
    ageSeconds: Long?,
    staleThreshold: Long = DEFAULT_STALE_SECONDS,
    offlineThreshold: Long = DEFAULT_OFFLINE_SECONDS,
): FreshnessStatus {
    if (ageSeconds == null) return FreshnessStatus.Unknown
    return when {
        ageSeconds < staleThreshold -> FreshnessStatus.Fresh
        ageSeconds < offlineThreshold -> FreshnessStatus.Stale
        else -> FreshnessStatus.Offline
    }
}

/** True when [ageSeconds] is at or beyond the stale window. */
fun isStale(
    ageSeconds: Long?,
    staleThreshold: Long = DEFAULT_STALE_SECONDS,
): Boolean = ageSeconds != null && ageSeconds >= staleThreshold

/** True when [ageSeconds] is at or beyond the offline window. */
fun isOffline(
    ageSeconds: Long?,
    offlineThreshold: Long = DEFAULT_OFFLINE_SECONDS,
): Boolean = ageSeconds != null && ageSeconds >= offlineThreshold

/**
 * Buckets a per-datum [ageSeconds] (matches the web `FreshnessIndicator.formatAge` cutoffs:
 * <10s just-now, <60s seconds, <1h minutes, else hours).
 */
fun freshnessAge(ageSeconds: Long?): FreshnessAge {
    if (ageSeconds == null) return FreshnessAge.Unknown
    return when {
        ageSeconds < SECONDS_JUST_NOW -> FreshnessAge.JustNow
        ageSeconds < SECONDS_PER_MINUTE -> FreshnessAge.Seconds(ageSeconds)
        ageSeconds < SECONDS_PER_HOUR -> FreshnessAge.Minutes(ageSeconds / SECONDS_PER_MINUTE)
        else -> FreshnessAge.Hours(ageSeconds / SECONDS_PER_HOUR)
    }
}

/**
 * Buckets a query-result [ageSeconds] with day/week fall-through (matches the web
 * `DataFreshness.formatRelativeTime`), used by header freshness chips on long-lived caggs.
 */
fun relativeAge(ageSeconds: Long?): FreshnessAge {
    if (ageSeconds == null) return FreshnessAge.Unknown
    return when {
        ageSeconds < SECONDS_PER_MINUTE -> FreshnessAge.JustNow
        ageSeconds < SECONDS_PER_HOUR -> FreshnessAge.Minutes(ageSeconds / SECONDS_PER_MINUTE)
        ageSeconds < SECONDS_PER_DAY -> FreshnessAge.Hours(ageSeconds / SECONDS_PER_HOUR)
        ageSeconds < SECONDS_PER_WEEK -> FreshnessAge.Days(ageSeconds / SECONDS_PER_DAY)
        else -> FreshnessAge.Weeks(ageSeconds / SECONDS_PER_WEEK)
    }
}

/**
 * Default English rendering of a [FreshnessAge]. Composables accept this as the default
 * formatter and pages can substitute a localized one (ADR-014).
 */
fun formatFreshnessAge(age: FreshnessAge): String =
    when (age) {
        FreshnessAge.Unknown -> EM_DASH
        FreshnessAge.JustNow -> "just now"
        is FreshnessAge.Seconds -> "${age.value}s ago"
        is FreshnessAge.Minutes -> "${age.value}m ago"
        is FreshnessAge.Hours -> "${age.value}h ago"
        is FreshnessAge.Days -> "${age.value}d ago"
        is FreshnessAge.Weeks -> "${age.value}w ago"
    }

/** Health of the live-data transport, mapped from a TanStack-style query result. */
enum class QueryFreshness { Fresh, Fetching, Stale, Error }

/** Derives the query freshness tier (error > fetching > stale > fresh, matching the web). */
fun queryFreshness(
    isError: Boolean,
    isFetching: Boolean,
    isStale: Boolean,
): QueryFreshness =
    when {
        isError -> QueryFreshness.Error
        isFetching -> QueryFreshness.Fetching
        isStale -> QueryFreshness.Stale
        else -> QueryFreshness.Fresh
    }

/** Health of the realtime connection (SSE/MQTT), surfaced by `LiveIndicator`. */
enum class LiveConnectionStatus { Connected, Reconnecting, Disconnected, Unknown }

private const val EM_DASH = "\u2014"
private const val SECONDS_JUST_NOW = 10L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3_600L
private const val SECONDS_PER_DAY = 86_400L
private const val SECONDS_PER_WEEK = 604_800L
