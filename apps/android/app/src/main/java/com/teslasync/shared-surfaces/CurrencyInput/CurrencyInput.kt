// The native Jetpack Compose + Material 3 CurrencyInput shared surface — a parity port of
// web/src/components/forms/CurrencyInput.tsx (+ its lib/currencyFormat.ts dependency). The web primitive is a
// currency-aware number field that stores its value in integer micro-units, renders it locale-currency
// formatted, parses accounting-aware currency text on blur / Enter, and re-syncs from the parent's value only
// while unfocused so it never clobbers in-progress typing. This surface keeps that contract end to end and
// renders every state the prompt's matrix mandates without ever hiding a region: loading (the first settings
// fetch's skeleton), editable (the field — value present is "content", absent is the web `valueMicro == null`
// empty branch, both fully editable), a hard error with Retry, and a stale/offline freshness chip over the
// cached preferences.
//
// It performs NO HTTP and binds the default currency + locale only through the shared S8/S7 Settings seam
// ([CurrencyInputSettingsSource]) folded through [CurrencyInputViewModel] + the pure [CurrencyInputProjection];
// the field's value is the caller's `valueMicro` (the web `valueMicro` prop) and commits flow back through
// `onChange` (the web `onChange`). The pure half (format/parse/symbol/projection/diagnostics) lives in
// CurrencyInputModel.kt and is unit-tested off-device; this file is the thin render + lifecycle layer, using
// the shared component library (ui Input/GlassPanel/StatusPill/typography, feedback QueryError/Skeleton, motion
// FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Faithful adaptation (Honesty Covenant #9 — documented, not silent): the web renders the bare currency
// `symbol` as a decorative leading `icon` inside its `<Input>`. The shared native `Input` counterpart exposes
// a vector-only leading slot (no text), and modifying it is out of scope, so the symbol is surfaced as the
// field's supporting `hint` instead — same "this field is in {currency}" affordance, idiomatic Material
// position. The field value itself still carries the locale-currency string (symbol included), and the parser
// still accepts the symbol / ISO code / group separators / accounting parens, so paste round-trips work.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CurrencyInput) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currencyinput

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the parity port of the web `CurrencyInput`. Binds the shared Settings feed via
 * [source] into a [CurrencyInputViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the settings [io.teslasync.android.data.UiState], projects it (with the caller's
 * [currency]/[locale] overrides) into a [CurrencyInputDisplay], auto-refreshes a stale cache, and renders.
 *
 * @param valueMicro canonical integer micro-units (1 major unit = 1_000_000); `null` ⇒ an empty field.
 * @param onChange called with the new canonical micro value (or `null` when blank) on commit (blur / Done).
 * @param currency optional ISO 4217 code (web `currency` prop); `null` ⇒ derive from the settings symbol.
 * @param locale optional BCP-47 tag (web `locale` prop); `null` ⇒ derive from the settings locale.
 * @param precision fraction digits to display (web `precision`, default 2). Storage keeps full micro precision.
 * @param ariaLabel the field's accessible name (web required `ariaLabel`); defaults to the electricity-cost key.
 * @param source the cache-then-network Settings seam (shared store/repository adapter, or a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CurrencyInput(
    valueMicro: Long?,
    onChange: (CurrencyInputChange) -> Unit,
    modifier: Modifier = Modifier,
    currency: String? = null,
    locale: String? = null,
    precision: Int = DEFAULT_CURRENCY_PRECISION,
    ariaLabel: String = stringResource(R.string.translation_settings_electricityCost),
    source: CurrencyInputSettingsSource = LocalDataContainer.current.settingsStore.asCurrencyInputSettingsSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: CurrencyInputViewModel =
        viewModel(key = CURRENCY_INPUT_SLUG, factory = CurrencyInputViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val display = remember(settings, currency, locale) { CurrencyInputProjection.project(settings, currency, locale) }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        CurrencyInputContent(
            valueMicro = valueMicro,
            onChange = onChange,
            display = display,
            strings = rememberCurrencyInputStrings(ariaLabel),
            precision = precision,
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless CurrencyInput card — renders every branch the surface draws plus the settings document's
 * lifecycle: loading skeleton, the editable field (value present or empty), and the classified error with
 * retry, with a stale/offline freshness chip over the cached preferences. Hoisted out of the ViewModel so it
 * is preview- and screenshot-testable for each state.
 */
@Composable
fun CurrencyInputContent(
    valueMicro: Long?,
    onChange: (CurrencyInputChange) -> Unit,
    display: CurrencyInputDisplay,
    strings: CurrencyInputStrings,
    modifier: Modifier = Modifier,
    precision: Int = DEFAULT_CURRENCY_PRECISION,
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        when (display.phase) {
            CurrencyInputPhase.Loading -> CurrencyInputLoading(strings = strings)
            CurrencyInputPhase.Error ->
                QueryError(
                    kind = CurrencyInputProjection.queryErrorKind(display),
                    resourceName = strings.label,
                    onRetry = onRetry,
                )
            CurrencyInputPhase.Editable ->
                CurrencyInputField(
                    valueMicro = valueMicro,
                    onChange = onChange,
                    display = display,
                    strings = strings,
                    precision = precision,
                )
        }
    }
}

/**
 * The editable field — the heart of the web primitive. Keeps a local text buffer separate from the canonical
 * [valueMicro] so typing is never interrupted; the buffer re-syncs to the canonical display only while
 * unfocused (web's focus-guarded resync), and commits on blur by parsing the text and emitting the canonical
 * micro value via [onChange], then renormalising the visible text.
 */
@Composable
private fun CurrencyInputField(
    valueMicro: Long?,
    onChange: (CurrencyInputChange) -> Unit,
    display: CurrencyInputDisplay,
    strings: CurrencyInputStrings,
    precision: Int,
) {
    val formatted =
        remember(valueMicro, display.currency, display.locale, precision) {
            formatCurrencyMicro(valueMicro, display.currency, display.locale, precision)
        }
    var text by remember { mutableStateOf(formatted) }
    var focused by remember { mutableStateOf(false) }

    // Resync the buffer when the canonical display changes — but only when the user is NOT editing, so an
    // external value / currency / locale change doesn't clobber in-progress input (web `focusedRef` guard).
    LaunchedEffect(formatted) {
        if (!focused) text = formatted
    }

    fun commit() {
        val micro = parseCurrencyTextToMicro(text, display.currency, display.locale)
        onChange(CurrencyInputChange(micro))
        text = formatCurrencyMicro(micro, display.currency, display.locale, precision)
    }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (display.showFreshnessChip) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                CurrencyInputFreshnessChip(display = display, strings = strings)
            }
        }
        Input(
            value = text,
            onValueChange = { text = it },
            modifier =
                Modifier.onFocusChanged { state ->
                    if (focused && !state.isFocused) commit()
                    focused = state.isFocused
                },
            label = strings.label,
            hint = display.symbol,
            keyboardType = KeyboardType.Decimal,
        )
    }
}

@Composable
private fun CurrencyInputFreshnessChip(
    display: CurrencyInputDisplay,
    strings: CurrencyInputStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offline, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.stale, tone = StatusTone.Warning)
    }
}

@Composable
private fun CurrencyInputLoading(strings: CurrencyInputStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LABEL_SKELETON_FRACTION, height = LABEL_SKELETON_HEIGHT)
        Skeleton(widthFraction = FIELD_SKELETON_FRACTION, height = FIELD_SKELETON_HEIGHT)
    }
}

/**
 * Localized labels the surface folds into its output. The field [label] is the web required `ariaLabel`
 * (default: the shared electricity-cost key, the web usage example); the rest are the freshness-disclosure
 * labels this native port adds for the non-live preference states. Every string resolves through the P1/S10
 * catalog — no English literal ships in code.
 */
data class CurrencyInputStrings(
    val label: String,
    val loading: String,
    val stale: String,
    val offline: String,
)

/** Builds the localized [CurrencyInputStrings] from the i18n catalog (P1/S10); tests pass a deterministic one. */
@Composable
fun rememberCurrencyInputStrings(label: String): CurrencyInputStrings {
    val loading = stringResource(R.string.translation_a11y_loading)
    val stale = stringResource(R.string.translation_mqtt_stale)
    val offline = stringResource(R.string.translation_common_offline)
    return remember(label, loading, stale, offline) {
        CurrencyInputStrings(label = label, loading = loading, stale = stale, offline = offline)
    }
}

private const val LABEL_SKELETON_FRACTION = 0.5f
private const val FIELD_SKELETON_FRACTION = 1f
private val LABEL_SKELETON_HEIGHT = 12.dp
private val FIELD_SKELETON_HEIGHT = 56.dp

// ── Previews — one per rendered state (loading / content / empty / stale / offline / error). ────────────

private const val PREVIEW_VALUE_MICRO = 1_500_000L
private const val PREVIEW_HTTP_ERROR = 503

private fun previewStrings(): CurrencyInputStrings =
    CurrencyInputStrings(label = "Electricity Cost (per kWh)", loading = "Loading", stale = "Stale", offline = "Offline")

private fun previewDisplay(
    phase: CurrencyInputPhase = CurrencyInputPhase.Editable,
    stale: Boolean = false,
    offline: Boolean = false,
    errorKind: ErrorKind? = null,
    httpStatus: Int? = null,
): CurrencyInputDisplay =
    CurrencyInputDisplay(
        phase = phase,
        currency = "USD",
        locale = "en-US",
        symbol = "$",
        stale = stale,
        offline = offline,
        errorKind = errorKind,
        httpStatus = httpStatus,
    )

@Preview(name = "CurrencyInput · loading", showBackground = true)
@Composable
private fun CurrencyInputLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = PREVIEW_VALUE_MICRO,
            onChange = {},
            display = previewDisplay(phase = CurrencyInputPhase.Loading),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CurrencyInput · content", showBackground = true)
@Composable
private fun CurrencyInputContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = PREVIEW_VALUE_MICRO,
            onChange = {},
            display = previewDisplay(),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CurrencyInput · empty", showBackground = true)
@Composable
private fun CurrencyInputEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = null,
            onChange = {},
            display = previewDisplay(),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CurrencyInput · stale", showBackground = true)
@Composable
private fun CurrencyInputStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = PREVIEW_VALUE_MICRO,
            onChange = {},
            display = previewDisplay(stale = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CurrencyInput · offline", showBackground = true)
@Composable
private fun CurrencyInputOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = PREVIEW_VALUE_MICRO,
            onChange = {},
            display = previewDisplay(stale = true, offline = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CurrencyInput · error", showBackground = true)
@Composable
private fun CurrencyInputErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CurrencyInputContent(
            valueMicro = PREVIEW_VALUE_MICRO,
            onChange = {},
            display =
                previewDisplay(phase = CurrencyInputPhase.Error, errorKind = ErrorKind.Http, httpStatus = PREVIEW_HTTP_ERROR),
            strings = previewStrings(),
        )
    }
}
