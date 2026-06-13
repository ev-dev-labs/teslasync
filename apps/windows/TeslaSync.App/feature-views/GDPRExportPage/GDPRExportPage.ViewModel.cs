using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>GDPRExportPage</c> view — the native port of the web page's data
/// flow (web/src/features/admin/pages/GDPRExportPage.tsx). It owns the URL-equivalent state (the <c>idInput</c> text and
/// the submitted <c>activeId</c>) and reads the looked-up artifact through the injected <see cref="IGDPRExportFeed"/>,
/// projecting the result through <see cref="GDPRExportProjection"/> so the view is a thin renderer. It surfaces the
/// web data states (loading / empty / error / success) — with the HTTP-503 failure mapped to the distinct
/// subsystem-unavailable banner (web <c>subsystemMissing</c>) and the HTTP-404 failure mapped to the not-found banner
/// (web <c>notFound</c>) — plus an in-flight flag; observable so the view re-renders on <see cref="PropertyChanged"/>.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GDPRExportPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGDPRExportFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly GDPRExportDiagnostics _diagnostics;

    private CancellationTokenSource? _loadCts;
    private bool _disposed;

    private string _idInput = string.Empty;
    private string _activeId = string.Empty;
    private bool _loading;
    private GDPRArtifact? _artifact;
    private bool _hasError;
    private string? _errorDetail;
    private bool _subsystemMissing;
    private bool _notFound;

    private GDPRExportState _state = GDPRExportState.Empty;
    private GDPRExportDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The GDPR-export data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GDPRExportPageViewModel(
        IGDPRExportFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        GDPRExportDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new GDPRExportDiagnostics();
        _display = GDPRExportProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public GDPRExportState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public GDPRExportDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a lookup is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>admin.gdprExport.pageTitle</c>).</summary>
    public string Title => GDPRExportRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Update the lookup input text (web <c>setIdInput</c>); re-projects so the button enables/disables live.</summary>
    public void SetIdInput(string value)
    {
        var next = value ?? string.Empty;
        if (string.Equals(_idInput, next, StringComparison.Ordinal))
        {
            return;
        }

        _idInput = next;
        Reproject();
    }

    /// <summary>Submit the current input as the active artifact id and load it (web <c>handleLookup</c>).</summary>
    public Task LookupAsync(CancellationToken cancellationToken = default)
    {
        _activeId = _idInput.Trim();
        return LoadAsync(cancellationToken);
    }

    /// <summary>Run (or re-run) the lookup for the current active id (web <c>useGDPRExport(activeId)</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_activeId))
        {
            // web: the query is disabled until an id is submitted — show the "no artifact selected" empty surface.
            CancelLoad();
            _loading = false;
            _artifact = null;
            _hasError = false;
            _subsystemMissing = false;
            _notFound = false;
            _errorDetail = null;
            IsFetching = false;
            Reproject();
            return;
        }

        var cts = Supersede(ref _loadCts, cancellationToken);

        IsFetching = true;
        _loading = true;
        _artifact = null;
        _hasError = false;
        _subsystemMissing = false;
        _notFound = false;
        _errorDetail = null;
        Reproject();

        try
        {
            var artifact = await _feed.FetchAsync(_activeId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            if (artifact is null)
            {
                _notFound = true;
            }
            else
            {
                _artifact = artifact;
            }

            _hasError = false;
            _subsystemMissing = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex) when (ex.StatusCode == 503)
        {
            // web subsystemMissing: the GDPR export subsystem is not configured (HTTP 503) — show the banner.
            _subsystemMissing = true;
            _hasError = false;
            _notFound = false;
            _artifact = null;
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (ApiException ex) when (ex.StatusCode == 404)
        {
            // web notFound: no artifact with that id exists, or it has been purged (HTTP 404).
            _notFound = true;
            _hasError = false;
            _subsystemMissing = false;
            _artifact = null;
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (Exception ex)
        {
            // Any other failure: surface the generic InfoBar + Retry surface.
            _hasError = true;
            _subsystemMissing = false;
            _notFound = false;
            _artifact = null;
            _errorDetail = ex.Message;
            _loading = false;
        }

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Re-run the current lookup (web <c>query.refetch</c> / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancelLoad();
    }

    private GDPRExportModel BuildModel() => new(
        IdInput: _idInput,
        ActiveId: _activeId,
        Loading: _loading,
        Artifact: _artifact,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SubsystemMissing: _subsystemMissing,
        NotFound: _notFound);

    private void Reproject()
    {
        var display = GDPRExportProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private void CancelLoad() => Cancel(ref _loadCts);

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
