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

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Version Info dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/VersionInfoWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// Version-Info-titled freshness header — driven by the version read, with a retry button) above the body:
/// at two or three columns a key/value list (Version / Build Date / Git SHA / Go Version / Uptime) over a 2×N
/// data-capture stat grid (Signals/sec, Messages Today); at four or more columns it adds an OS / Arch line and
/// widens the stat grid to four tiles (Bytes Processed, Avg Latency). At a single column it collapses to the web
/// compact stack (the bold chart version and the seven-char Git SHA chip). When the version read carried no
/// value the body is the friendly "No version data available" empty surface (the web <c>!hasData</c> gate). All
/// data flows through the shared <see cref="VersionInfoViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every readout carries a Narrator name.
/// </summary>
public sealed partial class VersionInfoWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double MonoFontSize = 13;

    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly VersionInfoViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VersionInfoDiagnostics _diagnostics;
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

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = VersionInfoProjection.InfoGlyph,
        FontSize = 14,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network merged version-info source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / standard / wide layout).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public VersionInfoWidget(
        IVersionInfoSource source,
        ILocalizer localizer,
        VersionInfoSize size,
        VersionInfoDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VersionInfoDiagnostics();
        _viewModel = new VersionInfoViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>version-info</c>).</summary>
    public static string RegistryId => VersionInfoRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the compact / standard / wide layout.</summary>
    public VersionInfoSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VersionInfoSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies). None of the reads are vehicle-scoped.
    /// </summary>
    public static VersionInfoWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        VersionInfoSize? size = null,
        VersionInfoDiagnostics? diagnostics = null)
    {
        var source = new VersionInfoSource(api, engine, options);
        return new VersionInfoWidget(source, localizer, size ?? VersionInfoRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);
        _titleIcon.Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_titleIcon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.versionInfo.refresh", "Refresh version info"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(16, 12, 12, 2);
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
        _bodyHost.Padding = new Thickness(16, 4, 16, 12);

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
            case VersionInfoState.Loading:
                Content = BuildLoading();
                break;

            case VersionInfoState.Error:
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
        bool compact = _viewModel.Size.IsCompact;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { HasData: true } display)
        {
            // Web parity: the version read carried no value (hasData == false) renders the empty surface.
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 10, Padding = new Thickness(16, 16, 16, 16) };
        for (int i = 0; i < 5; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 14 });
        }

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12, Margin = new Thickness(0, 6, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (int i = 0; i < 2; i++)
        {
            var cell = new TsSkeleton { BlockHeight = 56 };
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        column.Children.Add(grid);

        AutomationProperties.SetName(column, _localizer.GetString("widget.versionInfo.loading", "Loading version info"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.versionInfo.error", "Couldn't load version info"),
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
        IconGlyph = VersionInfoProjection.InfoGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact layout (1-col): bold chart version over the seven-char Git SHA chip ──
    private static StackPanel BuildCompact(VersionInfoDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.ChartVersion,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = display.TruncatedSha,
            FontSize = 10,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.TruncatedSha);
        column.Children.Add(badge);

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Standard / wide layout: KV list (+ OS/Arch when wide) over the data-capture stat grid ──
    private static StackPanel BuildStandard(VersionInfoDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildKvList(display.KvRows));

        if (display.ShowOsArch)
        {
            column.Children.Add(BuildOsArch(display));
        }

        column.Children.Add(BuildStatGrid(display.Stats, display.StatColumns));
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: <KVList> — each row is a justified label/value pair; the version value is bold and the Git
    // SHA value is monospace (web font-bold / font-mono spans).
    private static StackPanel BuildKvList(IReadOnlyList<VersionKvRow> rows)
    {
        var column = new StackPanel { Spacing = 6 };
        foreach (var row in rows)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var label = new TextBlock
            {
                Text = row.Label,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var value = new TextBlock
            {
                Text = row.Value,
                FontSize = row.Style == VersionValueStyle.Mono ? MonoFontSize : 13,
                FontWeight = row.Style == VersionValueStyle.Bold ? FontWeights.Bold : FontWeights.Normal,
                Foreground = DisplayTokens.TextPrimary,
                TextAlignment = TextAlignment.Right,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };

            if (row.Style == VersionValueStyle.Mono)
            {
                value.FontFamily = MonoFont;
            }

            Grid.SetColumn(label, 0);
            Grid.SetColumn(value, 1);
            grid.Children.Add(label);
            grid.Children.Add(value);

            AutomationProperties.SetName(grid, $"{row.Label}: {row.Value}");
            column.Children.Add(grid);
        }

        return column;
    }

    // Web parity: <div className="flex items-center gap-2 text-xs"> OS: {os} • Arch: {arch} </div>.
    private static StackPanel BuildOsArch(VersionInfoDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(Caption($"{display.OsLabel}: {display.OsValue}"));
        row.Children.Add(Caption("\u2022"));
        row.Children.Add(Caption($"{display.ArchLabel}: {display.ArchValue}"));

        AutomationProperties.SetName(
            row,
            $"{display.OsLabel} {display.OsValue}, {display.ArchLabel} {display.ArchValue}");
        return row;
    }

    private static TextBlock Caption(string text) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStatGrid(IReadOnlyList<VersionStatItem> stats, int columns)
    {
        int cols = Math.Max(1, columns);
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (stats.Count + cols - 1) / cols;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var cell = new TsStatCard { Label = stats[i].Label, Value = stats[i].Value };
            Grid.SetRow(cell, i / cols);
            Grid.SetColumn(cell, i % cols);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
