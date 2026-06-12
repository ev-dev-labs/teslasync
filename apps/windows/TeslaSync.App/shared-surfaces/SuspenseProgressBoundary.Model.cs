namespace TeslaSync.App.SharedSurfaces.SuspenseProgressBoundarySurface;

/// <summary>
/// Canonical metadata for the SuspenseProgressBoundary surface — the native analogue of the module-level
/// identifiers in <c>web/src/components/feedback/SuspenseProgressBoundary.tsx</c> and its companion controller
/// <c>web/src/lib/globalProgress.ts</c>. The web component is anonymous (it renders no titles, labels or i18n
/// keys of its own — it is a transparent Suspense wrapper), so this carries only the diagnostics slug the
/// surface registers under.
/// </summary>
public static class SuspenseProgressBoundaryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SuspenseProgressBoundary";
}

/// <summary>
/// An immutable snapshot of the global progress controller's observable state — the native port of the web
/// <c>__getGlobalProgressStateForTests</c> shape (<c>web/src/lib/globalProgress.ts</c>): the live consumer
/// count, the current trickle <see cref="Progress"/> (0 → <see cref="GlobalProgress.TrickleTarget"/>), the live
/// listener count, and whether the asymptotic trickle timer is running. Kept as a value type so a test (or a
/// host diagnostic) can assert the controller's state without reaching into its internals.
/// </summary>
public readonly record struct GlobalProgressSnapshot(int ActiveCount, double Progress, int Listeners, bool Ticking)
{
    /// <summary>Whether at least one consumer is active (web <c>activeCount &gt; 0</c>).</summary>
    public bool IsActive => ActiveCount > 0;
}

/// <summary>
/// PII-safe diagnostics for the SuspenseProgressBoundary surface (P1/S11 diagnostics contract). A Suspense
/// boundary carries no user content, so the collector records only the operational <c>view.opened</c> event
/// with the surface slug — never route names, chunk identifiers or timings. Thread-safe.
/// </summary>
public sealed class SuspenseProgressBoundaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SuspenseProgressBoundaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SuspenseProgressBoundary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SuspenseProgressBoundaryRegistration.Slug}");
    }
}
