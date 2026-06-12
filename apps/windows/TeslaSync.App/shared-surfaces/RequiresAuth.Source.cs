namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The auth-mode contract seam the <c>RequiresAuth</c> wrapper binds through (P1/S8) — the native analogue of the
/// web <c>useAuthMode()</c> hook the wrapper reads (web/src/components/feedback/RequiresAuth.tsx L70,
/// web/src/api/hooks/useAuthMode.ts). It exposes the current <see cref="RequiresAuthSnapshot"/> and raises
/// <see cref="Changed"/> whenever the resolved contract moves (the web query transitioning from loading → resolved,
/// or an operator reconfiguring the deployment between launches). The view never issues HTTP itself — it binds to
/// this seam, and the composition root supplies a binding that fetches <c>/system/auth-mode</c> (via the generated
/// client + <see cref="AuthModeResponseAdapter"/>) and pushes snapshots in. <see cref="StaticAuthModeSource"/> is
/// the headless / unit-test default and the safe pre-resolution default for an unbound view.
/// </summary>
public interface IAuthModeSource
{
    /// <summary>The current auth-mode snapshot (web <c>useAuthMode()</c> result).</summary>
    RequiresAuthSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IAuthModeSource"/> with an explicit, caller-set snapshot — the headless / unit-test default and the
/// safe default an unbound view binds to. It starts <see cref="RequiresAuthSnapshot.Unresolved"/> so the wrapper
/// renders its gated notice (never flashing the children before the contract resolves, the web
/// <c>isLoading || !data</c> guard); the composition root's auth-mode state holder (or a test) calls
/// <see cref="Set"/> with the resolved snapshot — the native analogue of the TanStack query settling — which raises
/// <see cref="Changed"/> so the wrapper reprojects. This is the seam through which the real
/// <c>/system/auth-mode</c> fetch (parsed by <see cref="AuthModeResponseAdapter"/>) flows into the view, keeping
/// the view free of any direct HTTP.
/// </summary>
public sealed class StaticAuthModeSource : IAuthModeSource
{
    private RequiresAuthSnapshot _current;

    /// <summary>Creates a source starting unresolved (the web loading state) until <see cref="Set"/> is called.</summary>
    public StaticAuthModeSource()
        : this(RequiresAuthSnapshot.Unresolved)
    {
    }

    /// <summary>Creates a source over an initial snapshot.</summary>
    /// <param name="current">The initial auth-mode snapshot.</param>
    public StaticAuthModeSource(RequiresAuthSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public RequiresAuthSnapshot Current => _current;

    /// <summary>
    /// Move the snapshot and raise <see cref="Changed"/> — the native analogue of the auth-mode query resolving (or
    /// the operator reconfiguring the deployment). Idempotent: setting the same reference is a no-op.
    /// </summary>
    /// <param name="snapshot">The new auth-mode snapshot.</param>
    public void Set(RequiresAuthSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (ReferenceEquals(_current, snapshot))
        {
            return;
        }

        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
