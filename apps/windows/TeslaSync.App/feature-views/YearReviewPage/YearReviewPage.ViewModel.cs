using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>YearReviewPage</c> view — the native port of the web page's
/// data flow (web/src/features/analytics/pages/YearReviewPage.tsx). It composes the two web hooks through the
/// injected <see cref="IYearReviewPageFeed"/>: <c>useVehicles()</c> (populating the selector and auto-selecting
/// the first vehicle when none is chosen, mirroring the web <c>useEffect</c>) and
/// <c>useYearReview(year, vehicleId)</c> (resolving the swipe-deck payload, enabled only once a vehicle is in
/// scope, mirroring the web <c>enabled: !!vehicleId</c>). It owns the swipe-deck slide index (web
/// <c>slideIndex</c> with <c>goNext</c> / <c>goPrev</c> clamping) and projects everything through
/// <see cref="YearReviewPageProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / success) plus the native error branch, observable via <see cref="PropertyChanged"/>.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class YearReviewPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IYearReviewPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly YearReviewPageDiagnostics _diagnostics;
    private readonly int _slideCount;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<YearReviewVehicleOption> _vehicles = Array.Empty<YearReviewVehicleOption>();
    private long? _selectedVehicleId;
    private YearReviewReport _report = YearReviewReport.Empty;
    private YearReviewSnapshot _slideData = YearReviewSnapshot.Empty;
    private bool _hasReport;
    private bool _hasError;
    private string? _errorDetail;
    private int _slideIndex;

    private YearReviewPageState _state = YearReviewPageState.Loading;
    private YearReviewPageDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, review year and (optional) diagnostics.</summary>
    /// <param name="feed">The vehicles + year-review data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="year">The route year (web <c>/year-review/:year</c>); defaults to the current calendar year.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public YearReviewPageViewModel(
        IYearReviewPageFeed feed,
        ILocalizer localizer,
        int? year = null,
        YearReviewPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new YearReviewPageDiagnostics();
        Year = year ?? DateTime.Now.Year;
        _slideCount = YearReviewSlideDeck.Count;
        _display = YearReviewPageProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The route year (web <c>year</c>).</summary>
    public int Year { get; }

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public YearReviewPageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public YearReviewPageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The active slide index (web <c>slideIndex</c>).</summary>
    public int SlideIndex => _slideIndex;

    /// <summary>The resolved year-review payload threaded into every hosted slide (web <c>data</c> prop).</summary>
    public YearReviewSnapshot SlideData => _slideData;

    /// <summary>The localized page title for the route year (web <c>usePageTitle</c>).</summary>
    public string Title => YearReviewPageRegistration.Title(_localizer, Year);

    /// <summary>The render model for the active slide (web <c>&lt;SlideRenderer slideIndex slide data /&gt;</c>).</summary>
    public SlideRenderModel CurrentSlideModel()
    {
        int index = Math.Clamp(_slideIndex, 0, Math.Max(_slideCount - 1, 0));
        return new SlideRenderModel(index, YearReviewSlideDeck.Slides[index], _slideData);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the full load: vehicles → auto-select → year review (web mount + Retry).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasReport)
        {
            Reproject();
        }

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _vehicles = vehicles;
            _hasError = false;
            _errorDetail = null;

            // web useEffect: auto-select the first vehicle when none is chosen (or the chosen one vanished).
            if (_selectedVehicleId is not { } selected || !ContainsVehicle(selected))
            {
                _selectedVehicleId = vehicles.Count > 0 ? vehicles[0].Id : null;
            }

            if (_selectedVehicleId is { } vehicleId)
            {
                await LoadReviewAsync(vehicleId, cts.Token).ConfigureAwait(false);
            }
            else
            {
                // web: useYearReview is disabled with no vehicle — the page stays on the loading surface.
                _report = YearReviewReport.Empty;
                _slideData = YearReviewSnapshot.Empty;
                _hasReport = false;
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            ApplyError(ex);
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the page (web query refetch / the error-branch Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Select a vehicle (web select <c>onChange</c>): record the choice, reset the deck to the first slide, and
    /// re-resolve the year review for the vehicle. A no-op when the id is already selected or unknown.
    /// </summary>
    public async Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (_selectedVehicleId == vehicleId || !ContainsVehicle(vehicleId))
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);

        _selectedVehicleId = vehicleId;
        _slideIndex = 0; // web setSlideIndex(0)
        IsFetching = true;
        Reproject();

        try
        {
            await LoadReviewAsync(vehicleId, cts.Token).ConfigureAwait(false);
            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            ApplyError(ex);
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Advance to the next slide, clamped to the last (web <c>goNext</c>).</summary>
    public void Next()
    {
        int next = Math.Min(_slideIndex + 1, Math.Max(_slideCount - 1, 0));
        if (next != _slideIndex)
        {
            _slideIndex = next;
            Reproject();
        }
    }

    /// <summary>Go back to the previous slide, clamped to the first (web <c>goPrev</c>).</summary>
    public void Prev()
    {
        int prev = Math.Max(_slideIndex - 1, 0);
        if (prev != _slideIndex)
        {
            _slideIndex = prev;
            Reproject();
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
        Cancel(ref _cts);
    }

    private async Task LoadReviewAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var report = await _feed.FetchYearReviewAsync(Year, vehicleId, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        _report = report;
        _slideData = YearReviewSnapshot.FromJson(report.Raw);
        _hasReport = report.HasReview;
    }

    private void ApplyError(Exception ex)
    {
        _hasError = true;
        _errorDetail = ex.Message;
        _hasReport = false;
        _report = YearReviewReport.Empty;
        _slideData = YearReviewSnapshot.Empty;
    }

    private bool ContainsVehicle(long id)
    {
        foreach (var vehicle in _vehicles)
        {
            if (vehicle.Id == id)
            {
                return true;
            }
        }

        return false;
    }

    private YearReviewPageModel BuildModel() => new(
        Year: Year,
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedVehicleId,
        Report: _report,
        HasReport: _hasReport,
        Loading: !_hasReport && !_hasError,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SlideCount: _slideCount,
        SlideIndex: _slideIndex);

    private void Reproject()
    {
        var display = YearReviewPageProjection.Project(BuildModel(), _localizer);
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
