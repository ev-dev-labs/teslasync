// Pure, framework-free model + projection + diagnostics for the SuggestedPrompts feature view — the native
// analogue of everything the web component owns before returning JSX
// (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// SuggestedPrompts is the empty-state chip strip shown above the chatbot input on a fresh conversation. The web
// component reads a STATIC, in-process list (`getChatSuggestions()` — a `const` array today, deliberately shaped
// so it can be swapped for a backend-fed endpoint later) and maps each entry to a ghost pill button. Its ONLY
// web hook is `useTranslation`; it binds NO data hook and performs NO fetch. As in the sibling QuickNav /
// DrivingTips ports (the other zero-data-source presentational surfaces), there is therefore no loading / error
// / stale / offline lifecycle to model here — inventing those states would fabricate behaviour the web spec does
// not have (honesty covenant: no silent drift). What the surface genuinely varies is its content: the populated
// four-chip strip (the web `getChatSuggestions().map(...)`) and a defensive empty path (shown only if the
// catalogue is ever empty — the future backend-fed case) so the strip is never a blank box.
//
// This pure file owns the parts the web render derives before returning JSX:
//   • the ordered suggestion catalogue — the web `getChatSuggestions()` array, in fixed
//     fleetYesterday → chargingCost30d → socDropping → efficientDrive order;
//   • each suggestion's i18n key — the web entry's `i18nKey` (e.g. `chatbot.suggestion.fleetYesterday`), which
//     the composable resolves to its localized text at the Compose boundary (P1/S10).
//
// i18n parity: unlike the web `t('nav.x', 'fallback')` inline-fallback keys some sibling surfaces hit, EVERY key
// this surface uses is present verbatim in the shared catalog (P1/S10, generated from web/src/i18n) — the four
// `chatbot.suggestion.*` strings plus the `chatbot.aria.suggestions` list label. The localized text is resolved
// at the Compose render boundary (stringResource) — never stored in this layer — so no English literal lives in
// the model.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SuggestedPrompts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling QuickNav / DrivingTips surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.suggestedprompts

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One chat suggestion the strip can render — the native analogue of a web `ChatSuggestion` entry. The web
 * interface carries an `i18nKey` plus a `defaultValue`; the default value lives only as the inline English
 * fallback on the web `t()` call, so here it is intentionally dropped — the canonical catalog (P1/S10) is the
 * single source of truth and the composable resolves [i18nKey] to its localized text at the render boundary
 * (no English literal in native code). Modelled as an enum (rather than a free-form data class) because the
 * catalogue is a fixed, ordered set, exactly as the web `const` array is.
 *
 * @property i18nKey the catalog key whose value the composable resolves for the chip text and which doubles as
 *   the stable list key (the web component keys each `<li>` by `s.i18nKey`).
 */
enum class ChatSuggestion(
    val i18nKey: String,
) {
    /** Web `{ i18nKey: 'chatbot.suggestion.fleetYesterday' }` — "What did my fleet do yesterday?". */
    FleetYesterday("chatbot.suggestion.fleetYesterday"),

    /** Web `{ i18nKey: 'chatbot.suggestion.chargingCost30d' }` — "Charging cost last 30 days". */
    ChargingCost30d("chatbot.suggestion.chargingCost30d"),

    /** Web `{ i18nKey: 'chatbot.suggestion.socDropping' }` — "Why is my SoC dropping faster this week?". */
    SocDropping("chatbot.suggestion.socDropping"),

    /** Web `{ i18nKey: 'chatbot.suggestion.efficientDrive' }` — "Show me the most efficient drive this month". */
    EfficientDrive("chatbot.suggestion.efficientDrive"),
}

/**
 * The static suggestion projection — the native analogue of the web `getChatSuggestions()` constant the
 * component maps over. SuggestedPrompts has no data source, so the "projection" is a fixed catalogue rather than
 * a transform of fetched data; it is exposed (and unit-tested) here so the composable never hard-codes the list
 * inline and the order / keys are verified off-device.
 */
object SuggestedPromptsProjection {
    /**
     * The four suggestions in the exact web order (fleetYesterday → chargingCost30d → socDropping →
     * efficientDrive). This is THE list the composable renders.
     */
    val suggestions: List<ChatSuggestion> =
        listOf(
            ChatSuggestion.FleetYesterday,
            ChatSuggestion.ChargingCost30d,
            ChatSuggestion.SocDropping,
            ChatSuggestion.EfficientDrive,
        )

    /**
     * True when there is nothing to suggest — drives the composable's defensive empty state so the strip is
     * never a blank box. Always `false` for the static catalogue; exposed for the empty render path + its test
     * (the future backend-fed case where the endpoint returns no rows).
     */
    val isEmpty: Boolean get() = suggestions.isEmpty()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any user
 * data (SuggestedPrompts has none) — so a diagnostics line can never leak anything about the user.
 */
object SuggestedPromptsDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "suggested-prompts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SuggestedPrompts"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
