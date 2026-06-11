// The native Jetpack Compose + Material 3 Byte Size Converter feature view — a parity port of
// web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx. The web component is a self-contained
// developer tool wrapped in a `ToolCard` (a `GlassPanel` with a tinted hard-drive icon, a title, and a
// description): it renders a "Value" text field, a "Unit" select over `BYTE_UNITS`, and — once a finite value
// is typed — a five-cell grid of the value re-expressed in B/KB/MB/GB/TB, highlighting the chosen unit.
//
// The native surface keeps that contract. Its only web hook is `useTranslation`, mapped here to the i18n
// catalog (P1/S10); it performs NO HTTP and binds no feed (the unit ladder is a static constant and the
// conversions are pure math, owned by [ByteSizeConverterProjection]). Because the feature-view contract still
// flows through the shared state-holder layer (P1/S8), the surface also renders every lifecycle state that
// layer can carry — loading skeleton, hard error with retry, stale/offline freshness chip — even though the
// tool's default host state is always "ready" (it has nothing to fetch). The web's hidden conversions grid
// (no/invalid value) becomes an always-visible empty hint, so the panel is never a blank box. A web-parity
// overload with no host state renders the live interactive tool directly.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes; the web `lucide-react` HardDrive glyph is authored locally as a stroked vector (Android ships no
// equivalent without the frozen material-icons-extended artifact). `view.opened` is emitted once via the
// sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ByteSizeConverter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.bytesizeconverter

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
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
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f
private const val SELECTED_FILL_ALPHA: Float = 0.12f
private const val SELECTED_BORDER_ALPHA: Float = 0.30f
private val GLYPH_SIZE: Dp = 24.dp
private val CELL_MIN_WIDTH: Dp = 64.dp
private val CELL_BORDER_WIDTH: Dp = 1.dp
private val FIELD_SKELETON_HEIGHT: Dp = 56.dp
private val GRID_SKELETON_HEIGHT: Dp = 56.dp

/**
 * Stroked hard-drive glyph — the native analogue of the web `HardDrive` lucide icon (a drive body, a platter
 * divider, and two activity LEDs). Drawn monochrome and recolored at render time by the [Icon] tint.
 */
private val HardDriveGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "HardDrive",
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
                moveTo(3f, 8f)
                lineTo(21f, 8f)
                lineTo(21f, 16f)
                lineTo(3f, 16f)
                close()
                moveTo(3f, 12f)
                lineTo(21f, 12f)
                moveTo(7f, 14f)
                lineTo(7.1f, 14f)
                moveTo(10f, 14f)
                lineTo(10.1f, 14f)
            }
        }.build()

/**
 * Stateful entry point for the byte converter. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared feature-view layer can carry. The host owns the
 * lifecycle (P1/S8) and supplies [onRetry]; this view never performs HTTP.
 *
 * @param state the host lifecycle projection. The tool has no feed, so a host normally passes `Content`;
 *   `Loading`/`Error`/stale/offline are reproduced for full state coverage, never faked from a fetch.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ByteSizeConverter(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to ByteSizeConverterRegistration.SLUG))
    }
    ByteSizeConverterContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's self-contained, always-ready usage (no host feed). Renders
 * the live interactive tool directly in the `Content` phase. Records `view.opened` like the stateful entry;
 * there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ByteSizeConverter(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember { UiState(phase = UiPhase.Content, data = Unit) }
    ByteSizeConverter(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the `ToolCard`
 * header (icon + title + description), then switches on the host lifecycle: a loading skeleton, a hard-error
 * retry surface, or — when ready — a freshness chip (only while refreshing/stale/offline) above the
 * interactive calculator. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun ByteSizeConverterContent(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: ByteSizeConverterStrings = rememberByteSizeConverterStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberByteSizeFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        ByteSizeConverterHeader(strings = strings)
        Spacer(modifier = Modifier.height(Spacing.md))
        when (byteSizeSurfaceFor(isLoading = state.isLoading, isError = state.isError)) {
            ByteSizeSurfaceState.Loading ->
                ByteSizeConverterLoading(label = stringResource(R.string.translation_common_loading))
            ByteSizeSurfaceState.Error -> ByteSizeConverterError(onRetry = onRetry)
            ByteSizeSurfaceState.Ready -> {
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
                ByteSizeCalculator(strings = strings)
            }
        }
    }
}

/** The `ToolCard` header — a tinted hard-drive icon box beside the title + description. */
@Composable
private fun ByteSizeConverterHeader(strings: ByteSizeConverterStrings) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(imageVector = HardDriveGlyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            HelperText(strings.description)
        }
    }
}

/** The interactive body — the value field, the unit select, and the conversions grid or empty hint. */
@Composable
private fun ByteSizeCalculator(
    strings: ByteSizeConverterStrings,
    modifier: Modifier = Modifier,
) {
    var value by rememberSaveable { mutableStateOf("") }
    var unit by rememberSaveable { mutableStateOf(BYTE_UNITS.first()) }
    val locale = currentLocale()
    val formatNumber = remember(locale) { localizedNumberFormatter(locale) }
    val conversions =
        remember(value, unit, formatNumber) {
            ByteSizeConverterProjection.project(value, unit, formatNumber)
        }
    val unitOptions = remember { BYTE_UNITS.map { option -> SelectOption(value = option, label = option) } }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = value,
            onValueChange = { value = it },
            label = strings.valueLabel,
            hint = VALUE_INPUT_EXAMPLE,
            leadingIcon = HardDriveGlyph,
            keyboardType = KeyboardType.Number,
        )
        Select(
            options = unitOptions,
            selectedValue = unit,
            onSelect = { unit = it },
            label = strings.unitLabel,
        )
        val resolved = conversions
        if (resolved != null) {
            ByteConversionGrid(conversions = resolved)
        } else {
            EmptyState(
                message = strings.emptyHint,
                icon = HardDriveGlyph,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The five-cell conversions grid — a wrapping flow of equal-min-width cells (web `grid grid-cols-5`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ByteConversionGrid(
    conversions: List<ByteConversion>,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        conversions.forEach { conversion ->
            ByteConversionCell(conversion = conversion)
        }
    }
}

/** One conversion cell — unit label over the formatted value, highlighted when it is the chosen unit. */
@Composable
private fun ByteConversionCell(
    conversion: ByteConversion,
    modifier: Modifier = Modifier,
) {
    val accent = TeslaTokens.status.info
    val shape = RoundedCornerShape(Radius.sm)
    val background =
        if (conversion.selected) {
            accent.copy(alpha = SELECTED_FILL_ALPHA)
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        }
    val decorated =
        if (conversion.selected) {
            modifier
                .clip(shape)
                .background(background)
                .border(width = CELL_BORDER_WIDTH, color = accent.copy(alpha = SELECTED_BORDER_ALPHA), shape = shape)
        } else {
            modifier.clip(shape).background(background)
        }
    val description = ByteSizeConverterProjection.conversionCellDescription(conversion)
    Column(
        modifier =
            decorated
                .widthIn(min = CELL_MIN_WIDTH)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .clearAndSetSemantics {
                    contentDescription = description
                    if (conversion.selected) selected = true
                },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(conversion.unit)
        CodeText(conversion.value)
    }
}

/** First-load skeleton — two field-shaped bars and a grid-shaped bar so the panel is never blank. */
@Composable
private fun ByteSizeConverterLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = FIELD_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = FIELD_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = GRID_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ByteSizeConverterError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [ByteSizeConverterStrings]. `Value`/`Unit` resolve through compile-time resources;
 * `Byte Size`/`Byte Size Desc` and the empty hint resolve by-name with the web `t(key, default)` fallback,
 * since those keys exist in no catalog. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberByteSizeConverterStrings(): ByteSizeConverterStrings {
    val context = LocalContext.current
    val valueLabel = stringResource(R.string.translation_Value)
    val unitLabel = stringResource(R.string.translation_Unit)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val title = resolveOptional(lookup, KEY_TITLE, ByteSizeConverterDefaults.TITLE)
    val description = resolveOptional(lookup, KEY_DESCRIPTION, ByteSizeConverterDefaults.DESCRIPTION)
    val emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, ByteSizeConverterDefaults.EMPTY_HINT)
    return remember(title, description, valueLabel, unitLabel, emptyHint) {
        ByteSizeConverterStrings(
            title = title,
            description = description,
            valueLabel = valueLabel,
            unitLabel = unitLabel,
            emptyHint = emptyHint,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberByteSizeFreshnessFormatter(): (FreshnessAge) -> String {
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
