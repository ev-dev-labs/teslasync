using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SecretRotationPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/SecretRotationPage.tsx). It reads the rotation report through the injected
/// <see cref="ISecretRotationFeed"/> (web <c>useSecretRotation()</c>) and projects the result through
/// <see cref="SecretRotationProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) — with the HTTP 503 failure mapped to the distinct subsystem-unavailable
/// banner (web <c>subsystemMissing</c>) — plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SecretRotationPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISecretRotationFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SecretRotationDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _hasData;
    private IReadOnlyList<SecretRotationItem> _items = Array.Empty<SecretRotationItem>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _subsystemMissing;

    private SecretRotationState _state = SecretRotationState.Loading;
    private SecretRotationDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The secret-rotation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SecretRotationPageViewModel(
        ISecretRotationFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SecretRotationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SecretRotationDiagnostics();
        _display = SecretRotationProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SecretRotationState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SecretRotationDisplay Display
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

    /// <summary>The localized page title (web <c>admin.secretRotation.pageTitle</c>).</summary>
    public string Title => SecretRotationRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the secret-rotation load.</summary>
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
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _hasData = snapshot.HasData;
            _items = snapshot.Items;
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
            // web subsystemMissing: the rotation tracker is not configured (HTTP 503) — show the banner.
            _subsystemMissing = true;
            _hasError = false;
            _hasData = false;
            _items = Array.Empty<SecretRotationItem>();
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (Exception ex)
        {
            // Any other failure: surface the generic InfoBar + Retry surface.
            _hasError = true;
            _subsystemMissing = false;
            _hasData = false;
            _items = Array.Empty<SecretRotationItem>();
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the report (web query refetch / Retry).</summary>
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

    private SecretRotationModel BuildModel() => new(
        HasData: _hasData,
        Items: _items,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SubsystemMissing: _subsystemMissing);

    private void Reproject()
    {
        var display = SecretRotationProjection.Project(BuildModel(), _localizer, _clock());
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
