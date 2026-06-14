// The native Jetpack Compose + Material 3 HelpIcon shared surface — a parity port of
// web/src/components/ui/HelpIcon.tsx. The web surface is the field-level `(?)` help primitive placed next to a form
// label: hover / focus / tap reveals explanatory copy through the shared Tooltip, with a per-field accessible name
// ("Help for {field}") so screen readers announce which control the help documents rather than a generic "More
// info". It renders NOTHING when no help copy is supplied, so adopting call-sites never have to gate the icon
// themselves when a help string is conditionally absent.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the hidden
// branch (no copy ⇒ nothing) and the shown branch, crossed with the three accessible-name outcomes (explicit
// override, per-field name, generic name) — without ever inventing a state the web source lacks. It performs NO
// HTTP and binds NO state holder (the web component fetches nothing; see HelpIconModel.kt for the honesty
// rationale and why the generic loading/empty/error/stale/offline states, and the web `side` placement prop, do
// not apply). All derivation flows through the pure [classify] in HelpIconModel.kt; the icon + tooltip rendering is
// delegated to the shared `components/ui/HelpIcon` atom (a Material 3 RichTooltip over an IconButton drawing
// TeslaGlyphs.Help), so this surface tracks light / dark / high-contrast themes and the platform's tooltip
// affordance. The two accessible-name strings resolve through the i18n catalog (P1/S10, `translation_a11y_helpFor`
// / `translation_help_tooltip_iconLabel`), and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces/HelpIcon)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless content +
// previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpicon

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.ui.HelpIcon as UiHelpIcon

/**
 * Stateful entry point — the faithful port of the web `HelpIcon`. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, resolves the two accessible-name strings from the P1/S10 catalog, and renders the
 * icon. Performs no HTTP and binds no state holder (the web component is presentational; its help copy and field id
 * are owned by the parent). [logger] defaults to the process logger.
 *
 * The web `i18nKey` prop (a dotted catalog key resolved at runtime by `t()`) maps to the caller resolving the
 * corresponding `stringResource` and passing the result as [text]; the web `content` inline fallback maps to
 * [content]. [forId] is the web `for` (the documented field's id), and [ariaLabel] the web accessible-name override.
 *
 * @param text the resolved help copy (web `i18nKey`-resolved value); blank ⇒ [content] is used.
 * @param content the inline fallback / one-off help copy (web `content`).
 * @param forId the id of the field this icon documents (web `for`); selects the per-field accessible name.
 * @param ariaLabel an explicit accessible-name override (web `ariaLabel`).
 */
@Composable
fun HelpIcon(
    modifier: Modifier = Modifier,
    text: String? = null,
    content: String? = null,
    forId: String? = null,
    ariaLabel: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HelpIconDiagnostics.recordViewOpened(logger) }
    HelpIconContent(
        text = text,
        content = content,
        forId = forId,
        ariaLabel = ariaLabel,
        helpForLabel = stringResource(R.string.translation_a11y_helpFor, forId.orEmpty()),
        genericLabel = stringResource(R.string.translation_help_tooltip_iconLabel),
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the props into a
 * [HelpIconRender] and either draws nothing (web `return null`) or the trigger + tooltip. Deterministic: the two
 * accessible-name strings are supplied by the caller, so no Android resource is read here.
 *
 * The rendered trigger carries [helpForTestTag] (the native analogue of the web `data-help-for` attribute) so
 * audits/tests can correlate the icon to the field it documents, and the resolved accessible name as its
 * `contentDescription` so TalkBack announces "Help for {field}" (or the generic name) — the native mirror of the
 * web trigger's `aria-label`. The shared atom reveals [HelpIconRender.Shown.text] on tap and auto-dismisses on an
 * outside tap, the touch-idiomatic equivalent of the web hover/focus reveal + Escape-to-dismiss affordance.
 */
@Composable
fun HelpIconContent(
    text: String?,
    content: String?,
    forId: String?,
    ariaLabel: String?,
    helpForLabel: String,
    genericLabel: String,
    modifier: Modifier = Modifier,
) {
    val render =
        classify(
            HelpIconInput(
                text = text,
                content = content,
                ariaLabel = ariaLabel,
                forId = forId,
                helpForLabel = helpForLabel,
                genericLabel = genericLabel,
            ),
        )
    when (render) {
        HelpIconRender.Hidden -> Unit
        is HelpIconRender.Shown ->
            UiHelpIcon(
                text = render.text,
                contentDescription = render.accessibleLabel,
                modifier = modifier.testTag(helpForTestTag(forId)),
            )
    }
}

// ── Previews — the shown branch across the three accessible-name outcomes the web component draws. The hidden
// branch (no help copy ⇒ nothing) renders an empty tree and so needs no preview. ───────────────────────────────

private const val PREVIEW_HELP_TEXT = "Cooldown protects against alert spam."
private const val PREVIEW_FIELD = "cooldown"
private const val PREVIEW_HELP_FOR_LABEL = "Help for cooldown"
private const val PREVIEW_GENERIC_LABEL = "More info"
private const val PREVIEW_OVERRIDE_LABEL = "Custom help label"

@Preview(name = "HelpIcon · per-field label", showBackground = true)
@Composable
private fun HelpIconForFieldPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpIconContent(
            text = null,
            content = PREVIEW_HELP_TEXT,
            forId = PREVIEW_FIELD,
            ariaLabel = null,
            helpForLabel = PREVIEW_HELP_FOR_LABEL,
            genericLabel = PREVIEW_GENERIC_LABEL,
        )
    }
}

@Preview(name = "HelpIcon · generic label", showBackground = true)
@Composable
private fun HelpIconGenericPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpIconContent(
            text = PREVIEW_HELP_TEXT,
            content = null,
            forId = null,
            ariaLabel = null,
            helpForLabel = PREVIEW_HELP_FOR_LABEL,
            genericLabel = PREVIEW_GENERIC_LABEL,
        )
    }
}

@Preview(name = "HelpIcon · explicit aria-label", showBackground = true)
@Composable
private fun HelpIconOverridePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpIconContent(
            text = PREVIEW_HELP_TEXT,
            content = null,
            forId = PREVIEW_FIELD,
            ariaLabel = PREVIEW_OVERRIDE_LABEL,
            helpForLabel = PREVIEW_HELP_FOR_LABEL,
            genericLabel = PREVIEW_GENERIC_LABEL,
        )
    }
}
