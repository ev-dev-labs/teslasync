package io.teslasync.android.components.datadisplay

import kotlin.math.abs

/*
 * Metric semantics + delta math — the Android counterpart of the web lib/metricSemantics and
 * the colour/arrow logic inside Delta. Pure functions so the single source of truth for
 * "is going up good or bad?" runs in the unit-test gate; DataDisplayColors maps the resulting
 * DeltaTone onto theme tokens.
 */

/** Whether a higher value is good, bad, or neither for colouring a delta. */
enum class Direction { HigherBetter, LowerBetter, Neutral }

/** Unit hint used to pick a value suffix/prefix. Display conversion happens at the page layer. */
enum class MetricUnit {
    Currency,
    Percent,
    Distance,
    Energy,
    EnergyWh,
    Efficiency,
    Hours,
    Minutes,
    Count,
    Speed,
    Temperature,
    Pressure,
}

/** A resolved metric semantic: its id, good-direction, and optional unit hint. */
data class MetricSemantic(
    val id: String,
    val direction: Direction,
    val unit: MetricUnit = MetricUnit.Count,
)

/** Registry of common metrics (snake_case ids for parity with backend JSON tags). */
val METRIC_SEMANTICS: Map<String, MetricSemantic> =
    listOf(
        MetricSemantic("cost", Direction.LowerBetter, MetricUnit.Currency),
        MetricSemantic("cost_per_mi", Direction.LowerBetter, MetricUnit.Currency),
        MetricSemantic("energy_consumed", Direction.LowerBetter, MetricUnit.Energy),
        MetricSemantic("energy_per_mi", Direction.LowerBetter, MetricUnit.Efficiency),
        MetricSemantic("range", Direction.HigherBetter, MetricUnit.Distance),
        MetricSemantic("efficiency", Direction.LowerBetter, MetricUnit.Efficiency),
        MetricSemantic("regen_pct", Direction.HigherBetter, MetricUnit.Percent),
        MetricSemantic("drive_score", Direction.HigherBetter, MetricUnit.Count),
        MetricSemantic("vampire_drain", Direction.LowerBetter, MetricUnit.Energy),
        MetricSemantic("idle_time", Direction.LowerBetter, MetricUnit.Hours),
        MetricSemantic("distance", Direction.Neutral, MetricUnit.Distance),
        MetricSemantic("trip_count", Direction.Neutral, MetricUnit.Count),
        MetricSemantic("charging_sessions", Direction.Neutral, MetricUnit.Count),
        MetricSemantic("battery_health_pct", Direction.HigherBetter, MetricUnit.Percent),
        MetricSemantic("speed_avg", Direction.Neutral, MetricUnit.Speed),
        MetricSemantic("temperature", Direction.Neutral, MetricUnit.Temperature),
        MetricSemantic("pressure", Direction.Neutral, MetricUnit.Pressure),
    ).associateBy { it.id }

/** Resolves a metric [id] to its [MetricSemantic]; unknown ids fall back to neutral. */
fun resolveSemantic(id: String): MetricSemantic = METRIC_SEMANTICS[id] ?: MetricSemantic(id, Direction.Neutral)

/** Colour intent for a delta value. */
enum class DeltaTone { Good, Bad, Neutral, Muted }

/** Direction of a delta — drives the arrow glyph. */
enum class DeltaArrow { Up, Down, Flat }

/** Signed change `current - previous`. */
fun signedDelta(
    current: Double,
    previous: Double,
): Double = current - previous

/** Percent change relative to |previous|; `null` when previous is 0 (avoids Infinity%). */
fun percentDelta(
    current: Double,
    previous: Double,
): Double? {
    if (previous == 0.0) return null
    return (current - previous) / abs(previous) * 100.0
}

/**
 * Tone for a [signedDelta] given the metric [direction]. Zero delta is [DeltaTone.Muted];
 * neutral metrics are never coloured good/bad.
 */
fun deltaTone(
    direction: Direction,
    signedDelta: Double,
): DeltaTone =
    when {
        signedDelta == 0.0 -> DeltaTone.Muted
        direction == Direction.Neutral -> DeltaTone.Neutral
        direction == Direction.HigherBetter && signedDelta > 0.0 -> DeltaTone.Good
        direction == Direction.LowerBetter && signedDelta < 0.0 -> DeltaTone.Good
        else -> DeltaTone.Bad
    }

/** Arrow glyph for a [signedDelta]. */
fun deltaArrow(signedDelta: Double): DeltaArrow =
    when {
        signedDelta > 0.0 -> DeltaArrow.Up
        signedDelta < 0.0 -> DeltaArrow.Down
        else -> DeltaArrow.Flat
    }
