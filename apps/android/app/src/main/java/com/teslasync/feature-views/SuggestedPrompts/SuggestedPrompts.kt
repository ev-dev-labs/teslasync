// The native Jetpack Compose + Material 3 SuggestedPrompts feature view — a parity port of
// web/src/features/system/components/chatbot/SuggestedPrompts.tsx. The web component renders the empty-state
// chip strip shown above the chatbot input on a fresh conversation: a centered, wrapping row (web
// `flex flex-wrap gap-2 justify-center max-w-2xl mx-auto`) of ghost `Button`s, each a `rounded-full` pill with a
// leading lucide `Sparkles` icon + the suggestion text. Tapping a chip calls `onPick(text)` — the page fills the
// input and focuses it but does NOT auto-submit, so the user can edit before sending.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling QuickNav / DrivingTips
// ports — the other zero-data-source presentational surfaces — it has no loading / error / stale / offline
// lifecycle to render; modelling those would invent behaviour the web spec does not have (honesty covenant: no
// silent drift). What it genuinely varies is its content: the populated four-chip strip (web
// `getChatSuggestions().map(...)`) and a defensive empty state (shown only if the catalogue is ever empty — the
// future backend-fed case) so the strip is never a blank box. Every item + ordering flows through the pure
// [SuggestedPromptsProjection]; the composable is a thin render layer.
//
// Decoupling: the web chip's `onClick={() => onPick(text)}` becomes a chip that emits its already-localized text
// through [onPick]; the host chatbot page wires that to its input field (the view never touches the input).
//
// Component parity: the web `Button` (`@/components/ui`) maps to the shared
// [io.teslasync.android.components.ui.Button] with the documented Ghost variant (web `variant="ghost"`) + Sm
// size (web `size="sm"`) + a leading [SuggestedPromptsGlyphs.Sparkles] icon (web `icon={<Sparkles />}`). The web
// cosmetic Tailwind (`rounded-full border-[var(--border-subtle)]`) is reproduced with platform tokens rather
// than ported verbatim: the chip is clipped to and bordered with the fully-rounded [Radius.pill] token and the
// theme `outlineVariant` color, so the pill + hairline read correctly in light / dark / high-contrast. The web
// `aria-label` on the `<ul>` becomes the strip container's accessible name; each chip is a focusable button
// whose accessible name is its suggestion text (the web per-chip label).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SuggestedPrompts — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.suggestedprompts

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `max-w-2xl` (42rem ≈ 672px) — the strip's max width; centered (`mx-auto`) within its parent. */
private val STRIP_MAX_WIDTH: Dp = 672.dp

/** Web `border` — the chip's hairline pill border thickness. */
private val CHIP_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point for the suggestion chip strip — the faithful 1:1 port of the web
 * `SuggestedPrompts({ onPick })`. Records the one-shot PII-safe `view.opened` diagnostic on first composition
 * (P1/S11) and renders the strip. The surface binds no data of its own; tapping a chip emits its localized text
 * through [onPick] (web `onClick={() => onPick(text)}`), which the host chatbot page routes into its input.
 *
 * @param onPick invoked with the chip's localized text; the host fills (but does not auto-submit) its input.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SuggestedPrompts(
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SuggestedPromptsDiagnostics.recordViewOpened(logger) }
    SuggestedPromptsContent(onPick = onPick, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web strip: a centered, wrapping
 * [FlowRow] (web `flex flex-wrap gap-2 justify-center`) constrained to [STRIP_MAX_WIDTH] (web `max-w-2xl`) of
 * ghost pill chips (web `getChatSuggestions().map(...)`), or a friendly empty state when [suggestions] is empty
 * so the strip is never a blank box. [suggestions] defaults to the static [SuggestedPromptsProjection].
 */
@Composable
fun SuggestedPromptsContent(
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
    suggestions: List<ChatSuggestion> = SuggestedPromptsProjection.suggestions,
) {
    val regionLabel = stringResource(R.string.translation_chatbot_aria_suggestions)
    if (suggestions.isEmpty()) {
        EmptyState(
            message = stringResource(R.string.translation_common_noData),
            icon = SuggestedPromptsGlyphs.Sparkles,
            modifier = modifier.fillMaxWidth(),
        )
        return
    }
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        FlowRow(
            modifier =
                Modifier
                    .widthIn(max = STRIP_MAX_WIDTH)
                    .semantics { contentDescription = regionLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            suggestions.forEach { suggestion ->
                SuggestionChip(text = stringResource(labelResFor(suggestion)), onPick = onPick)
            }
        }
    }
}

/**
 * One suggestion chip — the web ghost `Button` (`variant="ghost" size="sm"`) with a leading [Sparkles] icon and
 * the suggestion [text]. Built from the shared [Button] so the variant/size/icon map 1:1 to the web props;
 * clipped to and bordered with the fully-rounded [Radius.pill] token (web `rounded-full`) and the theme
 * `outlineVariant` hairline (web `border-[var(--border-subtle)]`) so the pill reads correctly in every theme.
 * Tapping emits the chip's [text] through [onPick]; the [text] is the chip's accessible name (web chip label).
 */
@Composable
private fun SuggestionChip(
    text: String,
    onPick: (String) -> Unit,
) {
    val pill = RoundedCornerShape(Radius.pill)
    Button(
        label = text,
        onClick = { onPick(text) },
        modifier =
            Modifier
                .clip(pill)
                .border(CHIP_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant, pill),
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = SuggestedPromptsGlyphs.Sparkles,
    )
}

/**
 * Suggestion → localized text key (P1/S10). Every key is present verbatim in the shared catalog (unlike some
 * sibling surfaces' inline-fallback keys), so each chip resolves to its real `chatbot.suggestion.*` string
 * rather than an English literal.
 */
private fun labelResFor(suggestion: ChatSuggestion): Int =
    when (suggestion) {
        ChatSuggestion.FleetYesterday -> R.string.translation_chatbot_suggestion_fleetYesterday
        ChatSuggestion.ChargingCost30d -> R.string.translation_chatbot_suggestion_chargingCost30d
        ChatSuggestion.SocDropping -> R.string.translation_chatbot_suggestion_socDropping
        ChatSuggestion.EfficientDrive -> R.string.translation_chatbot_suggestion_efficientDrive
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Content — four suggestion chips", showBackground = true)
@Composable
private fun SuggestedPromptsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SuggestedPromptsContent(onPick = {})
    }
}

@Preview(name = "Empty — friendly no-data, never a blank box", showBackground = true)
@Composable
private fun SuggestedPromptsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SuggestedPromptsContent(onPick = {}, suggestions = emptyList())
    }
}
