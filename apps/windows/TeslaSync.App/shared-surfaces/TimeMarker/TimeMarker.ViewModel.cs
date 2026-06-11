using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TimeMarker"/> view — the native port of the web
/// component body (web/src/components/charts/TimeMarker.tsx) bound to the alert-context seam the web pages feed
/// it through (web/src/hooks/useAlertContext.ts). It reads the current <see cref="ITimeMarkerSource.Context"/>
/// and exposes the web component's presentational props as settable overrides (<see cref="Label"/>,
/// <see cref="Severity"/>, <see cref="StrokeWidth"/>, <see cref="StrokeDasharray"/>, <see cref="IfOverflow"/>,
/// <see cref="YAxisId"/>) with the web defaults, then projects the two through
/// <see cref="TimeMarkerProjection"/> into <see cref="Display"/>. By default the severity follows the alert
/// context exactly as the canonical page wiring does (web <c>severity={alertCtx.signal ? 'critical' : undefined}</c>)
/// and the marker is visible only when the context carries a timestamp (web: <c>x</c> non-null); an explicit
/// <see cref="Severity"/> override wins when set, matching the web prop. The raw <see cref="Timestamp"/> /
/// <see cref="Signal"/> are surfaced so a host can position the rule on its chart and announce the moment.
/// </summary>
/// <remarks>
/// The web source is a controlled, presentational component with no data fetch of its own, so — like the
/// sibling presentational surfaces — it has no loading / error / stale / offline branch to model; its only
/// render states are hidden (no timestamp, the web <c>return null</c>) and visible (the rule). The view never
/// performs I/O; it observes this holder and renders. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </remarks>
public sealed class TimeMarkerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITimeMarkerSource _source;
    private readonly ILocalizer _localizer;
    private readonly TimeMarkerDiagnostics _diagnostics;

    private string? _label;
    private string? _severity;
    private double _strokeWidth = TimeMarkerRegistration.DefaultStrokeWidth;
    private string? _strokeDasharray;
    private TimeMarkerOverflow _ifOverflow = TimeMarkerOverflow.ExtendDomain;
    private string? _yAxisId;

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the alert-context seam, the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="source">The alert-context seam (P1/S8) the surface binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public TimeMarkerViewModel(
        ITimeMarkerSource source,
        ILocalizer localizer,
        TimeMarkerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new TimeMarkerDiagnostics();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TimeMarker</c>).</summary>
    public static string Slug => TimeMarkerRegistration.Slug;

    /// <summary>
    /// The label override (web <c>label?</c> prop); <see langword="null"/> uses the localized default
    /// (<c>'Alert'</c>). Setting an empty string renders an empty label, exactly as the web prop does.
    /// </summary>
    public string? Label
    {
        get => _label;
        set => Set(ref _label, value);
    }

    /// <summary>
    /// The severity override (web <c>severity?</c> prop). <see langword="null"/> (the default) follows the
    /// alert context — a focused signal escalates to <c>critical</c>, otherwise the projection applies the web
    /// <c>warn</c> default; a non-null value wins, matching the explicit web prop.
    /// </summary>
    public string? Severity
    {
        get => _severity;
        set => Set(ref _severity, value);
    }

    /// <summary>The rule width (web <c>strokeWidth</c> prop, default 2).</summary>
    public double StrokeWidth
    {
        get => _strokeWidth;
        set => Set(ref _strokeWidth, value);
    }

    /// <summary>The dash pattern (web <c>strokeDasharray</c> prop); <see langword="null"/> draws a solid rule.</summary>
    public string? StrokeDasharray
    {
        get => _strokeDasharray;
        set => Set(ref _strokeDasharray, value);
    }

    /// <summary>The overflow behaviour (web <c>ifOverflow</c> prop, default extend-domain).</summary>
    public TimeMarkerOverflow IfOverflow
    {
        get => _ifOverflow;
        set => Set(ref _ifOverflow, value);
    }

    /// <summary>The host chart's y-axis id (web <c>yAxisId</c> prop); <see langword="null"/> when unset.</summary>
    public string? YAxisId
    {
        get => _yAxisId;
        set => Set(ref _yAxisId, value);
    }

    /// <summary>The current alert drill-through context the marker is bound to (web <c>useAlertContext()</c> return).</summary>
    public AlertMarkerContext Context => _source.Context;

    /// <summary>The resolved marker input — the context timestamp + signal merged with the prop overrides.</summary>
    public TimeMarkerInput CurrentInput => new(_source.Context.Timestamp)
    {
        Severity = _severity ?? (_source.Context.Signal is null ? null : "critical"),
        Label = _label,
        StrokeDasharray = _strokeDasharray,
        StrokeWidth = _strokeWidth,
        IfOverflow = _ifOverflow,
        YAxisId = _yAxisId,
    };

    /// <summary>The projected render shape (web component body) — the single source the view renders from.</summary>
    public TimeMarkerDisplay Display => TimeMarkerProjection.Project(CurrentInput, _localizer);

    /// <summary>True when the marker is drawn (web: the context carries a timestamp).</summary>
    public bool IsVisible => Display.IsVisible;

    /// <summary>True when nothing is drawn — the web <c>return null</c> branch (no alert timestamp).</summary>
    public bool IsHidden => !Display.IsVisible;

    /// <summary>The resolved marker label (web <c>label</c>); the surface's accessible name while visible.</summary>
    public string ResolvedLabel => Display.Label;

    /// <summary>The resolved canonical severity that selects the stroke colour (web normalized severity).</summary>
    public SeverityLevel ResolvedSeverity => Display.Severity;

    /// <summary>The raw alert timestamp the host positions the rule at (web <c>useAlertContext().timestamp</c>).</summary>
    public string? Timestamp => _source.Context.Timestamp;

    /// <summary>The focused signal name from the alert context (web <c>useAlertContext().signal</c>).</summary>
    public string? Signal => _source.Context.Signal;

    /// <summary>True when the bound context carries any drill-through field (web <c>hasContext</c>).</summary>
    public bool HasContext => _source.Context.HasContext;

    /// <summary>
    /// Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event exactly
    /// once. Idempotent so a re-entrant load does not double-count.
    /// </summary>
    public void NotifyOpened()
    {
        if (_opened || _disposed)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Detach from the source seam and stop projecting (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        // The bound context changed (the page re-navigated); re-publish the derived state so the view re-renders.
        Raise(nameof(Context));
        Raise(nameof(Timestamp));
        Raise(nameof(Signal));
        Raise(nameof(HasContext));
        RaiseDerived();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
        RaiseDerived();
    }

    private void RaiseDerived()
    {
        Raise(nameof(CurrentInput));
        Raise(nameof(Display));
        Raise(nameof(IsVisible));
        Raise(nameof(IsHidden));
        Raise(nameof(ResolvedLabel));
        Raise(nameof(ResolvedSeverity));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
