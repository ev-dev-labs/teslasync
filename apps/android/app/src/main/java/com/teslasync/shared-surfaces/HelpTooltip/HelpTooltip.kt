// The native Jetpack Compose + Material 3 HelpTooltip shared surface — a parity port of
// web/src/components/ui/HelpTooltip.tsx. The web source is a compact "?" trigger that, on hover / focus /
// touch tap, reveals an explanatory tooltip next to a non-obvious metric title or settings label. It resolves
// its body from `i18nKey ? t(i18nKey, {defaultValue}) : text` (rendering NOTHING when that is empty), exposes
// `size` (xs / sm / md) and `placement` (top / bottom / left / right), names the trigger with
// `aria-label ?? t('help.tooltip.iconLabel')`, optionally renders a "Learn more" link
// (`t('common.learnMore')`) that opens in a new tab, and lets a caller override the trigger via `children`.
//
// This surface is the native equivalent. The only imperative behaviour — opening the "Learn more" link — flows
// through the shared [HelpTooltipViewModel] over the decoupled [LinkOpener] seam; the view performs NO
// navigation of its own (ADR-002):
//   • web `useTranslation` `t(key, default)` → the generated i18n catalog (P1/S10): the fixed icon-label /
//     learn-more keys via `stringResource`, and the caller's arbitrary body `i18nKey` via a runtime
//     `getIdentifier` lookup that falls back to `defaultValue` exactly as i18next renders the inline default;
//   • web `Tooltip` (shared) → Material 3 `RichTooltip` inside a `TooltipBox` — the same primitive the shared
//     `Tooltip` / `HelpIcon` wrap, used directly here because the shared `Tooltip` takes only a plain text
//     string and so cannot carry the interactive "Learn more" affordance the web tooltip body holds;
//   • web `placement` → a custom [PopupPositionProvider] driven by the pure [helpTooltipPopupOffset] geometry,
//     honouring all four sides (Material's default provider only does above/below);
//   • web lucide `HelpCircle` trigger → [TeslaGlyphs.Help] via the shared [IconButton] (48 dp touch target);
//   • web lucide `ExternalLink` → the local [ExternalLinkGlyph] drawn in the [TeslaGlyphs] house style;
//   • web `aria-label` → an explicit `contentDescription` overriding the visible glyph for assistive tech;
//   • web `<a target="_blank">` → [HelpTooltipViewModel.onLearnMore] over [LinkOpener]/[rememberExternalLinkOpener].
//
// States reproduced (the honest set for a presentational tooltip leaf with no remote read — see
// HelpTooltipModel, covenant #2 / #9): content ABSENT renders nothing (web `return null`); content PRESENT with
// and without the "Learn more" link; the size + placement variants; and the link-open [LinkOutcome]. There is
// no remote read, so no loading / empty-box / error / stale / offline lifecycle is invented. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition once content is shown.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HelpTooltip) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer, link-opener factory, glyph, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupPositionProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/** 24×24 icon canvas + stroke, matching the shared [TeslaGlyphs] line-style set the surface draws beside. */
private const val ICON_CANVAS: Float = 24f
private const val ICON_STROKE: Float = 2f

/**
 * A compact "?" help affordance that reveals an explanatory tooltip — the native `HelpTooltip`. Resolves its
 * body from [i18nKey] (translated via the P1/S10 catalog, falling back to [defaultValue]) or the literal
 * [text]; when that is empty it renders NOTHING, exactly as the web `return null`, so consumers never have to
 * gate it themselves. The tooltip optionally carries a [learnMore] link opened externally through [opener].
 *
 * @param text plain body text; use [i18nKey] instead when localising.
 * @param i18nKey catalog key for the body; paired with [defaultValue] for the fallback.
 * @param defaultValue fallback body used when [i18nKey] is catalog-absent.
 * @param placement tooltip placement relative to the trigger (web `placement`).
 * @param learnMore optional "Learn more" link rendered below the body; opens externally.
 * @param size trigger glyph size (web `size`).
 * @param ariaLabel accessible name for the trigger; defaults to `t('help.tooltip.iconLabel')`.
 * @param trigger optional override for the default `HelpCircle` trigger (web `children`).
 * @param opener the link-open seam; defaults to the system browser ([rememberExternalLinkOpener]).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun HelpTooltip(
    modifier: Modifier = Modifier,
    text: String? = null,
    i18nKey: String? = null,
    defaultValue: String? = null,
    placement: HelpTooltipPlacement = HelpTooltipPlacement.Top,
    learnMore: HelpTooltipLearnMore? = null,
    size: HelpTooltipSize = HelpTooltipSize.Sm,
    ariaLabel: String? = null,
    trigger: (@Composable () -> Unit)? = null,
    opener: LinkOpener = rememberExternalLinkOpener(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val body = rememberResolvedBody(text = text, i18nKey = i18nKey, defaultValue = defaultValue)

    // Web `if (!resolved) return null` — a content-less HelpTooltip renders nothing (no trigger, no diagnostic).
    if (!hasHelpContent(body)) return

    val viewModel: HelpTooltipViewModel =
        viewModel(
            key = HelpTooltipRegistration.ID,
            factory = HelpTooltipViewModel.factory(opener, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val defaultLabel = stringResource(R.string.translation_help_tooltip_iconLabel)
    val learnMoreFallback = stringResource(R.string.translation_common_learnMore)
    val accessibleLabel = ariaLabel ?: defaultLabel
    val learnMoreLabel = learnMore?.let { resolveLearnMoreLabel(it.label, learnMoreFallback) }

    HelpTooltipContent(
        body = body,
        accessibleLabel = accessibleLabel,
        size = size,
        placement = placement,
        learnMoreLabel = learnMoreLabel,
        onLearnMore = { learnMore?.let { viewModel.onLearnMore(it.url) } },
        trigger = trigger,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the test / preview entry point. Wraps the [trigger] (the default `HelpCircle`
 * [IconButton] or a caller override) in a Material 3 [TooltipBox] whose persistent [RichTooltip] shows [body]
 * and, when [learnMoreLabel] is non-null, a "Learn more" action invoking [onLearnMore]. The trigger carries
 * [accessibleLabel] as its accessible name (web `aria-label`). The tooltip is placed on [placement] via the
 * custom [HelpTooltipPositionProvider]; tapping the trigger reveals it so touch users get the hover affordance.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpTooltipContent(
    body: String,
    accessibleLabel: String,
    size: HelpTooltipSize,
    placement: HelpTooltipPlacement,
    learnMoreLabel: String?,
    onLearnMore: () -> Unit,
    modifier: Modifier = Modifier,
    trigger: (@Composable () -> Unit)? = null,
) {
    val state = rememberTooltipState(isPersistent = true)
    val scope = rememberCoroutineScope()
    val gapPx = with(LocalDensity.current) { Spacing.sm.roundToPx() }
    val positionProvider = remember(placement, gapPx) { HelpTooltipPositionProvider(placement, gapPx) }

    val action: (@Composable () -> Unit)? =
        learnMoreLabel?.let { label ->
            {
                LearnMoreAction(
                    label = label,
                    onClick = {
                        onLearnMore()
                        state.dismiss()
                    },
                )
            }
        }

    TooltipBox(
        positionProvider = positionProvider,
        tooltip = {
            RichTooltip(action = action) { Text(body) }
        },
        state = state,
        modifier = modifier,
    ) {
        HelpTooltipTrigger(
            accessibleLabel = accessibleLabel,
            size = size,
            trigger = trigger,
            onClick = { scope.launch { state.show() } },
        )
    }
}

/**
 * The "?" trigger — either the caller's [trigger] override wrapped in a [Role.Button] clickable carrying
 * [accessibleLabel], or the default `HelpCircle` [IconButton] sized by [size]. Tapping it invokes [onClick]
 * (which reveals the tooltip), giving touch users the same affordance hover gives pointer users.
 */
@Composable
private fun HelpTooltipTrigger(
    accessibleLabel: String,
    size: HelpTooltipSize,
    trigger: (@Composable () -> Unit)?,
    onClick: () -> Unit,
) {
    if (trigger != null) {
        Box(
            modifier =
                Modifier
                    .testTag(HelpTooltipRegistration.TRIGGER_TEST_TAG)
                    .clip(RoundedCornerShape(Radius.pill))
                    .clickable(onClickLabel = accessibleLabel, role = Role.Button, onClick = onClick)
                    .semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
            contentAlignment = Alignment.Center,
        ) {
            trigger()
        }
    } else {
        IconButton(
            imageVector = TeslaGlyphs.Help,
            contentDescription = accessibleLabel,
            onClick = onClick,
            modifier = Modifier.testTag(HelpTooltipRegistration.TRIGGER_TEST_TAG),
            size = iconSizeFor(size),
        )
    }
}

/**
 * The "Learn more" affordance inside the tooltip — a ghost button showing [label] and the [ExternalLinkGlyph],
 * invoking [onClick] (which opens the link through the holder and dismisses the tooltip). The external-link
 * glyph is decorative; [label] is the accessible name, matching the web link text + `aria-hidden` icon.
 */
@Composable
private fun LearnMoreAction(
    label: String,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = Modifier.testTag(HelpTooltipRegistration.LEARN_MORE_TEST_TAG),
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.width(Spacing.xs))
        Icon(imageVector = ExternalLinkGlyph, contentDescription = null, size = IconSize.Xs)
    }
}

/** Maps the web `size` prop onto the shared [IconSize] (xs → 12 dp, sm → 14 dp, md → 16 dp). */
private fun iconSizeFor(size: HelpTooltipSize): IconSize =
    when (size) {
        HelpTooltipSize.Xs -> IconSize.Xs
        HelpTooltipSize.Sm -> IconSize.Sm
        HelpTooltipSize.Md -> IconSize.Md
    }

/**
 * Resolves the body text at the render boundary — the web `i18nKey ? t(i18nKey, {defaultValue}) : text`. When
 * an [i18nKey] is set its catalog value (P1/S10) is looked up by the `translation_<key with dots as
 * underscores>` resource name and handed to the pure [resolveHelpBody]; a catalog-absent key yields `null` so
 * the precedence falls back to [defaultValue], exactly as i18next renders the inline default. `getIdentifier`
 * is the only way to attempt an arbitrary caller-supplied key (a compile-time `R.string` reference would not
 * compile), so `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off).
 */
@SuppressLint("DiscouragedApi")
@Composable
private fun rememberResolvedBody(
    text: String?,
    i18nKey: String?,
    defaultValue: String?,
): String {
    val context = LocalContext.current
    val resourceName = i18nKey?.let { "translation_" + it.replace('.', '_') }
    val id =
        remember(resourceName) {
            if (resourceName == null) {
                0
            } else {
                context.resources.getIdentifier(resourceName, "string", context.packageName)
            }
        }
    val catalogValue = if (id != 0) stringResource(id) else null
    return resolveHelpBody(text = text, i18nKey = i18nKey, defaultValue = defaultValue, catalogValue = catalogValue)
}

/**
 * The production [LinkOpener] backed by an `ACTION_VIEW` intent — the native analogue of the web
 * `<a target="_blank">`. Launches the link in the system browser and returns `false` if no activity can handle
 * it ([ActivityNotFoundException]) so the surface can record the web "blocked" branch. Remembered against the
 * [android.content.Context] so the same opener survives recomposition.
 */
@Composable
fun rememberExternalLinkOpener(): LinkOpener {
    val context = LocalContext.current
    return remember(context) {
        LinkOpener { url ->
            try {
                val intent =
                    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                context.startActivity(intent)
                true
            } catch (_: ActivityNotFoundException) {
                false
            }
        }
    }
}

/**
 * The custom [PopupPositionProvider] honouring all four [HelpTooltipPlacement] sides — Material's default
 * tooltip providers only place above/below, so the web `top` / `bottom` / `left` / `right` placement is
 * realised here by delegating to the pure [helpTooltipPopupOffset] geometry (which also clamps the popup into
 * the window and mirrors left/right under RTL). [gapPx] is the trigger-to-tooltip spacing in pixels.
 */
private class HelpTooltipPositionProvider(
    private val placement: HelpTooltipPlacement,
    private val gapPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val offset =
            helpTooltipPopupOffset(
                placement = placement,
                anchorLeft = anchorBounds.left,
                anchorTop = anchorBounds.top,
                anchorWidth = anchorBounds.width,
                anchorHeight = anchorBounds.height,
                popupWidth = popupContentSize.width,
                popupHeight = popupContentSize.height,
                windowWidth = windowSize.width,
                windowHeight = windowSize.height,
                gap = gapPx,
                isRtl = layoutDirection == LayoutDirection.Rtl,
            )
        return IntOffset(offset.x, offset.y)
    }
}

/**
 * An external-link glyph mirroring the web `ExternalLink` (lucide) icon — a box with the top-right corner open
 * and an arrow leaving it, authored as a 24×24 stroked vector in the [TeslaGlyphs] house style (opaque black,
 * recolored at render by the [Icon] tint). The shared glyph set carries no external-link icon, so it is drawn
 * here rather than reaching for an unrelated glyph — keeping the surface visually faithful to the web source.
 */
private val ExternalLinkGlyph: ImageVector =
    strokedGlyph("HelpTooltipExternalLink") {
        // Box body, top-right left open for the arrow (lucide external-link container).
        moveTo(18f, 13f)
        lineTo(18f, 19f)
        lineTo(5f, 19f)
        lineTo(5f, 6f)
        lineTo(11f, 6f)
        // Arrow-head corner (lucide `M15 3h6v6`).
        moveTo(15f, 3f)
        lineTo(21f, 3f)
        lineTo(21f, 9f)
        // Diagonal shaft (lucide `M10 14 21 3`).
        moveTo(10f, 14f)
        lineTo(21f, 3f)
    }

/** Builds a 24×24 stroked [ImageVector] in the [TeslaGlyphs] house style (round cap/join, recolored by tint). */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = ICON_CANVAS,
            viewportHeight = ICON_CANVAS,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = ICON_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews — the honest render states (content with / without the link, in light + dark) and a non-default
// placement. Sample copy is tooling-only literal text, never shipped UI. ──────────────────────────────────────

@Preview(name = "HelpTooltip — content + Learn more", showBackground = true)
@Composable
private fun HelpTooltipLearnMorePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpTooltipContent(
            body = "Battery energy lost while parked, from cabin overheat protection and sentry mode.",
            accessibleLabel = "More info about vampire drain",
            size = HelpTooltipSize.Sm,
            placement = HelpTooltipPlacement.Top,
            learnMoreLabel = "Learn more",
            onLearnMore = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "HelpTooltip — content only (dark)", showBackground = true)
@Composable
private fun HelpTooltipPlainDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        HelpTooltipContent(
            body = "Minutes a vehicle must be idle before TeslaSync treats it as asleep.",
            accessibleLabel = "More info",
            size = HelpTooltipSize.Md,
            placement = HelpTooltipPlacement.Bottom,
            learnMoreLabel = null,
            onLearnMore = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
