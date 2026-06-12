using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PresetGalleryView"/> view — the native port of the web
/// component's data composition (web/src/features/automations/pages/PresetGallery.tsx, which reads
/// <c>useAutomationPresets(category)</c>, <c>useTranslation</c> and <c>useNavigate</c>). It consumes the
/// cache-then-network <see cref="IPresetGallerySource"/>, projects each preset list through
/// <see cref="PresetGalleryProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// freshness flags so the view is a thin renderer. A list with no presets at all classifies as
/// <see cref="PresetGalleryState.Empty"/> (web <c>presets.length === 0</c>). The Install action is dispatched
/// through the bound <see cref="IPresetGalleryNavigator"/> (web <c>navigate(`/automations/new?preset=…`)</c>).
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PresetGalleryViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<AutomationPresetRow> NoPresets = Array.Empty<AutomationPresetRow>();

    private readonly IPresetGallerySource _source;
    private readonly IPresetGalleryNavigator _navigator;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private PresetGalleryState _state = PresetGalleryState.Loading;
    private PresetGalleryDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, navigation port, localizer and (optional) clock.</summary>
    /// <param name="source">The cache-then-network preset data port.</param>
    /// <param name="navigator">The navigation port the Install action is dispatched through.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">An injectable clock (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public PresetGalleryViewModel(
        IPresetGallerySource source,
        IPresetGalleryNavigator navigator,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _navigator = navigator;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = PresetGalleryProjection.Project(NoPresets, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public PresetGalleryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the preset cards).</summary>
    public PresetGalleryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
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

    /// <summary>True when there is at least one preset to show (gates the empty state).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (the preset-section heading; used as the accessible name).</summary>
    public string Title => _localizer.GetString(
        PresetGalleryRegistration.CatalogKey("automations.presets.title"), "Quick Start Templates");

    /// <summary>Localized empty-state message (no preset templates available — web <c>automations.presets.empty</c>).</summary>
    public string EmptyMessage =>
        _localizer.GetString(
            PresetGalleryRegistration.CatalogKey(PresetGalleryProjection.EmptyKey),
            PresetGalleryProjection.EmptyFallback);

    /// <summary>Localized loading announcement.</summary>
    public string LoadingLabel =>
        _localizer.GetString(
            PresetGalleryRegistration.CatalogKey("automations.presets.loading"), "Loading preset templates");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString(PresetGalleryRegistration.CatalogKey("common.retry"), "Retry");

    /// <summary>Localized refresh affordance label.</summary>
    public string RefreshLabel =>
        _localizer.GetString(
            PresetGalleryRegistration.CatalogKey("automations.presets.refresh"), "Refresh preset templates");

    /// <summary>Localized stale freshness chip label.</summary>
    public string StaleChipLabel => _localizer.GetString(PresetGalleryRegistration.CatalogKey("common.stale"), "Stale");

    /// <summary>Localized offline freshness chip label.</summary>
    public string OfflineChipLabel => _localizer.GetString(PresetGalleryRegistration.CatalogKey("common.offline"), "Offline");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the card skeletons only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load (e.g. on unload).</param>
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

    /// <summary>
    /// Install a preset: dispatch the navigation to the automation builder pre-filled with the preset, mirroring
    /// the web <c>navigate(`/automations/new?preset=${preset.id}`)</c>. A blank id is ignored.
    /// </summary>
    /// <param name="presetId">The preset id to deep-link into the builder.</param>
    public void Install(string presetId)
    {
        if (string.IsNullOrWhiteSpace(presetId))
        {
            return;
        }

        _navigator.OpenBuilder(PresetGalleryRegistration.BuildInstallTarget(presetId));
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
        _state is PresetGalleryState.Loaded or PresetGalleryState.Stale or PresetGalleryState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<AutomationPresetRow>> result)
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
        IReadOnlyList<AutomationPresetRow> presets,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = PresetGalleryProjection.Project(presets, _localizer);

        if (!Display.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? PresetGalleryState.Offline
            : stale ? PresetGalleryState.Stale : PresetGalleryState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = PresetGalleryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = PresetGalleryProjection.Project(NoPresets, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = PresetGalleryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = PresetGalleryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "automations.presets.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "automations.presets.error.offline",
            _ => "automations.presets.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view preset templates",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline \u2014 showing the last cached preset templates",
            _ => "Couldn't load preset templates",
        };

        return _localizer.GetString(PresetGalleryRegistration.CatalogKey(key), fallback);
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
