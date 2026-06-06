using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Live-pipeline health pill (mirrors the web <c>LiveIndicator</c>). Shows a
/// state-coloured dot plus a label ("Live", "Reconnecting…", "Offline"). The dot
/// pulses only while reconnecting, and only when motion is allowed.
/// </summary>
public sealed partial class TsLiveIndicator : ContentControl
{
    /// <summary>Transport health state.</summary>
    public static readonly DependencyProperty StateProperty = DependencyProperty.Register(
        nameof(State), typeof(LiveConnectionState), typeof(TsLiveIndicator),
        new PropertyMetadata(LiveConnectionState.Unknown, OnChanged));

    /// <summary>Optional label override; empty uses the canonical state label.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsLiveIndicator), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>When true, suppress the reconnecting pulse (accessibility/system setting).</summary>
    public static readonly DependencyProperty ReduceMotionProperty = DependencyProperty.Register(
        nameof(ReduceMotion), typeof(bool), typeof(TsLiveIndicator), new PropertyMetadata(false, OnChanged));

    /// <summary>Initialise the indicator.</summary>
    public TsLiveIndicator()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Transport health.</summary>
    public LiveConnectionState State
    {
        get => (LiveConnectionState)GetValue(StateProperty);
        set => SetValue(StateProperty, value);
    }

    /// <summary>Optional label override.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Whether motion is suppressed.</summary>
    public bool ReduceMotion
    {
        get => (bool)GetValue(ReduceMotionProperty);
        set => SetValue(ReduceMotionProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsLiveIndicator)d).Rebuild();

    private void Rebuild()
    {
        var accent = DisplayTokens.Brush(LiveConnectionPresentation.AccentBrushKey(State));
        string text = string.IsNullOrEmpty(Label) ? LiveConnectionPresentation.DefaultLabel(State) : Label;

        var row = DisplayPrimitives.Row(6);
        var dot = DisplayPrimitives.Dot(accent, 8);
        if (LiveConnectionPresentation.ShouldAnimate(State) && !ReduceMotion)
        {
            PulseHelper.Attach(dot);
        }

        row.Children.Add(dot);
        var label = DisplayPrimitives.Label(text);
        label.Foreground = accent;
        label.FontWeight = FontWeights.Medium;
        row.Children.Add(label);

        Content = DisplayPrimitives.Pill(row, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, text);
    }
}

/// <summary>
/// Freshness pill for a single data point (mirrors the web <c>FreshnessIndicator</c>).
/// Encodes the two-minute live-state contract via <see cref="FreshnessLogic"/>:
/// fresh &lt; 120 s, stale &lt; 600 s, then offline. Shows a status dot plus a
/// relative age ("just now", "12s ago", "5m ago").
/// </summary>
public sealed partial class TsFreshnessIndicator : ContentControl
{
    /// <summary>The data point's timestamp (null → "unknown").</summary>
    public static readonly DependencyProperty TimestampProperty = DependencyProperty.Register(
        nameof(Timestamp), typeof(DateTimeOffset?), typeof(TsFreshnessIndicator), new PropertyMetadata(null, OnChanged));

    /// <summary>Stale threshold in seconds (default 120 — the 2-minute contract).</summary>
    public static readonly DependencyProperty StaleSecondsProperty = DependencyProperty.Register(
        nameof(StaleSeconds), typeof(int), typeof(TsFreshnessIndicator),
        new PropertyMetadata(FreshnessLogic.DefaultStaleSeconds, OnChanged));

    /// <summary>Offline threshold in seconds (default 600).</summary>
    public static readonly DependencyProperty OfflineSecondsProperty = DependencyProperty.Register(
        nameof(OfflineSeconds), typeof(int), typeof(TsFreshnessIndicator),
        new PropertyMetadata(FreshnessLogic.DefaultOfflineSeconds, OnChanged));

    /// <summary>When true, render only the dot (no age label).</summary>
    public static readonly DependencyProperty DotOnlyProperty = DependencyProperty.Register(
        nameof(DotOnly), typeof(bool), typeof(TsFreshnessIndicator), new PropertyMetadata(false, OnChanged));

    /// <summary>Initialise the indicator.</summary>
    public TsFreshnessIndicator()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The data point timestamp.</summary>
    public DateTimeOffset? Timestamp
    {
        get => (DateTimeOffset?)GetValue(TimestampProperty);
        set => SetValue(TimestampProperty, value);
    }

    /// <summary>Stale threshold in seconds.</summary>
    public int StaleSeconds
    {
        get => (int)GetValue(StaleSecondsProperty);
        set => SetValue(StaleSecondsProperty, value);
    }

    /// <summary>Offline threshold in seconds.</summary>
    public int OfflineSeconds
    {
        get => (int)GetValue(OfflineSecondsProperty);
        set => SetValue(OfflineSecondsProperty, value);
    }

    /// <summary>Whether to hide the age label.</summary>
    public bool DotOnly
    {
        get => (bool)GetValue(DotOnlyProperty);
        set => SetValue(DotOnlyProperty, value);
    }

    /// <summary>Recompute the indicator against the current wall clock.</summary>
    public void Refresh() => Rebuild();

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFreshnessIndicator)d).Rebuild();

    private void Rebuild()
    {
        int? age = FreshnessLogic.ComputeAge(Timestamp, DateTimeOffset.Now);
        var status = FreshnessLogic.GetStatus(age, StaleSeconds, OfflineSeconds);
        var accent = DisplayTokens.Brush(FreshnessLogic.AccentBrushKey(status));

        var row = DisplayPrimitives.Row(6);
        row.Children.Add(DisplayPrimitives.Dot(accent, 8));

        string ageLabel = FreshnessLogic.FormatAge(age);
        if (!DotOnly)
        {
            var label = DisplayPrimitives.Caption(ageLabel);
            label.Foreground = accent;
            row.Children.Add(label);
        }

        Content = DisplayPrimitives.Pill(row, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"{status} — {ageLabel}");
    }
}

/// <summary>
/// Query-level freshness summary (mirrors the web <c>DataFreshness</c>): combines
/// the fetching/error/stale state of a data source with its last-updated time into
/// a single status line ("Live", "Updating…", "Error", "Stale", relative age).
/// </summary>
public sealed partial class TsDataFreshness : ContentControl
{
    /// <summary>Last successful update timestamp (null → unknown).</summary>
    public static readonly DependencyProperty UpdatedAtProperty = DependencyProperty.Register(
        nameof(UpdatedAt), typeof(DateTimeOffset?), typeof(TsDataFreshness), new PropertyMetadata(null, OnChanged));

    /// <summary>True while a (re)fetch is in flight.</summary>
    public static readonly DependencyProperty IsFetchingProperty = DependencyProperty.Register(
        nameof(IsFetching), typeof(bool), typeof(TsDataFreshness), new PropertyMetadata(false, OnChanged));

    /// <summary>True when the last fetch failed.</summary>
    public static readonly DependencyProperty IsErrorProperty = DependencyProperty.Register(
        nameof(IsError), typeof(bool), typeof(TsDataFreshness), new PropertyMetadata(false, OnChanged));

    /// <summary>Initialise the summary.</summary>
    public TsDataFreshness()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Last update timestamp.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => (DateTimeOffset?)GetValue(UpdatedAtProperty);
        set => SetValue(UpdatedAtProperty, value);
    }

    /// <summary>Whether a fetch is in flight.</summary>
    public bool IsFetching
    {
        get => (bool)GetValue(IsFetchingProperty);
        set => SetValue(IsFetchingProperty, value);
    }

    /// <summary>Whether the last fetch failed.</summary>
    public bool IsError
    {
        get => (bool)GetValue(IsErrorProperty);
        set => SetValue(IsErrorProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDataFreshness)d).Rebuild();

    private void Rebuild()
    {
        var now = DateTimeOffset.Now;
        int? age = FreshnessLogic.ComputeAge(UpdatedAt, now);
        var freshness = FreshnessLogic.GetStatus(age);

        string brushKey;
        string text;
        if (IsError)
        {
            brushKey = "TsColorDangerBrush";
            text = "Error";
        }
        else if (IsFetching)
        {
            brushKey = "TsColorInfoBrush";
            text = "Updating\u2026";
        }
        else if (freshness == FreshnessStatus.Fresh)
        {
            brushKey = "TsColorSuccessBrush";
            text = "Live";
        }
        else
        {
            brushKey = FreshnessLogic.AccentBrushKey(freshness);
            text = FreshnessLogic.FormatAge(age);
        }

        var accent = DisplayTokens.Brush(brushKey);
        var row = DisplayPrimitives.Row(6);
        var dot = DisplayPrimitives.Dot(accent, 8);
        if (IsFetching)
        {
            PulseHelper.Attach(dot);
        }

        row.Children.Add(dot);
        var label = DisplayPrimitives.Caption(text);
        label.Foreground = accent;
        row.Children.Add(label);

        Content = DisplayPrimitives.Pill(row, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, text);
    }
}
