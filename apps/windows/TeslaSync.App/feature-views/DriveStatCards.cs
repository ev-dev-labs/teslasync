using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>DriveStatCards</c> feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/DriveStatCards.tsx. It is the presentational responsive
/// grid of drive-summary tiles: assign a <see cref="Model"/> and it renders the web composition — the eight
/// always-present tiles (Distance, Duration, Max Speed, Avg Speed, SOC, Max Power, Elevation Gain, Elevation
/// Loss) plus the two energy-gated tiles (Trip Cost when <c>energyWh &gt; 0</c>, Cost-per-distance when
/// <c>energyWh &gt; 0 &amp;&amp; distanceM &gt; 0</c>) — each as a <see cref="TsGlassPanel"/> (the native
/// <c>GlassPanel</c>) with a tinted Fluent glyph, a bold readout and a muted caption. The five web
/// <c>AnimatedNumber</c> tiles count up through the native <see cref="TsAnimatedNumber"/>; the rest render
/// their formatted string. Each tile enters with a staggered <see cref="TsFadeIn"/> (the native
/// <c>StaggerContainer</c> / <c>StaggerItem</c>), and the grid reflows 2 → 4 → 8 columns across the web
/// <c>sm</c> / <c>lg</c> breakpoints. While the parent has not resolved the drive the surface renders tokenized
/// skeleton chrome — never a blank box. SI is converted to the user's units only here (web <c>useUnits</c>) via
/// the WinUI-free <see cref="DriveStatCardsProjection"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade, the decorative glyphs are hidden from Narrator, every tile carries a composed
/// Narrator name, and the motion is the system-honoured <see cref="TsFadeIn"/> / <see cref="TsAnimatedNumber"/>,
/// so reduced-motion is respected by construction.
/// </summary>
public sealed partial class DriveStatCards : ContentControl
{
    private const double NarrowBreakpoint = 640;  // web Tailwind `sm:` (grid-cols-2 → grid-cols-4)
    private const double WideBreakpoint = 1024;    // web Tailwind `lg:` (grid-cols-4 → grid-cols-8)
    private const int LoadingTiles = 8;            // the eight always-present tiles
    private const double CardSpacing = 12;          // web `gap-3`
    private const double TileHeight = 96;           // skeleton tile height ≈ a populated tile
    private const int StaggerStepMs = 40;           // per-tile entrance delay (web StaggerContainer)
    private const double IconSize = 16;             // web Lucide `h-4 w-4`
    private const double ValueFontSize = 24;        // native animated-number house size (web `text-lg`)
    private const double LabelFontSize = 11;        // web `text-[10px]`

    private readonly ILocalizer _localizer;
    private readonly DriveStatCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly Border _bodyHost = new();

    private DriveStatCardsModel _model;
    private UnitPref _units;
    private DriveStatsFormatting _formatting;
    private bool _opened;
    private bool _renderQueued;

    /// <summary>Creates the surface over its i18n facade, an initial model, the user's units, formatting and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="DriveStatCardsModel.Pending"/>.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="formatting">The currency + cost-rate + precision context (web <c>useFormatting</c>); defaults when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DriveStatCards(
        ILocalizer localizer,
        DriveStatCardsModel? model = null,
        UnitPref? units = null,
        DriveStatsFormatting? formatting = null,
        DriveStatCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DriveStatCardsModel.Pending;
        _units = units ?? UnitPref.Metric;
        _formatting = formatting ?? DriveStatsFormatting.Default;
        _diagnostics = diagnostics ?? new DriveStatCardsDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Content = _bodyHost;
        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DriveStatCards</c>).</summary>
    public static string Slug => DriveStatCardsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the grid.</summary>
    public DriveStatCardsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the tiles in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
            Render();
        }
    }

    /// <summary>The currency + cost-rate + precision context; reassigning re-projects the cost tiles.</summary>
    public DriveStatsFormatting Formatting
    {
        get => _formatting;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _formatting = value;
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
        if (e.PreviousSize.Width != e.NewSize.Width && _model.Stats is not null)
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = DriveStatCardsProjection.Project(_model, _units, _formatting, _localizer);
        AutomationProperties.SetName(this, display.RegionLabel);

        _bodyHost.Child = display.State == DriveStatCardsState.Loading
            ? BuildLoading(display)
            : BuildGrid(display);
    }

    // ── Ready (the web stat-card grid) ───────────────────────────────────────────────────────────────────
    private Grid BuildGrid(DriveStatCardsDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = BuildColumnGrid(columns, display.Cards.Count);

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var tile = BuildTile(display.Cards[i]);
            // web StaggerContainer / StaggerItem — each tile rises in with an increasing delay.
            var entrance = new TsFadeIn { DelayMs = i * StaggerStepMs, Content = tile };
            Grid.SetColumn(entrance, i % columns);
            Grid.SetRow(entrance, i / columns);
            grid.Children.Add(entrance);
        }

        return grid;
    }

    private static TsGlassPanel BuildTile(DriveStatCardModel card)
    {
        // web `<GlassPanel className="p-4 text-center">`.
        var icon = new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush(card.ColorKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 4), // web `mb-1`
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        stack.Children.Add(icon);
        stack.Children.Add(BuildValue(card));
        stack.Children.Add(new TextBlock
        {
            Text = card.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        var tile = new TsGlassPanel { Padding = new Thickness(16), Content = stack };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private static FrameworkElement BuildValue(DriveStatCardModel card)
    {
        // web `<p className="text-lg font-bold">{value}</p>` — an AnimatedNumber for the five count-up tiles,
        // a plain string for the rest.
        if (card.AnimatedValue is { } target)
        {
            return new TsAnimatedNumber
            {
                Value = target,
                Precision = card.AnimatedPrecision,
                Suffix = card.AnimatedSuffix,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
        }

        return new TextBlock
        {
            Text = card.Value,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
    }

    // ── Loading (parent still resolving the drive) ───────────────────────────────────────────────────────
    private Grid BuildLoading(DriveStatCardsDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = BuildColumnGrid(columns, LoadingTiles);

        for (int i = 0; i < LoadingTiles; i++)
        {
            var tile = new TsSkeleton { BlockHeight = TileHeight, ReduceMotion = MotionPreference.ReduceMotion };
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, display.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static Grid BuildColumnGrid(int columns, int itemCount)
    {
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = Math.Max(1, (int)Math.Ceiling(itemCount / (double)columns));
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    // web grid-cols-2 / sm:grid-cols-4 / lg:grid-cols-8.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 4,
        < NarrowBreakpoint => 2,
        < WideBreakpoint => 4,
        _ => 8,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DriveStatCardsAutomationPeer(this);

    private sealed class DriveStatCardsAutomationPeer(DriveStatCards owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }

            return ((DriveStatCards)Owner)._localizer.GetString(
                DriveStatCardsRegistration.RegionLabelKey, DriveStatCardsRegistration.RegionLabelFallback);
        }
    }
}
