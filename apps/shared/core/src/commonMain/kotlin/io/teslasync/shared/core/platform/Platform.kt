package io.teslasync.shared.core.platform

/**
 * Minimal multiplatform-wiring proof + the single platform seam allowed by the
 * S3 scaffold (ADR-004): an `expect/actual` logger and platform identity.
 *
 * Real networking/units/auth/cache logic arrives in later S-phases — this file
 * only proves `commonMain` ↔ platform `actual` wiring compiles on every target.
 */
public object Platform {
    /** Human-readable name of the host platform (never blank). */
    public val name: String get() = platformName()
}

/** Returns the running platform's name; implemented per source set. */
public expect fun platformName(): String

/** Platform-routed structured log seam; implemented per source set. */
public expect fun platformLog(message: String)
