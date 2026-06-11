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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 vehicle-detail <c>RecentActivity</c> feature surface — a parity port of
/// web/src/features/vehicles/components/RecentActivity.tsx. It is a presentational section: assign a
/// <see cref="Model"/> (the web <c>drives</c> / <c>sessions</c> props plus the distance unit and the parent's
/// fetch flag) and it renders either the parent's skeleton hand-off (<see cref="RecentActivityState.Loading"/>)
/// or the web's two-panel composition (<see cref="RecentActivityState.Ready"/>): the Recent Drives panel
/// beside the Recent Charges panel, each a <see cref="TsGlassPanel"/> with an accent header icon, a "View all"
/// affordance, and up to five tappable rows (a cyan / green <c>IconBox</c>, the count-up
/// <see cref="TsAnimatedNumber"/> distance / energy, the relative <see cref="TsDateTime"/> start time, the
/// <see cref="TsInlineMetric"/> <c>{h}h {m}m</c> duration and the optional "<c>{start}% → {end}%</c>" span),
/// falling back to a friendly empty note ("No drives recorded yet" / "No charging sessions recorded yet") when
/// a panel has nothing to show. The view never performs HTTP; all branch selection, unit conversion, number
/// formatting and label resolution happen in the WinUI-free <see cref="RecentActivityProjection"/>. The Ready
/// composition fades in through <see cref="TsFadeIn"/> and the count-up honours reduce-motion via
/// <see cref="MotionPreference"/>; every string resolves through the i18n facade; and the surface, each panel,
/// each "View all" affordance and each row carry a Narrator name.
/// </summary>
public sealed partial class RecentActivity : ContentControl
{
    private const int FadeDelayMs = 100;            // web FadeIn-equivalent reveal
    private const double PanelPadding = 24;         // web p-6
    private const double SectionGap = 24;           // web gap-6
    private const double HeaderBottomGap = 16;      // web mb-4
    private const double RowSpacing = 8;            // web space-y-2
    private const double RowPadding = 10;           // web p-2.5
    private const double RowColumnGap = 12;         // web gap-3
    private const double IconBoxSize = 32;          // web IconBox size="sm"
    private const double HeaderIconSize = 16;       // web h-4 w-4
    private const double TitleFontSize = 14;        // web section-title
    private const double ViewAllFontSize = 12;      // web text-xs
    private const double LabelFontSize = 12;        // web text-xs
    private const double CaptionFontSize = 10;      // web text-[10px]
    private const double ChevronSize = 10;          // web h-3 w-3

    private readonly ILocalizer _localizer;
    private readonly RecentActivityDiagnostics _diagnostics;

    private RecentActivityModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="RecentActivityModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RecentActivity(
        ILocalizer localizer,
        RecentActivityModel? model = null,
        RecentActivityDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? RecentActivityModel.Pending;
        _diagnostics = diagnostics ?? new RecentActivityDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a drive row is invoked (web <c>&lt;Link to="/drives/{id}"&gt;</c>); carries the drive id.</summary>
    public event EventHandler<long>? DriveSelected;

    /// <summary>Raised when a charge row is invoked (web <c>&lt;Link to="/charging/{id}"&gt;</c>); carries the session id.</summary>
    public event EventHandler<long>? ChargeSelected;

    /// <summary>Raised when the drives "View all" affordance is invoked (web <c>&lt;Link to="/drives"&gt;</c>).</summary>
    public event EventHandler? DrivesViewAllRequested;

    /// <summary>Raised when the charges "View all" affordance is invoked (web <c>&lt;Link to="/charging"&gt;</c>).</summary>
    public event EventHandler? ChargesViewAllRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RecentActivity</c>).</summary>
    public static string Slug => RecentActivityRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public RecentActivityModel Model
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
        var display = RecentActivityProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State == RecentActivityState.Loading
            ? BuildLoading(display)
            : new TsFadeIn { DelayMs = FadeDelayMs, Content = BuildReady(display) };
    }

    // ── Ready (web: grid grid-cols-1 gap-6 lg:grid-cols-2 — Recent Drives beside Recent Charges) ──────────
    private Grid BuildReady(RecentActivityDisplay display)
    {
        var grid = new Grid { ColumnSpacing = SectionGap, RowSpacing = SectionGap };
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());

        var drives = BuildPanel(
            display.Drives,
            () => DrivesViewAllRequested?.Invoke(this, EventArgs.Empty),
            id => DriveSelected?.Invoke(this, id));
        Grid.SetColumn(drives, 0);
        grid.Children.Add(drives);

        var charges = BuildPanel(
            display.Charges,
            () => ChargesViewAllRequested?.Invoke(this, EventArgs.Empty),
            id => ChargeSelected?.Invoke(this, id));
        Grid.SetColumn(charges, 1);
        grid.Children.Add(charges);

        return grid;
    }

    // web: a GlassPanel — header (accent icon + title + "View all") over the row list or the empty note.
    private static TsGlassPanel BuildPanel(RecentActivityPanel panel, Action onViewAll, Action<long> onRow)
    {
        Brush accent = AccentBrush(panel.Accent);
        var column = new StackPanel { Spacing = HeaderBottomGap };

        column.Children.Add(BuildHeader(panel, accent, onViewAll));

        if (panel.HasRows)
        {
            var list = new StackPanel { Spacing = RowSpacing };
            foreach (var row in panel.Rows)
            {
                list.Children.Add(BuildRow(row, panel.RowGlyph, accent, onRow));
            }

            column.Children.Add(list);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = RecentActivityProjection.ClockGlyph,
                Message = panel.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, panel.AutomationName);
        return glass;
    }

    // web: flex items-center justify-between — the accent title on the left, the "View all" link on the right.
    private static Grid BuildHeader(RecentActivityPanel panel, Brush accent, Action onViewAll)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = panel.HeaderGlyph,
            FontSize = HeaderIconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative — carried by the panel name

        var title = new TextBlock
        {
            Text = panel.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level3);

        heading.Children.Add(icon);
        heading.Children.Add(title);
        AutomationProperties.SetAccessibilityView(heading, AccessibilityView.Raw);
        Grid.SetColumn(heading, 0);
        header.Children.Add(heading);

        var viewAll = BuildViewAll(panel, onViewAll);
        Grid.SetColumn(viewAll, 1);
        header.Children.Add(viewAll);

        return header;
    }

    // web: <Link to="/drives|/charging"> {viewAll} <ChevronRight/> </Link>
    private static HyperlinkButton BuildViewAll(RecentActivityPanel panel, Action onViewAll)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(new TextBlock
        {
            Text = panel.ViewAllLabel,
            FontSize = ViewAllFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        content.Children.Add(new FontIcon
        {
            Glyph = RecentActivityProjection.ChevronGlyph,
            FontSize = ChevronSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var button = new HyperlinkButton
        {
            Content = content,
            Padding = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, $"{panel.ViewAllLabel}, {panel.Title}");
        button.Click += (_, _) => onViewAll();
        return button;
    }

    // web: <Link to="/drives/{id}|/charging/{id}"> IconBox + (value / time) + (duration / soc) </Link>
    private static Button BuildRow(RecentActivityRow row, string glyph, Brush accent, Action<long> onRow)
    {
        var grid = new Grid { ColumnSpacing = RowColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });               // IconBox
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // value / time
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });               // duration / soc

        var iconBox = BuildIconBox(glyph, accent);
        Grid.SetColumn(iconBox, 0);
        grid.Children.Add(iconBox);

        var center = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 2 };
        var value = new TsAnimatedNumber
        {
            Value = row.Value,
            Precision = row.ValuePrecision,
            Suffix = row.ValueSuffix,
            ReduceMotion = MotionPreference.ReduceMotion,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        center.Children.Add(value);

        var time = new TsDateTime
        {
            Value = row.Timestamp,
            Variant = DateTimeVariant.Relative,
        };
        AutomationProperties.SetAccessibilityView(time, AccessibilityView.Raw);
        center.Children.Add(time);

        Grid.SetColumn(center, 1);
        grid.Children.Add(center);

        var right = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 2,
        };

        var duration = new TsInlineMetric { Value = row.Duration, HorizontalAlignment = HorizontalAlignment.Right };
        AutomationProperties.SetAccessibilityView(duration, AccessibilityView.Raw);
        right.Children.Add(duration);

        if (row.SocSpan is { Length: > 0 } soc)
        {
            var socText = new TextBlock
            {
                Text = soc,
                FontSize = CaptionFontSize,
                Foreground = DisplayTokens.TextMuted, // web text-[10px] text-[var(--text-muted)]
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            AutomationProperties.SetAccessibilityView(socText, AccessibilityView.Raw);
            right.Children.Add(socText);
        }

        Grid.SetColumn(right, 2);
        grid.Children.Add(right);

        long id = row.Id;
        var button = new Button
        {
            Content = grid,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(RowPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, row.AutomationName);
        button.Click += (_, _) => onRow(id);
        return button;
    }

    // ── Loading (parent page still fetching) ──────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(RecentActivityDisplay display)
    {
        var grid = new Grid { ColumnSpacing = SectionGap, RowSpacing = SectionGap };
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());

        var drives = LoadingPanel();
        Grid.SetColumn(drives, 0);
        grid.Children.Add(drives);

        var charges = LoadingPanel();
        Grid.SetColumn(charges, 1);
        grid.Children.Add(charges);

        var shell = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
        AutomationProperties.SetName(shell, display.LoadingLabel);
        LiveRegion.Configure(shell);
        LiveRegion.Announce(shell);
        return shell;
    }

    private static TsGlassPanel LoadingPanel()
    {
        var column = new StackPanel { Spacing = HeaderBottomGap };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new TsSkeleton { BlockWidth = HeaderIconSize, BlockHeight = HeaderIconSize, Radius = 6 });
        header.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = TitleFontSize });
        column.Children.Add(header);

        var list = new StackPanel { Spacing = RowSpacing };
        for (int i = 0; i < RecentActivityProjection.MaxRows; i++)
        {
            list.Children.Add(new TsSkeleton { BlockHeight = 44, Radius = 12 });
        }

        column.Children.Add(list);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Shared helpers ────────────────────────────────────────────────────────────────────────────────────
    private static Border BuildIconBox(string glyph, Brush accent)
    {
        var box = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = new FontIcon { Glyph = glyph, FontSize = 14, Foreground = accent }, // web h-3.5 w-3.5
        };
        AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
        return box;
    }

    // web: cyan IconBox → info accent; green IconBox → success accent.
    private static Brush AccentBrush(string accent) => accent switch
    {
        RecentActivityProjection.ChargeAccent => ChartBrushes.ForStatus(StatusKind.Success),
        _ => ChartBrushes.ForStatus(StatusKind.Info),
    };

    private static ColumnDefinition StarColumn() => new() { Width = new GridLength(1, GridUnitType.Star) };
}
