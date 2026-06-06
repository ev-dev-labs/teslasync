using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Count-up numeric display (mirrors the web <c>AnimatedNumber</c>). Tweens from the
/// previously shown value to the new target with an ease-out-quad curve via the pure
/// <see cref="AnimatedNumberModel"/>. When <see cref="ReduceMotion"/> is set (or the
/// duration is zero) it snaps straight to the target, honouring the system
/// "animations off" / high-contrast / Narrator expectations.
/// </summary>
public sealed partial class TsAnimatedNumber : ContentControl
{
    /// <summary>The target value to display.</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(TsAnimatedNumber), new PropertyMetadata(0.0, OnValueChanged));

    /// <summary>Fraction digits for the rendered number (default 0).</summary>
    public static readonly DependencyProperty PrecisionProperty = DependencyProperty.Register(
        nameof(Precision), typeof(int), typeof(TsAnimatedNumber), new PropertyMetadata(0, OnFormatChanged));

    /// <summary>Tween duration in seconds (default 1).</summary>
    public static readonly DependencyProperty DurationSecondsProperty = DependencyProperty.Register(
        nameof(DurationSeconds), typeof(double), typeof(TsAnimatedNumber), new PropertyMetadata(1.0));

    /// <summary>When true, snap to the target without animating.</summary>
    public static readonly DependencyProperty ReduceMotionProperty = DependencyProperty.Register(
        nameof(ReduceMotion), typeof(bool), typeof(TsAnimatedNumber), new PropertyMetadata(false));

    /// <summary>Optional prefix (e.g. a currency symbol).</summary>
    public static readonly DependencyProperty PrefixProperty = DependencyProperty.Register(
        nameof(Prefix), typeof(string), typeof(TsAnimatedNumber), new PropertyMetadata(string.Empty, OnFormatChanged));

    /// <summary>Optional suffix (e.g. a unit label).</summary>
    public static readonly DependencyProperty SuffixProperty = DependencyProperty.Register(
        nameof(Suffix), typeof(string), typeof(TsAnimatedNumber), new PropertyMetadata(string.Empty, OnFormatChanged));

    private readonly TextBlock _text = new()
    {
        FontSize = 24,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.TextPrimary,
    };

    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(16) };
    private AnimatedNumberModel _model = new(0, 0, 0, true);
    private DateTimeOffset _started;
    private double _displayed;

    /// <summary>Initialise the control.</summary>
    public TsAnimatedNumber()
    {
        IsTabStop = false;
        Content = _text;
        _timer.Tick += OnTick;
        Render(_displayed);
    }

    /// <summary>The target value.</summary>
    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>Fraction digits.</summary>
    public int Precision
    {
        get => (int)GetValue(PrecisionProperty);
        set => SetValue(PrecisionProperty, value);
    }

    /// <summary>Tween duration in seconds.</summary>
    public double DurationSeconds
    {
        get => (double)GetValue(DurationSecondsProperty);
        set => SetValue(DurationSecondsProperty, value);
    }

    /// <summary>Whether motion is suppressed.</summary>
    public bool ReduceMotion
    {
        get => (bool)GetValue(ReduceMotionProperty);
        set => SetValue(ReduceMotionProperty, value);
    }

    /// <summary>Optional prefix.</summary>
    public string Prefix
    {
        get => (string)GetValue(PrefixProperty);
        set => SetValue(PrefixProperty, value);
    }

    /// <summary>Optional suffix.</summary>
    public string Suffix
    {
        get => (string)GetValue(SuffixProperty);
        set => SetValue(SuffixProperty, value);
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsAnimatedNumber)d).StartTween((double)e.NewValue);

    private static void OnFormatChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsAnimatedNumber)d).Render(((TsAnimatedNumber)d)._displayed);

    private void StartTween(double target)
    {
        _model = new AnimatedNumberModel(_displayed, target, DurationSeconds, ReduceMotion);
        if (_model.MotionReduced || DurationSeconds <= 0)
        {
            _timer.Stop();
            _displayed = target;
            Render(_displayed);
            return;
        }

        _started = DateTimeOffset.Now;
        _timer.Start();
    }

    private void OnTick(object? sender, object e)
    {
        double elapsed = (DateTimeOffset.Now - _started).TotalSeconds;
        _displayed = _model.ValueAt(elapsed);
        Render(_displayed);
        if (_model.IsComplete(elapsed))
        {
            _displayed = _model.Target;
            Render(_displayed);
            _timer.Stop();
        }
    }

    private void Render(double value)
    {
        string number = ScalarFormatters.FormatNumber(value, Math.Max(0, Precision));
        _text.Text = $"{Prefix}{number}{Suffix}";
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, _text.Text);
    }
}

/// <summary>A single entry in a <see cref="TsTimeline"/> / <see cref="TsRecentActivityFeed"/>.</summary>
/// <param name="Title">Primary line.</param>
/// <param name="Detail">Optional secondary line.</param>
/// <param name="Timestamp">When the event occurred.</param>
/// <param name="Severity">Wire severity string driving the marker colour.</param>
public sealed record TsActivityEntry(string Title, string? Detail, DateTimeOffset? Timestamp, string Severity = "info");
