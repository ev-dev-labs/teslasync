// Pure, framework-light model + projection for the NotificationChannels feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/notifications/components/NotificationChannelsView.tsx). Every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component owns the channels CRUD surface: a four-up delivery-stats row (web `useNotificationStats`),
// an "Add Channel" affordance, a grid of channel cards (web `useNotificationChannels`), and a create/edit modal
// that builds a `NotificationChannelInput` from per-kind form fields. This file owns the parity-critical
// derivations that have nothing to do with Compose: the channel-kind catalogue (label + brand color + field
// specs, the native mirror of the web `CHANNEL_TYPES` const), the channel → form-config map (web
// `channelToFormConfig`), the form-config → `NotificationChannelInput` builder (web `buildChannelPayload`), the
// masked three-row card config preview (web `Object.entries(...).slice(0, 3)` + secret masking), and the
// four delivery-stat tiles (web `MetricCard` values). Brand colors are the channel's identity (web
// `CHANNEL_TYPES[].color`), not theme tokens, so they live here as named constants; the lucide glyphs Android
// has no bundled set for are authored as stroked vectors in the shared monochrome style, recolored at render.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/feature-views/NotificationChannelsView — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.notificationchannelsview

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object NotificationChannelsViewRegistration {
    /** Stable surface id. */
    const val ID: String = "notification-channels-view"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotificationChannelsView"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NotificationChannelsViewRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable / view-model
 * calls it from the first-composition effect. It carries no channel name, secret, or id, so a diagnostics line
 * can never leak what a user has configured.
 */
fun recordNotificationChannelsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NotificationChannelsViewRegistration.SLUG))
}

/**
 * The seven notification-channel kinds — the vendor-neutral mirror of the web `CHANNEL_TYPES[].value` union.
 * [wire] is the backend discriminator string (web `ch.kind`); [from] classifies a raw string, falling back to
 * [Webhook] for an unknown kind exactly like the web `getChannelMeta` default (`?? CHANNEL_TYPES[4]`).
 */
enum class ChannelKind(
    val wire: String,
) {
    Discord("discord"),
    Slack("slack"),
    Telegram("telegram"),
    Email("email"),
    Webhook("webhook"),
    Ntfy("ntfy"),
    Pushover("pushover"),
    ;

    companion object {
        /** Classifies a raw wire kind; unknown kinds fall back to [Webhook] (web `CHANNEL_TYPES[4]`). */
        fun from(raw: String): ChannelKind = entries.firstOrNull { it.wire == raw } ?: Webhook
    }
}

/** The [ChannelKind] of a loaded channel — the type-safe replacement for the web `ch.kind` string compare. */
val NotificationChannel.channelKind: ChannelKind
    get() =
        when (this) {
            is NotificationChannel.Discord -> ChannelKind.Discord
            is NotificationChannel.Slack -> ChannelKind.Slack
            is NotificationChannel.Telegram -> ChannelKind.Telegram
            is NotificationChannel.Email -> ChannelKind.Email
            is NotificationChannel.Webhook -> ChannelKind.Webhook
            is NotificationChannel.Ntfy -> ChannelKind.Ntfy
            is NotificationChannel.Pushover -> ChannelKind.Pushover
        }

/** The wire keys of every per-kind config field — the native mirror of the web `fields[].key` strings. */
object ChannelFieldKeys {
    const val WEBHOOK_URL = "webhook_url"
    const val BOT_TOKEN = "bot_token"
    const val CHAT_ID = "chat_id"
    const val SMTP_HOST = "smtp_host"
    const val SMTP_PORT = "smtp_port"
    const val SMTP_USERNAME = "smtp_username"
    const val SMTP_PASSWORD = "smtp_password"
    const val FROM_ADDRESS = "from_address"
    const val TO_ADDRESSES = "to_addresses"
    const val URL = "url"
    const val METHOD = "method"
    const val HEADERS = "headers"
    const val BODY_TEMPLATE = "body_template"
    const val SERVER_URL = "server_url"
    const val TOPIC = "topic"
    const val USER_KEY = "user_key"
    const val APP_TOKEN = "app_token"
}

/**
 * One editable config field of a channel kind — the native mirror of a web `CHANNEL_TYPES[].fields[]` entry.
 * [label] is the field title, [hint] the sample/ghost value shown in the empty field (the web prompt text), and
 * [secret] marks a credential rendered with a password keyboard + visual masking.
 */
data class ChannelFieldSpec(
    val key: String,
    val label: String,
    val hint: String,
    val secret: Boolean = false,
)

/**
 * The render-ready metadata for a channel kind — the native mirror of one web `CHANNEL_TYPES` entry. [label] is
 * the display name, [brandColor] the channel's identity color (web `CHANNEL_TYPES[].color`, NOT a theme token),
 * [glyph] the recolorable monochrome icon, and [fields] the ordered editable config fields.
 */
data class ChannelTypeMeta(
    val kind: ChannelKind,
    val label: String,
    val brandColor: Color,
    val glyph: ImageVector,
    val fields: List<ChannelFieldSpec>,
)

// Brand identity colors — the web `CHANNEL_TYPES[].color` hexes. These are vendor brand marks, not theme
// tokens, so (like a chart palette) they are named constants the render layer consumes verbatim.
private val DiscordBlurple = Color(0xFF5865F2)
private val SlackAubergine = Color(0xFF4A154B)
private val TelegramBlue = Color(0xFF0088CC)
private val EmailRed = Color(0xFFEA4335)
private val WebhookOrange = Color(0xFFFF6B35)
private val NtfyGreen = Color(0xFF57A773)
private val PushoverBlue = Color(0xFF249DF1)

/**
 * The channel-kind catalogue — the native mirror of the web `CHANNEL_TYPES` const, preserving the same order,
 * labels, field sets, and sample values. Webhook is intentionally index 4 so [channelMetaFor] can mirror the
 * web `?? CHANNEL_TYPES[4]` fallback.
 */
val CHANNEL_TYPES: List<ChannelTypeMeta> =
    listOf(
        ChannelTypeMeta(
            kind = ChannelKind.Discord,
            label = "Discord",
            brandColor = DiscordBlurple,
            glyph = ChannelGlyphs.Hash,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.WEBHOOK_URL, "Webhook URL", "https://discord.com/api/webhooks/..."),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Slack,
            label = "Slack",
            brandColor = SlackAubergine,
            glyph = ChannelGlyphs.MessageSquare,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.WEBHOOK_URL, "Webhook URL", "https://hooks.slack.com/services/..."),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Telegram,
            label = "Telegram",
            brandColor = TelegramBlue,
            glyph = ChannelGlyphs.Send,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.BOT_TOKEN, "Bot Token", "123456:ABC-...", secret = true),
                    ChannelFieldSpec(ChannelFieldKeys.CHAT_ID, "Chat ID", "-1001234567890"),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Email,
            label = "Email",
            brandColor = EmailRed,
            glyph = ChannelGlyphs.Mail,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.SMTP_HOST, "SMTP Host", "smtp.gmail.com"),
                    ChannelFieldSpec(ChannelFieldKeys.SMTP_PORT, "SMTP Port", "587"),
                    ChannelFieldSpec(ChannelFieldKeys.SMTP_USERNAME, "SMTP Username", "alerts@example.com"),
                    ChannelFieldSpec(ChannelFieldKeys.SMTP_PASSWORD, "SMTP Password", SECRET_MASK, secret = true),
                    ChannelFieldSpec(ChannelFieldKeys.FROM_ADDRESS, "From Address", "alerts@example.com"),
                    ChannelFieldSpec(ChannelFieldKeys.TO_ADDRESSES, "Recipients (comma-separated)", "you@example.com,ops@example.com"),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Webhook,
            label = "Webhook",
            brandColor = WebhookOrange,
            glyph = ChannelGlyphs.Webhook,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.URL, "URL", "https://example.com/webhook"),
                    ChannelFieldSpec(ChannelFieldKeys.METHOD, "HTTP Method", "POST"),
                    ChannelFieldSpec(ChannelFieldKeys.HEADERS, "Headers (JSON)", "{\"Authorization\": \"Bearer ...\"}"),
                    ChannelFieldSpec(ChannelFieldKeys.BODY_TEMPLATE, "Body Template", "{\"text\": \"{{message}}\"}"),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Ntfy,
            label = "ntfy",
            brandColor = NtfyGreen,
            glyph = ChannelGlyphs.Megaphone,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.SERVER_URL, "Server URL", "https://ntfy.sh"),
                    ChannelFieldSpec(ChannelFieldKeys.TOPIC, "Topic", "teslasync"),
                ),
        ),
        ChannelTypeMeta(
            kind = ChannelKind.Pushover,
            label = "Pushover",
            brandColor = PushoverBlue,
            glyph = ChannelGlyphs.Smartphone,
            fields =
                listOf(
                    ChannelFieldSpec(ChannelFieldKeys.USER_KEY, "User Key", "u1v2w3...", secret = true),
                    ChannelFieldSpec(ChannelFieldKeys.APP_TOKEN, "App Token", "a1b2c3...", secret = true),
                ),
        ),
    )

/** The metadata for [kind] — total since [CHANNEL_TYPES] covers every enum value. */
fun channelMetaFor(kind: ChannelKind): ChannelTypeMeta = CHANNEL_TYPES.first { it.kind == kind }

/** The metadata for a raw wire kind — the web `getChannelMeta`, falling back to Webhook (`CHANNEL_TYPES[4]`). */
fun channelMetaFor(rawKind: String): ChannelTypeMeta = channelMetaFor(ChannelKind.from(rawKind))

private val STRING_MAP = MapSerializer(String.serializer(), String.serializer())
private val CONFIG_JSON =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

/** The mask shown for a secret config value in the card preview (web `'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'`). */
const val SECRET_MASK: String = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"

/** Default SMTP submission port when the form value is blank/non-numeric (web `Number.isFinite(port) ? port : 587`). */
const val DEFAULT_SMTP_PORT: Int = 587

/** Default ntfy server when the form value is blank (web `config.server_url ?? 'https://ntfy.sh'`). */
const val DEFAULT_NTFY_SERVER: String = "https://ntfy.sh"

/**
 * Whether a config key holds a credential to mask in the preview — the web
 * `k.includes('token') || k.includes('key') || k.includes('password')`.
 */
fun isSecretKey(key: String): Boolean = key.contains("token") || key.contains("key") || key.contains("password")

/**
 * Flattens a loaded [channel] into the editable string-map the form renders — the native mirror of the web
 * `channelToFormConfig`. The received per-kind fields are emitted in the same order/keys the web uses, with the
 * SMTP port stringified, the recipients joined by `, `, and the webhook headers JSON-encoded.
 */
fun channelToFormConfig(channel: NotificationChannel): Map<String, String> =
    when (channel) {
        is NotificationChannel.Discord -> mapOf(ChannelFieldKeys.WEBHOOK_URL to channel.webhookUrl)
        is NotificationChannel.Slack -> mapOf(ChannelFieldKeys.WEBHOOK_URL to channel.webhookUrl)
        is NotificationChannel.Telegram ->
            mapOf(ChannelFieldKeys.BOT_TOKEN to channel.botToken, ChannelFieldKeys.CHAT_ID to channel.chatId)
        is NotificationChannel.Email ->
            mapOf(
                ChannelFieldKeys.SMTP_HOST to channel.smtpHost,
                ChannelFieldKeys.SMTP_PORT to channel.smtpPort.toString(),
                ChannelFieldKeys.SMTP_USERNAME to channel.smtpUsername,
                ChannelFieldKeys.SMTP_PASSWORD to channel.smtpPassword,
                ChannelFieldKeys.FROM_ADDRESS to channel.fromAddress,
                ChannelFieldKeys.TO_ADDRESSES to channel.toAddresses.joinToString(", "),
            )
        is NotificationChannel.Webhook ->
            mapOf(
                ChannelFieldKeys.URL to channel.url,
                ChannelFieldKeys.METHOD to channel.method,
                ChannelFieldKeys.HEADERS to encodeHeaders(channel.headers),
                ChannelFieldKeys.BODY_TEMPLATE to channel.bodyTemplate,
            )
        is NotificationChannel.Ntfy ->
            mapOf(ChannelFieldKeys.SERVER_URL to channel.serverUrl, ChannelFieldKeys.TOPIC to channel.topic)
        is NotificationChannel.Pushover ->
            mapOf(ChannelFieldKeys.USER_KEY to channel.userKey, ChannelFieldKeys.APP_TOKEN to channel.appToken)
    }

/**
 * The first three config rows shown on a card, with credentials masked — the web
 * `Object.entries(channelToFormConfig(ch)).slice(0, 3)` + the per-key secret check. Order is preserved.
 */
fun configPreviewEntries(channel: NotificationChannel): List<Pair<String, String>> =
    channelToFormConfig(channel)
        .entries
        .take(CONFIG_PREVIEW_LIMIT)
        .map { (key, value) -> key to if (isSecretKey(key)) SECRET_MASK else value }

private const val CONFIG_PREVIEW_LIMIT = 3

/**
 * Builds the create/update wire body from the form state — the native mirror of the web `buildChannelPayload`.
 * [id] is `null` on create (an id-free POST body) and the existing id on update (selects the PUT path). Per-kind
 * defaults match the web exactly: SMTP port 587 fallback, webhook method normalization, ntfy server default.
 */
fun buildChannelPayload(
    kind: ChannelKind,
    name: String,
    enabled: Boolean,
    config: Map<String, String>,
    id: Long? = null,
): NotificationChannelInput =
    when (kind) {
        ChannelKind.Discord ->
            NotificationChannelInput.Discord(
                id = id,
                name = name,
                enabled = enabled,
                webhookUrl = config[ChannelFieldKeys.WEBHOOK_URL].orEmpty(),
            )
        ChannelKind.Slack ->
            NotificationChannelInput.Slack(
                id = id,
                name = name,
                enabled = enabled,
                webhookUrl = config[ChannelFieldKeys.WEBHOOK_URL].orEmpty(),
            )
        ChannelKind.Telegram ->
            NotificationChannelInput.Telegram(
                id = id,
                name = name,
                enabled = enabled,
                botToken = config[ChannelFieldKeys.BOT_TOKEN].orEmpty(),
                chatId = config[ChannelFieldKeys.CHAT_ID].orEmpty(),
            )
        ChannelKind.Email -> buildEmailInput(id, name, enabled, config)
        ChannelKind.Webhook -> buildWebhookInput(id, name, enabled, config)
        ChannelKind.Ntfy ->
            NotificationChannelInput.Ntfy(
                id = id,
                name = name,
                enabled = enabled,
                serverUrl = config[ChannelFieldKeys.SERVER_URL]?.takeIf { it.isNotBlank() } ?: DEFAULT_NTFY_SERVER,
                topic = config[ChannelFieldKeys.TOPIC].orEmpty(),
            )
        ChannelKind.Pushover ->
            NotificationChannelInput.Pushover(
                id = id,
                name = name,
                enabled = enabled,
                userKey = config[ChannelFieldKeys.USER_KEY].orEmpty(),
                appToken = config[ChannelFieldKeys.APP_TOKEN].orEmpty(),
            )
    }

private fun buildEmailInput(
    id: Long?,
    name: String,
    enabled: Boolean,
    config: Map<String, String>,
): NotificationChannelInput.Email =
    NotificationChannelInput.Email(
        id = id,
        name = name,
        enabled = enabled,
        smtpHost = config[ChannelFieldKeys.SMTP_HOST].orEmpty(),
        smtpPort = config[ChannelFieldKeys.SMTP_PORT]?.trim()?.toIntOrNull() ?: DEFAULT_SMTP_PORT,
        smtpUsername = config[ChannelFieldKeys.SMTP_USERNAME].orEmpty(),
        smtpPassword = config[ChannelFieldKeys.SMTP_PASSWORD].orEmpty(),
        fromAddress = config[ChannelFieldKeys.FROM_ADDRESS].orEmpty(),
        toAddresses = parseRecipients(config[ChannelFieldKeys.TO_ADDRESSES].orEmpty()),
        useTls = true,
    )

private fun buildWebhookInput(
    id: Long?,
    name: String,
    enabled: Boolean,
    config: Map<String, String>,
): NotificationChannelInput.Webhook =
    NotificationChannelInput.Webhook(
        id = id,
        name = name,
        enabled = enabled,
        url = config[ChannelFieldKeys.URL].orEmpty(),
        method = safeWebhookMethod(config[ChannelFieldKeys.METHOD].orEmpty()),
        headers = parseHeaders(config[ChannelFieldKeys.HEADERS].orEmpty()),
        bodyTemplate = config[ChannelFieldKeys.BODY_TEMPLATE].orEmpty(),
    )

/** Splits a comma-separated recipients string, trimming and dropping blanks (web `split(',').map(trim).filter`). */
fun parseRecipients(raw: String): List<String> = raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }

/** Normalizes a webhook method to one the API accepts — GET/PUT pass through (uppercased), everything else POST. */
fun safeWebhookMethod(raw: String): String =
    when (raw.trim().uppercase(Locale.ROOT)) {
        "GET" -> "GET"
        "PUT" -> "PUT"
        else -> "POST"
    }

/** JSON-encodes the webhook headers map for the form (web `JSON.stringify(ch.headers ?? {})`). */
fun encodeHeaders(headers: Map<String, String>): String = CONFIG_JSON.encodeToString(STRING_MAP, headers)

/** Parses the webhook headers JSON, falling back to an empty map on blank/invalid input (web `try … catch {}`). */
fun parseHeaders(raw: String): Map<String, String> =
    if (raw.isBlank()) {
        emptyMap()
    } else {
        runCatching { CONFIG_JSON.decodeFromString(STRING_MAP, raw) }.getOrDefault(emptyMap())
    }

/** The four delivery-stat tiles the header row renders — the semantic kind of each web `MetricCard`. */
enum class StatKind { Sent, Failed, Pending, ActiveChannels }

/** One projected stat tile: its semantic [kind] and the already-formatted [value] string. */
data class StatTileData(
    val kind: StatKind,
    val value: String,
)

/**
 * Projects [stats] into the four header tiles — web `Total Sent` / `Failed` / `Pending` (grouped integers) and
 * `Active Channels` (`enabled/total`). The render layer resolves each [StatKind] to its label, glyph, and accent.
 */
fun statTiles(
    stats: NotificationStats,
    locale: Locale = Locale.getDefault(),
): List<StatTileData> =
    listOf(
        StatTileData(StatKind.Sent, formatCount(stats.sent, locale)),
        StatTileData(StatKind.Failed, formatCount(stats.failed, locale)),
        StatTileData(StatKind.Pending, formatCount(stats.pending, locale)),
        StatTileData(StatKind.ActiveChannels, "${stats.enabledChannels}/${stats.totalChannels}"),
    )

/** Locale-grouped integer formatting — the web `MetricCard` numeric value. */
fun formatCount(
    count: Long,
    locale: Locale = Locale.getDefault(),
): String = String.format(locale, "%,d", count)

/**
 * One transient toast a channel mutation raises — the typed, i18n-key-free analogue of the web `useToast`
 * calls. The render boundary maps each variant to a localized [io.teslasync.android.components.feedback.ToastItem]
 * (tone + message); the channel name / server error detail it carries is render data, never a logged field.
 */
sealed interface ChannelToast {
    /** Toggled on — web `toast.success('Channel enabled')`. */
    data object Enabled : ChannelToast

    /** Toggled off — web `toast.success('Channel disabled')`. */
    data object Disabled : ChannelToast

    /** Toggle failed — web `toast.error('Failed to toggle channel')`. */
    data object ToggleFailed : ChannelToast

    /** Deleted — web `toast.success('Channel deleted')`. */
    data object Deleted : ChannelToast

    /** Delete failed — web `toast.error('Failed to delete channel')`. */
    data object DeleteFailed : ChannelToast

    /**
     * Test succeeded. [channelName] is set for the per-card test (web `${ch.name}: Test sent!`) and `null` for
     * the modal's test (web `toast.success('Test sent!')`).
     */
    data class TestSucceeded(
        val channelName: String?,
    ) : ChannelToast

    /**
     * Test failed. [channelName] is set for the per-card test, `null` for the modal; [detail] is the optional
     * server error (web `data?.error`).
     */
    data class TestFailed(
        val channelName: String?,
        val detail: String?,
    ) : ChannelToast
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws lucide icons that Android has no bundled set for. Feature views may not expand the
// shared icon library from a surface prompt (allowed-files), so each is authored here as a 24×24 round-capped
// stroked vector in the shared monochrome style — recolored at render time by the `Icon` tint, exactly as the
// sibling surfaces author their local glyphs. Plus / Edit / Check / Close come from the shared `TeslaGlyphs`.

/** Channel-kind + action glyphs the surface renders, authored as monochrome stroked vectors. */
object ChannelGlyphs {
    /** Web `Bell` — stat tiles + empty state. */
    val Bell: ImageVector =
        strokedGlyph("Bell") {
            moveTo(6f, 16f)
            lineTo(6f, 11f)
            arcTo(6f, 6f, 0f, false, true, 18f, 11f)
            lineTo(18f, 16f)
            lineTo(20f, 18.5f)
            lineTo(4f, 18.5f)
            close()
            moveTo(10f, 18.5f)
            arcTo(2f, 2f, 0f, false, false, 14f, 18.5f)
        }

    /** Web `CheckCircle` — successful delivery stat. */
    val CheckCircle: ImageVector =
        strokedGlyph("CheckCircle") {
            glyphCircle()
            moveTo(8.5f, 12.5f)
            lineTo(11f, 15f)
            lineTo(15.5f, 9f)
        }

    /** Web `XCircle` — failed delivery stat. */
    val XCircle: ImageVector =
        strokedGlyph("XCircle") {
            glyphCircle()
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    /** Web `Trash2` — delete a channel. */
    val Trash: ImageVector =
        strokedGlyph("Trash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 7f)
            moveTo(9.5f, 7f)
            lineTo(9.5f, 4.5f)
            lineTo(14.5f, 4.5f)
            lineTo(14.5f, 7f)
            moveTo(10.5f, 10.5f)
            lineTo(10.5f, 16.5f)
            moveTo(13.5f, 10.5f)
            lineTo(13.5f, 16.5f)
        }

    /** Web `TestTube` — test a channel connection (drawn as a beaker). */
    val Beaker: ImageVector =
        strokedGlyph("Beaker") {
            moveTo(9f, 3.5f)
            lineTo(9f, 9f)
            lineTo(5f, 18f)
            arcTo(2.5f, 2.5f, 0f, false, false, 7.3f, 20.5f)
            lineTo(16.7f, 20.5f)
            arcTo(2.5f, 2.5f, 0f, false, false, 19f, 18f)
            lineTo(15f, 9f)
            lineTo(15f, 3.5f)
            moveTo(8f, 3.5f)
            lineTo(16f, 3.5f)
            moveTo(7f, 14f)
            lineTo(17f, 14f)
        }

    /** Web `Hash` — Discord. */
    val Hash: ImageVector =
        strokedGlyph("Hash") {
            moveTo(8f, 4f)
            lineTo(6f, 20f)
            moveTo(16f, 4f)
            lineTo(14f, 20f)
            moveTo(5f, 9f)
            lineTo(19f, 9f)
            moveTo(4f, 15f)
            lineTo(18f, 15f)
        }

    /** Web `MessageSquare` — Slack. */
    val MessageSquare: ImageVector =
        strokedGlyph("MessageSquare") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 16f)
            lineTo(9f, 16f)
            lineTo(5f, 20f)
            lineTo(5f, 16f)
            lineTo(4f, 16f)
            close()
        }

    /** Web `Send` — Telegram (paper plane). */
    val Send: ImageVector =
        strokedGlyph("Send") {
            moveTo(21f, 3f)
            lineTo(3f, 11f)
            lineTo(10f, 13.5f)
            lineTo(12.5f, 20.5f)
            close()
            moveTo(10f, 13.5f)
            lineTo(21f, 3f)
        }

    /** Web `Mail` — Email (envelope). */
    val Mail: ImageVector =
        strokedGlyph("Mail") {
            moveTo(3f, 6f)
            lineTo(21f, 6f)
            lineTo(21f, 18f)
            lineTo(3f, 18f)
            close()
            moveTo(3f, 6.5f)
            lineTo(12f, 13f)
            lineTo(21f, 6.5f)
        }

    /** Web `Webhook` — generic HTTP webhook (linked rings). */
    val Webhook: ImageVector =
        strokedGlyph("Webhook") {
            moveTo(9f, 15.5f)
            arcTo(4f, 4f, 0f, true, true, 13f, 8f)
            moveTo(15.5f, 9.5f)
            arcTo(4f, 4f, 0f, true, true, 12f, 16f)
            lineTo(7.5f, 16f)
            moveTo(11f, 8.5f)
            lineTo(8f, 14f)
        }

    /** Web `Megaphone` — ntfy. */
    val Megaphone: ImageVector =
        strokedGlyph("Megaphone") {
            moveTo(4f, 10f)
            lineTo(4f, 14f)
            lineTo(9f, 14f)
            lineTo(17f, 18f)
            lineTo(17f, 6f)
            lineTo(9f, 10f)
            close()
            moveTo(9f, 14f)
            lineTo(9f, 10f)
            moveTo(9f, 14f)
            lineTo(10.5f, 20f)
            lineTo(13.5f, 20f)
            lineTo(12.5f, 15.2f)
        }

    /** Web `Smartphone` — Pushover. */
    val Smartphone: ImageVector =
        strokedGlyph("Smartphone") {
            moveTo(7f, 3.5f)
            lineTo(17f, 3.5f)
            lineTo(17f, 20.5f)
            lineTo(7f, 20.5f)
            close()
            moveTo(10f, 17.5f)
            lineTo(14f, 17.5f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Full circle of radius 9 centered in the 24×24 viewport, approximated by two semicircular arcs. */
private fun PathBuilder.glyphCircle() {
    moveTo(3f, 12f)
    arcTo(9f, 9f, 0f, false, true, 21f, 12f)
    arcTo(9f, 9f, 0f, false, true, 3f, 12f)
    close()
}
