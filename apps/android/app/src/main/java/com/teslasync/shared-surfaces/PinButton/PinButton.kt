// The native Jetpack Compose + Material 3 PinButton shared surface — a parity port of
// web/src/components/ui/PinButton.tsx. The web source is a focusable, icon-only "pin" affordance for a
// single row: it reads `usePinned(itemType, context)` (defaulting the list to `[]`), derives
// `isPinned = pinned.some(p => String(p.item_id) === String(itemId))`, and renders a button whose icon
// (lucide `Pin` ⇄ `PinOff`), amber-vs-muted tint, tooltip + `aria-label` ("Pin" ⇄ "Unpin"), and optional
// visible label ("Pin" ⇄ "Pinned") all flip with that flag. Tapping runs
// `useTogglePin(itemType).mutate({ itemId, context, pin: !isPinned })` (POST to pin / resolve-then-DELETE
// to unpin, raising a success/error toast); while pending the button is `disabled`; the click stops
// propagation so a toggle never also fires the surrounding row's navigation.
//
// This native surface keeps that contract end to end while using platform-idiomatic primitives (the
// shared Material 3 `IconButton` / `Button` / `Tooltip` / `Icon` / `Badge`, the `TeslaGlyphs.Pin` glyph,
// the warning/amber status token) and — because the pin feed is a genuine cache-then-network read
// (ADR-013) yet the web ALWAYS renders the button — surfaces the read lifecycle ADDITIVELY without ever
// hiding the affordance (the P3 "render every state, hide no region" matrix): a button-sized busy
// indicator on first read, the unpinned / pinned toggle once resolved (an empty pin list is the unpinned
// content state, never a blank box), the disabled pending toggle while a mutation is in flight, a
// freshness chip while the cached pin state is stale / refreshing / offline, and a Retry affordance beside
// the (web `[]`-default unpinned) button on a hard read error. All data flows through [PinButtonViewModel]
// (P1/S8); the view performs NO HTTP. Every string resolves through the i18n facade (P1/S10) via
// `stringResource`; the toggle exposes a merged TalkBack label + selected state and a one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition.
//
// The web `PinOff` glyph has no `TeslaGlyphs` entry (and that set is outside this surface's allowed
// files), so the pinned state is conveyed via the single `TeslaGlyphs.Pin` glyph tinted amber plus the
// label/tooltip switch — exactly as the native atomic `PinButton` already does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PinButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pinbutton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.toast.LocalToastController
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItemType

/**
 * The localized strings the surface folds into its output, resolved through the P1/S10 catalog at the
 * render boundary (tests/previews pass a deterministic instance). Bundling them keeps the render branches
 * locale-stable and the parameter list small.
 *
 * @property labels the pin / pinned / unpin label triple (web `t('pin.*')`).
 * @property staleLabel the chip shown when the cached pin state is past its TTL (web `t('mqtt.stale')`).
 * @property offlineLabel the chip shown when the cached pin state is served after a failed refresh.
 * @property updatingLabel the chip shown while a refresh runs over the cached pin state.
 * @property retryLabel the Retry affordance label shown on a hard read error (web `t('common.retry')`).
 * @property loadingLabel the TalkBack label for the first-load busy indicator (web `t('common.loading')`).
 */
data class PinButtonStrings(
    val labels: PinButtonLabels,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
    val retryLabel: String,
    val loadingLabel: String,
)

/**
 * Stateful entry point — the parity port of the web `<PinButton itemType itemId … />`. Binds the pin
 * read + mutation seam via [source] into a [PinButtonViewModel] under a per-placement key (so the many
 * pin buttons a list renders never share one holder), records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, collects the live cache-then-network [state] + [toggling], and renders
 * the affordance.
 *
 * @param itemType the pin bucket (web `itemType`) — drives the API call and the cache key.
 * @param itemId the stable row id, already stringified (web `String(itemId)`).
 * @param modifier optional layout modifier applied to the surface root.
 * @param context optional sub-surface scope, e.g. a dashboard id for widget pins (web `context`).
 * @param size the icon scale (web `size`); defaults to compact `sm`.
 * @param showLabel render the "Pin"/"Pinned" text beside the icon (web `showLabel`); defaults to false.
 * @param source the pin seam; defaults to the shared P1/S8 `PinnedStore` from [LocalDataContainer].
 * @param toast the shared toast holder, or `null` when no host is mounted (web `useOptionalToast`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun PinButton(
    itemType: PinnedItemType,
    itemId: String,
    modifier: Modifier = Modifier,
    context: String? = null,
    size: PinButtonSize = PinButtonSize.Sm,
    showLabel: Boolean = false,
    source: PinButtonSource = rememberPinButtonSource(),
    toast: ToastController? = LocalToastController.current,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val instanceKey = rememberSaveable { randomPinButtonInstanceId() }
    val viewModel: PinButtonViewModel =
        viewModel(
            key = "${PinButtonRegistration.ID}:$itemType:$itemId:${context.orEmpty()}:$instanceKey",
            factory = PinButtonViewModel.factory(source, itemType, itemId, context, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val toggling by viewModel.toggling.collectAsStateWithLifecycle()
    val strings = rememberPinButtonStrings()
    val toastCopy = rememberPinButtonToastCopy()

    PinButtonContent(
        isPinned = state.data?.isPinned ?: false,
        strings = strings,
        modifier = modifier,
        showLabel = showLabel,
        size = size,
        pending = toggling,
        loading = state.isLoading,
        refreshing = state.refreshing,
        stale = state.stale && !state.hasError,
        offline = state.hasError && state.hasData,
        errorKind = if (state.isError) pinButtonErrorKind(state.errorKind, state.httpStatus) else null,
        onToggle = { viewModel.toggle(toastCopy, toast) },
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The pin toggle
 * is ALWAYS present (web's button never hides): [loading] swaps it for a button-sized busy indicator on
 * the very first read (no cache); otherwise the unpinned / pinned / disabled-[pending] toggle renders.
 * Beside it, [PinButtonAdornment] shows the freshness chip ([stale] / [offline] / [refreshing]) or, on a
 * hard read [errorKind], the Retry affordance — never replacing the toggle.
 */
@Composable
fun PinButtonContent(
    isPinned: Boolean,
    strings: PinButtonStrings,
    modifier: Modifier = Modifier,
    showLabel: Boolean = false,
    size: PinButtonSize = PinButtonSize.Sm,
    pending: Boolean = false,
    loading: Boolean = false,
    refreshing: Boolean = false,
    stale: Boolean = false,
    offline: Boolean = false,
    errorKind: QueryErrorKind? = null,
    onToggle: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Row(
        modifier = modifier.testTag(PinButtonRegistration.ROOT_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            PinButtonBusy(strings = strings, size = size)
        } else {
            PinButtonToggle(
                isPinned = isPinned,
                strings = strings,
                showLabel = showLabel,
                size = size,
                pending = pending,
                onToggle = onToggle,
            )
        }
        PinButtonAdornment(
            refreshing = refreshing,
            stale = stale,
            offline = offline,
            errorKind = errorKind,
            strings = strings,
            onRetry = onRetry,
        )
    }
}

/**
 * The interactive pin toggle — the icon-only [IconButton] or, for [showLabel], the labelled [Button]. The
 * icon is the single [TeslaGlyphs.Pin] glyph tinted amber when [isPinned] (the web `PinOff` + amber
 * adaptation); the tooltip + accessible name carry the ACTION ("Unpin"/"Pin") while the visible label (if
 * any) carries the STATE ("Pinned"/"Pin"), exactly as the web separates them; the node exposes its
 * pressed/[selected] state for assistive tech; and [pending] disables it (web `disabled`).
 */
@Composable
private fun PinButtonToggle(
    isPinned: Boolean,
    strings: PinButtonStrings,
    showLabel: Boolean,
    size: PinButtonSize,
    pending: Boolean,
    onToggle: () -> Unit,
) {
    val actionLabel = pinActionLabel(isPinned, strings.labels)
    val stateLabel = pinStateLabel(isPinned, strings.labels)
    val tint: Color = if (isPinned) TeslaTokens.status.warning else LocalContentColor.current
    Tooltip(text = actionLabel) {
        if (showLabel) {
            Button(
                onClick = onToggle,
                modifier =
                    Modifier
                        .testTag(PinButtonRegistration.TOGGLE_TEST_TAG)
                        .semantics(mergeDescendants = true) {
                            contentDescription = actionLabel
                            selected = isPinned
                        },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !pending,
            ) {
                Icon(TeslaGlyphs.Pin, contentDescription = null, size = size.toIconSize(), tint = tint)
                Spacer(Modifier.width(Spacing.sm))
                Text(stateLabel, style = MaterialTheme.typography.labelLarge)
            }
        } else {
            IconButton(
                imageVector = TeslaGlyphs.Pin,
                contentDescription = actionLabel,
                onClick = onToggle,
                modifier =
                    Modifier
                        .testTag(PinButtonRegistration.TOGGLE_TEST_TAG)
                        .semantics { selected = isPinned },
                enabled = !pending,
                size = size.toIconSize(),
                tint = tint,
            )
        }
    }
}

/**
 * The first-read branch — a button-sized indeterminate indicator shown while the pin feed resolves with
 * nothing cached. It keeps the affordance's footprint (never a blank box) and is announced to TalkBack as
 * the loading label, honestly signalling "resolving" instead of guessing the pin state.
 */
@Composable
private fun PinButtonBusy(
    strings: PinButtonStrings,
    size: PinButtonSize,
) {
    Box(
        modifier =
            Modifier
                .size(BUSY_BOX_SIZE)
                .semantics { contentDescription = strings.loadingLabel },
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(size.toIconSize().dimension),
            strokeWidth = BUSY_STROKE_WIDTH,
        )
    }
}

/**
 * The additive status chrome beside the toggle: a Retry affordance when a hard read [errorKind] left no
 * cached pin state (web recovery for its silent `[]` fallback), else an offline / updating / stale
 * freshness chip while the cached pin state is degraded. Renders nothing once the pin state is fresh.
 */
@Composable
private fun PinButtonAdornment(
    refreshing: Boolean,
    stale: Boolean,
    offline: Boolean,
    errorKind: QueryErrorKind?,
    strings: PinButtonStrings,
    onRetry: () -> Unit,
) {
    when {
        errorKind != null ->
            Button(
                label = strings.retryLabel,
                onClick = onRetry,
                modifier = Modifier.testTag(PinButtonRegistration.RETRY_TEST_TAG),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )

        offline -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

/** Maps the web `sm`/`md` icon scale onto the shared [IconSize] (sm = 14dp glyph, md = 16dp glyph). */
private fun PinButtonSize.toIconSize(): IconSize =
    when (this) {
        PinButtonSize.Sm -> IconSize.Sm
        PinButtonSize.Md -> IconSize.Md
    }

/** Builds the localized strings from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
private fun rememberPinButtonStrings(): PinButtonStrings =
    PinButtonStrings(
        labels =
            PinButtonLabels(
                pin = stringResource(R.string.translation_pin_pin),
                pinned = stringResource(R.string.translation_pin_pinned),
                unpin = stringResource(R.string.translation_pin_unpin),
            ),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        retryLabel = stringResource(R.string.translation_common_retry),
        loadingLabel = stringResource(R.string.translation_common_loading),
    )

/** Builds the localized toggle toast copy from the P1/S10 catalog (web `useTogglePin` messages). */
@Composable
private fun rememberPinButtonToastCopy(): PinButtonToastCopy =
    PinButtonToastCopy(
        pinnedSuccess = stringResource(R.string.translation_toast_pin_pinned_success),
        pinnedError = stringResource(R.string.translation_toast_pin_pinned_error),
        unpinnedSuccess = stringResource(R.string.translation_toast_pin_unpinned_success),
        unpinnedError = stringResource(R.string.translation_toast_pin_unpinned_error),
    )

/** Resolves the shared P1/S8 `PinnedStore` from the [LocalDataContainer] into the surface seam. */
@Composable
private fun rememberPinButtonSource(): PinButtonSource {
    val container = LocalDataContainer.current
    return remember(container) { pinButtonSource(container.pinnedStore) }
}

private val BUSY_BOX_SIZE: Dp = 40.dp
private val BUSY_STROKE_WIDTH: Dp = 2.dp

// ── Previews — one per rendered state (unpinned / pinned / pinned + label / pending / loading / stale /
// offline / error). Sample strings are tooling-only and never shipped UI. ──────────────────────────────

private fun previewPinButtonStrings(): PinButtonStrings =
    PinButtonStrings(
        labels = PinButtonLabels(pin = "Pin", pinned = "Pinned", unpin = "Unpin"),
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating…",
        retryLabel = "Retry",
        loadingLabel = "Loading...",
    )

@Preview(name = "PinButton — unpinned", showBackground = true)
@Composable
private fun PinButtonUnpinnedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(isPinned = false, strings = previewPinButtonStrings(), modifier = Modifier.padding(Spacing.md))
    }
}

@Preview(name = "PinButton — pinned", showBackground = true)
@Composable
private fun PinButtonPinnedPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PinButtonContent(isPinned = true, strings = previewPinButtonStrings(), modifier = Modifier.padding(Spacing.md))
    }
}

@Preview(name = "PinButton — pinned + label", showBackground = true)
@Composable
private fun PinButtonLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(
            isPinned = true,
            strings = previewPinButtonStrings(),
            modifier = Modifier.padding(Spacing.md),
            showLabel = true,
        )
    }
}

@Preview(name = "PinButton — pending", showBackground = true)
@Composable
private fun PinButtonPendingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(
            isPinned = false,
            strings = previewPinButtonStrings(),
            modifier = Modifier.padding(Spacing.md),
            pending = true,
        )
    }
}

@Preview(name = "PinButton — loading", showBackground = true)
@Composable
private fun PinButtonLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(
            isPinned = false,
            strings = previewPinButtonStrings(),
            modifier = Modifier.padding(Spacing.md),
            loading = true,
        )
    }
}

@Preview(name = "PinButton — offline", showBackground = true)
@Composable
private fun PinButtonOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(
            isPinned = true,
            strings = previewPinButtonStrings(),
            modifier = Modifier.padding(Spacing.md),
            offline = true,
        )
    }
}

@Preview(name = "PinButton — error + retry", showBackground = true)
@Composable
private fun PinButtonErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PinButtonContent(
            isPinned = false,
            strings = previewPinButtonStrings(),
            modifier = Modifier.padding(Spacing.md),
            errorKind = QueryErrorKind.Offline,
        )
    }
}
