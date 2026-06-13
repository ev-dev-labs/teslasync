// The native Jetpack Compose + Material 3 Currency shared surface — a parity port of
// web/src/components/data-display/format/Currency.tsx. The web component is a passive inline `<span>` that
// reads `currencySymbol` from `useFormatting()` and renders `{symbol}{fmtNumber(value, precision)}`, exposing
// the canonical, locale-independent `{symbol}{value.toFixed(precision)}` via the `title` attribute, and falls
// back to "—" for a null / non-finite value. Its only data hook is `useFormatting` (→ `useSettings`); it has
// no i18n keys of its own.
//
// This port keeps that contract end to end. The amount is rendered as inline [Text] (the web span), the symbol
// + locale come from the shared Settings state-holder (P1/S8) through the [CurrencyViewModel] — the view does
// NO HTTP — and the canonical title is exposed as the value's accessibility `contentDescription` (the web
// `title`). The pure half (settings → format projection, the grouped/canonical formatters, the value/feed →
// render classification, the a11y labels, the diagnostic) lives in CurrencyModel.kt and is unit-tested
// off-device; this file is the thin render layer + the lifecycle binding.
//
// Every state the settings feed can carry renders (P3, no hidden surfaces) — but faithfully for an inline
// formatter (Honesty Covenant #9, documented not silent): the amount is ALWAYS shown (never a blank box), with
// the resolved symbol when present and the default `$` while loading / on a hard failure, exactly as the web
// hook degrades; the non-live feed states surface as a small informational freshness indicator + an
// accessibility state description rather than a retry button (the shared `/settings` document is refreshed by
// the Settings screen, not per-formatter — the web Currency likewise offers no retry). The surface's own
// "empty" is the web's null / non-finite fallback branch.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces/
// Currency) cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located
// render helpers + previews alongside the namesake composable.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currency

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Diameter of the inline freshness indicator (spinner / status glyph) — a compact, value-adjacent affordance. */
private val CURRENCY_INDICATOR_SIZE: Dp = 12.dp

/** Stroke width of the loading spinner — matches the shared `DataFreshness` compact dot. */
private val CURRENCY_INDICATOR_STROKE: Dp = 1.5.dp

/**
 * Stateful entry point for the Currency surface — the faithful port of the web `<Currency>`. Binds the shared
 * Settings symbol/locale feed (P1/S8) through a [CurrencyViewModel] built over the app's [LocalDataContainer],
 * records the one-shot PII-safe `view.opened` diagnostic (P1/S11), and renders the amount across every state
 * that feed can carry. Performs NO HTTP. [value] is the amount in the user's currency (rendered verbatim — no
 * FX conversion, exactly as the web). [precision] is the web prop (default 2); [symbolOverride] forces a symbol
 * (web `symbolOverride`); [fallback] is shown for a null / non-finite value (web `fallback`). [style] / [color]
 * are the native analogue of the web `className`, so the amount inherits its container's typography by default.
 */
@Composable
fun Currency(
    value: Double?,
    modifier: Modifier = Modifier,
    precision: Int = DEFAULT_CURRENCY_PRECISION,
    symbolOverride: String? = null,
    fallback: String = CURRENCY_FALLBACK,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
) {
    val container = LocalDataContainer.current
    val source = remember(container) { currencySource(container.settingsStore) }
    val viewModel: CurrencyViewModel =
        viewModel(factory = remember(source, container) { CurrencyViewModel.factory(source, container.logger) })
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val format by viewModel.format.collectAsStateWithLifecycle()
    CurrencyContent(
        value = value,
        format = format,
        modifier = modifier,
        precision = precision,
        symbolOverride = symbolOverride,
        fallback = fallback,
        style = style,
        color = color,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Classifies [value] against the
 * settings [format] feed (web inline branch) and renders the [CurrencyRender.Empty] fallback or the
 * [CurrencyRender.Amount]. The amount is inline [Text] whose accessibility `contentDescription` is the
 * canonical `{symbol}{value.toFixed(precision)}` (web `title`); a non-live symbol adds a compact freshness
 * indicator + an a11y state description. [style] / [color] map the web `className`.
 */
@Composable
fun CurrencyContent(
    value: Double?,
    format: UiState<CurrencyFormat>,
    modifier: Modifier = Modifier,
    precision: Int = DEFAULT_CURRENCY_PRECISION,
    symbolOverride: String? = null,
    fallback: String = CURRENCY_FALLBACK,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    labels: CurrencyLabels = rememberCurrencyLabels(),
) {
    when (val render = classifyCurrency(value, format, precision, symbolOverride, fallback)) {
        is CurrencyRender.Empty ->
            Text(text = render.text, modifier = modifier, style = style, color = color)

        is CurrencyRender.Amount ->
            CurrencyAmountRow(render = render, modifier = modifier, style = style, color = color, labels = labels)
    }
}

/**
 * Renders a finite amount as inline [Text] with the canonical value as its accessibility name and, for a
 * non-live symbol, a value-adjacent freshness indicator. The state description is announced on the amount so a
 * screen reader hears the freshness without an extra focus stop.
 */
@Composable
private fun CurrencyAmountRow(
    render: CurrencyRender.Amount,
    modifier: Modifier,
    style: TextStyle,
    color: Color,
    labels: CurrencyLabels,
) {
    val stateLabel = currencyStateLabel(render.freshness, labels)
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = render.display,
            style = style,
            color = color,
            modifier =
                Modifier.clearAndSetSemantics {
                    contentDescription = render.accessibleValue
                    if (stateLabel != null) stateDescription = stateLabel
                },
        )
        CurrencyFreshnessIndicator(freshness = render.freshness, labels = labels)
    }
}

/**
 * The compact, value-adjacent freshness affordance — nothing for a live symbol (a bare amount, identical to the
 * web span), a tiny spinner while loading/refreshing, and a status glyph (clock / wifi-off) carrying a
 * localized TalkBack label for the stale / offline / failed symbol. Informational only: the amount is already
 * rendered, so this never hides content nor blocks the value.
 */
@Composable
private fun CurrencyFreshnessIndicator(
    freshness: CurrencyFreshness,
    labels: CurrencyLabels,
) {
    when (freshness) {
        CurrencyFreshness.Live -> Unit

        CurrencyFreshness.Loading ->
            CircularProgressIndicator(
                modifier = Modifier.size(CURRENCY_INDICATOR_SIZE),
                strokeWidth = CURRENCY_INDICATOR_STROKE,
                color = MaterialTheme.colorScheme.primary,
            )

        CurrencyFreshness.Stale ->
            Icon(
                DataDisplayGlyphs.Clock,
                contentDescription = labels.stale,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )

        CurrencyFreshness.Offline ->
            Icon(
                DataDisplayGlyphs.WifiOff,
                contentDescription = labels.offline,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.error,
            )

        CurrencyFreshness.Failed ->
            Icon(
                DataDisplayGlyphs.WifiOff,
                contentDescription = labels.error,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.error,
            )
    }
}

/**
 * Builds the localized [CurrencyLabels] from the i18n catalog (P1/S10). The web Currency has no strings of its
 * own; these are the freshness-disclosure labels this native port adds for the non-live symbol states, all
 * resolved from existing shared keys so no English literal ships in code.
 */
@Composable
fun rememberCurrencyLabels(): CurrencyLabels {
    val loading = stringResource(R.string.translation_common_loading)
    val stale = stringResource(R.string.translation_mqtt_stale)
    val offline = stringResource(R.string.translation_common_offline)
    val error = stringResource(R.string.translation_freshness_error)
    return remember(loading, stale, offline, error) {
        CurrencyLabels(loading = loading, stale = stale, offline = offline, error = error)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_FORMAT = CurrencyFormat(symbol = "$", localeTag = "en-US")

private val PREVIEW_LABELS =
    CurrencyLabels(loading = "Loading\u2026", stale = "Stale", offline = "Offline", error = "error")

private const val PREVIEW_AMOUNT: Double = 1234.5

private const val PREVIEW_FETCHED_AT: Long = 1_700_000_000_000L

@Preview(name = "Content (live)", showBackground = true)
@Composable
private fun CurrencyContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(
            value = PREVIEW_AMOUNT,
            format = UiState(UiPhase.Content, data = PREVIEW_FORMAT),
            labels = PREVIEW_LABELS,
        )
    }
}

@Preview(name = "Empty (null value)", showBackground = true)
@Composable
private fun CurrencyEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(value = null, format = UiState(UiPhase.Content, data = PREVIEW_FORMAT), labels = PREVIEW_LABELS)
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun CurrencyLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(value = PREVIEW_AMOUNT, format = UiState.loading(), labels = PREVIEW_LABELS)
    }
}

@Preview(name = "Stale", showBackground = true)
@Composable
private fun CurrencyStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(
            value = PREVIEW_AMOUNT,
            format = UiState(UiPhase.Content, data = PREVIEW_FORMAT, stale = true, fetchedAt = PREVIEW_FETCHED_AT),
            labels = PREVIEW_LABELS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun CurrencyOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(
            value = PREVIEW_AMOUNT,
            format =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_FORMAT,
                    stale = true,
                    fetchedAt = PREVIEW_FETCHED_AT,
                    errorKind = ErrorKind.Network,
                ),
            labels = PREVIEW_LABELS,
        )
    }
}

@Preview(name = "Failed (no cache)", showBackground = true)
@Composable
private fun CurrencyFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyContent(
            value = PREVIEW_AMOUNT,
            format = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            labels = PREVIEW_LABELS,
        )
    }
}
