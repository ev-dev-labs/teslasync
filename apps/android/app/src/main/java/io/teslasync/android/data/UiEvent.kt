package io.teslasync.android.data

/**
 * A one-shot, fire-and-forget signal a ViewModel sends to its screen — a transient effect (a toast,
 * a snackbar, a command outcome) that must be delivered exactly once and never replayed on
 * recomposition or config change. This is the Compose-friendly equivalent of the Windows
 * `RetryRequested`/result events: it is consumed from a `Channel`-backed flow, not held as state.
 *
 * The payloads carry i18n keys (ADR-014), never pre-localized sentences, so the render boundary owns
 * the string lookup. They carry no PII (ADR-016).
 */
sealed interface UiEvent {
    /** A transient, localized user message. [args] are positional format arguments for [messageKey]. */
    data class Message(
        val messageKey: String,
        val args: List<String> = emptyList(),
        val severity: Severity = Severity.Info,
    ) : UiEvent

    /** The terminal outcome of a confirmed command (e.g. wake, sync), for a toast/snackbar. */
    data class CommandOutcome(
        val commandKey: String,
        val success: Boolean,
    ) : UiEvent

    /** The visual weight of a [Message], chosen by the render boundary's design system. */
    enum class Severity {
        Info,
        Success,
        Warning,
        Error,
    }
}
