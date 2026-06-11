// The native Jetpack Compose + Material 3 RegexTester feature view — a parity port of
// web/src/features/admin/components/devtools/tools/RegexTester.tsx. The web tool renders a `ToolCard`
// (red accent, `Regex` icon) wrapping a pattern `Input`, a flags `Select`, a test-string `Textarea`,
// a match-count `Badge`, and — when there are matches — a list of match rows (an index badge, the
// matched text as `<code>`, and an "At Index N" caption). All three editable values are local state
// (web `useState`); the match list is derived from them (web `useMemo`, here [RegexTesterModel.evaluate]).
//
// The surface binds NO data hook (its only web hook is `useTranslation`), so there is no loading /
// error / stale / offline data lifecycle to render — modelling those would invent behaviour the web
// does not have (honesty covenant §9, no silent drift). The states this surface genuinely has are the
// empty result (no input, no match, or an invalid pattern — the web swallows the `RegExp` throw and
// shows zero matches with no error chrome) and the populated result; both keep the whole form visible
// with a live "{n} Matches" badge, so the panel is never a blank box. Every visible string resolves
// through the shared i18n facade (P1/S10) via [resolveI18nKey], reproducing i18next's key-as-fallback:
// the catalog-backed keys (Pattern / Flags / Matches) localize, the rest (and the literal flag-notation
// labels the web never translates) render their verbatim key text — identical to the web output.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RegexTester — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling
// ToolCard / AlertDetailTimeline surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located stateless content, helpers and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.regextester

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

// Web `<ToolCard … color="red">` — the accent key the shared card resolves to the danger token.
private const val TOOL_CARD_ACCENT = "red"

// Android string-resource names are `translation_` + the i18n key with every non-resource character
// folded to `_`, matching the P1/S10 generator's `androidName` transform (apps/shared/i18n).
private const val I18N_RESOURCE_PREFIX = "translation_"
private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

/**
 * Stateful entry point for the RegexTester surface. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), holds the three editable values as rotation-surviving state (web `useState`),
 * derives the live match list (web `useMemo`), and renders the presentational content.
 *
 * @param logger the single sanctioned redacting logger (ADR-016); defaults to the app's container.
 */
@Composable
fun RegexTester(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to RegexTesterRegistration.SLUG))
    }
    var pattern by rememberSaveable { mutableStateOf("") }
    var flags by rememberSaveable { mutableStateOf(RegexTesterModel.DEFAULT_FLAGS) }
    var testString by rememberSaveable { mutableStateOf("") }
    val matches =
        remember(pattern, flags, testString) {
            RegexTesterModel.evaluate(pattern, flags, testString)
        }
    RegexTesterContent(
        pattern = pattern,
        flags = flags,
        testString = testString,
        matches = matches,
        onPatternChange = { pattern = it },
        onFlagsChange = { flags = it },
        onTestStringChange = { testString = it },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web component's
 * composition: the shared [ToolCardContent] chrome (red accent, [RegexTesterGlyphs.Regex] icon) over a
 * vertical form — pattern [Input], flags [Select], test-string [Textarea] — followed by the
 * "{n} Matches" [Badge] and, when [matches] is non-empty, the per-match list. The badge is always
 * shown (even at zero), so the surface never collapses to a blank box.
 */
@Composable
fun RegexTesterContent(
    pattern: String,
    flags: String,
    testString: String,
    matches: List<RegexMatch>,
    onPatternChange: (String) -> Unit,
    onFlagsChange: (String) -> Unit,
    onTestStringChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberRegexTesterStrings()
    ToolCardContent(
        icon = RegexTesterGlyphs.Regex,
        color = TOOL_CARD_ACCENT,
        title = strings.title,
        description = strings.description,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Input(
                value = pattern,
                onValueChange = onPatternChange,
                label = strings.pattern,
                hint = RegexTesterModel.PATTERN_HINT,
                leadingIcon = RegexTesterGlyphs.Regex,
            )
            Select(
                options = strings.flagOptions,
                selectedValue = flags,
                onSelect = onFlagsChange,
                label = strings.flags,
            )
            Textarea(
                value = testString,
                onValueChange = onTestStringChange,
                label = strings.testString,
                hint = strings.testStringHint,
            )
            Badge(
                text = "${matches.size} ${strings.matches}",
                variant = if (matches.isNotEmpty()) BadgeVariant.Success else BadgeVariant.Neutral,
            )
            if (matches.isNotEmpty()) {
                RegexMatchList(matches = matches, atIndexLabel = strings.atIndex)
            }
        }
    }
}

/** The match list (web `{matches.map(...)}`) — one [RegexMatchRow] per match, numbered from 1. */
@Composable
private fun RegexMatchList(
    matches: List<RegexMatch>,
    atIndexLabel: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        matches.forEachIndexed { position, match ->
            RegexMatchRow(ordinal = position + 1, match = match, atIndexLabel = atIndexLabel)
        }
    }
}

/**
 * One match row — the native analogue of the web `flex … rounded bg-[var(--surface-overlay)]` row:
 * an ordinal [Badge] (web info badge `{i + 1}`), the matched text in monospace [CodeText] (web
 * `<code>`), and the "At Index N" [Caption] (web muted span). The texts are non-interactive and read
 * by TalkBack in order; the surface tint provides the overlay affordance.
 */
@Composable
private fun RegexMatchRow(
    ordinal: Int,
    match: RegexMatch,
    atIndexLabel: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Badge(text = ordinal.toString(), variant = BadgeVariant.Info)
            CodeText(match.match)
            Caption("$atIndexLabel ${match.index}")
        }
    }
}

/** The surface's display strings, resolved once from the i18n facade (P1/S10) at the render boundary. */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per web `t()` call plus the flag presets.
private data class RegexTesterStrings(
    val title: String,
    val description: String,
    val pattern: String,
    val flags: String,
    val testString: String,
    val testStringHint: String,
    val matches: String,
    val atIndex: String,
    val flagOptions: List<SelectOption>,
)

/**
 * Resolves every web i18n key (and the literal flag-notation labels) through [resolveI18nKey] once per
 * locale, reproducing i18next's key-as-fallback. Memoized on the [Context] so a locale change
 * re-resolves while ordinary recomposition does not.
 */
@Composable
private fun rememberRegexTesterStrings(): RegexTesterStrings {
    val context = LocalContext.current
    return remember(context) {
        RegexTesterStrings(
            title = context.resolveI18nKey(RegexTesterModel.KEY_TITLE),
            description = context.resolveI18nKey(RegexTesterModel.KEY_DESCRIPTION),
            pattern = context.resolveI18nKey(RegexTesterModel.KEY_PATTERN),
            flags = context.resolveI18nKey(RegexTesterModel.KEY_FLAGS),
            testString = context.resolveI18nKey(RegexTesterModel.KEY_TEST_STRING),
            testStringHint = context.resolveI18nKey(RegexTesterModel.KEY_TEST_STRING_HINT),
            matches = context.resolveI18nKey(RegexTesterModel.KEY_MATCHES),
            atIndex = context.resolveI18nKey(RegexTesterModel.KEY_AT_INDEX),
            flagOptions =
                RegexTesterModel.FLAG_OPTIONS.map { option ->
                    SelectOption(value = option.value, label = context.resolveI18nKey(option.labelKey))
                },
        )
    }
}

/**
 * Resolves a web i18n key against the shared catalog (P1/S10): the localized string when the catalog
 * carries the key, otherwise the key text itself — reproducing i18next's key-as-fallback. The by-name
 * lookup is the only way to express "resolve if present, else fall back" (a compile-time `R.string`
 * reference cannot), so `DiscouragedApi` is suppressed; release builds keep resource names (shrinking
 * is off — see app/build.gradle.kts), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.resolveI18nKey(key: String): String {
    val resourceName = I18N_RESOURCE_PREFIX + NON_RESOURCE_CHARS.replace(key, "_")
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else key
}

/** The locally-authored lucide `Regex` glyph (Android ships no lucide equivalent), recolored by [Icon]. */
private object RegexTesterGlyphs {
    /** lucide `Regex` — square brackets around an asterisk and a literal dot. */
    val Regex: ImageVector =
        glyph("RegexTesterRegex") {
            moveTo(7f, 6f)
            lineTo(5f, 6f)
            lineTo(5f, 18f)
            lineTo(7f, 18f)
            moveTo(17f, 6f)
            lineTo(19f, 6f)
            lineTo(19f, 18f)
            lineTo(17f, 18f)
            moveTo(12f, 7f)
            lineTo(12f, 13f)
            moveTo(9.5f, 8.5f)
            lineTo(14.5f, 11.5f)
            moveTo(14.5f, 8.5f)
            lineTo(9.5f, 11.5f)
            circle(12f, 16.5f, 0.6f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = pathBuilder,
            )
        }.build()

/** Emits a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Previews — one per rendered state (populated matches / empty) ────────────────────────────────

@Preview(name = "RegexTester · matches", showBackground = true)
@Composable
private fun RegexTesterMatchesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegexTesterContent(
            pattern = RegexTesterModel.PATTERN_HINT,
            flags = RegexTesterModel.DEFAULT_FLAGS,
            testString = "order 123 then 45",
            matches = listOf(RegexMatch("123", 6), RegexMatch("45", 15)),
            onPatternChange = {},
            onFlagsChange = {},
            onTestStringChange = {},
        )
    }
}

@Preview(name = "RegexTester · empty", showBackground = true)
@Composable
private fun RegexTesterEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegexTesterContent(
            pattern = "",
            flags = RegexTesterModel.DEFAULT_FLAGS,
            testString = "",
            matches = emptyList(),
            onPatternChange = {},
            onFlagsChange = {},
            onTestStringChange = {},
        )
    }
}
