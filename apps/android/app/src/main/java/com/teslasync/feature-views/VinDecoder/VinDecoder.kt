// The native Jetpack Compose + Material 3 VIN Decoder feature view — a parity port of
// web/src/features/admin/components/devtools/tools/VinDecoder.tsx. The web tool is a self-contained
// client-side utility: it holds a VIN string in `useState('')`, a `useMemo` returns `null` until the
// string reaches 11 characters and otherwise decodes it into `{ mfr, model, drive, year, plant, serial }`
// (each unmatched lookup defaulting to `t('Unknown')`), and it renders a `ToolCard` (cyan `Car` icon,
// `t('Vin Decoder')` title, `t('Vin Decoder Desc')` description) containing a VIN `Input` (`t('Vin')`
// label + Car icon) and, once decoded, a two-up grid of label/value cards keyed by
// `t('devtools.utils.vin_<field>')`.
//
// The native surface keeps that contract: it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). To honour the shared lifecycle
// contract every P3 feature view follows, the stateful entry accepts the tool's *seed* VIN through the
// shared P1/S8 state-holder layer as a [UiState] — a host can supply a "start from this VIN" value (a
// scanned VIN, a deep-linked VIN, the selected vehicle's VIN) and it defaults to the web's empty string.
// That lets this view render every lifecycle state the seed feed can carry — loading skeleton, hard error
// with retry, content, empty (no seed → empty field), and stale/offline ("last known" seed + offline chip
// + auto-refresh) — without ever fetching. The interactive tool itself reproduces the web composition;
// when the typed VIN is too short to decode it shows a friendly empty surface in place of the grid (web
// renders nothing there) — never a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VinDecoder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vindecoder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
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

// The web tool's ghost prompt VIN ("5YJ3E1EA1NF000001") — a sample shown in the empty field, rendered
// verbatim rather than via `t()`. The native Input wrapper surfaces it as supporting text below the field.
private const val EXAMPLE_VIN = "5YJ3E1EA1NF000001"

private const val GRID_COLUMNS = 2
private const val GRID_ROWS = 3

/**
 * Stateful entry point for the VIN Decoder tool. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared *seed* feed can carry. The host owns the seed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the tool's initial VIN (defaults to empty when the
 *   seed is absent). The interactive tool is fully usable regardless — the seed only chooses where it opens.
 * @param onRetry re-runs the host's seed load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VinDecoder(
    state: UiState<String>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to VinDecoderRegistration.SLUG))
    }
    VinDecoderContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web tool's self-contained form, for hosts that just want to drop the
 * decoder in at a fixed starting VIN (default empty, matching the web `useState('')`). Records
 * `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun VinDecoder(
    initialVin: String = "",
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val phase = if (initialVin.isEmpty()) UiPhase.Empty else UiPhase.Content
    val state = remember(initialVin) { UiState(phase = phase, data = initialVin) }
    VinDecoder(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the ToolCard
 * header (icon + title + description, web parity), then switches the body: a loading skeleton, a hard-error
 * retry surface, or the interactive tool seeded from [state]. A freshness/offline chip is shown in the
 * header whenever cached seed data is refreshing/stale/errored, and a stale (non-error) seed auto-refreshes
 * — mirroring the shared freshness contract.
 */
@Composable
fun VinDecoderContent(
    state: UiState<String>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: VinDecoderStrings = rememberVinDecoderStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberVinDecoderFreshnessFormatter()
    val showFreshness = !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        VinDecoderHeader(
            strings = strings,
            showFreshness = showFreshness,
            fetchedAt = state.fetchedAt,
            refreshing = state.refreshing,
            stale = state.stale,
            hasError = state.hasError,
            formatAge = formatAge,
        )
        when {
            state.isLoading -> VinDecoderLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> VinDecoderError(onRetry = onRetry)
            else -> VinDecoderTool(seedVin = state.data.orEmpty(), strings = strings)
        }
    }
}

/** The ToolCard header — cyan Car [IconBox] + title + description, with an optional freshness chip. */
@Composable
private fun VinDecoderHeader(
    strings: VinDecoderStrings,
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
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(CarGlyph, contentDescription = null, size = IconSize.Lg)
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
 * The interactive decoder — the web tool's body. A VIN [Input] (Car icon, [VinDecoderStrings.vinLabel]
 * label, sample-VIN supporting text) sits above the decoded grid. When the typed VIN is at least 11
 * characters the [VinDecoderGrid] renders the six fields; otherwise a friendly [VinDecoderEmpty] replaces
 * the grid (web renders nothing there) — never a blank panel.
 */
@Composable
private fun VinDecoderTool(
    seedVin: String,
    strings: VinDecoderStrings,
) {
    var vin by rememberSaveable(seedVin) { mutableStateOf(seedVin) }
    val decoded = remember(vin) { VinDecoderProjection.decode(vin) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = vin,
            onValueChange = { vin = it },
            modifier = Modifier.fillMaxWidth(),
            label = strings.vinLabel,
            hint = EXAMPLE_VIN,
            leadingIcon = CarGlyph,
            singleLine = true,
            keyboardType = KeyboardType.Ascii,
        )
        if (decoded != null) {
            VinDecoderGrid(decoded = decoded, strings = strings)
        } else {
            VinDecoderEmpty(strings = strings)
        }
    }
}

/**
 * The two-up grid of decoded fields — the web `grid sm:grid-cols-2`. Renders the six fields (manufacturer,
 * model, drive, year, plant, serial) in order, two per row; a trailing partial row keeps its single card
 * left-aligned via a flexible spacer.
 */
@Composable
private fun VinDecoderGrid(
    decoded: DecodedVin,
    strings: VinDecoderStrings,
) {
    val fields = vinFields(decoded, strings)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        fields.chunked(GRID_COLUMNS).forEach { rowFields ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowFields.forEach { field ->
                    VinDecoderField(label = field.label, value = field.value, modifier = Modifier.weight(1f))
                }
                if (rowFields.size < GRID_COLUMNS) {
                    Spacer(Modifier.weight((GRID_COLUMNS - rowFields.size).toFloat()))
                }
            }
        }
    }
}

/**
 * One decoded-field card — a tinted surface (web `bg-[var(--surface-overlay)]`) with a muted [label]
 * (web `text-xs text-secondary`) above the [value] (web `text-sm font-medium`).
 */
@Composable
private fun VinDecoderField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(label)
            BodyText(value)
        }
    }
}

/** Friendly empty surface shown when the typed VIN is too short to decode — never a blank box. */
@Composable
private fun VinDecoderEmpty(strings: VinDecoderStrings) {
    EmptyState(
        message = strings.emptyHint,
        icon = CarGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — input + decoded-card outlines so the panel is never blank while seeding. */
@Composable
private fun VinDecoderLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(modifier = Modifier.fillMaxWidth(), height = INPUT_SKELETON_HEIGHT)
        repeat(GRID_ROWS) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(modifier = Modifier.weight(1f), height = CARD_SKELETON_HEIGHT)
                Skeleton(modifier = Modifier.weight(1f), height = CARD_SKELETON_HEIGHT)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun VinDecoderError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** One label/value pair to render in the decoded grid; both strings are already localized/resolved. */
private data class VinField(
    val label: String,
    val value: String,
)

/**
 * Projects a [DecodedVin] into the ordered label/value pairs the grid renders (web `Object.entries` order:
 * manufacturer, model, drive, year, plant, serial). Each unrecognized lookup folds to the localized
 * `Unknown` (web `?? t('Unknown')`); a blank serial renders as an em dash rather than an empty card.
 */
private fun vinFields(
    decoded: DecodedVin,
    strings: VinDecoderStrings,
): List<VinField> =
    listOf(
        VinField(strings.mfrLabel, decoded.mfr ?: strings.unknown),
        VinField(strings.modelLabel, decoded.model ?: strings.unknown),
        VinField(strings.driveLabel, decoded.drive ?: strings.unknown),
        VinField(strings.yearLabel, decoded.year ?: strings.unknown),
        VinField(strings.plantLabel, decoded.plant ?: strings.unknown),
        VinField(strings.serialLabel, decoded.serial.ifBlank { EM_DASH }),
    )

/**
 * Localized microcopy the surface renders — the web `t()` keys (`Vin Decoder`, `Vin Decoder Desc`, `Vin`,
 * `Unknown`, and the six `devtools.utils.vin_*` field labels) plus a native too-short hint. The composable
 * builds this from `stringResource`; tests pass a deterministic instance.
 */
data class VinDecoderStrings(
    val title: String,
    val description: String,
    val vinLabel: String,
    val emptyHint: String,
    val unknown: String,
    val mfrLabel: String,
    val modelLabel: String,
    val driveLabel: String,
    val yearLabel: String,
    val plantLabel: String,
    val serialLabel: String,
)

@Composable
private fun rememberVinDecoderStrings(): VinDecoderStrings {
    val title = stringResource(R.string.translation_Vin_Decoder)
    val description = stringResource(R.string.translation_Vin_Decoder_Desc)
    val vinLabel = stringResource(R.string.translation_Vin)
    val emptyHint = stringResource(R.string.translation_Vin_Decoder_Empty)
    val unknown = stringResource(R.string.translation_Unknown)
    val mfrLabel = stringResource(R.string.translation_devtools_utils_vin_mfr)
    val modelLabel = stringResource(R.string.translation_devtools_utils_vin_model)
    val driveLabel = stringResource(R.string.translation_devtools_utils_vin_drive)
    val yearLabel = stringResource(R.string.translation_devtools_utils_vin_year)
    val plantLabel = stringResource(R.string.translation_devtools_utils_vin_plant)
    val serialLabel = stringResource(R.string.translation_devtools_utils_vin_serial)
    return remember(
        title,
        description,
        vinLabel,
        emptyHint,
        unknown,
        mfrLabel,
        modelLabel,
        driveLabel,
        yearLabel,
        plantLabel,
        serialLabel,
    ) {
        VinDecoderStrings(
            title = title,
            description = description,
            vinLabel = vinLabel,
            emptyHint = emptyHint,
            unknown = unknown,
            mfrLabel = mfrLabel,
            modelLabel = modelLabel,
            driveLabel = driveLabel,
            yearLabel = yearLabel,
            plantLabel = plantLabel,
            serialLabel = serialLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberVinDecoderFreshnessFormatter(): (FreshnessAge) -> String {
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Self-contained "car" glyph — the native analogue of the web's `lucide-react` `Car` icon. Authored
 * locally because `TeslaGlyphs` has no car and is outside this surface's allowed files. A round-capped
 * body-and-cabin silhouette over two wheels; drawn opaque-black and recoloured at render by [Icon]'s tint
 * so it inherits every theme/state colour.
 */
private val CarGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Car",
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
                moveTo(3f, 13.5f)
                lineTo(3f, 11.5f)
                lineTo(5.5f, 11.5f)
                lineTo(7.5f, 7.5f)
                lineTo(15f, 7.5f)
                lineTo(17.5f, 11.5f)
                lineTo(21f, 11.5f)
                lineTo(21f, 13.5f)
                close()
                moveTo(5.7f, 15.5f)
                arcTo(1.8f, 1.8f, 0f, false, true, 9.3f, 15.5f)
                arcTo(1.8f, 1.8f, 0f, false, true, 5.7f, 15.5f)
                close()
                moveTo(14.7f, 15.5f)
                arcTo(1.8f, 1.8f, 0f, false, true, 18.3f, 15.5f)
                arcTo(1.8f, 1.8f, 0f, false, true, 14.7f, 15.5f)
                close()
            }
        }.build()

private val INPUT_SKELETON_HEIGHT = 56.dp
private val CARD_SKELETON_HEIGHT = 48.dp
