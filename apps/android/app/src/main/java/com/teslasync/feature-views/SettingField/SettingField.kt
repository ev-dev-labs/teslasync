// The native Jetpack Compose + Material 3 SettingField feature view — a parity port of
// web/src/features/settings/components/SettingField.tsx. The web component is the settings form's field
// wrapper: a `<div>` holding a label row (`flex items-center gap-1`, `mb-1.5`) whose `<label>` is a small,
// medium-weight, `uppercase tracking-wider`, muted text, followed by an optional inline `<HelpIcon>`, with
// the field control (`children`) rendered directly beneath.
//
// This native surface keeps that contract end to end. It is purely presentational — it performs NO HTTP and
// binds NO data hook (the owning settings page resolves the label through its own `t()` and supplies the
// children), so there are no loading / error / stale / offline phases here; the only branches the web source
// defines are the help-present-vs-absent split and the empty-help-text guard, both reproduced via the pure
// [SettingFieldProjection]. The composable is a thin render layer: it maps the web `<label>` onto the shared
// [FieldLabelText] role (P1/S9: labelLarge = 12sp / Medium / 0.6sp tracking / onSurfaceVariant — the web
// `text-xs font-medium tracking-wider text-[var(--text-muted)]`), applies the `uppercase` transform via the
// projection, and maps the web `<HelpIcon>` onto the shared [HelpIcon]. Help text + the per-field accessible
// name resolve through the P1/S10 catalog (the dynamic `help.i18nKey` via a `getIdentifier`-backed lookup —
// the analogue of the web dynamic `t(key, default)`; the `a11y.helpFor` / `help.tooltip.iconLabel` aria keys
// via compile-time `R.string` references). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted
// on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SettingField — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.settingfield

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.Input
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// Web `mb-1.5` (0.375rem = 6px) margin below the label row, before the field control. No design-token maps
// exactly onto 6dp (the 4dp grid skips it), so the verbatim web value is named here.
private val LABEL_BOTTOM_GAP: Dp = 6.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `SettingField({ label, help, children })` props.
 * Records the one-shot `view.opened` diagnostic on first composition (P1/S11) and renders the field wrapper.
 * The surface binds no data of its own; the caller supplies the already-localized [label], the optional
 * [help] descriptor, and the field control via [content] (web `children`).
 *
 * @param label the field label, already localized by the owning page (web `label`); rendered uppercased.
 * @param help optional inline-help descriptor (web `help`); when it resolves to text, an inline help icon
 *   is shown next to the label.
 * @param content the field control rendered beneath the label (web `children`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SettingField(
    label: String,
    modifier: Modifier = Modifier,
    help: SettingFieldHelp? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { SettingFieldDiagnostics.recordViewOpened(logger) }
    SettingFieldContent(label = label, modifier = modifier, help = help, content = content)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a column
 * (web root `<div>`) holding a label row (web `flex items-center gap-1 mb-1.5`) of the uppercased
 * [FieldLabelText] plus an optional [HelpIcon], with the field control ([content], web `children`) directly
 * beneath. The help icon renders only when [SettingFieldProjection.resolveHelp] yields text (web HelpIcon
 * `if (!text) return null`); its accessible name is "Help for {forId}" when a field id is present, else the
 * generic "More info" (web HelpIcon aria-label ternary).
 */
@Composable
fun SettingFieldContent(
    label: String,
    modifier: Modifier = Modifier,
    help: SettingFieldHelp? = null,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val locale: Locale = LocalConfiguration.current.locales[0]
    val displayLabel = remember(label, locale) { SettingFieldProjection.displayLabel(label, locale) }
    val resolvedHelp =
        remember(help, context) {
            SettingFieldProjection.resolveHelp(help) { key, fallback ->
                context.optionalString(SettingFieldProjection.foldCatalogKey(key)) ?: fallback
            }
        }

    Column(modifier = modifier) {
        Row(
            modifier = Modifier.padding(bottom = LABEL_BOTTOM_GAP),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FieldLabelText(displayLabel)
            if (resolvedHelp != null) {
                HelpIcon(
                    text = resolvedHelp.text,
                    contentDescription = helpAccessibleName(resolvedHelp.fieldId),
                )
            }
        }
        content()
    }
}

/**
 * The help icon's accessible name — the web HelpIcon aria-label rule (web/src/components/ui/HelpIcon.tsx
 * L71-75): `forId ? t('a11y.helpFor', { field: forId }) : t('help.tooltip.iconLabel')`. Both keys are static
 * so they resolve through compile-time `R.string` references; `translation_a11y_helpFor` carries the `%1$s`
 * field-name format argument.
 */
@Composable
private fun helpAccessibleName(fieldId: String?): String =
    fieldId?.let { stringResource(R.string.translation_a11y_helpFor, it) }
        ?: stringResource(R.string.translation_help_tooltip_iconLabel)

/**
 * Optional by-name read from the Android string catalog — the production seam reproducing web
 * `t(key, default)` for the dynamic `help.i18nKey`. `getIdentifier` is the only way to attempt a key that may
 * be absent (a compile-time `R.string` reference cannot express "resolve if present, else fall back"), so
 * `DiscouragedApi` is suppressed. Release builds keep resource names (resource shrinking is off), so the
 * lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Previews (tooling-only; @Preview entry points exercise help present / absent and the label transform) ──

private const val PREVIEW_WIDTH_DP = 320

@Composable
private fun PreviewTextField(initial: String) {
    var value by rememberSaveable { mutableStateOf(initial) }
    Input(value = value, onValueChange = { value = it }, modifier = Modifier.fillMaxWidth())
}

@Preview(name = "With help (i18n + field id)", showBackground = true)
@Composable
private fun SettingFieldWithHelpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingFieldContent(
            label = "Electricity Cost (per kWh)",
            modifier = Modifier.width(PREVIEW_WIDTH_DP.dp),
            help =
                SettingFieldHelp(
                    i18nKey = "help.fields.settings.electricityCost",
                    content = "Cost per kWh used to compute charging spend across drives and TCO analytics.",
                    forId = "electricity-cost",
                ),
        ) {
            PreviewTextField(initial = "0.14")
        }
    }
}

@Preview(name = "Without help", showBackground = true)
@Composable
private fun SettingFieldNoHelpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingFieldContent(
            label = "Comparison Vehicle MPG",
            modifier = Modifier.width(PREVIEW_WIDTH_DP.dp),
        ) {
            PreviewTextField(initial = "25")
        }
    }
}

@Preview(name = "Help via content only (no field id)", showBackground = true)
@Composable
private fun SettingFieldContentHelpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingFieldContent(
            label = "Gas Price (for EV vs ICE comparison)",
            modifier = Modifier.width(PREVIEW_WIDTH_DP.dp),
            help = SettingFieldHelp(content = "Used to compute fuel savings versus driving an EV."),
        ) {
            PreviewTextField(initial = "3.45")
        }
    }
}
