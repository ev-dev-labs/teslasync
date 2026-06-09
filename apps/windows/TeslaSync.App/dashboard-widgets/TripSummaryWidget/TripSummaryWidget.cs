using System.Globalization;
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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Trip Summary dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/TripSummaryWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, otherwise a title + Navigation icon + freshness header whose "Error" chip and
/// refresh button are the retry affordance) wrapping the featured "Last Trip" card — a "Last Trip" badge
/// plus the short date, the trip name (or the "Unnamed trip" fallback), and a four-up stat grid (Distance,
/// Duration, Drives, Charge Stops) that collapses to two columns when the surface is one column wide — and,
/// underneath, the scrollable "Recent Trips" list (the next two trips: name + date, plus distance, duration
/// and a "{n} drv" badge when wide, or distance only when compact). A friendly "No trips recorded yet" empty
/// state covers the body when there are no trips. Faithful to the web, a fetch failure is surfaced through
/// the freshness "Error" chip plus the refresh button rather than replacing the body. All data flows through
/// the shared <see cref="TripSummaryViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TripSummaryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly TripSummaryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TripSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public TripSummaryWidget(
        ITripSummarySource source,
        ILocalizer localizer,
        TripSummarySize size,
        UnitPref? units = null,
        TripSummaryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TripSummaryDiagnostics();
        _viewModel = new TripSummaryViewModel(source, localizer, size, units, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>trip-summary</c>).</summary>
    public static string RegistryId => TripSummaryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the summary for the new layout.</summary>
    public TripSummarySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the summary in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TripSummarySource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies). The trip list is fleet-wide (web
    /// <c>useTrips({ limit: 5 })</c> passes no vehicle id), so no vehicle source is required.
    /// </summary>
    public static TripSummaryWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TripSummarySize? size = null,
        UnitPref? units = null,
        TripSummaryDiagnostics? diagnostics = null)
    {
        var source = new TripSummarySource(api, engine, options);
        return new TripSummaryWidget(
            source, localizer, size ?? TripSummaryRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = TripSummaryProjection.HeaderGlyph,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.tripSummary.refresh", "Refresh trip summary"));
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
        if (_viewModel.State == TripSummaryState.Loading)
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
        return display.HasData ? BuildContent(display) : BuildEmpty();
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 96 });
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.tripSummary.loading", "Loading trip summary"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TripSummaryProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildContent(TripSummaryDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        if (display.Featured is { } featured)
        {
            column.Children.Add(BuildFeatured(featured, display.IsCompact));
        }

        if (display.RecentRows.Count > 0)
        {
            column.Children.Add(BuildRecentSection(display.RecentRows, display.IsCompact));
        }

        return column;
    }

    private static Border BuildFeatured(TripSummaryFeatured featured, bool isCompact)
    {
        var column = new StackPanel { Spacing = 8 };

        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        badgeRow.Children.Add(new TsBadge { Content = featured.BadgeLabel, FontSize = 10, VerticalAlignment = VerticalAlignment.Center });
        badgeRow.Children.Add(new TextBlock
        {
            Text = featured.DateText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(badgeRow);

        column.Children.Add(new TextBlock
        {
            Text = featured.Name,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        column.Children.Add(BuildStatGrid(featured.Stats, isCompact ? 2 : 4));

        var card = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 12, 12, 12),
        };
        AutomationProperties.SetName(card, featured.AutomationName);
        return card;
    }

    private static Grid BuildStatGrid(IReadOnlyList<TripStat> stats, int cols)
    {
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
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

    private static Border BuildStatTile(TripStat stat)
    {
        // Web parity: the StatCard renders its icon in text-[var(--text-muted)] rather than a categorical
        // accent, so the glyph here is muted to match.
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(glyph, 1);
        headerRow.Children.Add(label);
        headerRow.Children.Add(glyph);

        var value = new TextBlock
        {
            Text = stat.Value,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(headerRow);
        column.Children.Add(value);

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(10, 8, 10, 8),
        };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private StackPanel BuildRecentSection(IReadOnlyList<TripSummaryRow> rows, bool isCompact)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TextBlock
        {
            Text = _viewModel.RecentTripsLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        });

        foreach (var row in rows)
        {
            column.Children.Add(BuildRecentRow(row, isCompact));
        }

        return column;
    }

    private static Border BuildRecentRow(TripSummaryRow row, bool isCompact)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var nameColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        nameColumn.Children.Add(new TextBlock
        {
            Text = row.Name,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        nameColumn.Children.Add(new TextBlock
        {
            Text = row.DateText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        Grid.SetColumn(nameColumn, 0);
        grid.Children.Add(nameColumn);

        var metrics = isCompact ? BuildCompactMetrics(row) : BuildWideMetrics(row);
        Grid.SetColumn(metrics, 1);
        grid.Children.Add(metrics);

        var border = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 8, 8, 8),
            MinHeight = 44,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static StackPanel BuildWideMetrics(TripSummaryRow row)
    {
        var metrics = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        metrics.Children.Add(new TextBlock
        {
            Text = row.DistanceText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        metrics.Children.Add(new TextBlock
        {
            Text = row.DurationText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        metrics.Children.Add(new TsBadge { Content = row.DrivesBadgeText, FontSize = 10, VerticalAlignment = VerticalAlignment.Center });
        return metrics;
    }

    private static StackPanel BuildCompactMetrics(TripSummaryRow row)
    {
        var metrics = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        metrics.Children.Add(new TextBlock
        {
            Text = row.DistanceText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return metrics;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
