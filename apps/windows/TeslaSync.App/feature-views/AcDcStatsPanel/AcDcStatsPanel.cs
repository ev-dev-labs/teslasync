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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 AC vs DC charging-stats surface — a parity port of
/// web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx. It reproduces every web section: the
/// titled glass panel (with the energy/Zap glyph), the proportional AC|DC energy-split bar with its under-bar
/// AC / Total / DC energy labels, the per-type stats table (Type, Sessions, Energy, Cost, $/kWh, Avg Energy,
/// Avg Time, Free) with the web's colour accents and em-dash gates, and the optional free-charging footer. The
/// web component is presentational (its parent <c>ChargingListPage</c> owns the charging-sessions query); this
/// self-contained surface additionally renders the query lifecycle as explicit loading (skeleton chrome),
/// whole-surface empty, stale (chip), offline (chip) and hard-error (QueryError + retry) branches — no surface
/// is ever hidden. All data flows through the shared <see cref="AcDcStatsViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade, each panel / row carries a Narrator name, and state
/// changes are announced through a polite live region. The surface adds no custom motion, so reduced-motion is
/// honoured by construction.
/// </summary>
public sealed partial class AcDcStatsPanel : ContentControl, IDisposable
{
    private const double BarHeight = 16;
    private const double TypeColumnMinWidth = 110;
    private const double NumericColumnMinWidth = 60;

    private readonly AcDcStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AcDcStatsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsQueryError _queryError = new();
    private readonly Caption _statusLine = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and currency symbol.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public AcDcStatsPanel(
        IAcDcStatsSource source,
        ILocalizer localizer,
        AcDcStatsDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AcDcStatsDiagnostics();
        _viewModel = new AcDcStatsViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _queryError.ActionInvoked += OnRetryInvoked;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>AcDcStatsPanel</c>).</summary>
    public static string Slug => AcDcStatsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public AcDcStatsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AcDcStatsSource"/> from the shared data
    /// layer (the host's P2-core dependencies).
    /// </summary>
    public static AcDcStatsPanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AcDcStatsDiagnostics? diagnostics = null,
        string? currencySymbol = null,
        long? vehicleId = null)
    {
        var source = new AcDcStatsSource(vehicles, api, engine, options, vehicleId);
        return new AcDcStatsPanel(source, localizer, diagnostics, currencySymbol);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _queryError.ActionInvoked -= OnRetryInvoked;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _statusLine.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_statusLine);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_statusLine);
        Content = _root;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        BuildStatusRow();

        _bodyHost.Content = _viewModel.State switch
        {
            AcDcStatsState.Loading => BuildLoadingScaffold(),
            AcDcStatsState.Error => BuildErrorBody(),
            AcDcStatsState.Empty => BuildEmptyBody(),
            _ => BuildContent(_viewModel.Display),
        };

        UpdateStatusLine();
        AutomationProperties.SetName(this, _viewModel.SurfaceTitle);
    }

    // ── Status row: stale / offline chip + freshness ─────────────────────────────────────────────────
    private void BuildStatusRow()
    {
        _statusRow.Children.Clear();

        switch (_viewModel.State)
        {
            case AcDcStatsState.Stale:
                _statusRow.Children.Add(BuildBadge(_viewModel.StaleLabel, StatusKind.Warning));
                break;
            case AcDcStatsState.Offline:
                _statusRow.Children.Add(BuildBadge(_viewModel.OfflineLabel, StatusKind.Danger));
                break;
            default:
                break;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _statusRow.Children.Add(_freshness);
    }

    private void UpdateStatusLine()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _statusLine.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _statusLine.Value = message;
        _statusLine.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_statusLine, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_statusLine);
        }
    }

    // ── Error (web parent's QueryError) ──────────────────────────────────────────────────────────────
    private TsQueryError BuildErrorBody()
    {
        _queryError.Message = _viewModel.ErrorMessage ?? AcDcStatsRegistration.ErrorText(_localizer);
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.AttemptCount = _viewModel.Attempts;
        return _queryError;
    }

    // ── Whole-surface empty (no charging sessions to break down) ─────────────────────────────────────
    private TsEmptyState BuildEmptyBody() => new()
    {
        Message = _viewModel.EmptyText,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loading: skeleton chrome inside the panel ────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoadingScaffold()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, Width = 180, HorizontalAlignment = HorizontalAlignment.Left });
        column.Children.Add(new TsSkeleton { BlockHeight = BarHeight });
        column.Children.Add(new TsSkeleton { BlockHeight = 26 });
        column.Children.Add(new TsSkeleton { BlockHeight = 22 });
        column.Children.Add(new TsSkeleton { BlockHeight = 22 });
        return new TsGlassPanel { Padding = new Thickness(20), Content = column };
    }

    // ── Ready / Stale / Offline: the full panel composition ──────────────────────────────────────────
    private TsGlassPanel BuildContent(AcDcStatsDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildTitle());
        stack.Children.Add(BuildEnergySplit(display.Split));
        stack.Children.Add(BuildTable(display));
        if (display.HasFree)
        {
            stack.Children.Add(BuildFreeFooter(display));
        }

        var panel = new TsGlassPanel { Padding = new Thickness(20), Content = stack };
        AutomationProperties.SetName(panel, _viewModel.SurfaceTitle);
        return panel;
    }

    private StackPanel BuildTitle()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = AcDcStatsRegistration.TitleGlyph,
            FontSize = 16,
            Foreground = AccentBrush(StatusKind.Warning),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new SectionTitle { Value = _viewModel.SurfaceTitle, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, _viewModel.SurfaceTitle);
        return row;
    }

    private StackPanel BuildEnergySplit(AcDcEnergySplit split)
    {
        var section = new StackPanel { Spacing = 6 };
        section.Children.Add(new Caption { Value = _viewModel.EnergySplitLabel });
        section.Children.Add(BuildSplitBar(split));
        section.Children.Add(BuildSplitLabels(split));
        return section;
    }

    private static Border BuildSplitBar(AcDcEnergySplit split)
    {
        double acWeight = Math.Max(0, split.AcWeight);
        double dcWeight = Math.Max(0, split.DcWeight);

        if (acWeight <= 0 && dcWeight <= 0)
        {
            // Neutral empty track when no energy has been recorded.
            return new Border { Height = BarHeight, CornerRadius = new CornerRadius(8), Background = DisplayTokens.Border };
        }

        var bar = new Grid { Height = BarHeight };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(acWeight, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(dcWeight, GridUnitType.Star) });

        if (split.AcShown)
        {
            var ac = BuildSegment(split.AcSegmentText, StatusKind.Info);
            Grid.SetColumn(ac, 0);
            bar.Children.Add(ac);
        }

        if (split.DcShown)
        {
            var dc = BuildSegment(split.DcSegmentText, StatusKind.Warning);
            Grid.SetColumn(dc, 1);
            bar.Children.Add(dc);
        }

        return new Border { Height = BarHeight, CornerRadius = new CornerRadius(8), Child = bar };
    }

    private static Border BuildSegment(string text, StatusKind kind) => new()
    {
        Background = AccentBrush(kind),
        Child = new TextBlock
        {
            Text = text,
            FontSize = 9,
            FontWeight = FontWeights.Bold,
            Foreground = TextBrush("TsColorTextPrimaryBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        },
    };

    private static Grid BuildSplitLabels(AcDcEnergySplit split)
    {
        var grid = new Grid();
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var left = MutedLabel(split.AcEnergyText);
        left.HorizontalAlignment = HorizontalAlignment.Left;
        Grid.SetColumn(left, 0);

        var center = MutedLabel(split.TotalEnergyText);
        center.HorizontalAlignment = HorizontalAlignment.Center;
        Grid.SetColumn(center, 1);

        var right = MutedLabel(split.DcEnergyText);
        right.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(right, 2);

        grid.Children.Add(left);
        grid.Children.Add(center);
        grid.Children.Add(right);
        return grid;
    }

    private static TextBlock MutedLabel(string text) => new()
    {
        Text = text,
        FontSize = 11,
        Foreground = TextBrush("TsColorTextMutedBrush"),
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private ScrollViewer BuildTable(AcDcStatsDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = TypeColumnMinWidth });
        for (int c = 1; c < 8; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, MinWidth = NumericColumnMinWidth });
        }

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        string[] headers =
        [
            _viewModel.TypeHeader,
            _viewModel.SessionsHeader,
            _viewModel.EnergyHeader,
            _viewModel.CostHeader,
            _viewModel.CostPerKwhHeader,
            _viewModel.AvgEnergyHeader,
            _viewModel.AvgTimeHeader,
            _viewModel.FreeHeader,
        ];

        for (int c = 0; c < headers.Length; c++)
        {
            var header = HeaderCell(headers[c], numeric: c != 0);
            Place(grid, header, 0, c);
        }

        var underline = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        Grid.SetRow(underline, 0);
        Grid.SetColumn(underline, 0);
        Grid.SetColumnSpan(underline, headers.Length);
        grid.Children.Add(underline);

        int r = 1;
        foreach (var row in display.Rows)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            AddRowCells(grid, r, row);
            r++;
        }

        AutomationProperties.SetName(grid, _viewModel.SurfaceTitle);

        return new ScrollViewer
        {
            Content = grid,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollMode = ScrollMode.Disabled,
        };
    }

    private static void AddRowCells(Grid grid, int rowIndex, AcDcStatsRow row)
    {
        var type = DataCell(row.Label, numeric: false, AccentBrush(row.Accent));
        type.FontWeight = FontWeights.SemiBold;
        AutomationProperties.SetName(type, row.AutomationName);
        Place(grid, type, rowIndex, 0);

        (string Text, Brush? Foreground)[] cells =
        [
            (row.SessionsText, TextBrush("TsColorTextPrimaryBrush")),
            (row.EnergyText, TextBrush("TsColorTextPrimaryBrush")),
            (row.CostText, AccentBrush(StatusKind.Warning)),
            (row.PerKwhText, TextBrush("TsColorTextSecondaryBrush")),
            (row.AvgEnergyText, TextBrush("TsColorTextSecondaryBrush")),
            (row.AvgTimeText, TextBrush("TsColorTextSecondaryBrush")),
            (row.FreeText, AccentBrush(StatusKind.Success)),
        ];

        for (int c = 0; c < cells.Length; c++)
        {
            var cell = DataCell(cells[c].Text, numeric: true, cells[c].Foreground);
            AutomationProperties.SetAccessibilityView(cell, AccessibilityView.Raw);
            Place(grid, cell, rowIndex, c + 1);
        }
    }

    private static Border BuildFreeFooter(AcDcStatsDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        row.Children.Add(BuildFreeItem(display.FreeChargedLabel, display.FreeSessionsValue));
        row.Children.Add(BuildFreeItem(display.FreeEnergyLabel, display.FreeEnergyValue));

        var footer = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 12, 0, 0),
            Child = row,
        };
        AutomationProperties.SetName(footer, display.FreeFooterAutomationName);
        return footer;
    }

    private static StackPanel BuildFreeItem(string label, string value)
    {
        var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        item.Children.Add(new TextBlock
        {
            Text = label + ":",
            FontSize = 12,
            Foreground = TextBrush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        item.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = AccentBrush(StatusKind.Success),
            VerticalAlignment = VerticalAlignment.Center,
        });
        return item;
    }

    private static TextBlock HeaderCell(string text, bool numeric) => new()
    {
        Text = text,
        FontSize = 11,
        FontWeight = FontWeights.SemiBold,
        Foreground = TextBrush("TsColorTextMutedBrush"),
        Padding = new Thickness(8, 6, 8, 6),
        HorizontalAlignment = numeric ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        TextAlignment = numeric ? TextAlignment.Right : TextAlignment.Left,
    };

    private static TextBlock DataCell(string text, bool numeric, Brush? foreground) => new()
    {
        Text = text,
        FontSize = 13,
        Foreground = foreground,
        Padding = new Thickness(8, 6, 8, 6),
        HorizontalAlignment = numeric ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        TextAlignment = numeric ? TextAlignment.Right : TextAlignment.Left,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private static void Place(Grid grid, FrameworkElement element, int row, int column)
    {
        Grid.SetRow(element, row);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static Brush AccentBrush(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static Brush TextBrush(string key) => DisplayTokens.Brush(key);

    private static TsBadge BuildBadge(string text, StatusKind kind)
    {
        var badge = new TsBadge
        {
            Status = kind,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
