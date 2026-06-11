// The native Jetpack Compose + Material 3 Color Converter feature view — a parity port of
// web/src/features/admin/components/devtools/tools/ColorConverter.tsx. The web tool is a self-contained
// client-side utility: it holds a hex string in `useState('#3b82f6')`, a `useMemo` parses it into
// `{ r, g, b, h, s, l }` (or `null`), and it renders a `ToolCard` (purple Palette icon, `t('Color Converter')`
// title, `t('Color Converter Desc')` description) containing a hex `Input` (`t('Hex Color')` label + Palette
// icon), a live colour swatch, and — when the hex parses — a three-up grid of RGB / HSL / HEX cards, each
// with a `CopyButton`.
//
// The native surface keeps that contract: it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). To honour the shared lifecycle
// contract every P3 feature view follows, the stateful entry accepts the tool's *seed* hex through the shared
// P1/S8 state-holder layer as a [UiState] — a host can supply a "start from this colour" value (a saved
// swatch, a deep-linked colour, the vehicle's paint) and it defaults to the web's `#3b82f6`. That lets this
// view render every state the seed feed can carry — loading skeleton, hard error with retry, content, empty
// (no seed → default), and stale/offline ("last known" seed + offline chip + auto-refresh) — without ever
// fetching. The interactive tool itself reproduces the web composition; for the invalid-hex case it shows a
// friendly empty surface in place of the cards (web hides the grid) — never a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ColorConverter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.colorconverter

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
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
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private val SWATCH_SIZE = 40.dp

/**
 * Stateful entry point for the Color Converter tool. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared *seed* feed can carry. The host owns the seed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the tool's initial hex (defaults to `#3b82f6` when the
 *   seed is absent/empty). The interactive tool is fully usable regardless — the seed only chooses where it
 *   opens.
 * @param onRetry re-runs the host's seed load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ColorConverter(
    state: UiState<String>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to ColorConverterRegistration.SLUG))
    }
    ColorConverterContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web tool's self-contained form, for hosts that just want to drop the
 * converter in at a fixed starting colour (default `#3b82f6`, matching the web `useState`). Records
 * `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ColorConverter(
    initialHex: String = DEFAULT_HEX,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(initialHex) { UiState(phase = UiPhase.Content, data = initialHex) }
    ColorConverter(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the ToolCard
 * header (icon + title + description, web parity), then switches the body: a loading skeleton, a hard-error
 * retry surface, or the interactive tool seeded from [state]. A freshness/offline chip is shown in the header
 * whenever cached seed data is refreshing/stale/errored, and a stale (non-error) seed auto-refreshes —
 * mirroring the shared freshness contract.
 */
@Composable
fun ColorConverterContent(
    state: UiState<String>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: ColorConverterStrings = rememberColorConverterStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberColorConverterFreshnessFormatter()
    val showFreshness = !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        ColorConverterHeader(
            strings = strings,
            showFreshness = showFreshness,
            fetchedAt = state.fetchedAt,
            refreshing = state.refreshing,
            stale = state.stale,
            hasError = state.hasError,
            formatAge = formatAge,
        )
        when {
            state.isLoading -> ColorConverterLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> ColorConverterError(onRetry = onRetry)
            else -> {
                val seed = state.data?.takeIf { it.isNotBlank() } ?: DEFAULT_HEX
                ColorConverterTool(seedHex = seed, strings = strings)
            }
        }
    }
}

/** The ToolCard header — purple Palette [IconBox] + title + description, with an optional freshness chip. */
@Composable
private fun ColorConverterHeader(
    strings: ColorConverterStrings,
    showFreshness: Boolean,
    fetchedAt: Long?,
    refreshing: Boolean,
    stale: Boolean,
    hasError: Boolean,
    formatAge: (FreshnessAge) -> String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
            Icon(PaletteGlyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f)) {
            PanelTitle(strings.title)
            HelperText(strings.description)
        }
        if (showFreshness) {
            DataFreshness(
                updatedAtMillis = fetchedAt?.takeIf { it > 0 },
                isFetching = refreshing,
                isStale = stale,
                isError = hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = formatAge,
            )
        }
    }
}

/**
 * The interactive converter — the web tool's body. A hex [Input] (Palette icon, [ColorConverterStrings.hexLabel]
 * label) sits beside a live swatch; below, when the hex parses, the RGB / HSL / HEX cards render (each with a
 * copy affordance). When the typed hex is not a valid `#RRGGBB`, the swatch falls back to a neutral fill and a
 * friendly [EmptyState] replaces the cards (web hides the grid) — never a blank panel.
 */
@Composable
private fun ColorConverterTool(
    seedHex: String,
    strings: ColorConverterStrings,
) {
    var hex by rememberSaveable(seedHex) { mutableStateOf(seedHex) }
    val parsed = remember(hex) { ColorConverterProjection.parse(hex) }
    val neutral = MaterialTheme.colorScheme.surfaceVariant
    val swatchColor = if (parsed != null) Color(red = parsed.r, green = parsed.g, blue = parsed.b) else neutral

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Input(
                value = hex,
                onValueChange = { hex = it },
                modifier = Modifier.weight(1f),
                label = strings.hexLabel,
                leadingIcon = PaletteGlyph,
                singleLine = true,
                keyboardType = KeyboardType.Ascii,
            )
            Box(
                modifier =
                    Modifier
                        .size(SWATCH_SIZE)
                        .clip(RoundedCornerShape(Radius.md))
                        .background(swatchColor)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.md))
                        .semantics { contentDescription = hex },
            )
        }

        if (parsed != null) {
            ColorConverterCard(label = LABEL_RGB, value = parsed.rgb, copyText = parsed.rgb, strings = strings)
            ColorConverterCard(label = LABEL_HSL, value = parsed.hsl, copyText = parsed.hsl, strings = strings)
            ColorConverterCard(label = LABEL_HEX, value = hex, copyText = hex, strings = strings)
        } else {
            ColorConverterEmpty(strings = strings)
        }
    }
}

/** One result card — a tinted surface with a [label], the mono [value], and a copy affordance for [copyText]. */
@Composable
private fun ColorConverterCard(
    label: String,
    value: String,
    copyText: String,
    strings: ColorConverterStrings,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(label)
                CodeText(value)
            }
            CopyButton(
                text = copyText,
                copyLabel = strings.copyLabel,
                copiedLabel = strings.copiedLabel,
                iconOnly = true,
            )
        }
    }
}

/** Friendly empty surface shown when the typed hex is not a valid `#RRGGBB` — never a blank box. */
@Composable
private fun ColorConverterEmpty(strings: ColorConverterStrings) {
    EmptyState(
        message = strings.emptyHint,
        icon = PaletteGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — input/swatch + card outlines so the panel is never blank while seeding. */
@Composable
private fun ColorConverterLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
            Skeleton(modifier = Modifier.weight(1f), height = SWATCH_SIZE)
            Skeleton(modifier = Modifier.size(SWATCH_SIZE))
        }
        repeat(CARD_COUNT) { Skeleton(height = CARD_SKELETON_HEIGHT) }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ColorConverterError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Localized microcopy the surface renders — the web `t()` keys (`Color Converter`, `Color Converter Desc`,
 * `Hex Color`) plus the shared `Copy`/`Copied` clipboard labels and a native invalid-input hint. The
 * composable builds this from `stringResource`; tests pass a deterministic instance.
 */
data class ColorConverterStrings(
    val title: String,
    val description: String,
    val hexLabel: String,
    val copyLabel: String,
    val copiedLabel: String,
    val emptyHint: String,
)

@Composable
private fun rememberColorConverterStrings(): ColorConverterStrings {
    val title = stringResource(R.string.translation_Color_Converter)
    val description = stringResource(R.string.translation_Color_Converter_Desc)
    val hexLabel = stringResource(R.string.translation_Hex_Color)
    val copyLabel = stringResource(R.string.translation_Copy)
    val copiedLabel = stringResource(R.string.translation_Copied)
    val emptyHint = stringResource(R.string.translation_Color_Converter_Invalid)
    return remember(title, description, hexLabel, copyLabel, copiedLabel, emptyHint) {
        ColorConverterStrings(
            title = title,
            description = description,
            hexLabel = hexLabel,
            copyLabel = copyLabel,
            copiedLabel = copiedLabel,
            emptyHint = emptyHint,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberColorConverterFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/**
 * Self-contained "palette" glyph — the native analogue of the web's `lucide-react` `Palette` icon. Authored
 * locally because `TeslaGlyphs` has no palette and is outside this surface's allowed files. A round-capped
 * colour-wheel outline with four paint-well dots; drawn opaque-black and recoloured at render by [Icon]'s
 * tint so it inherits every theme/state colour.
 */
private val PaletteGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Palette",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(3.5f, 12f)
                arcTo(8.5f, 8.5f, 0f, false, true, 20.5f, 12f)
                arcTo(8.5f, 8.5f, 0f, false, true, 3.5f, 12f)
                close()
                dot(8.5f, 9.5f)
                dot(12f, 7.8f)
                dot(15.5f, 9.5f)
                dot(16f, 13.2f)
            }
        }.build()

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// Non-localized colour-space format identifiers — the web tool renders these literally (not via `t()`); they
// are universal acronyms (like VIN / kW already in the catalog), not user-facing prose.
private const val LABEL_RGB = "RGB"
private const val LABEL_HSL = "HSL"
private const val LABEL_HEX = "HEX"

private const val CARD_COUNT = 3
private val CARD_SKELETON_HEIGHT = 48.dp
