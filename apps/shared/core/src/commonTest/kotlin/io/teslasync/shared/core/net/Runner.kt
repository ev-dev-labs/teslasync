package io.teslasync.shared.core.net

/**
 * Runs a suspending test body to completion on a real dispatcher.
 *
 * The networking tests deliberately avoid `kotlinx-coroutines-test`'s virtual-time
 * runner: Ktor's engine dispatches asynchronously, so the test scheduler would see
 * "no pending work" and fast-forward straight to the request-timeout deadline,
 * spuriously failing every call. Backoff sleeps stay instant via [VirtualScheduler],
 * so running on a real dispatcher keeps the suite fast without that race.
 */
internal expect fun runTestBlocking(block: suspend () -> Unit)
