using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Charging-Efficiency feature surface — a parity port of
/// web/src/features/charging/components/charging-list/EfficiencyPanel.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the "Charging Efficiency" header with the green <c>Activity</c> icon and the
/// "Wall-to-battery energy conversion (N sessions with data)" hint) over a four-tile grid: the cyan
/// Average-Efficiency tile with its progress bar (capped at 100%), the emerald Best-Session tile, the rose
/// Worst-Session tile and the amber Wall-to-Battery-Loss tile (each a percentage / energy value plus a
/// date / totals sub-line). The web component is a pure child of the charging-list page; the native surface
/// binds its own cache-then-network <see cref="EfficiencyPanelViewModel"/>, so it renders every state the P2
/// contract requires — the skeleton while loading, a retry surface on a hard failure, a friendly empty state
/// when no session carries efficiency data, and a freshness chip (stale / offline) over the tiles otherwise.
/// The view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class EfficiencyPanel : ContentControl, IDisposable
{
    private const string ActivityGlyph = "\uE9D2"; // Segoe Fluent — activity line (web Activity icon)
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const int FadeDelayMs = 150;           // web FadeIn delay={0.15}
    private const double OuterPadding = 20;        // web p-5
    private const double TilePadding = 20;         // web p-5 (each tile)
    private const double SectionSpacing = 16;      // web mb-4 / gap-4
    private const double TileSpacing = 4;          // web mt-1 between value/label
    private const double IconSize = 16;            // web h-4 w-4
    private const double BarHeight = 6;            // web h-1.5
    private const double BarRadius = 3;            // web rounded-full
    private const double SkeletonIconSize = 16;

    private readonly EfficiencyPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly EfficiencyPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics/clock.</summary>
    public EfficiencyPanel(
        IEfficiencyPanelSource source,
        ILocalizer localizer,
        EfficiencyPanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new EfficiencyPanelDiagnostics();
        _viewModel = new EfficiencyPanelViewModel(source, localizer, clock);
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

    /// <summary>The canonical surface id (<c>efficiency-panel</c>).</summary>
    public static string SurfaceId => EfficiencyPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public EfficiencyPanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="EfficiencyPanelSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static EfficiencyPanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        EfficiencyPanelDiagnostics? diagnostics = null)
    {
        var source = new EfficiencyPanelSource(vehicles, api, engine, options, vehicleId);
        return new EfficiencyPanel(source, localizer, diagnostics);
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
            EfficiencyPanelState.Loading => BuildLoading(display),
            EfficiencyPanelState.Error => BuildErrorSurface(),
            _ => BuildPanel(display),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel(EfficiencyPanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));

        if (display.HasData)
        {
            column.Children.Add(BuildTilesGrid(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = ActivityGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader(EfficiencyPanelDisplay display)
    {
        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = ActivityGlyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"), // web text-neon-green Activity
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new Caption
        {
            Value = display.HeaderSummary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private static Grid BuildTilesGrid(EfficiencyPanelDisplay display)
    {
        var grid = new Grid { ColumnSpacing = SectionSpacing, RowSpacing = SectionSpacing };
        int count = display.Metrics.Count;
        for (int c = 0; c < count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < count; i++)
        {
            var tile = BuildTile(display.Metrics[i]);
            Grid.SetColumn(tile, i);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static TsGlassPanel BuildTile(EfficiencyMetric metric)
    {
        var content = new StackPanel { Spacing = TileSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };

        content.Children.Add(new TextBlock
        {
            Text = metric.ValueText,
            FontSize = TypographyTokens.Size("TsTypeTitleFontSize", 24), // web text-2xl
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(EfficiencyPanelTokens.ToneBrushKey(metric.Tone)),
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        content.Children.Add(new TextBlock
        {
            Text = metric.Label,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted, // web text-[var(--text-muted)]
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (metric.BarFraction is { } fraction)
        {
            content.Children.Add(BuildBar(fraction, metric.Tone));
        }
        else if (!string.IsNullOrEmpty(metric.SubText))
        {
            content.Children.Add(new TextBlock
            {
                Text = metric.SubText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                Foreground = DisplayTokens.TextMuted,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var tile = new TsGlassPanel { Padding = new Thickness(TilePadding), Content = content };
        AutomationProperties.SetName(tile, metric.AutomationName);
        return tile;
    }

    private static Border BuildBar(double fraction, EfficiencyTone tone)
    {
        double filled = Math.Clamp(fraction, 0, 1);

        var inner = new Grid { Height = BarHeight };
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(filled, GridUnitType.Star) });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - filled, GridUnitType.Star) });

        var fill = new Border
        {
            CornerRadius = new CornerRadius(BarRadius),
            Background = DisplayTokens.Brush(EfficiencyPanelTokens.ToneBrushKey(tone)), // web bg-neon-cyan
        };
        Grid.SetColumn(fill, 0);
        inner.Children.Add(fill);

        var track = new Border
        {
            Height = BarHeight,
            CornerRadius = new CornerRadius(BarRadius),
            Background = DisplayTokens.Brush("TsColorBorderBrush"), // web bg-white/[0.05] track
            Margin = new Thickness(0, 8, 0, 0), // web mt-2
            Child = inner,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is EfficiencyPanelState.Stale or EfficiencyPanelState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == EfficiencyPanelState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(EfficiencyPanelState state)
    {
        bool offline = state == EfficiencyPanelState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("charging.efficiency.stale", "Stale");

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

    private TsGlassPanel BuildLoading(EfficiencyPanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonIconSize,
            BlockHeight = SkeletonIconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 220,
            BlockHeight = 16,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);
        column.Children.Add(new TsStatGridSkeleton(display.Metrics.Count > 0 ? display.Metrics.Count : 4));

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
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
            Title = _localizer.GetString("charging.efficiency.title", "Charging Efficiency"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("charging.efficiency.error", "Couldn't load charging efficiency"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
