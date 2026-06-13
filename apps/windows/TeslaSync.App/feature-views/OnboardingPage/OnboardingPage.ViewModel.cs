using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Onboarding;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>OnboardingPage</c> view — the native port of the web page's data
/// flow (web/src/features/onboarding/pages/OnboardingPage.tsx). It reads the setup status through the injected
/// <see cref="IOnboardingStatusFeed"/> (web <c>useOnboardingStatus</c>), owns the first-load / in-flight flags, applies
/// the web pessimistic gate (a failed read degrades to "nothing connected" rather than a failure region), derives the
/// two-state matrix (loading / success) and projects everything through <see cref="OnboardingProjection"/> into a
/// render-ready <see cref="Display"/>. <see cref="ShouldPoll"/> mirrors the web <c>refetchInterval</c> contract (poll
/// every 30s until <c>is_complete</c>). Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class OnboardingPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOnboardingStatusFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly OnboardingDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private OnboardingStatusSnapshot _status = OnboardingStatusSnapshot.Pending;
    private bool _hasLoaded;
    private bool _isFetching;

    private OnboardingState _state = OnboardingState.Loading;
    private OnboardingDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics sink.</summary>
    /// <param name="feed">The onboarding-status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public OnboardingPageViewModel(
        IOnboardingStatusFeed feed,
        ILocalizer localizer,
        OnboardingDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new OnboardingDiagnostics();
        _display = OnboardingProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / success).</summary>
    public OnboardingState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public OnboardingDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a status (re)fetch is in flight (web <c>isFetching</c>; drives the "Checking…" label).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True once setup is complete (web <c>is_complete</c>) — the page stops polling and offers Continue.</summary>
    public bool IsComplete => _status.IsComplete;

    /// <summary>
    /// True while the page should keep re-reading the status (web <c>refetchInterval</c>): once the first read has
    /// resolved and setup is not yet complete. Flips to false the moment <c>is_complete</c> is observed.
    /// </summary>
    public bool ShouldPoll => _hasLoaded && !_status.IsComplete;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the onboarding-status read (web <c>useOnboardingStatus</c> / Check again / Refresh).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            // First read in flight: keep the loading state visible (the GlassPanel shows its skeleton).
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _status = snapshot;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception)
        {
            // web pessimistic gate: a failed read assumes "nothing connected" so the user sees the checklist rather
            // than a broken dashboard. The status degrades to the pending default; no failure region is shown.
            _status = OnboardingStatusSnapshot.Pending;
        }

        _hasLoaded = true;
        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the status (web auto-refetch / Check again / the vehicle-step Refresh).</summary>
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

    private OnboardingModel BuildModel() => new(
        Status: _status,
        Resolved: _hasLoaded,
        Loading: !_hasLoaded,
        IsFetching: _isFetching);

    private void Reproject()
    {
        var display = OnboardingProjection.Project(BuildModel(), _localizer);
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
