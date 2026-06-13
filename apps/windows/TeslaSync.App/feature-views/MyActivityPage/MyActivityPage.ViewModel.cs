using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MyActivityPage"/> view — the native port of the web
/// page's single-hook data flow (web/src/features/system/pages/MyActivityPage.tsx). It owns the URL-equivalent
/// date window (web <c>start</c> / <c>end</c> URL state), reads one window through the injected
/// <see cref="IMyActivitySource"/>, classifies the outcome into the six mutually-exclusive
/// <see cref="MyActivityState"/> branches the web page renders (loading / disabled / unauthorized / error /
/// empty / loaded — mapping <c>apiError.status</c> 503 → disabled and 401 → unauthorized exactly as the web
/// page does), and projects each result through <see cref="MyActivityProjection"/> so the view is a thin
/// renderer. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class MyActivityPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMyActivitySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly MyActivityDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<UserActivityEntry> _entries = Array.Empty<UserActivityEntry>();
    private string? _errorDetail;
    private DateRange _range;

    private MyActivityState _state = MyActivityState.Loading;
    private MyActivityDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="source">The activity data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for the deterministic default window in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MyActivityPageViewModel(
        IMyActivitySource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        MyActivityDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new MyActivityDiagnostics();

        DateOnly today = DateOnly.FromDateTime(_clock().LocalDateTime);
        _range = new DateRange(today.AddDays(-(MyActivityRegistration.DefaultWindowDays - 1)), today);

        _display = MyActivityProjection.Project(_entries, _state, _errorDetail, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive lifecycle state.</summary>
    public MyActivityState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public MyActivityDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the web <c>isFetching</c> flag).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The active date window (web <c>start</c> / <c>end</c> URL state) the picker echoes.</summary>
    public DateRange Range => _range;

    /// <summary>The localized page title (web <c>activity.myActivity.title</c>).</summary>
    public string Title => MyActivityRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>activity.myActivity.subtitle</c>).</summary>
    public string Subtitle => MyActivityRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the activity load for the current window. Shows the loading state only when nothing is
    /// already resolved (otherwise keeps content while refreshing), classifies the outcome into the six web
    /// branches, and folds it into <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the
    /// prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the load resolves (or is superseded).</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

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
            var entries = await _source.FetchAsync(BuildQuery(), cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _entries = entries ?? Array.Empty<UserActivityEntry>();
            _errorDetail = null;
            _state = _entries.Count == 0 ? MyActivityState.Empty : MyActivityState.Loaded;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            // web: apiError.status === 503 → featureDisabled, 401 → unauthenticated, else → generic error.
            _entries = Array.Empty<UserActivityEntry>();
            _errorDetail = ex.Message;
            _state = Classify(ex);
        }
        catch (Exception ex)
        {
            _entries = Array.Empty<UserActivityEntry>();
            _errorDetail = ex.Message;
            _state = MyActivityState.Error;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current window (web auto-refetch / the error notice's retry action).</summary>
    /// <param name="cancellationToken">Cancels this refresh.</param>
    /// <returns>A task that completes when the refresh resolves.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Apply a new date window (web <c>RangePicker.onChange</c> → <c>setRangeBatch</c>). A new window is a fresh
    /// query, so the resolved rows are dropped and the loading state is shown until the new window resolves.
    /// </summary>
    /// <param name="range">The new committed window.</param>
    /// <param name="cancellationToken">Cancels the reload.</param>
    /// <returns>A task that completes when the reloaded window resolves.</returns>
    public Task SetRangeAsync(DateRange range, CancellationToken cancellationToken = default)
    {
        _range = range;
        _entries = Array.Empty<UserActivityEntry>();
        SetLoading();
        return LoadAsync(cancellationToken);
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

    private static MyActivityState Classify(ApiException ex) => ex.StatusCode switch
    {
        503 => MyActivityState.Disabled,
        401 => MyActivityState.Unauthorized,
        _ => MyActivityState.Error,
    };

    private bool HasContent() => _state is MyActivityState.Loaded or MyActivityState.Empty;

    private MyActivityQuery BuildQuery() => new(
        MyActivityRegistration.IsoDate(_range.Start),
        MyActivityRegistration.IsoDate(_range.End),
        MyActivityRegistration.ActivityLimit);

    private void SetLoading()
    {
        IsFetching = false;
        _state = MyActivityState.Loading;
        Reproject();
    }

    private void Reproject()
    {
        Display = MyActivityProjection.Project(_entries, _state, _errorDetail, _localizer);
        State = _state;
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
