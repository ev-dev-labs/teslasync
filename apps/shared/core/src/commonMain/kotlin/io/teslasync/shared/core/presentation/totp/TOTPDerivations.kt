package io.teslasync.shared.core.presentation.totp

import kotlin.time.Instant

/**
 * Pure, side-effect-free derivations the web `useTOTP` hook domain applies client-side
 * (web/src/api/hooks/useTOTP.ts). Extracted so the KMP state holder, its golden vectors, and the
 * future Windows C# port all derive identically (ADR-004) and can never drift.
 *
 * Three web behaviours live here:
 *  - [AUTH_MODE_OPEN_CODE] is the sentinel error `code` the status hook maps to [TOTPStatus.Open]
 *    instead of surfacing as an error; the S7 repository performs the actual catch.
 *  - [statusResponse] mirrors the hook's session-mode reshape: a missing `backup_codes_remaining`
 *    normalises to `0` and the activated flag / last-used stamp pass through verbatim.
 *  - [sudoExpiryMillis] mirrors the step-up hook's `new Date(expires_at).getTime()` — the only
 *    non-trivial transform, pinned by golden vectors against the C# port.
 *  - [stepUpBody] mirrors the step-up hook's conditional body assembly (only the supplied of
 *    `code` / `backup_code` is sent), preserving snake_case keys.
 *
 * The verify / sudo sentinel error codes the SPA branches on are re-exported here so callers compare
 * against the named constants rather than magic-stringing.
 */
public object TOTPDerivations {
    /**
     * Sentinel error code mirrored from `totp_handler.AuthModeOpenCode` — treated as a
     * "feature unavailable" signal, NOT an error, exactly as the web `AUTH_MODE_OPEN_CODE` constant.
     */
    public const val AUTH_MODE_OPEN_CODE: String = "AUTH_MODE_OPEN"

    /**
     * Sentinel returned by the verify-sudo endpoint when the per-subject failure counter saturates.
     * Distinct from [TOTP_INVALID_CODE] so the SPA can render a "wait 15 minutes" hint (web
     * `TOTP_RATE_LIMITED_CODE`).
     */
    public const val TOTP_RATE_LIMITED_CODE: String = "TOTP_RATE_LIMITED"

    /** Sentinel returned by both `/verify` and `/sudo` on a code mismatch (web `TOTP_INVALID_CODE`). */
    public const val TOTP_INVALID_CODE: String = "TOTP_INVALID"

    /**
     * Sentinel returned by `/verify` when the user exceeded the 15-minute enrollment TTL before
     * confirming the QR (web `TOTP_ENROLLMENT_EXPIRED_CODE`).
     */
    public const val TOTP_ENROLLMENT_EXPIRED_CODE: String = "TOTP_ENROLLMENT_EXPIRED"

    /** Body field carrying the live authenticator code. */
    public const val CODE_FIELD: String = "code"

    /** Body field carrying a one-time backup code. */
    public const val BACKUP_CODE_FIELD: String = "backup_code"

    /**
     * Normalises the raw wire status fields into [TOTPStatus.Session], defaulting an
     * absent/null [backupCodesRemaining] to `0` and passing [activated] and [lastUsedAt] through
     * verbatim (the web hook reads them directly off the query `data`). Takes primitives rather than
     * the internal wire payload so the derivation stays a public, platform-neutral pure function.
     */
    public fun statusResponse(
        activated: Boolean,
        lastUsedAt: String?,
        backupCodesRemaining: Int?,
    ): TOTPStatus.Session =
        TOTPStatus.Session(
            activated = activated,
            lastUsedAt = lastUsedAt,
            backupCodesRemaining = backupCodesRemaining ?: 0,
        )

    /** The open-mode value the web hook substitutes for the 501 `AUTH_MODE_OPEN` response. */
    public val openResponse: TOTPStatus get() = TOTPStatus.Open

    /**
     * Parses an ISO-8601 [expiresAt] to epoch milliseconds — the cross-platform analogue of the web
     * step-up hook's `new Date(expires_at).getTime()`. The networking/reauth layer parks the minted
     * token under this expiry so subsequent requests carry the `X-Sudo-Token` header.
     */
    public fun sudoExpiryMillis(expiresAt: String): Long = Instant.parse(expiresAt).toEpochMilliseconds()

    /**
     * Assembles the step-up request body the web hook builds: only the supplied of [code] /
     * [backupCode] is included, under the snake_case [CODE_FIELD] / [BACKUP_CODE_FIELD] keys. A
     * blank value is treated as absent (the web `if (code)` / `if (backup_code)` truthiness guard),
     * so an empty string never reaches the wire. Insertion order is `code` then `backup_code`,
     * matching the web object-literal order.
     */
    public fun stepUpBody(
        code: String?,
        backupCode: String?,
    ): Map<String, String> =
        buildMap {
            if (!code.isNullOrEmpty()) put(CODE_FIELD, code)
            if (!backupCode.isNullOrEmpty()) put(BACKUP_CODE_FIELD, backupCode)
        }
}
