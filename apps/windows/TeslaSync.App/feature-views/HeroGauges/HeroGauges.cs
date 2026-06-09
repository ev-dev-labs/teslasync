using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>HeroGauges</c> feature surface — a parity port of
/// web/src/features/analytics/components/analytics/HeroGauges.tsx. It renders the web layout: a responsive
/// grid of six metric tiles (Distance, Drives, Energy, Efficiency, Gas Savings, CO₂ Saved), each an icon
/// in an accent-tinted box above a label, a large value and an optional unit sub-line. The web component
/// is presentational (it receives <c>data</c> and shows a six-tile skeleton while it is <c>undefined</c>);
/// the native feature view binds the same <c>GET /analytics/fleet</c> data through the shared
/// <see cref="HeroGaugesViewModel"/> so every state — loading (skeleton tiles), loaded, empty, error
/// (retry), stale (stale chip), offline (offline chip) — renders as a visible surface, never hidden. All
/// value derivation, unit conversion and formatting happen in the WinUI-free
/// <see cref="HeroGaugesProjection"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class HeroGauges : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int GaugeCount = 6;

    private readonly HeroGaugesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly HeroGaugesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ContentPresenter _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units, currency and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="currencySymbol">The currency symbol for the gas-savings tile, or <see langword="null"/> for "$".</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HeroGauges(
        IHeroGaugesSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        HeroGaugesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new HeroGaugesDiagnostics();
        _viewModel = new HeroGaugesViewModel(source, localizer, units, currencySymbol);
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

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HeroGauges</c>).</summary>
    public static string Slug => HeroGaugesRegistration.Slug;

    /// <summary>The user's unit preference; reassigning re-projects the gauges in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>The currency symbol used for the gas-savings tile; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="HeroGaugesSource"/> from the shared
    /// data layer (the analytics host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="currencySymbol">The currency symbol for the gas-savings tile, or <see langword="null"/> for "$".</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static HeroGauges Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        HeroGaugesDiagnostics? diagnostics = null)
    {
        var source = new HeroGaugesSource(api, engine, options);
        return new HeroGauges(source, localizer, units, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("analytics.hero.refresh", "Refresh analytics"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(actions, 1);
        _header.Children.Add(actions);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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
            case HeroGaugesState.Loading:
                Content = BuildLoading();
                break;

            case HeroGaugesState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = _viewModel.HasData ? BuildGrid(_viewModel.Display) : BuildEmpty();
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

    private TsGrid BuildLoading()
    {
        var grid = NewGaugeGrid();
        for (int i = 0; i < GaugeCount; i++)
        {
            var column = new StackPanel { Spacing = 8 };
            column.Children.Add(new TsSkeleton { BlockWidth = 64, BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockWidth = 96, BlockHeight = 24 });
            grid.Children.Add(Card(column));
        }

        AutomationProperties.SetName(grid, _localizer.GetString("analytics.hero.loading", "Loading analytics"));
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("analytics.hero.error", "Couldn't load analytics"),
            ActionText = _localizer.GetString("analytics.hero.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = HeroGaugesProjection.EfficiencyGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TsGrid BuildGrid(HeroGaugesDisplay display)
    {
        var grid = NewGaugeGrid();
        foreach (var gauge in display.Gauges)
        {
            grid.Children.Add(BuildTile(gauge));
        }

        return grid;
    }

    private static TsGrid NewGaugeGrid() => new() { Columns = GaugeCount, Gutter = 12, ItemMinWidth = 150 };

    private static Border BuildTile(HeroGauge gauge)
    {
        var label = new TextBlock
        {
            Text = gauge.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = gauge.Value,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Left };
        column.Children.Add(label);
        column.Children.Add(value);

        if (!string.IsNullOrEmpty(gauge.Subtitle))
        {
            column.Children.Add(new TextBlock
            {
                Text = gauge.Subtitle,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var iconBox = BuildIconBox(gauge);
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(column, 0);
        Grid.SetColumn(iconBox, 1);
        content.Children.Add(column);
        content.Children.Add(iconBox);

        var tile = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(tile, gauge.AutomationName);
        return tile;
    }

    private static Border BuildIconBox(HeroGauge gauge)
    {
        var (iconBrush, bgBrush, ringBrush) = AccentBrushes(gauge.Accent);

        var icon = new FontIcon
        {
            Glyph = gauge.Glyph,
            FontSize = 16,
            Foreground = iconBrush,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var box = new Border
        {
            Child = icon,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = bgBrush,
            BorderBrush = ringBrush,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6),
            VerticalAlignment = VerticalAlignment.Top,
        };
        return box;
    }

    private static Border Card(UIElement child) => new()
    {
        Child = child,
        CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        Background = DisplayTokens.Surface,
        Padding = new Thickness(12),
    };

    private static (Brush Icon, Brush Background, Brush Ring) AccentBrushes(HeroGaugeAccent accent)
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

    private static string AccentBrushKey(HeroGaugeAccent accent) => accent switch
    {
        HeroGaugeAccent.Cyan => "TsChartRegenBrush",
        HeroGaugeAccent.Purple => "TsChartPowerBrush",
        HeroGaugeAccent.Green => "TsChartBatteryBrush",
        HeroGaugeAccent.Amber => "TsChartEnergyBrush",
        _ => "TsColorAccentBrush",
    };
}
