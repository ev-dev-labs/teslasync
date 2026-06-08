package io.teslasync.shared.core.presentation.aisettings

/*
 * The UI-free domain model for the Settings → AI panel — the cross-platform port of the web
 * `useAiSettings` hook domain (web/src/api/hooks/useAiSettings.ts). These types are consumed
 * identically by Android/Apple (via KMP) and Windows (via the C# port); the one client-side
 * derivation (reasonFromCode) is locked by golden vectors shared across the three platforms
 * so they cannot drift (ADR-004).
 */

/**
 * Validation request posted to `POST /settings/ai/validate-config`.
 *
 * Mirrors `validateConfigRequest` in `internal/api/ai_settings_validate_handler.go` and the web
 * `ValidateAiProviderRequest`. Cloud mode uses the extended set (apiKey / model / apiVersion /
 * flavor / deployment / embedding*); local mode only consults [mode] + [baseUrl]. Every cloud
 * field is optional and falls back to the saved per-provider entry server-side, so editing one
 * field never forces the user to re-state the rest. Absent (null) fields are omitted from the
 * wire body — matching the web `JSON.stringify(req)` which drops `undefined` keys.
 *
 * @property mode one of `off` | `local` | `cloud`.
 */
public data class ValidateAiProviderRequest(
    val mode: String,
    val provider: String? = null,
    val baseUrl: String? = null,
    val apiKey: String? = null,
    val model: String? = null,
    val apiVersion: String? = null,
    val flavor: String? = null,
    val deployment: String? = null,
    val embeddingModel: String? = null,
    val embeddingDeployment: String? = null,
)

/**
 * The discriminated outcome of a pre-flight validation, mirroring the web
 * `ValidateAiProviderResult` union. A 2xx yields [Success]; the validator's structured 422
 * rejection is re-shaped into [Failure] (a validation *outcome*, not an error) so consumers can
 * render an inline banner without try/catch. Any other transport/HTTP failure surfaces as a
 * `Result.failure`, exactly as the web `useMutation.onError` fires for non-422 errors.
 */
public sealed interface ValidateAiProviderResult {
    /**
     * Successful validation (`ok: true`). [pinnedIp] is populated only when the local validator
     * resolved a hostname; [probedModel] echoes the model a cloud probe actually exercised so the
     * UI can render "OK — gpt-4o reachable". Fields absent from the response are surfaced as null.
     */
    public data class Success(
        val mode: String,
        val baseUrl: String,
        val pinnedIp: String? = null,
        val probedModel: String? = null,
        val note: String? = null,
    ) : ValidateAiProviderResult

    /**
     * Structured rejection re-shaped from the backend's 422 `{error, code}` envelope. [reason] is
     * the typed [ValidateAiProviderReason] derived from `code`; [message] is the human-readable
     * `error` string (mirroring the web `ApiError.message`).
     */
    public data class Failure(
        val reason: ValidateAiProviderReason,
        val message: String,
    ) : ValidateAiProviderResult
}

/**
 * Typed validation-rejection reasons, mirroring the constants in
 * `internal/api/ai_settings_validate_handler.go` and the web `ValidateAiProviderReason` union.
 * [UNKNOWN] is the exhaustive fallback for any code the server may add that this client does not
 * yet recognise — the raw human message still reaches the UI via
 * [ValidateAiProviderResult.Failure.message].
 */
public enum class ValidateAiProviderReason(
    public val code: String,
) {
    NOT_LOCAL("not_local"),
    INVALID("invalid"),
    BAD_MODE("bad_mode"),
    BAD_REQUEST("bad_request"),
    UNKNOWN_PROVIDER("unknown_provider"),
    MISSING_API_KEY("missing_api_key"),
    MISSING_BASE_URL("missing_base_url"),
    MISSING_DEPLOYMENT("missing_deployment"),
    UNAUTHORIZED("unauthorized"),
    NOT_FOUND("not_found"),
    UPSTREAM_ERROR("upstream_error"),
    TIMEOUT("timeout"),
    UNKNOWN("unknown"),
}

/**
 * Maps the backend's structured `code` to a typed [ValidateAiProviderReason] — the verbatim port
 * of the web `reasonFromCode`. Defensive against future codes: anything unrecognised (including a
 * `null`/blank code, or the literal `"unknown"`) collapses to [ValidateAiProviderReason.UNKNOWN]
 * so exhaustiveness checks keep working while the raw message is still displayed. Behaviour is
 * locked by golden vectors shared with the C# port (ADR-004).
 */
public fun reasonFromCode(code: String?): ValidateAiProviderReason =
    when (code) {
        "not_local" -> ValidateAiProviderReason.NOT_LOCAL
        "invalid" -> ValidateAiProviderReason.INVALID
        "bad_mode" -> ValidateAiProviderReason.BAD_MODE
        "bad_request" -> ValidateAiProviderReason.BAD_REQUEST
        "unknown_provider" -> ValidateAiProviderReason.UNKNOWN_PROVIDER
        "missing_api_key" -> ValidateAiProviderReason.MISSING_API_KEY
        "missing_base_url" -> ValidateAiProviderReason.MISSING_BASE_URL
        "missing_deployment" -> ValidateAiProviderReason.MISSING_DEPLOYMENT
        "unauthorized" -> ValidateAiProviderReason.UNAUTHORIZED
        "not_found" -> ValidateAiProviderReason.NOT_FOUND
        "upstream_error" -> ValidateAiProviderReason.UPSTREAM_ERROR
        "timeout" -> ValidateAiProviderReason.TIMEOUT
        else -> ValidateAiProviderReason.UNKNOWN
    }
