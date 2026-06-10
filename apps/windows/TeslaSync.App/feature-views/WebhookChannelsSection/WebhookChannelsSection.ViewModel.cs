using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WebhookChannelsSection"/> — the native port of the
/// web component's hook composition (web/src/features/settings/components/WebhookChannelsSection.tsx). It owns the
/// cache-then-network read of the kind=webhook channel list (driving the loading / loaded / empty / stale /
/// offline / error surface state), projects it through <see cref="WebhookChannelsProjection"/>, and exposes the
/// save / delete / toggle / test / signature-preview actions the rows and modal invoke. Save / delete / toggle
/// surface a localized toast through <see cref="ToastRequested"/>; the webhook test and signature preview return
/// their render-ready outcomes inline (no toast), exactly as the web renders them. Drive it from one confinement;
/// state application is serialized internally.
/// </summary>
public sealed class WebhookChannelsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWebhookChannelsSource _source;
    private readonly ILocalizer _localizer;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private WebhookChannelsState _state = WebhookChannelsState.Loading;
    private WebhookChannelList _webhooks = WebhookChannelList.Empty;
    private WebhookChannelsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the webhook source and the i18n facade.</summary>
    /// <param name="source">The cache-then-network webhook source plus the mutations and utilities.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public WebhookChannelsViewModel(IWebhookChannelsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient message for the toast surface (web <c>useToast</c>).</summary>
    public event EventHandler<WebhookChannelsToast>? ToastRequested;

    /// <summary>The current mutually-exclusive surface freshness state.</summary>
    public WebhookChannelsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (rows + header + docs copy).</summary>
    public WebhookChannelsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current parsed webhook list.</summary>
    public WebhookChannelList Webhooks => _webhooks;

    /// <summary>True when at least one webhook is configured.</summary>
    public bool HasWebhooks => _webhooks.HasData;

    /// <summary>Last successful read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == WebhookChannelsState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The diagnostics surface slug (<c>WebhookChannelsSection</c>).</summary>
    public static string Slug => WebhookChannelsRegistration.Slug;

    /// <summary>
    /// Run the cache-then-network webhook read: counts the attempt, shows the skeleton only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> / <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await ConsumeWebhooksAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this run silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the read from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Persist a webhook (web <c>useSaveChannel</c>): <c>POST</c> when <paramref name="id"/> is null, otherwise
    /// <c>PUT</c>. Surfaces the created/updated/error toast, refreshes on success and returns whether the save
    /// succeeded so the modal can close.
    /// </summary>
    public async Task<bool> SaveWebhookAsync(JsonObject body, long? id, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        try
        {
            await _source.SaveAsync(body, id, cancellationToken).ConfigureAwait(false);
            RaiseToast(id is null
                ? _localizer.GetString("webhookChannels.toast.created", "Webhook created")
                : _localizer.GetString("webhookChannels.toast.updated", "Webhook updated"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("webhookChannels.toast.saveError", "Failed to save webhook"), isError: true);
            return false;
        }
    }

    /// <summary>Delete a webhook (web <c>useDeleteChannel</c>); toasts the outcome and refreshes on success.</summary>
    public async Task DeleteWebhookAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            await _source.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            RaiseToast(_localizer.GetString("webhookChannels.toast.deleted", "Webhook deleted"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("webhookChannels.toast.deleteError", "Failed to delete webhook"), isError: true);
        }
    }

    /// <summary>Flip a webhook's enabled flag (web <c>useToggleChannel</c>); toasts the new state and refreshes.</summary>
    public async Task ToggleWebhookAsync(WebhookChannel channel, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(channel);
        try
        {
            await _source.ToggleAsync(channel.Id, cancellationToken).ConfigureAwait(false);
            RaiseToast(channel.Enabled
                ? _localizer.GetString("webhookChannels.toast.disabled", "Webhook disabled")
                : _localizer.GetString("webhookChannels.toast.enabled", "Webhook enabled"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("webhookChannels.toast.toggleError", "Failed to toggle webhook"), isError: true);
        }
    }

    /// <summary>
    /// Fire a structured test delivery (web <c>useTestWebhookChannel</c>) and return the inline render-ready
    /// outcome (status / latency / signature / body preview). A transport failure becomes the failure branch with
    /// the error message — never a toast, exactly as the web renders the result inline under the row.
    /// </summary>
    public async Task<WebhookTestDisplay> TestWebhookAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _source.TestWebhookAsync(id, cancellationToken).ConfigureAwait(false);
            return WebhookChannelsProjection.ProjectTest(result, _localizer);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            string message = string.IsNullOrEmpty(ex.Message)
                ? _localizer.GetString("webhookChannels.test.failure", "Failed")
                : ex.Message;
            return WebhookChannelsProjection.ProjectTest(WebhookTestResult.Failure(message), _localizer);
        }
    }

    /// <summary>
    /// Compute the live signature preview (web <c>SignaturePreview</c>): a blank secret short-circuits to the
    /// empty helper (the server rejects an empty secret), a successful call returns the ready branch carrying the
    /// signature, and a failure returns the error branch with the localized message.
    /// </summary>
    public async Task<WebhookSignatureOutcome> PreviewSignatureAsync(string secret, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(secret))
        {
            return new WebhookSignatureOutcome(
                WebhookSignatureStatus.Empty,
                string.Empty,
                _localizer.GetString(
                    "webhookChannels.signature.empty",
                    "Add a signing secret to preview the X-TeslaSync-Signature header."));
        }

        try
        {
            string signature = await _source
                .PreviewSignatureAsync(secret, WebhookChannelForm.SampleBody, cancellationToken)
                .ConfigureAwait(false);
            return new WebhookSignatureOutcome(
                WebhookSignatureStatus.Ready,
                signature,
                _localizer.GetString(
                    "webhookChannels.signature.help",
                    "Send this header value with every webhook so receivers can verify authenticity."));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            string message = _localizer
                .GetString("webhookChannels.signature.error", "Failed to compute signature: {{error}}")
                .Replace("{{error}}", ex.Message, StringComparison.Ordinal);
            return new WebhookSignatureOutcome(WebhookSignatureStatus.Failed, string.Empty, message);
        }
    }

    /// <summary>Resolve a webhook by id from the current list (used by the row toggle/edit handlers).</summary>
    public WebhookChannel? FindWebhook(long id)
    {
        foreach (var channel in _webhooks.Channels)
        {
            if (channel.Id == id)
            {
                return channel;
            }
        }

        return null;
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
        GC.SuppressFinalize(this);
    }

    private async Task ConsumeWebhooksAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _source.StreamWebhooksAsync(cancellationToken).ConfigureAwait(false))
        {
            ApplyWebhooks(result);
        }
    }

    private void ApplyWebhooks(RepositoryResult<WebhookChannelList> result)
    {
        lock (_gate)
        {
            switch (result.Status)
            {
                case LoadStatus.Loading:
                    if (!HasContent())
                    {
                        SetLoading();
                    }

                    IsFetching = true;
                    break;

                case LoadStatus.Cached:
                    ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                    break;

                case LoadStatus.Refreshing:
                    ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                    break;

                case LoadStatus.Loaded:
                    ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                    break;

                case LoadStatus.Empty:
                    SetEmpty(result.FetchedAt);
                    break;

                case LoadStatus.Offline:
                    ApplySnapshot(result.Value ?? WebhookChannelList.Empty, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                    break;

                default:
                    SetError(result.Error);
                    break;
            }
        }
    }

    private void ApplySnapshot(
        WebhookChannelList channels,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _webhooks = channels;
        Raise(nameof(Webhooks));
        Raise(nameof(HasWebhooks));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // web parity: a resolved read with no webhook rows always renders the friendly empty surface, even when
        // the underlying channel list holds other kinds.
        State = offline
            ? WebhookChannelsState.Offline
            : !channels.HasData
                ? WebhookChannelsState.Empty
                : stale
                    ? WebhookChannelsState.Stale
                    : WebhookChannelsState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = WebhookChannelsState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _webhooks = WebhookChannelList.Empty;
        Raise(nameof(Webhooks));
        Raise(nameof(HasWebhooks));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = WebhookChannelsState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = WebhookChannelsState.Error;
        RaiseError();
        Reproject();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "webhookChannels.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "webhookChannels.error.offline",
            _ => "webhookChannels.error.load",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage webhook channels",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved webhooks",
            _ => "Failed to load webhook channels",
        };

        return _localizer.GetString(key, fallback);
    }

    private bool HasContent() =>
        _state is WebhookChannelsState.Loaded
            or WebhookChannelsState.Stale
            or WebhookChannelsState.Offline
            or WebhookChannelsState.Empty;

    private WebhookChannelsDisplay Project() =>
        WebhookChannelsProjection.Project(_webhooks, _state, _localizer);

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

    private void RaiseToast(string message, bool isError = false) =>
        ToastRequested?.Invoke(this, new WebhookChannelsToast(message, isError));

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
