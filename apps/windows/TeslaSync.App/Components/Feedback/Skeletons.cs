using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Tokenized shimmering skeleton block (mirrors the web <c>Skeleton</c>).
/// A rounded surface that pulses while content loads. The pulse is suppressed
/// when <see cref="ReduceMotion"/> is set, honouring the reduced-motion
/// accessibility preference. Marked as a decorative element so it is skipped by
/// assistive technology (the surrounding region announces "loading").
/// </summary>
public partial class TsSkeleton : ContentControl
{
    private readonly Border _block = new();
    private bool _pulseAttached;

    public static readonly DependencyProperty BlockWidthProperty = DependencyProperty.Register(
        nameof(BlockWidth), typeof(double), typeof(TsSkeleton),
        new PropertyMetadata(double.NaN, OnShapeChanged));

    public static readonly DependencyProperty BlockHeightProperty = DependencyProperty.Register(
        nameof(BlockHeight), typeof(double), typeof(TsSkeleton),
        new PropertyMetadata(16.0, OnShapeChanged));

    public static readonly DependencyProperty RadiusProperty = DependencyProperty.Register(
        nameof(Radius), typeof(double), typeof(TsSkeleton),
        new PropertyMetadata(6.0, OnShapeChanged));

    public static readonly DependencyProperty ReduceMotionProperty = DependencyProperty.Register(
        nameof(ReduceMotion), typeof(bool), typeof(TsSkeleton),
        new PropertyMetadata(false));

    public TsSkeleton()
    {
        IsTabStop = false;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
        _block.Background = TypographyTokens.Brush("TsColorBorderBrush")
            ?? new SolidColorBrush(Microsoft.UI.Colors.Gray);
        Content = _block;
        Loaded += OnLoaded;
        ApplyShape();
    }

    /// <summary>Explicit width (NaN = stretch).</summary>
    public double BlockWidth
    {
        get => (double)GetValue(BlockWidthProperty);
        set => SetValue(BlockWidthProperty, value);
    }

    /// <summary>Block height in effective pixels.</summary>
    public double BlockHeight
    {
        get => (double)GetValue(BlockHeightProperty);
        set => SetValue(BlockHeightProperty, value);
    }

    /// <summary>Corner radius.</summary>
    public double Radius
    {
        get => (double)GetValue(RadiusProperty);
        set => SetValue(RadiusProperty, value);
    }

    /// <summary>When true the shimmer pulse is suppressed (reduced-motion).</summary>
    public bool ReduceMotion
    {
        get => (bool)GetValue(ReduceMotionProperty);
        set => SetValue(ReduceMotionProperty, value);
    }

    private static void OnShapeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSkeleton)d).ApplyShape();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_pulseAttached || ReduceMotion)
        {
            return;
        }

        _pulseAttached = true;
        PulseHelper.Attach(_block);
    }

    private void ApplyShape()
    {
        _block.Width = BlockWidth;
        _block.Height = BlockHeight;
        _block.CornerRadius = new CornerRadius(Radius);
        _block.HorizontalAlignment = double.IsNaN(BlockWidth)
            ? HorizontalAlignment.Stretch
            : HorizontalAlignment.Left;
    }
}

/// <summary>
/// Base for the composite loading skeletons. Builds a decorative vertical stack
/// and announces "loading" politely to assistive tech.
/// </summary>
public abstract partial class TsCompositeSkeleton : ContentControl
{
    private protected readonly StackPanel Root = new() { Spacing = 12 };

    protected TsCompositeSkeleton()
    {
        IsTabStop = false;
        Content = Root;
        AutomationProperties.SetName(this, "Loading");
        LiveRegion.Configure(Root);
    }

    private protected static TsSkeleton Block(double height, double width = double.NaN, double radius = 6) =>
        new() { BlockHeight = height, BlockWidth = width, Radius = radius };

    private protected static Grid Columns(int count, double spacing, params FrameworkElement[] children)
    {
        ArgumentNullException.ThrowIfNull(children);
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (var i = 0; i < children.Length && i < count; i++)
        {
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }
}

/// <summary>Loading shimmer block for a single stat card (mirrors web <c>StatSkeleton</c>).</summary>
public partial class TsStatSkeleton : TsCompositeSkeleton
{
    public TsStatSkeleton()
    {
        var stack = new StackPanel { Spacing = 10 };
        stack.Children.Add(Block(12, 80));
        stack.Children.Add(Block(28, 120));
        stack.Children.Add(Block(10, 60));
        Root.Children.Add(new TsGlassPanel { Padding = new Thickness(16), Content = stack });
    }
}

/// <summary>Loading shimmer block for a chart (mirrors web <c>ChartSkeleton</c>).</summary>
public partial class TsChartSkeleton : TsCompositeSkeleton
{
    public TsChartSkeleton()
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(Block(14, 160));
        stack.Children.Add(Block(180, double.NaN, 10));
        Root.Children.Add(new TsGlassPanel { Padding = new Thickness(16), Content = stack });
    }
}

/// <summary>Loading shimmer block for a page header (mirrors web <c>PageHeaderSkeleton</c>).</summary>
public partial class TsPageHeaderSkeleton : TsCompositeSkeleton
{
    public TsPageHeaderSkeleton()
    {
        Root.Children.Add(Block(28, 240));
        Root.Children.Add(Block(14, 360));
    }
}

/// <summary>Loading shimmer block for a grid of stat cards (mirrors web <c>StatGridSkeleton</c>).</summary>
public partial class TsStatGridSkeleton : TsCompositeSkeleton
{
    public TsStatGridSkeleton()
        : this(4)
    {
    }

    public TsStatGridSkeleton(int columns)
    {
        var cards = new FrameworkElement[columns];
        for (var i = 0; i < columns; i++)
        {
            cards[i] = new TsStatSkeleton();
        }

        Root.Children.Add(Columns(columns, 12, cards));
    }
}

/// <summary>Loading shimmer block for a titled chart block (mirrors web <c>ChartBlockSkeleton</c>).</summary>
public partial class TsChartBlockSkeleton : TsCompositeSkeleton
{
    public TsChartBlockSkeleton()
    {
        Root.Children.Add(Block(16, 200));
        Root.Children.Add(new TsChartSkeleton());
    }
}

/// <summary>Loading shimmer block for a data table (mirrors web <c>TableSkeleton</c>).</summary>
public partial class TsTableSkeleton : TsCompositeSkeleton
{
    public TsTableSkeleton()
        : this(6)
    {
    }

    public TsTableSkeleton(int rows)
    {
        var stack = new StackPanel { Spacing = 10 };
        stack.Children.Add(Block(16, 180));
        for (var i = 0; i < rows; i++)
        {
            stack.Children.Add(Block(14));
        }

        Root.Children.Add(new TsGlassPanel { Padding = new Thickness(16), Content = stack });
    }
}

/// <summary>Full-page loading scaffold (mirrors web <c>PageLoadSkeleton</c>).</summary>
public partial class TsPageLoadSkeleton : TsCompositeSkeleton
{
    public TsPageLoadSkeleton()
    {
        Root.Children.Add(new TsPageHeaderSkeleton());
        Root.Children.Add(new TsStatGridSkeleton());
        Root.Children.Add(new TsChartBlockSkeleton());
    }
}
