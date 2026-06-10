using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>HealthOverview</c> feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/HealthOverview.tsx. It is a presentational summary of
/// the drivetrain-health experience: assign a <see cref="Model"/> (the web <c>overallHealth</c> /
/// <c>healthScore</c> / <c>motorStatus</c> props plus the parent-supplied lifecycle status) and it renders one
/// of the contract's states — <see cref="HealthOverviewState.Loading"/> (skeleton chrome while the parent
/// query is in flight), <see cref="HealthOverviewState.Empty"/> (a friendly empty state when there is no
/// drivetrain telemetry), <see cref="HealthOverviewState.Error"/> (a retriable <see cref="TsQueryError"/>), or
/// the populated overview (<see cref="HealthOverviewState.Ready"/> / <see cref="HealthOverviewState.Stale"/> /
/// <see cref="HealthOverviewState.Offline"/>) — the web composition: a conditional temperature
/// <see cref="TsAlertBanner"/> when the drivetrain is not healthy, then a glowing <see cref="TsGlassPanel"/>
/// with the health-status icon, the health headline, the live "Motor State" subtitle, the status badge and the
/// animated health score, with a stale / offline freshness chip layered on the cached snapshot. The view never
/// performs HTTP; all branch selection, glow / accent resolution, copy resolution and formatting happen in the
/// WinUI-free <see cref="HealthOverviewProjection"/>. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, the decorative icon is hidden from Narrator,
/// and the surface + each chip / badge carry a Narrator name. A failed snapshot's retry affordance raises
/// <see cref="RetryRequested"/> for the host to act on (the parent owns the query).
/// </summary>
public sealed partial class HealthOverview : ContentControl
{
    private const double SectionSpacing = 16;   // web fragment gap between banner and panel
    private const double PanelPadding = 24;      // web p-6
    private const double ClusterSpacing = 16;    // web gap-4 (icon ↔ text)
    private const double RightClusterSpacing = 12; // web gap-3 (badge ↔ score)
    private const double TextSpacing = 2;        // web title ↔ subtitle
    private const double HealthIconSize = 40;    // web icon (h-10 w-10)
    private const double SkeletonIconSize = 40;
    private const int FadeDelayMs = 100;

    private readonly ILocalizer _localizer;
    private readonly HealthOverviewDiagnostics _diagnostics;

    private HealthOverviewModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="HealthOverviewModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HealthOverview(
        ILocalizer localizer,
        HealthOverviewModel? model = null,
        HealthOverviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? HealthOverviewModel.Loading;
        _diagnostics = diagnostics ?? new HealthOverviewDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HealthOverview</c>).</summary>
    public static string Slug => HealthOverviewRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public HealthOverviewModel Model
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
        var display = HealthOverviewProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            HealthOverviewState.Loading => BuildLoading(display),
            HealthOverviewState.Empty => BuildEmpty(display),
            HealthOverviewState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web: conditional alert banner + glowing health panel) ─────────────────
    private static TsFadeIn BuildContent(HealthOverviewDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };

        if (display.ShowAlert)
        {
            stack.Children.Add(BuildAlert(display));
        }

        stack.Children.Add(BuildPanel(display));
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = stack };
    }

    private static TsAlertBanner BuildAlert(HealthOverviewDisplay display)
    {
        var banner = new TsAlertBanner
        {
            Variant = display.AlertVariant,
            Title = display.AlertTitle,
            Message = display.AlertMessage,
            Dismissible = false,
        };
        AutomationProperties.SetName(banner, $"{display.AlertTitle}. {display.AlertMessage}");
        return banner;
    }

    private static TsGlassPanel BuildPanel(HealthOverviewDisplay display)
    {
        var grid = new Grid { ColumnSpacing = ClusterSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = BuildHeadline(display);
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = BuildMeta(display);
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        return new TsGlassPanel
        {
            Glow = ToGlassGlow(display.Glow),
            Padding = new Thickness(PanelPadding),
            Content = grid,
        };
    }

    private static StackPanel BuildHeadline(HealthOverviewDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        string glyph = display.IsHealthy
            ? HealthOverviewRegistration.HealthyGlyph
            : HealthOverviewRegistration.WarningGlyph;
        row.Children.Add(DecorativeIcon(glyph, HealthIconSize, DisplayTokens.Brush(display.HealthAccentKey)));

        var text = new StackPanel { Spacing = TextSpacing, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock
        {
            Text = display.HealthTitle,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18),
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        text.Children.Add(new TextBlock
        {
            Text = display.MotorStateText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        });
        row.Children.Add(text);

        return row;
    }

    private static StackPanel BuildMeta(HealthOverviewDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RightClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        if (display.ShowFreshnessChip)
        {
            row.Children.Add(BuildChip(display.FreshnessChipText, display.FreshnessChipStatus));
        }

        row.Children.Add(BuildHealthBadge(display));
        row.Children.Add(new TsAnimatedNumber
        {
            Value = display.HealthScore,
            Precision = 0,
            Suffix = "%",
            ReduceMotion = MotionPreference.ReduceMotion,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static TsBadge BuildHealthBadge(HealthOverviewDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.BadgeStatus,
            Dot = true,
            Content = new TextBlock
            {
                Text = display.BadgeLabel,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                FontWeight = FontWeights.SemiBold,
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.BadgeLabel);
        return badge;
    }

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var chip = new TsBadge
        {
            Status = status,
            Content = new TextBlock
            {
                Text = text,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    // ── Loading (parent still fetching the health snapshot) ────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(HealthOverviewDisplay display)
    {
        var grid = new Grid { ColumnSpacing = ClusterSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        left.Children.Add(new TsSkeleton { BlockWidth = SkeletonIconSize, BlockHeight = SkeletonIconSize, Radius = 999 });
        var lines = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        lines.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 18, Radius = 6 });
        lines.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 12, Radius = 6 });
        left.Children.Add(lines);
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RightClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        right.Children.Add(new TsSkeleton { BlockWidth = 72, BlockHeight = 24, Radius = 999 });
        right.Children.Add(new TsSkeleton { BlockWidth = 56, BlockHeight = 24, Radius = 6 });
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
        AutomationProperties.SetName(panel, display.LoadingLabel);
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        return panel;
    }

    // ── Empty (resolved, no drivetrain telemetry — friendly empty state, never a blank box) ────────────
    private static TsFadeIn BuildEmpty(HealthOverviewDisplay display)
    {
        var empty = new TsEmptyState { Message = display.EmptyMessage };
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = empty };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────
    private TsFadeIn BuildError(HealthOverviewDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the surface Narrator name and the adjacent badge already convey the health status.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static GlassGlow ToGlassGlow(HealthOverviewGlow glow) => glow switch
    {
        HealthOverviewGlow.Cyan => GlassGlow.Cyan,
        HealthOverviewGlow.Green => GlassGlow.Green,
        HealthOverviewGlow.Purple => GlassGlow.Purple,
        _ => GlassGlow.None,
    };
}
