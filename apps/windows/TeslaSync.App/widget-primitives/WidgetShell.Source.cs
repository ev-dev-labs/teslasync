namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The state-holder seam the WidgetShell primitive binds through (P1/S8) — the native analogue of the props the web
/// <c>&lt;WidgetShell&gt;</c> receives from its parent dashboard widget
/// (web/src/features/dashboard/widgets/WidgetShell.tsx). It exposes the current <see cref="WidgetShellInput"/> (the
/// title, loading / error flags, padding mode, help metadata, freshness primitives and pin identity) and raises
/// <see cref="Changed"/> whenever those inputs are reassigned — the analogue of the parent widget re-rendering with
/// new props as its query data resolves. The view never reads a query or performs HTTP itself; it binds to this seam
/// and observes the bound view-model. <see cref="StaticWidgetShellSource"/> is the in-memory holder a parent widget
/// (or a test) pushes the resolved props into.
/// </summary>
public interface IWidgetShellSource
{
    /// <summary>The current inputs (title, loading/error, padding, help, freshness, pin identity); never null.</summary>
    WidgetShellInput Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IWidgetShellSource"/> with an explicit, caller-set input — the canonical holder a parent widget
/// pushes the resolved props into and the headless / unit-test default. It mirrors a parent passing fresh props to
/// the web component: <see cref="Set"/> replaces the whole input, while <see cref="SetLoading"/>,
/// <see cref="SetError"/> and <see cref="SetFreshness"/> swap a single facet (e.g. as a query transitions through
/// loading → loaded → refetching), each raising <see cref="Changed"/> so the bound view-model re-projects. A null
/// assignment falls back to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class StaticWidgetShellSource : IWidgetShellSource
{
    private WidgetShellInput _current;

    /// <summary>Creates an empty source (no title, not loading, no freshness) — the parameterless headless default.</summary>
    public StaticWidgetShellSource()
        : this(new WidgetShellInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input.</summary>
    /// <param name="current">The initial inputs (a null falls back to the default input).</param>
    public StaticWidgetShellSource(WidgetShellInput current) =>
        _current = current ?? new WidgetShellInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public WidgetShellInput Current => _current;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    /// <param name="input">The new inputs.</param>
    public void Set(WidgetShellInput input)
    {
        _current = input ?? new WidgetShellInput();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Toggle just the loading flag, keeping every other input — the analogue of the parent flipping the shell into
    /// its skeleton branch while a query loads (web <c>loading</c>).
    /// </summary>
    /// <param name="loading">Whether the shell shows the loading skeleton (web <c>loading</c>).</param>
    public void SetLoading(bool loading)
    {
        _current = _current with { Loading = loading };
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Set or clear just the error message, keeping every other input — the analogue of the parent flipping the
    /// shell into / out of its query-error branch (web <c>error</c>).
    /// </summary>
    /// <param name="errorMessage">The error message (null/empty clears the error branch).</param>
    public void SetError(string? errorMessage)
    {
        _current = _current with { ErrorMessage = errorMessage };
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Swap just the freshness primitives, keeping every other input — the analogue of the parent passing a fresh
    /// query result to the shell's freshness chip as it resolves and re-fetches.
    /// </summary>
    /// <param name="updatedAt">When the data was last fetched, or null (web <c>updatedAt</c>).</param>
    /// <param name="isFetching">Whether a (re)fetch is in flight (web <c>isFetching</c>).</param>
    /// <param name="isStale">Whether the data is stale (web <c>isStale</c>).</param>
    /// <param name="isError">Whether the last fetch failed (web freshness <c>isError</c>).</param>
    /// <param name="canRefresh">Whether a manual refresh affordance is offered (web <c>onRefresh</c> present).</param>
    public void SetFreshness(
        DateTimeOffset? updatedAt,
        bool isFetching,
        bool isStale,
        bool isError,
        bool canRefresh = false)
    {
        _current = _current with
        {
            HasFreshness = true,
            UpdatedAt = updatedAt,
            IsFetching = isFetching,
            IsStale = isStale,
            IsError = isError,
            FreshnessCanRefresh = canRefresh,
        };
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
