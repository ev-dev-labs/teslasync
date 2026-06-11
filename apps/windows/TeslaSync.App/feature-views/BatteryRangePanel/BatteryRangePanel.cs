using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>BatteryRangePanel</c> feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx. It renders the web layout inside a
/// glass panel: a 140 px radial battery gauge beside a three-card grid (Rated Range, Ideal Range, Charging).
/// The web component is presentational (it receives its <c>state</c> prop from the vehicle-detail page); the
/// native feature view binds the same <c>GET /vehicles/{vehicleID}/state</c> data through the shared
/// <see cref="BatteryRangePanelViewModel"/> so every state — loading (skeleton chrome), loaded, empty (asleep /
/// no vehicle), error (retry), stale (stale chip), offline (offline chip) — renders as a visible surface, never
/// hidden. All value derivation, unit conversion and formatting happen in the WinUI-free
/// <see cref="BatteryRangePanelProjection"/>; the view never performs HTTP. The web gauge tints its arc by the
/// state-of-charge band; because <see cref="TsRadialGauge"/> tints from a themed chart role (not arbitrary
/// hex), the green / amber / red band is mirrored onto the gauge role plus an explicit state-of-charge band
/// indicator beneath the gauge. Every string resolves through the i18n facade and every element carries a
/// Narrator name.
/// </summary>
public sealed partial class BatteryRangePanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double GaugeDiameter = 140;     // web RadialGauge size={140}
    private const double PanelPadding = 24;       // web GlassPanel p-6
    private const double BandWidth = 56;
    private const double BandHeight = 4;
    private const int MetricColumns = 3;          // web sm:grid-cols-3

    private readonly BatteryRangePanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryRangePanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly TsGlassPanel _panel = new();
    private readonly ContentPresenter _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryRangePanel(
        IBatteryRangePanelSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        BatteryRangePanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryRangePanelDiagnostics();
        _viewModel = new BatteryRangePanelViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryRangePanel</c>).</summary>
    public static string Slug => BatteryRangePanelRegistration.Slug;

    /// <summary>The user's unit preference; reassigning re-projects the gauge and the cards in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryRangePanelSource"/> from the
    /// shared data layer (the vehicle-detail host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static BatteryRangePanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        BatteryRangePanelDiagnostics? diagnostics = null)
    {
        var source = new BatteryRangePanelSource(api, engine, options, vehicleId);
        return new BatteryRangePanel(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("common.refresh", "Refresh"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(actions, 1);
        _header.Children.Add(actions);

        _panel.Padding = new Thickness(PanelPadding);
        _panel.Content = _bodyHost;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_panel, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_panel);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        switch (_viewModel.State)
        {
            case BatteryRangePanelState.Loading:
                Content = BuildLoadingPanel();
                break;

            case BatteryRangePanelState.Error:
                Content = BuildErrorPanel();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = _viewModel.HasData ? BuildContent(_viewModel.Display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private TsGlassPanel BuildLoadingPanel()
    {
        var layout = new Grid { ColumnSpacing = PanelPadding };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var gauge = new TsSkeleton
        {
            BlockWidth = GaugeDiameter,
            BlockHeight = GaugeDiameter,
            Radius = GaugeDiameter / 2,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Grid.SetColumn(gauge, 0);

        var cards = new TsGrid { Columns = MetricColumns, Gutter = 16, ItemMinWidth = 120, VerticalAlignment = VerticalAlignment.Top };
        for (int i = 0; i < MetricColumns; i++)
        {
            var column = new StackPanel { Spacing = 8 };
            column.Children.Add(new TsSkeleton { BlockWidth = 72, BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockWidth = 96, BlockHeight = 22 });
            cards.Children.Add(SurfaceCard(column));
        }

        Grid.SetColumn(cards, 1);
        layout.Children.Add(gauge);
        layout.Children.Add(cards);

        AutomationProperties.SetName(layout, _localizer.GetString("common.loading", "Loading"));
        LiveRegion.Configure(layout);
        LiveRegion.Announce(layout);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = layout };
    }

    private TsGlassPanel BuildErrorPanel()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("vehicles.detail.batteryRange.error", "Couldn't load battery and range"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryRangePanelProjection.ChargingGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // web: flex-col items-center gap-6 sm:flex-row sm:items-start — gauge beside the three-card grid.
    private static Grid BuildContent(BatteryRangeDisplay display)
    {
        var layout = new Grid { ColumnSpacing = PanelPadding };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var gauge = BuildGauge(display);
        Grid.SetColumn(gauge, 0);

        var cards = BuildCards(display.Metrics);
        Grid.SetColumn(cards, 1);

        layout.Children.Add(gauge);
        layout.Children.Add(cards);
        return layout;
    }

    private static StackPanel BuildGauge(BatteryRangeDisplay display)
    {
        var gauge = new TsRadialGauge
        {
            Value = display.BatteryLevel,
            Max = BatteryRangePanelProjection.BatteryGaugeMax,
            Label = display.BatteryLabel,
            Unit = display.BatteryUnit,
            Decimals = 0,
            Diameter = GaugeDiameter,
            Role = GaugeRole(display.BatteryAccent),
        };
        AutomationProperties.SetName(gauge, display.BatteryAutomationName);

        // web parity: the gauge arc is tinted by the state-of-charge band. TsRadialGauge tints from a themed
        // chart role (never arbitrary hex), so the green / amber / red band is mirrored here as an explicit
        // state-of-charge indicator whose brush is the exact web token (#10B981 / #F59E0B / #EF4444).
        var band = new Border
        {
            Width = BandWidth,
            Height = BandHeight,
            CornerRadius = new CornerRadius(BandHeight / 2),
            Background = StatusBrush(display.BatteryBand),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(band, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(gauge);
        column.Children.Add(band);
        return column;
    }

    private static TsGrid BuildCards(IReadOnlyList<BatteryRangeMetric> metrics)
    {
        var grid = new TsGrid { Columns = MetricColumns, Gutter = 16, ItemMinWidth = 120, VerticalAlignment = VerticalAlignment.Top };
        foreach (var metric in metrics)
        {
            grid.Children.Add(BuildCard(metric));
        }

        return grid;
    }

    private static Border BuildCard(BatteryRangeMetric metric)
    {
        var label = new TextBlock
        {
            Text = metric.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = metric.Value,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Left };
        column.Children.Add(label);
        column.Children.Add(value);

        if (!string.IsNullOrEmpty(metric.Subtitle))
        {
            column.Children.Add(new TextBlock
            {
                Text = metric.Subtitle,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var iconBox = BuildIconBox(metric);
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(column, 0);
        Grid.SetColumn(iconBox, 1);
        content.Children.Add(column);
        content.Children.Add(iconBox);

        var card = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, metric.AutomationName);
        return card;
    }

    private static Border BuildIconBox(BatteryRangeMetric metric)
    {
        var (iconBrush, bgBrush, ringBrush) = AccentBrushes(metric.Accent);

        var icon = new FontIcon
        {
            Glyph = metric.Glyph,
            FontSize = 16,
            Foreground = iconBrush,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        return new Border
        {
            Child = icon,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = bgBrush,
            BorderBrush = ringBrush,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6),
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private static Border SurfaceCard(UIElement child) => new()
    {
        Child = child,
        CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        Background = DisplayTokens.Surface,
        Padding = new Thickness(12),
    };

    private static Brush StatusBrush(StatusKind band) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(band));

    private static ChartRole GaugeRole(BatteryRangeAccent accent) => accent switch
    {
        BatteryRangeAccent.Green => ChartRole.Battery,
        BatteryRangeAccent.Amber => ChartRole.Energy,
        _ => ChartRole.None,
    };

    private static (Brush Icon, Brush Background, Brush Ring) AccentBrushes(BatteryRangeAccent accent)
    {
        var baseBrush = DisplayTokens.Brush(AccentBrushKey(accent));
        if (baseBrush is SolidColorBrush solid)
        {
            var c = solid.Color;
            return (
                new SolidColorBrush(c),
                new SolidColorBrush(Windows.UI.Color.FromArgb(0x1A, c.R, c.G, c.B)),
                new SolidColorBrush(Windows.UI.Color.FromArgb(0x33, c.R, c.G, c.B)));
        }

        return (baseBrush, DisplayTokens.Surface, DisplayTokens.Border);
    }

    private static string AccentBrushKey(BatteryRangeAccent accent) => accent switch
    {
        BatteryRangeAccent.Cyan => "TsChartSpeedBrush",
        BatteryRangeAccent.Green => "TsChartBatteryBrush",
        BatteryRangeAccent.Amber => "TsChartEnergyBrush",
        BatteryRangeAccent.Red => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new BatteryRangePanelAutomationPeer(this);

    private sealed class BatteryRangePanelAutomationPeer(BatteryRangePanel owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((BatteryRangePanel)Owner)._viewModel.SurfaceName : name;
        }
    }
}
