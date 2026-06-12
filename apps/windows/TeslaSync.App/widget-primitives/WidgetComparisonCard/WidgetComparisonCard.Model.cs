using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// One period-over-period metric a <see cref="WidgetComparisonCard"/> renders as a row — the native port of the
/// web <c>ComparisonMetric</c> interface
/// (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx L4-L11). The caller supplies the
/// already-formatted current figure (<see cref="FormattedCurrent"/>) and the optional unit suffix exactly as the
/// web parent does (the card never formats values itself); the raw <see cref="Current"/> / <see cref="Previous"/>
/// pair feeds the trailing <see cref="Delta"/> percent indicator and <see cref="HigherIsBetter"/> decides whether
/// a rise is a good or bad outcome (web <c>higherIsBetter ?? true</c>).
/// </summary>
public sealed record ComparisonMetric
{
    /// <summary>The row label, e.g. "Efficiency" (web <c>label</c>); null normalises to empty at projection.</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The current-period value feeding the trailing delta (web <c>current</c>).</summary>
    public double Current { get; init; }

    /// <summary>The previous-period value feeding the trailing delta (web <c>previous</c>).</summary>
    public double Previous { get; init; }

    /// <summary>The pre-formatted, already-localized current figure shown as the row value (web <c>formattedCurrent</c>).</summary>
    public string FormattedCurrent { get; init; } = string.Empty;

    /// <summary>The optional unit suffix shown after the value, e.g. "Wh/mi" (web <c>unit</c>); null / empty hides it.</summary>
    public string? Unit { get; init; }

    /// <summary>
    /// Whether a higher value is the desirable outcome (web <c>higherIsBetter</c>, defaulting to <c>true</c>).
    /// Maps to the delta's <see cref="MetricDirection.HigherBetter"/> / <see cref="MetricDirection.LowerBetter"/>.
    /// </summary>
    public bool HigherIsBetter { get; init; } = true;
}

/// <summary>
/// The full set of inputs for one <see cref="WidgetComparisonCard"/> — the native port of the web
/// <c>WidgetComparisonCardProps</c> (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx
/// L13-L16). The web card is purely presentational: the parent widget computes the metrics and supplies the
/// pre-formatted figures, so this record simply carries the metric list and the compact flag. A null metric list
/// normalises to empty so the projection never dereferences null.
/// </summary>
public sealed record WidgetComparisonCardInput
{
    /// <summary>The comparison rows to render (web <c>metrics</c>); never null after construction.</summary>
    public IReadOnlyList<ComparisonMetric> Metrics { get; init; } = Array.Empty<ComparisonMetric>();

    /// <summary>
    /// When true the card renders only the first <see cref="WidgetComparisonCardRegistration.CompactVisibleLimit"/>
    /// metrics in a tighter form (web <c>compact</c> → <c>metrics.slice(0, 2)</c>, L50).
    /// </summary>
    public bool Compact { get; init; }
}

/// <summary>
/// The render-ready projection of one visible metric — everything the WinUI view needs to draw a row without
/// recomputing anything. It is the native analogue of the web <c>MetricRow</c>
/// (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx L18-L44): the truncating label and value,
/// the optional unit suffix and the <see cref="DeltaInput"/> the trailing percent indicator is built from
/// (an inline direction-only semantic, percent display, small size — mirroring the web <c>&lt;Delta&gt;</c>
/// props at L35-L41).
/// </summary>
public sealed class WidgetComparisonCardRow
{
    internal WidgetComparisonCardRow(
        string label,
        string formattedCurrent,
        string unit,
        DeltaInput deltaInput,
        string accessibleName)
    {
        Label = label;
        FormattedCurrent = formattedCurrent;
        Unit = unit;
        DeltaInput = deltaInput;
        AccessibleName = accessibleName;
    }

    /// <summary>The row label (web <c>label</c> span); empty when none was supplied.</summary>
    public string Label { get; }

    /// <summary>The pre-formatted current value (web <c>formattedCurrent</c>); an em-dash when none was supplied.</summary>
    public string FormattedCurrent { get; }

    /// <summary>The unit suffix shown after the value (web <c>unit</c>); empty when none.</summary>
    public string Unit { get; }

    /// <summary>True when a unit suffix should be drawn (web <c>metric.unit &amp;&amp; …</c>, L28).</summary>
    public bool HasUnit => !string.IsNullOrEmpty(Unit);

    /// <summary>
    /// The inputs the trailing <see cref="Delta"/> indicator is built from — an inline direction-only semantic
    /// (the web <c>{ direction }</c> object, no unit), the current/previous pair, percent display and small size
    /// (web L35-L41). The view constructs a live <see cref="Delta"/> control over these so the percent maths and
    /// the direction-aware colour are shared one-for-one with the standalone delta surface.
    /// </summary>
    public DeltaInput DeltaInput { get; }

    /// <summary>The Narrator name for the row's label + value (the trailing delta carries its own name).</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// The render-ready projection of one <see cref="WidgetComparisonCardInput"/> — the native port of the web
/// <c>WidgetComparisonCard</c> body
/// (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx L46-L65). It reproduces the web's two
/// branches exactly: the empty branch (web L52-L56, the muted "No comparison data" line) and the populated
/// branch (web L58-L63, the column of metric rows). The web component is purely presentational — it renders the
/// already-resolved props passed by its parent widget and has no fetch lifecycle, so there is no loading / error
/// / stale / offline branch, exactly like the other presentational shared surfaces (e.g. <c>Delta</c>,
/// <c>KpiOverviewCard</c>).
/// </summary>
public sealed class WidgetComparisonCardDisplay
{
    internal WidgetComparisonCardDisplay(
        bool isEmpty,
        bool compact,
        IReadOnlyList<WidgetComparisonCardRow> rows,
        string emptyMessage,
        string accessibleName)
    {
        IsEmpty = isEmpty;
        Compact = compact;
        Rows = rows;
        EmptyMessage = emptyMessage;
        AccessibleName = accessibleName;
    }

    /// <summary>True when there are no visible metrics and the muted empty line is shown (web <c>visible.length === 0</c>).</summary>
    public bool IsEmpty { get; }

    /// <summary>True when the card is rendering in its tighter compact form (web <c>compact</c>).</summary>
    public bool Compact { get; }

    /// <summary>The visible metric rows in order (web <c>visible.map(...)</c>); empty in the empty branch.</summary>
    public IReadOnlyList<WidgetComparisonCardRow> Rows { get; }

    /// <summary>The localized "No comparison data" line shown in the empty branch (web L54).</summary>
    public string EmptyMessage { get; }

    /// <summary>The Narrator name for the surface — the empty message when empty, else the row count summary is carried by the rows.</summary>
    public string AccessibleName { get; }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="WidgetComparisonCardInput"/> into a render-ready
/// <see cref="WidgetComparisonCardDisplay"/> — the native port of the web <c>WidgetComparisonCard</c> +
/// <c>MetricRow</c> bodies (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx L18-L65). It slices
/// the compact view, normalises the per-metric strings, maps <c>higherIsBetter</c> to a delta direction and
/// builds each row's <see cref="DeltaInput"/>. It performs no value formatting (the parent supplies
/// <see cref="ComparisonMetric.FormattedCurrent"/>) and touches no view framework, so both the WinUI view and the
/// unit tests share one source of truth.
/// </summary>
public static class WidgetComparisonCardProjection
{
    /// <summary>
    /// Project <paramref name="input"/> into the render-ready display, resolving the empty-line text through
    /// <paramref name="localizer"/>. Reproduces the web branch order exactly: slice the compact view (web L50),
    /// then the empty branch when there are no rows (web L52-L56), else the populated rows (web L58-L63).
    /// </summary>
    /// <param name="input">The presentational inputs; never null.</param>
    /// <param name="localizer">The i18n facade used for the empty-line text; never null.</param>
    /// <returns>The render-ready projection.</returns>
    public static WidgetComparisonCardDisplay Project(WidgetComparisonCardInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        IEnumerable<ComparisonMetric> source = (input.Metrics ?? Array.Empty<ComparisonMetric>())
            .Where(static m => m is not null);

        // web L50: const visible = compact ? metrics.slice(0, 2) : metrics.
        List<ComparisonMetric> visible = (input.Compact
                ? source.Take(WidgetComparisonCardRegistration.CompactVisibleLimit)
                : source)
            .ToList();

        // web L52-L56: empty branch — a single muted "No comparison data" line.
        if (visible.Count == 0)
        {
            string emptyMessage = WidgetComparisonCardRegistration.NoComparison(localizer);
            return new WidgetComparisonCardDisplay(
                isEmpty: true,
                compact: input.Compact,
                rows: Array.Empty<WidgetComparisonCardRow>(),
                emptyMessage: emptyMessage,
                accessibleName: emptyMessage);
        }

        // web L58-L63: populated branch — the column of metric rows.
        var rows = new List<WidgetComparisonCardRow>(visible.Count);
        foreach (ComparisonMetric metric in visible)
        {
            rows.Add(BuildRow(metric));
        }

        return new WidgetComparisonCardDisplay(
            isEmpty: false,
            compact: input.Compact,
            rows: rows,
            emptyMessage: string.Empty,
            accessibleName: string.Empty);
    }

    private static WidgetComparisonCardRow BuildRow(ComparisonMetric metric)
    {
        string label = metric.Label ?? string.Empty;

        // The parent always supplies a formatted figure; fall back to an em-dash so a row is never blank.
        string formatted = string.IsNullOrEmpty(metric.FormattedCurrent)
            ? WidgetComparisonCardRegistration.EmDash
            : metric.FormattedCurrent;

        string unit = metric.Unit ?? string.Empty;

        // web L19-L20: direction = higherIsBetter ? 'higher_better' : 'lower_better'.
        MetricDirection direction = metric.HigherIsBetter
            ? MetricDirection.HigherBetter
            : MetricDirection.LowerBetter;

        // web L35-L41: <Delta metric={{ direction }} current previous display="percent" size="sm" />.
        var deltaInput = new DeltaInput
        {
            Metric = DeltaMetrics.Inline(direction),
            Current = metric.Current,
            Previous = metric.Previous,
            Display = DeltaDisplayMode.Percent,
            Size = DeltaSize.Sm,
        };

        string accessibleName = string.IsNullOrEmpty(unit)
            ? $"{label}, {formatted}"
            : $"{label}, {formatted} {unit}";

        return new WidgetComparisonCardRow(label, formatted, unit, deltaInput, accessibleName);
    }
}

/// <summary>
/// Canonical metadata + localized strings for the WidgetComparisonCard surface — the native analogue of the
/// module-level identity of web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx. The web source
/// is anonymous (it has no <c>t()</c> calls and hardcodes its single "No comparison data" line, L54); the native
/// port routes that one string through the shared i18n facade (P1/S10) using the existing catalog entry the
/// standalone <c>Delta</c> surface already owns (<c>translation.delta.noComparison</c>, the identical string), so
/// no English literal ships in native code and the auto-generated resource catalog needs no hand edit.
/// </summary>
public static class WidgetComparisonCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "WidgetComparisonCard";

    /// <summary>
    /// i18n key for the empty-line text — reused from the <c>Delta</c> surface's catalog entry
    /// (<c>translation.delta.noComparison</c> = "No comparison data"), the identical string the web card
    /// hardcodes (L54). Shared so the one catalog entry localizes both surfaces consistently.
    /// </summary>
    public const string NoComparisonKey = DeltaRegistration.NoComparisonKey;

    /// <summary>The number of metrics shown in the compact form (web <c>slice(0, 2)</c>, L50).</summary>
    public const int CompactVisibleLimit = 2;

    /// <summary>The em-dash shown when a row has no formatted value (the null-safety fallback for a blank value).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Localized empty-line text (web hardcoded "No comparison data", L54, via the shared Delta key).</summary>
    /// <param name="localizer">The i18n facade; never null.</param>
    /// <returns>The localized "No comparison data" line.</returns>
    public static string NoComparison(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NoComparisonKey, "No comparison data");
    }
}

/// <summary>
/// PII-safe diagnostics for the WidgetComparisonCard surface (P1/S11 diagnostics contract). The card frames
/// user-facing metric values, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never a label, value or percent. Thread-safe; mirrors the other shared-surface
/// diagnostics collectors.
/// </summary>
public sealed class WidgetComparisonCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event string is forwarded to.</param>
    public WidgetComparisonCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetComparisonCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WidgetComparisonCardRegistration.Slug}");
    }
}
