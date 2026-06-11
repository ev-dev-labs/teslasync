package io.teslasync.android.push

/**
 * Thrown by a [PushTokenProvider] when no push channel/token can be obtained — for example when the
 * default FirebaseApp is not configured on this install (credential provisioning is P5/H5-0001 scope).
 * The [PushRegistrationService] catches it and parks registration in
 * [PushRegistrationState.Failed] with a PII-free reason rather than crashing the host.
 */
class PushChannelUnavailableException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)
