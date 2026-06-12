using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ReloadPrompt"/> view — the native port of the web
/// <c>ReloadPrompt</c> body (web/src/components/feedback/ReloadPrompt.tsx L30-L122). It binds the P1/S8
/// <see cref="ISoftwareUpdateSource"/> (the web <c>useRegisterSW</c> pending-update state), reproduces the web
/// auto-reload countdown as a pure, driveable state machine (<see cref="Tick"/> mirrors the web
/// <c>setInterval(…, 1000)</c> body: decrement, then reload at zero), recomputes the pure
/// <see cref="ReloadPromptProjection"/> whenever the update state or the countdown moves, and raises
/// <see cref="PropertyChanged"/> so the view animates the banner in / out and refreshes the countdown subtitle.
/// <see cref="ReloadAsync"/> applies the update now (the web <c>doReload</c>) and <see cref="Dismiss"/> hides the
/// banner (the web <c>dismiss</c>). <see cref="Dispose"/> unsubscribes from the seam (the web effect cleanup). The
/// view owns the once-per-second timer and the slide / fade / spin animations (and their reduce-motion handling);
/// the holder owns no timer and performs no I/O. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class ReloadPromptViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ISoftwareUpdateSource _update;
    private ReloadPromptProjection _projection;
    private bool _needRefresh;
    private int _seconds;
    private bool _reloading;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the P1/S8 software-update seam.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="update">The software-update seam (web <c>useRegisterSW</c> pending-update state + reload).</param>
    public ReloadPromptViewModel(ILocalizer localizer, ISoftwareUpdateSource update)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(update);

        _localizer = localizer;
        _update = update;
        _needRefresh = update.NeedRefresh;
        _seconds = ReloadPromptRegistration.CountdownSeconds;
        _projection = Compute();
        _update.Changed += OnUpdateChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ReloadPrompt</c>).</summary>
    public static string Slug => ReloadPromptRegistration.Slug;

    /// <summary>The current render projection (visibility + countdown + localized title / subtitle + action labels).</summary>
    public ReloadPromptProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>needRefresh</c>); also whether the countdown is running.</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The remaining auto-reload countdown in seconds (web <c>countdown</c>).</summary>
    public int Seconds => _projection.Seconds;

    /// <summary>The localized prompt title (web <c>pwa.newVersion</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The interpolated countdown subtitle (web <c>pwa.reloadingIn</c>).</summary>
    public string CountdownMessage => _projection.CountdownMessage;

    /// <summary>The localized "Later" dismiss-action label (web <c>pwa.later</c>).</summary>
    public string LaterLabel => _projection.LaterLabel;

    /// <summary>The localized "Reload Now" action label (web <c>pwa.reloadNow</c>).</summary>
    public string ReloadNowLabel => _projection.ReloadNowLabel;

    /// <summary>The accessible name a screen reader announces for the surface (the title).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The accessible description a screen reader announces for the surface (the countdown subtitle).</summary>
    public string Description => _projection.Description;

    /// <summary>
    /// Advance the auto-reload countdown by one second — the native port of the web <c>setInterval</c> callback
    /// (web/src/components/feedback/ReloadPrompt.tsx L70-L79): while a build is pending, decrement the countdown and,
    /// when it reaches the final second (<c>prev &lt;= 1</c>), settle to zero and apply the update. A no-op once the
    /// banner is hidden or a reload is already in flight, so a late timer tick is harmless. The view drives this once
    /// per second while <see cref="IsVisible"/>.
    /// </summary>
    public void Tick()
    {
        if (_disposed || !_needRefresh || _reloading)
        {
            return;
        }

        if (_seconds <= 1)
        {
            // web: prev <= 1 -> clearCountdown + updateServiceWorker(true) + return 0.
            _seconds = 0;
            Reproject();
            BeginReload();
        }
        else
        {
            _seconds--;
            Reproject();
        }
    }

    /// <summary>
    /// Apply the waiting update now — the web <c>doReload</c> (web/src/components/feedback/ReloadPrompt.tsx L56-L59):
    /// cancel the countdown and relaunch through the seam. Idempotent while a reload is already in flight, and never
    /// throws — a relaunch failure is swallowed so the surface settles (the web awaits <c>updateServiceWorker</c>
    /// without surfacing errors). The seam consuming its pending state reprojects and collapses the banner.
    /// </summary>
    public Task ReloadAsync() => _disposed ? Task.CompletedTask : ReloadCoreAsync();

    /// <summary>
    /// Hide the banner without applying the update — the web <c>dismiss</c>
    /// (web/src/components/feedback/ReloadPrompt.tsx L61-L64): cancel the countdown and clear the pending flag through
    /// the seam, which reprojects and collapses the banner. The update remains available for the host's next check.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _update.Dismiss();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _update.Changed -= OnUpdateChanged;
        GC.SuppressFinalize(this);
    }

    private void BeginReload() => _ = ReloadCoreAsync();

    private async Task ReloadCoreAsync()
    {
        if (_reloading)
        {
            return;
        }

        _reloading = true;

        try
        {
            await _update.ReloadAsync().ConfigureAwait(false);
        }
        catch (Exception)
        {
            // The web awaits updateServiceWorker(true) without surfacing errors; a relaunch failure must not crash
            // the surface — the pending state is owned by the seam.
        }
    }

    private void OnUpdateChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        bool need = _update.NeedRefresh;
        if (need && !_needRefresh)
        {
            // web effect on needRefresh -> true: reset the countdown (setCountdown(COUNTDOWN_SECONDS)) and re-arm.
            _seconds = ReloadPromptRegistration.CountdownSeconds;
            _reloading = false;
        }

        _needRefresh = need;
        Reproject();
    }

    private ReloadPromptProjection Compute() =>
        ReloadPromptProjection.Project(_needRefresh, _seconds, _localizer);

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
