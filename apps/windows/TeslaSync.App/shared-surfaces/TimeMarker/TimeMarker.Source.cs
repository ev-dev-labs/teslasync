using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The ±30-minute chart window centred on the alert moment — the native port of the web
/// <c>AlertContext['timeWindow']</c> (web/src/hooks/useAlertContext.ts L25-L26, L53-L56). Both bounds are ISO
/// 8601 UTC strings (the web <c>Date.toISOString()</c> form) so a host can clamp its chart's x-domain to the
/// alert neighbourhood exactly as the web pages do.
/// </summary>
/// <param name="From">The lower bound, <c>t − 30 min</c> as an ISO 8601 UTC string (web <c>timeWindow.from</c>).</param>
/// <param name="To">The upper bound, <c>t + 30 min</c> as an ISO 8601 UTC string (web <c>timeWindow.to</c>).</param>
public sealed record AlertTimeWindow(string From, string To);

/// <summary>
/// The alert drill-through context the marker binds to — the native port of the web <c>AlertContext</c>
/// (web/src/hooks/useAlertContext.ts L18-L30). When a user clicks an alert and lands on a context page like
/// <c>/battery?vehicle_id=12&amp;t=…&amp;signal=BatteryLevel</c>, the web <c>useAlertContext()</c> hook reads
/// those query params and derives this shape; the page then feeds the timestamp + signal into
/// <c>&lt;TimeMarker&gt;</c>. This record is the same derived shape, computed by <see cref="Create"/> /
/// <see cref="FromQuery"/>: <see cref="TimeWindow"/> is the ±30-minute window when the timestamp parses,
/// and <see cref="HasContext"/> is true when any drill-through field is present. Every field is optional —
/// <see cref="None"/> is the no-context default a page renders without a marker. UI-free so it is unit-tested
/// headlessly.
/// </summary>
public sealed record AlertMarkerContext
{
    /// <summary>The empty, no-context value (web: the hook's all-null return when no params are present).</summary>
    public static AlertMarkerContext None { get; } = new();

    /// <summary>The vehicle id from <c>?vehicle_id=N</c> (web <c>vehicleId</c>); <see langword="null"/> when absent or unparseable.</summary>
    public long? VehicleId { get; init; }

    /// <summary>The raw ISO timestamp from <c>?t=…</c> (web <c>timestamp</c>); <see langword="null"/> when absent.</summary>
    public string? Timestamp { get; init; }

    /// <summary>The signal name from <c>?signal=…</c> (web <c>signal</c>); <see langword="null"/> when absent.</summary>
    public string? Signal { get; init; }

    /// <summary>The <c>[t−30min, t+30min]</c> window (web <c>timeWindow</c>); <see langword="null"/> when no valid timestamp.</summary>
    public AlertTimeWindow? TimeWindow { get; init; }

    /// <summary>True when at least one drill-through field is present (web <c>hasContext</c>).</summary>
    public bool HasContext { get; init; }

    /// <summary>The window half-width in minutes (web <c>ALERT_WINDOW_MS = 30 * 60_000</c>).</summary>
    private const int WindowMinutes = 30;

    /// <summary>
    /// Derive the context from already-typed fields — the native port of the web <c>useAlertContext</c>
    /// <c>useMemo</c> body (web/src/hooks/useAlertContext.ts L37-L66): the timestamp drives a ±30-minute
    /// <see cref="TimeWindow"/> only when it parses, the raw timestamp is preserved verbatim, and
    /// <see cref="HasContext"/> is true when the vehicle id, timestamp or signal is present.
    /// </summary>
    /// <param name="vehicleId">The vehicle id, or <see langword="null"/>.</param>
    /// <param name="timestamp">The raw ISO timestamp, or <see langword="null"/>.</param>
    /// <param name="signal">The focused signal name, or <see langword="null"/>.</param>
    public static AlertMarkerContext Create(long? vehicleId, string? timestamp, string? signal)
    {
        string? ts = string.IsNullOrEmpty(timestamp) ? null : timestamp;
        string? sig = string.IsNullOrEmpty(signal) ? null : signal;

        return new AlertMarkerContext
        {
            VehicleId = vehicleId,
            Timestamp = ts,
            Signal = sig,
            TimeWindow = ComputeWindow(ts),
            HasContext = vehicleId is not null || ts is not null || sig is not null,
        };
    }

    /// <summary>
    /// Derive the context from raw query-string values — the native port of the web hook reading
    /// <c>useSearchParams()</c> and coercing <c>vehicle_id</c> with <c>Number()</c> /
    /// <c>Number.isFinite</c> (web/src/hooks/useAlertContext.ts L38-L47). An empty / non-integer vehicle id
    /// coerces to <see langword="null"/>, mirroring the web's finite-number guard.
    /// </summary>
    /// <param name="vehicleId">The raw <c>vehicle_id</c> query value, or <see langword="null"/>.</param>
    /// <param name="timestamp">The raw <c>t</c> query value, or <see langword="null"/>.</param>
    /// <param name="signal">The raw <c>signal</c> query value, or <see langword="null"/>.</param>
    public static AlertMarkerContext FromQuery(string? vehicleId, string? timestamp, string? signal)
    {
        long? parsed = null;
        if (!string.IsNullOrEmpty(vehicleId) &&
            long.TryParse(vehicleId, NumberStyles.Integer, CultureInfo.InvariantCulture, out long value))
        {
            parsed = value;
        }

        return Create(parsed, timestamp, signal);
    }

    private static AlertTimeWindow? ComputeWindow(string? timestamp)
    {
        if (timestamp is null)
        {
            return null;
        }

        // web: `const parsed = new Date(t); if (!Number.isNaN(parsed.getTime())) { ... }` — only a parseable
        // moment yields a window; an unparseable timestamp is kept verbatim but produces no window.
        if (!DateTimeOffset.TryParse(
                timestamp,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out DateTimeOffset moment))
        {
            return null;
        }

        return new AlertTimeWindow(
            Iso(moment.AddMinutes(-WindowMinutes)),
            Iso(moment.AddMinutes(WindowMinutes)));
    }

    // The JS Date.toISOString() form: UTC, millisecond precision, trailing 'Z'.
    private static string Iso(DateTimeOffset moment) =>
        moment.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}

/// <summary>
/// The alert-context seam the marker binds to (P1/S8 state-holder layer) — the native analogue of the web
/// <c>useAlertContext()</c> hook the alert drill-through pages call. The web component is presentational and
/// fed by the page; the native surface likewise never reads the URL or performs I/O itself — it observes this
/// seam, reads the current <see cref="Context"/>, and re-projects on <see cref="Changed"/>. A shell adapter
/// (or a test fake) supplies the implementation, so the surface logic is asserted without navigation.
/// </summary>
public interface ITimeMarkerSource
{
    /// <summary>The current alert drill-through context (web <c>useAlertContext()</c> return).</summary>
    AlertMarkerContext Context { get; }

    /// <summary>Raised whenever the context changes (web: the page re-navigating / params changing).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The canonical in-memory <see cref="ITimeMarkerSource"/> — the native analogue of the navigation layer that
/// drives the web <c>useAlertContext()</c> hook. A host updates it from the current route
/// (<see cref="SetParams"/> mirrors the URL query changing; <see cref="SetContext"/> sets an already-derived
/// context) and it raises <see cref="Changed"/> on every update so the bound
/// <see cref="TimeMarkerViewModel"/> re-projects. UI-thread-confined; not internally synchronised.
/// </summary>
public sealed class TimeMarkerStore : ITimeMarkerSource
{
    /// <summary>Creates the store over an optional initial context (defaults to <see cref="AlertMarkerContext.None"/>).</summary>
    public TimeMarkerStore(AlertMarkerContext? context = null) => Context = context ?? AlertMarkerContext.None;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public AlertMarkerContext Context { get; private set; }

    /// <summary>Replace the whole context (a host computed the derived shape) and raise <see cref="Changed"/>.</summary>
    /// <param name="context">The new context.</param>
    public void SetContext(AlertMarkerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        Context = context;
        Raise();
    }

    /// <summary>
    /// Update from raw query values (the URL changed) — derives the context via
    /// <see cref="AlertMarkerContext.FromQuery"/> and raises <see cref="Changed"/>.
    /// </summary>
    /// <param name="vehicleId">The raw <c>vehicle_id</c> query value, or <see langword="null"/>.</param>
    /// <param name="timestamp">The raw <c>t</c> query value, or <see langword="null"/>.</param>
    /// <param name="signal">The raw <c>signal</c> query value, or <see langword="null"/>.</param>
    public void SetParams(string? vehicleId, string? timestamp, string? signal)
    {
        Context = AlertMarkerContext.FromQuery(vehicleId, timestamp, signal);
        Raise();
    }

    /// <summary>Clear the context to <see cref="AlertMarkerContext.None"/> (the page left alert context) and raise.</summary>
    public void Clear()
    {
        Context = AlertMarkerContext.None;
        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
