// Admin / API Keys page — UI-thread-free state holder.
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="APIKeysPage"/> view — the native port of the web page's
/// hook composition (web/src/features/admin/pages/APIKeysPage.tsx). It owns the cache-then-network read of the API
/// key list (driving the loading / loaded / empty / stale / offline / error surface state), projects it through
/// <see cref="ApiKeysProjection"/>, and exposes the create / delete / revoke actions the toolbar, rows and modal
/// invoke. Create / delete / revoke surface a localized toast through <see cref="ToastRequested"/> (the web
/// <c>useMutationToast</c>); create additionally returns the one-time secret so the view can show the
/// "API Key Created" modal. Drive it from one confinement; state application is serialized internally.
/// </summary>
public sealed class ApiKeysPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IApiKeysSource _source;
    private readonly ILocalizer _localizer;
    private readonly ApiKeysDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private ApiKeysState _state = ApiKeysState.Loading;
    private ApiKeyList _keys = ApiKeyList.Empty;
    private ApiKeysDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the key source, the i18n facade and optional diagnostics/clock.</summary>
    /// <param name="source">The cache-then-network key source plus the create / delete / revoke mutations.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used for relative formatting + expiry (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public ApiKeysPageViewModel(
        IApiKeysSource source,
        ILocalizer localizer,
        ApiKeysDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ApiKeysDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient message for the toast surface (web <c>useMutationToast</c>).</summary>
    public event EventHandler<ApiKeysToast>? ToastRequested;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ApiKeysState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (chrome + rows).</summary>
    public ApiKeysDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current parsed key list.</summary>
    public ApiKeyList Keys => _keys;

    /// <summary>True when at least one key exists.</summary>
    public bool HasKeys => _keys.HasData;

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
    public bool IsError => _state == ApiKeysState.Error;

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

    /// <summary>Record the one-time <c>view.opened</c> diagnostic (web component mount).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run the cache-then-network key read: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> /
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
            await ConsumeAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this run silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the read from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Create a key (web <c>useCreateApiKey</c>): toasts the outcome, refreshes on success and returns the one-time
    /// secret so the view can show the "API Key Created" modal (null on failure).
    /// </summary>
    public async Task<CreatedApiKey?> CreateKeyAsync(string name, string permissions, CancellationToken cancellationToken = default)
    {
        try
        {
            var created = await _source.CreateAsync(name, permissions, cancellationToken).ConfigureAwait(false);
            RaiseToast(_localizer.GetString("apiKeys.toast.created", "API key created"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
            return created;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("apiKeys.toast.createError", "Failed to create API key"), isError: true);
            return null;
        }
    }

    /// <summary>Delete a key (web <c>useDeleteApiKey</c>); toasts the outcome and refreshes on success.</summary>
    public async Task DeleteKeyAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            await _source.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            RaiseToast(_localizer.GetString("apiKeys.toast.deleted", "API key deleted"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("apiKeys.toast.deleteError", "Failed to delete API key"), isError: true);
        }
    }

    /// <summary>Revoke a key (web <c>useRevokeApiKey</c>); toasts the outcome and refreshes on success.</summary>
    public async Task RevokeKeyAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            await _source.RevokeAsync(id, cancellationToken).ConfigureAwait(false);
            RaiseToast(_localizer.GetString("apiKeys.toast.revoked", "API key revoked"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("apiKeys.toast.revokeError", "Failed to revoke API key"), isError: true);
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
    }

    private async Task ConsumeAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _source.StreamApiKeysAsync(cancellationToken).ConfigureAwait(false))
        {
            ApplyApiKeys(result);
        }
    }

    private void ApplyApiKeys(RepositoryResult<ApiKeyList> result)
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
                    ApplySnapshot(result.Value ?? ApiKeyList.Empty, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                    break;

                default:
                    SetError(result.Error);
                    break;
            }
        }
    }

    private void ApplySnapshot(
        ApiKeyList keys,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _keys = keys;
        Raise(nameof(Keys));
        Raise(nameof(HasKeys));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? ApiKeysState.Offline
            : !keys.HasData
                ? ApiKeysState.Empty
                : stale
                    ? ApiKeysState.Stale
                    : ApiKeysState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = ApiKeysState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _keys = ApiKeyList.Empty;
        Raise(nameof(Keys));
        Raise(nameof(HasKeys));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = ApiKeysState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = ApiKeysState.Error;
        RaiseError();
        Reproject();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "apiKeys.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "apiKeys.error.offline",
            _ => "apiKeys.error.load",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage API keys",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved keys",
            _ => "Failed to load API keys",
        };

        return _localizer.GetString(key, fallback);
    }

    private bool HasContent() =>
        _state is ApiKeysState.Loaded
            or ApiKeysState.Stale
            or ApiKeysState.Offline
            or ApiKeysState.Empty;

    private ApiKeysDisplay Project() =>
        ApiKeysProjection.Project(_keys, _state, _localizer, _clock());

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

    private void RaiseToast(string message, bool isError = false) =>
        ToastRequested?.Invoke(this, new ApiKeysToast(message, isError));

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
