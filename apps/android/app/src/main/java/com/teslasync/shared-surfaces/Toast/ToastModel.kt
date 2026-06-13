// Pure, framework-free model + projection + diagnostics for the Toast shared surface — the native
// analogue of everything the web source owns before it returns JSX
// (web/src/components/feedback/Toast.tsx). No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a
// `ToastProvider` that owns a transient queue of toasts and the imperative API to drive it
// (`toast`/`success`/`error`/`info`/`warning`/`dismiss`), exposed to consumers via `useToast`
// (throws without a provider) and `useOptionalToast` (returns null). Each toast is one of four
// variants (success | error | info | warning) carrying a title, an optional message, an optional
// action (a React Router `<Link to>` OR a `<button onClick>` — exactly one, navigation wins), and a
// duration (default 4000ms) after which it auto-dismisses. The newest five are kept (`slice(-4)`
// plus the new one); the error variant announces assertively (`role="alert"`), the rest politely
// (`role="status"`); the entry/exit animation collapses under reduced motion. `useMutationToast`
// (web `_toastHelpers`) maps a TanStack mutation outcome onto a success/error toast.
//
// Because the web source is a notification PRIMITIVE rather than a data-fetch surface, there is no
// remote read and therefore no loading/stale/offline lifecycle to invent — the honest, faithful
// state set is: the populated stack ([ToastHostState.isVisible], every tone + action + message
// branch) and the empty queue ([ToastHostState.isEmpty], an invisible overlay — exactly what the
// web host renders when `toasts` is empty). The `error` variant carries the assertive-announcement
// branch. Fabricating a persistent "friendly empty box" or a "retry" surface here would be silent
// drift from the source (covenant #9) — a toast host MUST be invisible when idle.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Toast — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import io.teslasync.android.components.feedback.Tone
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the Toast surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates; [ID] is the
 * stable `viewModel` key a host binds the toast host with. [DEFAULT_DURATION_MILLIS] mirrors the web
 * `duration ?? 4000`, and [MAX_VISIBLE] mirrors the web `[...prev.slice(-4), new]` cap of five.
 */
object ToastRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the toast host with). */
    const val ID: String = "toast-host"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Toast"

    /** Default auto-dismiss lifetime per toast, mirroring the web `duration ?? 4000`. */
    const val DEFAULT_DURATION_MILLIS: Long = 4_000L

    /** Most-recent toasts retained, mirroring the web `[...prev.slice(-4), new]` cap. */
    const val MAX_VISIBLE: Int = 5
}

/**
 * The four transient-feedback variants — the native mirror of the web `ToastType`
 * (`success | error | info | warning`). Each maps onto a [Tone] for the shared
 * `toneColor`/`toneGlyph` palette and onto a [ToastLiveRegion] for the screen-reader announcement
 * politeness.
 */
enum class ToastTone {
    /** A user-initiated action succeeded (web `success`). */
    Success,

    /** A user-initiated action failed (web `error`) — announced assertively. */
    Error,

    /** Neutral informational feedback (web `info`). */
    Info,

    /** A cautionary, non-failing condition (web `warning`). */
    Warning,
}

/**
 * Screen-reader announcement politeness — the native mirror of the web `ariaRole` map. The web
 * `error` toast renders `role="alert"` (implicit `aria-live="assertive"`); the rest render
 * `role="status"` (implicit `aria-live="polite"`). On Android these map onto a Compose
 * `LiveRegionMode`.
 */
enum class ToastLiveRegion {
    /** Interrupt-and-announce, for the `error` variant (web `role="alert"`). */
    Assertive,

    /** Announce at the next graceful opportunity, for the other variants (web `role="status"`). */
    Polite,
}

/** The shared `toneColor`/`toneGlyph` palette tone backing this variant (web `styles`/`icons`). */
fun ToastTone.toFeedbackTone(): Tone =
    when (this) {
        ToastTone.Success -> Tone.Success
        ToastTone.Error -> Tone.Danger
        ToastTone.Info -> Tone.Info
        ToastTone.Warning -> Tone.Warning
    }

/** The announcement politeness for this variant — assertive for [ToastTone.Error], else polite. */
fun ToastTone.liveRegion(): ToastLiveRegion = if (this == ToastTone.Error) ToastLiveRegion.Assertive else ToastLiveRegion.Polite

/**
 * The optional action rendered in a toast body — the native mirror of the web `ToastAction`, whose
 * two flavours are discriminated by which field is set:
 *  - [Navigate] is the web `{ label, to }` form: a deep link into a context page (rendered as a web
 *    `<Link to>`). The host routes [route]; the toast dismisses on tap.
 *  - [Callback] is the web `{ label, onClick }` form: an arbitrary handler (e.g. "Undo") that fires
 *    then dismisses the toast.
 *
 * Exactly one flavour exists per action (a sealed hierarchy), so the "navigation wins when both are
 * supplied" rule from the web source is resolved once, in [toastAction], rather than at every call
 * site.
 */
sealed interface ToastAction {
    /** Visible label, e.g. "View" or "Undo". */
    val label: String

    /**
     * The web `{ label, to }` navigation action — a deep link the host routes. [route] is a path +
     * query string, the same shape as the web `<Link to>` target.
     */
    data class Navigate(
        override val label: String,
        val route: String,
    ) : ToastAction

    /**
     * The web `{ label, onClick }` callback action — [onInvoke] runs, then the toast auto-dismisses
     * so the caller never has to dismiss manually.
     */
    data class Callback(
        override val label: String,
        val onInvoke: () -> Unit,
    ) : ToastAction
}

/**
 * Builds a [ToastAction] from the loosely-typed inputs a caller supplies, resolving the web rule
 * "the navigation form wins so existing call-sites stay intact": a non-null [route] yields a
 * [ToastAction.Navigate]; otherwise a non-null [onClick] yields a [ToastAction.Callback]; otherwise
 * `null` (no action). Mirrors the web `action.to ? <Link/> : action.onClick ? <button/> : null`.
 */
fun toastAction(
    label: String,
    route: String? = null,
    onClick: (() -> Unit)? = null,
): ToastAction? =
    when {
        route != null -> ToastAction.Navigate(label, route)
        onClick != null -> ToastAction.Callback(label, onClick)
        else -> null
    }

/**
 * One transient toast — the native mirror of the web `Toast` interface. Pure data (no Compose
 * types), so the whole queue contract is unit-tested without a UI host.
 *
 * @property id stable queue key + dismiss target (web `toast-${++counter}`).
 * @property tone the variant driving the icon, border tint, and announcement politeness.
 * @property title the bold leading line (web `t.title`); already localized by the caller.
 * @property message the optional secondary line (web `t.message`); already localized.
 * @property durationMillis auto-dismiss lifetime; `0` (or negative) pins the toast until dismissed.
 * @property action the optional navigate/callback affordance (web `t.action`).
 */
data class ToastMessage(
    val id: String,
    val tone: ToastTone,
    val title: String,
    val message: String? = null,
    val durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
    val action: ToastAction? = null,
) {
    /** The announcement politeness for this toast (web `ariaRole`). */
    val liveRegion: ToastLiveRegion get() = tone.liveRegion()

    /** Whether this toast announces assertively — the web `role="alert"` (error) branch. */
    val isAssertive: Boolean get() = liveRegion == ToastLiveRegion.Assertive

    /** Whether this toast schedules an auto-dismiss (web `duration > 0`). */
    val autoDismisses: Boolean get() = durationMillis > 0L
}

/**
 * Appends [message] to the visible [queue] and caps it to the [max] most recent — the native mirror
 * of the web `setToasts(prev => [...prev.slice(-4), { ...opts, id }])`. A message already present by
 * [ToastMessage.id] is replaced in place (re-showing the same id never duplicates it); with unique
 * counter ids this is exactly the web append.
 */
fun enqueueToastMessage(
    queue: List<ToastMessage>,
    message: ToastMessage,
    max: Int = ToastRegistration.MAX_VISIBLE,
): List<ToastMessage> {
    val appended = queue.filterNot { it.id == message.id } + message
    return if (max > 0 && appended.size > max) appended.takeLast(max) else appended
}

/** Removes the toast with [id] from the [queue] — the native mirror of the web `dismiss(id)`. */
fun dismissToastMessage(
    queue: List<ToastMessage>,
    id: String,
): List<ToastMessage> = queue.filterNot { it.id == id }

/**
 * The fully-folded, render-ready state the composable paints — the native mirror of what the web
 * `ToastProvider` renders from its `toasts` array. Pure data (no Compose types) so the whole
 * contract is unit-tested without a UI host.
 *
 * @property toasts the visible queue, oldest-first (web render order), capped to
 *   [ToastRegistration.MAX_VISIBLE].
 */
data class ToastHostState(
    val toasts: List<ToastMessage>,
) {
    /** True when the queue is empty — the overlay renders nothing (web host with no children). */
    val isEmpty: Boolean get() = toasts.isEmpty()

    /** True when at least one toast is visible — the populated stack. */
    val isVisible: Boolean get() = toasts.isNotEmpty()

    /** True when any visible toast announces assertively (drives the merged live-region politeness). */
    val hasAssertive: Boolean get() = toasts.any { it.isAssertive }

    companion object {
        /** The idle host: an empty queue rendering an invisible overlay. */
        val Empty: ToastHostState = ToastHostState(emptyList())
    }
}

/** Folds the visible [toasts] queue into the render-ready [ToastHostState]. */
fun projectToastHost(toasts: List<ToastMessage>): ToastHostState = ToastHostState(toasts)

/**
 * The localized copy a mutation-driven toast is built from — the native mirror of the web
 * `useMutationToast({ success, error })` messages. The caller resolves these through the i18n facade
 * (P1/S10); the model never holds English literals.
 *
 * @property successTitle the bold line shown when the mutation succeeds.
 * @property successMessage the optional secondary success line.
 * @property errorTitle the bold line shown when the mutation fails.
 * @property errorMessage the optional secondary failure line.
 */
data class MutationToastCopy(
    val successTitle: String,
    val successMessage: String? = null,
    val errorTitle: String,
    val errorMessage: String? = null,
)

/**
 * Maps a mutation outcome onto a [ToastMessage] — the native mirror of the web `useMutationToast`
 * `onSuccess`/`onError` handlers: a [succeeded] outcome yields a [ToastTone.Success] toast from the
 * success copy, a failure yields a [ToastTone.Error] toast from the error copy. Pure, so the mapping
 * is unit-tested without enqueuing.
 */
fun mutationToastMessage(
    id: String,
    succeeded: Boolean,
    copy: MutationToastCopy,
    durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
    action: ToastAction? = null,
): ToastMessage =
    if (succeeded) {
        ToastMessage(
            id = id,
            tone = ToastTone.Success,
            title = copy.successTitle,
            message = copy.successMessage,
            durationMillis = durationMillis,
            action = action,
        )
    } else {
        ToastMessage(
            id = id,
            tone = ToastTone.Error,
            title = copy.errorTitle,
            message = copy.errorMessage,
            durationMillis = durationMillis,
            action = action,
        )
    }

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [ToastRegistration.SLUG] (P1/S11) — never a toast title, message, or action target, so a
 * diagnostics line can never leak the content of a user's confirmation. Kept free of Compose so it
 * is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordToastHostOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ToastRegistration.SLUG))
}
