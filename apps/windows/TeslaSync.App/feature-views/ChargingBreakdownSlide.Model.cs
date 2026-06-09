using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargingBreakdownSlide</c> surface — the native union of
/// the states the web component renders
/// (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx). The web source is a pure
/// presentational slide (it takes a <c>data: YearReview</c> prop and performs no fetching), so the branches
/// are a direct function of the input <see cref="ChargingBreakdownSlideModel"/> — there is no fetch-driven
/// error / stale / offline branch to reproduce here. The parent Year-Review experience owns the query
/// lifecycle (loading / error / stale / offline are handled once for the whole slide deck before any slide
/// is shown), exactly as the web <c>SlideRenderer</c> only mounts a slide once <c>data</c> has resolved.
/// Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum ChargingBreakdownSlideState
{
    /// <summary>The Year-Review payload has not arrived yet (the parent is still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no charging activity (<c>total_charge_sessions &lt;= 0</c>) — friendly empty state.</summary>
    Empty,

    /// <summary>At least one charge session to summarise (web fall-through) — the headline + donut + legend.</summary>
    Ready,
}

/// <summary>
/// The render-time data model the <c>ChargingBreakdownSlide</c> view binds to — the native analogue of the
/// web component's <c>data: YearReview</c> prop, narrowed to the charging-habits fields the slide actually
/// reads (<c>total_charge_sessions</c>, <c>avg_charge_start_soc</c>, <c>supercharger_pct</c>,
/// <c>dc_fast_pct</c>, <c>ac_other_pct</c>) plus the fetch flag the parent supplies. The component is
/// presentational; user-facing labels are resolved from the i18n facade by the projection, not passed in.
/// Percentages are 0..100 shares of the charge-session mix; SI on disk — no display conversion is needed
/// for a dimensionless percentage. Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record ChargingBreakdownSlideModel(
    bool Loading,
    long TotalChargeSessions,
    double AverageChargeStartSoc,
    double SuperchargerPercent,
    double DcFastPercent,
    double AcOtherPercent)
{
    /// <summary>The initial model: the Year-Review fetch is in flight and no charging data has arrived yet.</summary>
    public static ChargingBreakdownSlideModel Pending { get; } = new(true, 0, 0, 0, 0, 0);

    /// <summary>A resolved model with no charging activity — the empty state.</summary>
    public static ChargingBreakdownSlideModel Empty { get; } = new(false, 0, 0, 0, 0, 0);
}

/// <summary>
/// One projected, render-ready charging segment — the native analogue of a single recharts <c>&lt;Cell&gt;</c>
/// plus its legend row (web <c>chartData</c> entry). <see cref="Name"/> is the localized connector-type
/// label; <see cref="Percent"/> is its raw 0..100 share; <see cref="PercentText"/> is the rounded
/// <c>Math.round(value)%</c> the legend shows; <see cref="ColorIndex"/> is the zero-based position in the
/// FILTERED segment list (web parity: zero-value segments are dropped before <c>COLORS[i]</c> is applied, so
/// the first surviving segment always takes palette index 0); <see cref="LegendText"/> is the
/// "<c>{name} ({pct}%)</c>" legend caption; and <see cref="AutomationName"/> is the spoken "<c>{name}, {pct}%</c>".
/// Pure data.
/// </summary>
public sealed record ChargingBreakdownSegment(
    string Name,
    double Percent,
    string PercentText,
    int ColorIndex,
    string LegendText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the slide for one input model — the native analogue of what
/// the web <c>ChargingBreakdownSlide</c> renders. Holds the active <see cref="State"/>, the decorative
/// <see cref="Emoji"/>, the resolved "<c>{count} charge sessions</c>" headline (split into
/// <see cref="SessionsValueText"/> + <see cref="SessionsLabel"/> and the combined <see cref="SessionsLine"/>),
/// the interpolated <see cref="AverageSocText"/>, the filtered <see cref="Segments"/>, a spoken
/// <see cref="ChartSummary"/> of the donut, the empty + loading copy, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChargingBreakdownSlideDisplay(
    ChargingBreakdownSlideState State,
    string Emoji,
    string SessionsValueText,
    string SessionsLabel,
    string SessionsLine,
    string AverageSocText,
    IReadOnlyList<ChargingBreakdownSegment> Segments,
    string ChartSummary,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChargingBreakdownSlideModel"/> to its
/// <see cref="ChargingBreakdownSlideDisplay"/> — the native port of
/// web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx. The branch precedence mirrors the
/// web source's data lifecycle (loading → empty → ready); the headline charge-session count renders through
/// <see cref="NumberFormatting"/> (the web number interpolation), the average start-of-charge SoC fills the
/// <c>yearReview.avgStartSOC</c> template (accepting both the resw <c>{0}</c> and the web <c>{{soc}}</c>
/// token forms), and each segment's percentage is rounded with the same half-away-from-zero rule the web's
/// <c>Math.round</c> uses on its non-negative shares. The zero-value segment filter and palette-by-filtered-
/// position colouring are reproduced exactly. Every label resolves through the i18n facade using the same
/// keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargingBreakdownSlideProjection
{
    /// <summary>The decorative electric-plug emoji the web slide leads with (🔌, U+1F50C).</summary>
    public const string Emoji = "\U0001F50C";

    private static readonly (string Key, string Fallback, int Selector)[] SegmentSpecs =
    [
        ("yearReview.supercharger", "Supercharger", 0),
        ("yearReview.dcFast", "DC Fast", 1),
        ("yearReview.acOther", "AC / Other", 2),
    ];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop, narrowed to the charging fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ChargingBreakdownSlideDisplay Project(ChargingBreakdownSlideModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string sessionsValueText = NumberFormatting.Format(model.TotalChargeSessions, null, 0);
        string sessionsLabel = localizer.GetString("yearReview.chargeSessions", "charge sessions");
        string sessionsLine = $"{sessionsValueText} {sessionsLabel}";
        string averageSocText = FormatAverageSoc(model.AverageChargeStartSoc, localizer);
        IReadOnlyList<ChargingBreakdownSegment> segments = BuildSegments(model, localizer);
        string chartSummary = BuildChartSummary(segments);
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        ChargingBreakdownSlideState state = SelectState(model);

        return new ChargingBreakdownSlideDisplay(
            State: state,
            Emoji: Emoji,
            SessionsValueText: sessionsValueText,
            SessionsLabel: sessionsLabel,
            SessionsLine: sessionsLine,
            AverageSocText: averageSocText,
            Segments: segments,
            ChartSummary: chartSummary,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(state, sessionsLine, averageSocText, chartSummary, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty → ready.</summary>
    private static ChargingBreakdownSlideState SelectState(ChargingBreakdownSlideModel model)
    {
        if (model.Loading)
        {
            return ChargingBreakdownSlideState.Loading;
        }

        // A Year-Review with no charge sessions has no charging story to break down — collapse the whole
        // slide to a friendly empty state rather than charting an all-zero donut.
        return model.TotalChargeSessions <= 0
            ? ChargingBreakdownSlideState.Empty
            : ChargingBreakdownSlideState.Ready;
    }

    private static IReadOnlyList<ChargingBreakdownSegment> BuildSegments(
        ChargingBreakdownSlideModel model,
        ILocalizer localizer)
    {
        var segments = new List<ChargingBreakdownSegment>(SegmentSpecs.Length);
        foreach (var spec in SegmentSpecs)
        {
            double value = SelectPercent(model, spec.Selector);

            // Web parity: chartData = items.filter(d => d.value > 0) — a zero (or negative) share is dropped
            // entirely, which is what shifts the palette so the first surviving segment takes colour 0.
            if (value <= 0)
            {
                continue;
            }

            string name = localizer.GetString(spec.Key, spec.Fallback);
            string percentText = NumberFormatting.Format(value, null, 0) + "%";
            int colorIndex = segments.Count;

            segments.Add(new ChargingBreakdownSegment(
                Name: name,
                Percent: value,
                PercentText: percentText,
                ColorIndex: colorIndex,
                LegendText: $"{name} ({percentText})",
                AutomationName: $"{name}, {percentText}"));
        }

        return segments.Count == 0 ? Array.Empty<ChargingBreakdownSegment>() : segments;
    }

    private static double SelectPercent(ChargingBreakdownSlideModel model, int selector) => selector switch
    {
        0 => model.SuperchargerPercent,
        1 => model.DcFastPercent,
        _ => model.AcOtherPercent,
    };

    private static string BuildChartSummary(IReadOnlyList<ChargingBreakdownSegment> segments)
    {
        if (segments.Count == 0)
        {
            return string.Empty;
        }

        var parts = new List<string>(segments.Count);
        foreach (var segment in segments)
        {
            parts.Add($"{segment.Name} {segment.PercentText}");
        }

        return string.Join(", ", parts);
    }

    // Web: t('yearReview.avgStartSOC', { soc: Math.round(data.avg_charge_start_soc), defaultValue:
    // 'Average plug-in at {{soc}}% battery' }). The resw catalog stores the indexed {0} form while the web
    // fallback uses the {{soc}} token, so substitute both — production (resw) and headless (passthrough
    // fallback) then resolve identically. NumberFormatting rounds half-away-from-zero, matching Math.round
    // for the non-negative SoC domain.
    private static string FormatAverageSoc(double soc, ILocalizer localizer)
    {
        string socText = NumberFormatting.Format(soc, null, 0);
        string template = localizer.GetString("yearReview.avgStartSOC", "Average plug-in at {{soc}}% battery");
        return template
            .Replace("{{soc}}", socText, StringComparison.Ordinal)
            .Replace("{0}", socText, StringComparison.Ordinal);
    }

    private static string BuildAutomationName(
        ChargingBreakdownSlideState state,
        string sessionsLine,
        string averageSocText,
        string chartSummary,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            ChargingBreakdownSlideState.Loading => loadingLabel,
            ChargingBreakdownSlideState.Empty => emptyMessage,
            _ => chartSummary.Length > 0
                ? string.Create(CultureInfo.CurrentCulture, $"{sessionsLine}. {averageSocText}. {chartSummary}")
                : string.Create(CultureInfo.CurrentCulture, $"{sessionsLine}. {averageSocText}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargingBreakdownSlide</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a session count, SoC, or
/// charging share — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class ChargingBreakdownSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingBreakdownSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingBreakdownSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingBreakdownSlideRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargingBreakdownSlide</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx</c>.
/// </summary>
public static class ChargingBreakdownSlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingBreakdownSlide";
}
