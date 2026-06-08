package io.teslasync.shared.core.presentation.totp

/**
 * The UI-free seam the [TOTPStore] notifies after a successful step-up, mirroring the web
 * `setCachedSudoToken({ token, expiresAtMs })` side effect that `useTOTPStepUp` performs inline
 * (web/src/api/hooks/useTOTP.ts). The web interceptor parks the freshly minted token in memory so
 * every subsequent request from the tab automatically carries the `X-Sudo-Token` header and clears
 * the next `SUDO_REQUIRED` gate; this seam lets the platform/networking layer (S6) reproduce that
 * without the state holder reaching into the HTTP client.
 *
 * The default [Noop] discards the token, keeping the holder independently testable and inert until a
 * platform wires a real sink — exactly as the foundation's [io.teslasync.shared.core.net.NoopTokenProvider]
 * does for the auth seam.
 */
public fun interface SudoTokenSink {
    /**
     * Parks a freshly minted step-up [token] valid until [expiresAtMillis] (epoch millis, already
     * parsed from the response's ISO `expires_at` via [TOTPDerivations.sudoExpiryMillis]).
     */
    public fun cache(
        token: String,
        expiresAtMillis: Long,
    )

    public companion object {
        /** Inert default: drops the token. Replaced by the S6/platform wiring. */
        public val Noop: SudoTokenSink = SudoTokenSink { _, _ -> }
    }
}
