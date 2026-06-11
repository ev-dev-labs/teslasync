namespace TeslaSync.App.SharedSurfaces.ChartHiddenSeriesContextSurface;

/// <summary>
/// The URL query-string seam the hidden-series state binds to (P1/S8 state-holder layer) — the native analogue of
/// the web <c>useSearchParams()</c> hook (react-router) that <c>useUrlArray</c> / <c>useHiddenSeries</c> read and
/// write through. It exposes a single named parameter's value plus a change notification, mirroring how a web
/// component re-renders when the URL query string changes. The view never touches this seam directly: it binds
/// through <see cref="HiddenSeriesState"/>. The canonical implementation is <see cref="HiddenSeriesQueryStore"/>;
/// <see cref="NoOpHiddenSeriesQueryStore"/> stands in for an isolated host with no navigation context (the web
/// note that <c>useSearchParams()</c> throws when "no <c>&lt;Router&gt;</c> is in scope — the default in many
/// isolated unit tests").
/// </summary>
public interface IHiddenSeriesQueryStore
{
    /// <summary>
    /// Read the current value of <paramref name="paramName"/> (web <c>searchParams.get(key)</c>); <c>null</c> when
    /// the parameter is absent.
    /// </summary>
    /// <param name="paramName">The query-parameter name (e.g. <c>hidden_battery-degradation-trend</c>).</param>
    string? Read(string paramName);

    /// <summary>
    /// Write <paramref name="value"/> to <paramref name="paramName"/> (web <c>setSearchParams</c> with
    /// <c>replace: true</c>). A <c>null</c> or empty value removes the parameter, matching <c>useUrlArray</c>'s
    /// <c>omitDefault</c> behaviour that drops an empty list from the URL.
    /// </summary>
    /// <param name="paramName">The query-parameter name to write.</param>
    /// <param name="value">The canonical comma-joined value, or null/empty to delete the parameter.</param>
    void Write(string paramName, string? value);

    /// <summary>
    /// Raised whenever the query string changes (web component re-render on a <c>useSearchParams</c> update), so a
    /// bound state holder can recompute its membership set — including cross-component changes through the same
    /// shared store, mirroring the single shared URL.
    /// </summary>
    event EventHandler? Changed;
}

/// <summary>
/// The canonical in-memory query-string store — the native port of react-router's single shared URL that
/// <c>useSearchParams</c> reads and writes. Like the web URL it is process-wide via <see cref="Shared"/>, so every
/// chart that opts into legend toggling reads and writes its own <c>hidden_{chartKey}</c> slot of the same store
/// and observes cross-chart changes through <see cref="Changed"/>. Deleting a parameter (a null/empty write) keeps
/// the store canonical so a "fresh" chart has no entry at all, exactly like an unmodified URL. The shell supplies
/// the production adapter that bridges this to real navigation state; tests drive it directly. Writes that do not
/// change the stored value do not raise <see cref="Changed"/>, mirroring react-router skipping a no-op navigation.
/// Thread-safe because telemetry- and command-driven legend changes can originate off the UI thread.
/// </summary>
public sealed class HiddenSeriesQueryStore : IHiddenSeriesQueryStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, string> _params = new(StringComparer.Ordinal);

    /// <summary>
    /// The process-wide store — the native analogue of the single shared browser URL, so deep-link state and
    /// cross-chart toggles are observed everywhere the global store is bound.
    /// </summary>
    public static HiddenSeriesQueryStore Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? Read(string paramName)
    {
        ArgumentException.ThrowIfNullOrEmpty(paramName);
        lock (_gate)
        {
            return _params.TryGetValue(paramName, out string? value) ? value : null;
        }
    }

    /// <inheritdoc />
    public void Write(string paramName, string? value)
    {
        ArgumentException.ThrowIfNullOrEmpty(paramName);

        bool changed;
        lock (_gate)
        {
            if (string.IsNullOrEmpty(value))
            {
                // web omitDefault: an empty list drops the parameter from the URL entirely.
                changed = _params.Remove(paramName);
            }
            else if (!_params.TryGetValue(paramName, out string? existing) || !string.Equals(existing, value, StringComparison.Ordinal))
            {
                _params[paramName] = value;
                changed = true;
            }
            else
            {
                changed = false;
            }
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}

/// <summary>
/// The inert query store used when no navigation context is available — the native analogue of the web provider
/// guarding against <c>useSearchParams()</c> with no <c>&lt;Router&gt;</c> in scope. <see cref="Read"/> always
/// returns <c>null</c> (no series hidden), <see cref="Write"/> does nothing and <see cref="Changed"/> never fires,
/// so an isolated host that binds the seam degrades gracefully to a permanently-empty hidden set instead of
/// throwing.
/// </summary>
public sealed class NoOpHiddenSeriesQueryStore : IHiddenSeriesQueryStore
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpHiddenSeriesQueryStore Instance { get; } = new();

    private NoOpHiddenSeriesQueryStore()
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public string? Read(string paramName)
    {
        ArgumentException.ThrowIfNullOrEmpty(paramName);
        return null;
    }

    /// <inheritdoc />
    public void Write(string paramName, string? value) => ArgumentException.ThrowIfNullOrEmpty(paramName);
}
