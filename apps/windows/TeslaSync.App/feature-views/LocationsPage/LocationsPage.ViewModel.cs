using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>LocationsPage</c> view — the native port of the web page's
/// data flow (web/src/features/maps/pages/LocationsPage.tsx). It reads one page of visited locations through the
/// injected <see cref="ILocationsFeed"/> (the native <c>useQuery(['visited-locations', …])</c> hook), projects
/// it through <see cref="LocationsProjection"/> with the active units, and surfaces the four web data states
/// (loading / empty / error / success) plus the header freshness flags so the view is a thin renderer. It owns
/// the two view controls the web page owns: the client-side <see cref="Search"/> address filter (re-projects
/// without a refetch) and the current <see cref="Page"/> (a page change refetches). Observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class LocationsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocationsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly LocationsDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private LocationsSnapshot _snapshot = LocationsSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;
    private string _search = string.Empty;
    private int _page = 1;

    private LocationsState _state = LocationsState.Loading;
    private LocationsDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The visited-locations data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LocationsPageViewModel(
        ILocationsFeed feed,
        ILocalizer localizer,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        LocationsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new LocationsDiagnostics();
        _display = LocationsProjection.Project(BuildModel(), _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public LocationsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public LocationsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('Visited Locations')</c>).</summary>
    public string Title => LocationsRegistration.Title(_localizer);

    /// <summary>The current page (1-based). Reassign through <see cref="GoToPageAsync"/> to refetch.</summary>
    public int Page => _page;

    /// <summary>The address search query; reassigning re-projects the current page without a refetch.</summary>
    public string Search
    {
        get => _search;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_search, next, StringComparison.Ordinal))
            {
                return;
            }

            _search = next;
            Reproject();
        }
    }

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
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the visited-locations load for the current page and fold the result into state.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            int offset = (_page - 1) * LocationsModel.DefaultPageSize;
            var snapshot = await _feed.FetchAsync(offset, LocationsModel.DefaultPageSize, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasData;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            SetError(ex.Message);
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Navigate to <paramref name="page"/> (1-based) and reload that page (web <c>onPageChange</c>).</summary>
    public Task GoToPageAsync(int page, CancellationToken cancellationToken = default)
    {
        int next = Math.Max(1, page);
        if (next == _page)
        {
            return Task.CompletedTask;
        }

        _page = next;
        _hasData = false;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Refresh the current page (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = LocationsSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private LocationsModel BuildModel() =>
        new(_snapshot, _loading, _errorDetail, _search, _page, LocationsModel.DefaultPageSize);

    private void Reproject()
    {
        var display = LocationsProjection.Project(BuildModel(), _units, _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
