using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized status chip (mirrors the web <c>Badge</c>). Renders consumer
/// content tinted by a semantic <see cref="Status"/>, with an optional leading
/// <see cref="Dot"/>. The status accent drives both the text and the border so
/// the chip stays legible under forced-colors / high contrast.
/// </summary>
public partial class TsBadge : ContentControl
{
    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(StatusKind), typeof(TsBadge),
        new PropertyMetadata(StatusKind.Neutral, OnStatusChanged));

    public static readonly DependencyProperty DotProperty = DependencyProperty.Register(
        nameof(Dot), typeof(bool), typeof(TsBadge),
        new PropertyMetadata(false));

    public static readonly DependencyProperty AccentBrushProperty = DependencyProperty.Register(
        nameof(AccentBrush), typeof(Brush), typeof(TsBadge),
        new PropertyMetadata(null));

    public TsBadge()
    {
        DefaultStyleKey = typeof(TsBadge);
        IsTabStop = false;
        ApplyStatus();
    }

    /// <summary>Semantic status driving the chip colour.</summary>
    public StatusKind Status
    {
        get => (StatusKind)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>When true a leading status-coloured dot is shown.</summary>
    public bool Dot
    {
        get => (bool)GetValue(DotProperty);
        set => SetValue(DotProperty, value);
    }

    /// <summary>Brush for the leading dot; bound by the control template.</summary>
    public Brush? AccentBrush
    {
        get => (Brush?)GetValue(AccentBrushProperty);
        private set => SetValue(AccentBrushProperty, value);
    }

    private static void OnStatusChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsBadge)d).ApplyStatus();

    private void ApplyStatus()
    {
        var key = StatusResources.AccentBrushKey(Status);
        if (Application.Current.Resources.TryGetValue(key, out var brush) && brush is Brush b)
        {
            Foreground = b;
            BorderBrush = b;
            AccentBrush = b;
        }
    }
}
