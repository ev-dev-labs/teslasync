using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SharedDrivePage</c> view — the native port of the web page's
/// data flow (web/src/features/sharing/pages/SharedDrivePage.tsx). It reads the public shared-drive snapshot for
/// one token through the injected <see cref="ISharedDrivePageFeed"/> (the native <c>useSharedDrive</c> hook),
/// projects it through <see cref="SharedDrivePageProjection"/> with the active units and clock, and surfaces the
/// three web data states (loading / unavailable / success) so the view is a thin renderer. Observable so the
/// view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class SharedDrivePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISharedDrivePageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SharedDrivePageDiagnostics _diagnostics;
    private readonly string _token;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SharedDriveSnapshot _snapshot = SharedDriveSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private SharedDriveState _state = SharedDriveState.Loading;
    private SharedDrivePageDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, share token, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The single-source shared-drive data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="token">The public share token from the route (web <c>:token</c> param).</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SharedDrivePageViewModel(
        ISharedDrivePageFeed feed,
        ILocalizer localizer,
        string token,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        SharedDrivePageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _token = token ?? string.Empty;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SharedDrivePageDiagnostics();
        _display = SharedDrivePageProjection.Project(BuildModel(), _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / unavailable / success).</summary>
    public SharedDriveState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SharedDrivePageDisplay Display
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

    /// <summary>True when the last load failed (the link is unavailable).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>The share token this holder is bound to.</summary>
    public string Token => _token;

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

    /// <summary>Run (or re-run) the shared-drive load and fold the result into the data state.</summary>
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
            var snapshot = await _feed.FetchAsync(_token, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasData;
            _errorDetail = null;
            _loading = false;
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
        Reproject();
    }

    /// <summary>Refresh the shared drive (web query refetch).</summary>
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
        _snapshot = SharedDriveSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private SharedDrivePageModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = SharedDrivePageProjection.Project(BuildModel(), _units, _localizer, _clock());
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
