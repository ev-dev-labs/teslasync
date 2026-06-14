using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive conversation surface state of the <c>ChatbotPage</c> — the native mirror of the data
/// states the web page renders for its conversation panel (web/src/features/system/pages/ChatbotPage.tsx). The
/// manifest declares three states (loading / empty / success); the honest native union adds a defensive
/// <see cref="Error"/> branch so a failed history/sessions read surfaces a retriable error surface rather than a
/// blank region (ADR-011). The conversation panel (GlassPanel1) and the input composer are always visible.
/// </summary>
public enum ChatbotState
{
    /// <summary>The sessions / history read is in flight and nothing has resolved yet — skeleton bubbles.</summary>
    Loading,

    /// <summary>Resolved with a non-empty conversation (web <c>messages.length &gt; 0</c>) — the message list.</summary>
    Success,

    /// <summary>Resolved with an empty conversation (web <c>messages.length === 0</c>) — the Helix welcome + suggested prompts.</summary>
    Empty,

    /// <summary>The sessions / history read failed with no usable snapshot — a retriable error surface.</summary>
    Error,
}

/// <summary>
/// One chat session in the History sidebar — the native mirror of the web <c>ChatSessionInfo</c>
/// (web/src/api/types.ts), the shape <c>GET /chatbot/sessions</c> returns. <see cref="Title"/> is null until the
/// user renames the session, in which case the UI falls back to <see cref="FirstMessage"/> (the web sidebar's
/// title resolution). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable session id (web <c>id</c>).</param>
/// <param name="Title">The user-assigned title, or null (web <c>title</c>).</param>
/// <param name="FirstMessage">The first user message, used as the title fallback (web <c>first_message</c>).</param>
/// <param name="MessageCount">Number of messages in the session (web <c>message_count</c>).</param>
/// <param name="LastMessageAt">Timestamp of the last message, or null (web <c>last_message_at</c>).</param>
public sealed record ChatSession(
    string Id,
    string? Title,
    string? FirstMessage,
    int MessageCount,
    DateTimeOffset? LastMessageAt)
{
    /// <summary>
    /// Parse the <c>GET /chatbot/sessions</c> response (web <c>useChatSessions</c>) into the session list. The Go
    /// API returns a bare JSON array; an object envelope (<c>{ sessions: [...] }</c> / <c>{ data: [...] }</c>) is
    /// tolerated defensively. A null / non-array payload yields an empty list (the empty data state).
    /// </summary>
    public static IReadOnlyList<ChatSession> ParseList(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("sessions", out var sessions) && sessions.ValueKind == JsonValueKind.Array)
            {
                array = sessions;
            }
            else if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                array = data;
            }
            else
            {
                return Array.Empty<ChatSession>();
            }
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChatSession>();
        }

        var items = new List<ChatSession>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = ChatbotJson.ReadString(element, "id");
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            items.Add(new ChatSession(
                id!,
                ChatbotJson.ReadNullableString(element, "title"),
                ChatbotJson.ReadNullableString(element, "first_message", "firstMessage"),
                ChatbotJson.ReadInt(element, "message_count", "messageCount"),
                ChatbotJson.ReadDate(element, "last_message_at", "lastMessageAt")));
        }

        return items;
    }
}

/// <summary>
/// The render-ready projection of one History-sidebar session row — the localized title (web's
/// <c>title ?? first_message ?? untitled</c> resolution), the pluralized message-count label and the active flag.
/// Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Id">The session id (the rename / delete / select target).</param>
/// <param name="Title">The resolved, display-ready session title.</param>
/// <param name="MessageCountLabel">The localized "{n} msg(s)" label.</param>
/// <param name="IsActive">Whether this is the currently-loaded session.</param>
/// <param name="AutomationName">The Narrator name for the row.</param>
public sealed record ChatSessionItem(
    string Id,
    string Title,
    string MessageCountLabel,
    bool IsActive,
    string AutomationName);

/// <summary>
/// The immutable input the <see cref="ChatbotProjection"/> reads — the loaded sessions, the active conversation's
/// messages and the active session id. Mirrors the web page's local state (<c>sessions</c>, <c>messages</c>,
/// <c>sessionId</c>). Pure data so the whole projection is unit-tested headless.
/// </summary>
/// <param name="Sessions">The History-sidebar sessions (web <c>useChatSessions</c>).</param>
/// <param name="Messages">The active conversation's messages (web <c>useChatHistory</c> + local optimistic state).</param>
/// <param name="ActiveSessionId">The id of the loaded session, or the empty string for a brand-new chat.</param>
public sealed record ChatbotSnapshot(
    IReadOnlyList<ChatSession> Sessions,
    IReadOnlyList<ChatMessageData> Messages,
    string ActiveSessionId)
{
    /// <summary>An empty snapshot — no sessions, no messages, no active session (the new-chat baseline).</summary>
    public static ChatbotSnapshot Empty { get; } =
        new(Array.Empty<ChatSession>(), Array.Empty<ChatMessageData>(), string.Empty);

    /// <summary>True when the active conversation has at least one message.</summary>
    public bool HasMessages => Messages.Count > 0;
}

/// <summary>
/// The render-ready projection the <c>ChatbotPage</c> view binds to. Every visible literal is resolved here through
/// the <see cref="ILocalizer"/> (web key names preserved verbatim) so the view stays a thin renderer with zero
/// hardcoded text. The chrome strings back the header (<see cref="Title"/> / <see cref="Subtitle"/> /
/// <see cref="HistoryLabel"/>), the conversation panel (GlassPanel1: <see cref="ConversationLabel"/> + the
/// per-message <see cref="Messages"/>, or the <see cref="HowCanIHelp"/> / <see cref="AskAbout"/> welcome), the
/// thinking indicator (GlassPanel2: <see cref="Thinking"/>) and the composer (<see cref="InputLabel"/> /
/// <see cref="InputHint"/> / <see cref="SendLabel"/> / <see cref="StopLabel"/> / <see cref="StopHint"/> /
/// <see cref="StopStreamingLabel"/>). <see cref="State"/> drives the conversation region.
/// </summary>
public sealed record ChatbotDisplay(
    ChatbotState State,
    string Title,
    string DocumentTitle,
    string Subtitle,
    string HistoryLabel,
    string ConversationLabel,
    string InputLabel,
    string InputHint,
    string SendLabel,
    string StopLabel,
    string StopHint,
    string StopStreamingLabel,
    string HowCanIHelp,
    string AskAbout,
    string Thinking,
    string EmptySessionsLabel,
    string NewChatLabel,
    IReadOnlyList<ChatSessionItem> Sessions,
    IReadOnlyList<ChatMessageItemModel> Messages)
{
    /// <summary>True when the active conversation has no messages (the welcome / suggested-prompts surface).</summary>
    public bool IsConversationEmpty => Messages.Count == 0;

    /// <summary>True when the History sidebar has at least one session.</summary>
    public bool HasSessions => Sessions.Count > 0;
}

/// <summary>
/// Pure projection from a <see cref="ChatbotSnapshot"/> (plus the page's lifecycle state) to the render-ready
/// <see cref="ChatbotDisplay"/> — the native port of the web page's render. Resolves every chrome literal through
/// the localizer with the web English defaults, projects each History session row (title fallback + pluralized
/// count + Narrator name) and each conversation message into a <see cref="ChatMessageItemModel"/> with the web
/// grouping / affordance flags. WinUI-free so it is unit-tested without a XAML runtime.
/// </summary>
public static class ChatbotProjection
{
    /// <summary>Resolve every localized chrome literal and project the snapshot's sessions + messages.</summary>
    /// <param name="snapshot">The loaded sessions + active conversation.</param>
    /// <param name="state">The page lifecycle state (loading / success / empty / error).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="actionsDisabled">Suppress the per-message action row while a reply is streaming (web prop).</param>
    public static ChatbotDisplay Project(
        ChatbotSnapshot snapshot,
        ChatbotState state,
        ILocalizer localizer,
        bool actionsDisabled = false)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = localizer.GetString(ChatbotRegistration.TitleKey, ChatbotRegistration.TitleDefault);

        return new ChatbotDisplay(
            State: state,
            Title: title,
            DocumentTitle: title,
            Subtitle: localizer.GetString(ChatbotRegistration.SubtitleKey, ChatbotRegistration.SubtitleDefault),
            HistoryLabel: localizer.GetString(ChatbotRegistration.HistoryKey, ChatbotRegistration.HistoryDefault),
            ConversationLabel: localizer.GetString(ChatbotRegistration.ConversationKey, ChatbotRegistration.ConversationDefault),
            InputLabel: localizer.GetString(ChatbotRegistration.InputLabelKey, ChatbotRegistration.InputLabelDefault),
            InputHint: localizer.GetString(ChatbotRegistration.InputHintKey, ChatbotRegistration.InputHintDefault),
            SendLabel: localizer.GetString(ChatbotRegistration.SendKey, ChatbotRegistration.SendDefault),
            StopLabel: localizer.GetString(ChatbotRegistration.StopKey, ChatbotRegistration.StopDefault),
            StopHint: localizer.GetString(ChatbotRegistration.StopHintKey, ChatbotRegistration.StopHintDefault),
            StopStreamingLabel: localizer.GetString(ChatbotRegistration.StopStreamingKey, ChatbotRegistration.StopStreamingDefault),
            HowCanIHelp: localizer.GetString(ChatbotRegistration.HowCanIHelpKey, ChatbotRegistration.HowCanIHelpDefault),
            AskAbout: localizer.GetString(ChatbotRegistration.AskAboutKey, ChatbotRegistration.AskAboutDefault),
            Thinking: localizer.GetString(ChatbotRegistration.ThinkingKey, ChatbotRegistration.ThinkingDefault),
            EmptySessionsLabel: localizer.GetString(ChatbotRegistration.NoSessionsKey, ChatbotRegistration.NoSessionsDefault),
            NewChatLabel: localizer.GetString(ChatbotRegistration.NewChatKey, ChatbotRegistration.NewChatDefault),
            Sessions: ProjectSessions(snapshot.Sessions, snapshot.ActiveSessionId, localizer),
            Messages: ProjectMessages(snapshot.Messages, actionsDisabled));
    }

    /// <summary>Project the History sessions into localized, render-ready rows (title fallback + count + Narrator name).</summary>
    public static IReadOnlyList<ChatSessionItem> ProjectSessions(
        IReadOnlyList<ChatSession>? sessions,
        string activeSessionId,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (sessions is null || sessions.Count == 0)
        {
            return Array.Empty<ChatSessionItem>();
        }

        var renameLabel = localizer.GetString(ChatbotRegistration.RenameSessionKey, ChatbotRegistration.RenameSessionDefault);
        var items = new List<ChatSessionItem>(sessions.Count);
        foreach (var session in sessions)
        {
            var title = ResolveSessionTitle(session, localizer);
            var countLabel = MessageCountLabel(session.MessageCount, localizer);
            bool isActive = string.Equals(session.Id, activeSessionId, StringComparison.Ordinal);
            items.Add(new ChatSessionItem(
                session.Id,
                title,
                countLabel,
                isActive,
                $"{title}. {countLabel}. {renameLabel}"));
        }

        return items;
    }

    /// <summary>Resolve a session's display title — web <c>title ?? first_message ?? untitled</c>.</summary>
    public static string ResolveSessionTitle(ChatSession session, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!string.IsNullOrWhiteSpace(session.Title))
        {
            return session.Title!.Trim();
        }

        if (!string.IsNullOrWhiteSpace(session.FirstMessage))
        {
            return session.FirstMessage!.Trim();
        }

        return localizer.GetString(ChatbotRegistration.UntitledKey, ChatbotRegistration.UntitledDefault);
    }

    /// <summary>The localized, pluralized "{n} msg(s)" label for a session row (web <c>session.messageCount</c>).</summary>
    public static string MessageCountLabel(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = count == 1
            ? localizer.GetString(ChatbotRegistration.MessageCountOneKey, ChatbotRegistration.MessageCountOneDefault)
            : localizer.GetString(ChatbotRegistration.MessageCountOtherKey, ChatbotRegistration.MessageCountOtherDefault);
        return template.Replace("{0}", count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    /// <summary>
    /// Project the active conversation's messages into the per-row <see cref="ChatMessageItemModel"/>s the view
    /// renders through the shared <c>ChatMessageItem</c> control, deriving the web grouping flags (first / last in
    /// a same-role run) and the last-assistant / last-user affordance gates.
    /// </summary>
    public static IReadOnlyList<ChatMessageItemModel> ProjectMessages(
        IReadOnlyList<ChatMessageData>? messages,
        bool actionsDisabled = false)
    {
        if (messages is null || messages.Count == 0)
        {
            return Array.Empty<ChatMessageItemModel>();
        }

        string? lastAssistantId = null;
        string? lastUserId = null;
        for (int i = 0; i < messages.Count; i++)
        {
            if (messages[i].Role == ChatRole.Assistant)
            {
                lastAssistantId = messages[i].Id;
            }
            else
            {
                lastUserId = messages[i].Id;
            }
        }

        var items = new List<ChatMessageItemModel>(messages.Count);
        for (int i = 0; i < messages.Count; i++)
        {
            var message = messages[i];
            var previous = i > 0 ? messages[i - 1] : null;
            var next = i + 1 < messages.Count ? messages[i + 1] : null;
            bool isFirstInGroup = previous is null || previous.Role != message.Role;
            bool isLastInGroup = next is null || next.Role != message.Role;
            bool isLastAssistant = message.Role == ChatRole.Assistant && message.Id == lastAssistantId;
            bool isLastUser = message.Role == ChatRole.User && message.Id == lastUserId;

            items.Add(ChatMessageItemModel.Ready(
                message,
                isLastAssistant: isLastAssistant,
                isLastUser: isLastUser,
                isFirstInGroup: isFirstInGroup,
                isLastInGroup: isLastInGroup,
                actionsDisabled: actionsDisabled,
                canRegenerate: isLastAssistant,
                canEditAndResend: isLastUser));
        }

        return items;
    }
}

/// <summary>
/// Canonical metadata for the <c>ChatbotPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/ChatbotPage.tsx</c> (route <c>/chatbot</c>, nav name <c>Chatbot</c>, already
/// present in <c>RouteTable.cs</c>). It centralizes the i18n keys (web key names + English defaults) every visible
/// literal resolves through, the five generated OpenAPI operation ids the data feed binds (web hooks
/// <c>useChatSessions</c> / <c>useChatHistory</c> / <c>useSendChatMessage</c> / <c>useRenameChatSession</c> /
/// <c>useDeleteChatSession</c>), and the diagnostics slug — so neither the view nor the feed hardcodes a string.
/// </summary>
public static class ChatbotRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ChatbotPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>Chatbot</c>, path <c>chatbot</c>).</summary>
    public const string RouteName = "Chatbot";

    // ── Generated OpenAPI operation ids (web hook -> Go route) ───────────────────────────────────────────────
    // Resolved against TeslaSync.Windows.Generated.Api.ApiEndpoints; asserted by ChatbotPageTests.

    /// <summary>web <c>useSendChatMessage</c> -> <c>POST /chatbot/</c>.</summary>
    public const string ChatOperation = "post_api_v1_chatbot";

    /// <summary>web <c>useChatHistory</c> -> <c>GET /chatbot/history?session_id=</c>.</summary>
    public const string HistoryOperation = "get_api_v1_chatbot_history";

    /// <summary>web <c>useChatSessions</c> -> <c>GET /chatbot/sessions</c>.</summary>
    public const string SessionsOperation = "get_api_v1_chatbot_sessions";

    /// <summary>web <c>useRenameChatSession</c> -> <c>PATCH /chatbot/sessions/{id}</c>.</summary>
    public const string RenameSessionOperation = "patch_api_v1_chatbot_sessions_id";

    /// <summary>web <c>useDeleteChatSession</c> -> <c>DELETE /chatbot/sessions/{id}</c>.</summary>
    public const string DeleteSessionOperation = "delete_api_v1_chatbot_sessions_id";

    /// <summary>The <c>{id}</c> path-parameter name for the rename / delete operations.</summary>
    public const string SessionPathParam = "id";

    /// <summary>The <c>session_id</c> query-parameter name for the history read.</summary>
    public const string SessionQueryParam = "session_id";

    // ── i18n keys + English defaults (web key names preserved verbatim) ─────────────────────────────────────

    /// <summary>web <c>chatbot.title</c>.</summary>
    public const string TitleKey = "chatbot.title";

    /// <summary>web <c>chatbot.title</c> English default.</summary>
    public const string TitleDefault = "Helix";

    /// <summary>web <c>chatbot.subtitle</c>.</summary>
    public const string SubtitleKey = "chatbot.subtitle";

    /// <summary>web <c>chatbot.subtitle</c> English default.</summary>
    public const string SubtitleDefault = "Ask Helix anything about your Tesla fleet";

    /// <summary>web <c>chatbot.history</c>.</summary>
    public const string HistoryKey = "chatbot.history";

    /// <summary>web <c>chatbot.history</c> English default.</summary>
    public const string HistoryDefault = "History";

    /// <summary>web <c>chatbot.aria.conversation</c>.</summary>
    public const string ConversationKey = "chatbot.aria.conversation";

    /// <summary>web <c>chatbot.aria.conversation</c> English default.</summary>
    public const string ConversationDefault = "Conversation";

    /// <summary>web <c>chatbot.inputLabel</c>.</summary>
    public const string InputLabelKey = "chatbot.inputLabel";

    /// <summary>web <c>chatbot.inputLabel</c> English default.</summary>
    public const string InputLabelDefault = "Message";

    /// <summary>The composer input hint i18n key (web composer hint text).</summary>
    public const string InputHintKey = "chatbot.placeholder"; // parity:allow web i18n key name, not a stub

    /// <summary>The composer input hint English default.</summary>
    public const string InputHintDefault = "Ask about your fleet…";

    /// <summary>web <c>chatbot.actions.send</c>.</summary>
    public const string SendKey = "chatbot.actions.send";

    /// <summary>web <c>chatbot.actions.send</c> English default.</summary>
    public const string SendDefault = "Send message";

    /// <summary>web <c>chatbot.actions.stop</c>.</summary>
    public const string StopKey = "chatbot.actions.stop";

    /// <summary>web <c>chatbot.actions.stop</c> English default.</summary>
    public const string StopDefault = "Stop";

    /// <summary>web <c>chatbot.actions.stopHint</c>.</summary>
    public const string StopHintKey = "chatbot.actions.stopHint";

    /// <summary>web <c>chatbot.actions.stopHint</c> English default.</summary>
    public const string StopHintDefault = "Stop reveal (Esc)";

    /// <summary>web <c>chatbot.actions.stopStreaming</c>.</summary>
    public const string StopStreamingKey = "chatbot.actions.stopStreaming";

    /// <summary>web <c>chatbot.actions.stopStreaming</c> English default.</summary>
    public const string StopStreamingDefault = "Stop streaming";

    /// <summary>web <c>chatbot.howCanIHelp</c>.</summary>
    public const string HowCanIHelpKey = "chatbot.howCanIHelp";

    /// <summary>web <c>chatbot.howCanIHelp</c> English default.</summary>
    public const string HowCanIHelpDefault = "How can Helix help you?";

    /// <summary>web <c>chatbot.askAbout</c>.</summary>
    public const string AskAboutKey = "chatbot.askAbout";

    /// <summary>web <c>chatbot.askAbout</c> English default.</summary>
    public const string AskAboutDefault = "Ask about your vehicles, drives, charging, and more";

    /// <summary>web <c>chatbot.thinking</c>.</summary>
    public const string ThinkingKey = "chatbot.thinking";

    /// <summary>web <c>chatbot.thinking</c> English default.</summary>
    public const string ThinkingDefault = "Helix is thinking…";

    // ── Sidebar copy (web SessionList) — not in the manifest's 13, but routed through i18n all the same ──────

    /// <summary>web <c>chatbot.newChat</c>.</summary>
    public const string NewChatKey = "chatbot.newChat";

    /// <summary>web <c>chatbot.newChat</c> English default.</summary>
    public const string NewChatDefault = "New Chat";

    /// <summary>web <c>chatbot.noSessions</c>.</summary>
    public const string NoSessionsKey = "chatbot.noSessions";

    /// <summary>web <c>chatbot.noSessions</c> English default.</summary>
    public const string NoSessionsDefault = "No conversations yet";

    /// <summary>web <c>chatbot.session.untitled</c>.</summary>
    public const string UntitledKey = "chatbot.session.untitled";

    /// <summary>web <c>chatbot.session.untitled</c> English default.</summary>
    public const string UntitledDefault = "Untitled conversation";

    /// <summary>web <c>chatbot.session.messageCount</c> (singular) plural form.</summary>
    public const string MessageCountOneKey = "chatbot.session.messageCount.Plural.one";

    /// <summary>web singular message-count English default.</summary>
    public const string MessageCountOneDefault = "{0} msg";

    /// <summary>web <c>chatbot.session.messageCount</c> (other) plural form.</summary>
    public const string MessageCountOtherKey = "chatbot.session.messageCount.Plural.other";

    /// <summary>web other message-count English default.</summary>
    public const string MessageCountOtherDefault = "{0} msgs";

    /// <summary>web <c>chatbot.aria.renameSession</c>.</summary>
    public const string RenameSessionKey = "chatbot.aria.renameSession";

    /// <summary>web <c>chatbot.aria.renameSession</c> English default.</summary>
    public const string RenameSessionDefault = "Rename conversation";

    /// <summary>web <c>chatbot.aria.deleteSession</c>.</summary>
    public const string DeleteSessionKey = "chatbot.aria.deleteSession";

    /// <summary>web <c>chatbot.aria.deleteSession</c> English default.</summary>
    public const string DeleteSessionDefault = "Delete conversation";

    /// <summary>The localized page title (web <c>chatbot.title</c>) — backs the header and the window title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleDefault);
    }

    /// <summary>Every i18n key the manifest requires the page to resolve (the 13 PARITY_REQUIRED strings).</summary>
    public static IReadOnlyList<string> RequiredStringKeys { get; } =
    [
        SendKey,
        StopKey,
        StopHintKey,
        StopStreamingKey,
        ConversationKey,
        AskAboutKey,
        HistoryKey,
        HowCanIHelpKey,
        InputLabelKey,
        InputHintKey,
        SubtitleKey,
        ThinkingKey,
        TitleKey,
    ];

    /// <summary>The five generated operation ids the data feed binds (web's five chatbot hooks).</summary>
    public static IReadOnlyList<string> OperationIds { get; } =
    [
        SessionsOperation,
        HistoryOperation,
        ChatOperation,
        RenameSessionOperation,
        DeleteSessionOperation,
    ];
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers shared by the chatbot parsers. The Windows app reads the Go API's
/// raw snake_case JSON directly (no <c>camelCaseKeys</c> transform), so snake_case is the primary key with a
/// camelCase fallback for defensiveness. WinUI-free so the parsers are unit-tested headless.
/// </summary>
internal static class ChatbotJson
{
    /// <summary>Read a required string (number / bool coerced to text); null when the property is absent / null.</summary>
    public static string? ReadString(JsonElement element, string name, string? altName = null)
    {
        if (!TryGetProperty(element, name, altName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
    }

    /// <summary>Read an optional string; null / whitespace and missing both collapse to null.</summary>
    public static string? ReadNullableString(JsonElement element, string name, string? altName = null)
    {
        var raw = ReadString(element, name, altName);
        return string.IsNullOrWhiteSpace(raw) ? null : raw;
    }

    /// <summary>Read an integer (string-encoded numbers tolerated); 0 when absent / unparseable.</summary>
    public static int ReadInt(JsonElement element, string name, string? altName = null)
    {
        if (!TryGetProperty(element, name, altName, out var value))
        {
            return 0;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return 0;
    }

    /// <summary>Read an ISO-8601 timestamp; null when absent / unparseable.</summary>
    public static DateTimeOffset? ReadDate(JsonElement element, string name, string? altName = null)
    {
        if (!TryGetProperty(element, name, altName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var parsed)
            ? parsed
            : null;
    }

    private static bool TryGetProperty(JsonElement element, string name, string? altName, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(name, out value))
            {
                return true;
            }

            if (altName is not null && element.TryGetProperty(altName, out value))
            {
                return true;
            }
        }

        value = default;
        return false;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ChatbotPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, message body or title — so a
/// diagnostics line can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class ChatbotDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChatbotDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChatbotPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChatbotRegistration.Slug}");
    }
}
