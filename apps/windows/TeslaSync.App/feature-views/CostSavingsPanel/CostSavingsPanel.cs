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
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Cost-and-Savings feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx. It reproduces the web
/// <c>GlassPanel</c> (the "Cost &amp; Savings" header with the green dollar icon) over the responsive grid of
/// centred metric tiles: the always-present Trip Cost (with its "at $rate/kWh" caption), the Cost-per-distance
/// tile (only when the drive covered distance), and — when driving electric beat gas — the equivalent Gas Cost
/// (with its "at N MPG" caption), the vs-gas Savings and the Savings %. The web component is a pure child of
/// the Drive-Detail page; the native surface binds its own cache-then-network
/// <see cref="CostSavingsPanelViewModel"/>, so it renders every state the P2 contract requires — the skeleton
/// while loading, a retry surface on a hard failure, the friendly "no cost data" surface when no drive
/// resolves, and a freshness chip (stale / offline) over the card otherwise. The view never performs HTTP.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class CostSavingsPanel : ContentControl, IDisposable
{
    private const string DollarGlyph = "\uE1D3";   // Segoe Fluent — money (web lucide DollarSign)
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const int FadeDelayMs = 150;           // web FadeIn delay
    private const double OuterPadding = 20;        // web p-5
    private const double HeaderToBodyGap = 16;     // web mb-4
    private const double TileSpacing = 16;         // web gap-4
    private const double TileValueSpacing = 2;     // web mb-1 / tight stack
    private const double HeaderGap = 8;            // web gap-2
    private const double IconSize = 16;            // web h-4 w-4
    private const double ValueFontSize = 18;       // web text-lg
    private const double LabelFontSize = 10;       // web text-[10px]
    private const double SubtitleFontSize = 9;     // web text-[9px]
    private const double EmptyMinHeight = 96;      // friendly empty surface height
    private const int LoadingTileCount = 5;        // web lg:grid-cols-5

    private readonly CostSavingsPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly CostSavingsPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, settings, unit preference and diagnostics.</summary>
    /// <param name="source">The cache-then-network drive-cost source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="settings">The monetary/fuel preferences; defaults to <see cref="CostSavingsSettings.Default"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CostSavingsPanel(
        ICostSavingsPanelSource source,
        ILocalizer localizer,
        CostSavingsSettings? settings = null,
        UnitPref? units = null,
        CostSavingsPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostSavingsPanelDiagnostics();
        _viewModel = new CostSavingsPanelViewModel(source, localizer, settings, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.Display.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>cost-savings-panel</c>).</summary>
    public static string SurfaceId => CostSavingsPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public CostSavingsPanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="CostSavingsPanelSource"/> from the
    /// shared data layer (the host's P2-core dependencies) for a single drive.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="driveId">The drive whose cost breakdown to render.</param>
    /// <param name="settings">The monetary/fuel preferences; defaults to <see cref="CostSavingsSettings.Default"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public static CostSavingsPanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long driveId,
        CostSavingsSettings? settings = null,
        UnitPref? units = null,
        CostSavingsPanelDiagnostics? diagnostics = null)
    {
        var source = new CostSavingsPanelSource(api, engine, options, driveId);
        return new CostSavingsPanel(source, localizer, settings, units, diagnostics);
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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            CostSavingsState.Loading => BuildLoading(display),
            CostSavingsState.Error => BuildErrorSurface(),
            _ => BuildPanel(display),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel(CostSavingsDisplay display)
    {
        var column = new StackPanel { Spacing = HeaderToBodyGap };
        column.Children.Add(BuildHeader(display));

        if (display.HasData)
        {
            column.Children.Add(BuildTilesGrid(display.Tiles));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = string.Empty,
                Message = display.EmptyMessage,
                MinHeight = EmptyMinHeight,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.None,
            Padding = new Thickness(OuterPadding),
            Content = column,
        };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader(CostSavingsDisplay display)
    {
        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(BuildHeaderIcon());
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });

        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private static FontIcon BuildHeaderIcon()
    {
        var icon = new FontIcon
        {
            Glyph = DollarGlyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush(CostSavingsProjection.SuccessBrushKey), // web text-green-400
            VerticalAlignment = VerticalAlignment.Center,
        };
        // Decorative: the "Cost & Savings" title carries the meaning for Narrator.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    // ── Tiles (web grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 of centred columns) ──────────────────────────

    private static Grid BuildTilesGrid(IReadOnlyList<CostSavingsTile> tiles)
    {
        var grid = new Grid { ColumnSpacing = TileSpacing };
        for (int c = 0; c < tiles.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var cell = BuildTile(tiles[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildTile(CostSavingsTile tile)
    {
        var cell = new StackPanel { Spacing = TileValueSpacing, HorizontalAlignment = HorizontalAlignment.Center };
        cell.Children.Add(new TextBlock
        {
            Text = tile.Label,
            FontSize = LabelFontSize,                 // web text-[10px]
            Foreground = DisplayTokens.TextMuted,     // web text-[var(--text-muted)]
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        cell.Children.Add(new TextBlock
        {
            Text = tile.ValueText,
            FontSize = ValueFontSize,                 // web text-lg
            FontWeight = FontWeights.Bold,            // web font-bold
            Foreground = DisplayTokens.Brush(tile.ValueBrushKey),
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (!string.IsNullOrEmpty(tile.Subtitle))
        {
            cell.Children.Add(new TextBlock
            {
                Text = tile.Subtitle,
                FontSize = SubtitleFontSize,          // web text-[9px]
                Foreground = DisplayTokens.TextMuted, // web text-[var(--text-muted)]
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(cell, tile.AutomationName);
        return cell;
    }

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is CostSavingsState.Stale or CostSavingsState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == CostSavingsState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(CostSavingsState state)
    {
        bool offline = state == CostSavingsState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("driveDetail.costSavings.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
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

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading(CostSavingsDisplay display)
    {
        var column = new StackPanel { Spacing = HeaderToBodyGap };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = HeaderGap };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = IconSize,
            BlockHeight = IconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 140,
            BlockHeight = 16,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);
        column.Children.Add(new TsStatGridSkeleton(LoadingTileCount));

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.None,
            Padding = new Thickness(OuterPadding),
            Content = column,
        };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                display.Title,
                _localizer.GetString("common.loading", "Loading...")));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _localizer.GetString("driveDetail.costSavings", "Cost & Savings"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("driveDetail.costSavings.error", "Couldn't load cost & savings"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.None,
            Padding = new Thickness(OuterPadding),
            Content = error,
        };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
