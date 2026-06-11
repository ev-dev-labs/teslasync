namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the ChartTooltip surface — the native analogue of the module-level constants and
/// ARIA attributes in <c>web/src/components/charts/ChartTooltip.tsx</c>. The web component is an anonymous,
/// pure presentational recharts custom tooltip (it renders no titles or labels of its own — the header and
/// series names come from the chart data), so this carries the diagnostics slug, an automation id for
/// UI tests, the <c>role="tooltip"</c> / <c>aria-live="polite"</c> contract and the parity dimensions the
/// view composes from (the 10&#215;10 colour swatch — web <c>h-2.5 w-2.5</c> — and the 12px corner radius —
/// web <c>rounded-xl</c>).
/// </summary>
public static class ChartTooltipRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ChartTooltip";

    /// <summary>The root automation id the WinUI view exposes so UI tests can locate the floating panel.</summary>
    public const string RootAutomationId = "chart-tooltip";

    /// <summary>The ARIA role the web container declares (<c>role="tooltip"</c>).</summary>
    public const string Role = "tooltip";

    /// <summary>The ARIA live urgency the web container declares (<c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The colour-swatch diameter in DIPs — the web <c>h-2.5 w-2.5</c> (10px) dot.</summary>
    public const double SwatchDiameter = 10d;

    /// <summary>The panel corner radius in DIPs — the web <c>rounded-xl</c> (12px).</summary>
    public const double CornerRadius = 12d;
}

/// <summary>
/// One rendered tooltip row — the native projection of a single web payload entry's rendered DOM
/// (the swatch + <c>name:</c> + value/unit triplet in web/src/components/charts/ChartTooltip.tsx). A value
/// type so per-state projections compare by value in tests.
/// </summary>
/// <param name="Name">The series name (web <c>p.name</c>), rendered before the colon.</param>
/// <param name="ValueText">The formatted value text (web default <c>fmtNumber</c> / <c>String(value)</c>, or the custom formatter output).</param>
/// <param name="Unit">The optional unit suffix rendered dimmed (web <c>opacity-60</c> span); empty when a custom value formatter owns the whole value.</param>
/// <param name="SwatchColorHex">The swatch colour (web <c>p.color || p.fill</c>), or null when the series carries no colour.</param>
public readonly record struct ChartTooltipSeriesRow(
    string Name,
    string ValueText,
    string Unit,
    string? SwatchColorHex);

/// <summary>
/// Pure projection of the tooltip's render inputs — the native port of the web <c>ChartTooltipBase</c> body
/// (web/src/components/charts/ChartTooltip.tsx). It captures the two top-level decisions the web component
/// makes: visibility (<c>!active || !payload?.length</c> renders nothing) and, when visible, the formatted
/// header plus one formatted row per payload point. Kept free of any WinUI type so the adapter is
/// unit-testable headlessly; the <see cref="ChartTooltipViewModel"/> and the WinUI view both render from it.
/// </summary>
public sealed class ChartTooltipProjection : IEquatable<ChartTooltipProjection>
{
    private ChartTooltipProjection(bool isVisible, string label, IReadOnlyList<ChartTooltipSeriesRow> rows)
    {
        IsVisible = isVisible;
        Label = label;
        Rows = rows;
        AccessibleText = BuildAccessibleText(label, rows);
    }

    /// <summary>
    /// The hidden projection — the web <c>return null</c> branch (inactive cursor or empty payload). A shared
    /// instance because it carries no data.
    /// </summary>
    public static ChartTooltipProjection Hidden { get; } =
        new(isVisible: false, label: string.Empty, rows: Array.Empty<ChartTooltipSeriesRow>());

    /// <summary>Whether the tooltip renders (web: active cursor AND a non-empty payload).</summary>
    public bool IsVisible { get; }

    /// <summary>The formatted header text (web <c>labelFormatter(label)</c>); empty when there is no label.</summary>
    public string Label { get; }

    /// <summary>One formatted row per visible series (web <c>payload.map(...)</c>).</summary>
    public IReadOnlyList<ChartTooltipSeriesRow> Rows { get; }

    /// <summary>
    /// The flattened accessible announcement for the whole tooltip — the header followed by each
    /// "name: value unit" row, joined with "; ". The colour swatches are decorative (the web
    /// <c>aria-hidden</c> dots), so they are not voiced. The WinUI view sets this as the surface's
    /// automation name on the <c>role="tooltip"</c> / polite live region so Narrator reads the hovered values.
    /// </summary>
    public string AccessibleText { get; }

    /// <summary>
    /// Project the render inputs — the native port of <c>ChartTooltipBase</c>. When
    /// <paramref name="active"/> is false or <paramref name="payload"/> is empty the result is
    /// <see cref="Hidden"/> (web <c>return null</c>). Otherwise the header is resolved through
    /// <paramref name="labelFormatter"/> or the default ISO-aware formatter, and each point becomes a row whose
    /// value comes from <paramref name="valueFormatter"/> (which then owns the unit) or the default
    /// number/unit split.
    /// </summary>
    /// <param name="active">Whether the recharts cursor is active over the plot.</param>
    /// <param name="payload">The hovered series points, or null/empty when there is nothing to show.</param>
    /// <param name="label">The active category / x label (web <c>label</c>).</param>
    /// <param name="valueFormatter">An optional custom value formatter (web <c>valueFormatter</c> prop).</param>
    /// <param name="labelFormatter">An optional custom label formatter (web <c>labelFormatter</c> prop).</param>
    /// <param name="timestampFormatter">The timestamp renderer the default label formatter delegates to.</param>
    public static ChartTooltipProjection Project(
        bool active,
        IReadOnlyList<ChartTooltipPoint>? payload,
        object? label,
        ChartTooltipValueFormatter? valueFormatter = null,
        ChartTooltipLabelFormatter? labelFormatter = null,
        ChartTooltipTimestampFormatter? timestampFormatter = null)
    {
        // web: if (!active || !payload?.length) return null
        if (!active || payload is null || payload.Count == 0)
        {
            return Hidden;
        }

        ChartTooltipTimestampFormatter timestamp = timestampFormatter ?? ChartTooltipFormatting.FormatTimestamp;
        string header = labelFormatter is null
            ? ChartTooltipFormatting.DefaultLabel(label, timestamp)
            : labelFormatter(label);

        var rows = new List<ChartTooltipSeriesRow>(payload.Count);
        foreach (ChartTooltipPoint point in payload)
        {
            string name = point.Name ?? string.Empty;
            string valueText;
            string unit;
            if (valueFormatter is null)
            {
                valueText = ChartTooltipFormatting.DefaultValue(point.Value);
                unit = point.Unit ?? string.Empty;
            }
            else
            {
                // web: a custom valueFormatter returns the whole node, so it subsumes the unit span.
                valueText = valueFormatter(point.Value, name, point.Unit);
                unit = string.Empty;
            }

            rows.Add(new ChartTooltipSeriesRow(name, valueText, unit, point.SwatchColorHex));
        }

        return new ChartTooltipProjection(isVisible: true, label: header, rows: rows);
    }

    /// <inheritdoc />
    public bool Equals(ChartTooltipProjection? other)
    {
        if (other is null)
        {
            return false;
        }

        if (ReferenceEquals(this, other))
        {
            return true;
        }

        return IsVisible == other.IsVisible
            && string.Equals(Label, other.Label, StringComparison.Ordinal)
            && Rows.SequenceEqual(other.Rows);
    }

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as ChartTooltipProjection);

    /// <inheritdoc />
    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(IsVisible);
        hash.Add(Label, StringComparer.Ordinal);
        foreach (ChartTooltipSeriesRow row in Rows)
        {
            hash.Add(row);
        }

        return hash.ToHashCode();
    }

    private static string BuildAccessibleText(string label, IReadOnlyList<ChartTooltipSeriesRow> rows)
    {
        var parts = new List<string>(rows.Count + 1);
        if (!string.IsNullOrEmpty(label))
        {
            parts.Add(label);
        }

        foreach (ChartTooltipSeriesRow row in rows)
        {
            string value = string.IsNullOrEmpty(row.Unit) ? row.ValueText : $"{row.ValueText} {row.Unit}";
            parts.Add($"{row.Name}: {value}");
        }

        return string.Join("; ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the ChartTooltip surface (P1/S11 diagnostics contract). Tooltip rows can carry
/// user-facing values, so the collector records only the operational <c>view.opened</c> event with the
/// surface slug — never the hovered data. Thread-safe.
/// </summary>
public sealed class ChartTooltipDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ChartTooltipDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartTooltip</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChartTooltipRegistration.Slug}");
    }
}
