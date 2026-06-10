using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state the <see cref="NotificationChannelsViewModel"/> exposes for the
/// channel collection — the native union of the loading / loaded / empty / stale / offline / error branches the
/// P2 feature-view contract mandates. The web source
/// (web/src/features/notifications/components/NotificationChannelsView.tsx) reads its channels through the
/// TanStack query <c>useNotificationChannels()</c>; the native surface owns the same cache-then-network read, so
/// this state is driven by that read while the secondary stats read fills the four metric cards independently.
/// </summary>
public enum NotificationChannelsState
{
    /// <summary>The channels read is in flight with no cached value yet — render the card skeletons.</summary>
    Loading,

    /// <summary>A fresh, non-empty channel list arrived — render the channel cards.</summary>
    Loaded,

    /// <summary>The read resolved with no channels — render the friendly empty surface.</summary>
    Empty,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached list — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// A notification-channel transport — the native, strongly-typed mirror of the web
/// <c>NotificationChannelKind</c> union (web/src/api/types.ts). Declaration order matches the web
/// <c>CHANNEL_TYPES</c> array so the type picker and channel cards render in the same sequence.
/// </summary>
public enum NotificationChannelKind
{
    /// <summary>Discord webhook (web <c>'discord'</c>).</summary>
    Discord,

    /// <summary>Slack incoming webhook (web <c>'slack'</c>).</summary>
    Slack,

    /// <summary>Telegram bot (web <c>'telegram'</c>).</summary>
    Telegram,

    /// <summary>SMTP email (web <c>'email'</c>).</summary>
    Email,

    /// <summary>Generic HTTP webhook (web <c>'webhook'</c>).</summary>
    Webhook,

    /// <summary>ntfy publish/subscribe (web <c>'ntfy'</c>).</summary>
    Ntfy,

    /// <summary>Pushover push notification (web <c>'pushover'</c>).</summary>
    Pushover,
}

/// <summary>
/// One configurable field on a channel type — the native mirror of an entry in a web
/// <c>CHANNEL_TYPES[*].fields</c> array. <see cref="Secret"/> marks credential fields the form masks while
/// typing and the card preview redacts.
/// </summary>
/// <param name="Key">The wire field name (snake_case, e.g. <c>webhook_url</c>).</param>
/// <param name="LabelKey">The i18n key resolving the field label.</param>
/// <param name="LabelFallback">The English label fallback (web field <c>label</c>).</param>
/// <param name="Hint">The greyed-out sample text shown in the empty field (web field hint).</param>
/// <param name="Secret">True when the value is a credential (web field <c>type: 'password'</c>).</param>
public sealed record ChannelFieldSpec(
    string Key,
    string LabelKey,
    string LabelFallback,
    string Hint,
    bool Secret);

/// <summary>
/// The metadata for one channel type — the native mirror of a web <c>CHANNEL_TYPES</c> entry: the wire kind,
/// the localized label, the accent glyph and the ordered configurable <see cref="Fields"/>.
/// </summary>
/// <param name="Kind">The strongly-typed transport.</param>
/// <param name="Wire">The wire kind string (web <c>value</c>).</param>
/// <param name="LabelKey">The i18n key resolving the type label.</param>
/// <param name="LabelFallback">The English type label (web <c>label</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph rendered on the channel card (native analogue of the web icon).</param>
/// <param name="Fields">The ordered configurable fields for this type.</param>
public sealed record ChannelTypeSpec(
    NotificationChannelKind Kind,
    string Wire,
    string LabelKey,
    string LabelFallback,
    string Glyph,
    IReadOnlyList<ChannelFieldSpec> Fields);

/// <summary>
/// The catalog of the seven supported channel types — the native port of the web <c>CHANNEL_TYPES</c> constant
/// plus its <c>getChannelMeta</c> resolver (unknown kinds fall back to the webhook entry, index 4, exactly as
/// the web does). UI-free so it is asserted directly in the headless tests.
/// </summary>
public static class ChannelTypeCatalog
{
    private static readonly ChannelTypeSpec[] Types = BuildTypes();

    /// <summary>The channel types in web declaration order.</summary>
    public static IReadOnlyList<ChannelTypeSpec> Ordered => Types;

    /// <summary>Resolve the metadata for a strongly-typed kind.</summary>
    public static ChannelTypeSpec For(NotificationChannelKind kind)
    {
        foreach (var type in Types)
        {
            if (type.Kind == kind)
            {
                return type;
            }
        }

        return Types[4];
    }

    /// <summary>Resolve the metadata for a wire kind, falling back to webhook (web <c>CHANNEL_TYPES[4]</c>).</summary>
    public static ChannelTypeSpec For(string? wire)
    {
        if (!string.IsNullOrEmpty(wire))
        {
            foreach (var type in Types)
            {
                if (string.Equals(type.Wire, wire, StringComparison.OrdinalIgnoreCase))
                {
                    return type;
                }
            }
        }

        return Types[4];
    }

    /// <summary>Parse a wire kind to its enum, defaulting to <see cref="NotificationChannelKind.Webhook"/>.</summary>
    public static NotificationChannelKind ParseKind(string? wire) => For(wire).Kind;

    private static ChannelTypeSpec[] BuildTypes()
    {
        ChannelFieldSpec Field(string key, string labelKey, string label, string hint, bool secret = false) =>
            new(key, labelKey, label, hint, secret);

        return new[]
        {
            new ChannelTypeSpec(NotificationChannelKind.Discord, "discord",
                "notifications.channels.type.discord", "Discord", "\uE8BD",
                new[]
                {
                    Field("webhook_url", "notifications.channels.field.webhookUrl", "Webhook URL",
                        "https://discord.com/api/webhooks/..."),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Slack, "slack",
                "notifications.channels.type.slack", "Slack", "\uE90A",
                new[]
                {
                    Field("webhook_url", "notifications.channels.field.webhookUrl", "Webhook URL",
                        "https://hooks.slack.com/services/..."),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Telegram, "telegram",
                "notifications.channels.type.telegram", "Telegram", "\uE724",
                new[]
                {
                    Field("bot_token", "notifications.channels.field.botToken", "Bot Token", "123456:ABC-...", secret: true),
                    Field("chat_id", "notifications.channels.field.chatId", "Chat ID", "-1001234567890"),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Email, "email",
                "notifications.channels.type.email", "Email", "\uE715",
                new[]
                {
                    Field("smtp_host", "notifications.channels.field.smtpHost", "SMTP Host", "smtp.gmail.com"),
                    Field("smtp_port", "notifications.channels.field.smtpPort", "SMTP Port", "587"),
                    Field("smtp_username", "notifications.channels.field.smtpUsername", "SMTP Username", "alerts@example.com"),
                    Field("smtp_password", "notifications.channels.field.smtpPassword", "SMTP Password", "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", secret: true),
                    Field("from_address", "notifications.channels.field.fromAddress", "From Address", "alerts@example.com"),
                    Field("to_addresses", "notifications.channels.field.toAddresses", "Recipients (comma-separated)",
                        "you@example.com,ops@example.com"),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Webhook, "webhook",
                "notifications.channels.type.webhook", "Webhook", "\uE71B",
                new[]
                {
                    Field("url", "notifications.channels.field.url", "URL", "https://example.com/webhook"),
                    Field("method", "notifications.channels.field.method", "HTTP Method", "POST"),
                    Field("headers", "notifications.channels.field.headers", "Headers (JSON)", "{\"Authorization\": \"Bearer ...\"}"),
                    Field("body_template", "notifications.channels.field.bodyTemplate", "Body Template", "{\"text\": \"{{message}}\"}"),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Ntfy, "ntfy",
                "notifications.channels.type.ntfy", "ntfy", "\uEC42",
                new[]
                {
                    Field("server_url", "notifications.channels.field.serverUrl", "Server URL", "https://ntfy.sh"),
                    Field("topic", "notifications.channels.field.topic", "Topic", "teslasync"),
                }),
            new ChannelTypeSpec(NotificationChannelKind.Pushover, "pushover",
                "notifications.channels.type.pushover", "Pushover", "\uE8EA",
                new[]
                {
                    Field("user_key", "notifications.channels.field.userKey", "User Key", "u1v2w3...", secret: true),
                    Field("app_token", "notifications.channels.field.appToken", "App Token", "a1b2c3...", secret: true),
                }),
        };
    }
}

/// <summary>
/// One notification channel — the native, cache-friendly read-model parsed from a <c>GET /notifications</c>
/// row (the web <c>NotificationChannel</c>). The per-kind credential/routing fields are flattened into
/// <see cref="Config"/> in <see cref="ChannelTypeSpec.Fields"/> order, exactly the web <c>channelToFormConfig</c>
/// projection, so the form re-populates and the card preview renders without re-reading the raw payload.
/// </summary>
/// <param name="Id">The server channel id.</param>
/// <param name="Kind">The wire kind (e.g. <c>discord</c>).</param>
/// <param name="Name">The friendly channel name.</param>
/// <param name="Enabled">Whether deliveries are enabled.</param>
/// <param name="Config">The per-kind field values keyed by wire field name, in field order.</param>
public sealed record NotificationChannel(
    long Id,
    string Kind,
    string Name,
    bool Enabled,
    IReadOnlyDictionary<string, string> Config)
{
    /// <summary>The strongly-typed transport for <see cref="Kind"/> (webhook when unknown).</summary>
    [JsonIgnore]
    public NotificationChannelKind ResolvedKind => ChannelTypeCatalog.ParseKind(Kind);

    /// <summary>Parse one channel object, flattening its per-kind fields into <see cref="Config"/>.</summary>
    public static NotificationChannel FromJson(JsonElement element)
    {
        long id = JsonScalars.ReadLong(element, "id");
        string kind = JsonScalars.ReadString(element, "kind") ?? "webhook";
        string name = JsonScalars.ReadString(element, "name") ?? string.Empty;
        bool enabled = JsonScalars.ReadBool(element, "enabled", defaultValue: true);

        var spec = ChannelTypeCatalog.For(kind);
        var config = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var field in spec.Fields)
        {
            if (element.ValueKind == JsonValueKind.Object &&
                element.TryGetProperty(field.Key, out var value) &&
                JsonScalars.ToConfigString(value) is { } text)
            {
                config[field.Key] = text;
            }
        }

        return new NotificationChannel(id, kind, name, enabled, config);
    }
}

/// <summary>
/// A parsed snapshot of the channel collection — the native read-model behind the web
/// <c>useNotificationChannels()</c> array. <see cref="HasData"/> distinguishes a populated list from the
/// resolved-but-empty response that drives the empty surface.
/// </summary>
/// <param name="Channels">The channels in server order.</param>
public sealed record NotificationChannelList(IReadOnlyList<NotificationChannel> Channels)
{
    /// <summary>An empty channel list.</summary>
    public static NotificationChannelList Empty { get; } = new(Array.Empty<NotificationChannel>());

    /// <summary>True when at least one channel is configured.</summary>
    public bool HasData => Channels.Count > 0;

    /// <summary>Parse a <c>GET /notifications</c> array; a non-array body yields the empty list.</summary>
    public static NotificationChannelList FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var channels = new List<NotificationChannel>(element.GetArrayLength());
        foreach (var row in element.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                channels.Add(NotificationChannel.FromJson(row));
            }
        }

        return channels.Count == 0 ? Empty : new NotificationChannelList(channels);
    }
}

/// <summary>
/// The aggregate delivery counters — the native mirror of the web <c>NotificationStats</c>
/// (<c>GET /notifications/stats</c>). Backs the four metric cards above the channel grid.
/// </summary>
/// <param name="TotalSent">All-time sent count (web <c>total_sent</c>).</param>
/// <param name="Sent">Sent count surfaced on the "Total Sent" card (web <c>sent</c>).</param>
/// <param name="Failed">Failed-delivery count (web <c>failed</c>).</param>
/// <param name="Pending">Queued/pending count (web <c>pending</c>).</param>
/// <param name="TotalChannels">Configured-channel count (web <c>total_channels</c>).</param>
/// <param name="EnabledChannels">Enabled-channel count (web <c>enabled_channels</c>).</param>
public sealed record NotificationChannelStats(
    long TotalSent,
    long Sent,
    long Failed,
    long Pending,
    long TotalChannels,
    long EnabledChannels)
{
    /// <summary>A zeroed stats snapshot.</summary>
    public static NotificationChannelStats Empty { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>Parse a <c>GET /notifications/stats</c> object; a non-object body yields zeros.</summary>
    public static NotificationChannelStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new NotificationChannelStats(
            JsonScalars.ReadLong(element, "total_sent"),
            JsonScalars.ReadLong(element, "sent"),
            JsonScalars.ReadLong(element, "failed"),
            JsonScalars.ReadLong(element, "pending"),
            JsonScalars.ReadLong(element, "total_channels"),
            JsonScalars.ReadLong(element, "enabled_channels"));
    }
}

/// <summary>The outcome of a channel test (web <c>useTestChannel</c> response <c>{ success, error? }</c>).</summary>
/// <param name="Success">True when the provider accepted the test delivery.</param>
/// <param name="Message">The localized success / failure message shown in the form.</param>
public sealed record ChannelTestOutcome(bool Success, string Message);

/// <summary>A localized transient message raised for the in-app toast surface (web <c>useToast</c>).</summary>
/// <param name="Message">The localized toast body.</param>
/// <param name="IsError">True for an error toast (rendered with the danger severity).</param>
public sealed record NotificationChannelsToast(string Message, bool IsError);

/// <summary>
/// The pure, UI-free form logic behind the add/edit modal — the native port of the web
/// <c>buildChannelPayload</c> / <c>channelToFormConfig</c> helpers and the "name required" guard. Kept here so
/// the payload shape and validation are asserted headlessly without a WinUI dialog.
/// </summary>
public static class NotificationChannelForm
{
    /// <summary>Validate the channel name (web <c>!name.trim()</c>); returns the localized error or null.</summary>
    public static string? ValidateName(string? name, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrWhiteSpace(name)
            ? localizer.GetString("notifications.channels.nameRequired", "Name is required")
            : null;
    }

    /// <summary>The form field values for an existing channel (web <c>channelToFormConfig</c>).</summary>
    public static IReadOnlyDictionary<string, string> ToFormConfig(NotificationChannel channel)
    {
        ArgumentNullException.ThrowIfNull(channel);
        return channel.Config;
    }

    /// <summary>
    /// Build the request body for a create (<c>POST</c>) or update (<c>PUT</c>) — the native port of
    /// <c>buildChannelPayload</c>, including the same per-kind defaults (e.g. <c>use_tls</c>, <c>priority</c>,
    /// the upper-cased webhook method and the comma-split email recipients).
    /// </summary>
    public static JsonObject BuildPayload(
        NotificationChannelKind kind,
        string name,
        bool enabled,
        IReadOnlyDictionary<string, string> config,
        long? id)
    {
        ArgumentNullException.ThrowIfNull(config);

        var spec = ChannelTypeCatalog.For(kind);
        var body = new JsonObject
        {
            ["kind"] = spec.Wire,
            ["name"] = name,
            ["enabled"] = enabled,
        };

        if (id is { } channelId)
        {
            body["id"] = channelId;
        }

        string Value(string key) => config.TryGetValue(key, out var v) ? v : string.Empty;

        switch (kind)
        {
            case NotificationChannelKind.Discord:
                body["webhook_url"] = Value("webhook_url");
                body["username"] = null;
                body["avatar_url"] = null;
                break;

            case NotificationChannelKind.Slack:
                body["webhook_url"] = Value("webhook_url");
                body["channel"] = null;
                body["username"] = null;
                break;

            case NotificationChannelKind.Telegram:
                body["bot_token"] = Value("bot_token");
                body["chat_id"] = Value("chat_id");
                break;

            case NotificationChannelKind.Email:
                body["smtp_host"] = Value("smtp_host");
                body["smtp_port"] = ParsePort(Value("smtp_port"));
                body["smtp_username"] = Value("smtp_username");
                body["smtp_password"] = Value("smtp_password");
                body["from_address"] = Value("from_address");
                body["to_addresses"] = SplitRecipients(Value("to_addresses"));
                body["use_tls"] = true;
                break;

            case NotificationChannelKind.Webhook:
                body["url"] = Value("url");
                body["method"] = NormalizeMethod(Value("method"));
                body["headers"] = ParseHeaders(Value("headers"));
                body["body_template"] = Value("body_template");
                break;

            case NotificationChannelKind.Ntfy:
                body["server_url"] = string.IsNullOrWhiteSpace(Value("server_url")) ? "https://ntfy.sh" : Value("server_url");
                body["topic"] = Value("topic");
                body["priority"] = 3;
                body["username"] = null;
                body["password"] = null;
                break;

            case NotificationChannelKind.Pushover:
                body["user_key"] = Value("user_key");
                body["app_token"] = Value("app_token");
                body["device"] = null;
                body["priority"] = 0;
                break;

            default:
                break;
        }

        return body;
    }

    private static int ParsePort(string value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int port) ? port : 587;

    private static string NormalizeMethod(string value)
    {
        string method = (string.IsNullOrWhiteSpace(value) ? "POST" : value).ToUpperInvariant();
        return method is "GET" or "PUT" ? method : "POST";
    }

    private static JsonArray SplitRecipients(string value)
    {
        var array = new JsonArray();
        foreach (var part in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            array.Add(part);
        }

        return array;
    }

    private static JsonObject ParseHeaders(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new JsonObject();
        }

        try
        {
            if (JsonNode.Parse(value) is JsonObject parsed)
            {
                return (JsonObject)parsed.DeepClone();
            }
        }
        catch (JsonException)
        {
            // Web parity: an unparseable headers blob falls back to an empty object.
        }

        return new JsonObject();
    }
}

/// <summary>Small JSON scalar readers tolerant of numeric strings — shared by the channel/stats adapters.</summary>
internal static class JsonScalars
{
    public static long ReadLong(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
        {
            return 0;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.Number when value.TryGetDouble(out double d) => (long)Math.Round(d),
            JsonValueKind.String when long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => 0,
        };
    }

    public static string? ReadString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    public static bool ReadBool(JsonElement element, string name, bool defaultValue)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
        {
            return defaultValue;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => defaultValue,
        };
    }

    public static string? ToConfigString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Array => string.Join(", ", EnumerateAsStrings(value)),
        JsonValueKind.Object => value.GetRawText(),
        _ => null,
    };

    private static IEnumerable<string> EnumerateAsStrings(JsonElement array)
    {
        foreach (var item in array.EnumerateArray())
        {
            yield return item.ValueKind == JsonValueKind.String ? item.GetString() ?? string.Empty : item.GetRawText();
        }
    }
}

/// <summary>One metric card above the grid (web <c>MetricCard</c>): label, value, accent token and Narrator name.</summary>
/// <param name="Label">The localized card label.</param>
/// <param name="Value">The pre-formatted card value.</param>
/// <param name="AccentBrushKey">The design-token brush key driving the card's accent rail.</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record ChannelStatCard(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>One redacted config preview line on a channel card (web sliced/masked <c>configPreview</c>).</summary>
/// <param name="Label">The field key shown before the value.</param>
/// <param name="Value">The (possibly masked) field value.</param>
public sealed record ChannelConfigLine(string Label, string Value);

/// <summary>
/// The render-ready projection of one channel card — every label localized, the status resolved and the
/// credential preview redacted, plus the Narrator name for each interactive affordance.
/// </summary>
public sealed record ChannelCardDisplay(
    long Id,
    string Name,
    string KindLabel,
    string Glyph,
    bool Enabled,
    string StatusLabel,
    StatusKind StatusKind,
    IReadOnlyList<ChannelConfigLine> ConfigPreview,
    string TestLabel,
    string EditLabel,
    string ToggleAutomationName,
    string TestAutomationName,
    string EditAutomationName,
    string DeleteAutomationName);

/// <summary>
/// The fully projected, render-ready view of the NotificationChannels surface — the four metric cards (or a
/// skeleton flag while stats load), every channel card, the add-button label, the empty-surface copy and the
/// surface-level Narrator name. Mirrors every branch the web <c>NotificationChannelsView</c> renders.
/// </summary>
public sealed record NotificationChannelsDisplay(
    bool HasStats,
    IReadOnlyList<ChannelStatCard> StatCards,
    IReadOnlyList<ChannelCardDisplay> Channels,
    string AddLabel,
    string EmptyTitle,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Projects the parsed channel list + stats + freshness state into a <see cref="NotificationChannelsDisplay"/>.
/// Pure and UI-free (the native analogue of the web component's render body) so the card labels, masking, status
/// chips and Narrator names are asserted headlessly. Mirrors
/// web/src/features/notifications/components/NotificationChannelsView.tsx.
/// </summary>
public static class NotificationChannelsProjection
{
    private const string Mask = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

    /// <summary>Build the render-ready display from the current list, stats and state.</summary>
    public static NotificationChannelsDisplay Project(
        NotificationChannelList? channels,
        NotificationChannelStats? stats,
        NotificationChannelsState state,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var list = channels ?? NotificationChannelList.Empty;
        var cards = new List<ChannelCardDisplay>(list.Channels.Count);
        foreach (var channel in list.Channels)
        {
            cards.Add(ProjectCard(channel, localizer));
        }

        string add = localizer.GetString("notifications.channels.add", "Add Channel");
        string emptyTitle = localizer.GetString("notifications.channels.empty.title", "No channels configured");
        string emptyMessage = localizer.GetString(
            "notifications.channels.empty.message",
            "Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more.");

        return new NotificationChannelsDisplay(
            HasStats: stats is not null,
            StatCards: ProjectStats(stats, localizer),
            Channels: cards,
            AddLabel: add,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            AutomationName: AutomationName(list, state, localizer));
    }

    /// <summary>Project the four metric cards from a stats snapshot (empty when stats has not yet loaded).</summary>
    public static IReadOnlyList<ChannelStatCard> ProjectStats(NotificationChannelStats? stats, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (stats is null)
        {
            return Array.Empty<ChannelStatCard>();
        }

        string Number(long value) => value.ToString("N0", CultureInfo.InvariantCulture);

        string activeValue = string.Format(
            CultureInfo.InvariantCulture, "{0}/{1}", Number(stats.EnabledChannels), Number(stats.TotalChannels));

        return new[]
        {
            Card(localizer.GetString("notifications.stats.sent", "Total Sent"), Number(stats.Sent), "TsColorSuccessBrush", localizer),
            Card(localizer.GetString("notifications.stats.failed", "Failed"), Number(stats.Failed), "TsColorDangerBrush", localizer),
            Card(localizer.GetString("notifications.stats.pending", "Pending"), Number(stats.Pending), "TsColorWarningBrush", localizer),
            Card(localizer.GetString("notifications.stats.activeChannels", "Active Channels"), activeValue, "TsColorInfoBrush", localizer),
        };
    }

    private static ChannelStatCard Card(string label, string value, string accent, ILocalizer localizer)
    {
        string aria = localizer.GetString("notifications.stats.cardAria", "{{label}}: {{value}}")
            .Replace("{{label}}", label, StringComparison.Ordinal)
            .Replace("{{value}}", value, StringComparison.Ordinal);
        return new ChannelStatCard(label, value, accent, aria);
    }

    private static ChannelCardDisplay ProjectCard(NotificationChannel channel, ILocalizer localizer)
    {
        var spec = ChannelTypeCatalog.For(channel.Kind);
        string kindLabel = localizer.GetString(spec.LabelKey, spec.LabelFallback);

        bool enabled = channel.Enabled;
        string statusLabel = enabled
            ? localizer.GetString("notifications.channels.active", "Active")
            : localizer.GetString("notifications.channels.disabled", "Disabled");

        var preview = new List<ChannelConfigLine>(3);
        foreach (var entry in channel.Config)
        {
            if (preview.Count == 3)
            {
                break;
            }

            preview.Add(new ChannelConfigLine(entry.Key, IsSecretKey(entry.Key) ? Mask : entry.Value));
        }

        string testLabel = localizer.GetString("notifications.channels.testShort", "Test");
        string editLabel = localizer.GetString("common.edit", "Edit");
        string toggleAria = localizer.GetString("notifications.channels.toggleAria", "Toggle {{name}}")
            .Replace("{{name}}", channel.Name, StringComparison.Ordinal);
        string testAria = localizer.GetString("notifications.channels.testAria", "Test {{name}}")
            .Replace("{{name}}", channel.Name, StringComparison.Ordinal);
        string editAria = localizer.GetString("notifications.channels.editAria", "Edit {{name}}")
            .Replace("{{name}}", channel.Name, StringComparison.Ordinal);
        string deleteAria = localizer.GetString("notifications.channels.deleteAria", "Delete {{name}}")
            .Replace("{{name}}", channel.Name, StringComparison.Ordinal);

        return new ChannelCardDisplay(
            Id: channel.Id,
            Name: channel.Name,
            KindLabel: kindLabel,
            Glyph: spec.Glyph,
            Enabled: enabled,
            StatusLabel: statusLabel,
            StatusKind: enabled ? StatusKind.Success : StatusKind.Neutral,
            ConfigPreview: preview,
            TestLabel: testLabel,
            EditLabel: editLabel,
            ToggleAutomationName: toggleAria,
            TestAutomationName: testAria,
            EditAutomationName: editAria,
            DeleteAutomationName: deleteAria);
    }

    private static bool IsSecretKey(string key) =>
        key.Contains("token", StringComparison.OrdinalIgnoreCase) ||
        key.Contains("key", StringComparison.OrdinalIgnoreCase) ||
        key.Contains("password", StringComparison.OrdinalIgnoreCase);

    private static string AutomationName(NotificationChannelList list, NotificationChannelsState state, ILocalizer localizer)
    {
        if (state == NotificationChannelsState.Empty || !list.HasData)
        {
            return localizer.GetString("notifications.channels.empty.title", "No channels configured");
        }

        return localizer.GetString("notifications.channels.summaryAria", "{{count}} notification channels")
            .Replace("{{count}}", list.Channels.Count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }
}

/// <summary>
/// Maps the raw cache-then-network <see cref="JsonElement"/> emissions to the typed channel / stats read-models
/// while preserving the freshness status — the native analogue of the web query <c>select</c>. Asserted directly
/// (cached → projection) in the headless tests.
/// </summary>
public static class NotificationChannelsResultMapper
{
    /// <summary>Map a raw channels emission to a typed <see cref="NotificationChannelList"/> result.</summary>
    public static RepositoryResult<NotificationChannelList> MapChannels(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        NotificationChannelList Parse() => raw.HasValue ? NotificationChannelList.FromJson(raw.Value) : NotificationChannelList.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<NotificationChannelList>.Loading(),
            LoadStatus.Cached => RepositoryResult<NotificationChannelList>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<NotificationChannelList>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<NotificationChannelList>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<NotificationChannelList>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<NotificationChannelList>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<NotificationChannelList>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    /// <summary>Map a raw stats emission to a typed <see cref="NotificationChannelStats"/> result.</summary>
    public static RepositoryResult<NotificationChannelStats> MapStats(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        NotificationChannelStats Parse() => raw.HasValue ? NotificationChannelStats.FromJson(raw.Value) : NotificationChannelStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<NotificationChannelStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<NotificationChannelStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<NotificationChannelStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<NotificationChannelStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<NotificationChannelStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<NotificationChannelStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<NotificationChannelStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the NotificationChannelsView surface — the native anchor for the web component at
/// web/src/features/notifications/components/NotificationChannelsView.tsx. Centralises the diagnostics
/// <see cref="Slug"/> emitted with the <c>view.opened</c> event (P1/S11) and the generated OpenAPI operation ids
/// the channels source reads and mutates.
/// </summary>
public static class NotificationChannelsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NotificationChannelsView";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/notifications/components/NotificationChannelsView.tsx";

    /// <summary>Operation id for <c>GET /notifications</c> — the channel list (web <c>useNotificationChannels</c>).</summary>
    public const string ChannelsOperation = "get_api_v1_notifications";

    /// <summary>Operation id for <c>GET /notifications/stats</c> (web <c>useNotificationStats</c>).</summary>
    public const string StatsOperation = "get_api_v1_notifications_stats";

    /// <summary>Operation id for <c>POST /notifications</c> — create a channel (web <c>useSaveChannel</c>).</summary>
    public const string CreateOperation = "post_api_v1_notifications";

    /// <summary>Operation id for <c>PUT /notifications/{channelID}</c> — update a channel (web <c>useSaveChannel</c>).</summary>
    public const string UpdateOperation = "put_api_v1_notifications_channelID";

    /// <summary>Operation id for <c>DELETE /notifications/{channelID}</c> (web <c>useDeleteChannel</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_notifications_channelID";

    /// <summary>Operation id for <c>POST /notifications/{channelID}/toggle</c> (web <c>useToggleChannel</c>).</summary>
    public const string ToggleOperation = "post_api_v1_notifications_channelID_toggle";

    /// <summary>Operation id for <c>POST /notifications/{channelID}/test</c> (web <c>useTestChannel</c>).</summary>
    public const string TestOperation = "post_api_v1_notifications_channelID_test";

    /// <summary>The path-parameter name shared by the per-channel mutation endpoints.</summary>
    public const string ChannelIdParam = "channelID";
}

/// <summary>
/// PII-safe diagnostics for the NotificationChannelsView surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a channel name, credential or count — so a
/// diagnostics line can never leak user configuration. Thread-safe.
/// </summary>
public sealed class NotificationChannelsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional line sink (the host's diagnostics pipeline).</summary>
    public NotificationChannelsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of <c>view.opened</c> events recorded.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationChannelsView</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NotificationChannelsRegistration.Slug}");
    }
}
