// The native Jetpack Compose + Material 3 GeneralSettings feature view — a parity port of
// web/src/features/settings/components/GeneralSettings.tsx. The web component is the application-
// preferences panel: a faded-in GlassPanel with a header (cyan IconBox + gear + title + subtitle), an
// optional "Sync from Car" panel and read-only car-clock panel (shown only when the vehicle reports unit
// preferences), the editable fields (distance / temperature / pressure units, preferred range, decimal
// precision, language, currency, number/date locale, time-zone display + override, electricity cost, gas
// price + unit, comparison MPG), and a Save button with an inline "Settings saved" confirmation.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the settings document,
// the vehicle list, the car preferences, and the save mutation only through the shared S8/S7 Settings
// state-holder seam ([GeneralSettingsSource]), folding the cache-then-network lifecycle through the shared
// [GeneralSettingsViewModel] + the pure [GeneralSettingsProjection]; the composable is a thin render layer
// that resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns,
// using the shared component library (ui GlassPanel/Button/Input/Select/IconBox/typography, feedback
// ErrorDisplay/Skeleton, data-display DataFreshness, motion FadeIn, local glyphs). It renders every state
// the prompt's matrix mandates without ever hiding a surface: loading (skeleton), the editable form
// (content, or DEFAULT values when no server data — never a blank box), a hard error with Retry, and a
// stale/offline/refreshing freshness chip over a cached form. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GeneralSettings) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.generalsettings

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.CarPreferences
import kotlinx.coroutines.delay

private const val FADE_DELAY_MS = 100
private const val FEEDBACK_DISMISS_MS = 3_000L
private val SKELETON_FIELD_HEIGHT = 56.dp
private const val SKELETON_FIELDS = 6
private val GAS_UNIT_WIDTH = 128.dp
private val PANEL_CORNER = Radius.md
private const val BULLET_SEP = " \u00b7 "
private const val SLASH_SEP = " / "
private const val KPA_LABEL = "kPa"

/** Language options — endonyms, intentionally NOT localized (the web `label: 'Deutsch'` literals). */
private val LANGUAGE_OPTIONS =
    listOf(
        "en" to "English",
        "de" to "Deutsch",
        "fr" to "Français",
        "es" to "Español",
        "zh" to "中文",
    )

/** Currency options — ISO code + glyph, intentionally literal (the web dropdown labels). */
private val CURRENCY_OPTIONS =
    listOf(
        "$" to "USD ($)",
        "€" to "EUR (€)",
        "£" to "GBP (£)",
        "C$" to "CAD (C$)",
        "A$" to "AUD (A$)",
        "¥" to "JPY (¥)",
        "元" to "CNY (元)",
        "CHF" to "CHF (CHF)",
        "kr" to "SEK / NOK / DKK (kr)",
        "₹" to "INR (₹)",
    )

/** Number/date locale options — format examples, intentionally literal (the web dropdown labels). */
private val LOCALE_OPTIONS =
    listOf(
        "en-US" to "English (US) — 1,234.56",
        "en-GB" to "English (UK) — 1,234.56",
        "de-DE" to "Deutsch (DE) — 1.234,56",
        "fr-FR" to "Français (FR) — 1 234,56",
        "es-ES" to "Español (ES) — 1.234,56",
        "ja-JP" to "日本語 (JP) — 1,234.56",
        "zh-CN" to "简体中文 (CN) — 1,234.56",
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `GeneralSettings()` component. Binds the shared
 * Settings feeds via [source] into a [GeneralSettingsViewModel], records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, collects the combined state, projects it, auto-dismisses the
 * transient feedback after a short delay (the web `setTimeout(…, 3000)`), and renders. The [source]
 * defaults to the app's shared S8 [io.teslasync.shared.core.presentation.settings.SettingsStore].
 *
 * @param source the cache-then-network Settings seam (shared store/repository adapter, or a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun GeneralSettings(
    modifier: Modifier = Modifier,
    source: GeneralSettingsSource = LocalDataContainer.current.settingsStore.asGeneralSettingsSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: GeneralSettingsViewModel =
        viewModel(
            key = GENERAL_SETTINGS_SLUG,
            factory = viewModelFactory { initializer { GeneralSettingsViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val display = remember(state) { GeneralSettingsProjection.project(state) }

    LaunchedEffect(display.feedback) {
        if (display.feedback != null) {
            delay(FEEDBACK_DISMISS_MS)
            viewModel.clearFeedback()
        }
    }

    GeneralSettingsContent(
        display = display,
        onEdit = viewModel::edit,
        onSave = viewModel::save,
        onSyncFromCar = viewModel::syncFromCar,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Draws the web layout: the faded-in
 * [GlassPanel] holding the always-present header, an optional stale/offline freshness chip, the body for
 * every state (loading skeleton / hard-error retry / the editable form with its conditional car panels),
 * and the bottom save block (transient feedback + unsaved hint + Save button).
 */
@Composable
fun GeneralSettingsContent(
    display: GeneralSettingsDisplay,
    onEdit: ((GeneralSettingsForm) -> GeneralSettingsForm) -> Unit,
    onSave: () -> Unit,
    onSyncFromCar: () -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            GeneralSettingsHeader()
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                if (display.status == GeneralSettingsStatus.Ready && display.isDegraded) {
                    GeneralSettingsFreshness(display = display, onRefresh = onRefresh)
                }
                when (display.status) {
                    GeneralSettingsStatus.Loading -> GeneralSettingsLoading()
                    GeneralSettingsStatus.Error -> GeneralSettingsError(onRetry = onRetry)
                    GeneralSettingsStatus.Ready -> GeneralSettingsForm(display = display, onEdit = onEdit, onSyncFromCar = onSyncFromCar)
                }
                if (display.status != GeneralSettingsStatus.Error) {
                    GeneralSettingsSaveBlock(display = display, onSave = onSave)
                }
            }
        }
    }
}

/** The panel header — the cyan IconBox + gear glyph + title + subtitle (web `flex items-center gap-3`). */
@Composable
private fun GeneralSettingsHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
            Icon(GeneralSettingsGlyphs.Settings, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(
                stringResource(R.string.translation_app_title),
                modifier = Modifier.semantics { heading() },
            )
            Caption(stringResource(R.string.translation_app_subtitle))
        }
    }
}

/** The stale / offline freshness chip + re-read control, shown only over a degraded last-known form. */
@Composable
private fun GeneralSettingsFreshness(
    display: GeneralSettingsDisplay,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = display.fetchedAtMillis?.takeIf { it > 0 },
            isFetching = display.refreshing,
            isStale = display.stale,
            isError = display.errorKind != null,
            errorLabel = stringResource(R.string.translation_common_offline),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !display.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The first-load skeleton — shimmering field rows with an accessible "loading" label. */
@Composable
private fun GeneralSettingsLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_FIELDS) { Skeleton(height = SKELETON_FIELD_HEIGHT, rounded = true) }
    }
}

/** The hard-error surface — the shared server-error message with a retry (web `QueryError` equivalent). */
@Composable
private fun GeneralSettingsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The editable form — the conditional car panels above every preference field. */
@Composable
private fun GeneralSettingsForm(
    display: GeneralSettingsDisplay,
    onEdit: ((GeneralSettingsForm) -> GeneralSettingsForm) -> Unit,
    onSyncFromCar: () -> Unit,
) {
    val form = display.form
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (display.showSyncPanel) {
            SyncFromCarPanel(car = requireNotNull(display.carPreferences), onSyncFromCar = onSyncFromCar)
        }
        if (display.showClockPanel) {
            CarClockPanel(uses24Hour = display.carUses24HourClock)
        }
        UnitFields(form = form, onEdit = onEdit)
        PreferenceFields(form = form, onEdit = onEdit)
        CostFields(form = form, onEdit = onEdit)
    }
}

/** The "Sync from Car" panel — web `border border-neon-cyan/20 bg-neon-cyan/5`. */
@Composable
private fun SyncFromCarPanel(
    car: CarPreferences,
    onSyncFromCar: () -> Unit,
) {
    val distance = carUnitText(CarUnitParsing.classify(car.distanceUnit, CarUnitParsing.Category.DISTANCE))
    val temperature = carUnitText(CarUnitParsing.classify(car.temperatureUnit, CarUnitParsing.Category.TEMPERATURE))
    val pressure = carUnitText(CarUnitParsing.classify(car.tirePressureUnit, CarUnitParsing.Category.PRESSURE))
    val carUses = "${stringResource(R.string.translation_app_carUses)} $distance$SLASH_SEP$temperature$SLASH_SEP$pressure"
    PanelRow(icon = GeneralSettingsGlyphs.Car, tint = IconBoxTone.Primary) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(carUses)
            Caption(stringResource(R.string.translation_app_syncHint))
        }
        Button(
            label = stringResource(R.string.translation_app_syncFromCar),
            onClick = onSyncFromCar,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            leadingIcon = GeneralSettingsGlyphs.Download,
        )
    }
}

/** The read-only car-clock panel — web `border-white/[0.06] bg-white/[0.03]`. */
@Composable
private fun CarClockPanel(uses24Hour: Boolean) {
    val format = stringResource(if (uses24Hour) R.string.translation_app_clock24h else R.string.translation_app_clock12h)
    PanelRow(icon = GeneralSettingsGlyphs.Clock, tint = IconBoxTone.Warning) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText("${stringResource(R.string.translation_app_carClockFormat)}:")
                Subhead(format)
            }
            Caption(stringResource(R.string.translation_app_clockFormatHint))
        }
    }
}

/** A bordered info row shared by the sync + clock panels (icon + content slot). */
@Composable
private fun PanelRow(
    icon: ImageVector,
    tint: IconBoxTone,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PANEL_CORNER))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(PANEL_CORNER))
                .padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Lg, tint = iconColorFor(tint))
        content()
    }
}

/** Distance / temperature / pressure / preferred-range unit selects. */
@Composable
private fun UnitFields(
    form: GeneralSettingsForm,
    onEdit: ((GeneralSettingsForm) -> GeneralSettingsForm) -> Unit,
) {
    Select(
        label = stringResource(R.string.translation_app_distanceUnit),
        options =
            listOf(
                SelectOption("km", stringResource(R.string.translation_app_kilometers)),
                SelectOption("mi", stringResource(R.string.translation_app_miles)),
            ),
        selectedValue = form.distanceUnit,
        onSelect = { value -> onEdit { it.copy(distanceUnit = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_temperatureUnit),
        options =
            listOf(
                SelectOption("C", stringResource(R.string.translation_app_celsius)),
                SelectOption("F", stringResource(R.string.translation_app_fahrenheit)),
            ),
        selectedValue = form.temperatureUnit,
        onSelect = { value -> onEdit { it.copy(temperatureUnit = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_pressureUnit),
        options =
            listOf(
                SelectOption("bar", stringResource(R.string.translation_app_bar)),
                SelectOption("psi", stringResource(R.string.translation_app_psi)),
            ),
        selectedValue = form.pressureUnit,
        onSelect = { value -> onEdit { it.copy(pressureUnit = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_preferredRange),
        options =
            listOf(
                SelectOption("rated", stringResource(R.string.translation_app_rated)),
                SelectOption("ideal", stringResource(R.string.translation_app_ideal)),
            ),
        selectedValue = form.preferredRange,
        onSelect = { value -> onEdit { it.copy(preferredRange = value) } },
    )
}

/** Decimal precision, language, currency, locale, and time-zone preferences. */
@Composable
private fun PreferenceFields(
    form: GeneralSettingsForm,
    onEdit: ((GeneralSettingsForm) -> GeneralSettingsForm) -> Unit,
) {
    NumberField(
        label = stringResource(R.string.translation_app_decimalPrecision),
        value = form.decimalPrecision.toString(),
        canonicalize = { (it.toIntOrNull()?.coerceIn(MIN_PRECISION, MAX_PRECISION) ?: MIN_PRECISION).toString() },
        keyboardType = KeyboardType.Number,
        hint = "${stringResource(R.string.translation_app_preview)}: ${decimalPreview(form.decimalPrecision)}",
        onValue = { text ->
            onEdit { it.copy(decimalPrecision = text.toIntOrNull()?.coerceIn(MIN_PRECISION, MAX_PRECISION) ?: MIN_PRECISION) }
        },
    )
    Select(
        label = stringResource(R.string.translation_app_language),
        options = LANGUAGE_OPTIONS.map { SelectOption(it.first, it.second) },
        selectedValue = form.language,
        onSelect = { value -> onEdit { it.copy(language = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_currency),
        options = CURRENCY_OPTIONS.map { SelectOption(it.first, it.second) },
        selectedValue = form.currencySymbol,
        onSelect = { value -> onEdit { it.copy(currencySymbol = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_locale),
        options = LOCALE_OPTIONS.map { SelectOption(it.first, it.second) },
        selectedValue = form.locale,
        onSelect = { value -> onEdit { it.copy(locale = value) } },
    )
    Select(
        label = stringResource(R.string.translation_app_tzDisplayDefault),
        options =
            listOf(
                SelectOption("vehicle", stringResource(R.string.translation_app_tzVehicle)),
                SelectOption("user", stringResource(R.string.translation_app_tzUser)),
                SelectOption("utc", stringResource(R.string.translation_app_tzUtc)),
            ),
        selectedValue = form.tzDisplayDefault,
        onSelect = { value -> onEdit { it.copy(tzDisplayDefault = value) } },
    )
    Input(
        label = stringResource(R.string.translation_app_timezoneUser),
        value = form.timezoneUser,
        onValueChange = { value -> onEdit { it.copy(timezoneUser = value) } },
        hint = stringResource(R.string.translation_app_timezoneUserHint),
    )
}

/** Electricity cost, gas price + unit, and comparison-MPG cost preferences. */
@Composable
private fun CostFields(
    form: GeneralSettingsForm,
    onEdit: ((GeneralSettingsForm) -> GeneralSettingsForm) -> Unit,
) {
    NumberField(
        label = stringResource(R.string.translation_app_electricityCost),
        value = displayNumber(form.baseCostPerKwh),
        canonicalize = { displayNumber(parseNumberOrZero(it)) },
        keyboardType = KeyboardType.Decimal,
        onValue = { text -> onEdit { it.copy(baseCostPerKwh = parseNumberOrZero(text)) } },
    )
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
        NumberField(
            label = stringResource(R.string.translation_app_gasPrice),
            value = displayNumber(form.gasPricePerUnit),
            canonicalize = { displayNumber(parseNumberOrZero(it)) },
            keyboardType = KeyboardType.Decimal,
            onValue = { text -> onEdit { it.copy(gasPricePerUnit = parseNumberOrZero(text)) } },
            modifier = Modifier.weight(1f),
        )
        Select(
            options =
                listOf(
                    SelectOption("gallon", stringResource(R.string.translation_app_perGallon)),
                    SelectOption("liter", stringResource(R.string.translation_app_perLiter)),
                ),
            selectedValue = form.gasUnit,
            onSelect = { value -> onEdit { it.copy(gasUnit = value) } },
            modifier = Modifier.width(GAS_UNIT_WIDTH),
        )
    }
    NumberField(
        label = stringResource(R.string.translation_app_comparisonMPG),
        value = displayNumber(form.gasEfficiencyMpg),
        canonicalize = { displayNumber(parseNumberOrZero(it)) },
        keyboardType = KeyboardType.Decimal,
        hint = stringResource(R.string.translation_app_mpgPlaceholder), // parity:allow i18n key name, not a stub
        onValue = { text -> onEdit { it.copy(gasEfficiencyMpg = parseNumberOrZero(text)) } },
    )
}

/**
 * A numeric [Input] that keeps an internal text buffer so partial entries ("0.", "") survive while typing,
 * re-seeding only when the canonical form value changes from outside (hydrate / sync) — never on the
 * field's own edits (which round-trip to the same canonical value). [canonicalize] maps raw text to the
 * form's stored representation so the re-seed comparison is exact.
 */
@Composable
private fun NumberField(
    label: String,
    value: String,
    canonicalize: (String) -> String,
    keyboardType: KeyboardType,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
    hint: String? = null,
) {
    var buffer by remember { mutableStateOf(value) }
    LaunchedEffect(value) {
        if (value != canonicalize(buffer)) buffer = value
    }
    Input(
        label = label,
        value = buffer,
        onValueChange = {
            buffer = it
            onValue(it)
        },
        hint = hint,
        keyboardType = keyboardType,
        modifier = modifier,
    )
}

/** The bottom save block — transient feedback, the unsaved-changes hint, and the Save button. */
@Composable
private fun GeneralSettingsSaveBlock(
    display: GeneralSettingsDisplay,
    onSave: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        display.feedback?.let { FeedbackRow(it) }
        if (display.isDirty) {
            HelperText(stringResource(R.string.translation_forms_unsavedSettings))
        }
        Button(
            label = stringResource(R.string.translation_app_save),
            onClick = onSave,
            variant = ButtonVariant.Primary,
            loading = display.saving,
            leadingIcon = GeneralSettingsGlyphs.Save,
        )
    }
}

/** The transient post-save/sync feedback — icon + title + detail, the web toast's two lines, inline. */
@Composable
private fun FeedbackRow(feedback: GeneralSettingsFeedback) {
    val title = feedbackTitle(feedback)
    val detail = feedbackDetail(feedback)
    val tone = feedbackColor(feedback.severity)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "$title. $detail" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(feedbackIcon(feedback), contentDescription = null, size = IconSize.Md, tint = tone)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Subhead(title)
            BodyText(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun feedbackTitle(feedback: GeneralSettingsFeedback): String =
    when (feedback) {
        GeneralSettingsFeedback.Saved -> stringResource(R.string.translation_app_settingsSaved)
        GeneralSettingsFeedback.SaveFailed -> stringResource(R.string.translation_toast_saveFailed)
        GeneralSettingsFeedback.NoChanges -> stringResource(R.string.translation_toast_noChanges)
        is GeneralSettingsFeedback.UnitsSynced -> stringResource(R.string.translation_toast_unitsSynced)
    }

@Composable
private fun feedbackDetail(feedback: GeneralSettingsFeedback): String =
    when (feedback) {
        GeneralSettingsFeedback.Saved -> stringResource(R.string.translation_toast_savedDesc)
        GeneralSettingsFeedback.SaveFailed -> stringResource(R.string.translation_toast_saveFailedDesc)
        GeneralSettingsFeedback.NoChanges -> stringResource(R.string.translation_toast_noChangesDesc)
        is GeneralSettingsFeedback.UnitsSynced -> {
            val distance = if (feedback.distanceMiles) R.string.translation_app_miles else R.string.translation_app_kilometers
            val temperature = if (feedback.temperatureFahrenheit) R.string.translation_app_fahrenheit else R.string.translation_app_celsius
            val pressure = if (feedback.pressurePsi) R.string.translation_app_psi else R.string.translation_app_bar
            listOf(stringResource(distance), stringResource(temperature), stringResource(pressure)).joinToString(BULLET_SEP)
        }
    }

@Composable
private fun feedbackIcon(feedback: GeneralSettingsFeedback): ImageVector =
    when (feedback) {
        GeneralSettingsFeedback.Saved -> GeneralSettingsGlyphs.CheckCircle
        GeneralSettingsFeedback.SaveFailed -> TeslaGlyphs.Octagon
        GeneralSettingsFeedback.NoChanges -> TeslaGlyphs.Info
        is GeneralSettingsFeedback.UnitsSynced -> GeneralSettingsGlyphs.Download
    }

@Composable
private fun feedbackColor(severity: FeedbackSeverity): Color =
    when (severity) {
        FeedbackSeverity.Success -> TeslaTokens.status.success
        FeedbackSeverity.Error -> TeslaTokens.status.danger
        FeedbackSeverity.Info -> TeslaTokens.status.info
    }

/** Resolves a parsed car-unit label to its localized string (web `parseSettingEnum` display). */
@Composable
private fun carUnitText(label: CarUnitLabel): String =
    when (label) {
        is CarUnitLabel.Raw -> label.value
        CarUnitLabel.Dash -> "\u2014"
        is CarUnitLabel.Known ->
            when (label.unit) {
                KnownCarUnit.MILES -> stringResource(R.string.translation_app_miles)
                KnownCarUnit.KILOMETERS -> stringResource(R.string.translation_app_kilometers)
                KnownCarUnit.CELSIUS -> stringResource(R.string.translation_app_celsius)
                KnownCarUnit.FAHRENHEIT -> stringResource(R.string.translation_app_fahrenheit)
                KnownCarUnit.PSI -> stringResource(R.string.translation_app_psi)
                KnownCarUnit.BAR -> stringResource(R.string.translation_app_bar)
                KnownCarUnit.KPA -> KPA_LABEL
            }
    }

// ── Previews — one per rendered state ───────────────────────────────────────────────────────────────────

private val PREVIEW_CAR =
    CarPreferences(
        distanceUnit = "DistanceUnitMiles",
        temperatureUnit = "TemperatureUnitFahrenheit",
        tirePressureUnit = "PressureUnitPsi",
        use24HourTime = true,
    )
private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewDisplay(
    status: GeneralSettingsStatus,
    car: CarPreferences? = null,
    feedback: GeneralSettingsFeedback? = null,
    isDirty: Boolean = false,
    stale: Boolean = false,
): GeneralSettingsDisplay =
    GeneralSettingsDisplay(
        status = status,
        form = GeneralSettingsForm.DEFAULT,
        carPreferences = car,
        isDirty = isDirty,
        saving = false,
        feedback = feedback,
        stale = stale,
        refreshing = false,
        offline = stale,
        canRetry = stale,
        fetchedAtMillis = PREVIEW_NOW,
        errorKind = null,
    )

@Composable
private fun PreviewHost(display: GeneralSettingsDisplay) {
    TeslaSyncTheme {
        GeneralSettingsContent(display = display, onEdit = {}, onSave = {}, onSyncFromCar = {}, onRetry = {}, onRefresh = {})
    }
}

@Preview(name = "GeneralSettings · content", showBackground = true)
@Composable
private fun GeneralSettingsContentPreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Ready, car = PREVIEW_CAR, isDirty = true))
}

@Preview(name = "GeneralSettings · default", showBackground = true)
@Composable
private fun GeneralSettingsDefaultPreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Ready))
}

@Preview(name = "GeneralSettings · loading", showBackground = true)
@Composable
private fun GeneralSettingsLoadingPreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Loading))
}

@Preview(name = "GeneralSettings · error", showBackground = true)
@Composable
private fun GeneralSettingsErrorPreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Error))
}

@Preview(name = "GeneralSettings · offline", showBackground = true)
@Composable
private fun GeneralSettingsOfflinePreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Ready, stale = true))
}

@Preview(name = "GeneralSettings · saved", showBackground = true)
@Composable
private fun GeneralSettingsSavedPreview() {
    PreviewHost(previewDisplay(GeneralSettingsStatus.Ready, feedback = GeneralSettingsFeedback.Saved))
}
