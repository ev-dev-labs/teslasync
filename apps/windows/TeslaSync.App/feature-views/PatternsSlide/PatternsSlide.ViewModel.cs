using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PatternsSlide"/> view — the native port of the
/// web component's data composition (web/src/features/analytics/components/review/PatternsSlide.tsx, which
/// receives the resolved <c>YearReview</c> as a prop and reads <c>useTranslation</c> + <c>useUnits</c>). It
/// consumes the cache-then-network <see cref="IPatternsSlideSource"/>, projects each snapshot through
/// <see cref="PatternsSlideProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PatternsSlideViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPatternsSlideSource _source;
    private readonly ILocalizer _localizer;
    private readonly int _year;
    private readonly Func<DateTimeOffset> _clock;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<YearReviewPatterns>? _last;
    private bool _disposed;

    private PatternsSlideState _state = PatternsSlideState.Loading;
    private PatternsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, review year, units and (optional) clock.</summary>
    public PatternsSlideViewModel(
        IPatternsSlideSource source,
        ILocalizer localizer,
        int year,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _year = year;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = PatternsSlideProjection.Project(YearReviewPatterns.Empty, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public PatternsSlideState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (heading, hero rows and stat columns).</summary>
    public PatternsDisplay Display
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

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error surface.</summary>
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

    /// <summary>True when the snapshot carries the year's driving patterns.</summary>
    public bool HasData => _display.HasData;

    /// <summary>The review year the surface is scoped to.</summary>
    public int Year => _year;

    /// <summary>Localized slide heading (web <c>yearReview.drivingPatterns</c>), used as the accessible name.</summary>
    public string Title => _localizer.GetString(PatternsSlideProjection.HeadingKey, "Your driving patterns");

    /// <summary>Localized empty-state title (web <c>yearReview.title</c>).</summary>
    public string EmptyTitle => _localizer.GetString("translation.yearReview.title", "Year in Review");

    /// <summary>Localized empty-state message (no year-review data for the year).</summary>
    public string EmptyMessage => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("translation.yearReview.noData", "No driving data for {0}"),
        _year);

    /// <summary>Localized loading announcement (web <c>yearReview.loading</c>).</summary>
    public string LoadingLabel =>
        _localizer.GetString("translation.yearReview.loading", "Building your year in review\u2026");

    /// <summary>Localized retry affordance label (web <c>common.retry</c>).</summary>
    public string RetryLabel => _localizer.GetString("translation.common.retry", "Retry");

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is PatternsSlideState.Loaded or PatternsSlideState.Stale or PatternsSlideState.Offline;

    private void Apply(RepositoryResult<YearReviewPatterns> result)
    {
        _last = result;
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
        YearReviewPatterns snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = PatternsSlideProjection.Project(snapshot, _units, _localizer);
        Display = display;

        if (!snapshot.HasData)
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
            ? PatternsSlideState.Offline
            : stale ? PatternsSlideState.Stale : PatternsSlideState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = PatternsSlideProjection.Project(YearReviewPatterns.Empty, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = PatternsSlideState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = PatternsSlideProjection.Project(YearReviewPatterns.Empty, _units, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = PatternsSlideState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = PatternsSlideState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "translation.yearReview.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "translation.yearReview.error.offline",
            _ => "translation.yearReview.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your year in review",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached year in review",
            _ => "Couldn't load your year in review",
        };

        return _localizer.GetString(key, fallback);
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
