using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized two-thumb range selector (mirrors the web <c>RangeSlider</c>).
/// Composes two WinUI <see cref="Slider"/>s over a <see cref="RangeValue"/> model
/// that enforces <c>min ≤ low ≤ high ≤ max</c> and step snapping. Each thumb has
/// its own accessible name so Narrator distinguishes the lower/upper bound.
/// </summary>
public partial class TsRangeSlider : ContentControl
{
    private readonly RangeValue _range = new();
    private readonly Slider _lowSlider = new();
    private readonly Slider _highSlider = new();
    private bool _syncing;

    public static readonly DependencyProperty MinimumProperty = DependencyProperty.Register(
        nameof(Minimum), typeof(double), typeof(TsRangeSlider),
        new PropertyMetadata(0.0, OnBoundsChanged));

    public static readonly DependencyProperty MaximumProperty = DependencyProperty.Register(
        nameof(Maximum), typeof(double), typeof(TsRangeSlider),
        new PropertyMetadata(100.0, OnBoundsChanged));

    public static readonly DependencyProperty StepProperty = DependencyProperty.Register(
        nameof(Step), typeof(double), typeof(TsRangeSlider),
        new PropertyMetadata(1.0, OnBoundsChanged));

    public static readonly DependencyProperty LowProperty = DependencyProperty.Register(
        nameof(Low), typeof(double), typeof(TsRangeSlider),
        new PropertyMetadata(0.0, OnLowChanged));

    public static readonly DependencyProperty HighProperty = DependencyProperty.Register(
        nameof(High), typeof(double), typeof(TsRangeSlider),
        new PropertyMetadata(100.0, OnHighChanged));

    public static readonly DependencyProperty LowerLabelProperty = DependencyProperty.Register(
        nameof(LowerLabel), typeof(string), typeof(TsRangeSlider),
        new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty UpperLabelProperty = DependencyProperty.Register(
        nameof(UpperLabel), typeof(string), typeof(TsRangeSlider),
        new PropertyMetadata(null, OnLabelsChanged));

    public TsRangeSlider()
    {
        IsTabStop = false;
        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(_lowSlider);
        panel.Children.Add(_highSlider);
        Content = panel;

        _lowSlider.ValueChanged += (s, e) =>
        {
            if (_syncing)
            {
                return;
            }

            _range.Low = e.NewValue;
            PushFromModel();
        };
        _highSlider.ValueChanged += (s, e) =>
        {
            if (_syncing)
            {
                return;
            }

            _range.High = e.NewValue;
            PushFromModel();
        };

        SyncBounds();
        PushFromModel();
    }

    /// <summary>Raised whenever the selected range changes.</summary>
    public event EventHandler? RangeChanged;

    public double Minimum
    {
        get => (double)GetValue(MinimumProperty);
        set => SetValue(MinimumProperty, value);
    }

    public double Maximum
    {
        get => (double)GetValue(MaximumProperty);
        set => SetValue(MaximumProperty, value);
    }

    public double Step
    {
        get => (double)GetValue(StepProperty);
        set => SetValue(StepProperty, value);
    }

    /// <summary>Lower selected bound.</summary>
    public double Low
    {
        get => (double)GetValue(LowProperty);
        set => SetValue(LowProperty, value);
    }

    /// <summary>Upper selected bound.</summary>
    public double High
    {
        get => (double)GetValue(HighProperty);
        set => SetValue(HighProperty, value);
    }

    /// <summary>Localized accessible name for the lower thumb.</summary>
    public string? LowerLabel
    {
        get => (string?)GetValue(LowerLabelProperty);
        set => SetValue(LowerLabelProperty, value);
    }

    /// <summary>Localized accessible name for the upper thumb.</summary>
    public string? UpperLabel
    {
        get => (string?)GetValue(UpperLabelProperty);
        set => SetValue(UpperLabelProperty, value);
    }

    private static void OnBoundsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRangeSlider)d).SyncBounds();

    private static void OnLowChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var slider = (TsRangeSlider)d;
        if (slider._syncing)
        {
            return;
        }

        slider._range.Low = (double)e.NewValue;
        slider.PushFromModel();
    }

    private static void OnHighChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var slider = (TsRangeSlider)d;
        if (slider._syncing)
        {
            return;
        }

        slider._range.High = (double)e.NewValue;
        slider.PushFromModel();
    }

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var slider = (TsRangeSlider)d;
        if (!string.IsNullOrEmpty(slider.LowerLabel))
        {
            AutomationProperties.SetName(slider._lowSlider, slider.LowerLabel);
        }

        if (!string.IsNullOrEmpty(slider.UpperLabel))
        {
            AutomationProperties.SetName(slider._highSlider, slider.UpperLabel);
        }
    }

    private void SyncBounds()
    {
        _range.Minimum = Minimum;
        _range.Maximum = Maximum;
        _range.Step = Step;
        _syncing = true;
        _lowSlider.Minimum = Minimum;
        _lowSlider.Maximum = Maximum;
        _lowSlider.StepFrequency = Step <= 0 ? 1 : Step;
        _highSlider.Minimum = Minimum;
        _highSlider.Maximum = Maximum;
        _highSlider.StepFrequency = Step <= 0 ? 1 : Step;
        _syncing = false;
        PushFromModel();
    }

    private void PushFromModel()
    {
        _syncing = true;
        _lowSlider.Value = _range.Low;
        _highSlider.Value = _range.High;
        Low = _range.Low;
        High = _range.High;
        _syncing = false;
        RangeChanged?.Invoke(this, EventArgs.Empty);
    }
}
