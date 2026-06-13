using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ActiveSessionsPage</c> view — the native port of the web data flow
/// (web/src/features/settings/components/ActiveSessionsSection.tsx). It reads the sessions list through the injected
/// <see cref="IActiveSessionsFeed"/> (web <c>useSessions</c>), owns the per-row + all-others revoke flows (web
/// <c>useRevokeSession</c> / <c>useRevokeAllOtherSessions</c>) and projects the result through
/// <see cref="ActiveSessionsProjection"/> so the view is a thin renderer. It surfaces the five web/native data states
/// (loading / open-mode / error / empty / populated) plus the in-flight revoke flags; observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class ActiveSessionsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IActiveSessionsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly ActiveSessionsDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SessionsMode? _mode;
    private IReadOnlyList<ActiveSession> _sessions = Array.Empty<ActiveSession>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string? _revokingId;
    private bool _revokingAllOthers;
    private bool _hasLoaded;

    private ActiveSessionsState _state = ActiveSessionsState.Loading;
    private ActiveSessionsDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ActiveSessionsPageViewModel(
        IActiveSessionsFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        ActiveSessionsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new ActiveSessionsDiagnostics();
        _display = ActiveSessionsProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / open-mode / error / empty / populated).</summary>
    public ActiveSessionsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ActiveSessionsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the list is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>account.sessions.title</c>) — the PageContainer chrome.</summary>
    public string Title => ActiveSessionsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>account.sessions.subtitle</c>) — the PageContainer chrome.</summary>
    public string Subtitle => ActiveSessionsRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the sessions list load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _mode = snapshot.Mode;
            _sessions = snapshot.Sessions ?? Array.Empty<ActiveSession>();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error: surface the failure panel so the section never renders a blank table with no explanation.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _mode = null;
            _sessions = Array.Empty<ActiveSession>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the list (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Revoke a single session (web <c>useRevokeSession</c>). On success the list reloads so the row disappears (web
    /// <c>onSuccess</c> invalidate); on failure the list is left intact so the user can retry (web surfaces a toast).
    /// </summary>
    public async Task RevokeAsync(string id, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(id);
        if (_revokingId is not null || _revokingAllOthers)
        {
            return;
        }

        _revokingId = id;
        Reproject();

        try
        {
            await _feed.RevokeAsync(id, cancellationToken).ConfigureAwait(false);
            _revokingId = null;
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _revokingId = null;
            Reproject();
        }
        catch (Exception)
        {
            // web onError raises a toast and leaves the list intact; the row stays so the user retries.
            _revokingId = null;
            Reproject();
        }
    }

    /// <summary>
    /// Revoke every other session (web <c>useRevokeAllOtherSessions</c>). On success the list reloads; on failure the
    /// list is left intact (web surfaces a toast).
    /// </summary>
    public async Task RevokeAllOthersAsync(CancellationToken cancellationToken = default)
    {
        if (_revokingAllOthers || _revokingId is not null)
        {
            return;
        }

        _revokingAllOthers = true;
        Reproject();

        try
        {
            _ = await _feed.RevokeAllOthersAsync(cancellationToken).ConfigureAwait(false);
            _revokingAllOthers = false;
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _revokingAllOthers = false;
            Reproject();
        }
        catch (Exception)
        {
            _revokingAllOthers = false;
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

    private ActiveSessionsModel BuildModel() => new(
        Mode: _mode,
        Sessions: _sessions,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        RevokingId: _revokingId,
        RevokingAllOthers: _revokingAllOthers,
        Now: _clock());

    private void Reproject()
    {
        var display = ActiveSessionsProjection.Project(BuildModel(), _localizer);
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
