// Pure, framework-free metadata + derivations for the QuietHoursPage notifications surface — the native
// analogue of everything the web page owns directly
// (web/src/features/notifications/pages/QuietHoursPage.tsx, the dedicated /notifications/quiet-hours wrapper
// that promotes the AI advisor + the quiet-hours / Do-Not-Disturb schedule panel to a first-class
// notifications route). No Compose, no Android framework, no HTTP lives here, so every declaration is
// exercised off-device and the composable stays a thin render layer.
//
// The web page renders no API feed of its own — it sets the PageContainer title/subtitle and composes two
// already-built shared surfaces (<AIQuietHoursSuggestion> + <QuietHoursPanel>), owning only the pending-seed
// hand-off between them. This model therefore carries the page's cross-cutting concerns: its navigation
// identity, the one PII-safe `view.opened` diagnostic, the per-feature AI-Off gate the embedded advisor needs
// (web `withAiFeature('quiet-hours-suggestion')`), the draft-stream request shape, the SSE frame split the
// stream adapter consumes, and the seed-input mapping between the advisor's local proposal type and the
// panel's shared-core input type (the web page passed one shared type; the native surfaces each own a copy).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/notifications — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling ArchivedPage / TeslaRegionPage surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located registration + helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.quiethours

import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AIQuietHoursSuggestionRegistration
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.AiStreamEvent
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.parseSseFrame
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import io.teslasync.android.sharedsurfaces.aiquiethourssuggestion.QuietHoursWindowInput as AiQuietHoursWindowInput
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput

/**
 * Canonical metadata for this surface. The web page is a top-level notifications route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns
 * the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination
 * at Destinations.kt) and the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11). There
 * is no page size or feed metadata because the page renders no data of its own; the embedded AIQuietHoursSuggestion
 * and QuietHoursPanel surfaces own their own feeds and data states.
 */
object QuietHoursPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsQuietHours", "/notifications/quiet-hours", …)`). */
    const val ROUTE_ID: String = "notificationsQuietHours"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/notifications/quiet-hours"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "QuietHoursPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [QuietHoursPageRegistration.SLUG] (P1/S11);
 * carries no quiet-hours content (no window, timezone, or proposed value). The composable calls it from its
 * first-composition effect.
 */
internal fun recordQuietHoursPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to QuietHoursPageRegistration.SLUG))
}

// ── Embedded AI advisor wiring (web `<AIQuietHoursSuggestion>`) ───────────────────────────────────────────────

/**
 * The AI draft-stream path the advisor opens — the web `useAiStream({ url:'/ai/settings/quiet-hours/draft' })`
 * target, WITHOUT the `/api/v1` prefix the resilient client adds. There is no request input: the backend reads
 * the user from the ForwardAuth subject and applies deterministic defaults (web body `{}`).
 */
const val AI_DRAFT_PATH: String = "/ai/settings/quiet-hours/draft"

/** The draft request body — verbatim the web `useAiStream({ body: {} })`; the backend reads identity itself. */
val AI_DRAFT_BODY: JsonObject = JsonObject(emptyMap())

private val SSE_FRAME_DELIMITER = Regex("\\r?\\n\\r?\\n")

/**
 * Splits a full SSE response body into the ordered list of typed [AiStreamEvent]s — the consume side of the web
 * `useAiStream` read-loop (split on the blank-line delimiter, feed each block through `parseSSEFrame`). A
 * malformed or unknown frame is skipped rather than fatal, so one bad block cannot corrupt the stream and a
 * future server event type cannot crash an older client. The shared client reads a complete response body (it
 * has no incremental SSE reader yet), so the parsed frames arrive together — the final proposal + the terminal
 * done/error semantics are faithful today, and the surface upgrades for free when an incremental reader lands.
 */
fun splitSseFrames(body: String): List<AiStreamEvent> =
    SSE_FRAME_DELIMITER
        .split(body)
        .mapNotNull { frame -> frame.takeIf { it.isNotBlank() }?.let(::parseSseFrame) }

// ── Per-feature AI-Off gate (web `withAiFeature('quiet-hours-suggestion')`) ───────────────────────────────────

private const val AI_MODE_OFF = "off"
private const val FIELD_AI_MODE = "ai_mode"
private const val FIELD_AI_FEATURES = "ai_features"

/**
 * Whether the embedded AI advisor is enabled for the user — the native port of the web
 * `withAiFeature('quiet-hours-suggestion')` HOC gate driven by `useAiEnabled`. The settings document must be a
 * present object, `ai_mode` must be present and not `"off"`, and `ai_features["quiet-hours-suggestion"]` must be
 * `true`. A missing/loading document fails closed (the advisor stays hidden), exactly as the web HOC renders
 * `null` until the gate opens.
 */
fun quietHoursSuggestionEnabled(settings: JsonElement?): Boolean {
    val obj = settings as? JsonObject ?: return false
    val mode = (obj[FIELD_AI_MODE] as? JsonPrimitive)?.contentOrNull
    val features = obj[FIELD_AI_FEATURES] as? JsonObject
    val featureOn =
        (features?.get(AIQuietHoursSuggestionRegistration.ID) as? JsonPrimitive)?.booleanOrNull == true
    return mode != null && mode != AI_MODE_OFF && featureOn
}

// ── Seed hand-off mapping (web passed one `QuietHoursWindowInput`; the native surfaces own a copy each) ───────

/**
 * Maps the advisor's "Apply to form" patch (the AIQuietHoursSuggestion surface's local
 * [AiQuietHoursWindowInput]) into the shared-core [QuietHoursWindowInput] the QuietHoursPanel consumes as its
 * `seedDraft`. The web page handed both children one `QuietHoursWindowInput` from `@/api/types`; the native
 * advisor declares its own copy (it is an independently-built shared surface), so the parent page owns this
 * one-to-one bridge — `enabled = true`, the scalars copied verbatim. No value is persisted here; the user still
 * clicks the panel's canonical Save button (web `onApplyDraft` is propose-only, ADR-015).
 */
internal fun AiQuietHoursWindowInput.toPanelInput(): QuietHoursWindowInput =
    QuietHoursWindowInput(
        enabled = enabled,
        startLocal = startLocal,
        endLocal = endLocal,
        timezone = timezone,
        weekdays = weekdays,
        bypassSeverities = bypassSeverities,
    )

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
