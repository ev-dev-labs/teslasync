using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Motion;
using ShapePath = Microsoft.UI.Xaml.Shapes.Path;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using Rectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.Components.Motion;

/// <summary>
/// A decorative animated Tesla silhouette (port of the web <c>CarAnimation</c>),
/// used on empty/loading surfaces. The car gently bobs while the road dashes scroll
/// to suggest motion. Honours reduce-motion: when animations are disabled it renders
/// a static car with no looping storyboard. Built from tokenized shapes — no bitmap
/// or static screenshot.
/// </summary>
public partial class TsCarAnimation : ContentControl
{
    private readonly Canvas _canvas = new() { Width = 160, Height = 84 };
    private readonly TranslateTransform _bob = new();
    private readonly TranslateTransform _road = new();
    private Storyboard? _storyboard;

    public TsCarAnimation()
    {
        IsTabStop = false;
        Width = 160;
        Height = 84;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, "Tesla");

        BuildTree();
        Content = _canvas;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void BuildTree()
    {
        var accent = DisplayTokens.Accent;
        var border = DisplayTokens.Border;

        var road = new Rectangle
        {
            Width = 300,
            Height = 4,
            Fill = border,
            RadiusX = 2,
            RadiusY = 2,
            RenderTransform = _road,
        };
        Canvas.SetLeft(road, -70);
        Canvas.SetTop(road, 72);
        _canvas.Children.Add(road);

        var carGroup = new Canvas { RenderTransform = _bob };

        var body = new ShapePath
        {
            Fill = accent,
            Data = ParseGeometry(
                "M14,44 C18,30 30,24 48,22 L62,12 C66,9 72,8 78,8 L104,8 C112,8 119,12 124,20 L132,30 C144,32 150,38 150,44 L150,52 L14,52 Z"),
        };
        carGroup.Children.Add(body);

        var cabin = new ShapePath
        {
            Fill = new SolidColorBrush(Microsoft.UI.Colors.Black) { Opacity = 0.35 },
            Data = ParseGeometry(
                "M64,16 L100,16 C108,16 114,20 118,28 L60,28 C60,22 60,16 64,16 Z"),
        };
        carGroup.Children.Add(cabin);

        var wheelFront = Wheel(border, accent);
        Canvas.SetLeft(wheelFront, 108);
        Canvas.SetTop(wheelFront, 44);
        carGroup.Children.Add(wheelFront);

        var wheelRear = Wheel(border, accent);
        Canvas.SetLeft(wheelRear, 28);
        Canvas.SetTop(wheelRear, 44);
        carGroup.Children.Add(wheelRear);

        _canvas.Children.Add(carGroup);
    }

    private static Grid Wheel(Brush tyre, Brush hub)
    {
        var grid = new Grid { Width = 24, Height = 24 };
        grid.Children.Add(new Ellipse { Width = 24, Height = 24, Fill = tyre });
        grid.Children.Add(new Ellipse
        {
            Width = 10,
            Height = 10,
            Fill = hub,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return grid;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        StopStoryboard();
        if (!MotionDuration.ShouldAnimate(MotionPreference.ReduceMotion))
        {
            _bob.Y = 0;
            _road.X = 0;
            return;
        }

        var bob = new DoubleAnimation
        {
            From = 0,
            To = -3,
            Duration = new Duration(TimeSpan.FromMilliseconds(900)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
        };
        Storyboard.SetTarget(bob, _bob);
        Storyboard.SetTargetProperty(bob, "Y");

        var dash = new DoubleAnimation
        {
            From = 0,
            To = -40,
            Duration = new Duration(TimeSpan.FromMilliseconds(700)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(dash, _road);
        Storyboard.SetTargetProperty(dash, "X");

        _storyboard = new Storyboard();
        _storyboard.Children.Add(bob);
        _storyboard.Children.Add(dash);
        _storyboard.Begin();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => StopStoryboard();

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private static Geometry ParseGeometry(string path) =>
        (Geometry)Microsoft.UI.Xaml.Markup.XamlBindingHelper.ConvertValue(typeof(Geometry), path);
}
