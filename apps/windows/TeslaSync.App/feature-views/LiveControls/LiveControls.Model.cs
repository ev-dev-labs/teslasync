using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.StateMachine;

/// <summary>
/// The render-time data model the <c>LiveControls</c> view binds to — the native analogue of the web
/// <c>LiveControlsProps</c> (<c>web/src/features/system/components/state-machine/LiveControls.tsx</c>) minus
/// the change callbacks (those become the view's typed events). The web toolbar is a purely <em>controlled</em>
/// component: the FSM-debugger page owns whether streaming is live or frozen, the buffer-window choice, the
/// index into the transition buffer (for stepping) and whether step-prev / step-next are valid right now; it
/// passes them in and the toolbar emits change requests. This model carries exactly those controlled inputs.
/// The surface never fetches and never mutates the model. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="IsLive">True when streaming is live (the web <c>isLive</c>); false renders the frozen state.</param>
/// <param name="CanStepPrev">Whether stepping to the previous transition is valid now (web <c>canStepPrev</c>).</param>
/// <param name="CanStepNext">Whether stepping to the next transition is valid now (web <c>canStepNext</c>).</param>
/// <param name="WindowMinutes">The selected buffer-window in minutes (web <c>windowMinutes</c>).</param>
/// <param name="WindowCount">Transitions inside the active Window slice (web <c>windowCount</c>), or null.</param>
/// <param name="TotalCount">Total transitions fetched, typically the last 24 h (web <c>totalCount</c>), or null.</param>
/// <param name="BufferCount">
/// Deprecated single-scope count (web <c>bufferCount</c>). Kept as a one-phase fallback so external callers do
/// not break mid-migration: when both <see cref="WindowCount"/> and <see cref="TotalCount"/> are null this
/// scalar drives both counts (preserving the legacy "{n} buffered" copy).
/// </param>
public sealed record LiveControlsModel(
    bool IsLive,
    bool CanStepPrev,
    bool CanStepNext,
    int WindowMinutes,
    int? WindowCount = null,
    int? TotalCount = null,
    int? BufferCount = null)
{
    /// <summary>The initial toolbar state: live streaming, nothing to step through, the 30-minute window.</summary>
    public static LiveControlsModel Initial { get; } = new(
        IsLive: true,
        CanStepPrev: false,
        CanStepNext: false,
        WindowMinutes: 30);
}

/// <summary>
/// The four rolling buffer-windows the FSM-debugger toolbar offers, in display order — the native port of the
/// web <c>WINDOW_OPTIONS</c> array (5 / 10 / 30 minutes and 2 hours). The option value is the window's minute
/// count as an invariant string (the web <c>value: '5'</c> … <c>'120'</c> and <c>String(windowMinutes)</c>
/// round-trip); the label is composed from the shared debugger window-unit catalog keys so "5 min" / "2 h"
/// localize. Pure — unit-tested without a UI host.
/// </summary>
public static class LiveControlsWindows
{
    /// <summary>The offered window minute-counts in display order (web <c>WINDOW_OPTIONS</c> values).</summary>
    public static IReadOnlyList<int> Minutes { get; } = new[] { 5, 10, 30, 120 };
}

/// <summary>
/// The fully projected, render-ready view of the toolbar for one input model — the native analogue of what the
/// web <c>LiveControls</c> renders. Holds the controlled toggles, every localized button label and aria-label,
/// the window option list + selected wire value, the resolved counter chip + its tooltip, the decomposed
/// counter maths (so the projection is asserted directly), and the surface automation name. Pure data so every
/// branch is asserted headlessly.
/// </summary>
/// <param name="IsLive">Whether the Live toggle is active (drives which toggle reads as primary + the dot).</param>
/// <param name="CanStepPrev">Whether the step-previous control is enabled.</param>
/// <param name="CanStepNext">Whether the step-next control is enabled.</param>
/// <param name="LiveLabel">Localized "Live" toggle label.</param>
/// <param name="FreezeLabel">Localized "Freeze" toggle label.</param>
/// <param name="StepPrevLabel">Localized step-previous Narrator name (web <c>aria-label</c>).</param>
/// <param name="StepNextLabel">Localized step-next Narrator name (web <c>aria-label</c>).</param>
/// <param name="WindowLabel">Localized "Window" field label / select Narrator name.</param>
/// <param name="ClearLabel">Localized "Clear buffer" label.</param>
/// <param name="WindowOptions">The four window options (value = minute count, label = localized duration).</param>
/// <param name="SelectedWindowValue">The selected window's value (web <c>String(windowMinutes)</c>).</param>
/// <param name="InWindow">Transitions inside the active window (web <c>inWindow</c>).</param>
/// <param name="Total">Total transitions fetched (web <c>total</c>).</param>
/// <param name="Outside">Transitions fetched outside the active window, clamped at 0 (web <c>outside</c>).</param>
/// <param name="Dual">Whether the dual-scope counter copy applies (web <c>dual</c>).</param>
/// <param name="CounterLabel">The resolved counter chip text (dual or legacy single-scope).</param>
/// <param name="TooltipLabel">The counter tooltip explaining the window-vs-24 h scope difference.</param>
/// <param name="AutomationName">The composed accessible name for the whole toolbar.</param>
public sealed record LiveControlsDisplay(
    bool IsLive,
    bool CanStepPrev,
    bool CanStepNext,
    string LiveLabel,
    string FreezeLabel,
    string StepPrevLabel,
    string StepNextLabel,
    string WindowLabel,
    string ClearLabel,
    IReadOnlyList<ComboOption> WindowOptions,
    string SelectedWindowValue,
    int InWindow,
    int Total,
    int Outside,
    bool Dual,
    string CounterLabel,
    string TooltipLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="LiveControlsModel"/> to its <see cref="LiveControlsDisplay"/> — the native
/// port of <c>web/src/features/system/components/state-machine/LiveControls.tsx</c>. It reproduces the web
/// counter maths exactly (<c>inWindow = windowCount ?? bufferCount ?? 0</c>,
/// <c>total = totalCount ?? bufferCount ?? 0</c>, <c>outside = max(0, total - inWindow)</c>,
/// <c>dual = totalCount != null || windowCount != null</c>), selects the dual vs. legacy single-scope counter
/// copy, builds the four window options, and resolves every label through the i18n facade. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class LiveControlsProjection
{
    private const string LiveKey = "translation.debugger.controls.live";
    private const string FreezeKey = "translation.debugger.controls.freeze";
    private const string StepPrevKey = "translation.debugger.controls.stepPrev";
    private const string StepNextKey = "translation.debugger.controls.stepNext";
    private const string WindowKey = "translation.debugger.controls.window";
    private const string ClearKey = "translation.debugger.controls.clear";
    private const string BufferedKey = "translation.debugger.controls.buffered";
    private const string BufferedDualKey = "translation.debugger.controls.bufferedDual";
    private const string BufferedTooltipKey = "translation.debugger.controls.bufferedTooltip";
    private const string WindowMinutesKey = "translation.debugger.window.minutes";
    private const string WindowHoursKey = "translation.debugger.window.hours";

    private const string LiveFallback = "Live";
    private const string FreezeFallback = "Freeze";
    private const string StepPrevFallback = "Step to previous transition";
    private const string StepNextFallback = "Step to next transition";
    private const string WindowFallback = "Window";
    private const string ClearFallback = "Clear buffer";
    private const string BufferedFallback = "{0} buffered";
    private const string BufferedDualFallback = "{0} in window \u00b7 {1} in 24 h";
    private const string BufferedTooltipFallback =
        "Counts inside the {0}-minute Window dropdown. {1} more transitions fetched in the last 24 h.";
    private const string WindowMinutesFallback = "{0} min";
    private const string WindowHoursFallback = "{0} h";

    private const int MinutesPerHour = 60;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web controlled props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static LiveControlsDisplay Project(LiveControlsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        int inWindow = model.WindowCount ?? model.BufferCount ?? 0;
        int total = model.TotalCount ?? model.BufferCount ?? 0;
        int outside = Math.Max(0, total - inWindow);
        bool dual = model.TotalCount.HasValue || model.WindowCount.HasValue;

        string counterLabel = dual && outside > 0
            ? Format(localizer, BufferedDualKey, BufferedDualFallback, inWindow, total)
            : Format(localizer, BufferedKey, BufferedFallback, inWindow);

        string tooltipLabel = Format(localizer, BufferedTooltipKey, BufferedTooltipFallback, model.WindowMinutes, outside);

        string liveLabel = localizer.GetString(LiveKey, LiveFallback);
        string freezeLabel = localizer.GetString(FreezeKey, FreezeFallback);
        string windowLabel = localizer.GetString(WindowKey, WindowFallback);

        return new LiveControlsDisplay(
            IsLive: model.IsLive,
            CanStepPrev: model.CanStepPrev,
            CanStepNext: model.CanStepNext,
            LiveLabel: liveLabel,
            FreezeLabel: freezeLabel,
            StepPrevLabel: localizer.GetString(StepPrevKey, StepPrevFallback),
            StepNextLabel: localizer.GetString(StepNextKey, StepNextFallback),
            WindowLabel: windowLabel,
            ClearLabel: localizer.GetString(ClearKey, ClearFallback),
            WindowOptions: BuildWindowOptions(localizer),
            SelectedWindowValue: model.WindowMinutes.ToString(CultureInfo.InvariantCulture),
            InWindow: inWindow,
            Total: total,
            Outside: outside,
            Dual: dual,
            CounterLabel: counterLabel,
            TooltipLabel: tooltipLabel,
            AutomationName: BuildAutomationName(model.IsLive, liveLabel, freezeLabel, windowLabel, counterLabel));
    }

    // Web parity: WINDOW_OPTIONS = [{value:'5',label:'5 min'},…,{value:'120',label:'2 h'}]. Each label routes
    // through the shared debugger window-unit catalog keys; a whole-hour count renders as hours ("2 h"), the
    // rest as minutes ("5 min"), so the four web labels reproduce exactly.
    private static List<ComboOption> BuildWindowOptions(ILocalizer localizer)
    {
        var options = new List<ComboOption>(LiveControlsWindows.Minutes.Count);
        foreach (int minutes in LiveControlsWindows.Minutes)
        {
            string value = minutes.ToString(CultureInfo.InvariantCulture);
            string label = minutes % MinutesPerHour == 0
                ? Format(localizer, WindowHoursKey, WindowHoursFallback, minutes / MinutesPerHour)
                : Format(localizer, WindowMinutesKey, WindowMinutesFallback, minutes);
            options.Add(new ComboOption(value, label));
        }

        return options;
    }

    private static string BuildAutomationName(
        bool isLive,
        string liveLabel,
        string freezeLabel,
        string windowLabel,
        string counterLabel)
    {
        string state = isLive ? liveLabel : freezeLabel;
        return string.Create(CultureInfo.CurrentCulture, $"{state}. {windowLabel}. {counterLabel}");
    }

    private static string Format(ILocalizer localizer, string key, string fallback, params object[] args) =>
        string.Format(CultureInfo.CurrentCulture, localizer.GetString(key, fallback), args);
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveControls</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the live/frozen state, the window choice
/// or the transition counts — so a diagnostics line can never leak operator activity. Thread-safe.
/// </summary>
public sealed class LiveControlsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public LiveControlsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveControls</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveControlsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>LiveControls</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/state-machine/LiveControls.tsx</c>.
/// </summary>
public static class LiveControlsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveControls";
}
