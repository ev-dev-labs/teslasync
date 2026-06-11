package io.teslasync.android.data

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The lifecycle of a single confirm-then-run vehicle command. */
enum class CommandPhase {
    Idle,
    AwaitingConfirmation,
    InFlight,
    Succeeded,
    Failed,
}

/**
 * Immutable state of a [CommandRunner].
 *
 * @property phase the current step of the confirm-then-run flow.
 * @property errorKind the classification of a [CommandPhase.Failed] outcome, else `null`.
 * @property httpStatus the HTTP status when the failure was an HTTP error, else `null`.
 */
data class CommandState(
    val phase: CommandPhase = CommandPhase.Idle,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
) {
    val isConfirming: Boolean get() = phase == CommandPhase.AwaitingConfirmation
    val isInFlight: Boolean get() = phase == CommandPhase.InFlight
    val isSucceeded: Boolean get() = phase == CommandPhase.Succeeded
    val isFailed: Boolean get() = phase == CommandPhase.Failed
}

/**
 * A reusable confirm-then-run state machine for a single vehicle command (wake, lock, ...). It
 * encodes the ADR-013 rule that commands are NOT cached as if applied: nothing is mutated
 * optimistically; the command goes through the shared repository (the command-proxy) and only the
 * real backend [Result] advances the state. On success it invokes [onApplied] so the owning ViewModel
 * refreshes the affected feed to reflect the true post-command state.
 *
 * Flow: [request] (user taps) -> [CommandPhase.AwaitingConfirmation] -> [confirm] (user confirms) ->
 * [CommandPhase.InFlight] -> [CommandPhase.Succeeded]/[CommandPhase.Failed]. [dismiss] cancels a
 * pending confirmation; [reset] returns to [CommandPhase.Idle] after the outcome has been shown.
 * Every transition is logged through the redacting [logger] (ADR-016) with no PII.
 *
 * @param commandKey stable, dot-namespaced command name for logging (e.g. `wake`).
 * @param scope the scope the suspending command runs in (the owner's `viewModelScope`).
 * @param logger the single sanctioned redacting logger.
 * @param onApplied invoked after a successful command so the owner can refresh real state.
 */
class CommandRunner(
    private val commandKey: String,
    private val scope: CoroutineScope,
    private val logger: Logger,
    private val onApplied: () -> Unit = {},
) {
    private val mutableState = MutableStateFlow(CommandState())

    /** The live command state to render (a confirm dialog, an in-flight spinner, the outcome). */
    val state: StateFlow<CommandState> = mutableState.asStateFlow()

    /** Begins the flow by asking for confirmation. No-op while a command is already in flight. */
    fun request() {
        if (mutableState.value.isInFlight) return
        mutableState.value = CommandState(CommandPhase.AwaitingConfirmation)
    }

    /** Dismisses a pending confirmation without running anything. */
    fun dismiss() {
        if (mutableState.value.isConfirming) reset()
    }

    /** Returns the runner to [CommandPhase.Idle] after an outcome has been surfaced. */
    fun reset() {
        mutableState.value = CommandState()
    }

    /**
     * Runs [action] (a shared-repository command returning a non-throwing [Result]) iff a confirmation
     * is pending, transitioning InFlight -> Succeeded/Failed and firing [onApplied] on success.
     */
    fun confirm(action: suspend () -> Result<*>) {
        if (!mutableState.value.isConfirming) return
        mutableState.value = CommandState(CommandPhase.InFlight)
        logger.info("command.$commandKey.start")
        scope.launch {
            action().fold(
                onSuccess = {
                    mutableState.value = CommandState(CommandPhase.Succeeded)
                    logger.info("command.$commandKey.ok")
                    onApplied()
                },
                onFailure = { error ->
                    mutableState.value = CommandState(CommandPhase.Failed, errorKindOf(error), httpStatusOf(error))
                    logger.warn("command.$commandKey.fail", mapOf("kind" to errorKindOf(error).name))
                },
            )
        }
    }
}
