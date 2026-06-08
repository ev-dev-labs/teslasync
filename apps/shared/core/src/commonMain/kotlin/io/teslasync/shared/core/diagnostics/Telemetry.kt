package io.teslasync.shared.core.diagnostics

/** Outcome of a user-triggered command, as reported by [TelemetryEvent.CommandIssued]. */
public enum class CommandResult {
    Ok,
    Error,
}

/**
 * The fixed, schema-bound product-analytics taxonomy (ADR-016 §5). Feature code
 * cannot attach arbitrary maps — it constructs one of these typed events, whose
 * property keys are an enumerated, PII-free set. Every value still passes the
 * [Redaction] scrubber before emission as a defense-in-depth backstop.
 *
 * The taxonomy may grow only by adding typed variants here — never by emitting
 * raw strings or third-party ad-SDK events.
 */
public sealed interface TelemetryEvent {
    /** Stable event name emitted to the sink. */
    public val name: String

    /** Non-PII property key/value pairs for this event. */
    public val properties: Map<String, String>

    /** A screen / route becoming active. */
    public data class ScreenView(
        public val screen: String,
        public val platform: String,
        public val appVersion: String,
    ) : TelemetryEvent {
        override val name: String get() = "screen_view"
        override val properties: Map<String, String>
            get() =
                linkedMapOf(
                    "screen" to screen,
                    "platform" to platform,
                    "app_version" to appVersion,
                )
    }

    /** A user-triggered vehicle/app command. */
    public data class CommandIssued(
        public val command: String,
        public val surface: String,
        public val result: CommandResult,
        public val durationMs: Long,
    ) : TelemetryEvent {
        override val name: String get() = "command_issued"
        override val properties: Map<String, String>
            get() =
                linkedMapOf(
                    "command" to command,
                    "surface" to surface,
                    "result" to result.name.lowercase(),
                    "duration_ms" to durationMs.toString(),
                )
    }

    /** A handled error / failed operation surfacing to the user. */
    public data class ErrorOccurred(
        public val code: String,
        public val domain: String,
        public val screen: String,
        public val recoverable: Boolean,
    ) : TelemetryEvent {
        override val name: String get() = "error"
        override val properties: Map<String, String>
            get() =
                linkedMapOf(
                    "code" to code,
                    "domain" to domain,
                    "screen" to screen,
                    "recoverable" to recoverable.toString(),
                )
    }
}

/**
 * Typed product-analytics emitter (ADR-016 §5). No free-form payloads: callers
 * pass a [TelemetryEvent]. The emitter no-ops until diagnostics consent is
 * granted and scrubs every property value via [Redaction] first.
 */
public interface Telemetry {
    /** Records a typed [event] (subject to consent + redaction). */
    public fun track(event: TelemetryEvent)
}

/**
 * Consent-gated, redacting [Telemetry]. Emits the event's stable [TelemetryEvent.name]
 * plus its scrubbed properties to [sink]; emits nothing while [consentGranted] is `false`.
 */
internal class RedactingTelemetry(
    private val consentGranted: () -> Boolean,
    private val sink: DiagnosticsSink,
) : Telemetry {
    override fun track(event: TelemetryEvent) {
        if (!consentGranted()) return
        sink.event(
            name = event.name,
            properties = Redaction.redactFields(event.properties),
        )
    }
}
