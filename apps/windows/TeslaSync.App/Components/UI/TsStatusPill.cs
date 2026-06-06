using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized live-status pill with a leading state dot (mirrors the web
/// <c>StatusPill</c>). The dot colour follows a semantic <see cref="Status"/>
/// and can optionally <see cref="Pulse"/> to signal a live/streaming value.
/// </summary>
public partial class TsStatusPill : ContentControl
{
    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(StatusKind), typeof(TsStatusPill),
        new PropertyMetadata(StatusKind.Neutral, OnStatusChanged));

    public static readonly DependencyProperty PulseProperty = DependencyProperty.Register(
        nameof(Pulse), typeof(bool), typeof(TsStatusPill),
        new PropertyMetadata(false, OnPulseChanged));

    public static readonly DependencyProperty DotBrushProperty = DependencyProperty.Register(
        nameof(DotBrush), typeof(Brush), typeof(TsStatusPill),
        new PropertyMetadata(null));

    public TsStatusPill()
    {
        DefaultStyleKey = typeof(TsStatusPill);
        IsTabStop = false;
        ApplyStatus();
    }

    /// <summary>Semantic status driving the dot colour.</summary>
    public StatusKind Status
    {
        get => (StatusKind)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>When true the dot animates to signal a live value.</summary>
    public bool Pulse
    {
        get => (bool)GetValue(PulseProperty);
        set => SetValue(PulseProperty, value);
    }

    /// <summary>Brush for the state dot; bound by the control template.</summary>
    public Brush? DotBrush
    {
        get => (Brush?)GetValue(DotBrushProperty);
        private set => SetValue(DotBrushProperty, value);
    }

    private static void OnStatusChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatusPill)d).ApplyStatus();

    private static void OnPulseChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        VisualStateManager.GoToState((TsStatusPill)d, ((TsStatusPill)d).Pulse ? "Pulsing" : "Static", true);

    private void ApplyStatus()
    {
        var key = StatusResources.AccentBrushKey(Status);
        if (Application.Current.Resources.TryGetValue(key, out var brush) && brush is Brush b)
        {
            DotBrush = b;
        }
    }
}
