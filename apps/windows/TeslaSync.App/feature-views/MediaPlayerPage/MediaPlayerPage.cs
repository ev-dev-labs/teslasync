using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>MediaPlayerPage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx</c> (route <c>/media-player</c>, nav name
/// <c>MediaPlayer</c>). It binds to a <see cref="MediaPlayerPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the
/// now-playing card ("GlassPanel1"), the volume radial gauge ("GlassPanel2") with the four summary metric tiles
/// ("Unique-Tracks", "Top-Source", "Avg-Volume", "Volume-Step"), the Volume-over-Time area chart ("GlassPanel7"),
/// the Source-Distribution pie ("GlassPanel8") and the playback-history table ("GlassPanel9"). The view is a thin
/// renderer: all branch selection, formatting and i18n happen in the view-model's <see cref="MediaPlayerDisplay"/>
/// projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class MediaPlayerPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 120;
    private const double AlbumArtSize = 112;
    private const double ChartBodyHeight = 260;
    private const double PieBodyHeight = 200;

    private readonly MediaPlayerPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = MediaPlayerRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public MediaPlayerPage()
        : this(EmptyMediaPlayerFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source media data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MediaPlayerPage(IMediaPlayerFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MediaPlayerPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>MediaPlayerPage</c>).</summary>
    public static string Slug => MediaPlayerRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_contentHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 160 });
        _loadingSkeleton.Children.Add(ColumnsGrid(5, 12, BuildSkeletonBlocks(5, 120)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void Render(MediaPlayerDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(MediaPlayerDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildNowPlaying(display.NowPlaying) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildVolumeAndStats(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildChartsRow(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildHistoryPanel(display.History) });
        return stack;
    }

    // ── Now-playing card (GlassPanel1) ───────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildNowPlaying(MediaNowPlayingDisplay nowPlaying)
    {
        var row = new Grid { ColumnSpacing = 24 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var art = BuildAlbumArt();
        Grid.SetColumn(art, 0);
        row.Children.Add(art);

        var info = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new Heading { Value = nowPlaying.TrackTitle, VerticalAlignment = VerticalAlignment.Center });
        if (nowPlaying.Status.Visible)
        {
            titleRow.Children.Add(BuildStatusBadge(nowPlaying.Status));
        }

        info.Children.Add(titleRow);
        info.Children.Add(new Subhead { Value = nowPlaying.ArtistLine });

        if (nowPlaying.HasStation)
        {
            info.Children.Add(new Caption { Value = nowPlaying.Station });
        }

        if (nowPlaying.HasSource)
        {
            info.Children.Add(BuildSourceRow(nowPlaying));
        }

        if (nowPlaying.HasProgress)
        {
            info.Children.Add(BuildProgressRow(nowPlaying));
        }

        Grid.SetColumn(info, 1);
        row.Children.Add(info);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = row };
        AutomationProperties.SetName(panel, nowPlaying.AutomationName);
        return panel;
    }

    private static Border BuildAlbumArt()
    {
        var icon = new FontIcon
        {
            Glyph = MediaPlayerProjection.MusicGlyph,
            FontSize = 44,
            Foreground = ChartBrushes.Resolve("TsColorAccentBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = AlbumArtSize,
            Height = AlbumArtSize,
            Background = DisplayTokens.Brush("TsColorSurfaceBrush"),
            BorderBrush = DisplayTokens.Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Child = icon,
        };
    }

    private static TsBadge BuildStatusBadge(MediaStatusChip status) => new()
    {
        Status = status.Status,
        Dot = true,
        Content = status.Text,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildSourceRow(MediaNowPlayingDisplay nowPlaying)
    {
        var sourceRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        sourceRow.Children.Add(new FontIcon
        {
            Glyph = nowPlaying.SourceGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        sourceRow.Children.Add(new Caption { Value = nowPlaying.Source, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(sourceRow, nowPlaying.Source);
        return sourceRow;
    }

    private static Grid BuildProgressRow(MediaNowPlayingDisplay nowPlaying)
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var elapsed = new Caption { Value = nowPlaying.ElapsedText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(elapsed, 0);
        grid.Children.Add(elapsed);

        var bar = new ProgressBar
        {
            Minimum = 0,
            Maximum = 1,
            Value = nowPlaying.ProgressFraction,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(bar, $"{nowPlaying.ElapsedText} / {nowPlaying.DurationText}");
        Grid.SetColumn(bar, 1);
        grid.Children.Add(bar);

        var duration = new Caption { Value = nowPlaying.DurationText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(duration, 2);
        grid.Children.Add(duration);

        return grid;
    }

    // ── Volume gauge (GlassPanel2) + four metric tiles (Unique-Tracks / Top-Source / Avg-Volume / Volume-Step) ─
    private static Grid BuildVolumeAndStats(MediaPlayerDisplay display)
    {
        var tiles = new List<FrameworkElement>(5) { BuildVolumeGaugePanel(display) };
        foreach (var card in display.MetricCards)
        {
            tiles.Add(BuildMetricCard(card));
        }

        return ColumnsGrid(5, 16, tiles);
    }

    private static TsGlassPanel BuildVolumeGaugePanel(MediaPlayerDisplay display)
    {
        var gauge = new TsRadialGauge
        {
            Value = display.VolumeValue,
            Max = display.VolumeMax,
            Label = display.VolumeLabel,
            Unit = string.Empty,
            ColorIndex = 0,
            Decimals = 0,
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(16),
            Content = gauge,
        };
        AutomationProperties.SetName(panel, $"{display.VolumeLabel} {display.VolumeValue}");
        return panel;
    }

    private static TsMetricCard BuildMetricCard(MediaMetricCardDisplay card)
    {
        var tile = new TsMetricCard
        {
            Label = card.Label,
            Value = card.Value,
            AccentBrushKey = card.AccentBrushKey,
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    // ── Charts row: Volume-over-Time (GlassPanel7, 2/3) + Source-Distribution (GlassPanel8, 1/3) ──────────
    private static Grid BuildChartsRow(MediaPlayerDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var volume = BuildVolumeChart(display);
        Grid.SetColumn(volume, 0);
        grid.Children.Add(volume);

        var source = BuildSourceChart(display.SourceChart);
        Grid.SetColumn(source, 1);
        grid.Children.Add(source);

        return grid;
    }

    private static TsChartContainer BuildVolumeChart(MediaPlayerDisplay display)
    {
        var chartDisplay = display.VolumeChart;

        var series = new ChartSeries(display.VolumeLabel, chartDisplay.Points)
        {
            Kind = ChartSeriesKind.Area,
            Role = ChartRole.None,
            ColorIndex = 0,
        };

        var chart = new TsAreaChart
        {
            Title = chartDisplay.Title,
            Series = [series],
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = ChartBodyHeight,
        };

        return new TsChartContainer
        {
            Title = chartDisplay.Title,
            AccessibleSummary = chartDisplay.AriaLabel,
            State = chartDisplay.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = chartDisplay.EmptyMessage,
        };
    }

    private static TsChartContainer BuildSourceChart(MediaSourceChartDisplay source)
    {
        var body = new StackPanel { Spacing = 12 };

        var pie = new TsPieChart
        {
            Values = source.Slices,
            InnerRadiusRatio = 0.55,
            MinHeight = PieBodyHeight,
            Height = PieBodyHeight,
        };
        AutomationProperties.SetName(pie, source.Title);
        body.Children.Add(pie);
        body.Children.Add(BuildSourceLegend(source.Legend));

        return new TsChartContainer
        {
            Title = source.Title,
            AccessibleSummary = source.AriaLabel,
            State = source.HasData ? ChartState.Ready : ChartState.Empty,
            Body = body,
            EmptyMessage = source.EmptyMessage,
        };
    }

    private static StackPanel BuildSourceLegend(IReadOnlyList<MediaSourceSliceDisplay> legend)
    {
        var panel = new StackPanel { Spacing = 6 };
        foreach (var entry in legend)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(new Ellipse
            {
                Width = 10,
                Height = 10,
                Fill = ChartBrushes.ForIndex(entry.ColorIndex),
                VerticalAlignment = VerticalAlignment.Center,
            });
            row.Children.Add(new Caption { Value = entry.Name, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(new Caption
            {
                Value = $"({entry.Count.ToString(System.Globalization.CultureInfo.CurrentCulture)})",
                VerticalAlignment = VerticalAlignment.Center,
            });
            AutomationProperties.SetName(row, $"{entry.Name}: {entry.Count}");
            panel.Children.Add(row);
        }

        return panel;
    }

    // ── Playback-history table (GlassPanel9) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistoryPanel(MediaHistoryTableDisplay table)
    {
        var column = new StackPanel { Spacing = 16 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = MediaPlayerProjection.MusicGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = table.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var badge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = table.RecordsBadge,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);
        header.Children.Add(badge);
        column.Children.Add(header);

        if (table.HasRows)
        {
            column.Children.Add(BuildHistoryTable(table));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = MediaPlayerProjection.MusicGlyph,
                Message = table.PanelEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsDataTable BuildHistoryTable(MediaHistoryTableDisplay table)
    {
        var dataTable = new TsDataTable { Selectable = false, EmptyMessage = table.TableEmptyMessage };
        dataTable.Columns =
        [
            new TsDataColumn { Key = "time", Header = table.Columns[0], IsNumeric = false },
            new TsDataColumn { Key = "track", Header = table.Columns[1], IsNumeric = false },
            new TsDataColumn { Key = "artist", Header = table.Columns[2], IsNumeric = false },
            new TsDataColumn { Key = "source", Header = table.Columns[3], IsNumeric = false },
            new TsDataColumn { Key = "volume", Header = table.Columns[4], IsNumeric = false },
            new TsDataColumn { Key = "status", Header = table.Columns[5], IsNumeric = false },
        ];

        var rows = new List<TsDataRow>(table.Rows.Count);
        foreach (var row in table.Rows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["track"] = row.Track,
                ["artist"] = row.Artist,
                ["source"] = row.Source,
                ["volume"] = row.Volume,
                ["status"] = row.Status,
            }));
        }

        dataTable.Rows = rows;
        AutomationProperties.SetName(dataTable, table.Title);
        return dataTable;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < Math.Max(1, rows); r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % cols);
            Grid.SetRow(child, i / cols);
            grid.Children.Add(child);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MediaPlayerPageAutomationPeer(this);

    private sealed class MediaPlayerPageAutomationPeer(MediaPlayerPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
