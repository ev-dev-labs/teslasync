namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The software-update seam the <c>ReloadPrompt</c> binds through (P1/S8) — the native analogue of the web
/// <c>useRegisterSW</c> hook the prompt reads (web/src/components/feedback/ReloadPrompt.tsx L35-L47, L56-L64). It
/// exposes whether a new build is waiting to be applied (<see cref="NeedRefresh"/> — the web <c>needRefresh</c>),
/// raises <see cref="Changed"/> when that flips (the web <c>onNeedRefresh</c> / <c>setNeedRefresh</c>), applies the
/// waiting update and relaunches via <see cref="ReloadAsync"/> (the web <c>updateServiceWorker(true)</c>), and hides
/// the banner without applying via <see cref="Dismiss"/> (the web <c>setNeedRefresh(false)</c> — the update stays
/// pending for the host's next check). The view never polls a registration or relaunches itself — it binds to this
/// seam. The production binding is <see cref="DelegatedSoftwareUpdateSource"/> over the host's update manager;
/// <see cref="StaticSoftwareUpdateSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface ISoftwareUpdateSource
{
    /// <summary>Whether a new build is waiting to be applied (web <c>needRefresh</c>).</summary>
    bool NeedRefresh { get; }

    /// <summary>Raised whenever <see cref="NeedRefresh"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Apply the waiting update and relaunch — the web <c>updateServiceWorker(true)</c>
    /// (web/src/components/feedback/ReloadPrompt.tsx L58). The pending state is consumed by this call
    /// (<see cref="NeedRefresh"/> becomes <see langword="false"/> and <see cref="Changed"/> is raised), mirroring the
    /// web reload that tears the page down.
    /// </summary>
    Task ReloadAsync();

    /// <summary>
    /// Hide the banner without applying the update — the web <c>setNeedRefresh(false)</c>
    /// (web/src/components/feedback/ReloadPrompt.tsx L63). Clears <see cref="NeedRefresh"/> and raises
    /// <see cref="Changed"/>; the update remains available for the host's next check, exactly as the web banner
    /// reappears on the next update poll.
    /// </summary>
    void Dismiss();
}

/// <summary>
/// An <see cref="ISoftwareUpdateSource"/> with explicit, caller-set state — the headless / unit-test default and the
/// parameterless designer source. <see cref="Announce"/> marks a build as waiting (the web <c>onNeedRefresh</c>
/// firing), <see cref="Dismiss"/> hides it (the web <c>setNeedRefresh(false)</c>), and <see cref="ReloadAsync"/>
/// records the relaunch and consumes the pending state — so the prompt projection, countdown and view-model can be
/// exercised across every branch (announced, counted-down, reloaded, dismissed) without an update-manager host.
/// </summary>
public sealed class StaticSoftwareUpdateSource : ISoftwareUpdateSource
{
    private bool _needRefresh;

    /// <summary>Creates a source over an initial pending-update flag (defaults to no waiting update).</summary>
    /// <param name="needRefresh">Whether a build starts waiting to be applied.</param>
    public StaticSoftwareUpdateSource(bool needRefresh = false) => _needRefresh = needRefresh;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool NeedRefresh => _needRefresh;

    /// <summary>The number of times <see cref="ReloadAsync"/> applied the update (for assertions).</summary>
    public int ReloadCount { get; private set; }

    /// <summary>Mark a new build as waiting and raise <see cref="Changed"/> (the web <c>onNeedRefresh</c>).</summary>
    public void Announce()
    {
        if (_needRefresh)
        {
            return;
        }

        _needRefresh = true;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public Task ReloadAsync()
    {
        ReloadCount++;

        // The relaunch consumes the pending state (web updateServiceWorker(true) reloads the page away).
        if (_needRefresh)
        {
            _needRefresh = false;
            Changed?.Invoke(this, EventArgs.Empty);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public void Dismiss()
    {
        if (!_needRefresh)
        {
            return;
        }

        _needRefresh = false;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ISoftwareUpdateSource"/> — adapts the host's update manager into the seam, the native
/// analogue of the web <c>useRegisterSW</c> wiring (web/src/components/feedback/ReloadPrompt.tsx L35-L47). The
/// composition root supplies the pending-update reader (bound to the packaged app's waiting-update state), an
/// optional relaunch presenter (the web <c>updateServiceWorker(true)</c>) and an optional dismiss hook; it calls
/// <see cref="RaiseChanged"/> whenever the update manager detects a waiting build so the banner surfaces. WinUI-free
/// (it holds only delegates) so it is unit-tested against in-memory closures.
/// </summary>
public sealed class DelegatedSoftwareUpdateSource : ISoftwareUpdateSource
{
    private readonly Func<bool> _needRefresh;
    private readonly Func<Task>? _reload;
    private readonly Action? _dismiss;

    /// <summary>Creates the source over the host's pending-update reader and optional relaunch / dismiss hooks.</summary>
    /// <param name="needRefresh">Reads whether a build is waiting to be applied (web <c>needRefresh</c>).</param>
    /// <param name="reload">Applies the waiting update and relaunches (web <c>updateServiceWorker(true)</c>); null is a no-op.</param>
    /// <param name="dismiss">Clears the host-side pending flag (web <c>setNeedRefresh(false)</c>); null is a no-op.</param>
    public DelegatedSoftwareUpdateSource(Func<bool> needRefresh, Func<Task>? reload = null, Action? dismiss = null)
    {
        ArgumentNullException.ThrowIfNull(needRefresh);
        _needRefresh = needRefresh;
        _reload = reload;
        _dismiss = dismiss;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool NeedRefresh => _needRefresh();

    /// <summary>Surface a host update event (a build finished downloading / is waiting) to subscribers.</summary>
    public void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    /// <inheritdoc />
    public async Task ReloadAsync()
    {
        if (_reload is not null)
        {
            await _reload().ConfigureAwait(false);
        }

        // The relaunch tears the app down; surface the state change so the banner settles if it does not.
        RaiseChanged();
    }

    /// <inheritdoc />
    public void Dismiss()
    {
        _dismiss?.Invoke();
        RaiseChanged();
    }
}
