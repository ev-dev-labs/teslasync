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
/// The native WinUI 3 <c>BatteryHealthSection</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx. It is a presentational
/// section of the Weekly-Digest experience: assign a <see cref="Model"/> (the web <c>metrics: DigestMetrics</c>
/// prop, narrowed to the battery-health fields, plus the parent-supplied lifecycle status) and it renders one
/// of the contract's states — <see cref="BatteryHealthSectionState.Loading"/> (skeleton chrome while the
/// digest query is in flight), <see cref="BatteryHealthSectionState.Empty"/> (a friendly empty state when no
/// charge sessions exist), <see cref="BatteryHealthSectionState.Error"/> (a retriable <see cref="TsQueryError"/>),
/// or the populated section (<see cref="BatteryHealthSectionState.Ready"/> /
/// <see cref="BatteryHealthSectionState.Stale"/> / <see cref="BatteryHealthSectionState.Offline"/>) — the
/// glass panel the web renders: the Battery-icon title, the two battery pills (avg battery at charge
/// start / end) and the three mini-stats (avg charge gain, charge sessions, est. range added), with a
/// stale / offline freshness chip layered on the cached snapshot. The view never performs HTTP; all branch
/// selection, label resolution and formatting happen in the WinUI-free
/// <see cref="BatteryHealthSectionProjection"/>. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, and the surface + each pill / stat carry a
/// Narrator name. A failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act
/// on (the parent owns the query).
/// </summary>
public sealed partial class BatteryHealthSection : ContentControl
{
    private const string BatteryGlyph = "\uE83F";     // Segoe Fluent — Battery (web Battery)
    private const string TrendingUpGlyph = "\uE9D2";  // Segoe Fluent — trending up (web TrendingUp)
    private const string LightningGlyph = "\uE945";   // Segoe Fluent — LightningBolt (web Zap)
    private const string LocationGlyph = "\uE707";    // Segoe Fluent — Location (web MapPin)

    private const double ContentSpacing = 24;  // web space-y-6
    private const double PanelPadding = 24;    // web p-6
    private const double BarWidth = 64;        // web w-16
    private const double BarHeight = 8;        // web h-2
    private const int FadeDelayMs = 200;       // web FadeIn delay 0.2

    private readonly ILocalizer _localizer;
    private readonly BatteryHealthSectionDiagnostics _diagnostics;

    private BatteryHealthSectionModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="BatteryHealthSectionModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryHealthSection(
        ILocalizer localizer,
        BatteryHealthSectionModel? model = null,
        BatteryHealthSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? BatteryHealthSectionModel.Loading;
        _diagnostics = diagnostics ?? new BatteryHealthSectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryHealthSection</c>).</summary>
    public static string Slug => BatteryHealthSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public BatteryHealthSectionModel Model
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
        var display = BatteryHealthSectionProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            BatteryHealthSectionState.Loading => BuildLoading(display),
            BatteryHealthSectionState.Empty => BuildEmpty(display),
            BatteryHealthSectionState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: title + pills + mini-stats) ─────────────────────────
    private static TsFadeIn BuildContent(BatteryHealthSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildPillsGrid(display));
        stack.Children.Add(BuildStatsGrid(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static Grid BuildHeader(BatteryHealthSectionDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(BatteryGlyph, 20, DisplayTokens.Brush("TsChartPowerBrush")));
        titleRow.Children.Add(new SectionTitle { Value = display.Title });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(BatteryHealthSectionDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    private static Grid BuildPillsGrid(BatteryHealthSectionDisplay display)
    {
        // web grid-cols-1 sm:grid-cols-2
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        for (int i = 0; i < display.Pills.Count; i++)
        {
            var pill = BuildPill(display.Pills[i]);
            Grid.SetColumn(pill, i);
            grid.Children.Add(pill);
        }

        return grid;
    }

    private static Grid BuildStatsGrid(BatteryHealthSectionDisplay display)
    {
        // web grid-cols-1 sm:grid-cols-3
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var stat = BuildStat(display.Stats[i]);
            Grid.SetColumn(stat, i);
            grid.Children.Add(stat);
        }

        return grid;
    }

    // web BatteryPill: icon + label/value column + a thin level bar, all tinted by the status threshold.
    private static TsGlassPanel BuildPill(BatteryHealthPill pill)
    {
        var brush = DisplayTokens.Brush(StatusResources.AccentBrushKey(pill.Status));

        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = DecorativeIcon(BatteryGlyph, 20, brush);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(Caption(pill.Label, DisplayTokens.TextSecondary));
        text.Children.Add(new TextBlock
        {
            Text = pill.LevelText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.Bold,
            Foreground = brush,
        });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var bar = BuildBar(pill.BarFraction, brush);
        Grid.SetColumn(bar, 2);
        grid.Children.Add(bar);

        var panel = new TsGlassPanel { Padding = new Thickness(16, 12, 16, 12), Content = grid };
        AutomationProperties.SetName(panel, pill.AutomationName);
        return panel;
    }

    private static Border BuildBar(double fraction, Brush fill)
    {
        var radius = DisplayTokens.Radius("TsRadiusPill", 999);
        var track = new Border
        {
            Width = BarWidth,
            Height = BarHeight,
            CornerRadius = radius,
            Background = DisplayTokens.Border,
            VerticalAlignment = VerticalAlignment.Center,
        };
        track.Child = new Border
        {
            Width = BarWidth * Math.Clamp(fraction, 0, 1),
            Height = BarHeight,
            CornerRadius = radius,
            Background = fill,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    // web MiniStat: a muted leading icon + a label/value column.
    private static TsGlassPanel BuildStat(BatteryHealthStat stat)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = DecorativeIcon(GlyphFor(stat.Kind), 16, DisplayTokens.TextMuted);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(Caption(stat.Label, DisplayTokens.TextSecondary));
        text.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var panel = new TsGlassPanel { Padding = new Thickness(16, 12, 16, 12), Content = grid };
        AutomationProperties.SetName(panel, stat.AutomationName);
        return panel;
    }

    private static string GlyphFor(BatteryHealthStatKind kind) => kind switch
    {
        BatteryHealthStatKind.ChargeGain => TrendingUpGlyph,
        BatteryHealthStatKind.ChargeSessions => LightningGlyph,
        _ => LocationGlyph,
    };

    // ── Loading (parent still fetching the digest) ─────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(BatteryHealthSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 24 });
        stack.Children.Add(SkeletonRow(2, 64));
        stack.Children.Add(SkeletonRow(3, 56));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private static Grid SkeletonRow(int count, double height)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int c = 0; c < count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < count; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = height };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        return grid;
    }

    // ── Empty (web parity: no charge sessions to summarise) ────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(BatteryHealthSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState { IconGlyph = BatteryGlyph, Message = display.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────
    private TsFadeIn BuildError(BatteryHealthSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Shared primitives ──────────────────────────────────────────────────────────────────────────────
    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the panel / surface automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static TextBlock Caption(string text, Brush foreground) => new()
    {
        Text = text,
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = foreground,
        TextWrapping = TextWrapping.Wrap,
    };
}
