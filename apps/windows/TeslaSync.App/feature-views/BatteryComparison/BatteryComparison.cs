using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.BatteryComparison;

/// <summary>
/// The native WinUI 3 fleet-battery surface — a parity port of
/// web/src/features/vehicles/components/BatteryComparison.tsx. It renders the web's glass card with the
/// "Fleet Battery Status" header (an Activity-pulse icon plus the title) and a vertical list of per-vehicle
/// battery bars: a truncated vehicle name, a tier-coloured proportional bar (state of charge), the integer
/// percentage and the unit-formatted rated range. Each bar's colour follows the web <c>batteryColor</c>
/// (good / warning / critical). Every state renders — the per-bar skeletons while loading, the populated bars
/// when loaded, a friendly empty state when the fleet has no battery rows (the web returns null; the prompt
/// mandates a visible surface), an explicit retry surface on hard failure, plus stale and offline freshness
/// chips over the bars. All data flows through the shared <see cref="BatteryComparisonViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade and every bar carries a Narrator name.
/// </summary>
public sealed partial class BatteryComparison : ContentControl, IDisposable
{
    private const string ActivityGlyph = "\uE9D9";  // Segoe Fluent "Health" pulse — the web lucide Activity icon
    private const string EmptyGlyph = "\uE83F";     // Segoe Fluent "Battery10" — empty-fleet affordance
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent "Refresh"
    private const double PanelPadding = 20;          // web GlassPanel p-5
    private const double TitleIconSize = 16;         // web h-4 w-4
    private const double BarHeight = 12;             // web h-3
    private const double RowSpacing = 12;            // web gap-3
    private const double BarsSpacing = 12;           // web space-y-3
    private const double NameColumnWidth = 96;       // web w-24
    private const double PercentColumnWidth = 44;    // web w-10
    private const double RangeColumnWidth = 64;      // web w-16
    private const double LabelFontSize = 12;         // web text-xs
    private const double RangeFontSize = 10;         // web text-[10px]
    private const int SkeletonRowCount = 4;

    private readonly BatteryComparisonViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryComparisonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _outer = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _actions = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _body = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network fleet-battery source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryComparison(
        IBatteryComparisonSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        BatteryComparisonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryComparisonDiagnostics();
        _viewModel = new BatteryComparisonViewModel(source, localizer, units);
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

    /// <summary>The canonical surface id (<c>battery-comparison</c>).</summary>
    public static string SurfaceId => BatteryComparisonRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public BatteryComparisonViewModel ViewModel => _viewModel;

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryComparisonSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static BatteryComparison Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        BatteryComparisonDiagnostics? diagnostics = null)
    {
        var source = new BatteryComparisonSource(api, engine, options);
        return new BatteryComparison(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // web header: <h3 class="flex items-center gap-2"><Activity/>{title}</h3>. The native superset adds a
        // right-aligned freshness/refresh strip so the mandated stale / offline / refreshing states are visible.
        var icon = new FontIcon { Glyph = ActivityGlyph, FontSize = TitleIconSize, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_title);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(_actions);

        _outer.Children.Add(_header);
        _outer.Children.Add(_body);

        Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _outer };
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
        var display = _viewModel.Display;
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.Title);
        UpdateHeader();

        _body.Content = _viewModel.State switch
        {
            BatteryComparisonState.Loading => BuildLoading(),
            BatteryComparisonState.Error => BuildError(),
            BatteryComparisonState.Empty => BuildEmpty(display),
            _ => BuildBars(display),
        };
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private void UpdateHeader()
    {
        _actions.Children.Clear();

        if (_viewModel.State is BatteryComparisonState.Stale or BatteryComparisonState.Offline)
        {
            _actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == BatteryComparisonState.Offline;
        _actions.Children.Add(_freshness);

        _actions.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(BatteryComparisonState state)
    {
        bool offline = state == BatteryComparisonState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = LabelFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Bars ──────────────────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildBars(BatteryComparisonDisplay display)
    {
        var list = new StackPanel { Spacing = BarsSpacing };
        foreach (var bar in display.Bars)
        {
            list.Children.Add(BuildBarRow(bar));
        }

        AutomationProperties.SetName(list, display.Title);
        return list;
    }

    private static Grid BuildBarRow(BatteryBar bar)
    {
        var row = new Grid { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(NameColumnWidth) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(PercentColumnWidth) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(RangeColumnWidth) });

        var name = new TextBlock
        {
            Text = bar.Name,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);
        row.Children.Add(name);

        var track = BuildBarTrack(bar);
        Grid.SetColumn(track, 1);
        row.Children.Add(track);

        var percent = new TextBlock
        {
            Text = bar.PercentText,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(percent, 2);
        row.Children.Add(percent);

        var range = new TextBlock
        {
            Text = bar.RangeText,
            FontSize = RangeFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(range, 3);
        row.Children.Add(range);

        AutomationProperties.SetName(row, bar.AutomationName);
        return row;
    }

    // web: a rounded track (bg-white/[0.04]) clipping a left-anchored fill whose width is the level%; the fill
    // is tinted by batteryColor. A two-star-column grid renders the proportional fill without a measured width.
    private static Grid BuildBarTrack(BatteryBar bar)
    {
        CornerRadius pill = DisplayTokens.Radius("TsRadiusPill", 999);
        double fraction = bar.BarFraction;

        var track = new Grid { Height = BarHeight, VerticalAlignment = VerticalAlignment.Center };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, fraction), GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 1 - fraction), GridUnitType.Star) });

        var background = new Border { Background = DisplayTokens.Border, CornerRadius = pill, Opacity = 0.5 };
        Grid.SetColumnSpan(background, 2);
        track.Children.Add(background);

        var fill = new Border { Background = DisplayTokens.Brush(bar.AccentBrushKey), CornerRadius = pill };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);

        // Decorative — the row's Narrator name already carries the name, percentage and range.
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var list = new StackPanel { Spacing = BarsSpacing };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            list.Children.Add(BuildSkeletonRow());
        }

        AutomationProperties.SetName(
            list,
            _localizer.GetString("vehicles.batteryComparison.loading", "Loading fleet battery status"));
        LiveRegion.Configure(list);
        LiveRegion.Announce(list);
        return list;
    }

    private static Grid BuildSkeletonRow()
    {
        var row = new Grid { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(NameColumnWidth) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(PercentColumnWidth) });

        var name = new TsSkeleton { BlockHeight = BarHeight };
        Grid.SetColumn(name, 0);
        row.Children.Add(name);

        var bar = new TsSkeleton { BlockHeight = BarHeight };
        Grid.SetColumn(bar, 1);
        row.Children.Add(bar);

        var percent = new TsSkeleton { BlockHeight = BarHeight };
        Grid.SetColumn(percent, 2);
        row.Children.Add(percent);

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static TsEmptyState BuildEmpty(BatteryComparisonDisplay display) => new()
    {
        IconGlyph = EmptyGlyph,
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("vehicles.batteryComparison.error", "Couldn't load fleet battery status"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
