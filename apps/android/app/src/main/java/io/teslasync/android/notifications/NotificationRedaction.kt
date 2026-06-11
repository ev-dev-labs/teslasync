package io.teslasync.android.notifications

/**
 * PII redaction for notification display text (P3/A6, ADR-016). When the user enables privacy
 * redaction, the composer runs the title/body through [redact] so a VIN, a precise GPS coordinate pair
 * or an email address is masked before it reaches the OS notification surface or the in-app banner. It
 * is deliberately conservative — it would rather over-mask an opaque 17-character id than surface a
 * vehicle identifier on a shared/lock screen.
 */
object NotificationRedaction {
    /** The fixed marker substituted for a redacted token. */
    const val MASK = "•••"

    // A 17-character VIN (the VIN alphabet excludes I, O and Q).
    private val vinPattern = Regex("""\b[A-HJ-NPR-Z0-9]{17}\b""")

    // A decimal "lat, long" pair with at least three fractional digits (street-level precision).
    private val coordinatePattern = Regex("""[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}""")

    private val emailPattern = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")

    /** Masks any VIN, GPS coordinate pair or email address found in [text]. */
    fun redact(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        return text
            .replace(vinPattern, MASK)
            .replace(coordinatePattern, MASK)
            .replace(emailPattern, MASK)
    }
}
