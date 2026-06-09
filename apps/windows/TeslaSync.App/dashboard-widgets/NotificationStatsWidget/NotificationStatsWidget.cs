using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Notification Stats dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/NotificationStatsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact big delivery-rate number with its "Delivery Rate" caption and optional "{n} failed" line (1×N),
/// or — at the standard footprint — the <c>WidgetStatGrid</c> of four metric tiles (Total Sent, Delivery
/// Rate, Failed, Active Channels) two-up, widening to four-up plus the recent-delivery table (Channel /
/// Type / Status / Time) at the wide footprint; or a friendly "No notification data" empty state when the
/// stats endpoint returns no body. All data flows through the shared <see cref="NotificationStatsViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class NotificationStatsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string MutedBrushKey = "TsColorTextMutedBrush";

    private readonly NotificationStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly NotificationStatsDiagnostics _diagnostics;
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
    public NotificationStatsWidget(
        INotificationStatsSource source,
        ILocalizer localizer,
        NotificationStatsSize size,
        NotificationStatsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new NotificationStatsDiagnostics();
        _viewModel = new NotificationStatsViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>notification-stats</c>).</summary>
    public static string RegistryId => NotificationStatsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public NotificationStatsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="NotificationStatsSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies). Neither notification endpoint is
    /// vehicle-scoped, so no vehicle source is required.
    /// </summary>
    public static NotificationStatsWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        NotificationStatsSize? size = null,
        NotificationStatsDiagnostics? diagnostics = null)
    {
        var source = new NotificationStatsSource(api, engine, options);
        return new NotificationStatsWidget(source, localizer, size ?? NotificationStatsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var bell = new FontIcon
        {
            Glyph = NotificationStatsProjection.BellGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(bell, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(bell);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.notificationStats.refresh", "Refresh notification stats"));
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
            case NotificationStatsState.Loading:
                Content = BuildLoading();
                break;

            case NotificationStatsState.Error:
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
        // Compact (1×N) hides the title row, matching the web compact branch's title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.State == NotificationStatsState.Empty || _viewModel.Display is not { } display)
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

        AutomationProperties.SetName(column, _localizer.GetString("widget.notificationStats.loading", "Loading notification stats"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.notificationStats.error", "Couldn't load notification stats"),
            ActionText = _localizer.GetString("widget.notificationStats.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = NotificationStatsProjection.BellGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(NotificationStatsDisplay display)
    {
        var value = new TextBlock
        {
            Text = display.CompactValue,
            FontSize = 28,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

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
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(value);
        column.Children.Add(label);

        if (display.CompactFailedText is { } failedText)
        {
            column.Children.Add(new TextBlock
            {
                Text = failedText,
                FontSize = 11,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 2, 0, 0),
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private StackPanel BuildStandard(NotificationStatsDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatGrid(display.Stats, display.StatColumns));

        if (display.ShowLogTable)
        {
            column.Children.Add(BuildLogTable(display.LogRows));
        }

        return column;
    }

    private static Grid BuildStatGrid(IReadOnlyList<NotificationStatTile> stats, int cols)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        int rows = (int)Math.Ceiling(stats.Count / (double)cols);
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var tile = BuildStatTile(stats[i]);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildStatTile(NotificationStatTile stat)
    {
        var labelText = new TextBlock
        {
            Text = stat.Label,
            FontSize = 13,
            FontWeight = Microsoft.UI.Text.FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(labelText, 0);
        Grid.SetColumn(glyph, 1);
        headerRow.Children.Add(labelText);
        headerRow.Children.Add(glyph);

        var valueBrush = stat.ValueBrushKey is { } key ? DisplayTokens.Brush(key) : DisplayTokens.TextPrimary;
        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 22,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = valueBrush,
        });

        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 13,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(0, 0, 0, 2),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(headerRow);
        column.Children.Add(valueRow);

        if (stat.Trend is { } trend)
        {
            column.Children.Add(BuildTrendRow(trend));
        }

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private static StackPanel BuildTrendRow(NotificationStatTrend trend)
    {
        var brush = DisplayTokens.Brush(trend.BrushKey);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TextBlock { Text = trend.Arrow, FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new TextBlock { Text = trend.Value, FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private Grid BuildLogTable(IReadOnlyList<NotificationLogRow> rows)
    {
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (int i = 0; i < rows.Count; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        AddHeaderCell(grid, 0, _localizer.GetString("widget.notificationStats.channel", "Channel"), HorizontalAlignment.Left);
        AddHeaderCell(grid, 1, _localizer.GetString("widget.notificationStats.type", "Type"), HorizontalAlignment.Left);
        AddHeaderCell(grid, 2, _localizer.GetString("widget.notificationStats.status", "Status"), HorizontalAlignment.Left);
        AddHeaderCell(grid, 3, _localizer.GetString("widget.notificationStats.time", "Time"), HorizontalAlignment.Right);

        for (int i = 0; i < rows.Count; i++)
        {
            AddDataRow(grid, i + 1, rows[i]);
        }

        return grid;
    }

    private static void AddHeaderCell(Grid grid, int column, string text, HorizontalAlignment alignment)
    {
        var cell = new TextBlock
        {
            Text = text.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 60,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = alignment,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(cell, AccessibilityView.Raw);
        Grid.SetRow(cell, 0);
        Grid.SetColumn(cell, column);
        grid.Children.Add(cell);
    }

    private static void AddDataRow(Grid grid, int row, NotificationLogRow data)
    {
        var channel = new TextBlock
        {
            Text = data.Channel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        // The full row reads once through the leading cell; the rest are decorative for Narrator.
        AutomationProperties.SetName(channel, data.AutomationName);
        Grid.SetRow(channel, row);
        Grid.SetColumn(channel, 0);
        grid.Children.Add(channel);

        var type = new TextBlock
        {
            Text = data.Type,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(type, AccessibilityView.Raw);
        Grid.SetRow(type, row);
        Grid.SetColumn(type, 1);
        grid.Children.Add(type);

        var badge = BuildStatusBadge(data);
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
        Grid.SetRow(badge, row);
        Grid.SetColumn(badge, 2);
        grid.Children.Add(badge);

        var time = new TextBlock
        {
            Text = data.RelativeTime,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(time, AccessibilityView.Raw);
        Grid.SetRow(time, row);
        Grid.SetColumn(time, 3);
        grid.Children.Add(time);
    }

    private static TsBadge BuildStatusBadge(NotificationLogRow data)
    {
        var statusBrush = DisplayTokens.Brush(StatusResources.AccentBrushKey(data.StatusVariant));
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };

        if (!string.IsNullOrEmpty(data.StatusGlyph))
        {
            var glyph = new FontIcon { Glyph = data.StatusGlyph, FontSize = 11, Foreground = statusBrush, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
            content.Children.Add(glyph);
        }

        content.Children.Add(new TextBlock
        {
            Text = data.StatusLabel,
            FontSize = 12,
            Foreground = statusBrush,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return new TsBadge
        {
            Status = data.StatusVariant,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
