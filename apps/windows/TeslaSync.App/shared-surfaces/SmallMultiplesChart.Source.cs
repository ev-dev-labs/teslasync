using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data + configuration the chart binds to (P1/S8 state-holder seam) — the native analogue of the props the
/// controlled web <c>SmallMultiplesChart</c> receives (web/src/components/charts/SmallMultiplesChart.tsx
/// L49-L87): the time-aligned <c>data</c> rows (<see cref="Samples"/>), the <c>series</c> + per-series label /
/// colour overrides (<see cref="Series"/>), the layout / downsampling props (<see cref="Layout"/>), and the
/// optional <c>onCellClick</c> drill-in (<see cref="IsInteractive"/> + <see cref="SelectCell"/>). The web
/// component owns no data of its own — its parent holds the array — so the native surface binds to this seam
/// rather than performing any HTTP itself: the view never fetches, it reads the projected cells, re-projects on
/// <see cref="Changed"/>, and calls <see cref="SelectCell"/> for a cell's drill-in. A shell adapter (or a test
/// fake) supplies the implementation, so the surface logic is asserted headlessly.
/// </summary>
public interface ISmallMultiplesChartSource
{
    /// <summary>The time-ordered input rows (web <c>data</c> prop).</summary>
    IReadOnlyList<SmallMultiplesSample> Samples { get; }

    /// <summary>The series to render, one cell each, in order (web <c>series</c> prop + label/colour overrides).</summary>
    IReadOnlyList<SmallMultiplesSeries> Series { get; }

    /// <summary>The grid layout + downsampling configuration (web layout / performance props).</summary>
    SmallMultiplesLayout Layout { get; }

    /// <summary>True when cells are drillable (web <c>Boolean(onCellClick)</c>); drives the cell's button role.</summary>
    bool IsInteractive { get; }

    /// <summary>Raised whenever the data, series or layout changes (web parent re-rendering with new props).</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Drill into a series' cell (web <c>onCellClick(sig)</c>). A null/empty key, or a call on a non-interactive
    /// source, is a silent no-op — mirroring the web cell that is only a button when <c>onCellClick</c> is set.
    /// </summary>
    /// <param name="seriesKey">The key of the series whose cell was activated.</param>
    void SelectCell(string seriesKey);
}

/// <summary>
/// The canonical in-memory <see cref="ISmallMultiplesChartSource"/> — the native analogue of the web parent that
/// owns the <c>data</c> / <c>series</c> arrays and the optional <c>onCellClick</c> handler (the controlled
/// <c>SmallMultiplesChart</c> holds no state of its own). It is seeded with an initial dataset, exposes
/// <see cref="Replace"/> so a host can swap it (the native analogue of the web props changing) — raising
/// <see cref="Changed"/> on every mutation so the bound <see cref="SmallMultiplesChartViewModel"/> re-projects —
/// and forwards <see cref="SelectCell"/> to the supplied drill-in callback. UI-thread-confined; not internally
/// synchronised.
/// </summary>
public sealed class SmallMultiplesChartStore : ISmallMultiplesChartSource
{
    private readonly Action<string>? _onCellClick;
    private List<SmallMultiplesSample> _samples;
    private List<SmallMultiplesSeries> _series;
    private SmallMultiplesLayout _layout;

    /// <summary>Creates the store over an optional initial dataset, series, layout and drill-in callback.</summary>
    /// <param name="samples">The initial input rows (copied; null is treated as empty).</param>
    /// <param name="series">The initial series descriptors (copied; null is treated as empty).</param>
    /// <param name="layout">The layout / downsampling configuration (null uses the web defaults).</param>
    /// <param name="onCellClick">The optional drill-in callback (web <c>onCellClick</c>); null = non-interactive.</param>
    public SmallMultiplesChartStore(
        IEnumerable<SmallMultiplesSample>? samples = null,
        IEnumerable<SmallMultiplesSeries>? series = null,
        SmallMultiplesLayout? layout = null,
        Action<string>? onCellClick = null)
    {
        _samples = samples is null ? [] : [.. samples];
        _series = series is null ? [] : [.. series];
        _layout = layout ?? new SmallMultiplesLayout();
        _onCellClick = onCellClick;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<SmallMultiplesSample> Samples => _samples;

    /// <inheritdoc />
    public IReadOnlyList<SmallMultiplesSeries> Series => _series;

    /// <inheritdoc />
    public SmallMultiplesLayout Layout => _layout;

    /// <inheritdoc />
    public bool IsInteractive => _onCellClick is not null;

    /// <inheritdoc />
    public void SelectCell(string seriesKey)
    {
        if (string.IsNullOrEmpty(seriesKey))
        {
            return;
        }

        _onCellClick?.Invoke(seriesKey);
    }

    /// <summary>
    /// Replace the dataset / series and optionally the layout (the native analogue of the web props changing) and
    /// raise <see cref="Changed"/> so the bound surface re-projects. A null <paramref name="layout"/> keeps the
    /// current layout.
    /// </summary>
    /// <param name="samples">The new input rows (copied).</param>
    /// <param name="series">The new series descriptors (copied).</param>
    /// <param name="layout">The new layout, or null to keep the current one.</param>
    public void Replace(
        IEnumerable<SmallMultiplesSample> samples,
        IEnumerable<SmallMultiplesSeries> series,
        SmallMultiplesLayout? layout = null)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(series);
        _samples = [.. samples];
        _series = [.. series];
        if (layout is not null)
        {
            _layout = layout;
        }

        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// Formats an x-domain instant into its localized time-of-day caption — the native binding of the web
/// <c>useDateFormat().formatTime</c> the cell uses for its x-axis tick formatter
/// (web/src/components/charts/SmallMultiplesChart.tsx L224, L293). Injected so the projection's range captions are
/// asserted deterministically (a test fake returns a fixed string regardless of machine time zone), while the app
/// uses <see cref="SmallMultiplesTimeFormatter"/> over the shared <see cref="DateTimeFormatting"/> facade.
/// </summary>
public interface ISmallMultiplesTimeFormatter
{
    /// <summary>Format <paramref name="unixMilliseconds"/> (the chart x value) as a localized time of day.</summary>
    string FormatTime(double unixMilliseconds);
}

/// <summary>
/// The production <see cref="ISmallMultiplesTimeFormatter"/>: renders the x value as a locale-aware time of day
/// through the shared <see cref="DateTimeFormatting"/> facade (<see cref="DateTimeVariant.Time"/>) — the same
/// formatting library the web <c>useDateFormat</c> hook wraps. The <c>Time</c> variant is wall-clock only, so the
/// reference <c>now</c> is irrelevant; a non-finite x renders the facade's em-dash fallback. WinUI-free.
/// </summary>
public sealed class SmallMultiplesTimeFormatter : ISmallMultiplesTimeFormatter
{
    /// <summary>The shared singleton instance.</summary>
    public static SmallMultiplesTimeFormatter Instance { get; } = new();

    private SmallMultiplesTimeFormatter()
    {
    }

    /// <inheritdoc />
    public string FormatTime(double unixMilliseconds)
    {
        if (double.IsNaN(unixMilliseconds) || double.IsInfinity(unixMilliseconds))
        {
            return DateTimeFormatting.DefaultEmptyDisplay;
        }

        var instant = DateTimeOffset.FromUnixTimeMilliseconds((long)unixMilliseconds);
        return DateTimeFormatting.Format(instant, DateTimeVariant.Time, instant);
    }
}
