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
/// The native WinUI 3 Signal Health dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SignalHealthWidget.tsx. It mirrors the web <c>WidgetShell</c> (an
/// Activity-titled freshness header — driven by the stats read, with a retry button) above the telemetry
/// coverage body: a 2×2 stat grid (Total Signals / Active / With Gaps / Freshness), a Status row whose badge is
/// tinted by the stale ratio (Healthy / Degraded / Critical / Unknown), and — at three or more columns — the
/// "Stale / Gap Signals" list. At a single column it collapses to the web compact stack (the active/total live
/// chip, the big total, the "signals" caption and the freshness age). When none of the three reads carried a
/// value the body is the friendly "No signal health data" empty surface (the web <c>!hasData</c> gate). All data
/// flows through the shared <see cref="SignalHealthViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every readout carries a Narrator name.
/// </summary>
public sealed partial class SignalHealthWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly SignalHealthViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SignalHealthDiagnostics _diagnostics;
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
        Glyph = SignalHealthProjection.ActivityGlyph,
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
    /// <param name="source">The cache-then-network merged signal-health source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / wide layout).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">The wall clock used to age live timestamps; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public SignalHealthWidget(
        ISignalHealthSource source,
        ILocalizer localizer,
        SignalHealthSize size,
        SignalHealthDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SignalHealthDiagnostics();
        _viewModel = new SignalHealthViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>signal-health</c>).</summary>
    public static string RegistryId => SignalHealthRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the compact / wide layout.</summary>
    public SignalHealthSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SignalHealthSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SignalHealthWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SignalHealthSize? size = null,
        long? vehicleId = null,
        SignalHealthDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        var source = new SignalHealthSource(vehicles, api, engine, options, vehicleId);
        return new SignalHealthWidget(source, localizer, size ?? SignalHealthRegistration.DefaultSize, diagnostics, clock);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);
        _titleIcon.Foreground = HealthBrush(StatusKind.Neutral);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.signalHealth.refresh", "Refresh signal health"));
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
            case SignalHealthState.Loading:
                Content = BuildLoading();
                break;

            case SignalHealthState.Error:
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
        _titleIcon.Foreground = HealthBrush(_viewModel.Display?.Health ?? StatusKind.Neutral);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { HasData: true } display)
        {
            // Web parity: no read carried a value (hasData == false) renders the "No signal health data" surface.
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (int i = 0; i < 4; i++)
        {
            var cell = new TsSkeleton { BlockHeight = 64 };
            Grid.SetRow(cell, i / 2);
            Grid.SetColumn(cell, i % 2);
            grid.Children.Add(cell);
        }

        column.Children.Add(grid);

        AutomationProperties.SetName(column, _localizer.GetString("widget.signalHealth.loading", "Loading signal health"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.signalHealth.error", "Couldn't load signal health"),
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
        IconGlyph = SignalHealthProjection.ActivityGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact layout (1-col): badge, big total, "signals", freshness age ──
    private static StackPanel BuildCompact(SignalHealthDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TsBadge
        {
            Status = display.Health,
            Content = display.CompactBadgeText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.TotalSignalsText,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.SignalsLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (display.HasFreshness)
        {
            column.Children.Add(new TextBlock
            {
                Text = display.FreshnessText,
                FontSize = 12,
                Foreground = HealthBrush(display.Health),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Standard / Wide layout: 2×2 stat grid + status row + (wide) stale list ──
    private static StackPanel BuildStandard(SignalHealthDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatGrid(display));
        column.Children.Add(BuildStatusRow(display));

        if (display.IsWide && display.HasGapRows)
        {
            column.Children.Add(BuildStaleList(display));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static Grid BuildStatGrid(SignalHealthDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddCell(grid, 0, 0, StatCard(display.TotalSignalsLabel, display.TotalSignalsText, SignalHealthProjection.ActivityGlyph));
        AddCell(grid, 0, 1, StatCard(display.ActiveLabel, display.ActiveText, SignalHealthProjection.ActiveGlyph));
        AddCell(grid, 1, 0, StatCard(display.WithGapsLabel, display.WithGapsText, SignalHealthProjection.GapsGlyph));
        AddCell(grid, 1, 1, StatCard(display.FreshnessLabel, display.FreshnessText, SignalHealthProjection.FreshnessGlyph));
        return grid;
    }

    private static TsStatCard StatCard(string label, string value, string glyph) => new()
    {
        Label = label,
        Value = value,
        Glyph = glyph,
    };

    private static void AddCell(Grid grid, int row, int col, FrameworkElement cell)
    {
        Grid.SetRow(cell, row);
        Grid.SetColumn(cell, col);
        grid.Children.Add(cell);
    }

    // Web parity: <div className="flex items-center justify-between"> — "Status" caption left, health badge right.
    private static Grid BuildStatusRow(SignalHealthDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = display.StatusLabel,
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 0);

        var badge = new TsBadge
        {
            Status = display.Health,
            Content = display.HealthText,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);

        grid.Children.Add(label);
        grid.Children.Add(badge);
        AutomationProperties.SetName(grid, $"{display.StatusLabel} {display.HealthText}");
        return grid;
    }

    private static StackPanel BuildStaleList(SignalHealthDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TextBlock
        {
            Text = display.StaleSignalsLabel,
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
        });

        var rows = new StackPanel { Spacing = 4 };
        foreach (var gap in display.GapRows)
        {
            rows.Children.Add(GapRow(gap));
        }

        column.Children.Add(rows);
        AutomationProperties.SetName(column, display.StaleSignalsLabel);
        return column;
    }

    // Web parity: <div className="flex items-center justify-between"> — name left (truncated), last-seen right.
    private static Grid GapRow(SignalGapRow gap)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 28 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = gap.Name,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);

        var lastSeen = new TextBlock
        {
            Text = gap.LastSeenText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(lastSeen, 1);

        grid.Children.Add(name);
        grid.Children.Add(lastSeen);
        AutomationProperties.SetName(grid, $"{gap.Name} {gap.LastSeenText}");
        return grid;
    }

    private static Brush HealthBrush(StatusKind health) => health == StatusKind.Neutral
        ? DisplayTokens.TextMuted
        : DisplayTokens.Brush(StatusResources.AccentBrushKey(health));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
