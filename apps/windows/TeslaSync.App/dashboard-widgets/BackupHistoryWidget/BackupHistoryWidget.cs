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
/// The native WinUI 3 Backup History dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BackupHistoryWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a BatteryFull title + freshness header)
/// wrapping one of three bodies: the "no Tesla Energy site linked" empty state (web <c>!hasSites</c>); the
/// "no backup events" empty state (web <c>items.length === 0</c>); or — when outages exist — the stat
/// summary (compact: a single "Outages (30d)" card; wide: that card plus "Avg Duration") above a
/// newest-first outage feed (a lightning-iconed row per event with its time and a duration badge, and a
/// "Duration: …" subline in the wide footprint). All data flows through the shared
/// <see cref="BackupHistoryViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BackupHistoryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string BatteryGlyph = "\uE83F";  // Segoe Fluent — Battery10 (full), web BatteryFull
    private const string ZapGlyph = "\uE945";      // Segoe Fluent — LightningBolt, web Zap

    private readonly BackupHistoryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BackupHistoryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BackupHistoryWidget(
        IBackupHistorySource source,
        ILocalizer localizer,
        BackupHistorySize size,
        BackupHistoryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BackupHistoryDiagnostics();
        _viewModel = new BackupHistoryViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>backup-history</c>).</summary>
    public static string RegistryId => BackupHistoryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the rows for the new layout.</summary>
    public BackupHistorySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BackupHistorySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static BackupHistoryWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BackupHistorySize? size = null,
        BackupHistoryDiagnostics? diagnostics = null)
    {
        var source = new BackupHistorySource(api, engine, options);
        return new BackupHistoryWidget(source, localizer, size ?? BackupHistoryRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryGlyph,
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

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.backupHistory.refresh", "Refresh backup history"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
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
            case BackupHistoryState.Loading:
                Content = BuildLoading();
                break;

            case BackupHistoryState.Error:
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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasSites)
        {
            return BuildEmpty(_viewModel.NoSiteMessage);
        }

        if (!display.HasEvents)
        {
            return BuildEmpty(_viewModel.NoEventsMessage);
        }

        return display.IsCompact ? BuildCompact(display) : BuildWide(display);
    }

    private static StackPanel BuildCompact(BackupHistoryDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(StatCard(display.OutagesLabel, display.OutagesValue));
        column.Children.Add(BuildRows(display.Events, compact: true, display.DurationLabel));
        return column;
    }

    private static StackPanel BuildWide(BackupHistoryDisplay display)
    {
        var stats = new Grid { ColumnSpacing = 12 };
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var outages = StatCard(display.OutagesLabel, display.OutagesValue);
        var avg = StatCard(display.AvgDurationLabel, display.AvgDurationValue);
        Grid.SetColumn(outages, 0);
        Grid.SetColumn(avg, 1);
        stats.Children.Add(outages);
        stats.Children.Add(avg);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(stats);
        column.Children.Add(BuildRows(display.Events, compact: false, display.DurationLabel));
        return column;
    }

    private static TsStatCard StatCard(string label, string value) => new()
    {
        Label = label,
        Value = value,
    };

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.backupHistory.loading", "Loading backup history"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.backupHistory.error", "Couldn't load backup history"),
            ActionText = _localizer.GetString("widget.backupHistory.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = BatteryGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildRows(IReadOnlyList<BackupEventRow> rows, bool compact, string durationLabel)
    {
        var column = new StackPanel { Spacing = 6 };
        foreach (var row in rows)
        {
            column.Children.Add(BuildRow(row, compact, durationLabel));
        }

        return column;
    }

    private static Border BuildRow(BackupEventRow row, bool compact, string durationLabel)
    {
        var icon = new FontIcon
        {
            Glyph = ZapGlyph,
            FontSize = 13,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = row.TimeText,
            FontSize = compact ? 12 : 13,
            Foreground = compact ? DisplayTokens.TextSecondary : DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (!compact)
        {
            body.Children.Add(new TextBlock
            {
                Text = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", durationLabel, row.DurationText),
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        var badge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = row.DurationText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(badge, 2);
        grid.Children.Add(icon);
        grid.Children.Add(body);
        grid.Children.Add(badge);

        var container = new Border
        {
            Child = grid,
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMdCornerRadius", 8),
            Padding = new Thickness(12, 6, 12, 6),
            MinHeight = 44,
        };
        AutomationProperties.SetName(container, row.AccessibilityName);
        return container;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
