using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Domain range selector under a chart (mirrors the web <c>ChartBrush</c>). Lets
/// the user narrow the visible X window; emits the selected
/// <see cref="SelectedStart"/>/<see cref="SelectedEnd"/> in domain units so the
/// owning chart can zoom. Built on the tokenized two-thumb <see cref="TsRangeSlider"/>.
/// </summary>
public partial class TsChartBrush : ContentControl
{
    private readonly TsRangeSlider _slider = new() { LowerLabel = "Range start", UpperLabel = "Range end" };

    public static readonly DependencyProperty DomainStartProperty = DependencyProperty.Register(
        nameof(DomainStart), typeof(double), typeof(TsChartBrush),
        new PropertyMetadata(0.0, OnDomainChanged));

    public static readonly DependencyProperty DomainEndProperty = DependencyProperty.Register(
        nameof(DomainEnd), typeof(double), typeof(TsChartBrush),
        new PropertyMetadata(100.0, OnDomainChanged));

    public static readonly DependencyProperty SelectedStartProperty = DependencyProperty.Register(
        nameof(SelectedStart), typeof(double), typeof(TsChartBrush),
        new PropertyMetadata(0.0));

    public static readonly DependencyProperty SelectedEndProperty = DependencyProperty.Register(
        nameof(SelectedEnd), typeof(double), typeof(TsChartBrush),
        new PropertyMetadata(100.0));

    public TsChartBrush()
    {
        IsTabStop = false;
        Content = _slider;
        _slider.RangeChanged += (s, e) =>
        {
            SelectedStart = _slider.Low;
            SelectedEnd = _slider.High;
            SelectionChanged?.Invoke(this, EventArgs.Empty);
        };
        SyncDomain();
    }

    /// <summary>Raised whenever the selected window changes.</summary>
    public event EventHandler? SelectionChanged;

    /// <summary>Lower bound of the full X domain.</summary>
    public double DomainStart
    {
        get => (double)GetValue(DomainStartProperty);
        set => SetValue(DomainStartProperty, value);
    }

    /// <summary>Upper bound of the full X domain.</summary>
    public double DomainEnd
    {
        get => (double)GetValue(DomainEndProperty);
        set => SetValue(DomainEndProperty, value);
    }

    /// <summary>Selected window start (domain units).</summary>
    public double SelectedStart
    {
        get => (double)GetValue(SelectedStartProperty);
        set => SetValue(SelectedStartProperty, value);
    }

    /// <summary>Selected window end (domain units).</summary>
    public double SelectedEnd
    {
        get => (double)GetValue(SelectedEndProperty);
        set => SetValue(SelectedEndProperty, value);
    }

    private static void OnDomainChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartBrush)d).SyncDomain();

    private void SyncDomain()
    {
        var span = DomainEnd - DomainStart;
        _slider.Minimum = DomainStart;
        _slider.Maximum = DomainEnd;
        _slider.Step = span > 0 ? span / 100.0 : 1;
        _slider.Low = DomainStart;
        _slider.High = DomainEnd;
        SelectedStart = DomainStart;
        SelectedEnd = DomainEnd;
    }
}
