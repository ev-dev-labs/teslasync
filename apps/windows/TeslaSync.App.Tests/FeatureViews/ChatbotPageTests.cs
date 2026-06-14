using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.SystemOps;
using TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChatbotPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/ChatbotPage.tsx), the three declared data states (loading / empty / success)
/// plus the defensive error branch, the five data sources bound through the <see cref="IChatbotFeed"/>
/// (<c>useChatSessions</c> / <c>useChatHistory</c> / <c>useSendChatMessage</c> / <c>useRenameChatSession</c> /
/// <c>useDeleteChatSession</c>), the thirteen PARITY_REQUIRED i18n keys, the session/message projections and the
/// tolerant wire parsers. The WinUI view is exercised by the app build; its per-region content is driven entirely
/// by the <see cref="ChatbotDisplay"/> projection asserted here.
/// </summary>
public sealed class ChatbotPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── i18n key coverage (PARITY_REQUIRED strings) ─────────────────────────────────────────────────────────

    private static readonly string[] RequiredStringKeys =
    [
        "chatbot.actions.send",
        "chatbot.actions.stop",
        "chatbot.actions.stopHint",
        "chatbot.actions.stopStreaming",
        "chatbot.aria.conversation",
        "chatbot.askAbout",
        "chatbot.history",
        "chatbot.howCanIHelp",
        "chatbot.inputLabel",
        "chatbot.placeholder", // parity:allow web i18n key name, not a stub
        "chatbot.subtitle",
        "chatbot.thinking",
        "chatbot.title",
    ];

    [Fact]
    public void Manifest_requires_thirteen_distinct_strings()
    {
        Assert.Equal(13, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
        Assert.Equal(
            RequiredStringKeys.OrderBy(static k => k, StringComparer.Ordinal),
            ChatbotRegistration.RequiredStringKeys.OrderBy(static k => k, StringComparer.Ordinal));
    }

    [Fact]
    public void Projection_resolves_every_required_string()
    {
        var recorder = new RecordingLocalizer();

        _ = ChatbotProjection.Project(ChatbotSnapshot.Empty, ChatbotState.Empty, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_the_web_default_chrome()
    {
        var display = ChatbotProjection.Project(ChatbotSnapshot.Empty, ChatbotState.Empty, Localizer);

        Assert.Equal("Helix", display.Title);
        Assert.Equal("Helix", display.DocumentTitle);
        Assert.Equal("Ask Helix anything about your Tesla fleet", display.Subtitle);
        Assert.Equal("History", display.HistoryLabel);
        Assert.Equal("Conversation", display.ConversationLabel);
        Assert.Equal("Message", display.InputLabel);
        Assert.Equal("Ask about your fleet…", display.InputHint);
        Assert.Equal("Send message", display.SendLabel);
        Assert.Equal("Stop", display.StopLabel);
        Assert.Equal("Stop reveal (Esc)", display.StopHint);
        Assert.Equal("Stop streaming", display.StopStreamingLabel);
        Assert.Equal("How can Helix help you?", display.HowCanIHelp);
        Assert.Equal("Ask about your vehicles, drives, charging, and more", display.AskAbout);
        Assert.Equal("Helix is thinking…", display.Thinking);
    }

    // ── Generated operation ids (the five chatbot hooks resolve against the contract) ───────────────────────

    [Fact]
    public void Every_chatbot_operation_resolves_against_the_generated_table()
    {
        var ids = ApiEndpoints.All.Select(static e => e.OperationId).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(5, ChatbotRegistration.OperationIds.Count);
        foreach (var op in ChatbotRegistration.OperationIds)
        {
            Assert.Contains(op, ids);
        }
    }

    [Fact]
    public void Rename_and_delete_operations_take_the_id_path_parameter()
    {
        foreach (var op in new[] { ChatbotRegistration.RenameSessionOperation, ChatbotRegistration.DeleteSessionOperation })
        {
            var descriptor = ApiEndpoints.All.Single(e => e.OperationId == op);
            Assert.Contains(ChatbotRegistration.SessionPathParam, descriptor.PathParams);
        }
    }

    // ── Data states (loading / success / empty / error) ─────────────────────────────────────────────────────

    [Fact]
    public void Default_state_is_loading()
    {
        var vm = new ChatbotPageViewModel(EmptyChatbotFeed.Instance, Localizer);
        Assert.Equal(ChatbotState.Loading, vm.State);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_conversation_state()
    {
        var vm = new ChatbotPageViewModel(EmptyChatbotFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChatbotState.Empty, vm.State);
        Assert.True(vm.Display.IsConversationEmpty);
        Assert.False(vm.Display.HasSessions);
    }

    [Fact]
    public async Task Loaded_sessions_and_history_resolve_to_the_success_state()
    {
        var feed = new FakeChatbotFeed
        {
            Sessions = [new ChatSession("s1", "Trip questions", null, 4, DateTimeOffset.UtcNow)],
            History = [Msg("1", ChatRole.User, "hi"), Msg("2", ChatRole.Assistant, "hello")],
        };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();           // sidebar sessions (web useChatSessions)
        await vm.LoadSessionAsync("s1"); // that session's history (web useChatHistory)

        Assert.Equal(ChatbotState.Success, vm.State);
        Assert.False(vm.Display.IsConversationEmpty);
        Assert.Equal(2, vm.Display.Messages.Count);
        Assert.True(vm.Display.HasSessions);
        Assert.Equal(1, feed.HistoryCalls);
    }

    [Fact]
    public async Task A_failed_load_resolves_to_the_error_state()
    {
        var feed = new FakeChatbotFeed { ThrowOnSessions = true };
        var vm = new ChatbotPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChatbotState.Error, vm.State);
    }

    [Fact]
    public async Task Retry_after_a_failure_recovers_to_a_content_state()
    {
        var feed = new FakeChatbotFeed { ThrowOnSessions = true };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        Assert.Equal(ChatbotState.Error, vm.State);

        feed.ThrowOnSessions = false;
        feed.Sessions = [new ChatSession("s1", null, "first message", 1, null)];
        await vm.RetryAsync();

        Assert.Equal(ChatbotState.Empty, vm.State); // sessions present but no active conversation
        Assert.True(vm.Display.HasSessions);
    }

    // ── The five bound data sources are each exercised ──────────────────────────────────────────────────────

    [Fact]
    public async Task Sending_a_message_binds_send_then_refreshes_sessions()
    {
        var feed = new FakeChatbotFeed
        {
            SendResult = new ChatSendResult("s-new", "Here is your answer."),
        };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SendMessageAsync("What did my fleet do yesterday?");

        Assert.Equal(1, feed.SendCalls);
        Assert.Equal("What did my fleet do yesterday?", feed.LastSentMessage);
        Assert.Equal("s-new", vm.ActiveSessionId);
        Assert.Equal(ChatbotState.Success, vm.State);
        Assert.False(vm.IsSending);
        Assert.Equal(2, vm.Display.Messages.Count); // user + assistant
        Assert.True(feed.SessionsCalls >= 2);       // initial load + post-send refresh
    }

    [Fact]
    public async Task Sending_blank_text_is_a_no_op()
    {
        var feed = new FakeChatbotFeed();
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SendMessageAsync("   ");

        Assert.Equal(0, feed.SendCalls);
    }

    [Fact]
    public async Task Stopping_an_in_flight_send_clears_the_indicator_and_keeps_the_user_message()
    {
        var feed = new FakeChatbotFeed { BlockSendUntilCancelled = true };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        var sendTask = vm.SendMessageAsync("hello there");
        Assert.True(vm.IsSending);
        Assert.Equal(1, feed.SendCalls);

        vm.CancelSend(); // web stopAll / Stop button
        await sendTask;

        Assert.False(vm.IsSending);
        Assert.Contains(vm.Display.Messages, m => m.Message?.Content == "hello there");
    }

    [Fact]
    public async Task Renaming_binds_rename_then_refreshes_sessions()
    {
        var feed = new FakeChatbotFeed
        {
            Sessions = [new ChatSession("s1", null, "first", 2, null)],
        };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.RenameSessionAsync("s1", "My renamed chat");

        Assert.Equal(1, feed.RenameCalls);
        Assert.Equal(("s1", "My renamed chat"), feed.LastRename);
    }

    [Fact]
    public async Task Deleting_the_active_session_binds_delete_and_resets_the_conversation()
    {
        var feed = new FakeChatbotFeed
        {
            Sessions = [new ChatSession("s1", "Active", null, 3, null)],
            History = [Msg("1", ChatRole.User, "hi")],
        };
        var vm = new ChatbotPageViewModel(feed, Localizer);
        await vm.LoadSessionAsync("s1");
        Assert.Equal("s1", vm.ActiveSessionId);

        await vm.DeleteSessionAsync("s1");

        Assert.Equal(1, feed.DeleteCalls);
        Assert.Equal(string.Empty, vm.ActiveSessionId);
        Assert.True(vm.Display.IsConversationEmpty);
    }

    [Fact]
    public void Toggling_history_flips_sidebar_visibility()
    {
        var vm = new ChatbotPageViewModel(EmptyChatbotFeed.Instance, Localizer);
        Assert.False(vm.ShowSessions);

        vm.ToggleHistory();
        Assert.True(vm.ShowSessions);

        vm.ToggleHistory();
        Assert.False(vm.ShowSessions);
    }

    [Fact]
    public void Starting_a_new_session_clears_the_active_conversation()
    {
        var vm = new ChatbotPageViewModel(EmptyChatbotFeed.Instance, Localizer) { Input = "draft" };

        vm.StartNewSession();

        Assert.Equal(string.Empty, vm.ActiveSessionId);
        Assert.Equal(string.Empty, vm.Input);
        Assert.Equal(ChatbotState.Empty, vm.State);
    }

    // ── Session projection (title fallback + count + active flag) ───────────────────────────────────────────

    [Fact]
    public void Session_title_falls_back_to_first_message_then_untitled()
    {
        Assert.Equal("Renamed", ChatbotProjection.ResolveSessionTitle(
            new ChatSession("s", "Renamed", "the first message", 1, null), Localizer));
        Assert.Equal("the first message", ChatbotProjection.ResolveSessionTitle(
            new ChatSession("s", null, "the first message", 1, null), Localizer));
        Assert.Equal("Untitled conversation", ChatbotProjection.ResolveSessionTitle(
            new ChatSession("s", null, null, 0, null), Localizer));
    }

    [Fact]
    public void Session_projection_marks_the_active_row_and_pluralizes_the_count()
    {
        var sessions = new[]
        {
            new ChatSession("s1", "One", null, 1, null),
            new ChatSession("s2", "Two", null, 5, null),
        };

        var items = ChatbotProjection.ProjectSessions(sessions, "s2", Localizer);

        Assert.Equal(2, items.Count);
        Assert.False(items[0].IsActive);
        Assert.True(items[1].IsActive);
        Assert.Equal("1 msg", items[0].MessageCountLabel);
        Assert.Equal("5 msgs", items[1].MessageCountLabel);
    }

    // ── Message projection (grouping + last-in-role affordances) ────────────────────────────────────────────

    [Fact]
    public void Message_projection_derives_grouping_and_affordance_flags()
    {
        var messages = new[]
        {
            Msg("1", ChatRole.User, "first"),
            Msg("2", ChatRole.User, "second"),
            Msg("3", ChatRole.Assistant, "reply"),
        };

        var items = ChatbotProjection.ProjectMessages(messages);

        Assert.Equal(3, items.Count);
        Assert.All(items, item => Assert.Equal(ChatMessageItemState.Ready, item.Status));

        Assert.True(items[0].IsFirstInGroup);
        Assert.False(items[0].IsLastInGroup);
        Assert.False(items[1].IsFirstInGroup);
        Assert.True(items[1].IsLastInGroup);
        Assert.True(items[1].IsLastUser);
        Assert.True(items[1].CanEditAndResend);

        Assert.True(items[2].IsFirstInGroup);
        Assert.True(items[2].IsLastAssistant);
        Assert.True(items[2].CanRegenerate);
    }

    [Fact]
    public void Message_projection_suppresses_actions_while_streaming()
    {
        var messages = new[] { Msg("1", ChatRole.Assistant, "reply") };

        var items = ChatbotProjection.ProjectMessages(messages, actionsDisabled: true);

        Assert.True(items[0].ActionsDisabled);
    }

    // ── Tolerant wire parsers ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ParseList_reads_the_sessions_array_with_title_fallback_fields()
    {
        const string json = """
        [
          { "id": "s1", "title": "Renamed", "first_message": "hello there", "message_count": 4, "last_message_at": "2026-01-02T03:04:05Z" },
          { "id": "s2", "title": null, "first_message": "another", "message_count": 1, "last_message_at": null }
        ]
        """;

        var sessions = ChatSession.ParseList(Parse(json));

        Assert.Equal(2, sessions.Count);
        Assert.Equal("s1", sessions[0].Id);
        Assert.Equal("Renamed", sessions[0].Title);
        Assert.Equal("hello there", sessions[0].FirstMessage);
        Assert.Equal(4, sessions[0].MessageCount);
        Assert.NotNull(sessions[0].LastMessageAt);
        Assert.Null(sessions[1].Title);
    }

    [Fact]
    public void ParseList_tolerates_a_non_array_payload()
    {
        Assert.Empty(ChatSession.ParseList(Parse("{}")));
        Assert.Empty(ChatSession.ParseList(Parse("null")));
    }

    [Fact]
    public void ParseMessages_maps_roles_and_content()
    {
        const string json = """
        [
          { "id": 1, "session_id": "s1", "role": "user", "content": "hi", "created_at": "2026-01-02T03:04:05Z" },
          { "id": 2, "session_id": "s1", "role": "assistant", "content": "hello", "created_at": "2026-01-02T03:04:06Z" }
        ]
        """;

        var messages = ChatHistoryParsing.ParseMessages(Parse(json));

        Assert.Equal(2, messages.Count);
        Assert.Equal("1", messages[0].Id);
        Assert.Equal(ChatRole.User, messages[0].Role);
        Assert.Equal("hi", messages[0].Content);
        Assert.Equal(ChatRole.Assistant, messages[1].Role);
    }

    [Fact]
    public void ParseSendResult_reads_response_and_session_id_with_request_fallback()
    {
        var parsed = ChatHistoryParsing.ParseSendResult(
            Parse("""{ "response": "the answer", "session_id": "s-server" }"""),
            requestSessionId: "s-req");
        Assert.Equal("s-server", parsed.SessionId);
        Assert.Equal("the answer", parsed.Response);

        var fallback = ChatHistoryParsing.ParseSendResult(Parse("""{ "response": "ok" }"""), "s-req");
        Assert.Equal("s-req", fallback.SessionId);
    }

    // ── Diagnostics (PII-safe) ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_with_the_slug_only()
    {
        var lines = new List<string>();
        var diagnostics = new ChatbotDiagnostics(lines.Add);
        var vm = new ChatbotPageViewModel(EmptyChatbotFeed.Instance, Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=ChatbotPage", lines);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────

    private static ChatMessageData Msg(string id, ChatRole role, string content) =>
        new(id, role, content, DateTimeOffset.UtcNow);

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeChatbotFeed : IChatbotFeed
    {
        public IReadOnlyList<ChatSession> Sessions { get; set; } = Array.Empty<ChatSession>();

        public IReadOnlyList<ChatMessageData> History { get; set; } = Array.Empty<ChatMessageData>();

        public ChatSendResult SendResult { get; set; } = new("s1", "reply");

        public bool ThrowOnSessions { get; set; }

        public bool BlockSendUntilCancelled { get; set; }

        public int SessionsCalls { get; private set; }

        public int HistoryCalls { get; private set; }

        public int SendCalls { get; private set; }

        public int RenameCalls { get; private set; }

        public int DeleteCalls { get; private set; }

        public string? LastSentMessage { get; private set; }

        public (string Id, string Title) LastRename { get; private set; }

        public Task<IReadOnlyList<ChatSession>> FetchSessionsAsync(CancellationToken cancellationToken)
        {
            SessionsCalls++;
            if (ThrowOnSessions)
            {
                throw new InvalidOperationException("sessions read failed");
            }

            return Task.FromResult(Sessions);
        }

        public Task<IReadOnlyList<ChatMessageData>> FetchHistoryAsync(string sessionId, CancellationToken cancellationToken)
        {
            HistoryCalls++;
            return Task.FromResult(History);
        }

        public Task<ChatSendResult> SendMessageAsync(string message, string? sessionId, CancellationToken cancellationToken)
        {
            SendCalls++;
            LastSentMessage = message;
            if (BlockSendUntilCancelled)
            {
                var tcs = new TaskCompletionSource<ChatSendResult>(TaskCreationOptions.RunContinuationsAsynchronously);
                cancellationToken.Register(() => tcs.TrySetCanceled(cancellationToken));
                return tcs.Task;
            }

            return Task.FromResult(SendResult);
        }

        public Task RenameSessionAsync(string sessionId, string title, CancellationToken cancellationToken)
        {
            RenameCalls++;
            LastRename = (sessionId, title);
            return Task.CompletedTask;
        }

        public Task DeleteSessionAsync(string sessionId, CancellationToken cancellationToken)
        {
            DeleteCalls++;
            return Task.CompletedTask;
        }
    }
}
