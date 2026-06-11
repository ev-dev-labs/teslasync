namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The host-capability seam the <c>BrowserCompatBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>detectMissingFeatures()</c> read the banner seeds its <c>missing</c> state with
/// (web/src/components/feedback/BrowserCompatBanner.tsx L49-51). It exposes the current
/// <see cref="BrowserCompatSnapshot"/> and raises <see cref="Changed"/> if the detected set ever moves (in
/// practice the host's capabilities cannot change inside a process, exactly as the web comment notes the browser's
/// capabilities cannot change inside a single page load). The view never probes the host itself — it binds to this
/// seam. The production binding is <see cref="CapabilityBrowserCompatSource"/> over the default requirement
/// registry; <see cref="StaticBrowserCompatSource"/> stands in for headless hosts, unit tests, and the web
/// <c>testHookMissing</c> seam.
/// </summary>
public interface IBrowserCompatSource
{
    /// <summary>The current capability snapshot (web <c>missing</c> detection result).</summary>
    BrowserCompatSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IBrowserCompatSource"/> with an explicit, caller-set snapshot — the headless / unit-test default
/// and the native analogue of the web <c>testHookMissing</c> prop, which overrides the live detection result so
/// specs can exercise the rendered output without monkey-patching every global (BrowserCompatBanner.tsx L37-60).
/// <see cref="Set"/> moves the snapshot and raises <see cref="Changed"/> so the banner projection and view-model
/// can be exercised in the supported (collapsed) and unsupported (shown) states without a host.
/// </summary>
public sealed class StaticBrowserCompatSource : IBrowserCompatSource
{
    private BrowserCompatSnapshot _current;

    /// <summary>Creates a source over an initial snapshot.</summary>
    /// <param name="current">The initial capability snapshot.</param>
    public StaticBrowserCompatSource(BrowserCompatSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <summary>Creates a source over an explicit missing-feature list (the web <c>testHookMissing</c> seam).</summary>
    /// <param name="missingFeatures">The required capabilities to report as missing.</param>
    public StaticBrowserCompatSource(IReadOnlyList<string> missingFeatures)
        : this(BrowserCompatSnapshot.Missing(missingFeatures))
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public BrowserCompatSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (re-running detection / a changed test hook).</summary>
    /// <param name="snapshot">The new capability snapshot.</param>
    public void Set(BrowserCompatSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IBrowserCompatSource"/> — probes the required host capabilities once at construction
/// and exposes the resulting snapshot, the native analogue of the web banner running <c>detectMissingFeatures()</c>
/// synchronously on mount (BrowserCompatBanner.tsx L49-60). <see cref="Changed"/> is a no-op subscription because a
/// running process's capabilities do not change (web: "the host browser's capabilities cannot change inside a
/// single page load", browserCompat.ts L22-24). WinUI-free — every probe in the default registry is BCL-only — so
/// it is unit-tested without a UI host.
/// </summary>
public sealed class CapabilityBrowserCompatSource : IBrowserCompatSource
{
    private readonly BrowserCompatSnapshot _current;

    /// <summary>Creates the source, probing the supplied requirements (defaults to <see cref="BrowserCompatRegistration.DefaultRequirements"/>).</summary>
    /// <param name="requirements">The required capabilities to probe, or null for the default registry.</param>
    public CapabilityBrowserCompatSource(IReadOnlyList<BrowserCompatRequirement>? requirements = null)
    {
        var probed = requirements ?? BrowserCompatRegistration.DefaultRequirements;
        var missing = BrowserCompatRegistration.DetectMissing(probed);
        _current = missing.Count == 0 ? BrowserCompatSnapshot.Supported : BrowserCompatSnapshot.Missing(missing);
    }

    /// <inheritdoc />
    /// <remarks>Never raised: a process's host capabilities are immutable, so subscribing is a no-op.</remarks>
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public BrowserCompatSnapshot Current => _current;
}

/// <summary>
/// The dismissal-persistence seam the <c>BrowserCompatBanner</c> binds through (P1/S8) — the native analogue of the
/// web sticky-per-browser localStorage flag (<c>isCompatWarningDismissed()</c> / <c>dismissCompatWarning()</c>,
/// web/src/lib/browserCompat.ts L96-116). It reports whether the warning has been acknowledged and persists an
/// acknowledgement so the user is not nagged on every navigation / launch. Implementations must be best-effort: a
/// failure to read or write degrades to "not dismissed" so the banner reappears, never throws (mirrors the web
/// try/catch around localStorage and the P2-core settings-store contract).
/// </summary>
public interface IBrowserCompatDismissalStore
{
    /// <summary>True once the warning has been dismissed (web <c>isCompatWarningDismissed()</c>).</summary>
    bool IsDismissed { get; }

    /// <summary>Persist the dismissal (web <c>dismissCompatWarning()</c>) and raise <see cref="Changed"/>.</summary>
    void Dismiss();

    /// <summary>Raised whenever <see cref="IsDismissed"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An in-memory <see cref="IBrowserCompatDismissalStore"/> — the headless / unit-test default. It is intentionally
/// non-durable (the real app binds the <c>ApplicationData.LocalSettings</c>-backed store in the view layer); it
/// flows the dismissal through a single seam so the persisted-state behaviour is asserted in tests.
/// <see cref="Reset"/> clears the flag for successive specs in one run (the web <c>__resetCompatWarningForTests</c>).
/// </summary>
public sealed class InMemoryBrowserCompatDismissalStore : IBrowserCompatDismissalStore
{
    private bool _dismissed;

    /// <summary>Creates the store, optionally seeded as already dismissed (a simulated prior acknowledgement).</summary>
    /// <param name="dismissed">Whether the warning starts dismissed.</param>
    public InMemoryBrowserCompatDismissalStore(bool dismissed = false) => _dismissed = dismissed;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsDismissed => _dismissed;

    /// <summary>Number of times <see cref="Dismiss"/> has persisted a NEW dismissal (for write assertions).</summary>
    public int DismissCount { get; private set; }

    /// <inheritdoc />
    public void Dismiss()
    {
        if (_dismissed)
        {
            return;
        }

        _dismissed = true;
        DismissCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Clear the dismissal flag — the test seam (web <c>__resetCompatWarningForTests</c>).</summary>
    public void Reset()
    {
        if (!_dismissed)
        {
            return;
        }

        _dismissed = false;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
