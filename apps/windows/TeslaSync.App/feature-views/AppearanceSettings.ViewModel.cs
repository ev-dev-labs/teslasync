using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AppearanceSettings"/> view — the native port of
/// the web <c>AppearanceSettings</c> component
/// (web/src/features/settings/components/AppearanceSettings.tsx). It binds the cache-then-network
/// <see cref="IAppearanceSettingsSource"/> (the web <c>useSettings</c> read) and the client-only
/// <see cref="IAppearanceLocalPreferences"/> (the web localStorage hooks), projects both through
/// <see cref="AppearanceSettingsProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus
/// the freshness flags so the view is a thin renderer. The three server-driven preferences save through the
/// web full-replace pattern (<see cref="SetDensityAsync"/> / <see cref="SetTimeFormatAsync"/> /
/// <see cref="SetChartPaletteAsync"/>) with an optimistic update that reverts on failure; the local
/// preferences mutate synchronously (sidebar style, status-bar prefs, celebration prefs). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AppearanceSettingsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAppearanceSettingsSource _source;
    private readonly IAppearanceLocalPreferences _preferences;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private AppearanceSettingsState _state = AppearanceSettingsState.Loading;
    private AppearanceServerSettings _serverSettings = AppearanceServerSettings.Default;
    private AppearanceLocalPreferences _localPreferences;
    private AppearanceSettingsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isSaving;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its server-settings source, local-preference store and localizer.</summary>
    /// <param name="source">The cache-then-network server-settings source (read + full-replace save).</param>
    /// <param name="preferences">The per-device local-preference store (sidebar / status bar / celebration).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public AppearanceSettingsViewModel(
        IAppearanceSettingsSource source,
        IAppearanceLocalPreferences preferences,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _preferences = preferences;
        _localizer = localizer;
        _localPreferences = preferences.Load().Normalized();
        _display = AppearanceSettingsProjection.Project(
            _serverSettings, _localPreferences, serverControlsEnabled: false, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient message for the toast surface (web <c>useToast</c>).</summary>
    public event EventHandler<string>? ToastRequested;

    /// <summary>
    /// Raised when the user invokes a product-tour action (web <c>startTour</c> / <c>resetAllTours</c>). The
    /// host wires this to its onboarding-tour engine; the surface only owns the controls and the feedback.
    /// </summary>
    public event EventHandler<TourAction>? TourActionRequested;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AppearanceSettingsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (every section).</summary>
    public AppearanceSettingsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current parsed server-side appearance settings (density / time format / chart palette).</summary>
    public AppearanceServerSettings ServerSettings => _serverSettings;

    /// <summary>The current per-device local preferences (sidebar / status bar / celebration).</summary>
    public AppearanceLocalPreferences LocalPreferences => _localPreferences;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background settings refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown settings document is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a server-settings save is in flight (the web <c>saveSettings.isPending</c>).</summary>
    public bool IsSaving
    {
        get => _isSaving;
        private set
        {
            if (Set(ref _isSaving, value))
            {
                Raise(nameof(ServerControlsEnabled));
            }
        }
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>
    /// True when the three server-driven choice groups are interactive — the settings document has resolved
    /// (loaded / empty / stale / offline) and no save is in flight (the web
    /// <c>disabled={!settings || saveSettings.isPending}</c> gate). The local-preference controls ignore this.
    /// </summary>
    public bool ServerControlsEnabled => HasContent() && !_isSaving;

    /// <summary>Localized surface title (Narrator name / host chrome).</summary>
    public string Title => AppearanceSettingsRegistration.Name(_localizer);

    /// <summary>
    /// Run a cache-then-network settings load: counts the attempt, shows the skeleton only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
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
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Save the density preference (web <c>setDensity</c>: full-replace merge of <c>ui_density</c>).</summary>
    public Task SetDensityAsync(DensityChoice value, CancellationToken cancellationToken = default) =>
        _serverSettings.Density == value
            ? Task.CompletedTask
            : SaveServerAsync(_serverSettings.WithDensity(value), cancellationToken);

    /// <summary>Save the time-format preference (web <c>setTimeFormat</c>: merge of <c>time_format_default</c>).</summary>
    public Task SetTimeFormatAsync(TimeFormatChoice value, CancellationToken cancellationToken = default) =>
        _serverSettings.TimeFormat == value
            ? Task.CompletedTask
            : SaveServerAsync(_serverSettings.WithTimeFormat(value), cancellationToken);

    /// <summary>Save the chart-palette preference (web <c>setChartPalette</c>: merge of <c>chart_palette</c>).</summary>
    public Task SetChartPaletteAsync(ChartPaletteChoice value, CancellationToken cancellationToken = default) =>
        _serverSettings.ChartPalette == value
            ? Task.CompletedTask
            : SaveServerAsync(_serverSettings.WithChartPalette(value), cancellationToken);

    /// <summary>Set the per-device sidebar style (web <c>setSidebarStyle</c>: instant, local).</summary>
    public void SetSidebarStyle(SidebarStyleChoice value)
    {
        if (_localPreferences.SidebarStyle == value)
        {
            return;
        }

        UpdateLocal(_localPreferences with { SidebarStyle = value });
    }

    /// <summary>
    /// Toggle the footer status bar (web <c>setStatusBarPrefs({ enabled })</c>), raising the shown / hidden
    /// toast the web fires.
    /// </summary>
    public void SetStatusBarEnabled(bool enabled)
    {
        if (_localPreferences.StatusBarEnabled == enabled)
        {
            return;
        }

        UpdateLocal(_localPreferences with { StatusBarEnabled = enabled });
        RaiseToast(enabled
            ? _localizer.GetString("theme.statusBar.shownToast", "Status bar shown")
            : _localizer.GetString("theme.statusBar.hiddenToast", "Status bar hidden"));
    }

    /// <summary>Toggle the always-icon-only status-bar preference (web <c>setStatusBarPrefs({ iconOnly })</c>).</summary>
    public void SetStatusBarIconOnly(bool iconOnly)
    {
        if (_localPreferences.StatusBarIconOnly == iconOnly)
        {
            return;
        }

        UpdateLocal(_localPreferences with { StatusBarIconOnly = iconOnly });
    }

    /// <summary>Toggle the celebration-toast preference (web <c>setAchievementCelebrationPrefs({ showToasts })</c>).</summary>
    public void SetCelebrationShowToasts(bool value)
    {
        if (_localPreferences.CelebrationShowToasts == value)
        {
            return;
        }

        UpdateLocal(_localPreferences with { CelebrationShowToasts = value });
    }

    /// <summary>Toggle the celebration-sound preference (web <c>setAchievementCelebrationPrefs({ playSound })</c>).</summary>
    public void SetCelebrationPlaySound(bool value)
    {
        if (_localPreferences.CelebrationPlaySound == value)
        {
            return;
        }

        UpdateLocal(_localPreferences with { CelebrationPlaySound = value });
    }

    /// <summary>Toggle the dashboard recently-unlocked preference (web <c>setAchievementCelebrationPrefs({ showOnDashboard })</c>).</summary>
    public void SetCelebrationShowOnDashboard(bool value)
    {
        if (_localPreferences.CelebrationShowOnDashboard == value)
        {
            return;
        }

        UpdateLocal(_localPreferences with { CelebrationShowOnDashboard = value });
    }

    /// <summary>Toggle the achievement-push preference (web <c>setAchievementCelebrationPrefs({ pushOnUnlock })</c>).</summary>
    public void SetCelebrationPushOnUnlock(bool value)
    {
        if (_localPreferences.CelebrationPushOnUnlock == value)
        {
            return;
        }

        UpdateLocal(_localPreferences with { CelebrationPushOnUnlock = value });
    }

    /// <summary>
    /// Invoke a product-tour action (web <c>startTour</c> / <c>resetAllTours</c>). Forwards the action to the
    /// host's tour engine via <see cref="TourActionRequested"/>; the reset also fires the success toast the
    /// web shows.
    /// </summary>
    public void InvokeTour(TourAction action)
    {
        TourActionRequested?.Invoke(this, action);
        if (action == TourAction.ResetAll)
        {
            RaiseToast(_localizer.GetString(
                "settings.tours.resetDone",
                "All tours reset \u2014 they will play next time you open the matching page"));
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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is AppearanceSettingsState.Loaded
            or AppearanceSettingsState.Empty
            or AppearanceSettingsState.Stale
            or AppearanceSettingsState.Offline;

    private void Apply(RepositoryResult<AppearanceServerSettings> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        AppearanceServerSettings settings,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _serverSettings = settings;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? OfflineMessage(error) : null;

        // Freshness wins over emptiness so the stale / offline chip survives, while a fresh document is
        // simply Loaded (the full form always renders for these states).
        State = offline
            ? AppearanceSettingsState.Offline
            : stale
                ? AppearanceSettingsState.Stale
                : AppearanceSettingsState.Loaded;

        Reproject();
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = AppearanceSettingsState.Loading;
        Reproject();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // An empty settings document falls back to defaults; the full form still renders and is writable
        // (the web treats an empty `{}` settings object as truthy, so the controls stay enabled).
        _serverSettings = AppearanceServerSettings.Default;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AppearanceSettingsState.Empty;
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AppearanceSettingsState.Error;
        Reproject();
    }

    private async Task SaveServerAsync(AppearanceServerSettings next, CancellationToken cancellationToken)
    {
        var previous = _serverSettings;
        _serverSettings = next;          // optimistic
        ErrorMessage = null;
        IsSaving = true;
        Reproject();

        try
        {
            _serverSettings = await _source.SaveAsync(next, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _serverSettings = previous;
        }
        catch (Exception)
        {
            _serverSettings = previous;
            var message = _localizer.GetString("theme.saveError", "Couldn't save appearance settings");
            ErrorMessage = message;
            RaiseToast(message);
        }
        finally
        {
            IsSaving = false;
            Reproject();
        }
    }

    private void UpdateLocal(AppearanceLocalPreferences next)
    {
        _localPreferences = next.Normalized();
        _preferences.Save(_localPreferences);
        Raise(nameof(LocalPreferences));
        Reproject();
    }

    private void Reproject() =>
        Display = AppearanceSettingsProjection.Project(
            _serverSettings, _localPreferences, ServerControlsEnabled, _localizer);

    private string OfflineMessage(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => _localizer.GetString(
            "theme.error.auth", "Sign in to manage appearance settings"),
        _ => _localizer.GetString(
            "theme.error.offline", "You're offline \u2014 showing your last saved appearance settings"),
    };

    private string ErrorTextFor(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => _localizer.GetString(
            "theme.error.auth", "Sign in to manage appearance settings"),
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
            "theme.error.offline", "You're offline \u2014 showing your last saved appearance settings"),
        _ => _localizer.GetString("theme.error", "Couldn't load appearance settings"),
    };

    private void RaiseToast(string message) => ToastRequested?.Invoke(this, message);

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
