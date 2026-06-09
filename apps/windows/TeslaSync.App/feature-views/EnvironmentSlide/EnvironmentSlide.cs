using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>EnvironmentSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/EnvironmentSlide.tsx. Assign a <see cref="Model"/> (the web
/// year-review <c>data</c>, of which it reads only <c>co2_offset_kg</c>) and it renders exactly one of the
/// web branches: <see cref="EnvironmentSlideState.Loading"/> (the centred skeleton chrome),
/// <see cref="EnvironmentSlideState.Empty"/> (the friendly no-data surface), or
/// <see cref="EnvironmentSlideState.Ready"/> (the globe glyph, the uppercase "CO₂ offset" eyebrow, the
/// green count-up offset in kilograms, the "Like planting N trees" caption, the capped tree-glyph grid and
/// the "+N more" overflow). The view never performs HTTP; all branch selection, label resolution and
/// formatting happen in the WinUI-free <see cref="EnvironmentSlideProjection"/>. The count-up reuses the
/// shared <see cref="AnimatedNumberModel"/> tween (the native <c>AnimatedNumber</c> logic), and every
/// entrance animation collapses to its final frame under the OS reduce-motion setting. Every string resolves
/// through the i18n facade and the surface carries a composed Narrator name; the decorative emoji are hidden
/// from assistive technology.
/// </summary>
public sealed partial class EnvironmentSlide : ContentControl
{
    private const double GlobeFontSize = 44;
    private const double TreeFontSize = 22;
    private const double TreeCellSize = 30;
    private const int TreeColumns = 10; // web `max-w-xs flex-wrap` fits ~10 glyphs per row.
    private const int TreeStaggerStepMs = 28;
    private const double HeroDurationSeconds = 1.5; // web <AnimatedNumber duration={1.5} />.

    private readonly ILocalizer _localizer;
    private readonly EnvironmentSlideDiagnostics _diagnostics;
    private readonly DispatcherTimer _countTimer = new() { Interval = TimeSpan.FromMilliseconds(16) };

    private EnvironmentSlideModel _model;
    private bool _opened;

    private AnimatedNumberModel _countModel = new(0, 0, 0, true);
    private DateTimeOffset _countStarted;
    private TextBlock? _countText;
    private string _countSuffix = string.Empty;

    /// <summary>Creates the surface over its i18n facade, an initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="EnvironmentSlideModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EnvironmentSlide(
        ILocalizer localizer,
        EnvironmentSlideModel? model = null,
        EnvironmentSlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? EnvironmentSlideModel.Pending;
        _diagnostics = diagnostics ?? new EnvironmentSlideDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _countTimer.Tick += OnCountTick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>EnvironmentSlide</c>).</summary>
    public static string Slug => EnvironmentSlideRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public EnvironmentSlideModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => _countTimer.Stop();

    private void Render()
    {
        _countTimer.Stop();
        _countText = null;

        var display = EnvironmentSlideProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            EnvironmentSlideState.Loading => BuildLoading(display),
            EnvironmentSlideState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };
    }

    // ── Loading: centred skeleton chrome mirroring the slide's composition ──────────────────────────────
    private static Grid BuildLoading(EnvironmentSlideDisplay display)
    {
        var column = CenteredColumn();
        column.Children.Add(new TsSkeleton { BlockWidth = 56, BlockHeight = 56, Radius = 28, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 140, BlockHeight = 16, Radius = 8, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 200, BlockHeight = 48, Radius = 12, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 14, Radius = 7, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(BuildTreeSkeletonRow());

        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        AutomationProperties.SetName(column, display.AutomationName);
        return CenterHost(column);
    }

    private static StackPanel BuildTreeSkeletonRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        for (int i = 0; i < 8; i++)
        {
            row.Children.Add(new TsSkeleton { BlockWidth = 22, BlockHeight = 22, Radius = 6 });
        }

        return row;
    }

    // ── Empty: the friendly no-data surface (never a blank box) ─────────────────────────────────────────
    private static Grid BuildEmpty(EnvironmentSlideDisplay display)
    {
        var empty = new TsEmptyState
        {
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, display.EmptyMessage);
        return CenterHost(empty);
    }

    // ── Ready: the full composition wrapped in the reduce-motion-aware entrance ──────────────────────────
    private TsFadeIn BuildReady(EnvironmentSlideDisplay display)
    {
        bool reduce = MotionPreference.ReduceMotion;
        var column = CenteredColumn();

        var globeScale = new ScaleTransform();
        var globe = new TextBlock
        {
            Text = EnvironmentSlideRegistration.GlobeGlyph,
            FontSize = GlobeFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = globeScale,
        };
        Decorative(globe);
        SetScale(globeScale, reduce ? 1 : 0);
        column.Children.Add(globe);

        column.Children.Add(new Label
        {
            Value = display.Co2Label,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var number = new TextBlock
        {
            FontSize = TypographyTokens.Size("TsTypeDisplayFontSize", 30),
            FontWeight = FontWeights.Bold,
            Foreground = TypographyTokens.Brush("TsColorSuccessBrush") ?? DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Text = reduce ? display.Co2DisplayText : ZeroText(display.Co2Suffix),
        };
        AutomationProperties.SetName(number, display.Co2DisplayText);
        _countText = number;
        _countSuffix = display.Co2Suffix;
        column.Children.Add(number);

        column.Children.Add(new Caption
        {
            Value = display.TreesEquivText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var treeNodes = new List<TextBlock>(display.TreeCount);
        column.Children.Add(BuildTreeGrid(display.TreeCount, reduce, treeNodes));

        if (display.HasOverflow)
        {
            column.Children.Add(new Caption
            {
                Value = display.OverflowText,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        double target = display.Co2Value;
        column.Loaded += (_, _) =>
        {
            if (reduce)
            {
                return;
            }

            AnimateScaleIn(globeScale, MotionDuration.DefaultMs);
            StaggerTrees(treeNodes);
            StartCountUp(target);
        };

        var host = new TsFadeIn { Content = CenterHost(column) };
        AutomationProperties.SetName(host, display.AutomationName);
        return host;
    }

    // ── Tree-glyph grid (web `flex flex-wrap` of 🌳, capped at 30) ───────────────────────────────────────
    private static VariableSizedWrapGrid BuildTreeGrid(int count, bool reduce, List<TextBlock> nodes)
    {
        var grid = new VariableSizedWrapGrid
        {
            Orientation = Orientation.Horizontal,
            MaximumRowsOrColumns = TreeColumns,
            ItemWidth = TreeCellSize,
            ItemHeight = TreeCellSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        for (int i = 0; i < count; i++)
        {
            var scale = new ScaleTransform();
            var tree = new TextBlock
            {
                Text = EnvironmentSlideRegistration.TreeGlyph,
                FontSize = TreeFontSize,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = scale,
                Opacity = reduce ? 1 : 0,
            };
            Decorative(tree);
            SetScale(scale, reduce ? 1 : 0);
            grid.Children.Add(tree);
            nodes.Add(tree);
        }

        return grid;
    }

    // ── Count-up: drives the green hero number through the shared AnimatedNumberModel tween ──────────────
    private void StartCountUp(double target)
    {
        _countModel = new AnimatedNumberModel(0, target, HeroDurationSeconds, false);
        _countStarted = DateTimeOffset.Now;
        _countTimer.Start();
    }

    private void OnCountTick(object? sender, object e)
    {
        if (_countText is null)
        {
            _countTimer.Stop();
            return;
        }

        double elapsed = (DateTimeOffset.Now - _countStarted).TotalSeconds;
        _countText.Text = FormatCount(_countModel.ValueAt(elapsed), _countSuffix);

        if (_countModel.IsComplete(elapsed))
        {
            _countText.Text = FormatCount(_countModel.Target, _countSuffix);
            _countTimer.Stop();
        }
    }

    private static string FormatCount(double value, string suffix) =>
        $"{NumberFormatting.Format(value, null, 0)}{suffix}";

    private static string ZeroText(string suffix) =>
        $"{NumberFormatting.Format(0, null, 0)}{suffix}";

    // ── Entrance animations (only invoked when motion is enabled) ───────────────────────────────────────
    private static void AnimateScaleIn(ScaleTransform transform, int durationMs)
    {
        var span = new Duration(TimeSpan.FromMilliseconds(durationMs));
        var ease = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.4 };
        var storyboard = new Storyboard();
        AddScaleGrow(storyboard, transform, "ScaleX", span, TimeSpan.Zero, ease);
        AddScaleGrow(storyboard, transform, "ScaleY", span, TimeSpan.Zero, ease);
        storyboard.Begin();
    }

    private static void StaggerTrees(List<TextBlock> trees)
    {
        var span = new Duration(TimeSpan.FromMilliseconds(MotionDuration.DefaultMs));
        for (int i = 0; i < trees.Count; i++)
        {
            var tree = trees[i];
            if (tree.RenderTransform is not ScaleTransform scale)
            {
                continue;
            }

            var begin = TimeSpan.FromMilliseconds(10 + (i * TreeStaggerStepMs));
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            var storyboard = new Storyboard();

            var fade = new DoubleAnimation { From = 0, To = 1, Duration = span, BeginTime = begin, EnableDependentAnimation = true };
            Storyboard.SetTarget(fade, tree);
            Storyboard.SetTargetProperty(fade, "Opacity");
            storyboard.Children.Add(fade);

            AddScaleGrow(storyboard, scale, "ScaleX", span, begin, ease);
            AddScaleGrow(storyboard, scale, "ScaleY", span, begin, ease);
            storyboard.Begin();
        }
    }

    private static void AddScaleGrow(
        Storyboard storyboard,
        ScaleTransform transform,
        string property,
        Duration span,
        TimeSpan begin,
        EasingFunctionBase? ease)
    {
        var grow = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = span,
            BeginTime = begin,
            EnableDependentAnimation = true,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(grow, transform);
        Storyboard.SetTargetProperty(grow, property);
        storyboard.Children.Add(grow);
    }

    // ── Shared layout primitives ────────────────────────────────────────────────────────────────────────
    private static StackPanel CenteredColumn() => new()
    {
        Spacing = 12,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(24),
    };

    private static Grid CenterHost(UIElement content)
    {
        var host = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            MinHeight = 200,
        };
        host.Children.Add(content);
        return host;
    }

    private static void SetScale(ScaleTransform transform, double value)
    {
        transform.ScaleX = value;
        transform.ScaleY = value;
    }

    // The emoji are decorative; the surface name and the text labels carry the meaning for Narrator.
    private static void Decorative(UIElement element) =>
        AutomationProperties.SetAccessibilityView(element, AccessibilityView.Raw);
}
