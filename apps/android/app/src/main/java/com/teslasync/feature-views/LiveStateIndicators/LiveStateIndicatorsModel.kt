// The pure, framework-free model + projection for the LiveStateIndicators feature view — the native analogue of
// everything the web component derives from its `state` prop before it returns JSX
// (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the vehicle-detail page, which owns the
// `/vehicles/{id}/state` query) passes a non-null `VehicleState`; its only hooks are `useTranslation` (i18n) and
// `useUnits` (the `formatSpeed` helper). It renders a `flex flex-wrap gap-2` row of five status badges — Speed, Lock,
// Sentry, Climate, Charging — each with a leading dot and a semantic variant. This file owns exactly those
// derivations: the slice of the prop it reads ([VehicleStateLive]), the lifecycle projection onto the shared
// cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the five render-ready
// indicators reproducing each web variant + `t()` + `formatSpeed` call exactly, and the PII-safe `view.opened`
// diagnostic (P1/S11).
//
// Parity note: the web reads `state.speed` as SI metres-per-second and renders it through
// `useUnits().formatSpeed(state.speed, { precision: 0 })`. This port threads the same raw value into the shared,
// golden-tested SI [formatSpeed] with the same precision-0 override, so a km/h vs mph user reads identical text on
// both platforms. The `speed > 0` test that tints the Speed badge is reproduced verbatim ([speedActive]).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveStateIndicators — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livestateindicators

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatSpeed
import kotlinx.serialization.json.JsonElement

/** The label/value join the web renders as `${label}: ${value}` (the Speed, Sentry, and Climate badges). */
private const val LABEL_VALUE_SEPARATOR: String = ": "

/**
 * The web `{ precision: 0 }` override handed to `useUnits().formatSpeed` for the Speed badge — forces whole-unit
 * km/h or mph regardless of the user's global decimal-precision setting.
 */
private const val SPEED_PRECISION: Int = 0

/**
 * The slice of the web `state` prop ([VehicleState]) this surface reads — the five live fields the badge row
 * reflects, all nullable for defensive parity with a partially-populated `/vehicles/{id}/state` payload (the Go
 * struct serves them non-null, but a cache miss can leave any absent). [speedMps] is SI metres-per-second, exactly
 * the value the web hands to `formatSpeed`; the four booleans drive their badge's label + variant.
 *
 * @property speedMps current speed in SI metres-per-second (web `state.speed`), or null when unknown.
 * @property isLocked whether the vehicle is locked (web `state.is_locked`), or null when unknown.
 * @property sentryMode whether Sentry mode is armed (web `state.sentry_mode`), or null when unknown.
 * @property isClimateOn whether climate control is running (web `state.is_climate_on`), or null when unknown.
 * @property isCharging whether the vehicle is charging (web `state.is_charging`), or null when unknown.
 */
data class VehicleStateLive(
    val speedMps: Double?,
    val isLocked: Boolean?,
    val sentryMode: Boolean?,
    val isClimateOn: Boolean?,
    val isCharging: Boolean?,
)

/**
 * Stable identity of each badge, in the exact order the web renders them. The view maps each kind onto its rendered
 * Badge; keeping the kind separate from the resolved text + tone keeps this model free of any Android/i18n dependency.
 */
enum class LiveIndicatorKind {
    Speed,
    Lock,
    Sentry,
    Climate,
    Charging,
}

/**
 * The semantic color of a badge — the locale- and Android-independent mirror of the web `variant` prop
 * (`success | neutral | danger | warning | info`). The view maps this onto the shared `BadgeVariant` at the Compose
 * boundary (P1/S9 tokens), keeping this enum free of any color dependency.
 */
enum class LiveIndicatorTone {
    Success,
    Neutral,
    Danger,
    Warning,
    Info,
}

/**
 * One fully projected badge — the native analogue of a single web `<Badge variant dot>{text}</Badge>`. [text] is
 * already localized + formatted and [tone] already resolved, so the composable only lays out a dotted Badge.
 *
 * @property kind the badge identity (its render order + test/preview identity).
 * @property text the localized, formatted badge label (e.g. "Speed: 0 mph", "Locked", "Sentry: Off").
 * @property tone the semantic color, mapped to a shared `BadgeVariant` in the view.
 */
data class LiveIndicator(
    val kind: LiveIndicatorKind,
    val text: String,
    val tone: LiveIndicatorTone,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native binding of the web
 * `useUnits` read. Only the speed unit + locale + precision matter here (the Speed badge is the surface's sole
 * unit-converted value), all carried inside [units] and resolved via [UnitPreferences.fromSettings].
 *
 * @property units the SI → display unit preferences; [UnitPref.speed] selects km/h vs mph and [UnitPref.locale]
 *   drives number grouping.
 */
data class LiveStateDisplayPrefs(
    val units: UnitPref,
) {
    companion object {
        /** The metric / en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: LiveStateDisplayPrefs = from(null)

        /** Resolves the unit preferences from one `/settings` document. */
        fun from(settings: JsonElement?): LiveStateDisplayPrefs = LiveStateDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the render-ready
 * model carries no English literal. Keys map 1:1 to the web `t('common.*')` calls, plus [noData] backing the
 * surface's empty state.
 */
data class LiveStateStrings(
    val speed: String,
    val locked: String,
    val unlocked: String,
    val sentry: String,
    val active: String,
    val off: String,
    val climate: String,
    val on: String,
    val charging: String,
    val notCharging: String,
    val noData: String,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's per-badge variant + label
 * derivations and its single `formatSpeed` conversion. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings + design-token tones and lays out the badges.
 */
object LiveStateIndicatorsProjection {
    /**
     * Maps the web `state` prop onto the shared cache-then-network [UiState] (P1/S8): a present state →
     * [UiPhase.Content] (the badge row, even when every field is null), a missing state → [UiPhase.Empty] (the
     * surface's empty branch). The host's stateful binding can additionally carry loading / refreshing / stale /
     * offline / error; the composable renders those too. This parity adapter only produces the two outcomes the web
     * prop can express.
     */
    fun projectUiState(snapshot: VehicleStateLive?): UiState<VehicleStateLive> =
        if (snapshot != null) {
            UiState(phase = UiPhase.Content, data = snapshot)
        } else {
            UiState(phase = UiPhase.Empty, data = null)
        }

    /**
     * Projects [snapshot] into the five render-ready badges, in web source order, formatting + labeling each via
     * [prefs] / [strings].
     */
    fun indicators(
        snapshot: VehicleStateLive,
        prefs: LiveStateDisplayPrefs,
        strings: LiveStateStrings,
    ): List<LiveIndicator> =
        listOf(
            speedIndicator(snapshot, prefs, strings),
            lockIndicator(snapshot, strings),
            sentryIndicator(snapshot, strings),
            climateIndicator(snapshot, strings),
            chargingIndicator(snapshot, strings),
        )

    /**
     * Speed badge — web variant `state.speed > 0 ? 'success' : 'neutral'`, text `{t('common.speed')}:
     * {formatSpeed(state.speed, { precision: 0 })}`. The raw SI metres-per-second goes straight into the shared
     * [formatSpeed] with the precision-0 override, so the figure matches the web byte-for-byte.
     */
    fun speedIndicator(
        snapshot: VehicleStateLive,
        prefs: LiveStateDisplayPrefs,
        strings: LiveStateStrings,
    ): LiveIndicator {
        val value = formatSpeed(snapshot.speedMps, prefs.units, SPEED_PRECISION)
        val tone = if (speedActive(snapshot.speedMps)) LiveIndicatorTone.Success else LiveIndicatorTone.Neutral
        return LiveIndicator(LiveIndicatorKind.Speed, strings.speed + LABEL_VALUE_SEPARATOR + value, tone)
    }

    /** Web `state.speed > 0` — a null/absent speed is treated as 0 (not moving), so the badge stays neutral. */
    fun speedActive(speedMps: Double?): Boolean = (speedMps ?: 0.0) > 0.0

    /**
     * Lock badge — web variant `state.is_locked ? 'success' : 'danger'`, text the localized "Locked" / "Unlocked".
     * A null lock state reads as unlocked (the danger posture), never silently "locked".
     */
    fun lockIndicator(
        snapshot: VehicleStateLive,
        strings: LiveStateStrings,
    ): LiveIndicator {
        val locked = snapshot.isLocked == true
        val text = if (locked) strings.locked else strings.unlocked
        val tone = if (locked) LiveIndicatorTone.Success else LiveIndicatorTone.Danger
        return LiveIndicator(LiveIndicatorKind.Lock, text, tone)
    }

    /**
     * Sentry badge — web variant `state.sentry_mode ? 'warning' : 'neutral'`, text `{t('common.sentry')}:
     * {state.sentry_mode ? t('common.active') : t('common.off')}`.
     */
    fun sentryIndicator(
        snapshot: VehicleStateLive,
        strings: LiveStateStrings,
    ): LiveIndicator {
        val on = snapshot.sentryMode == true
        val value = if (on) strings.active else strings.off
        val tone = if (on) LiveIndicatorTone.Warning else LiveIndicatorTone.Neutral
        return LiveIndicator(LiveIndicatorKind.Sentry, strings.sentry + LABEL_VALUE_SEPARATOR + value, tone)
    }

    /**
     * Climate badge — web variant `state.is_climate_on ? 'info' : 'neutral'`, text `{t('common.climate')}:
     * {state.is_climate_on ? t('common.on') : t('common.off')}`.
     */
    fun climateIndicator(
        snapshot: VehicleStateLive,
        strings: LiveStateStrings,
    ): LiveIndicator {
        val on = snapshot.isClimateOn == true
        val value = if (on) strings.on else strings.off
        val tone = if (on) LiveIndicatorTone.Info else LiveIndicatorTone.Neutral
        return LiveIndicator(LiveIndicatorKind.Climate, strings.climate + LABEL_VALUE_SEPARATOR + value, tone)
    }

    /**
     * Charging badge — web variant `state.is_charging ? 'warning' : 'neutral'`, text `state.is_charging ?
     * t('common.charging') : t('common.notCharging')`.
     */
    fun chargingIndicator(
        snapshot: VehicleStateLive,
        strings: LiveStateStrings,
    ): LiveIndicator {
        val on = snapshot.isCharging == true
        val text = if (on) strings.charging else strings.notCharging
        val tone = if (on) LiveIndicatorTone.Warning else LiveIndicatorTone.Neutral
        return LiveIndicator(LiveIndicatorKind.Charging, text, tone)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a speed, lock,
 * sentry, climate, or charging value — so a diagnostics line can never leak a vehicle's live posture.
 */
object LiveStateIndicatorsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveStateIndicators"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
