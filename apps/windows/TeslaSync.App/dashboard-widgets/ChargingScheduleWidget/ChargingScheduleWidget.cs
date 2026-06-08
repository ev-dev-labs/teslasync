using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charging Schedule dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on hard error, otherwise a "📅 Charging Schedule" freshness header —
/// title-less when compact) wrapping the schedule body: the compact 1×1 big charge-limit readout; the standard
/// view (a coloured mode badge, an optional "Pending" badge, a Start Charging / Departure / Target Limit timeline,
/// and — when tall — a Current Level / Status detail row); or, when the live signals carry no schedule fields, a
/// friendly "No schedule data" empty state (the web <c>{hasScheduleData ? … : &lt;EmptyState&gt;}</c> gate). All
/// data flows through the shared <see cref="ChargingScheduleViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargingScheduleWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargingScheduleViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingScheduleDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network schedule source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / tall branches).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ChargingScheduleWidget(
        IChargingScheduleSource source,
        ILocalizer localizer,
        ChargingScheduleSize size,
        ChargingScheduleDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingScheduleDiagnostics();
        _viewModel = new ChargingScheduleViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>charging-schedule</c>).</summary>
    public static string RegistryId => ChargingScheduleRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the schedule view for the new layout.</summary>
    public ChargingScheduleSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingScheduleSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargingScheduleWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingScheduleSize? size = null,
        long? vehicleId = null,
        ChargingScheduleDiagnostics? diagnostics = null)
    {
        var source = new ChargingScheduleSource(vehicles, api, engine, options, vehicleId);
        return new ChargingScheduleWidget(source, localizer, size ?? ChargingScheduleRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargingScheduleProjection.CalendarGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargingSchedule.refresh", "Refresh charging schedule"));
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
        _bodyHost.Padding = new Thickness(12, 4, 12, 12);

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
            case ChargingScheduleState.Loading:
                Content = BuildLoading();
                break;

            case ChargingScheduleState.Error:
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
        // Web parity: the compact layout uses a title-less WidgetShell (freshness floats alone).
        bool compact = _viewModel.Display?.IsCompact ?? false;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildFull(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 22, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargingSchedule.loading", "Loading charging schedule"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargingSchedule.error", "Couldn't load the charging schedule"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChargingScheduleProjection.CalendarGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact: the big charge-limit readout (web isCompact branch) ──
    private static StackPanel BuildCompact(ChargingScheduleDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.CompactLimitText,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.LimitLabel,
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, $"{display.LimitLabel} {display.CompactLimitText}");
        return column;
    }

    // ── Full: mode badge + timeline + (tall) detail row (web standard branch) ──
    private static StackPanel BuildFull(ChargingScheduleDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        column.Children.Add(BuildModeRow(display));
        column.Children.Add(display.HasTimelineEntries
            ? BuildTimeline(display)
            : new TextBlock
            {
                Text = display.NoTimesText,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });

        if (display.ShowDetailRow)
        {
            column.Children.Add(BuildDetailRow(display));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static StackPanel BuildModeRow(ChargingScheduleDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TsBadge
        {
            Status = display.ModeStatus,
            Dot = true,
            Content = new TextBlock { Text = display.ModeLabel, FontSize = 12 },
        });

        if (display.Pending)
        {
            row.Children.Add(new TsBadge
            {
                Status = StatusKind.Warning,
                Content = new TextBlock { Text = display.PendingLabel, FontSize = 12 },
            });
        }

        return row;
    }

    private static StackPanel BuildTimeline(ChargingScheduleDisplay display)
    {
        var column = new StackPanel { Spacing = 10 };
        foreach (var entry in display.TimelineEntries)
        {
            column.Children.Add(BuildTimelineRow(entry));
        }

        return column;
    }

    private static Grid BuildTimelineRow(ScheduleTimelineEntry entry)
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var marker = new FontIcon
        {
            Glyph = entry.Glyph,
            FontSize = 14,
            Foreground = AccentBrush(entry.Accent),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(marker, AccessibilityView.Raw);
        Grid.SetColumn(marker, 0);

        var titleStack = new StackPanel { Spacing = 0, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(new TextBlock
        {
            Text = entry.Title,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        if (!string.IsNullOrEmpty(entry.Subtitle))
        {
            titleStack.Children.Add(new TextBlock
            {
                Text = entry.Subtitle,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        Grid.SetColumn(titleStack, 1);

        var time = new TextBlock
        {
            Text = entry.TimeText,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(time, 2);

        grid.Children.Add(marker);
        grid.Children.Add(titleStack);
        grid.Children.Add(time);
        AutomationProperties.SetName(grid, entry.AutomationName);
        return grid;
    }

    private static Border BuildDetailRow(ChargingScheduleDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var level = DetailCell(display.CurrentLevelLabel, display.CurrentLevelText);
        Grid.SetColumn(level, 0);
        var status = DetailCell(display.StatusLabel, display.StatusText);
        Grid.SetColumn(status, 1);
        grid.Children.Add(level);
        grid.Children.Add(status);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 8, 0, 0),
        };
    }

    private static StackPanel DetailCell(string label, string value)
    {
        var cell = new StackPanel { Spacing = 2 };
        cell.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        cell.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        AutomationProperties.SetName(cell, $"{label} {value}");
        return cell;
    }

    private static Brush AccentBrush(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
