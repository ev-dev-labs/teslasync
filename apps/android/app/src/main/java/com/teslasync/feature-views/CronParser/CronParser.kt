// The native Jetpack Compose + Material 3 Cron Parser feature view — a parity port of
// web/src/features/admin/components/devtools/tools/CronParser.tsx, which wraps a `ToolCard` (green Timer
// icon, title, subtitle) around a cron-expression `Input`, a row of quick-fill preset `Button`s, and two
// conditional blocks: a human-readable description and the upcoming run timestamps. The web tool binds no
// data feed (its only hook is `useTranslation`; the expression is local `useState`) and performs no async
// work, so there is no skeleton / error / stale / offline branch in the source to reproduce. The surface's
// real, input-driven states ARE reproduced: an empty or non-five-field expression shows just the input and
// presets (web hides both conditional blocks), while a valid five-field expression additionally shows the
// description and the next-runs list — mirroring the web `{description && …}` / `{nextRuns.length > 0 && …}`.
//
// Composition: `CronParser` is the stateful entry (records the one-shot `view.opened` diagnostic and resolves
// strings); `CronParserContent` is the stateless renderer that owns the typed expression (the web `useState`)
// and is the unit/UI-test entry point. The pure parse + presets + formatting live in CronParserModel.kt so
// this file stays a thin render layer. Every chrome string resolves through the i18n facade (see
// [rememberCronParserStrings]); the computed cron description is the web helper's verbatim English (the web
// does not localize it). The Timer glyph is absent from every shared catalog and the surface's allowed-files
// scope forbids editing shared files, so it is authored locally below as a 24×24 stroked vector (the same
// approach ReferenceLinksSection and the shared glyph sets take).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CronParser) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.cronparser

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

// The web input shows `*/5 * * * *` as its example prompt. The shared Input has no inline-prompt slot, so
// it is surfaced as the field's supporting hint instead — the same example, in a native-idiomatic position.
private const val EXAMPLE_EXPRESSION = "*/5 * * * *"

private const val EXPRESSION_FIELD_MAX_LINES = 1

/**
 * Stateful entry point. Spins up the [CronParserViewModel] (carrying only the `view.opened` diagnostic — this
 * surface binds no feed), records that diagnostic once, resolves the localized strings, and renders the cron
 * tool. [locale]/[zoneId] format the upcoming-run timestamps (web `formatDateTime`, browser locale + zone).
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey unique key per placement so multiple instances keep independent state holders.
 */
@Composable
fun CronParser(
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CronParserRegistration.SLUG,
) {
    val viewModel: CronParserViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { CronParserViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    CronParserContent(
        strings = rememberCronParserStrings(),
        modifier = modifier,
        locale = locale,
        zoneId = zoneId,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Owns the typed cron [expression] (the web `useState`),
 * derives the [CronParseResult] on each change (the web `useMemo` chain, evaluated at the current instant in
 * [zoneId]), and lays out the tool card: the expression input, the preset row, and — only when present — the
 * description block and the next-runs list. [initialExpression] seeds the field so a host or test can render
 * a specific state directly.
 */
@Composable
fun CronParserContent(
    strings: CronParserStrings,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    initialExpression: String = "",
) {
    var expression by rememberSaveable { mutableStateOf(initialExpression) }
    val result =
        remember(expression, locale, zoneId) {
            CronParserProjection.parse(
                expr = expression,
                now = LocalDateTime.now(zoneId),
                formatTime = { dateTime -> CronTimeFormat.format(dateTime, locale) },
            )
        }

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        CronParserHeader(title = strings.title, description = strings.toolDescription)
        Spacer(Modifier.height(Spacing.lg))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = expression,
                onValueChange = { expression = it },
                label = strings.expressionLabel,
                hint = EXAMPLE_EXPRESSION,
                leadingIcon = CronParserGlyphs.Timer,
                singleLine = EXPRESSION_FIELD_MAX_LINES == 1,
            )
            CronPresetRow(
                presets = CronParserProjection.presets(strings),
                onSelect = { expression = it },
            )
            val description = result.description
            if (description != null) {
                CronDescriptionBlock(label = strings.descriptionLabel, description = description)
            }
            if (result.nextRuns.isNotEmpty()) {
                CronNextRunsBlock(label = strings.nextRunsLabel, runs = result.nextRuns)
            }
        }
    }
}

/** Tool-card header — the web `ToolCard` chrome: a green Timer icon box beside the title + muted subtitle. */
@Composable
private fun CronParserHeader(
    title: String,
    description: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        IconBox(tone = IconBoxTone.Success, size = IconBoxSize.Md) {
            Icon(imageVector = CronParserGlyphs.Timer, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f)) {
            Heading(text = title, level = HeadingLevel.Sub)
            Caption(text = description)
        }
    }
}

/**
 * The quick-fill preset row — the web `flex flex-wrap gap-1` of ghost buttons. Each tap fills the input with
 * the preset's cron expression. Wraps to additional lines on narrow widths via [FlowRow].
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CronPresetRow(
    presets: List<CronPresetItem>,
    onSelect: (String) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        presets.forEach { item ->
            Button(
                label = item.label,
                onClick = { onSelect(item.expression) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The description block — web `rounded bg-[var(--surface-overlay)] px-3 py-2` carrying a muted label and the
 * computed cron description in semantic success-green (web `text-emerald-300`, indicating a parsed expression).
 */
@Composable
private fun CronDescriptionBlock(
    label: String,
    description: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(text = label)
            BodyText(text = description, color = TeslaTokens.status.success)
        }
    }
}

/**
 * The upcoming-runs block — web `space-y-1` of `flex items-center gap-2 rounded bg-overlay px-3 py-1` rows,
 * each a numbered info [Badge] beside the monospace formatted timestamp.
 */
@Composable
private fun CronNextRunsBlock(
    label: String,
    runs: List<CronNextRun>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(text = label)
        runs.forEach { run -> CronNextRunRow(run = run) }
    }
}

@Composable
private fun CronNextRunRow(run: CronNextRun) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.xs)
                    .semantics(mergeDescendants = true) { contentDescription = "${run.badge}, ${run.time}" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Badge(text = run.badge, variant = BadgeVariant.Info)
            CodeText(text = run.time)
        }
    }
}

/**
 * Builds the localized [CronParserStrings] from the i18n facade (P1/S10). Every chrome key resolves by name
 * through the generated catalog (web `t(key)`), falling back to the web's natural-language key text for the
 * keys the catalog does not (yet) define — see the model header. Remembered against the context so a locale
 * change re-projects the surface.
 */
@Composable
private fun rememberCronParserStrings(): CronParserStrings {
    val context = LocalContext.current
    return remember(context) {
        buildCronParserStrings { name -> context.optionalString(name) }
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam that reproduces web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts), so
 * the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Locally authored line-style Timer glyph (lucide `timer`), absent from the shared catalogs and outside this
 * surface's allowed-files scope, drawn as a 24×24 stroked [ImageVector] and recolored at render time by the
 * [Icon] tint: a dial with a top stem cap and a single hand.
 */
private object CronParserGlyphs {
    /** Timer/clock glyph — the web lucide `Timer` icon used by the cron tool card. */
    val Timer: ImageVector =
        cronStroked("CronParserTimer") {
            moveTo(10f, 2f)
            lineTo(14f, 2f)
            moveTo(12f, 14f)
            lineTo(15f, 11f)
            cronCircle(12f, 14f, 8f)
        }
}

private fun cronStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.cronCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
