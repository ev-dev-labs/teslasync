package io.teslasync.shared.core.presentation.notifications

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

/*
 * The cross-platform port of the web Notifications domain types
 * (the Alert/AlertRule/NotificationLog/QuietHours families in web/src/api/types.ts that back the
 * web `useNotifications` hook domain, web/src/api/hooks/useNotifications.ts). Every native
 * Notifications screen (Android/Apple via KMP, Windows via the C# port) binds to these shapes
 * through the S7 io.teslasync.shared.core.data.repo.NotificationsRepository and the S8
 * NotificationsStore.
 *
 * Keys arrive snake_case from `GET /api/v1/alerts*` / `/notifications*`; they are matched verbatim
 * via SerialName so the cached payload round-trips unchanged. No field is unit-bearing (latency is
 * already milliseconds on the wire, the same as the web `latency_ms`), so there is no SI conversion
 * at this layer — display formatting is the render boundary's job (S5).
 *
 * The channel list read (`useNotificationChannels`) and the channel save/toggle responses reuse the
 * existing NotificationChannel discriminated union from the notificationchannels package — it is
 * the same wire shape — while channel WRITE bodies use the id-free [NotificationChannelInput]
 * hierarchy below (the web `NotificationChannelCreate`/`NotificationChannelUpdate`).
 */

// ── Alert read models ─────────────────────────────────────────────────────────

/**
 * One alert/notification row — the port of the web `Alert` type. Every optional server field
 * defaults so a partial payload still decodes (web `ignoreUnknownKeys`).
 */
@Serializable
public data class Alert(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val type: String = "",
    val severity: String = "",
    val title: String = "",
    val message: String = "",
    @SerialName("is_read") val isRead: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("rule_id") val ruleId: Long? = null,
    @SerialName("rule_signal") val ruleSignal: String? = null,
    @SerialName("rule_severity") val ruleSeverity: String? = null,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
    @SerialName("acknowledged_by") val acknowledgedBy: String? = null,
    @SerialName("acknowledgement_note") val acknowledgementNote: String? = null,
)

/** One entry in an alert's audit timeline — the port of the web `AlertEvent`. */
@Serializable
public data class AlertEvent(
    val id: Long,
    @SerialName("occurred_at") val occurredAt: String = "",
    val actor: String? = null,
    val kind: String = "",
    val note: String? = null,
)

/**
 * The wire shape of `GET /alerts/{id}` — the port of the web `AlertDetail` (the web type `extends
 * Alert` with an always-present audit timeline). Kotlin data classes cannot inherit data classes,
 * so the Alert fields are repeated verbatim and [events] is added; the single response object
 * therefore decodes directly with no nesting.
 */
@Serializable
public data class AlertDetail(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val type: String = "",
    val severity: String = "",
    val title: String = "",
    val message: String = "",
    @SerialName("is_read") val isRead: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("rule_id") val ruleId: Long? = null,
    @SerialName("rule_signal") val ruleSignal: String? = null,
    @SerialName("rule_severity") val ruleSeverity: String? = null,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
    @SerialName("acknowledged_by") val acknowledgedBy: String? = null,
    @SerialName("acknowledgement_note") val acknowledgementNote: String? = null,
    val events: List<AlertEvent> = emptyList(),
)

// ── Alert rule read models ──────────────────────────────────────────────────────

/** One alert rule — the port of the web `AlertRule`. Optional fields default for partial payloads. */
@Serializable
public data class AlertRule(
    val id: Long,
    val name: String = "",
    val description: String? = null,
    val enabled: Boolean = false,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("all_vehicles") val allVehicles: Boolean? = null,
    @SerialName("vehicle_ids") val vehicleIds: List<Long>? = null,
    @SerialName("signal_name") val signalName: String = "",
    val op: String = "",
    @SerialName("value_num") val valueNum: Double? = null,
    @SerialName("value_text") val valueText: String? = null,
    @SerialName("value_bool") val valueBool: Boolean? = null,
    @SerialName("value_min") val valueMin: Double? = null,
    @SerialName("value_max") val valueMax: Double? = null,
    val severity: String = "",
    @SerialName("cooldown_min") val cooldownMin: Int = 0,
    @SerialName("trigger_mode") val triggerMode: String = "",
    @SerialName("snoozed_until") val snoozedUntil: String? = null,
    val kind: String? = null,
    @SerialName("metric_id") val metricId: String? = null,
    @SerialName("metric_window") val metricWindow: String? = null,
    @SerialName("metric_threshold") val metricThreshold: Double? = null,
    @SerialName("metric_op") val metricOp: String? = null,
    @SerialName("max_fires_per_resolution") val maxFiresPerResolution: Int? = null,
    @SerialName("escalation_after_min") val escalationAfterMin: Int? = null,
    @SerialName("escalation_severity") val escalationSeverity: String? = null,
    @SerialName("msg_template") val msgTemplate: String? = null,
    @SerialName("include_title") val includeTitle: Boolean? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/** The computed-metric registry row — the port of the web `ComputedMetricSummary`. */
@Serializable
public data class ComputedMetricSummary(
    val id: String,
    val label: String = "",
    val unit: String = "",
    val windows: List<String> = emptyList(),
    val ops: List<String> = emptyList(),
)

/** The `POST /alerts/test` computed-metric preview — the port of the web `ComputedMetricPreview`. */
@Serializable
public data class ComputedMetricPreview(
    val kind: String = "computed_metric",
    @SerialName("metric_id") val metricId: String = "",
    @SerialName("metric_window") val metricWindow: String = "",
    @SerialName("metric_op") val metricOp: String = "",
    val threshold: Double = 0.0,
    val value: Double = 0.0,
    @SerialName("would_trigger") val wouldTrigger: Boolean = false,
    @SerialName("previous_value") val previousValue: Double? = null,
    @SerialName("percent_change") val percentChange: Double? = null,
)

// ── Notification log / inbox read models ─────────────────────────────────────────

/** One notification-log row — the port of the web `NotificationLog`. */
@Serializable
public data class NotificationLog(
    val id: Long,
    @SerialName("channel_id") val channelId: Long = 0,
    @SerialName("alert_id") val alertId: Long? = null,
    val title: String = "",
    val message: String = "",
    val status: String = "",
    val severity: String? = null,
    val error: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("sent_at") val sentAt: String? = null,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
    @SerialName("latency_ms") val latencyMs: Long? = null,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("archived_at") val archivedAt: String? = null,
)

/** One server-aggregated notification thread — the port of the web `NotificationLogGroup`. */
@Serializable
public data class NotificationLogGroup(
    @SerialName("group_key") val groupKey: String? = null,
    val latest: NotificationLog,
    val count: Long = 0,
    @SerialName("unread_count") val unreadCount: Long = 0,
    @SerialName("vehicle_ids") val vehicleIds: List<Long> = emptyList(),
)

/** The `GET /notifications/unread-count` response — the port of the web `{ count }`. */
@Serializable
public data class UnreadCountResponse(
    val count: Int = 0,
)

/** Aggregate notification stats — the port of the web `NotificationStats`. */
@Serializable
public data class NotificationStats(
    @SerialName("total_sent") val totalSent: Long = 0,
    val sent: Long = 0,
    val failed: Long = 0,
    val pending: Long = 0,
    @SerialName("total_channels") val totalChannels: Long = 0,
    @SerialName("enabled_channels") val enabledChannels: Long = 0,
)

// ── Quiet hours read models ──────────────────────────────────────────────────────

/** One Do-Not-Disturb window — the port of the web `QuietHoursWindow`. */
@Serializable
public data class QuietHoursWindow(
    val id: Long,
    @SerialName("user_id") val userId: String = "",
    val enabled: Boolean = false,
    @SerialName("start_local") val startLocal: String = "",
    @SerialName("end_local") val endLocal: String = "",
    val timezone: String = "",
    val weekdays: Int = 0,
    @SerialName("bypass_severities") val bypassSeverities: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/** The `GET /notifications/quiet-hours` envelope — the port of the web `{ windows }`. */
@Serializable
public data class QuietHoursListResponse(
    val windows: List<QuietHoursWindow> = emptyList(),
)

// ── Mutation request bodies ──────────────────────────────────────────────────────

/**
 * The `POST /alerts/rules` (create) body — the port of the web `AlertRuleInput`. [name] is
 * required; every other field is dropped from the wire when null (web `JSON.stringify` drops
 * `undefined`, and `defaultApiJson` has `explicitNulls = false`).
 */
@Serializable
public data class AlertRuleInput(
    val name: String,
    val description: String? = null,
    val enabled: Boolean? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("all_vehicles") val allVehicles: Boolean? = null,
    @SerialName("vehicle_ids") val vehicleIds: List<Long>? = null,
    @SerialName("signal_name") val signalName: String? = null,
    val op: String? = null,
    @SerialName("value_num") val valueNum: Double? = null,
    @SerialName("value_text") val valueText: String? = null,
    @SerialName("value_bool") val valueBool: Boolean? = null,
    @SerialName("value_min") val valueMin: Double? = null,
    @SerialName("value_max") val valueMax: Double? = null,
    val severity: String? = null,
    @SerialName("cooldown_min") val cooldownMin: Int? = null,
    @SerialName("trigger_mode") val triggerMode: String? = null,
    @SerialName("snoozed_until") val snoozedUntil: String? = null,
    val kind: String? = null,
    @SerialName("metric_id") val metricId: String? = null,
    @SerialName("metric_window") val metricWindow: String? = null,
    @SerialName("metric_threshold") val metricThreshold: Double? = null,
    @SerialName("metric_op") val metricOp: String? = null,
    @SerialName("max_fires_per_resolution") val maxFiresPerResolution: Int? = null,
    @SerialName("escalation_after_min") val escalationAfterMin: Int? = null,
    @SerialName("escalation_severity") val escalationSeverity: String? = null,
    @SerialName("msg_template") val msgTemplate: String? = null,
    @SerialName("include_title") val includeTitle: Boolean? = null,
)

/**
 * The `PUT /alerts/rules/{id}` (partial update) body — the port of the web
 * `AlertRuleUpdate = Partial<AlertRuleInput>`. Every field is optional (including [name]); the
 * `enabled`-only instance is exactly the body the toggle mutation sends. Null fields are dropped.
 */
@Serializable
public data class AlertRuleUpdate(
    val name: String? = null,
    val description: String? = null,
    val enabled: Boolean? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("all_vehicles") val allVehicles: Boolean? = null,
    @SerialName("vehicle_ids") val vehicleIds: List<Long>? = null,
    @SerialName("signal_name") val signalName: String? = null,
    val op: String? = null,
    @SerialName("value_num") val valueNum: Double? = null,
    @SerialName("value_text") val valueText: String? = null,
    @SerialName("value_bool") val valueBool: Boolean? = null,
    @SerialName("value_min") val valueMin: Double? = null,
    @SerialName("value_max") val valueMax: Double? = null,
    val severity: String? = null,
    @SerialName("cooldown_min") val cooldownMin: Int? = null,
    @SerialName("trigger_mode") val triggerMode: String? = null,
    @SerialName("snoozed_until") val snoozedUntil: String? = null,
    val kind: String? = null,
    @SerialName("metric_id") val metricId: String? = null,
    @SerialName("metric_window") val metricWindow: String? = null,
    @SerialName("metric_threshold") val metricThreshold: Double? = null,
    @SerialName("metric_op") val metricOp: String? = null,
    @SerialName("max_fires_per_resolution") val maxFiresPerResolution: Int? = null,
    @SerialName("escalation_after_min") val escalationAfterMin: Int? = null,
    @SerialName("escalation_severity") val escalationSeverity: String? = null,
    @SerialName("msg_template") val msgTemplate: String? = null,
    @SerialName("include_title") val includeTitle: Boolean? = null,
)

/**
 * The `POST /alerts/rules` vs `PUT /alerts/rules/{id}` discriminated request — the port of the web
 * `AlertRuleSaveRequest = AlertRuleInput | (AlertRuleUpdate & { id })`. [Create] posts the full
 * input; [Update] strips the id from the body and PUTs to the id-scoped path (exactly the web
 * `if ('id' in data)` branch).
 */
public sealed interface AlertRuleSaveRequest {
    /** Create branch — `POST /alerts/rules` with the full [input]. */
    public data class Create(
        public val input: AlertRuleInput,
    ) : AlertRuleSaveRequest

    /** Update branch — `PUT /alerts/rules/{id}` with the id-free [patch] body. */
    public data class Update(
        public val id: Long,
        public val patch: AlertRuleUpdate,
    ) : AlertRuleSaveRequest
}

/** The `POST /alerts/rules/{id}/snooze` body — the port of the web `AlertRuleSnoozeRequest`. */
@Serializable
public data class AlertRuleSnoozeRequest(
    val minutes: Int? = null,
    val until: String? = null,
)

/** The `POST /alerts/test` target — the port of the web `AlertTestTarget`. */
@Serializable
public data class AlertTestTarget(
    @SerialName("all_channels") val allChannels: Boolean? = null,
    @SerialName("channel_ids") val channelIds: List<Long>? = null,
)

/** The `POST /alerts/test` body — the port of the web `AlertTestRequest`. */
@Serializable
public data class AlertTestRequest(
    val message: String? = null,
    val target: AlertTestTarget? = null,
    @SerialName("msg_template") val msgTemplate: String? = null,
    @SerialName("include_title") val includeTitle: Boolean? = null,
)

/**
 * The `POST /alerts/test` computed-metric preview body — the port of the web
 * `usePreviewComputedMetric` payload (`{ kind: 'computed_metric', ... }`). [kind] is fixed and
 * always serialized; [vehicleId] is dropped when null.
 */
@Serializable
public data class ComputedMetricPreviewInput(
    @SerialName("metric_id") val metricId: String,
    @SerialName("metric_window") val metricWindow: String,
    @SerialName("metric_op") val metricOp: String,
    @SerialName("metric_threshold") val metricThreshold: Double,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val kind: String = "computed_metric",
)

/**
 * The `POST/PATCH /notifications/quiet-hours` body — the port of the web `QuietHoursWindowInput`.
 * All fields optional so the same body serves create and partial update; null fields are dropped.
 */
@Serializable
public data class QuietHoursWindowInput(
    val enabled: Boolean? = null,
    @SerialName("start_local") val startLocal: String? = null,
    @SerialName("end_local") val endLocal: String? = null,
    val timezone: String? = null,
    val weekdays: Int? = null,
    @SerialName("bypass_severities") val bypassSeverities: List<String>? = null,
)

// ── Mutation result envelopes ────────────────────────────────────────────────────

/** A `{ updated }` mutation envelope — the port of the web mark-read/unread/archive responses. */
@Serializable
public data class UpdatedCountResult(
    val updated: Int = 0,
)

/** A `{ deleted }` mutation envelope — the port of the web `useDeleteNotifications` response. */
@Serializable
public data class DeletedCountResult(
    val deleted: Int = 0,
)

/** One failed row in a bulk rule op — the port of the web bulk `failed[]` entry. */
@Serializable
public data class BulkRuleFailure(
    val id: Long,
    val reason: String = "",
)

/** The `POST /alerts/rules/bulk/{enable|disable}` envelope — the port of the web bulk result. */
@Serializable
public data class BulkRulesResult(
    val updated: Int? = null,
    val failed: List<BulkRuleFailure> = emptyList(),
)

/** The `POST /notifications/{id}/test` channel-test envelope — the port of the web `{ success, error? }`. */
@Serializable
public data class ChannelTestResult(
    val success: Boolean = false,
    val error: String? = null,
)

// ── Bulk mark-read variants ──────────────────────────────────────────────────────

/**
 * The mutually-exclusive `POST /notifications/mark-read` body — the port of the web
 * `BulkMarkReadVars = { ids } | { all } | { group_key }`. Exactly one variant is sent; the wire
 * body carries only that variant's key (the repository's `bulkMarkReadBody` builder enforces this).
 */
public sealed interface BulkMarkReadVars {
    /** Mark exactly these rows read — `{ ids: [...] }`. */
    public data class Ids(
        public val ids: List<Long>,
    ) : BulkMarkReadVars

    /** Mark every currently-unread, non-archived row read — `{ all: true }`. */
    public data object All : BulkMarkReadVars

    /** Mark every member of a thread read — `{ group_key: "..." }`. */
    public data class Group(
        public val groupKey: String,
    ) : BulkMarkReadVars
}

// ── Channel write bodies (id-free create / id-bearing update) ─────────────────────

/**
 * The `POST /notifications` (create) and `PUT /notifications/{id}` (update) body — the port of the
 * web `NotificationChannelInput` (`NotificationChannelCreate | NotificationChannelUpdate`). It is a
 * discriminated union on the wire `kind`, mirroring the NotificationChannel response union but
 * WITHOUT the server-managed `created_at`/`updated_at`, and with an optional [id] that is present
 * only on the update branch (dropped from the wire when null, so a create body is id-free exactly
 * like the web `Omit<C, 'id' | ...>`). The presence of [id] also selects POST vs PUT and the path
 * in the repository.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface NotificationChannelInput {
    /** Present only when updating an existing channel; selects `PUT /notifications/{id}`. */
    public val id: Long?

    /** `discord`: posts to a Discord incoming webhook. */
    @Serializable
    @SerialName("discord")
    public data class Discord(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("webhook_url") val webhookUrl: String = "",
        val username: String? = null,
        @SerialName("avatar_url") val avatarUrl: String? = null,
    ) : NotificationChannelInput

    /** `slack`: posts to a Slack incoming webhook. */
    @Serializable
    @SerialName("slack")
    public data class Slack(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("webhook_url") val webhookUrl: String = "",
        val channel: String? = null,
        val username: String? = null,
    ) : NotificationChannelInput

    /** `telegram`: sends via a Telegram bot to a chat. */
    @Serializable
    @SerialName("telegram")
    public data class Telegram(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("bot_token") val botToken: String = "",
        @SerialName("chat_id") val chatId: String = "",
    ) : NotificationChannelInput

    /** `email`: delivers over SMTP. */
    @Serializable
    @SerialName("email")
    public data class Email(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("smtp_host") val smtpHost: String = "",
        @SerialName("smtp_port") val smtpPort: Int = 0,
        @SerialName("smtp_username") val smtpUsername: String = "",
        @SerialName("smtp_password") val smtpPassword: String = "",
        @SerialName("from_address") val fromAddress: String = "",
        @SerialName("to_addresses") val toAddresses: List<String> = emptyList(),
        @SerialName("use_tls") val useTls: Boolean = false,
    ) : NotificationChannelInput

    /** `webhook`: the HMAC-aware generic HTTP channel. */
    @Serializable
    @SerialName("webhook")
    public data class Webhook(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        val url: String = "",
        val method: String = "",
        val headers: Map<String, String> = emptyMap(),
        @SerialName("body_template") val bodyTemplate: String = "",
    ) : NotificationChannelInput

    /** `ntfy`: publishes to an ntfy topic. */
    @Serializable
    @SerialName("ntfy")
    public data class Ntfy(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("server_url") val serverUrl: String = "",
        val topic: String = "",
        val priority: Int = 3,
        val username: String? = null,
        val password: String? = null,
    ) : NotificationChannelInput

    /** `pushover`: sends a Pushover notification. */
    @Serializable
    @SerialName("pushover")
    public data class Pushover(
        override val id: Long? = null,
        val name: String,
        val enabled: Boolean = false,
        @SerialName("user_key") val userKey: String = "",
        @SerialName("app_token") val appToken: String = "",
        val device: String? = null,
        val priority: Int = 0,
    ) : NotificationChannelInput
}
