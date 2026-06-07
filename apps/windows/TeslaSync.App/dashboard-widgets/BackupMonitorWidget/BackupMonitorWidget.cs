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
/// The native WinUI 3 Backup Monitor dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BackupMonitorWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a HardDrive title + freshness header)
/// wrapping one of three bodies: the compact (1×N) status line (a status-coloured dot + the latest run's
/// relative time + "Last backup"); the standard (2×N) 2×2 stat grid ("Last backup", "Backup Size", "Type"
/// and a status cell whose badge — and red tint when failed — reflects the latest run); or — when wide
/// (4×N+) — that grid plus the newest-first "Recent Runs" feed (a dot + time + size·duration row with a
/// status badge). When there are no runs it shows the "no backup data" empty state. All data flows through
/// the shared <see cref="BackupMonitorViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BackupMonitorWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";    // Segoe Fluent — Refresh
    private const string HardDriveGlyph = "\uEDA2";  // Segoe Fluent — MapDrive (hard drive), web HardDrive

    private readonly BackupMonitorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BackupMonitorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BackupMonitorWidget(
        IBackupMonitorSource source,
        ILocalizer localizer,
        BackupMonitorSize size,
        BackupMonitorDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BackupMonitorDiagnostics();
        _viewModel = new BackupMonitorViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>backup-monitor</c>).</summary>
    public static string RegistryId => BackupMonitorRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the layout.</summary>
    public BackupMonitorSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BackupMonitorSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static BackupMonitorWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BackupMonitorSize? size = null,
        BackupMonitorDiagnostics? diagnostics = null)
    {
        var source = new BackupMonitorSource(api, engine, options);
        return new BackupMonitorWidget(source, localizer, size ?? BackupMonitorRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = HardDriveGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.backupMonitor.refresh", "Refresh backup status"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(_titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
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
            case BackupMonitorState.Loading:
                Content = BuildLoading();
                break;

            case BackupMonitorState.Error:
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
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasRuns)
        {
            return BuildEmpty(display.EmptyMessage);
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private static StackPanel BuildCompact(BackupMonitorDisplay display)
    {
        var dot = DisplayPrimitives.Dot(DotBrush(display.LatestStatusKind), 10);
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = display.LastBackupValue,
            FontSize = 14,
            FontWeight = Microsoft.UI.Text.FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = display.LastBackupLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            MinHeight = 44,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(dot);
        row.Children.Add(body);
        AutomationProperties.SetName(row, display.CompactAutomationName);
        return row;
    }

    private static StackPanel BuildStandard(BackupMonitorDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatGrid(display));
        if (display.IsWide)
        {
            column.Children.Add(BuildRecentRuns(display));
        }

        return column;
    }

    private static Grid BuildStatGrid(BackupMonitorDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var lastBackup = StatCard(display.LastBackupLabel, display.LastBackupValue);
        var size = StatCard(display.SizeLabel, display.SizeValue);
        var type = StatCard(display.TypeLabel, display.TypeValue);
        var status = BuildStatusCell(display);

        Grid.SetColumn(lastBackup, 0);
        Grid.SetRow(lastBackup, 0);
        Grid.SetColumn(size, 1);
        Grid.SetRow(size, 0);
        Grid.SetColumn(type, 0);
        Grid.SetRow(type, 1);
        Grid.SetColumn(status, 1);
        Grid.SetRow(status, 1);

        grid.Children.Add(lastBackup);
        grid.Children.Add(size);
        grid.Children.Add(type);
        grid.Children.Add(status);
        return grid;
    }

    private static Border BuildStatusCell(BackupMonitorDisplay display)
    {
        var label = new TextBlock
        {
            Text = display.StatusLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        };

        var badge = new TsBadge
        {
            Status = display.LatestStatusKind,
            Content = display.LatestStatusText,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(label);
        column.Children.Add(badge);

        var cell = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = display.LatestIsFailed ? SoftDangerBrush() : DisplayTokens.Surface,
            Padding = new Thickness(16),
        };
        AutomationProperties.SetName(
            cell, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", display.StatusLabel, display.LatestStatusText));
        return cell;
    }

    private static StackPanel BuildRecentRuns(BackupMonitorDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TextBlock
        {
            Text = display.RecentRunsLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        });

        foreach (var run in display.RecentRuns)
        {
            column.Children.Add(BuildRunRow(run));
        }

        return column;
    }

    private static Border BuildRunRow(BackupRunRow row)
    {
        var dot = DisplayPrimitives.Dot(DotBrush(row.Status), 8);
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = row.TimeText,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = row.SubText,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var badge = new TsBadge
        {
            Status = row.Status,
            Content = row.StatusText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(dot, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(badge, 2);
        grid.Children.Add(dot);
        grid.Children.Add(body);
        grid.Children.Add(badge);

        var container = new Border
        {
            Child = grid,
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(12, 6, 12, 6),
            MinHeight = 44,
        };
        AutomationProperties.SetName(container, row.AccessibilityName);
        return container;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.backupMonitor.loading", "Loading backup status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.backupMonitor.error", "Couldn't load backup status"),
            ActionText = _localizer.GetString("widget.backupMonitor.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = HardDriveGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TsStatCard StatCard(string label, string value) => new()
    {
        Label = label,
        Value = value,
    };

    private static Brush DotBrush(StatusKind kind) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush SoftDangerBrush()
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue("TsColorDangerColor", out var value) &&
            value is Windows.UI.Color color)
        {
            return new SolidColorBrush(color) { Opacity = 0.12 };
        }

        // red-500 (#EF4444) at ~12% — matches the web `bg-red-500/10` failed tint.
        return new SolidColorBrush(Windows.UI.Color.FromArgb(31, 239, 68, 68));
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
