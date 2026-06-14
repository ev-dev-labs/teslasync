using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChatbotPage"/> view — the native port of the web
/// page's hook composition + local conversation state (web/src/features/system/pages/ChatbotPage.tsx). It owns the
/// History sessions (web <c>useChatSessions</c>), the active conversation's messages (web <c>useChatHistory</c> +
/// the optimistic local state the typewriter manages), the composer draft, the sidebar visibility and the
/// mutually-exclusive conversation <see cref="State"/> (loading / success / empty / error), reads + writes through
/// the injected <see cref="IChatbotFeed"/> (web <c>useChatHistory</c> / <c>useSendChatMessage</c> /
/// <c>useRenameChatSession</c> / <c>useDeleteChatSession</c>), and projects everything through
/// <see cref="ChatbotProjection"/> so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChatbotPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChatbotFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly ChatbotDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private CancellationTokenSource? _sendCts;
    private bool _disposed;
    private long _localIdSeq;

    private IReadOnlyList<ChatSession> _sessions = Array.Empty<ChatSession>();
    private readonly List<ChatMessageData> _messages = new();
    private string _activeSessionId = string.Empty;
    private string _input = string.Empty;
    private bool _showSessions;

    private ChatbotState _state = ChatbotState.Loading;
    private ChatbotDisplay _display;
    private bool _isSending;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The conversation + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChatbotPageViewModel(
        IChatbotFeed feed,
        ILocalizer localizer,
        ChatbotDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChatbotDiagnostics();
        _display = ChatbotProjection.Project(Snapshot(), _state, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive conversation state (loading / success / empty / error).</summary>
    public ChatbotState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ChatbotDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while an assistant reply is pending (web <c>isWaiting</c>) — drives the thinking indicator.</summary>
    public bool IsSending
    {
        get => _isSending;
        private set => Set(ref _isSending, value);
    }

    /// <summary>True while a background sessions/history (re)fetch is in flight (keeps content while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The History sidebar visibility (web <c>showSessions</c>); the header History button toggles it.</summary>
    public bool ShowSessions
    {
        get => _showSessions;
        private set => Set(ref _showSessions, value);
    }

    /// <summary>The composer draft text (web <c>input</c>). Reassigning raises a notification but does not re-project.</summary>
    public string Input
    {
        get => _input;
        set => Set(ref _input, value ?? string.Empty);
    }

    /// <summary>The id of the loaded session, or the empty string for a brand-new chat (web <c>sessionId</c>).</summary>
    public string ActiveSessionId => _activeSessionId;

    /// <summary>The localized page title (web <c>chatbot.title</c>).</summary>
    public string Title => ChatbotRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Flip the History sidebar visibility (web <c>setShowSessions((s) =&gt; !s)</c>).</summary>
    public void ToggleHistory() => ShowSessions = !_showSessions;

    /// <summary>
    /// Run (or re-run) the conversation load: fetch the History sessions (web <c>useChatSessions</c>) and, when a
    /// session is active, its message history (web <c>useChatHistory</c>). Shows the loading skeleton only when
    /// nothing is already visible; folds the result into <see cref="State"/> + <see cref="Display"/>; a superseding
    /// load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_messages.Count == 0 && _sessions.Count == 0)
        {
            SetState(ChatbotState.Loading);
        }

        try
        {
            var sessions = await _feed.FetchSessionsAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _sessions = sessions ?? Array.Empty<ChatSession>();

            if (!string.IsNullOrEmpty(_activeSessionId))
            {
                var history = await _feed.FetchHistoryAsync(_activeSessionId, cts.Token).ConfigureAwait(false);
                cts.Token.ThrowIfCancellationRequested();
                ReplaceMessages(history);
            }

            IsFetching = false;
            SetState(DeriveContentState());
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            IsFetching = false;
            SetState(ChatbotState.Error);
        }
    }

    /// <summary>Refresh the conversation (web query refetch / retry button).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a failure — re-runs the load from the top (the error surface's Retry).</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Load a session into the conversation panel (web <c>loadSession</c>): clears the current messages, marks it
    /// active and fetches its history (web <c>useChatHistory</c>).
    /// </summary>
    /// <param name="sessionId">The session to load.</param>
    /// <param name="cancellationToken">Cancels this load.</param>
    public async Task LoadSessionAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);

        var cts = Supersede(ref _cts, cancellationToken);
        _activeSessionId = sessionId;
        _messages.Clear();
        IsFetching = true;
        SetState(ChatbotState.Loading);

        try
        {
            var history = await _feed.FetchHistoryAsync(sessionId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            ReplaceMessages(history);
            IsFetching = false;
            SetState(DeriveContentState());
        }
        catch (OperationCanceledException)
        {
            // Superseded — drop silently.
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            IsFetching = false;
            SetState(ChatbotState.Error);
        }
    }

    /// <summary>Start a fresh conversation (web <c>startNewSession</c>): clear the active session, messages and draft.</summary>
    public void StartNewSession()
    {
        _activeSessionId = string.Empty;
        _messages.Clear();
        _input = string.Empty;
        Raise(nameof(Input));
        SetState(ChatbotState.Empty);
    }

    /// <summary>
    /// Send a user message (web <c>submitMessage</c> baseline path → <c>useSendChatMessage</c>). Appends the user
    /// message optimistically, shows the thinking indicator, awaits the deterministic reply, appends it and
    /// refreshes the History sessions. A blank message or an in-flight send is a no-op (web guards).
    /// </summary>
    /// <param name="text">The composer text to send.</param>
    /// <param name="cancellationToken">Cancels the send.</param>
    public async Task SendMessageAsync(string text, CancellationToken cancellationToken = default)
    {
        var message = (text ?? string.Empty).Trim();
        if (message.Length == 0 || _isSending)
        {
            return;
        }

        var sessionId = _activeSessionId;
        _messages.Add(new ChatMessageData(NextLocalId("u"), ChatRole.User, message, DateTimeOffset.UtcNow));
        IsSending = true;
        SetState(ChatbotState.Success);

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _sendCts, cts);
        previous?.Dispose();

        try
        {
            var result = await _feed.SendMessageAsync(
                message,
                string.IsNullOrEmpty(sessionId) ? null : sessionId,
                cts.Token).ConfigureAwait(false);

            if (string.IsNullOrEmpty(_activeSessionId) && !string.IsNullOrEmpty(result.SessionId))
            {
                _activeSessionId = result.SessionId;
            }

            _messages.Add(new ChatMessageData(
                NextLocalId("a"),
                ChatRole.Assistant,
                result.Response,
                DateTimeOffset.UtcNow));

            IsSending = false;
            SetState(DeriveContentState());
            await RefreshSessionsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Stop pressed (web stopAll) or superseded: keep the user's message, drop the pending indicator.
            IsSending = false;
            SetState(DeriveContentState());
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The send failed: keep the user's message visible (web keeps the optimistic row), drop the pending
            // indicator and re-derive the content state. The user can resubmit.
            IsSending = false;
            SetState(DeriveContentState());
        }
        finally
        {
            if (Interlocked.CompareExchange(ref _sendCts, null, cts) == cts)
            {
                cts.Dispose();
            }
        }
    }

    /// <summary>
    /// Stop the in-flight reply (web <c>stopAll</c> / the composer Stop button + Escape): cancels the pending
    /// send so the thinking indicator clears and the user's message stays. A no-op when nothing is in flight.
    /// </summary>
    public void CancelSend() => _sendCts?.Cancel();

    /// <summary>Rename a session inline (web <c>handleRename</c> → <c>useRenameChatSession</c>), then refresh the list.</summary>
    /// <param name="sessionId">The session to rename.</param>
    /// <param name="title">The new title; an empty string clears the override.</param>
    /// <param name="cancellationToken">Cancels the mutation.</param>
    public async Task RenameSessionAsync(string sessionId, string title, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);
        ArgumentNullException.ThrowIfNull(title);

        try
        {
            await _feed.RenameSessionAsync(sessionId, title.Trim(), cancellationToken).ConfigureAwait(false);
            await RefreshSessionsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Rename failed: leave the list as-is (web surfaces a toast; no destructive local change).
        }
    }

    /// <summary>
    /// Delete a session and all its messages (web <c>handleDelete</c> → <c>useDeleteChatSession</c>). When the
    /// deleted session is the active one, the conversation resets to a fresh chat (web <c>startNewSession</c>).
    /// </summary>
    /// <param name="sessionId">The session to delete.</param>
    /// <param name="cancellationToken">Cancels the mutation.</param>
    public async Task DeleteSessionAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);

        try
        {
            await _feed.DeleteSessionAsync(sessionId, cancellationToken).ConfigureAwait(false);
            if (string.Equals(sessionId, _activeSessionId, StringComparison.Ordinal))
            {
                _activeSessionId = string.Empty;
                _messages.Clear();
            }

            await RefreshSessionsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Delete failed: leave the list as-is (web surfaces a toast).
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        var sendCts = Interlocked.Exchange(ref _sendCts, null);
        sendCts?.Cancel();
        sendCts?.Dispose();
    }

    private async Task RefreshSessionsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var sessions = await _feed.FetchSessionsAsync(cancellationToken).ConfigureAwait(false);
            _sessions = sessions ?? Array.Empty<ChatSession>();
            Reproject();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A failed sidebar refresh must not blow away the visible conversation — keep the last good list.
        }
    }

    private ChatbotState DeriveContentState() =>
        _messages.Count > 0 ? ChatbotState.Success : ChatbotState.Empty;

    private void ReplaceMessages(IReadOnlyList<ChatMessageData>? messages)
    {
        _messages.Clear();
        if (messages is not null)
        {
            _messages.AddRange(messages);
        }
    }

    private ChatbotSnapshot Snapshot() =>
        new(_sessions, _messages.ToArray(), _activeSessionId);

    private void SetState(ChatbotState state)
    {
        _state = state;
        Reproject();
        Raise(nameof(State));
    }

    private void Reproject() =>
        Display = ChatbotProjection.Project(Snapshot(), _state, _localizer, actionsDisabled: _isSending);

    private string NextLocalId(string prefix) =>
        string.Create(CultureInfo.InvariantCulture, $"{prefix}-local-{Interlocked.Increment(ref _localIdSeq)}");

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? field, CancellationToken token)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(token);
        var previous = Interlocked.Exchange(ref field, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
