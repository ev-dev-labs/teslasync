// The native Jetpack Compose + Material 3 Toast shared surface — a parity port of
// web/src/components/feedback/Toast.tsx. The web source is a `ToastProvider` that owns a transient
// queue of toasts and renders them bottom-anchored: each toast is one of four variants (success /
// error / info / warning) with a tone icon + tinted border, a title, an optional message, an optional
// action (a React Router `<Link to>` OR a `<button onClick>`), and a dismiss control; it announces
// assertively for `error` (`role="alert"`) and politely otherwise (`role="status"`), and its entry/exit
// animation collapses under reduced motion.
//
// This surface is the native equivalent. All state flows through the shared [ToastViewModel] over
// the [ToastController] seam (the surface-owned `ToastProvider` analogue) — the view performs NO HTTP
// and no timing. The faithful mapping of the web behaviour:
//   • `ToastProvider`'s `toasts` queue → the [ToastController], folded by the ViewModel into the stack;
//   • `useToast` / `useOptionalToast` → [requireToastController] / [LocalToastController];
//   • each variant's icon + `border-{tone}/30` → the shared `toneGlyph` + `toneColor` palette;
//   • the `t('a11y.dismissNotification')` label → the generated i18n catalog (P1/S10);
//   • the `<Link to>` / `<button onClick>` action → the host-routed [ToastAction.Navigate] / the
//     [ToastAction.Callback], invoked then dismissed by the ViewModel;
//   • the per-toast `setTimeout(dismiss, duration)` → the ViewModel auto-dismiss clock;
//   • the spring entry (y 20→0, scale .95→1) suppressed under reduced motion (web
//     `useMotionPreference().reduce`) → the native `rememberReducedMotion`-gated entry;
//   • `role="alert"`/`role="status"` → a merged assertive / polite Compose live region.
//
// States reproduced (the honest set for a notification primitive — see ToastModel): the populated stack
// (every tone + action + message branch, including the assertive `error` variant) and the empty queue
// (an invisible overlay, exactly what the web host renders with no toasts). There is no remote read, so
// no loading/stale/offline lifecycle is invented (covenant #9). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Toast) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.toneColor
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the host overlay container — present in every state (populated + empty). */
const val TOAST_HOST_TEST_TAG: String = "toast-host"

/** Test tag identifying one rendered toast card — used by the per-tone + a11y UI tests. */
const val TOAST_CARD_TEST_TAG: String = "toast-card"

private val TOAST_MAX_WIDTH: Dp = 380.dp
private const val BORDER_ALPHA = 0.30f
private const val CONTAINER_ELEVATION_DP = 3
private val ICON_TOP_NUDGE: Dp = 2.dp
private const val DESCRIPTION_MAX_LINES = 2
private const val VIEW_ARROW = " \u2192"

// ── Entry (web spring: y 20→0, scale .95→1; reduced motion → fade only) ─────────────────────────────
private const val ENTRY_DURATION_MS = 400
private const val ENTRY_SCALE_FROM = 0.95f
private val ENTRY_SLIDE_FROM: Dp = 20.dp

/**
 * `useOptionalToast` — the CompositionLocal a host provides the app-scoped [ToastController] through.
 * `null` when no host is mounted, exactly like the web `useOptionalToast` returning `null` outside a
 * `ToastProvider`. Use [requireToastController] for the throwing `useToast` variant.
 */
val LocalToastController: ProvidableCompositionLocal<ToastController?> = staticCompositionLocalOf { null }

/**
 * `useToast` — the [ToastController] from [LocalToastController], throwing if no [ToastHost] is mounted
 * (web `useToast` throws "must be used within ToastProvider"). For primitives that should degrade
 * gracefully when no host is present, read [LocalToastController] directly (the optional variant).
 */
@Composable
@ReadOnlyComposable
fun requireToastController(): ToastController =
    LocalToastController.current ?: error("requireToastController requires a ToastHost (LocalToastController not provided)")

/**
 * Stateful entry point bound to the shared [ToastController] — the faithful port of the web
 * `ToastProvider`'s rendered toast stack. Binds the [ToastViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), collects the folded queue, and renders the stateless surface
 * bottom-anchored.
 *
 * @param controller the shared toast queue holder; a host builds one [DefaultToastController] at the
 *   app root and also provides it through [LocalToastController] so any screen can enqueue toasts.
 * @param modifier optional layout modifier for the overlay container.
 * @param onNavigate invoked with a route when a navigation action is tapped; the host routes it to the
 *   deep link (web `<Link to>`). Defaults to a no-op so the surface is safe to host before nav is wired.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun ToastHost(
    controller: ToastController,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ToastViewModel =
        viewModel(
            key = ToastRegistration.ID,
            factory = ToastViewModel.factory(controller, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val reducedMotion = rememberReducedMotion()

    ToastHostContent(
        state = state,
        reducedMotion = reducedMotion,
        onAction = { message -> viewModel.invokeAction(message, onNavigate) },
        onDismiss = viewModel::dismiss,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the host overlay — the unit/UI-test and preview entry point. Anchors the toast
 * column bottom-end (web `fixed bottom-4 right-4`, RTL-aware), capped to [TOAST_MAX_WIDTH]. An empty
 * queue renders an invisible, zero-content overlay — the faithful web behaviour (the host shows nothing
 * with no toasts); the [TOAST_HOST_TEST_TAG] container is always present so the surface is locatable in
 * every state. [reducedMotion] gates the entry animation exactly as the web `useMotionPreference().reduce`
 * does.
 */
@Composable
fun ToastHostContent(
    state: ToastHostState,
    reducedMotion: Boolean,
    onAction: (ToastMessage) -> Unit,
    onDismiss: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().testTag(TOAST_HOST_TEST_TAG),
        contentAlignment = Alignment.BottomEnd,
    ) {
        Column(
            modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            state.toasts.forEach { message ->
                ToastCard(
                    message = message,
                    reducedMotion = reducedMotion,
                    onAction = { onAction(message) },
                    onDismiss = { onDismiss(message.id) },
                )
            }
        }
    }
}

/**
 * One transient toast — the native mirror of a single web `<motion.div role=…>`: the tone icon on the
 * left, the title + optional message + optional action in the middle, and the dismiss control on the
 * right, bordered in the variant tint and wrapped in the matching (assertive / polite) live region. The
 * card fades/scales/slides in on first composition (a plain fade under reduced motion).
 */
@Composable
private fun ToastCard(
    message: ToastMessage,
    reducedMotion: Boolean,
    onAction: () -> Unit,
    onDismiss: () -> Unit,
) {
    val accent = toneColor(message.tone.toFeedbackTone())
    val entry = rememberToastEntry(reducedMotion)
    val liveRegionMode = if (message.isAssertive) LiveRegionMode.Assertive else LiveRegionMode.Polite

    Surface(
        modifier =
            Modifier
                .widthIn(max = TOAST_MAX_WIDTH)
                .testTag(TOAST_CARD_TEST_TAG)
                .graphicsLayer {
                    alpha = entry
                    scaleX = toastEntryScale(entry, reducedMotion)
                    scaleY = toastEntryScale(entry, reducedMotion)
                    translationY = (1f - entry) * if (reducedMotion) 0f else ENTRY_SLIDE_FROM.toPx()
                }.semantics(mergeDescendants = true) { liveRegion = liveRegionMode },
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = CONTAINER_ELEVATION_DP.dp,
        shadowElevation = CONTAINER_ELEVATION_DP.dp,
        border = BorderStroke(1.dp, accent.copy(alpha = BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = toneGlyph(message.tone.toFeedbackTone()),
                contentDescription = null,
                size = IconSize.Sm,
                tint = accent,
                modifier = Modifier.padding(top = ICON_TOP_NUDGE),
            )
            ToastCardBody(message = message, onAction = onAction, modifier = Modifier.weight(1f))
            ToastDismissButton(onDismiss = onDismiss)
        }
    }
}

/** The title + optional message + optional action column (web toast body). */
@Composable
private fun ToastCardBody(
    message: ToastMessage,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(
            text = message.title,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        message.message?.let { body ->
            BodyText(
                text = body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = DESCRIPTION_MAX_LINES,
            )
        }
        message.action?.let { action ->
            Button(
                label = toastActionLabel(action),
                onClick = onAction,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The dismiss control — the web `<button aria-label="Dismiss notification"><X/></button>`. */
@Composable
private fun ToastDismissButton(onDismiss: () -> Unit) {
    IconButton(
        imageVector = TeslaGlyphs.Close,
        contentDescription = stringResource(R.string.translation_a11y_dismissNotification),
        onClick = onDismiss,
        variant = IconButtonVariant.Standard,
        size = IconSize.Sm,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The action's visible label — a navigation action carries the web "label →" arrow; a callback does not. */
private fun toastActionLabel(action: ToastAction): String =
    when (action) {
        is ToastAction.Navigate -> action.label + VIEW_ARROW
        is ToastAction.Callback -> action.label
    }

// ── Motion helpers ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun rememberToastEntry(reducedMotion: Boolean): Float {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(reducedMotion) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(durationMillis = if (reducedMotion) 0 else ENTRY_DURATION_MS))
    }
    return progress.value
}

private fun toastEntryScale(
    entry: Float,
    reducedMotion: Boolean,
): Float = if (reducedMotion) 1f else ENTRY_SCALE_FROM + (1f - ENTRY_SCALE_FROM) * entry

// ── Previews (tooling-only; sample toasts are never shipped UI) ──────────────────────────────────────

private fun previewMessage(
    tone: ToastTone,
    title: String,
    message: String? = null,
    action: ToastAction? = null,
): ToastMessage =
    ToastMessage(
        id = "preview-${tone.name}",
        tone = tone,
        title = title,
        message = message,
        action = action,
    )

@Composable
private fun previewSurface(state: ToastHostState) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            ToastHostContent(
                state = state,
                reducedMotion = true,
                onAction = {},
                onDismiss = {},
            )
        }
    }
}

@Preview(name = "Toast — success")
@Composable
private fun ToastSuccessPreview() {
    previewSurface(
        ToastHostState(
            listOf(previewMessage(ToastTone.Success, title = "Settings saved", message = "Your changes are live.")),
        ),
    )
}

@Preview(name = "Toast — error (assertive)")
@Composable
private fun ToastErrorPreview() {
    previewSurface(
        ToastHostState(
            listOf(previewMessage(ToastTone.Error, title = "Couldn't save", message = "Check your connection and retry.")),
        ),
    )
}

@Preview(name = "Toast — info with View link")
@Composable
private fun ToastInfoActionPreview() {
    previewSurface(
        ToastHostState(
            listOf(
                previewMessage(
                    tone = ToastTone.Info,
                    title = "Battery alert",
                    message = "State of charge dropped below 20%.",
                    action = ToastAction.Navigate(label = "View", route = "/battery"),
                ),
            ),
        ),
    )
}

@Preview(name = "Toast — warning with Undo")
@Composable
private fun ToastWarningActionPreview() {
    previewSurface(
        ToastHostState(
            listOf(
                previewMessage(
                    tone = ToastTone.Warning,
                    title = "Rule deleted",
                    action = ToastAction.Callback(label = "Undo", onInvoke = {}),
                ),
            ),
        ),
    )
}

@Preview(name = "Toast — stacked queue")
@Composable
private fun ToastStackPreview() {
    previewSurface(
        ToastHostState(
            listOf(
                previewMessage(ToastTone.Success, title = "Settings saved"),
                previewMessage(ToastTone.Info, title = "Export ready", message = "Your CSV is ready to download."),
                previewMessage(ToastTone.Error, title = "Sync failed"),
            ),
        ),
    )
}

@Preview(name = "Toast — empty (invisible host)")
@Composable
private fun ToastEmptyPreview() {
    previewSurface(ToastHostState.Empty)
}
