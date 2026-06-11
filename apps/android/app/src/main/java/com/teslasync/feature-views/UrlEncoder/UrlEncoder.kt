// The native Jetpack Compose + Material 3 URL Encoder feature view — a parity port of
// web/src/features/admin/components/devtools/tools/UrlEncoder.tsx. The web tool is a self-contained developer
// utility wrapped in a `ToolCard` (a `GlassPanel` with a tinted cyan link icon, a title, and a description):
// it renders an Encode/Decode mode toggle (two `Button`s, the active one `primary`, the other `ghost`), a
// `Textarea` for the input, and — once the input is non-empty — an output box showing the transformed value
// in a monospace block with a `CopyButton`.
//
// The native surface keeps that contract. Its only web hook is `useTranslation`, mapped here to the i18n
// catalog (P1/S10); it performs NO HTTP and binds no feed (the transform is pure string math, owned by
// [UrlEncoderProjection]). Because the feature-view contract still flows through the shared state-holder
// layer (P1/S8), the surface also renders every lifecycle state that layer can carry — loading skeleton,
// hard error with retry, stale/offline freshness chip — even though the tool's default host state is always
// "ready" (it has nothing to fetch). The web's three output outcomes map to three always-visible surfaces:
// a successful transform shows the output box (web parity), a blank input shows a friendly hint (where the
// web hides the box), and a decode that the web reports as "Invalid Input" shows that same localized message
// as a friendly inline surface — so the panel is never a blank box. A web-parity overload with no host state
// renders the live interactive tool directly.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes; the web `lucide-react` Link glyph is authored locally as a stroked vector (Android ships no
// equivalent without the frozen material-icons-extended artifact, and `TeslaGlyphs` has no link icon).
// `view.opened` is emitted once via the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UrlEncoder — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.urlencoder

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f
private const val INPUT_MIN_LINES: Int = 2
private val GLYPH_SIZE: Dp = 24.dp
private val TOGGLE_SKELETON_HEIGHT: Dp = 40.dp
private val FIELD_SKELETON_HEIGHT: Dp = 64.dp
private val OUTPUT_SKELETON_HEIGHT: Dp = 72.dp

/**
 * Stroked "link" glyph — the native analogue of the web `Link` lucide icon (two interlocking link halves).
 * Drawn monochrome and recolored at render time by the [Icon] tint, so it inherits every theme/state color.
 */
private val LinkGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Link",
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(10f, 13f)
                arcToRelative(5f, 5f, 0f, false, false, 7.54f, 0.54f)
                lineToRelative(3f, -3f)
                arcToRelative(5f, 5f, 0f, false, false, -7.07f, -7.07f)
                lineToRelative(-1.72f, 1.71f)
                moveTo(14f, 11f)
                arcToRelative(5f, 5f, 0f, false, false, -7.54f, -0.54f)
                lineToRelative(-3f, 3f)
                arcToRelative(5f, 5f, 0f, false, false, 7.07f, 7.07f)
                lineToRelative(1.71f, -1.71f)
            }
        }.build()

/**
 * Stateful entry point for the URL encoder. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11)
 * and renders every lifecycle [state] the shared feature-view layer can carry. The host owns the lifecycle
 * (P1/S8) and supplies [onRetry]; this view never performs HTTP.
 *
 * @param state the host lifecycle projection. The tool has no feed, so a host normally passes `Content`;
 *   `Loading`/`Error`/stale/offline are reproduced for full state coverage, never faked from a fetch.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UrlEncoder(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to UrlEncoderRegistration.SLUG))
    }
    UrlEncoderContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's self-contained, always-ready usage (no host feed). Renders
 * the live interactive tool directly in the `Content` phase. Records `view.opened` like the stateful entry;
 * there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun UrlEncoder(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember { UiState(phase = UiPhase.Content, data = Unit) }
    UrlEncoder(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the `ToolCard`
 * header (icon + title + description), then switches on the host lifecycle: a loading skeleton, a hard-error
 * retry surface, or — when ready — a freshness chip (only while refreshing/stale/offline) above the
 * interactive tool. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun UrlEncoderContent(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: UrlEncoderStrings = rememberUrlEncoderStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberUrlEncoderFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        UrlEncoderHeader(strings = strings)
        Spacer(modifier = Modifier.height(Spacing.md))
        when (urlEncoderSurfaceFor(isLoading = state.isLoading, isError = state.isError)) {
            UrlEncoderSurfaceState.Loading ->
                UrlEncoderLoading(label = stringResource(R.string.translation_common_loading))
            UrlEncoderSurfaceState.Error -> UrlEncoderError(onRetry = onRetry)
            UrlEncoderSurfaceState.Ready -> {
                if (state.stale || state.refreshing || state.hasError) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        DataFreshness(
                            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                            isFetching = state.refreshing,
                            isStale = state.stale,
                            isError = state.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                UrlEncoderTool(strings = strings)
            }
        }
    }
}

/** The `ToolCard` header — a tinted cyan link icon box beside the title + description. */
@Composable
private fun UrlEncoderHeader(strings: UrlEncoderStrings) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(imageVector = LinkGlyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            HelperText(strings.description)
        }
    }
}

/**
 * The interactive body — the Encode/Decode toggle, the input field, and the output box (or a friendly empty /
 * invalid hint). The transform is the pure [UrlEncoderProjection.project]; the field shows a mode-specific
 * example as its supporting hint.
 */
@Composable
private fun UrlEncoderTool(
    strings: UrlEncoderStrings,
    modifier: Modifier = Modifier,
) {
    var mode by rememberSaveable { mutableStateOf(UrlEncoderMode.Encode) }
    var input by rememberSaveable { mutableStateOf("") }
    val output = remember(mode, input) { UrlEncoderProjection.project(mode, input) }
    val example = if (mode == UrlEncoderMode.Encode) UrlEncoderExamples.ENCODE else UrlEncoderExamples.DECODE

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        UrlEncoderModeToggle(mode = mode, onModeChange = { mode = it }, strings = strings)
        Textarea(
            value = input,
            onValueChange = { input = it },
            label = strings.inputLabel,
            hint = example,
            minLines = INPUT_MIN_LINES,
        )
        when (val current = output) {
            is UrlEncoderOutput.Value -> UrlEncoderOutputPanel(value = current.text, strings = strings)
            UrlEncoderOutput.Invalid ->
                EmptyState(message = strings.invalidMessage, icon = LinkGlyph, modifier = Modifier.fillMaxWidth())
            UrlEncoderOutput.Empty ->
                EmptyState(message = strings.emptyHint, icon = LinkGlyph, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** The two-button mode toggle — the active mode is the filled `Primary`, the other a `Ghost` (web parity). */
@Composable
private fun UrlEncoderModeToggle(
    mode: UrlEncoderMode,
    onModeChange: (UrlEncoderMode) -> Unit,
    strings: UrlEncoderStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        UrlEncoderModeButton(
            label = strings.encodeLabel,
            isSelected = mode == UrlEncoderMode.Encode,
            onClick = { onModeChange(UrlEncoderMode.Encode) },
        )
        UrlEncoderModeButton(
            label = strings.decodeLabel,
            isSelected = mode == UrlEncoderMode.Decode,
            onClick = { onModeChange(UrlEncoderMode.Decode) },
        )
    }
}

/** One mode button; carries Compose `selected` semantics so TalkBack announces the active mode. */
@Composable
private fun UrlEncoderModeButton(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Button(
        label = label,
        onClick = onClick,
        variant = if (isSelected) ButtonVariant.Primary else ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        modifier = Modifier.semantics { selected = isSelected },
    )
}

/**
 * The output box — a tinted surface with the `Output Label` caption over the monospace result and an icon-only
 * copy affordance. The label + value are folded into one TalkBack node via [clearAndSetSemantics] (the value
 * reads with its label), while the copy control stays a separate, independently-labeled node.
 */
@Composable
private fun UrlEncoderOutputPanel(
    value: String,
    strings: UrlEncoderStrings,
    modifier: Modifier = Modifier,
) {
    val description = UrlEncoderProjection.outputContentDescription(strings.outputLabel, value)
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f).clearAndSetSemantics { contentDescription = description },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Caption(strings.outputLabel)
                CodeText(value)
            }
            CopyButton(
                text = value,
                copyLabel = strings.copyLabel,
                copiedLabel = strings.copiedLabel,
                iconOnly = true,
            )
        }
    }
}

/** First-load skeleton — a toggle bar, an input-field bar, and an output bar so the panel is never blank. */
@Composable
private fun UrlEncoderLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = TOGGLE_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = FIELD_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = OUTPUT_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun UrlEncoderError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [UrlEncoderStrings]. `Encode`/`Decode`/`Copy`/`Copied` resolve through compile-time
 * resources; `Url Encoder`, `Url Encoder Desc`, `Input Label`, `Output Label`, `Invalid Input`, and the empty
 * hint resolve by-name with the web `t(key, default)` fallback, since those keys exist in no catalog.
 * Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberUrlEncoderStrings(): UrlEncoderStrings {
    val context = LocalContext.current
    val encodeLabel = stringResource(R.string.translation_Encode)
    val decodeLabel = stringResource(R.string.translation_Decode)
    val copyLabel = stringResource(R.string.translation_Copy)
    val copiedLabel = stringResource(R.string.translation_Copied)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val title = resolveOptional(lookup, KEY_TITLE, UrlEncoderDefaults.TITLE)
    val description = resolveOptional(lookup, KEY_DESCRIPTION, UrlEncoderDefaults.DESCRIPTION)
    val inputLabel = resolveOptional(lookup, KEY_INPUT_LABEL, UrlEncoderDefaults.INPUT_LABEL)
    val outputLabel = resolveOptional(lookup, KEY_OUTPUT_LABEL, UrlEncoderDefaults.OUTPUT_LABEL)
    val invalidMessage = resolveOptional(lookup, KEY_INVALID_INPUT, UrlEncoderDefaults.INVALID_INPUT)
    val emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, UrlEncoderDefaults.EMPTY_HINT)
    return remember(
        title,
        description,
        encodeLabel,
        decodeLabel,
        inputLabel,
        outputLabel,
        invalidMessage,
        emptyHint,
        copyLabel,
        copiedLabel,
    ) {
        UrlEncoderStrings(
            title = title,
            description = description,
            encodeLabel = encodeLabel,
            decodeLabel = decodeLabel,
            inputLabel = inputLabel,
            outputLabel = outputLabel,
            invalidMessage = invalidMessage,
            emptyHint = emptyHint,
            copyLabel = copyLabel,
            copiedLabel = copiedLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberUrlEncoderFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}
