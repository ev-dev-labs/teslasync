using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChartTooltip"/> view — the native port of the
/// web component's props-driven body (web/src/components/charts/ChartTooltip.tsx). The web component is a pure
/// function of its recharts props (<c>active</c>, <c>payload</c>, <c>label</c>); this holder mirrors that by
/// recomputing a <see cref="ChartTooltipProjection"/> whenever the chart pushes the hovered state through
/// <see cref="Update"/> (or clears it through <see cref="Clear"/>), raising <see cref="PropertyChanged"/> so
/// the view re-renders its floating panel. Any custom value / label formatters (the web
/// <c>valueFormatter</c> / <c>labelFormatter</c> props) are captured once at construction. There is no
/// loading / error / stale / offline state because the component reads no network data — its only states are
/// hidden (inactive cursor or empty payload) and visible, exactly as the web source's
/// <c>if (!active || !payload?.length) return null</c>.
/// </summary>
public sealed class ChartTooltipViewModel : INotifyPropertyChanged
{
    private readonly ChartTooltipValueFormatter? _valueFormatter;
    private readonly ChartTooltipLabelFormatter? _labelFormatter;
    private readonly ChartTooltipTimestampFormatter? _timestampFormatter;
    private ChartTooltipProjection _projection = ChartTooltipProjection.Hidden;

    /// <summary>
    /// Creates the holder over optional custom formatters. With no arguments the surface uses the web default
    /// number/unit value formatting and the ISO-aware label formatting; supply the formatters to mirror a
    /// chart that passes the web <c>valueFormatter</c> / <c>labelFormatter</c> props.
    /// </summary>
    /// <param name="valueFormatter">An optional custom value formatter (web <c>valueFormatter</c> prop).</param>
    /// <param name="labelFormatter">An optional custom label formatter (web <c>labelFormatter</c> prop).</param>
    /// <param name="timestampFormatter">The timestamp renderer the default label formatter delegates to (defaults to the locale + local-timezone formatter).</param>
    public ChartTooltipViewModel(
        ChartTooltipValueFormatter? valueFormatter = null,
        ChartTooltipLabelFormatter? labelFormatter = null,
        ChartTooltipTimestampFormatter? timestampFormatter = null)
    {
        _valueFormatter = valueFormatter;
        _labelFormatter = labelFormatter;
        _timestampFormatter = timestampFormatter;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ChartTooltip</c>).</summary>
    public static string Slug => ChartTooltipRegistration.Slug;

    /// <summary>The current render projection (visibility + header + rows + accessible text).</summary>
    public ChartTooltipProjection Projection => _projection;

    /// <summary>Whether the tooltip currently renders (web: active cursor AND non-empty payload).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The current formatted header text.</summary>
    public string Label => _projection.Label;

    /// <summary>The current formatted rows (one per visible series).</summary>
    public IReadOnlyList<ChartTooltipSeriesRow> Rows => _projection.Rows;

    /// <summary>The current flattened accessible announcement for the surface.</summary>
    public string AccessibleText => _projection.AccessibleText;

    /// <summary>
    /// Push the recharts hover state (web props <c>active</c> / <c>payload</c> / <c>label</c>) and recompute
    /// the projection. Raises <see cref="PropertyChanged"/> only when the projection actually changes.
    /// </summary>
    /// <param name="active">Whether the cursor is active over the plot.</param>
    /// <param name="payload">The hovered series points, or null/empty to hide the tooltip.</param>
    /// <param name="label">The active category / x label.</param>
    public void Update(bool active, IReadOnlyList<ChartTooltipPoint>? payload, object? label) =>
        Apply(ChartTooltipProjection.Project(
            active,
            payload,
            label,
            _valueFormatter,
            _labelFormatter,
            _timestampFormatter));

    /// <summary>Hide the tooltip — the web inactive-cursor branch (<c>return null</c>).</summary>
    public void Clear() => Apply(ChartTooltipProjection.Hidden);

    private void Apply(ChartTooltipProjection next)
    {
        if (next.Equals(_projection))
        {
            return;
        }

        bool visibilityChanged = next.IsVisible != _projection.IsVisible;
        bool labelChanged = !string.Equals(next.Label, _projection.Label, StringComparison.Ordinal);
        _projection = next;

        Raise(nameof(Projection));
        Raise(nameof(Rows));
        Raise(nameof(AccessibleText));
        if (visibilityChanged)
        {
            Raise(nameof(IsVisible));
        }

        if (labelChanged)
        {
            Raise(nameof(Label));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
