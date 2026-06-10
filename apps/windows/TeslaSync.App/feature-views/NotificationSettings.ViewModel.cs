using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NotificationSettings"/> view — the native port of
/// the web NotificationSettings hook composition
/// (web/src/features/settings/components/NotificationSettings.tsx). It binds the four shared seams the web
/// component composes (OS permission, out-of-tab event prefs, browser-tab-signal settings and sound prefs),
/// owns the cache-then-network read of the tab-signal settings so the surface renders the full freshness state
/// matrix the P2 contract mandates, projects every change through <see cref="NotificationSettingsProjection"/>,
/// and exposes the action methods the view's toggles / button / slider invoke. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class NotificationSettingsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly INotificationTabSignalsSource _tabSource;
    private readonly INotificationPermissionGateway _permission;
    private readonly IWebPushPreferenceStore _pushStore;
    private readonly INotificationSoundPreferenceStore _soundStore;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private NotificationSettingsState _state = NotificationSettingsState.Loading;
    private NotificationSettingsDisplay _display;
    private NotificationTabSignals _tabSignals = NotificationTabSignals.Default;
    private bool _autoplayHintDismissed;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the four shared seams and the i18n facade.</summary>
    /// <param name="tabSource">The browser-tab-signals cache-then-network source (web <c>useSettings</c>).</param>
    /// <param name="permission">The OS notification-permission gateway (web <c>useWebPush</c>).</param>
    /// <param name="pushStore">The out-of-tab event-preference store (web <c>useNotificationListener</c>).</param>
    /// <param name="soundStore">The sound-preference store (web <c>useNotificationSoundPrefs</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public NotificationSettingsViewModel(
        INotificationTabSignalsSource tabSource,
        INotificationPermissionGateway permission,
        IWebPushPreferenceStore pushStore,
        INotificationSoundPreferenceStore soundStore,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(tabSource);
        ArgumentNullException.ThrowIfNull(permission);
        ArgumentNullException.ThrowIfNull(pushStore);
        ArgumentNullException.ThrowIfNull(soundStore);
        ArgumentNullException.ThrowIfNull(localizer);

        _tabSource = tabSource;
        _permission = permission;
        _pushStore = pushStore;
        _soundStore = soundStore;
        _localizer = localizer;

        _display = Project();

        _permission.StatusChanged += OnExternalChanged;
        _pushStore.Changed += OnExternalChanged;
        _soundStore.Changed += OnExternalChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface freshness state.</summary>
    public NotificationSettingsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (all three sections).</summary>
    public NotificationSettingsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful settings-read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background settings refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown settings snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the settings read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == NotificationSettingsState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of settings-read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The current OS notification-permission status.</summary>
    public NotificationPermissionStatus Permission => _permission.Status;

    /// <summary>The current browser-tab-signal preferences (optimistically updated on toggle).</summary>
    public NotificationTabSignals TabSignals => _tabSignals;

    /// <summary>The current out-of-tab event preferences.</summary>
    public WebPushPreferences PushPreferences => _pushStore.Current;

    /// <summary>The current per-channel sound preferences.</summary>
    public NotificationSoundPreferences SoundPreferences => _soundStore.Current;

    /// <summary>
    /// Run a cache-then-network read of the browser-tab settings: counts the attempt, shows the skeleton only
    /// when nothing is already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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
            await foreach (var result in _tabSource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the settings read from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Request OS notification permission (web <c>requestPermission</c>); reprojects on the result.</summary>
    public async Task RequestPermissionAsync(CancellationToken cancellationToken = default)
    {
        await _permission.RequestAsync(cancellationToken).ConfigureAwait(false);
        Raise(nameof(Permission));
        Reproject();
    }

    /// <summary>Toggle the "Alerts" out-of-tab event (web <c>setPushPrefs(alerts)</c>).</summary>
    public void SetAlerts(bool enabled) =>
        _pushStore.Update(_pushStore.Current with { Alerts = enabled });

    /// <summary>Toggle the "Export completions" out-of-tab event (web <c>setPushPrefs(exportStatus)</c>).</summary>
    public void SetExportStatus(bool enabled) =>
        _pushStore.Update(_pushStore.Current with { ExportStatus = enabled });

    /// <summary>Toggle the tab unread-count signal and persist it (web <c>updateTabSetting('tab_badge_enabled')</c>).</summary>
    public void SetTabBadge(bool enabled) => UpdateTabSignals(_tabSignals with { TabBadgeEnabled = enabled });

    /// <summary>Toggle the critical-flash signal and persist it (web <c>updateTabSetting('critical_flash_enabled')</c>).</summary>
    public void SetCriticalFlash(bool enabled) => UpdateTabSignals(_tabSignals with { CriticalFlashEnabled = enabled });

    /// <summary>Toggle the master sound gate (web <c>handleMasterToggle</c>).</summary>
    public void SetSoundMaster(bool enabled) => _soundStore.Update(_soundStore.Current.WithMaster(enabled));

    /// <summary>Toggle a single sound channel (web per-category <c>setNotificationSoundPrefs</c>).</summary>
    public void SetSoundCategory(NotificationSoundCategory category, bool enabled) =>
        _soundStore.Update(_soundStore.Current.WithCategory(category, enabled));

    /// <summary>Set the sound volume from a 0–100 percentage (web slider <c>onChange(next / 100)</c>).</summary>
    public void SetVolumePercent(int percent) =>
        _soundStore.Update(_soundStore.Current.WithVolume(percent / 100.0));

    /// <summary>
    /// Evaluate the "Test" cue for <paramref name="category"/> — the native port of the web
    /// <c>handleTestSound</c>: it forces the master + channel gates on (and floors a zero volume) so the cue is
    /// always allowed on demand, and returns whether playback is permitted so the view can emit the device cue.
    /// </summary>
    public NotificationSoundPlayResult TestSound(NotificationSoundCategory category)
    {
        var forced = NotificationSoundPlayback.TestOverride(_soundStore.Current, category);
        var result = NotificationSoundPlayback.Evaluate(forced, category);
        if (!result.Played && result.Reason == NotificationSoundPlayReason.Unavailable)
        {
            _autoplayHintDismissed = false;
            Reproject();
        }

        return result;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _permission.StatusChanged -= OnExternalChanged;
        _pushStore.Changed -= OnExternalChanged;
        _soundStore.Changed -= OnExternalChanged;

        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void UpdateTabSignals(NotificationTabSignals next)
    {
        if (_tabSignals == next)
        {
            return;
        }

        // Optimistic local update (web parity — the mutation surfaces its own toast); persist in the background.
        _tabSignals = next;
        Raise(nameof(TabSignals));
        Reproject();
        _ = SaveTabSignalsAsync(next);
    }

    private async Task SaveTabSignalsAsync(NotificationTabSignals signals)
    {
        try
        {
            await _tabSource.SaveAsync(signals).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Retain the optimistic value; the true server state is re-read the next time the surface loads.
        }
    }

    private void OnExternalChanged(object? sender, EventArgs e)
    {
        Raise(nameof(Permission));
        Raise(nameof(PushPreferences));
        Raise(nameof(SoundPreferences));
        Reproject();
    }

    private bool HasContent() =>
        _state is NotificationSettingsState.Loaded
            or NotificationSettingsState.Stale
            or NotificationSettingsState.Offline
            or NotificationSettingsState.Empty;

    private void Apply(RepositoryResult<NotificationTabSignals> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        NotificationTabSignals signals,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _tabSignals = signals;
        Raise(nameof(TabSignals));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? NotificationSettingsState.Offline
            : stale
                ? NotificationSettingsState.Stale
                : NotificationSettingsState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = NotificationSettingsState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _tabSignals = NotificationTabSignals.Default;
        Raise(nameof(TabSignals));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = NotificationSettingsState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = NotificationSettingsState.Error;
        RaiseError();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "settings.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "settings.error.offline",
            _ => "settings.error.load",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage notification settings",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved settings",
            _ => "Couldn't load notification settings",
        };

        return _localizer.GetString(key, fallback);
    }

    private NotificationSettingsDisplay Project() =>
        NotificationSettingsProjection.Project(
            _permission.Status,
            _pushStore.Current,
            _tabSignals,
            _soundStore.Current,
            _autoplayHintDismissed,
            _localizer);

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

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
