// The shared state-holder seam the Toast surface binds to — the native analogue of the toast context
// the web source defines and exposes (web/src/components/feedback/Toast.tsx): the `ToastContextValue`
// consumed via `useToast` (throws without a provider) and `useOptionalToast` (returns null), plus the
// `useMutationToast` helper. Like the web `ToastProvider`, the surface OWNS this holder (there is no
// remote toast feed — a toast queue is a pure client-side UI primitive), so "bind via the shared
// state-holder, no HTTP from the view" is satisfied honestly: the view collects [ToastController.toasts]
// and forwards the imperative calls, and never performs I/O of any kind.
//
// [DefaultToastController] is the framework-free queue owner (no Compose, no Android) so the entire
// enqueue/cap/dismiss contract is covered by the JVM unit gate, and any screen — including a
// background mutation callback — can enqueue a toast onto the single app-scoped instance a host
// provides through `LocalToastController`.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Toast) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake
// interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.atomic.AtomicLong

/**
 * The toast queue holder + imperative API — the native port of the web `ToastContextValue`. A host
 * provides one app-scoped instance (the native `ToastProvider`); consumers enqueue toasts through it
 * exactly as web call-sites use `useToast().success(...)` / `error(...)` / `dismiss(id)`.
 *
 * [toasts] is the live, oldest-first queue the host renders, capped to [ToastRegistration.MAX_VISIBLE].
 * The `show*` calls return the id of the enqueued toast so a caller can [dismiss] it early (e.g. an
 * "Undo" that resolves). The holder performs NO I/O — it is the in-memory queue the view observes.
 */
interface ToastController {
    /** The live, oldest-first visible queue (web `toasts`), capped to [ToastRegistration.MAX_VISIBLE]. */
    val toasts: StateFlow<List<ToastMessage>>

    /**
     * Enqueues a fully-built [message] (web `toast(opts)`). A blank [ToastMessage.id] is assigned a
     * fresh unique id; a non-blank id is honoured (re-showing it replaces in place). Returns the id.
     */
    fun show(message: ToastMessage): String

    /**
     * Enqueues a toast from its parts (web `toast({ type, title, message, duration, action })`),
     * assigning a fresh id and defaulting the duration to [ToastRegistration.DEFAULT_DURATION_MILLIS].
     * Returns the id.
     */
    fun show(
        tone: ToastTone,
        title: String,
        message: String? = null,
        durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
        action: ToastAction? = null,
    ): String

    /** Enqueues a [ToastTone.Success] toast (web `success(title, message)`). Returns the id. */
    fun success(
        title: String,
        message: String? = null,
    ): String = show(ToastTone.Success, title, message)

    /** Enqueues a [ToastTone.Error] toast (web `error(title, message)`). Returns the id. */
    fun error(
        title: String,
        message: String? = null,
    ): String = show(ToastTone.Error, title, message)

    /** Enqueues a [ToastTone.Info] toast (web `info(title, message)`). Returns the id. */
    fun info(
        title: String,
        message: String? = null,
    ): String = show(ToastTone.Info, title, message)

    /** Enqueues a [ToastTone.Warning] toast (web `warning(title, message)`). Returns the id. */
    fun warning(
        title: String,
        message: String? = null,
    ): String = show(ToastTone.Warning, title, message)

    /** Removes the toast with [id] from the queue (web `dismiss(id)`). A no-op if absent. */
    fun dismiss(id: String)

    /** Removes every toast (the native convenience the web provider gets implicitly on unmount). */
    fun clear()
}

/**
 * The default, framework-free [ToastController] — the native `ToastProvider` queue owner. Holds the
 * queue in a [MutableStateFlow] and folds each mutation through the pure [enqueueToastMessage] /
 * [dismissToastMessage], so the cap-to-[maxVisible] and dismiss semantics are identical to the web
 * `setToasts(prev => [...prev.slice(-4), …])`. Enqueues are atomic ([MutableStateFlow.update]), so a
 * toast raised from a background mutation callback is safe.
 *
 * @param maxVisible most-recent toasts retained (web `slice(-4)` → five).
 * @param defaultDurationMillis the auto-dismiss lifetime applied when a caller omits one (web 4000).
 * @param idFactory the unique-id source (web `++toastCounter`); a test seam for deterministic ids.
 */
class DefaultToastController(
    private val maxVisible: Int = ToastRegistration.MAX_VISIBLE,
    private val defaultDurationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
    private val idFactory: () -> String = defaultToastIdFactory(),
) : ToastController {
    private val queue = MutableStateFlow<List<ToastMessage>>(emptyList())

    override val toasts: StateFlow<List<ToastMessage>> = queue.asStateFlow()

    override fun show(message: ToastMessage): String {
        val resolved = if (message.id.isBlank()) message.copy(id = idFactory()) else message
        queue.update { current -> enqueueToastMessage(current, resolved, maxVisible) }
        return resolved.id
    }

    override fun show(
        tone: ToastTone,
        title: String,
        message: String?,
        durationMillis: Long,
        action: ToastAction?,
    ): String =
        show(
            ToastMessage(
                id = idFactory(),
                tone = tone,
                title = title,
                message = message,
                durationMillis = durationMillis,
                action = action,
            ),
        )

    override fun dismiss(id: String) {
        queue.update { current -> dismissToastMessage(current, id) }
    }

    override fun clear() {
        queue.update { emptyList() }
    }

    /** The default duration this controller applies to a [show] that omits one. */
    fun defaultDurationMillis(): Long = defaultDurationMillis
}

/**
 * A fresh monotonic id source — the native `++toastCounter`. Thread-safe ([AtomicLong]) so toasts
 * raised concurrently from background mutation callbacks never collide on an id.
 */
fun defaultToastIdFactory(): () -> String {
    val counter = AtomicLong(0L)
    return { "toast-${counter.incrementAndGet()}" }
}

/**
 * Maps a mutation outcome onto a toast and enqueues it — the native `useMutationToast`: a [succeeded]
 * outcome raises a success toast from [copy], a failure raises an error toast. The id is assigned by
 * the controller. Returns the enqueued toast's id so the caller can dismiss it early if needed.
 */
fun ToastController.mutationToast(
    succeeded: Boolean,
    copy: MutationToastCopy,
    durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
    action: ToastAction? = null,
): String =
    show(
        mutationToastMessage(
            id = "",
            succeeded = succeeded,
            copy = copy,
            durationMillis = durationMillis,
            action = action,
        ),
    )
