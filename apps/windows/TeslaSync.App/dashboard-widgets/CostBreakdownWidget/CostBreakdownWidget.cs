using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Cost Breakdown dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/CostBreakdownWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact big-number current-month cost with a "Saving" chip (1×N), or the standard stack — a donut of
/// the last six months, a ranked list of monthly costs, and three stat cards (Total Cost, Cost / unit,
/// Gas Savings). When the TCO response has no monthly breakdown the surface renders a friendly "No cost
/// data" empty state (the web <c>hasData</c> gate). All data flows through the shared
/// <see cref="CostBreakdownViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class CostBreakdownWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int DonutHeight = 140;

    private readonly CostBreakdownViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostBreakdownDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units, currency and diagnostics.</summary>
    public CostBreakdownWidget(
        ICostBreakdownSource source,
        ILocalizer localizer,
        CostBreakdownSize size,
        UnitPref? units = null,
        string? currencySymbol = null,
        int currencyPrecision = CostBreakdownProjection.DefaultPrecision,
        CostBreakdownDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostBreakdownDiagnostics();
        _viewModel = new CostBreakdownViewModel(source, localizer, size, units, currencySymbol, currencyPrecision, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>cost-breakdown</c>).</summary>
    public static string RegistryId => CostBreakdownRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the metrics for the new layout.</summary>
    public CostBreakdownSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the cost-per-distance tile.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>The currency symbol used to format costs; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostBreakdownSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached
    /// vehicle unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static CostBreakdownWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        CostBreakdownSize? size = null,
        UnitPref? units = null,
        string? currencySymbol = null,
        int currencyPrecision = CostBreakdownProjection.DefaultPrecision,
        long? vehicleId = null,
        CostBreakdownDiagnostics? diagnostics = null)
    {
        var source = new CostBreakdownSource(vehicles, api, engine, options, vehicleId);
        return new CostBreakdownWidget(
            source, localizer, size ?? CostBreakdownRegistration.DefaultSize, units, currencySymbol, currencyPrecision, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = CostBreakdownProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(CostBreakdownProjection.HeaderAccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.costBreakdown.refresh", "Refresh cost breakdown"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

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
            case CostBreakdownState.Loading:
                Content = BuildLoading();
                break;

            case CostBreakdownState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: the compact layout uses a title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.costBreakdown.loading", "Loading cost breakdown"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.costBreakdown.error", "Couldn't load cost breakdown"),
            ActionText = _localizer.GetString("widget.costBreakdown.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CostBreakdownProjection.HeaderGlyph,
        Message = _viewModel.Display.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(CostBreakdownDisplay display)
    {
        var numberRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        var number = new TsAnimatedNumber
        {
            Value = display.CompactValue,
            Precision = 0,
            ReduceMotion = MotionPreference.ReduceMotion,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        var unit = new TextBlock
        {
            Text = display.CompactUnit,
            FontSize = 16,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, 2),
        };
        numberRow.Children.Add(number);
        numberRow.Children.Add(unit);

        var label = new TextBlock
        {
            Text = display.CompactLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(numberRow);
        column.Children.Add(label);

        if (!string.IsNullOrEmpty(display.CompactSubtitle))
        {
            column.Children.Add(new TextBlock
            {
                Text = display.CompactSubtitle,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            });
        }

        if (display.ShowSavingBadge)
        {
            column.Children.Add(new TsSeverityBadge
            {
                Severity = "success",
                Label = display.SavingBadgeText,
                ShowIcon = false,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private StackPanel BuildStandard(CostBreakdownDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildDonut(display));
        column.Children.Add(BuildRankedList(display.Ranked));
        column.Children.Add(BuildStatGrid(display));
        return column;
    }

    private static TsPieChart BuildDonut(CostBreakdownDisplay display)
    {
        var points = new List<ChartPoint>(display.Donut.Count);
        foreach (var seg in display.Donut)
        {
            points.Add(new ChartPoint(seg.ColorIndex, seg.Value, seg.Label));
        }

        return new TsPieChart
        {
            Values = points,
            InnerRadiusRatio = 0.55,
            Unit = display.CompactUnit,
            Height = DonutHeight,
            MinHeight = DonutHeight,
        };
    }

    private StackPanel BuildRankedList(IReadOnlyList<CostBreakdownRankedItem> items)
    {
        var list = new StackPanel { Spacing = 4 };
        foreach (var item in items)
        {
            list.Children.Add(BuildRankedRow(item));
        }

        AutomationProperties.SetName(list, _localizer.GetString("widget.costBreakdown.monthlyList", "Monthly cost ranking"));
        return list;
    }

    private static Grid BuildRankedRow(CostBreakdownRankedItem item)
    {
        var root = new Grid { MinHeight = 36 };

        // Proportional background bar (web: absolute bar width = barPct%).
        if (item.BarFraction > 0)
        {
            var barHost = new Grid();
            barHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(item.BarFraction, GridUnitType.Star) });
            barHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 1 - item.BarFraction), GridUnitType.Star) });

            var bar = new Border
            {
                Background = ChartBrushes.ForIndex(item.ColorIndex),
                Opacity = 0.15,
                CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            };
            Grid.SetColumn(bar, 0);
            barHost.Children.Add(bar);
            root.Children.Add(barHost);
        }

        var content = new Grid { Padding = new Thickness(10, 6, 10, 6), ColumnSpacing = 10 };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var rank = new TextBlock
        {
            Text = item.Rank.ToString(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            MinWidth = 16,
            TextAlignment = TextAlignment.Right,
        };
        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new TextBlock
        {
            Text = item.FormattedValue,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Grid.SetColumn(rank, 0);
        Grid.SetColumn(label, 1);
        Grid.SetColumn(value, 2);
        content.Children.Add(rank);
        content.Children.Add(label);
        content.Children.Add(value);
        root.Children.Add(content);

        AutomationProperties.SetName(root, item.AutomationName);
        return root;
    }

    private static Grid BuildStatGrid(CostBreakdownDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var total = BuildStatCard(display.TotalCost);
        var perDist = BuildStatCard(display.CostPerDistance);
        var savings = BuildStatCard(display.GasSavings);
        Grid.SetColumn(total, 0);
        Grid.SetColumn(perDist, 1);
        Grid.SetColumn(savings, 2);
        grid.Children.Add(total);
        grid.Children.Add(perDist);
        grid.Children.Add(savings);
        return grid;
    }

    private static TsStatCard BuildStatCard(CostBreakdownStat stat) => new()
    {
        Label = stat.Label,
        Value = stat.Value,
        Sublabel = stat.Sublabel ?? string.Empty,
        Glyph = stat.Glyph,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
