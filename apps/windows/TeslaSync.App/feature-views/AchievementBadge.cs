using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>AchievementBadge</c> feature surface — a parity port of
/// web/src/features/analytics/components/AchievementBadge.tsx. It is a presentational badge in the Lifetime-Stats
/// experience: assign a <see cref="Model"/> (the web <c>achievement</c> + <c>size</c> props plus the
/// parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="AchievementBadgeState.Loading"/> (skeleton chrome while the query is in flight),
/// <see cref="AchievementBadgeState.Empty"/> (a friendly empty state when there is no achievement),
/// <see cref="AchievementBadgeState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated badge
/// (<see cref="AchievementBadgeState.Ready"/> / <see cref="AchievementBadgeState.Stale"/> /
/// <see cref="AchievementBadgeState.Offline"/>) — the tile the web renders: the emoji icon (full-colour when won,
/// dimmed inside a progress ring when locked), the achievement name, the description, and either the "✓ Unlocked"
/// caption or the completion percent, with a stale / offline freshness chip layered on the cached badge. A locked
/// badge at / past the near-complete threshold pulses, exactly like the web <c>animate-pulse</c> (and honours
/// reduce-motion). The progress ring is drawn from the shared <see cref="ChartGeometry"/> / <see cref="ChartShapes"/>
/// primitives (the same ones the web <c>ProgressRing</c> uses) because the web tints the ring by completion state,
/// not a brand-palette role. The view never performs HTTP; all branch selection, percent computation, near-complete
/// thresholding and copy resolution happen in the WinUI-free <see cref="AchievementBadgeProjection"/>. Entrances fade
/// through <see cref="TsFadeIn"/> (honouring reduce-motion), every string resolves through the i18n facade, the emoji
/// icon is hidden from Narrator, and the surface carries a Narrator name in every state. A failed badge's retry
/// affordance raises <see cref="RetryRequested"/> for the host to act on (the parent owns the query).
/// </summary>
public sealed partial class AchievementBadge : ContentControl
{
    private const double TilePadding = 12;     // web p-3
    private const double TileCornerRadius = 12; // web rounded-xl
    private const double TileBorderThickness = 1;
    private const double LockedIconOpacity = 0.5; // web opacity-50 (the dimmed, locked icon)
    private const double TrackSweep = 0.9999;      // full background ring (web full circle)
    private const int FadeDelayMs = 100;            // gentle entrance for the grid cell
    private const double SkeletonNameWidth = 88;
    private const double SkeletonDescriptionWidth = 120;
    private const double SkeletonStatusWidth = 44;
    private const string TrophyGlyph = "\uE735"; // Segoe Fluent — FavoriteStar (achievement mark for the empty state)

    private readonly ILocalizer _localizer;
    private readonly AchievementBadgeDiagnostics _diagnostics;

    private AchievementBadgeModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="AchievementBadgeModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AchievementBadge(
        ILocalizer localizer,
        AchievementBadgeModel? model = null,
        AchievementBadgeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AchievementBadgeModel.Loading();
        _diagnostics = diagnostics ?? new AchievementBadgeDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AchievementBadge</c>).</summary>
    public static string Slug => AchievementBadgeRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AchievementBadgeModel Model
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

    private void Render()
    {
        AchievementBadgeDisplay display = AchievementBadgeProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            AchievementBadgeState.Loading => BuildLoading(display),
            AchievementBadgeState.Empty => BuildEmpty(display),
            AchievementBadgeState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (the web tile: badge circle + name + description + status) ─────────────────
    private static TsFadeIn BuildContent(AchievementBadgeDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = display.Metrics.Gap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        if (display.ShowFreshnessChip)
        {
            column.Children.Add(BuildChip(display));
        }

        column.Children.Add(BuildBadgeCircle(display));
        column.Children.Add(BuildName(display));
        column.Children.Add(BuildDescription(display));
        column.Children.Add(BuildStatus(display));

        var tile = new Border
        {
            Padding = new Thickness(TilePadding),
            CornerRadius = new CornerRadius(TileCornerRadius),
            BorderThickness = new Thickness(TileBorderThickness),
            BorderBrush = DisplayTokens.Brush(display.ContainerBorderKey),
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = column,
        };

        // web: isNearComplete && 'animate-pulse' — a gentle looping pulse on the whole tile, reduce-motion aware.
        if (display.IsNearComplete && !MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(tile);
        }

        return new TsFadeIn { DelayMs = FadeDelayMs, Content = tile };
    }

    private static TsBadge BuildChip(AchievementBadgeDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    // web: <div className="relative"> {!unlocked && <ProgressRing …/>} <span>{icon}</span> </div>
    private static FrameworkElement BuildBadgeCircle(AchievementBadgeDisplay display)
    {
        if (!display.ShowRing)
        {
            // Unlocked: just the full-colour icon (the web renders no ring when won).
            return BuildIcon(display, dimmed: false);
        }

        double diameter = display.Metrics.RingDiameter;
        double stroke = display.Metrics.StrokeWidth;
        double radius = (diameter - stroke) / 2;
        var center = new PointD(diameter / 2, diameter / 2);

        var canvas = new Canvas { Width = diameter, Height = diameter };
        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, TrackSweep), DisplayTokens.Border, stroke));

        if (display.RingFraction > 0)
        {
            Brush arcBrush = DisplayTokens.Brush(display.RingAccentKey);
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, display.RingFraction), arcBrush, stroke));
        }

        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        var ring = new Grid { Width = diameter, Height = diameter };
        ring.Children.Add(canvas);
        ring.Children.Add(BuildIcon(display, dimmed: true));
        return ring;
    }

    private static TextBlock BuildIcon(AchievementBadgeDisplay display, bool dimmed)
    {
        var icon = new TextBlock
        {
            Text = display.IconText,
            FontSize = display.Metrics.IconFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Opacity = dimmed ? LockedIconOpacity : 1.0,
        };

        // Decorative — the achievement name is carried by the surface Narrator name (web role="img" aria-label).
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static TextBlock BuildName(AchievementBadgeDisplay display) => new()
    {
        Text = display.Name,
        FontSize = display.Metrics.NameFontSize,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.Brush(display.NameAccentKey),
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BuildDescription(AchievementBadgeDisplay display) => new()
    {
        Text = display.Description,
        FontSize = display.Metrics.DescriptionFontSize,
        Foreground = DisplayTokens.TextMuted,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BuildStatus(AchievementBadgeDisplay display) => new()
    {
        Text = display.StatusText,
        FontSize = display.Metrics.StatusFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.Brush(display.StatusAccentKey),
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // ── Loading (parent still fetching the achievements) ──────────────────────────────────────────────────
    private static TsFadeIn BuildLoading(AchievementBadgeDisplay display)
    {
        double diameter = display.Metrics.RingDiameter;
        var column = new StackPanel
        {
            Spacing = display.Metrics.Gap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton { BlockWidth = diameter, BlockHeight = diameter, Radius = diameter / 2 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonNameWidth, BlockHeight = 12, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonDescriptionWidth, BlockHeight = 10, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonStatusWidth, BlockHeight = 10, Radius = 6 });

        var tile = new Border
        {
            Padding = new Thickness(TilePadding),
            CornerRadius = new CornerRadius(TileCornerRadius),
            BorderThickness = new Thickness(TileBorderThickness),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = column,
        };

        LiveRegion.Configure(tile);
        LiveRegion.Announce(tile);
        AutomationProperties.SetName(tile, display.LoadingLabel);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = tile };
    }

    // ── Empty (no achievement to render) ──────────────────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(AchievementBadgeDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = TrophyGlyph,
            Message = display.EmptyMessage,
        };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = empty };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(AchievementBadgeDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = error };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);
}
