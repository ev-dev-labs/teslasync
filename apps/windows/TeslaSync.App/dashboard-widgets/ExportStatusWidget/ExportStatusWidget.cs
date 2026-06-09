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
/// The native WinUI 3 Export Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ExportStatusWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, otherwise a title + Download icon + freshness header with a refresh retry)
/// wrapping either the compact active-export big number + Running/Idle badge (1×N), or — when standard
/// (≥2 cols) — the merged, status-ordered <c>WidgetEventFeed</c> of legacy and admin export jobs
/// (file-name / format chip / size / status chip / relative-time rows, with a per-row download affordance
/// in the wide footprint and a progress bar under processing jobs). A friendly "No export jobs" empty
/// state covers both layouts when the merged list is empty. Faithful to the web component, a fetch failure
/// is surfaced through the freshness "Error" chip plus the refresh button (the retry affordance) rather
/// than replacing the body — the body always shows the list or the empty state. All data flows through the
/// shared <see cref="ExportStatusViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ExportStatusWidget : ContentControl, IDisposable
{
    private const string DownloadGlyph = "\uE896"; // Segoe Fluent — Download (web Download)
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh

    private readonly ExportStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ExportStatusDiagnostics _diagnostics;
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
    public ExportStatusWidget(
        IExportStatusSource source,
        ILocalizer localizer,
        ExportStatusSize size,
        ExportStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ExportStatusDiagnostics();
        _viewModel = new ExportStatusViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>export-status</c>).</summary>
    public static string RegistryId => ExportStatusRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public ExportStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ExportStatusSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    public static ExportStatusWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ExportStatusSize? size = null,
        ExportStatusDiagnostics? diagnostics = null)
    {
        var source = new ExportStatusSource(api, engine, options);
        return new ExportStatusWidget(source, localizer, size ?? ExportStatusRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DownloadGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.exportStatus.refresh", "Refresh export status"));
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
        _bodyHost.Padding = new Thickness(12, 0, 12, 8);

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
        if (_viewModel.State == ExportStatusState.Loading)
        {
            Content = BuildLoading();
            return;
        }

        UpdateHeader();
        _bodyHost.Content = BuildBody();
        Content = _root;
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
        if (!display.HasItems)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.exportStatus.loading", "Loading export status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DownloadGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(ExportStatusDisplay display)
    {
        var number = new TextBlock
        {
            Text = display.ActiveCountText,
            FontSize = 30,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.ActiveLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = display.CompactBadgeStatus,
            Content = display.CompactBadgeText,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 6,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(label);
        column.Children.Add(badge);
        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private StackPanel BuildStandard(ExportStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 0 };
        for (int i = 0; i < display.Items.Count; i++)
        {
            bool last = i == display.Items.Count - 1;
            column.Children.Add(BuildRow(display.Items[i], display.ShowDownload, last));
        }

        return column;
    }

    private Border BuildRow(ExportJobRow row, bool showDownload, bool last)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 44, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = row.FileName,
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);

        var format = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = row.FormatText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(format, AccessibilityView.Raw);
        Grid.SetColumn(format, 1);

        var size = new TextBlock
        {
            Text = row.FileSizeText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextAlignment = TextAlignment.Right,
            MinWidth = 60,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(size, 2);

        var status = new TsBadge
        {
            Status = row.StatusBadge,
            Content = row.StatusLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(status, AccessibilityView.Raw);
        Grid.SetColumn(status, 3);

        var time = new TextBlock
        {
            Text = row.RelativeTime,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Right,
            MinWidth = 56,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(time, AccessibilityView.Raw);
        Grid.SetColumn(time, 4);

        grid.Children.Add(name);
        grid.Children.Add(format);
        grid.Children.Add(size);
        grid.Children.Add(status);
        grid.Children.Add(time);

        if (showDownload)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var download = BuildDownload(row);
            Grid.SetColumn(download, 5);
            grid.Children.Add(download);
        }

        var content = new StackPanel { Spacing = 6, Padding = new Thickness(2, 6, 2, 6) };
        content.Children.Add(grid);
        if (row.IsProcessing)
        {
            content.Children.Add(new TsMetricBar
            {
                Value = 50,
                Max = 100,
                Label = string.Empty,
                AccentBrushKey = "TsColorInfoBrush",
                Margin = new Thickness(2, 0, 2, 0),
            });
        }

        var container = new Border
        {
            Child = content,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = last ? new Thickness(0) : new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(container, row.AutomationName);
        return container;
    }

    private FrameworkElement BuildDownload(ExportJobRow row)
    {
        if (row.DownloadUri is null)
        {
            // Reserve the column so non-downloadable rows stay column-aligned with downloadable ones.
            var spacer = new Border { Width = 44, Height = 44 };
            AutomationProperties.SetAccessibilityView(spacer, AccessibilityView.Raw);
            return spacer;
        }

        var button = new HyperlinkButton
        {
            NavigateUri = row.DownloadUri,
            Content = new FontIcon { Glyph = DownloadGlyph, FontSize = 14 },
            MinWidth = 44,
            MinHeight = 44,
            Padding = new Thickness(8),
            VerticalAlignment = VerticalAlignment.Center,
        };
        string label = _localizer.GetString("widget.exportDownload", "Download");
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, label);
        return button;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
