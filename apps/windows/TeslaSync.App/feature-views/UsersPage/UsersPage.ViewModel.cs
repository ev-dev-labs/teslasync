using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>UsersPage</c> view — the native port of the web data flow
/// (web/src/features/admin/pages/UsersPage.tsx). It reads the impersonation status through the injected
/// <see cref="IImpersonationSubjectsFeed"/> (web <c>useImpersonationStatus</c>) and, when forward-auth is enabled
/// (web <c>enabled: !open</c>), the candidate subjects (web <c>useImpersonationCandidates</c>), then projects the
/// result through <see cref="UsersProjection"/> so the view is a thin renderer. It surfaces the five web/native render
/// branches (open-mode / loading / error / empty / populated) and the active-impersonation flag that disables the
/// per-row actions; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class UsersPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IImpersonationSubjectsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly UsersPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private UsersImpersonationStatus? _status;
    private ImpersonationSubjectsMode? _candidatesMode;
    private IReadOnlyList<ImpersonationCandidate> _candidates = Array.Empty<ImpersonationCandidate>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _hasLoaded;

    private UsersPageState _state = UsersPageState.Loading;
    private UsersDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The status + candidates data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public UsersPageViewModel(
        IImpersonationSubjectsFeed feed,
        ILocalizer localizer,
        UsersPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new UsersPageDiagnostics();
        _display = UsersProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level render branch (open-mode / loading / error / empty / populated).</summary>
    public UsersPageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public UsersDisplay Display
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

    /// <summary>The localized page title (web <c>impersonation.users.title</c>) — the PageContainer chrome.</summary>
    public string Title => UsersPageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>impersonation.users.subtitle</c>) — the PageContainer chrome.</summary>
    public string Subtitle => UsersPageRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the status + candidates load. Mirrors the web flow: read the status first; if it reports open
    /// mode the candidates query is skipped (web <c>enabled: !open</c>) and the open-mode notice shows; otherwise the
    /// candidates query drives the loading / error / empty / populated branches.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        // 1) Status (web useImpersonationStatus). A transport fault is invisible to the page (web parity), so a
        //    failure resolves to Inactive rather than the error surface.
        UsersImpersonationStatus status;
        try
        {
            status = await _feed.FetchStatusAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            status = UsersImpersonationStatus.Inactive;
        }

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        _status = status;

        // web: open ? OpenMode — the candidates query is disabled while open.
        if (status == UsersImpersonationStatus.Open)
        {
            _candidatesMode = null;
            _candidates = Array.Empty<ImpersonationCandidate>();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _hasLoaded = true;
            IsFetching = false;
            Reproject();
            return;
        }

        // 2) Candidates (web useImpersonationCandidates). A genuine failure drives the error surface.
        try
        {
            var snapshot = await _feed.FetchCandidatesAsync(cts.Token).ConfigureAwait(false);
            if (cts.Token.IsCancellationRequested)
            {
                return;
            }

            _candidatesMode = snapshot.Mode;
            _candidates = snapshot.Candidates ?? Array.Empty<ImpersonationCandidate>();
            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web onError: the candidates query surfaces the ErrorDisplay so the page never renders a blank panel.
            _hasError = true;
            _errorDetail = ex.Message;
            _candidatesMode = null;
            _candidates = Array.Empty<ImpersonationCandidate>();
        }

        _loading = false;
        _hasLoaded = true;
        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the status + candidates (web auto-refetch / ErrorDisplay Retry).</summary>
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

    private UsersModel BuildModel() => new(
        Status: _status,
        CandidatesMode: _candidatesMode,
        Candidates: _candidates,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail);

    private void Reproject()
    {
        var display = UsersProjection.Project(BuildModel(), _localizer);
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
