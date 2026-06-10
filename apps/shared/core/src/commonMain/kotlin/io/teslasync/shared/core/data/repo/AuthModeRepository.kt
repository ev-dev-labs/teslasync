package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The per-feature gate the SPA uses to decide whether to mount an auth-coupled section or
 * replace it with the inline `RequiresAuth` empty state — the cross-platform analogue of the
 * web `AuthModeCapabilities` interface (web/src/api/types.ts). Every field is `false` in open
 * mode and `true` in forward-auth mode; the per-feature *preconditions* still live inside each
 * feature's own handler, so this matrix only reports whether the deployment's auth mode allows
 * the feature to exist at all.
 *
 * The keys are kept in lock-step with `internal/api.AuthModeCapabilities` — drift here silently
 * disables the corresponding section. Every member defaults to `false` so a payload that omits
 * the object (or a future-added field) decodes to the safe "no auth" rendering rather than
 * failing the whole contract read.
 *
 * @property stepUpReauth whether step-up reauthentication is available.
 * @property totpEnrollment whether TOTP enrollment is available.
 * @property sessionList whether the active-session list is available.
 * @property impersonation whether operator impersonation is available.
 * @property rbac whether the role-based access-control matrix is available.
 */
@Serializable
public data class AuthModeCapabilities(
    @SerialName("step_up_reauth") public val stepUpReauth: Boolean = false,
    @SerialName("totp_enrollment") public val totpEnrollment: Boolean = false,
    @SerialName("session_list") public val sessionList: Boolean = false,
    @SerialName("impersonation") public val impersonation: Boolean = false,
    @SerialName("rbac") public val rbac: Boolean = false,
)

/**
 * The envelope returned by `GET /api/v1/system/auth-mode` — the cross-platform port of the web
 * `AuthModeResponse` interface (web/src/api/types.ts). It is the single source of truth for
 * "what authentication mode is this deployment running in, and who is the current request's
 * principal", so every auth-coupled feature gates its UI on the [capabilities] flags here.
 *
 * The wire field [mode] is carried as the verbatim contract string (`open` | `forward_auth`)
 * rather than an enum, exactly mirroring the web union: the derivations compare against the
 * literal `forward_auth`, and any other value is treated as the safe non-forward-auth rendering,
 * so an unknown/future mode can never break decoding.
 *
 * @property mode the deployment auth mode — `open` or `forward_auth` (verbatim wire string).
 * @property subjectHeader header name TeslaSync reads (e.g. `X-Forwarded-User`); `null` in open
 *   mode (the server omits it).
 * @property subject the current request's resolved subject (the value of [subjectHeader]);
 *   `null` in open mode AND when the proxy stripped the header for this specific request.
 * @property providerHint operator-supplied free text (typically the upstream IdP's brand name);
 *   rendered verbatim by the SPA and never used as a routing key.
 * @property capabilities the per-feature gate matrix (see [AuthModeCapabilities]).
 */
@Serializable
public data class AuthModeResponse(
    @SerialName("mode") public val mode: String,
    @SerialName("subject_header") public val subjectHeader: String? = null,
    @SerialName("subject") public val subject: String? = null,
    @SerialName("provider_hint") public val providerHint: String? = null,
    @SerialName("capabilities") public val capabilities: AuthModeCapabilities = AuthModeCapabilities(),
)

/**
 * The S7 data port for the deployment auth-mode contract — the cross-platform analogue of the
 * web `useAuthMode` hook domain (web/src/api/hooks/useAuthMode.ts). Every native auth-coupled
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8 state-holder
 * tests.
 *
 * The single member is a read — `useAuthMode.ts` contains only one `useQuery`, no mutations — so
 * it streams a cache-then-network [Resource] (ADR-013): the cached value first for an instant
 * cold start, then the refreshed value. The web hook's two convenience hooks (`useIsForwardAuth`,
 * `useAuthSubject`) are pure client-side derivations of this read and carry no endpoint of their
 * own, so they live in the presentation layer, not here. There is nothing to invalidate.
 *
 * The payload is plain auth metadata (mode, subject, capability bools) — not display-unit-bearing
 * — so there is no S5 conversion to do here and the exact server shape round-trips unchanged.
 */
public interface AuthModeRepository {
    /**
     * `GET /system/auth-mode` — the deployment's auth-mode contract. The endpoint is cheap (no
     * DB / no Redis) and is designed never to 4xx/5xx; a transport-level failure surfaces through
     * [Resource.Error] so consumers can render a generic offline state.
     */
    public fun authMode(): Flow<Resource<AuthModeResponse>>
}
