package io.teslasync.android.push

import io.teslasync.shared.core.diagnostics.Logger

/** An immutable, PII-safe snapshot of the push diagnostics counters. */
data class PushDiagnosticsSnapshot(
    val registerCount: Int,
    val renewCount: Int,
    val unregisterCount: Int,
    val failureCount: Int,
    val payloadsRouted: Long,
    val lastAction: String?,
)

/**
 * Collects PII-redacted diagnostics for the push layer (P3/A6, ADR-016). It records only operational
 * counters and the last action — never a token, payload title/body, VIN or location — and emits
 * through the single sanctioned redacting [Logger]; the platform logger is never called directly.
 */
class PushDiagnostics(
    private val logger: Logger,
) {
    private val lock = Any()
    private var registerCount = 0
    private var renewCount = 0
    private var unregisterCount = 0
    private var failureCount = 0
    private var payloadsRouted = 0L
    private var lastAction: String? = null

    /** Records a successful device registration. */
    fun recordRegister(): Unit =
        record("register") {
            registerCount += 1
            registerCount
        }

    /** Records a token renewal / re-registration. */
    fun recordRenew(): Unit =
        record("renew") {
            renewCount += 1
            renewCount
        }

    /** Records a device unregister / sign-out cleanup. */
    fun recordUnregister(): Unit =
        record("unregister") {
            unregisterCount += 1
            unregisterCount
        }

    /** Records a failed registration/renewal/unregister with a PII-free [reason]. */
    fun recordFailure(
        reason: String,
        cause: Throwable? = null,
    ) {
        val count =
            synchronized(lock) {
                failureCount += 1
                lastAction = "failure:$reason"
                failureCount
            }
        logger.warn(
            "push.failure",
            mapOf("reason" to reason, "count" to count.toString(), "has_cause" to (cause != null).toString()),
        )
    }

    /** Records that one push payload was routed into the app. */
    fun recordPayloadRouted() {
        val total =
            synchronized(lock) {
                payloadsRouted += 1
                lastAction = "payload_routed"
                payloadsRouted
            }
        logger.info("push.payload_routed", mapOf("total" to total.toString()))
    }

    /** Captures an immutable, PII-safe snapshot of the current counters. */
    fun snapshot(): PushDiagnosticsSnapshot =
        synchronized(lock) {
            PushDiagnosticsSnapshot(registerCount, renewCount, unregisterCount, failureCount, payloadsRouted, lastAction)
        }

    private inline fun record(
        action: String,
        crossinline mutate: () -> Int,
    ) {
        val count =
            synchronized(lock) {
                val value = mutate()
                lastAction = action
                value
            }
        logger.info("push.$action", mapOf("count" to count.toString()))
    }
}
