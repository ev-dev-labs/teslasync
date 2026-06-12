// Pure, framework-free model + projection + registry + diagnostics for the AIRestorePanel feature view — the
// native analogue of everything web/src/features/settings/components/AIRestorePanel.tsx derives before
// returning JSX. No Compose, no Android, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate (P3 acceptance: adapter + per-state + a11y label tests), keeping the
// composable a thin render layer.
//
// AIRestorePanel is the "restore previous Helix selection" prompt on the AI settings page. The web component
// is presentational and host-controlled: given the `archived` snapshot (a `Record<string, boolean>` keyed by
// AI feature id) plus `onConfirm` / `onDecline` callbacks, it renders a purple alert region with a Sparkles
// icon, a localized title + description, an optional bulleted preview of the archived feature names, and the
// Decline / Restore buttons. Its only genuine hook is `useTranslation('settings')` → the P1/S10 i18n facade
// (`stringResource`). The `archived` payload is owned by the host AI-settings page (the web parent's settings
// query, P1/S8) and handed in as a prop — the surface never performs HTTP, exactly as the web component does
// not. The parent gate ("surfaced ONLY when mode != off, archived non-empty, and not declined this session",
// web doc comment §ADR-015 I7) is modeled here as the pure [shouldRender] projection a host observes, never
// re-read inside the presentational surface.
//
// The label preview is the web `previewLabels(archived, t)`: for every archived feature whose value is true it
// resolves a known feature's localized label (web `t('ai.settings.feature.<id>.label', AI_FEATURES[id].name)`)
// or, for an id not in the registry (a feature removed between archive and restore), falls back to the raw id
// so the listing is never blank. The web `@/ai/features` registry (`AI_FEATURES` + `isKnownAiFeature`,
// generated from internal/ai/features/registry.go) is mirrored by [AiFeatureRegistry] — the same 57 ids with
// their `.name` defaults — so the known/unknown branch and the `t(key, default)` fallback behave identically.
//
// The surface binds no network feed, so there is no real loading/error/stale/offline fetch lifecycle. The
// [AIRestoreSurfaceState] classifier still maps the shared P1/S8 lifecycle the feature-view contract can carry
// — Prompt is this surface's natural, default presentation, while Loading/Error are honest lifecycle chrome a
// host may supply, never faked from a fetch the surface does not perform — mirroring the sibling
// NoVehicleSelected port.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/AIRestorePanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package identifier (a hyphen and a PascalCase segment are illegal), so the package intentionally diverges
// from the path — exactly as the sibling NoVehicleSelected / EfficiencyPanel surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.airestorepanel

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AIRestorePanelRegistration {
    /** Stable surface id — the web `data-testid="ai-restore-panel"`. */
    const val ID: String = "ai-restore-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIRestorePanel"
}

/**
 * The web `t(key, default)` fallback strings for the four archive keys the component supplies inline. These
 * keys exist in the generated i18n catalog (`translation_ai_settings_archive_*`), so the composable shows the
 * localized `stringResource`; the values below are the English source strings reproduced for the off-device
 * contract test (mirroring the sibling NoVehicleSelected defaults).
 */
object AIRestorePanelDefaults {
    /** Web `t('ai.settings.archive.title', 'Restore previous Helix selection?')`. */
    const val TITLE: String = "Restore previous Helix selection?"

    /** Web `t('ai.settings.archive.description', 'You previously had these features enabled. Re-enable them now?')`. */
    const val DESCRIPTION: String = "You previously had these features enabled. Re-enable them now?"

    /** Web `t('ai.settings.archive.decline', 'No thanks')`. */
    const val DECLINE: String = "No thanks"

    /** Web `t('ai.settings.archive.restore', 'Restore selection')`. */
    const val RESTORE: String = "Restore selection"
}

/** Android resource name for the web `ai.settings.archive.title` key (catalog presence asserted in tests). */
const val KEY_TITLE: String = "translation_ai_settings_archive_title"

/** Android resource name for the web `ai.settings.archive.description` key. */
const val KEY_DESCRIPTION: String = "translation_ai_settings_archive_description"

/** Android resource name for the web `ai.settings.archive.decline` key. */
const val KEY_DECLINE: String = "translation_ai_settings_archive_decline"

/** Android resource name for the web `ai.settings.archive.restore` key. */
const val KEY_RESTORE: String = "translation_ai_settings_archive_restore"

/**
 * The native mirror of the web `@/ai/features` module (`AI_FEATURES` + `isKnownAiFeature`), generated from
 * `internal/ai/features/registry.go`. Carries the same 57 feature ids with the `.name` default the web uses as
 * the `t(key, default)` fallback, so [previewLabels] reproduces the known/unknown branch and the fallback
 * exactly. A drift test asserts the id set + count against the web source.
 */
object AiFeatureRegistry {
    /** Resource-name prefix for a per-feature label (web key path `ai.settings.feature.` → `translation_…`). */
    const val FEATURE_LABEL_PREFIX: String = "translation_ai_settings_feature_"

    /** Resource-name suffix for a per-feature label (web key path `.label`). */
    const val FEATURE_LABEL_SUFFIX: String = "_label"

    /**
     * Every known feature id → its registry `name` (the web `AI_FEATURES[id].name`, the `t(key, default)`
     * fallback). Mirrors the frozen `AI_FEATURES` object 1:1.
     */
    val FALLBACK_LABELS: Map<String, String> =
        mapOf(
            "__redaction_bypass__" to "AI Redaction Bypass Report",
            "__usage__" to "AI Usage Card",
            "ai-provider-health" to "AI Provider Health (ops)",
            "alert-tuning-suggestions" to "Alert tuning suggestions",
            "anomaly-explanations" to "Anomaly explanation narration",
            "auto-name-unnamed-locations" to "Auto-name unnamed locations",
            "auto-trip-naming" to "Auto trip naming",
            "battery-health-forecast-narrative" to "Battery health forecast narrative",
            "cabin-temperature-impact-narrative" to "Cabin temperature impact narrative",
            "charging-curve-fingerprint-clustering" to "Charging-curve fingerprint clustering",
            "charging-diagnosis" to "Charging session diagnosis",
            "chatbot-llm" to "LLM Chatbot",
            "cost-forecast-narration" to "Cost forecast narration",
            "cross-rule-conflict-detection" to "Cross-rule conflict detection",
            "data-repair-suggestions" to "Data repair suggestions",
            "digest-narration" to "Weekly digest narration",
            "drive-coaching" to "Per-drive coaching",
            "feedback-queue-triage" to "Feedback queue triage",
            "geofence-aware-automation-suggestions" to "Geofence-aware automation suggestions",
            "inbox-auto-categorization" to "Inbox auto-categorization",
            "incident-timeline-summarizer" to "Incident timeline summarizer",
            "learned-per-vehicle-anomaly-baselines" to "Learned per-vehicle anomaly baselines",
            "lifetime-stats-qa" to "Lifetime stats Q&A",
            "log-trace-summarization" to "Log and trace summarization",
            "ml-charging-curve-clustering" to "Charging-curve clustering model",
            "mqtt-sse-inspector-explanations" to "MQTT and SSE inspector explanations",
            "nl-alert-builder" to "Natural-language alert builder",
            "nl-automation-builder" to "Natural-language automation builder",
            "nl-dashboard-composer" to "Helix natural-language dashboard composer",
            "nl-drive-search-replay" to "NL drive search and replay",
            "nl-grafana-panel" to "Helix natural-language Grafana panel",
            "nl-search" to "Natural-language search",
            "nl-sql-playground" to "Helix natural-language SQL playground",
            "period-compare-narration" to "Period compare narration",
            "pii-redaction-shared-exports" to "Helix export redaction advisor",
            "predictive-maintenance" to "Predictive maintenance",
            "preheat-precool-recommender" to "Preheat and precool recommender",
            "quiet-hours-suggestion" to "Helix quiet-hours suggestion",
            "rag-help" to "RAG-backed app help",
            "range-prediction-model" to "Range prediction model",
            "route-efficiency-suggestions" to "Route-efficiency suggestions",
            "safety-setting-explainer" to "Helix safety setting explainer",
            "signal-explorer-nl-filter" to "Signal explorer natural-language filter",
            "smart-charge-schedule-suggestion" to "Smart-charge schedule suggestion",
            "software-update-changelog-summarizer" to "Software update changelog summarizer",
            "speed-profile-insights" to "Speed-profile insights",
            "state-machine-debugger-narrator" to "State-machine debugger narrator",
            "suggest-new-geofences" to "Suggest new geofences",
            "tco-narration" to "TCO narration",
            "tire-pressure-trend-reasoning" to "Tire pressure trend reasoning",
            "trip-planner-llm-agent" to "Trip planner LLM agent",
            "trip-postcard-share-card-image-generation" to "Trip postcard and share-card image generation",
            "vampire-drain-explanation" to "Vampire-drain explanation",
            "vehicle-paint-preview" to "Vehicle paint preview",
            "voice-mode" to "Helix voice mode",
            "watch-face-nl-response" to "Helix watch face natural-language response",
            "yir-narration" to "Year-in-review narration",
        )

    /** The web `isKnownAiFeature(id)` — true iff [id] is a registered feature. */
    fun isKnown(id: String): Boolean = FALLBACK_LABELS.containsKey(id)

    /** The web `AI_FEATURES[id].name` fallback for a known [id]; the raw [id] for an unknown one. */
    fun fallbackLabel(id: String): String = FALLBACK_LABELS[id] ?: id

    /**
     * The Android string-resource name for [id]'s label — the native form of the web dynamic key
     * `ai.settings.feature.<id>.label`. Feature ids use hyphens; the catalog flattens every separator to `_`.
     */
    fun labelResourceName(id: String): String = FEATURE_LABEL_PREFIX + id.replace('-', '_') + FEATURE_LABEL_SUFFIX
}

/**
 * Pure port of the web `previewLabels(archived, translate)`: a comma/line preview of the enabled archived
 * feature names so the user can decide without mentally diffing the toggle list. Iterates [archived] in
 * insertion order (web `Object.entries`; pass a [LinkedHashMap] — the production JSON decode yields one),
 * skips entries whose value is false, resolves a known feature via [translate] (the `t(key, default)` seam,
 * given the registry fallback) and an unknown id as itself, so the listing is never blank.
 *
 * @param archived the `ai_features_archived` snapshot (web prop), feature-id → enabled.
 * @param translate resolves a known feature's label `(id, fallback) -> label`; the composable wires this to a
 *   by-name catalog read of [AiFeatureRegistry.labelResourceName] falling back to [AiFeatureRegistry.fallbackLabel].
 */
fun previewLabels(
    archived: Map<String, Boolean>,
    translate: (id: String, fallback: String) -> String,
): List<String> {
    val out = ArrayList<String>(archived.size)
    for ((id, enabled) in archived) {
        if (!enabled) continue
        if (AiFeatureRegistry.isKnown(id)) {
            out.add(translate(id, AiFeatureRegistry.fallbackLabel(id)))
        } else {
            out.add(id)
        }
    }
    return out
}

/**
 * Optional by-name resolution — the seam that reproduces the web `t(key, default)` for the per-feature label
 * keys the catalog may not carry (11 of the 57 ids fall back to the registry name, exactly as the web falls
 * back to `AI_FEATURES[id].name`). Pure (a `(String) -> String?` lookup is injected) so it is unit-tested
 * without Android; the composable supplies the real `resources.getIdentifier`-backed lookup.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The three top-level surfaces the composable renders. The surface binds no network feed, so [Prompt] is its
 * natural, default presentation (the restore offer; the preview list shows only when there are labels, the web
 * `labels.length > 0` branch); [Loading] and [Error] are the lifecycle chrome the shared feature-view contract
 * (P1/S8) can still carry — reproduced for full state coverage, never faked from a fetch the surface does not
 * perform.
 */
enum class AIRestoreSurfaceState { Loading, Error, Prompt }

/**
 * Classifies the shared lifecycle flags into the top-level [AIRestoreSurfaceState] — loading first, then a hard
 * error, otherwise the restore prompt. A stale/offline value (cached content shown after a failed refresh) is
 * neither loading nor a hard error, so it resolves to [AIRestoreSurfaceState.Prompt] — this surface holds no
 * cached payload of its own to label stale. Kept framework-free so each branch is asserted off-device.
 */
fun aiRestoreSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): AIRestoreSurfaceState =
    when {
        isLoading -> AIRestoreSurfaceState.Loading
        isError -> AIRestoreSurfaceState.Error
        else -> AIRestoreSurfaceState.Prompt
    }

/**
 * The host-side gate — the native analogue of the web doc comment's three surface conditions (§ADR-015 I7):
 * the prompt is shown only when AI is in a non-off mode, the `ai_features_archived` snapshot is non-empty, and
 * the user has not declined it in the current session. The surface itself, once mounted, always renders its
 * presentation (web parity), so this projection lives here for hosts + tests rather than being re-read inside
 * the view.
 */
fun shouldRender(
    aiModeOff: Boolean,
    archived: Map<String, Boolean>,
    declinedThisSession: Boolean,
): Boolean = !aiModeOff && archived.isNotEmpty() && !declinedThisSession

/**
 * Folds the alert region's [title], [description], and preview [labels] into a single TalkBack content
 * description so the polite live region is announced as one coherent message (web `<section role="alert"
 * aria-live="polite">`). The Decline / Restore buttons stay separately-labeled controls. Pure so the a11y
 * label is asserted off-device.
 */
fun alertAnnouncement(
    title: String,
    description: String,
    labels: List<String>,
): String =
    if (labels.isEmpty()) {
        "$title. $description"
    } else {
        "$title. $description ${labels.joinToString(separator = ", ")}"
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIRestorePanelRegistration.SLUG] (P1/S11).
 * Carries only the slug — never an archived feature id — so a diagnostics line can never leak which Helix
 * features the user had enabled. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordAIRestorePanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIRestorePanelRegistration.SLUG))
}
