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
/// The native WinUI 3 <c>LiveTelemetry</c> feature surface — a parity port of
/// web/src/features/dashboard/components/LiveTelemetry.tsx. It is a presentational surface: assign a
/// <see cref="Model"/> (the web component's six live-data props plus the user's unit preference) and it renders
/// the web's section divider ("Live Telemetry") above the responsive grid (web <c>grid-cols-1 sm:grid-cols-2
/// lg:grid-cols-3</c>) of six <see cref="TsGlassPanel"/> panels — Drivetrain, Climate, Security, Tire Pressure,
/// Media and Navigation. Each panel independently renders its loading skeleton while its data group is null and
/// its populated content (with the web's per-field em-dash fallbacks, status chips, lock / Sentry colouring,
/// tire freshness colours and fan / volume meters) otherwise, exactly mirroring the web's <c>{data ? … :
/// &lt;SkeletonRows /&gt;}</c> branch. The view never performs HTTP and never converts units itself: all branch
/// selection, label resolution and SI→display formatting happen in the WinUI-free
/// <see cref="LiveTelemetryProjection"/>. Skeleton shimmer honours reduce-motion, every string resolves through
/// the i18n facade and the surface plus every panel carries a Narrator name.
/// </summary>
public sealed partial class LiveTelemetry : ContentControl
{
    private const double TwoColumnMinWidth = 640;   // web sm: breakpoint
    private const double ThreeColumnMinWidth = 960;  // web lg: breakpoint
    private const double PanelPadding = 16;          // web p-4
    private const double PanelGap = 16;              // web gap-4
    private const double HeaderGlyphSize = 14;       // web h-3.5 w-3.5
    private const double SectionGlyphSize = 16;      // web h-4 w-4
    private const double ChipGlyphSize = 11;
    private const double MeterHeight = 6;            // web h-1.5
    private const int SkeletonRowCount = 4;          // web SkeletonRows maps four lines
    private const double SkeletonRowHeight = 20;     // web h-5

    private const string CogGlyph = "\uE713";        // Settings (web lucide Cog)
    private const string ThermometerGlyph = "\uE9CA"; // Frigid (web lucide Thermometer)
    private const string ShieldGlyph = "\uEA18";      // Shield (web lucide Shield / ShieldCheck)
    private const string TireGlyph = "\uE91F";        // CircleFill (web lucide CircleDot)
    private const string MediaGlyph = "\uE767";       // Volume (web lucide Headphones)
    private const string NavigationGlyph = "\uE707";  // MapPin (web lucide Navigation2)
    private const string LockedGlyph = "\uE72E";      // Lock
    private const string UnlockedGlyph = "\uE785";    // Unlock
    private const string ZapGlyph = "\uE945";         // LightningBolt (web lucide Zap)
    private const string HomeGlyph = "\uE80F";        // Home
    private const string WorkGlyph = "\uE821";        // Work
    private const string FavoriteGlyph = "\uE734";    // FavoriteStar

    private const string PurpleAccentKey = "TsChartPowerBrush";  // web glow="purple"
    private const string CyanAccentKey = "TsChartSpeedBrush";    // web glow="cyan"
    private const string GreenAccentKey = "TsChartBatteryBrush"; // web glow="green"

    private readonly ILocalizer _localizer;
    private readonly LiveTelemetryDiagnostics _diagnostics;

    private LiveTelemetryModel _model;
    private bool _opened;
    private int _columns = 3;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="LiveTelemetryModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveTelemetry(
        ILocalizer localizer,
        LiveTelemetryModel? model = null,
        LiveTelemetryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? LiveTelemetryModel.Pending;
        _diagnostics = diagnostics ?? new LiveTelemetryDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LiveTelemetry</c>).</summary>
    public static string Slug => LiveTelemetryRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public LiveTelemetryModel Model
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= ThreeColumnMinWidth
            ? 3
            : e.NewSize.Width >= TwoColumnMinWidth ? 2 : 1;
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
    }

    private void Render()
    {
        LiveTelemetryDisplay display = LiveTelemetryProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        var root = new StackPanel { Spacing = PanelGap };
        root.Children.Add(BuildSectionHeader(display.Title));
        root.Children.Add(BuildGrid(
            BuildDrivetrainPanel(display.Drivetrain),
            BuildClimatePanel(display.Climate),
            BuildSecurityPanel(display.Security),
            BuildTirePanel(display.TirePressure),
            BuildMediaPanel(display.Media),
            BuildNavigationPanel(display.Navigation)));

        Content = root;
    }

    // ── Section header (web divider + "Live Telemetry") ─────────────────────────────────────────────────

    private static StackPanel BuildSectionHeader(string title)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = CogGlyph,
            FontSize = SectionGlyphSize,
            Foreground = DisplayTokens.Brush(CyanAccentKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        header.Children.Add(icon);
        header.Children.Add(new SectionTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    // ── Panels ──────────────────────────────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildDrivetrainPanel(DrivetrainDisplay d) => BuildPanel(
        d.Title, CogGlyph, GlassGlow.Purple, PurpleAccentKey, d.HasData, d.AutomationName, () =>
        {
            var body = NewBody();
            body.Children.Add(BuildMetricRow(d.Torque));
            body.Children.Add(BuildMetricRow(d.MotorTemp));
            body.Children.Add(BuildGearRow(d));
            body.Children.Add(BuildMetricRow(d.GForce));
            return body;
        });

    private static TsGlassPanel BuildClimatePanel(ClimateDisplay c) => BuildPanel(
        c.Title, ThermometerGlyph, GlassGlow.Cyan, CyanAccentKey, c.HasData, c.AutomationName, () =>
        {
            var body = NewBody();
            body.Children.Add(BuildMetricRow(c.Cabin));
            body.Children.Add(BuildMetricRow(c.Outside));
            body.Children.Add(BuildMetricRow(c.HvacPower));
            body.Children.Add(BuildMeterRow(c.Fan, CyanAccentKey));
            body.Children.Add(BuildClimateModes(c));
            return body;
        });

    private static TsGlassPanel BuildSecurityPanel(SecurityDisplay s) => BuildPanel(
        s.Title, ShieldGlyph, GlassGlow.Green, GreenAccentKey, s.HasData, s.AutomationName, () =>
        {
            var body = NewBody();
            body.Children.Add(BuildAccentRow(
                s.LockLabel,
                s.Locked ? LockedGlyph : UnlockedGlyph,
                s.LockText,
                s.Locked ? StatusBrush(StatusKind.Success) : StatusBrush(StatusKind.Danger)));
            body.Children.Add(BuildAccentRow(
                s.SentryLabel,
                ShieldGlyph,
                s.SentryText,
                s.SentryActive ? StatusBrush(StatusKind.Info) : DisplayTokens.TextMuted));
            body.Children.Add(BuildStatusRow(s.Doors));
            body.Children.Add(BuildStatusRow(s.Windows));
            return body;
        });

    private static TsGlassPanel BuildTirePanel(TirePressureDisplay t) => BuildPanel(
        t.Title, TireGlyph, GlassGlow.Cyan, CyanAccentKey, t.HasData, t.AutomationName, () =>
        {
            var body = new StackPanel { Spacing = 12 };

            var corners = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
            corners.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            corners.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            corners.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            corners.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            for (int i = 0; i < t.Corners.Count; i++)
            {
                Border tile = BuildTireCorner(t.Corners[i], t.UnitLabel);
                Grid.SetColumn(tile, i % 2);
                Grid.SetRow(tile, i / 2);
                corners.Children.Add(tile);
            }

            body.Children.Add(corners);

            TsBadge summary = BuildBadge(t.Summary.Text, t.Summary.Status);
            summary.HorizontalAlignment = HorizontalAlignment.Center;
            AutomationProperties.SetName(summary, t.Summary.Text);
            body.Children.Add(summary);
            return body;
        });

    private static TsGlassPanel BuildMediaPanel(MediaDisplay m) => BuildPanel(
        m.Title, MediaGlyph, GlassGlow.Purple, PurpleAccentKey, m.HasData, m.AutomationName, () =>
        {
            var body = NewBody();

            var nowPlaying = new StackPanel { Spacing = 2 };
            nowPlaying.Children.Add(new TextBlock
            {
                Text = m.TrackTitle,
                FontSize = BodyFontSize,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            nowPlaying.Children.Add(new TextBlock
            {
                Text = m.Artist,
                FontSize = CaptionFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            body.Children.Add(nowPlaying);

            body.Children.Add(BuildStatusRow(m.Status));
            body.Children.Add(BuildMeterRow(m.Volume, PurpleAccentKey));
            return body;
        });

    private static TsGlassPanel BuildNavigationPanel(NavigationDisplay n) => BuildPanel(
        n.Title, NavigationGlyph, GlassGlow.Cyan, CyanAccentKey, n.HasData, n.AutomationName, () =>
        {
            var body = NewBody();
            body.Children.Add(BuildMetricRow(n.Destination));
            body.Children.Add(BuildMetricRow(n.Distance));
            body.Children.Add(BuildMetricRow(n.Eta));
            body.Children.Add(BuildNavigationLocations(n));
            return body;
        });

    // ── Panel shell + skeleton ──────────────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildPanel(
        string title,
        string glyph,
        GlassGlow glow,
        string accentKey,
        bool hasData,
        string automationName,
        Func<FrameworkElement> bodyFactory)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildPanelHeader(title, glyph, accentKey));
        column.Children.Add(hasData ? bodyFactory() : BuildSkeletonRows());

        var glass = new TsGlassPanel
        {
            Glow = glow,
            Padding = new Thickness(PanelPadding),
            Content = column,
        };
        AutomationProperties.SetName(glass, automationName);
        return glass;
    }

    private static StackPanel BuildPanelHeader(string title, string glyph, string accentKey)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = HeaderGlyphSize,
            Foreground = DisplayTokens.Brush(accentKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    private static StackPanel BuildSkeletonRows()
    {
        var stack = new StackPanel { Spacing = 10 };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            stack.Children.Add(new TsSkeleton
            {
                BlockHeight = SkeletonRowHeight,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    // ── Row builders ────────────────────────────────────────────────────────────────────────────────────

    private static Grid BuildMetricRow(TelemetryMetric metric)
    {
        Grid row = TwoColumnRow();
        row.Children.Add(LabelText(metric.Label));
        row.Children.Add(ValueText(metric.Value));
        AutomationProperties.SetName(row, $"{metric.Label} {metric.Value}");
        return row;
    }

    private static Grid BuildStatusRow(TelemetryStatus status)
    {
        Grid row = TwoColumnRow();
        row.Children.Add(LabelText(status.Label));

        TsBadge badge = BuildBadge(status.Text, status.Status);
        badge.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(badge, 1);
        row.Children.Add(badge);

        AutomationProperties.SetName(row, $"{status.Label} {status.Text}");
        return row;
    }

    private static Grid BuildGearRow(DrivetrainDisplay d)
    {
        Grid row = TwoColumnRow();
        row.Children.Add(LabelText(d.GearLabel));

        if (d.GearKnown)
        {
            TsBadge badge = BuildBadge(d.GearText, d.GearStatus);
            badge.HorizontalAlignment = HorizontalAlignment.Right;
            Grid.SetColumn(badge, 1);
            row.Children.Add(badge);
        }
        else
        {
            TextBlock dash = ValueText(d.GearText);
            dash.Foreground = DisplayTokens.TextMuted;
            row.Children.Add(dash);
        }

        AutomationProperties.SetName(row, $"{d.GearLabel} {d.GearText}");
        return row;
    }

    private static Grid BuildAccentRow(string label, string glyph, string valueText, Brush accent)
    {
        Grid row = TwoColumnRow();
        row.Children.Add(LabelText(label));

        var value = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = ChipGlyphSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        value.Children.Add(icon);
        value.Children.Add(new TextBlock
        {
            Text = valueText,
            FontSize = BodyFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Grid.SetColumn(value, 1);
        row.Children.Add(value);
        AutomationProperties.SetName(row, $"{label} {valueText}");
        return row;
    }

    private static StackPanel BuildMeterRow(TelemetryGauge gauge, string accentKey)
    {
        var stack = new StackPanel { Spacing = 4 };

        Grid top = TwoColumnRow();
        top.Children.Add(LabelText(gauge.Label));
        TextBlock value = ValueText(gauge.ValueText);
        value.FontWeight = FontWeights.Normal;
        value.Foreground = DisplayTokens.TextMuted;
        value.FontSize = CaptionFontSize;
        top.Children.Add(value);
        stack.Children.Add(top);

        stack.Children.Add(BuildMeter(gauge.Fraction, accentKey));
        AutomationProperties.SetName(stack, $"{gauge.Label} {gauge.ValueText}");
        return stack;
    }

    private static Grid BuildMeter(double fraction, string accentKey)
    {
        double filled = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;

        var meter = new Grid { Height = MeterHeight };
        meter.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(filled, GridUnitType.Star) });
        meter.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - filled, GridUnitType.Star) });

        var track = new Border
        {
            Background = DisplayTokens.Brush("TsColorBorderBrush"),
            CornerRadius = new CornerRadius(MeterHeight / 2),
        };
        Grid.SetColumn(track, 0);
        Grid.SetColumnSpan(track, 2);
        meter.Children.Add(track);

        var fill = new Border
        {
            Background = DisplayTokens.Brush(accentKey),
            CornerRadius = new CornerRadius(MeterHeight / 2),
        };
        Grid.SetColumn(fill, 0);
        meter.Children.Add(fill);

        AutomationProperties.SetAccessibilityView(meter, AccessibilityView.Raw);
        return meter;
    }

    private static FrameworkElement BuildClimateModes(ClimateDisplay c)
    {
        if (!c.AnyModes)
        {
            return MutedCaption(c.NoModesText);
        }

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (c.ShowDefrost)
        {
            chips.Children.Add(BuildIconChip(ThermometerGlyph, c.DefrostText, StatusKind.Info));
        }

        if (c.ShowBatteryHeater)
        {
            chips.Children.Add(BuildIconChip(ZapGlyph, c.BatteryHeaterText, StatusKind.Warning));
        }

        return chips;
    }

    private static FrameworkElement BuildNavigationLocations(NavigationDisplay n)
    {
        if (!n.AnyLocation)
        {
            return MutedCaption(n.NoLocationText);
        }

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (n.AtHome)
        {
            chips.Children.Add(BuildIconChip(HomeGlyph, n.HomeText, StatusKind.Success));
        }

        if (n.AtWork)
        {
            chips.Children.Add(BuildIconChip(WorkGlyph, n.WorkText, StatusKind.Info));
        }

        if (n.AtFavorite)
        {
            chips.Children.Add(BuildIconChip(FavoriteGlyph, n.FavoriteText, StatusKind.Neutral));
        }

        return chips;
    }

    private static Border BuildTireCorner(TireCornerDisplay corner, string unitLabel)
    {
        var stack = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        stack.Children.Add(new TextBlock
        {
            Text = corner.Label,
            FontSize = TinyFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        stack.Children.Add(new TextBlock
        {
            Text = corner.Value,
            FontSize = BodyFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = LevelBrush(corner.Level),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        stack.Children.Add(new TextBlock
        {
            Text = unitLabel,
            FontSize = TinyFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var tile = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(8),
            Child = stack,
        };
        AutomationProperties.SetName(tile, $"{corner.Label} {corner.Value} {unitLabel}");
        return tile;
    }

    // ── Small shared pieces ─────────────────────────────────────────────────────────────────────────────

    private static TsBadge BuildBadge(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = CaptionFontSize },
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TsBadge BuildIconChip(string glyph, string text, StatusKind status)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = ChipGlyphSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        content.Children.Add(icon);
        content.Children.Add(new TextBlock { Text = text, FontSize = CaptionFontSize, VerticalAlignment = VerticalAlignment.Center });

        var chip = new TsBadge { Status = status, Content = content };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    private static TextBlock MutedCaption(string text)
    {
        var caption = new TextBlock
        {
            Text = text,
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextMuted,
        };
        AutomationProperties.SetName(caption, text);
        return caption;
    }

    private static Grid TwoColumnRow()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        return grid;
    }

    private static TextBlock LabelText(string text)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        Grid.SetColumn(block, 0);
        return block;
    }

    private static TextBlock ValueText(string text)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = BodyFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(block, 1);
        return block;
    }

    private static StackPanel NewBody() => new() { Spacing = 10 };

    private Grid BuildGrid(params FrameworkElement[] panels)
    {
        var grid = new Grid { ColumnSpacing = PanelGap, RowSpacing = PanelGap };

        int columns = _columns < 1 ? 1 : _columns;
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (panels.Length + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < panels.Length; i++)
        {
            FrameworkElement panel = panels[i];
            panel.VerticalAlignment = VerticalAlignment.Top;
            Grid.SetColumn(panel, i % columns);
            Grid.SetRow(panel, i / columns);
            grid.Children.Add(panel);
        }

        return grid;
    }

    private static Brush StatusBrush(StatusKind status) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    private static Brush LevelBrush(TirePressureLevel level) => level switch
    {
        TirePressureLevel.Normal => StatusBrush(StatusKind.Success),
        TirePressureLevel.Warning => StatusBrush(StatusKind.Warning),
        TirePressureLevel.Critical => StatusBrush(StatusKind.Danger),
        _ => DisplayTokens.TextMuted,
    };

    private static double BodyFontSize => TypographyTokens.Size("TsTypeBodyFontSize", 14);

    private static double CaptionFontSize => TypographyTokens.Size("TsTypeCaptionFontSize", 12);

    private static double TinyFontSize => TypographyTokens.Size("TsTypeOverlineFontSize", 10);
}
