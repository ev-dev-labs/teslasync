package io.teslasync.shared.core.presentation.authmode

import io.teslasync.shared.core.data.repo.AuthModeResponse

/**
 * Pure, side-effect-free derivations from the raw [AuthModeResponse] contract to the two
 * convenience values the web exposes as `useIsForwardAuth` and `useAuthSubject`
 * (web/src/api/hooks/useAuthMode.ts). Extracted so the KMP state holder, its golden vectors, and
 * the future Windows C# port all derive identically (ADR-004) and can never drift.
 *
 * Both functions accept the *current best-known* contract (or `null` while it is still loading /
 * has errored with no cache), mirroring the web hooks that read `data` from the query and treat
 * its `undefined` loading value as the safe "no auth" default.
 */
public object AuthModeDerivations {
    /**
     * The verbatim contract literal for forward-auth mode — matched, not enum-decoded, so any
     * other (or future) mode value degrades to the safe non-forward-auth rendering exactly as the
     * web union comparison does.
     */
    public const val FORWARD_AUTH: String = "forward_auth"

    /**
     * Returns `true` ONLY when the contract has resolved to `mode == forward_auth`. While the
     * read is loading (or has errored) [response] is `null` and the value is `false`, so
     * consumers default to the safe "no auth" rendering — verbatim with the web
     * `data?.mode === 'forward_auth'`.
     */
    public fun isForwardAuth(response: AuthModeResponse?): Boolean = response?.mode == FORWARD_AUTH

    /**
     * Returns the current request's resolved subject string, or `null` when we are in open mode,
     * the upstream proxy stripped the header on this specific request, or the contract has not
     * resolved yet — verbatim with the web `useAuthSubject` (`!data` ⇒ null, non-forward-auth ⇒
     * null, else `subject ?? null`).
     */
    public fun subject(response: AuthModeResponse?): String? {
        if (response == null) return null
        if (response.mode != FORWARD_AUTH) return null
        return response.subject
    }
}
