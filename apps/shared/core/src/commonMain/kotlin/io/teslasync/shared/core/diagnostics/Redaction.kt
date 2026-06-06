package io.teslasync.shared.core.diagnostics

/**
 * Central PII scrubber for the shared diagnostics module (ADR-016 §2).
 *
 * Redaction is applied in exactly one place — every [Logger] field, [Telemetry]
 * property, and [CrashReporter] breadcrumb/exception passes through here before it
 * can reach any sink. A new call site therefore cannot leak by forgetting to
 * sanitize: the deny-list lives here, not at the call boundary.
 *
 * Two complementary passes run:
 *  - **key match** — a structured field whose (normalized) key is on the forbidden
 *    deny-list is replaced wholesale with [REDACTED];
 *  - **value scrub** — every remaining value (and every free-text breadcrumb) is
 *    scanned for PII value patterns (VIN, JWT/bearer tokens, decimal-degree
 *    coordinate pairs, e-mail, E.164 phone) and matches are replaced with
 *    [REDACTED]. This is the defense-in-depth backstop the ADR mandates even when
 *    the schema already forbids PII keys.
 *
 * Non-PII operational fields (`drive_id`, SI quantities, status codes, durations,
 * stable screen names) carry no personal data and are retained verbatim.
 */
public object Redaction {
    /** Replacement token emitted in place of any matched PII. */
    public const val REDACTED: String = "[REDACTED]"

    // ADR-016 §2 deny-list keys, normalized (lower-cased, separators stripped) so
    // both snake_case (`access_token`) and camelCase (`accessToken`) collapse to one
    // canonical form.
    private val forbiddenKeys: Set<String> =
        setOf(
            // VIN / vehicle identity
            "vin",
            "vehicle_id",
            "vehicleIdentificationNumber",
            // tokens / secrets
            "token",
            "access_token",
            "refresh_token",
            "id_token",
            "authorization",
            "bearer",
            "api_key",
            "client_secret",
            "password",
            "cookie",
            "session",
            // precise location
            "lat",
            "latitude",
            "lon",
            "lng",
            "longitude",
            "coords",
            "gps",
            "address",
            // contact PII
            "email",
            "phone",
            "name",
            "user_id",
        ).mapTo(mutableSetOf()) { normalizeKey(it) }

    // ADR-016 §2 value patterns. Order matters: the most specific (JWT) runs before
    // the broader bearer-prefix sweep so a token is collapsed once, cleanly.
    private val valuePatterns: List<Regex> =
        listOf(
            // JWT (two or three base64url segments).
            Regex("eyJ[A-Za-z0-9_=-]+\\.[A-Za-z0-9_=-]+(?:\\.[A-Za-z0-9_=-]+)?"),
            // "Bearer <opaque>" authorization values.
            Regex("Bearer\\s+[A-Za-z0-9._~+/=-]+", RegexOption.IGNORE_CASE),
            // 17-char VIN (excludes I, O, Q per the VIN alphabet).
            Regex("\\b[A-HJ-NPR-Z0-9]{17}\\b"),
            // Decimal-degree coordinate pair, e.g. "37.4220, -122.0841".
            Regex("-?\\d{1,3}\\.\\d{3,}\\s*,\\s*-?\\d{1,3}\\.\\d{3,}"),
            // RFC-5322-ish e-mail.
            Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"),
            // E.164 phone number.
            Regex("\\+[1-9]\\d{6,14}\\b"),
        )

    /**
     * Redacts a single structured field. Returns [REDACTED] when [key] is on the
     * deny-list, otherwise returns [value] with any embedded PII value pattern
     * scrubbed (defense in depth).
     */
    public fun redactField(
        key: String,
        value: String,
    ): String =
        if (normalizeKey(key) in forbiddenKeys) {
            REDACTED
        } else {
            scrubText(value)
        }

    /** Applies [redactField] to every entry of [fields], preserving key order. */
    public fun redactFields(fields: Map<String, String>): Map<String, String> {
        if (fields.isEmpty()) return fields
        val out = LinkedHashMap<String, String>(fields.size)
        for ((k, v) in fields) {
            out[k] = redactField(k, v)
        }
        return out
    }

    /**
     * Scrubs free-form text (crash breadcrumbs, log messages) by replacing every
     * PII value-pattern match with [REDACTED]. Used where there is no structured
     * key to match against.
     */
    public fun scrubText(text: String): String {
        if (text.isEmpty()) return text
        var result = text
        for (pattern in valuePatterns) {
            result = pattern.replace(result, REDACTED)
        }
        return result
    }

    private fun normalizeKey(key: String): String = key.lowercase().replace("_", "").replace("-", "")
}
