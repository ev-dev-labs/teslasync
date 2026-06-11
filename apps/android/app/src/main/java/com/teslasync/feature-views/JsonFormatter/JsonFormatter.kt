// The native Jetpack Compose + Material 3 JSON Formatter feature view — a parity port of
// web/src/features/admin/components/devtools/tools/JsonFormatter.tsx. The web tool wraps a `<ToolCard>`
// (green `Braces` accent) around a labelled `<Textarea>`; as the operator types it reduces the input with a
// `useMemo` to either a rose error paragraph (parse failure) or a `bg-overlay` panel holding a `Formatted`
// caption, a `<CopyButton>`, and the 2-space-pretty-printed document in a scrollable `<pre>`.
//
// This surface keeps that contract exactly. It binds NO data hook of its own (its only web hook is
// `useTranslation`, mapped here to the resource catalog / key-as-fallback), so — like the sibling ToolCard —
// there is no loading / stale / offline lifecycle to render; the genuine states are the three branches of
// [JsonFormatResult] (empty / formatted / invalid), all reproduced. The input is held locally and reduced by
// the pure [JsonFormatterModel]. The panel is never blank: the input field is always present.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/JsonFormatter — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling ToolCard /
// AlertDetailTimeline surfaces do. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.jsonformatter

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Web `color="green"` — the ToolCard accent key (resolved to status.success at the render boundary).
private const val ACCENT_GREEN: String = "green"

// Web `rows={4}` → the field's resting height; it grows up to [TEXTAREA_MAX_LINES] before scrolling.
private const val TEXTAREA_MIN_LINES: Int = 4
private const val TEXTAREA_MAX_LINES: Int = 8

// Web `max-h-64 overflow-auto` on the formatted `<pre>` — cap the height and scroll past it.
private val FORMATTED_MAX_HEIGHT: Dp = 256.dp

// Local lucide `Braces` glyph (the curly-brace pair `{ }`). TeslaGlyphs has no equivalent, so — like the
// sibling ClientUtilitiesGlyphs — the surface authors its own monochrome 24×24 stroked vector, recolored at
// render time by `Icon`'s tint. The path matches ClientUtilitiesGlyphs.Braces for visual consistency.
private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f

private val BracesGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Braces",
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
                moveTo(9f, 5f)
                lineTo(7.5f, 5f)
                lineTo(7.5f, 11f)
                lineTo(6f, 12f)
                lineTo(7.5f, 13f)
                lineTo(7.5f, 19f)
                lineTo(9f, 19f)
                moveTo(15f, 5f)
                lineTo(16.5f, 5f)
                lineTo(16.5f, 11f)
                lineTo(18f, 12f)
                lineTo(16.5f, 13f)
                lineTo(16.5f, 19f)
                lineTo(15f, 19f)
            }
        }.build()

/**
 * Stateful entry point for the JSON Formatter tool. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), holds the textarea input across configuration changes ([rememberSaveable], web `useState`), and
 * reduces it with the pure [JsonFormatterModel] (web `useMemo`) before delegating to the stateless content.
 * The surface performs no HTTP (ADR-002).
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun JsonFormatter(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to JsonFormatterRegistration.SLUG))
    }
    var input by rememberSaveable { mutableStateOf("") }
    val strings = rememberJsonFormatterStrings()
    val result =
        remember(input, strings.invalidFallback) {
            JsonFormatterModel.format(input, strings.invalidFallback)
        }
    JsonFormatterContent(
        input = input,
        onInputChange = { input = it },
        result = result,
        strings = strings,
        modifier = modifier,
    )
}

/**
 * Resolves the localized strings once at the render boundary. Present P1/S10 keys come from the resource
 * catalog (`Formatted`, the shared `CopyButton` copy/copied labels); the keys absent from the catalog
 * (`Json Formatter`, `Json Formatter Desc`, `Json Input`, `Invalid Json`) echo their literal exactly as
 * i18next renders an untranslated key — the same approach the sibling ClientUtilitiesCatalog takes.
 */
@Composable
private fun rememberJsonFormatterStrings(): JsonFormatterStrings =
    JsonFormatterStrings(
        title = JsonFormatterKeys.TITLE,
        description = JsonFormatterKeys.DESCRIPTION,
        inputLabel = JsonFormatterKeys.INPUT_LABEL,
        inputExample = JsonFormatterKeys.INPUT_EXAMPLE,
        invalidFallback = JsonFormatterKeys.INVALID,
        formattedLabel = stringResource(R.string.translation_Formatted),
        copyLabel = stringResource(R.string.translation_common_copyButton_copy),
        copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
    )

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Wraps the shared [ToolCardContent] (web
 * `<ToolCard>`, green `Braces` accent) around the input field and the reduced [result]. Reproduces the web
 * composition: a labelled [Textarea], then — depending on [result] — a rose [ErrorText] (web parity: a
 * separate paragraph, the field is not flagged), a formatted-output panel, or nothing (empty input).
 */
@Composable
fun JsonFormatterContent(
    input: String,
    onInputChange: (String) -> Unit,
    result: JsonFormatResult,
    strings: JsonFormatterStrings,
    modifier: Modifier = Modifier,
) {
    ToolCardContent(
        icon = BracesGlyph,
        color = ACCENT_GREEN,
        title = strings.title,
        description = strings.description,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Textarea(
                value = input,
                onValueChange = onInputChange,
                label = strings.inputLabel,
                hint = strings.inputExample,
                minLines = TEXTAREA_MIN_LINES,
                maxLines = TEXTAREA_MAX_LINES,
            )
            when (result) {
                is JsonFormatResult.Invalid -> ErrorText(result.message)
                is JsonFormatResult.Formatted ->
                    FormattedOutput(
                        formatted = result.text,
                        label = strings.formattedLabel,
                        copyLabel = strings.copyLabel,
                        copiedLabel = strings.copiedLabel,
                    )
                JsonFormatResult.Empty -> Unit
            }
        }
    }
}

/**
 * The valid-document panel — the native analogue of the web `rounded bg-[var(--surface-overlay)] p-3` block:
 * a `Formatted` [Caption] beside a [CopyButton], above the pretty-printed JSON in a monospace [CodeText]
 * capped at [FORMATTED_MAX_HEIGHT] and vertically scrollable (web `max-h-64 overflow-auto`).
 */
@Composable
private fun FormattedOutput(
    formatted: String,
    label: String,
    copyLabel: String,
    copiedLabel: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(label)
                CopyButton(text = formatted, copyLabel = copyLabel, copiedLabel = copiedLabel)
            }
            CodeText(
                text = formatted,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = FORMATTED_MAX_HEIGHT)
                        .verticalScroll(rememberScrollState()),
            )
        }
    }
}
