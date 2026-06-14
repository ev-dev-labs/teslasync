using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The result of sending a chat message — the native mirror of the web <c>ChatResponse</c>
/// (web/src/api/types.ts), the body <c>POST /chatbot/</c> returns.
/// </summary>
/// <param name="SessionId">The (possibly newly-minted) session id the reply belongs to (web <c>session_id</c>).</param>
/// <param name="Response">The assistant's reply text (web <c>response</c>).</param>
public sealed record ChatSendResult(string SessionId, string Response);

/// <summary>
/// The data port the <see cref="ChatbotPageViewModel"/> reads the conversation through and writes mutations back
/// through — the native parity of the five web hooks the page binds
/// (web/src/features/system/pages/ChatbotPage.tsx): <c>useChatSessions</c>, <c>useChatHistory</c>,
/// <c>useSendChatMessage</c>, <c>useRenameChatSession</c> and <c>useDeleteChatSession</c>. The view never performs
/// HTTP itself; the default <see cref="EmptyChatbotFeed"/> resolves to the empty state and the
/// generated-client-backed <see cref="ChatbotClientFeed"/> binds to the <c>/chatbot</c> endpoints (ADR-004).
/// </summary>
public interface IChatbotFeed
{
    /// <summary>List the chat sessions for the History sidebar (web <c>useChatSessions -> GET /chatbot/sessions</c>).</summary>
    Task<IReadOnlyList<ChatSession>> FetchSessionsAsync(CancellationToken cancellationToken);

    /// <summary>Load one session's message history (web <c>useChatHistory -> GET /chatbot/history?session_id=</c>).</summary>
    Task<IReadOnlyList<ChatMessageData>> FetchHistoryAsync(string sessionId, CancellationToken cancellationToken);

    /// <summary>Send a user message (web <c>useSendChatMessage -> POST /chatbot/</c> with the snake_case body).</summary>
    Task<ChatSendResult> SendMessageAsync(string message, string? sessionId, CancellationToken cancellationToken);

    /// <summary>Rename a session, empty title clearing the override (web <c>useRenameChatSession -> PATCH /chatbot/sessions/{id}</c>).</summary>
    Task RenameSessionAsync(string sessionId, string title, CancellationToken cancellationToken);

    /// <summary>Delete a session and all its messages (web <c>useDeleteChatSession -> DELETE /chatbot/sessions/{id}</c>).</summary>
    Task DeleteSessionAsync(string sessionId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no sessions / no history and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyChatbotFeed : IChatbotFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChatbotFeed Instance { get; } = new();

    private EmptyChatbotFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ChatSession>> FetchSessionsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<ChatSession>>(Array.Empty<ChatSession>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ChatMessageData>> FetchHistoryAsync(string sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<ChatMessageData>>(Array.Empty<ChatMessageData>());
    }

    /// <inheritdoc />
    public Task<ChatSendResult> SendMessageAsync(string message, string? sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ChatSendResult(sessionId ?? string.Empty, string.Empty));
    }

    /// <inheritdoc />
    public Task RenameSessionAsync(string sessionId, string title, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteSessionAsync(string sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChatbotFeed"/> — the native data adapter for the chatbot surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /chatbot/sessions</c> for the sidebar (web
/// <c>useChatSessions</c>), <c>GET /chatbot/history?session_id=</c> for one conversation (web
/// <c>useChatHistory</c>), <c>POST /chatbot/</c> with the snake_case <c>{ message, session_id }</c> body for a
/// turn (web <c>useSendChatMessage</c>), <c>PATCH /chatbot/sessions/{id}</c> with <c>{ title }</c> for the inline
/// rename (web <c>useRenameChatSession</c>) and <c>DELETE /chatbot/sessions/{id}</c> for a delete (web
/// <c>useDeleteChatSession</c>). No HTTP touches the view; every response JSON round-trips through the tolerant
/// parsers so the snake_case wire shape is preserved losslessly.
/// </summary>
public sealed class ChatbotClientFeed : IChatbotFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ChatbotClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ChatSession>> FetchSessionsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ChatbotRegistration.SessionsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ChatSession.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ChatMessageData>> FetchHistoryAsync(string sessionId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);

        var request = new ApiRequest(
            ChatbotRegistration.HistoryOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [ChatbotRegistration.SessionQueryParam] = sessionId,
            });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ChatHistoryParsing.ParseMessages(json);
    }

    /// <inheritdoc />
    public async Task<ChatSendResult> SendMessageAsync(string message, string? sessionId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["message"] = message,
        };
        if (!string.IsNullOrEmpty(sessionId))
        {
            body[ChatbotRegistration.SessionQueryParam] = sessionId;
        }

        var request = new ApiRequest(ChatbotRegistration.ChatOperation, Body: body);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ChatHistoryParsing.ParseSendResult(json, sessionId);
    }

    /// <inheritdoc />
    public async Task RenameSessionAsync(string sessionId, string title, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);
        ArgumentNullException.ThrowIfNull(title);

        var request = new ApiRequest(
            ChatbotRegistration.RenameSessionOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [ChatbotRegistration.SessionPathParam] = sessionId,
            },
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["title"] = title,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteSessionAsync(string sessionId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);

        var request = new ApiRequest(
            ChatbotRegistration.DeleteSessionOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [ChatbotRegistration.SessionPathParam] = sessionId,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}

/// <summary>
/// Tolerant parsers for the conversation reads/writes — <c>GET /chatbot/history</c> (a bare
/// <c>ChatMessage[]</c>) and <c>POST /chatbot/</c> (a <c>ChatResponse</c>). WinUI-free so they are unit-tested
/// headless.
/// </summary>
internal static class ChatHistoryParsing
{
    /// <summary>Parse the history response (web <c>ChatMessage[]</c>) into the conversation's render data.</summary>
    public static IReadOnlyList<ChatMessageData> ParseMessages(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
            {
                array = messages;
            }
            else if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                array = data;
            }
            else
            {
                return Array.Empty<ChatMessageData>();
            }
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChatMessageData>();
        }

        var items = new List<ChatMessageData>(array.GetArrayLength());
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

            var role = string.Equals(ChatbotJson.ReadString(element, "role"), "user", StringComparison.OrdinalIgnoreCase)
                ? ChatRole.User
                : ChatRole.Assistant;

            items.Add(new ChatMessageData(
                id!,
                role,
                ChatbotJson.ReadString(element, "content") ?? string.Empty,
                ChatbotJson.ReadDate(element, "created_at", "createdAt")));
        }

        return items;
    }

    /// <summary>Parse the send response (web <c>ChatResponse</c>); the request session id is the fallback.</summary>
    public static ChatSendResult ParseSendResult(JsonElement root, string? requestSessionId)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return new ChatSendResult(requestSessionId ?? string.Empty, string.Empty);
        }

        var sessionId = ChatbotJson.ReadNullableString(root, "session_id", "sessionId")
            ?? (string.IsNullOrEmpty(requestSessionId) ? string.Empty : requestSessionId);
        var response = ChatbotJson.ReadString(root, "response") ?? string.Empty;
        return new ChatSendResult(sessionId, response);
    }
}
