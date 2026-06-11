using System.Globalization;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Recharts <c>ifOverflow</c> behaviour — the native port of the web <c>TimeMarker</c> prop union
/// (web/src/components/charts/TimeMarker.tsx L37: <c>'discard' | 'hidden' | 'visible' | 'extendDomain'</c>).
/// It governs how the host chart treats a marker whose x falls outside the current axis domain;
/// <see cref="ExtendDomain"/> is the web default so the marker stays visible when the alert moment sits just
/// beyond the chart window. Carried verbatim through the projection so the native host can honour the same
/// behaviour when it positions the rule on its overlay; it is render-irrelevant to a standalone marker but is
/// part of the faithful prop surface.
/// </summary>
public enum TimeMarkerOverflow
{
    /// <summary>web <c>'discard'</c> — drop the marker when it overflows the domain.</summary>
    Discard,

    /// <summary>web <c>'hidden'</c> — keep the marker in layout but clip it at the plot edge.</summary>
    Hidden,

    /// <summary>web <c>'visible'</c> — let the marker draw past the plot edge.</summary>
    Visible,

    /// <summary>web <c>'extendDomain'</c> — grow the axis domain so the marker is in-bounds (the web default).</summary>
    ExtendDomain,
}

/// <summary>
/// The marker stroke palette — the native port of the web <c>SEVERITY_STROKE</c> map
/// (web/src/components/charts/TimeMarker.tsx L42-L47). These are the component's own chart-stroke hexes,
/// deliberately separate from the shared <c>severityTokens</c> brush keys (web re-exports
/// <c>severityTokens</c> for callers that want to colour-coordinate other chart elements, but the rule itself
/// is drawn with these exact values). The canonical level is resolved with <see cref="SeverityLevels.Normalize"/>
/// (the native port of web <c>normalizeSeverity</c>) before the lookup, so every legacy wire alias
/// (<c>warning</c> / <c>error</c> / <c>fatal</c> / <c>ok</c>) maps to the same colour the web would pick.
/// UI-free so it is asserted without a brush host.
/// </summary>
public static class TimeMarkerStroke
{
    /// <summary>web <c>SEVERITY_STROKE.info</c>.</summary>
    public const string Info = "#0ea5e9";

    /// <summary>web <c>SEVERITY_STROKE.warn</c> — also the defensive fallback (web <c>?? SEVERITY_STROKE.warn</c>).</summary>
    public const string Warn = "#f59e0b";

    /// <summary>web <c>SEVERITY_STROKE.critical</c>.</summary>
    public const string Critical = "#ef4444";

    /// <summary>web <c>SEVERITY_STROKE.success</c>.</summary>
    public const string Success = "#10b981";

    /// <summary>
    /// The stroke hex for a canonical severity (web <c>SEVERITY_STROKE[sev] ?? SEVERITY_STROKE.warn</c>). The
    /// enum is always one of the four mapped levels, so the warn fallback only guards an out-of-range value.
    /// </summary>
    public static string Hex(SeverityLevel level) => level switch
    {
        SeverityLevel.Info => Info,
        SeverityLevel.Warn => Warn,
        SeverityLevel.Critical => Critical,
        SeverityLevel.Success => Success,
        _ => Warn,
    };
}

/// <summary>
/// The component props of the web <c>TimeMarker</c> (web/src/components/charts/TimeMarker.tsx L22-L40) as an
/// immutable native value — the input the <see cref="TimeMarkerProjection"/> resolves into a render shape.
/// <see cref="X"/> is the x-axis key for the marked moment (the value the host chart matches against its
/// <c>dataKey</c>); a <see langword="null"/> or empty value renders nothing (web
/// <c>if (x == null || x === '') return null;</c>). The remaining members mirror the optional props verbatim,
/// including the unset (<see langword="null"/>) state so the projection can apply the web defaults. UI-free so
/// it is unit-tested headlessly.
/// </summary>
/// <param name="X">The x-axis key for the marked moment (web <c>x</c>); null/empty hides the marker.</param>
public sealed record TimeMarkerInput(string? X)
{
    /// <summary>The underlying severity (web <c>severity?</c>); <see langword="null"/> defaults to <c>warn</c>.</summary>
    public string? Severity { get; init; }

    /// <summary>The label drawn beside the marker (web <c>label?</c>); <see langword="null"/> uses the localized default.</summary>
    public string? Label { get; init; }

    /// <summary>The dash pattern (web <c>strokeDasharray?</c>); <see langword="null"/> draws a solid rule.</summary>
    public string? StrokeDasharray { get; init; }

    /// <summary>The stroke width (web <c>strokeWidth?</c>); <see langword="null"/> defaults to <c>2</c>.</summary>
    public double? StrokeWidth { get; init; }

    /// <summary>The overflow behaviour (web <c>ifOverflow?</c>); <see langword="null"/> defaults to <see cref="TimeMarkerOverflow.ExtendDomain"/>.</summary>
    public TimeMarkerOverflow? IfOverflow { get; init; }

    /// <summary>The host chart's y-axis id for multi-axis charts (web <c>yAxisId?</c>); <see langword="null"/> when unset.</summary>
    public string? YAxisId { get; init; }

    /// <summary>
    /// Build the marker input from an <see cref="AlertMarkerContext"/> the way the alert drill-through pages do
    /// (web BatteryHealthPage: <c>x={timestamp ? formatDateShort(timestamp) : null}</c>,
    /// <c>severity={alertCtx.signal ? 'critical' : undefined}</c>). The raw alert timestamp is the x key (a
    /// host formats it to match its axis; its presence alone drives visibility, exactly as the web's
    /// <c>alertMarkerLabel</c> is null precisely when the timestamp is absent) and the presence of a focused
    /// signal escalates the severity to <c>critical</c>, otherwise the severity is left unset so the projection
    /// applies the web <c>warn</c> default.
    /// </summary>
    /// <param name="context">The alert drill-through context (the <c>useAlertContext</c> seam).</param>
    public static TimeMarkerInput FromAlertContext(AlertMarkerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return new TimeMarkerInput(context.Timestamp)
        {
            Severity = context.Signal is null ? null : "critical",
        };
    }
}

/// <summary>
/// The resolved render shape of a time marker — the native projection of the web <c>TimeMarker</c> body
/// (web/src/components/charts/TimeMarker.tsx L49-L77). When <see cref="IsVisible"/> is <see langword="false"/>
/// the surface contributes nothing (the web <c>return null</c> branch) and the remaining members are inert
/// defaults. When visible, <see cref="StrokeHex"/> is the severity stroke, <see cref="Label"/> the resolved
/// label, and the stroke/overflow members carry the web-default-applied values. UI-free (a <c>#rrggbb</c>
/// string, not a brush) so it is asserted without a XAML host; the view parses the hex at the display boundary.
/// </summary>
public sealed record TimeMarkerDisplay
{
    /// <summary>The render shape for a hidden marker (web <c>return null</c>) — nothing is drawn.</summary>
    public static TimeMarkerDisplay Hidden { get; } = new()
    {
        IsVisible = false,
        XKey = string.Empty,
        Severity = SeverityLevel.Warn,
        StrokeHex = TimeMarkerStroke.Warn,
        Label = string.Empty,
        StrokeWidth = TimeMarkerRegistration.DefaultStrokeWidth,
        StrokeDasharray = null,
        IfOverflow = TimeMarkerOverflow.ExtendDomain,
        YAxisId = null,
    };

    /// <summary>True when the marker is drawn (web: <c>x</c> is non-null and non-empty).</summary>
    public bool IsVisible { get; init; }

    /// <summary>The x-axis key the host positions the rule at (web <c>x</c>); empty when hidden.</summary>
    public string XKey { get; init; } = string.Empty;

    /// <summary>The canonical severity that selected <see cref="StrokeHex"/> (web normalized severity).</summary>
    public SeverityLevel Severity { get; init; } = SeverityLevel.Warn;

    /// <summary>The stroke colour as <c>#rrggbb</c> (web <c>SEVERITY_STROKE[sev]</c>).</summary>
    public string StrokeHex { get; init; } = TimeMarkerStroke.Warn;

    /// <summary>The label text drawn beside the rule (web <c>label</c>); the rule fill also colours this text.</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>The rule width (web <c>strokeWidth</c>, default 2).</summary>
    public double StrokeWidth { get; init; } = TimeMarkerRegistration.DefaultStrokeWidth;

    /// <summary>The dash pattern (web <c>strokeDasharray</c>); <see langword="null"/> means a solid rule.</summary>
    public string? StrokeDasharray { get; init; }

    /// <summary>The overflow behaviour (web <c>ifOverflow</c>, default extend-domain).</summary>
    public TimeMarkerOverflow IfOverflow { get; init; } = TimeMarkerOverflow.ExtendDomain;

    /// <summary>The host chart's y-axis id (web <c>yAxisId</c>); <see langword="null"/> when unset.</summary>
    public string? YAxisId { get; init; }

    /// <summary>The label font size in pixels (web <c>label.fontSize: 10</c>).</summary>
    public double LabelFontSize { get; init; } = TimeMarkerRegistration.LabelFontSize;

    /// <summary>True when a dashed rule should render (a non-empty dash pattern was supplied).</summary>
    public bool IsDashed => !string.IsNullOrEmpty(StrokeDasharray);
}

/// <summary>
/// Pure projection of the web <c>TimeMarker</c> props into a render shape — the native port of the component
/// body (web/src/components/charts/TimeMarker.tsx L49-L77). Reproduces the web logic exactly: the null/empty
/// <c>x</c> guard (<see cref="TimeMarkerDisplay.Hidden"/>), the <c>severity ?? 'warn'</c> default fed through
/// <see cref="SeverityLevels.Normalize"/>, the <c>SEVERITY_STROKE</c> colour lookup, the localized <c>'Alert'</c>
/// default label, and the <c>strokeWidth</c> / <c>ifOverflow</c> defaults. No WinUI types — unit-tested without
/// a UI host.
/// </summary>
public static class TimeMarkerProjection
{
    /// <summary>
    /// Project the component props into a render shape (web component body). A <see langword="null"/> or empty
    /// <see cref="TimeMarkerInput.X"/> yields <see cref="TimeMarkerDisplay.Hidden"/> (web <c>return null</c>);
    /// otherwise the severity, stroke, label and stroke/overflow defaults are resolved exactly as the web does.
    /// </summary>
    /// <param name="input">The component props.</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    public static TimeMarkerDisplay Project(TimeMarkerInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: `if (x == null || x === '') return null;`
        if (string.IsNullOrEmpty(input.X))
        {
            return TimeMarkerDisplay.Hidden;
        }

        // web: `normalizeSeverity(severity ?? 'warn')` — the ?? default applies only to null/undefined, so an
        // explicit empty severity string still normalizes to info (web normalizeSeverity('')), never warn.
        SeverityLevel level = SeverityLevels.Normalize(input.Severity ?? "warn");

        return new TimeMarkerDisplay
        {
            IsVisible = true,
            XKey = input.X,
            Severity = level,
            StrokeHex = TimeMarkerStroke.Hex(level),
            Label = ResolveLabel(input.Label, localizer),
            StrokeWidth = input.StrokeWidth ?? TimeMarkerRegistration.DefaultStrokeWidth,
            StrokeDasharray = input.StrokeDasharray,
            IfOverflow = input.IfOverflow ?? TimeMarkerOverflow.ExtendDomain,
            YAxisId = input.YAxisId,
        };
    }

    /// <summary>
    /// Project straight from an alert drill-through context (the <c>useAlertContext</c> seam) — the canonical
    /// page wiring, equivalent to <see cref="Project(TimeMarkerInput, ILocalizer)"/> over
    /// <see cref="TimeMarkerInput.FromAlertContext"/>.
    /// </summary>
    /// <param name="context">The alert drill-through context.</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    public static TimeMarkerDisplay Project(AlertMarkerContext context, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(context);
        return Project(TimeMarkerInput.FromAlertContext(context), localizer);
    }

    // web default prop `label = 'Alert'` — routed through the i18n facade so the native surface carries no
    // inline English copy; an explicit empty label is honoured (web renders the empty string verbatim).
    private static string ResolveLabel(string? label, ILocalizer localizer) =>
        label ?? localizer.GetString(TimeMarkerRegistration.LabelKey, TimeMarkerRegistration.LabelFallback);
}

/// <summary>
/// Canonical metadata + i18n key for the <c>TimeMarker</c> shared surface — the native mirror of the web
/// component at <c>web/src/components/charts/TimeMarker.tsx</c>. The web source ships no <c>t()</c> call (its
/// only copy is the default prop <c>label = 'Alert'</c>); this registration keys that default as
/// <see cref="LabelKey"/> with <c>'Alert'</c> as the verbatim English fallback so the native view and
/// view-model resolve it through the i18n facade and carry no inline literal. The numeric design constants
/// (label font size, default stroke width) pin the web values (<c>fontSize: 10</c>, <c>strokeWidth = 2</c>).
/// UI-free so every value is asserted without a resource host.
/// </summary>
public static class TimeMarkerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TimeMarker";

    /// <summary>
    /// Root automation id set on the surface while the marker is visible — the stable handle a UI-automation
    /// test uses to find the rule. Cleared while hidden (the web component renders nothing when <c>x</c> is
    /// absent).
    /// </summary>
    public const string RootAutomationId = "time-marker-root";

    /// <summary>i18n key for the default marker label (web default prop <c>label = 'Alert'</c>).</summary>
    public const string LabelKey = "translation.chart.timeMarker.label";

    /// <summary>English fallback for <see cref="LabelKey"/> (web default prop value, verbatim).</summary>
    public const string LabelFallback = "Alert";

    /// <summary>The label font size in pixels (web <c>label.fontSize: 10</c>).</summary>
    public const double LabelFontSize = 10;

    /// <summary>The default rule width (web <c>strokeWidth = 2</c>).</summary>
    public const double DefaultStrokeWidth = 2;

    /// <summary>The localized default marker label (web <c>label = 'Alert'</c>).</summary>
    public static string DefaultLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey, LabelFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TimeMarker</c> surface (P1/S11 diagnostics contract). The alert timestamp,
/// signal name and vehicle id that drive the marker are fleet context, so the collector records ONLY the
/// operational <see cref="RecordViewOpened"/> signal with the surface slug — never a timestamp, signal or
/// vehicle id. Thread-safe; mirrors the sibling chart surfaces' collectors.
/// </summary>
public sealed class TimeMarkerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimeMarkerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimeMarker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={TimeMarkerRegistration.Slug}"));
    }
}
