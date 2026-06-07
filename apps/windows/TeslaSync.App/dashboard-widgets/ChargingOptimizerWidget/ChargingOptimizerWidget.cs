using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charging Optimizer dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact optimal-hour + SOC + savings badge (1×N), the standard three-up metric grid (Optimal start /
/// Target SOC / Savings/mo) plus the schedule-match badge and the recommendation tip cards, or — when wide
/// (cols≥4) — an additional 24h peak/off-peak rate timeline with the optimal-start marker. When the
/// optimizer query resolves with no body the surface renders a friendly "No optimizer data" empty state
/// (the web <c>!data</c> gate). All data flows through the shared <see cref="ChargingOptimizerViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive
/// element carries a Narrator name.
/// </summary>
public sealed partial class ChargingOptimizerWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargingOptimizerViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingOptimizerDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public ChargingOptimizerWidget(
        IChargingOptimizerSource source,
        ILocalizer localizer,
        ChargingOptimizerSize size,
        ChargingOptimizerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingOptimizerDiagnostics();
        _viewModel = new ChargingOptimizerViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>charging-optimizer</c>).</summary>
    public static string RegistryId => ChargingOptimizerRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public ChargingOptimizerSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingOptimizerSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies + the widget vehicle source),
    /// resolving the primary cached vehicle unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargingOptimizerWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingOptimizerSize? size = null,
        long? vehicleId = null,
        ChargingOptimizerDiagnostics? diagnostics = null)
    {
        var source = new ChargingOptimizerSource(vehicles, api, engine, options, vehicleId);
        return new ChargingOptimizerWidget(
            source, localizer, size ?? ChargingOptimizerRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargingOptimizerProjection.SparklesGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargingOptimizer.refresh", "Refresh charging optimizer"));
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
            case ChargingOptimizerState.Loading:
                Content = BuildLoading();
                break;

            case ChargingOptimizerState.Error:
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

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargingOptimizer.loading", "Loading charging optimizer"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargingOptimizer.error", "Couldn't load the charging optimizer"),
            ActionText = _localizer.GetString("widget.chargingOptimizer.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChargingOptimizerProjection.SparklesGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(ChargingOptimizerDisplay display)
    {
        var clock = new FontIcon
        {
            Glyph = ChargingOptimizerProjection.ClockGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(display.OptimalStartMetric.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(clock, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var hour = new TextBlock
        {
            Text = display.OptimalStartText,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var hourRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        hourRow.Children.Add(clock);
        hourRow.Children.Add(hour);

        var soc = new TextBlock
        {
            Text = display.TargetSocShortText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 8,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(hourRow);
        column.Children.Add(soc);

        if (display.ShowSavingsBadge)
        {
            column.Children.Add(new TsBadge
            {
                Status = StatusKind.Success,
                Content = display.SavingsShortText,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildStandard(ChargingOptimizerDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildMetricsRow(display));
        column.Children.Add(BuildScheduleRow(display));

        if (display.IsWide)
        {
            column.Children.Add(BuildTimeline(display));
        }

        column.Children.Add(BuildTips(display));
        return column;
    }

    private static Grid BuildMetricsRow(ChargingOptimizerDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var tiles = new[] { display.OptimalStartMetric, display.TargetSocMetric, display.SavingsMetric };
        for (int c = 0; c < tiles.Length; c++)
        {
            var tile = BuildTile(tiles[c]);
            Grid.SetColumn(tile, c);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildTile(OptimizerMetric metric)
    {
        var glyph = new FontIcon
        {
            Glyph = metric.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(metric.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = metric.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var label = new TextBlock
        {
            Text = metric.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(glyph);
        column.Children.Add(value);
        column.Children.Add(label);

        var border = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 8, 8, 8),
        };
        AutomationProperties.SetName(border, metric.AutomationName);
        return border;
    }

    private static Grid BuildScheduleRow(ChargingOptimizerDisplay display)
    {
        var grid = new Grid { Padding = new Thickness(2, 0, 2, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var peak = new TextBlock
        {
            Text = display.PeakUsageText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var badge = new TsBadge
        {
            Status = display.ScheduleBadgeStatus,
            Content = display.ScheduleBadgeText,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        Grid.SetColumn(peak, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(peak);
        grid.Children.Add(badge);
        return grid;
    }

    private static StackPanel BuildTimeline(ChargingOptimizerDisplay display)
    {
        var column = new StackPanel { Spacing = 4 };

        column.Children.Add(new TextBlock
        {
            Text = display.RateTimelineLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        });

        var bar = new Grid { Height = 24 };
        for (int c = 0; c < 24; c++)
        {
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        foreach (var segment in display.Segments)
        {
            var cell = new Border { Background = FillBrush(segment.Kind) };
            if (segment.IsCurrentStart)
            {
                var marker = new FontIcon
                {
                    Glyph = ChargingOptimizerProjection.ZapGlyph,
                    FontSize = 12,
                    Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                AutomationProperties.SetAccessibilityView(marker, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
                cell.Child = marker;
            }

            ToolTipService.SetToolTip(cell, segment.Label);
            AutomationProperties.SetName(cell, segment.Label);
            Grid.SetColumn(cell, segment.Hour);
            bar.Children.Add(cell);
        }

        var barFrame = new Border
        {
            Child = bar,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
        };
        column.Children.Add(barFrame);
        column.Children.Add(BuildTimelineAxis());

        AutomationProperties.SetName(column, display.RateTimelineLabel);
        return column;
    }

    private static Grid BuildTimelineAxis()
    {
        var axis = new Grid();
        for (int c = 0; c < 5; c++)
        {
            axis.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        // Web parity: the un-localized clock ticks "12 AM / 6 AM / 12 PM / 6 PM / 12 AM".
        var ticks = new[]
        {
            ("12 AM", HorizontalAlignment.Left),
            ("6 AM", HorizontalAlignment.Center),
            ("12 PM", HorizontalAlignment.Center),
            ("6 PM", HorizontalAlignment.Center),
            ("12 AM", HorizontalAlignment.Right),
        };

        for (int c = 0; c < ticks.Length; c++)
        {
            var (text, align) = ticks[c];
            var label = new TextBlock
            {
                Text = text,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = align,
            };
            AutomationProperties.SetAccessibilityView(label, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
            Grid.SetColumn(label, c);
            axis.Children.Add(label);
        }

        return axis;
    }

    private static UIElement BuildTips(ChargingOptimizerDisplay display)
    {
        if (display.Tips.Count == 0)
        {
            return new TsEmptyState
            {
                IconGlyph = ChargingOptimizerProjection.SparklesGlyph,
                Message = display.NoRecommendationsMessage,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        var column = new StackPanel { Spacing = 8 };
        int rendered = 0;
        foreach (var tip in display.Tips)
        {
            if (rendered >= display.MaxTips)
            {
                break;
            }

            column.Children.Add(BuildTipCard(tip));
            rendered++;
        }

        return column;
    }

    private static Border BuildTipCard(OptimizerTip tip)
    {
        var icon = new FontIcon
        {
            Glyph = tip.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(tip.IconBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = tip.Title,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var titleRow = new Grid { ColumnSpacing = 8 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        titleRow.Children.Add(title);

        if (tip.HasImpact)
        {
            var badge = new TsBadge
            {
                Status = tip.ImpactStatus,
                Content = tip.ImpactLabel,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(badge, 1);
            titleRow.Children.Add(badge);
        }

        var description = new TextBlock
        {
            Text = tip.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(titleRow);
        body.Children.Add(description);

        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        grid.Children.Add(icon);
        grid.Children.Add(body);

        var card = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
            MinHeight = 44,
        };
        AutomationProperties.SetName(card, tip.AutomationName);
        return card;
    }

    private static SolidColorBrush FillBrush(OptimizerRateKind kind) => kind switch
    {
        OptimizerRateKind.Peak => Tinted("TsColorDangerBrush", 0.30),
        OptimizerRateKind.Offpeak => Tinted("TsColorSuccessBrush", 0.30),
        _ => Tinted("TsColorTextPrimaryBrush", 0.05),
    };

    private static SolidColorBrush Tinted(string brushKey, double opacity)
    {
        var color = DisplayTokens.Brush(brushKey) is SolidColorBrush scb ? scb.Color : Microsoft.UI.Colors.Transparent;
        return new SolidColorBrush(color) { Opacity = opacity };
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
