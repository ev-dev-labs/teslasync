// Pure, framework-free model + projection for the PresetGallery feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/automations/pages/PresetGallery.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component renders a card grid of automation preset templates. Each card derives, from one
// `AutomationPreset`, four things: the icon glyph (web `iconMap[preset.icon] ?? Shield`), the first
// trigger's label (web `preset.triggers[0]` -> `triggerLabels[kind]`, or "No trigger configured" when
// there is no trigger), the action count (web `preset.actions.length`), and the install target (web
// `navigate(`/automations/new?preset=${preset.id}`)`). The list-level empty guard is web
// `presetList.length === 0`. This file owns exactly those derivations as a vendor-neutral projection:
// the raw icon string -> [PresetIconKind] (fallback [PresetIconKind.Shield]), the first raw trigger
// kind -> [PresetTriggerKind] (no/unknown trigger -> [PresetTriggerKind.None]), the preserved id/name/
// description, the clamped action count, and the [PresetGalleryProjectionResult.isEmpty] flag. Colors,
// glyphs and the localized labels are resolved at the Compose boundary, never here, so the model carries
// only vendor-neutral kinds.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PresetGallery — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.presetgallery

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object PresetGalleryRegistration {
    /** Stable surface id. */
    const val ID: String = "preset-gallery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PresetGallery"
}

/**
 * The semantic classification of a preset's first trigger — the vendor-neutral mapping of the raw
 * automation step kind (web `AutomationTriggerKind`: `trigger_schedule` / `trigger_event` /
 * `trigger_geofence` / `trigger_signal`). The render layer maps this to a localized label; [None] is
 * the catch-all for "no trigger configured" (web `firstTrigger ? … : noTrigger`) and for any
 * unrecognized kind (web `triggerLabels[kind]` returning `undefined`, which also falls back to the
 * no-trigger label).
 */
enum class PresetTriggerKind {
    Schedule,
    Event,
    Geofence,
    Signal,
    None,
    ;

    companion object {
        /**
         * Classifies the first trigger's [rawKind] exactly like the web `triggerLabels` lookup: a `null`
         * kind (no trigger present) or an unknown key resolves to [None]; the four known keys map to
         * their kind. Case/space tolerant so a backend variant never silently drops to [None].
         */
        fun from(rawKind: String?): PresetTriggerKind =
            when (rawKind?.trim()?.lowercase(Locale.ROOT)) {
                "trigger_schedule" -> Schedule
                "trigger_event" -> Event
                "trigger_geofence" -> Geofence
                "trigger_signal" -> Signal
                else -> None
            }
    }
}

/**
 * The icon glyph a preset card shows — the vendor-neutral mapping of the raw `preset.icon` string the
 * backend supplies. Mirrors the web `iconMap` keys; any unknown icon falls back to [Shield] (web
 * `iconMap[preset.icon] ?? Shield`). The render layer resolves each kind to an authored vector glyph.
 */
enum class PresetIconKind {
    Shield,
    Moon,
    Sun,
    ShieldCheck,
    Lock,
    UserX,
    CarFront,
    Siren,
    ;

    companion object {
        /** Maps the raw `preset.icon` to a kind, falling back to [Shield] (web `?? Shield`). */
        fun from(rawIcon: String?): PresetIconKind =
            when (rawIcon) {
                "Moon" -> Moon
                "Sun" -> Sun
                "ShieldCheck" -> ShieldCheck
                "Lock" -> Lock
                "UserX" -> UserX
                "CarFront" -> CarFront
                "Siren" -> Siren
                else -> Shield
            }
    }
}

/**
 * The native mirror of the slice of a web `AutomationPreset` a card reads. The host's shared P1/S8
 * state-holder adapts the `/automations/presets` response into these (the view performs no HTTP):
 * [id] (the install target's preset id, web `preset.id`), [name], [description], the raw [icon] string,
 * the ordered [triggerKinds] (so the projection can take the first, web `preset.triggers[0]`), and the
 * [actionCount] (web `preset.actions.length`).
 */
data class AutomationPresetData(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
    val triggerKinds: List<String>,
    val actionCount: Int,
)

/**
 * A fully projected, render-ready card — the native analogue of the props one web `PresetCard` reads.
 * Pure data (no Compose types): the composable resolves [icon] to a vector glyph + token color, maps
 * [triggerKind] to a localized label, formats [actionCount], and wires the install action to [id].
 */
data class PresetCardProjection(
    val id: String,
    val name: String,
    val description: String,
    val icon: PresetIconKind,
    val triggerKind: PresetTriggerKind,
    val actionCount: Int,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component
 * reads from `presetList`. [cards] preserves the received order; [isEmpty] drives the empty branch (web
 * `presetList.length === 0`).
 */
data class PresetGalleryProjectionResult(
    val cards: List<PresetCardProjection>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-preset
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object PresetGalleryProjection {
    /**
     * Projects [presets] into render-ready cards, preserving the received order (the web map order).
     * Each preset contributes one [PresetCardProjection] with its classified icon + first-trigger kind
     * and a non-negative [PresetCardProjection.actionCount]; [PresetGalleryProjectionResult.isEmpty] is
     * `true` when there are no presets (web `presetList.length === 0`).
     */
    fun project(presets: List<AutomationPresetData>): PresetGalleryProjectionResult {
        val cards =
            presets.map { preset ->
                PresetCardProjection(
                    id = preset.id,
                    name = preset.name,
                    description = preset.description,
                    icon = PresetIconKind.from(preset.icon),
                    triggerKind = PresetTriggerKind.from(preset.triggerKinds.firstOrNull()),
                    actionCount = preset.actionCount.coerceAtLeast(0),
                )
            }
        return PresetGalleryProjectionResult(cards = cards, isEmpty = cards.isEmpty())
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PresetGalleryRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls
 * it from its first-composition effect.
 */
fun recordPresetGalleryOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PresetGalleryRegistration.SLUG))
}
