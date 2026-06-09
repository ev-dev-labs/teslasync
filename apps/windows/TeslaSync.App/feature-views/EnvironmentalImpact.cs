using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Environmental-Impact feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx. It reproduces the web green-glow
/// <c>GlassPanel</c> (the "Environmental Impact" header with the leaf icon) over the two green headline tiles
/// (kg CO₂ saved, tree-years equivalent), the descriptive sentence — with its two bold green figures — inside a
/// tinted surface box led by the trees icon, and the three centred sub-stats (gallons avoided, metric tons CO₂,
/// $ saved total). The web component is a pure child of the Cost-Analysis page; the native surface binds its own
/// cache-then-network <see cref="EnvironmentalImpactViewModel"/>, so it renders every state the P2 contract
/// requires — the skeleton while loading, a retry surface on a hard failure, the friendly "No data" surface when
/// no charging sessions exist, and a freshness chip (stale / offline) over the card otherwise. The view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name.
/// </summary>
public sealed partial class EnvironmentalImpact : ContentControl, IDisposable
{
    private const string LeafGlyph = "\U0001F343";  // 🍃 — web lucide Leaf (decorative)
    private const string TreesGlyph = "\U0001F333"; // 🌳 — web lucide Trees (decorative)
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const int FadeDelayMs = 150;            // web FadeIn delay
    private const double OuterPadding = 16;         // web p-4
    private const double TilePadding = 16;          // web p-4 (each green tile)
    private const double BoxPadding = 12;           // web p-3 (description box)
    private const double SectionSpacing = 16;       // web space-y-4 / mb-4
    private const double TileSpacing = 12;          // web gap-3 (headline tiles)
    private const double StatSpacing = 8;           // web gap-2 (sub-stats)
    private const double IconSize = 18;             // web h-4/h-5 icons
    private const double TileValueSpacing = 4;      // web mt-1
    private const double SuccessTintOpacity = 0.1;  // web bg-green-500/10
    private const double EmptyMinHeight = 128;      // web h-32

    private readonly EnvironmentalImpactViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly EnvironmentalImpactDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public EnvironmentalImpact(
        IEnvironmentalImpactSource source,
        ILocalizer localizer,
        EnvironmentalImpactDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new EnvironmentalImpactDiagnostics();
        _viewModel = new EnvironmentalImpactViewModel(source, localizer);
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

    /// <summary>The canonical surface id (<c>environmental-impact</c>).</summary>
    public static string SurfaceId => EnvironmentalImpactRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public EnvironmentalImpactViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="EnvironmentalImpactSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static EnvironmentalImpact Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        EnvironmentalImpactDiagnostics? diagnostics = null)
    {
        var source = new EnvironmentalImpactSource(vehicles, api, engine, options, vehicleId);
        return new EnvironmentalImpact(source, localizer, diagnostics);
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
            EnvironmentalImpactState.Loading => BuildLoading(display),
            EnvironmentalImpactState.Error => BuildErrorSurface(),
            _ => BuildPanel(display),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel(EnvironmentalImpactDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));

        if (display.HasData)
        {
            column.Children.Add(BuildTilesGrid(display.Tiles));
            column.Children.Add(BuildDescriptionBox(display));
            column.Children.Add(BuildStatsGrid(display.Stats));
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
            Glow = GlassGlow.Green,
            Padding = new Thickness(OuterPadding),
            Content = column,
        };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader(EnvironmentalImpactDisplay display)
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
        titleRow.Children.Add(Glyph(LeafGlyph));
        titleRow.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });

        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    // ── Headline tiles (web grid-cols-2 of bg-green-500/10 cards) ────────────────────────────────────────

    private static Grid BuildTilesGrid(IReadOnlyList<EnvironmentalMetric> tiles)
    {
        var grid = new Grid { ColumnSpacing = TileSpacing };
        for (int c = 0; c < tiles.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var tile = BuildGreenTile(tiles[i]);
            Grid.SetColumn(tile, i);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildGreenTile(EnvironmentalMetric metric)
    {
        var content = new StackPanel { Spacing = TileValueSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        content.Children.Add(new TextBlock
        {
            Text = metric.ValueText,
            FontSize = TypographyTokens.Size("TsTypeTitleFontSize", 24), // web text-2xl
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),     // web text-green-400
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        content.Children.Add(new TextBlock
        {
            Text = metric.Label,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12), // web text-xs
            Foreground = DisplayTokens.TextMuted,                          // web text-[var(--text-muted)]
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var tile = new Border
        {
            Background = TintBrush("TsColorSuccessBrush", SuccessTintOpacity), // web bg-green-500/10
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),             // web rounded-lg
            Padding = new Thickness(TilePadding),
            Child = content,
        };
        AutomationProperties.SetName(tile, metric.AutomationName);
        return tile;
    }

    // ── Description box (web bg-[var(--surface-2)] with the Trees icon + bold-green figures) ──────────────

    private static Border BuildDescriptionBox(EnvironmentalImpactDisplay display)
    {
        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = Glyph(TreesGlyph);
        icon.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(icon, 0);
        row.Children.Add(icon);

        var text = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14), // web text-sm
            Foreground = DisplayTokens.TextSecondary,                  // web text-[var(--text-secondary)]
        };
        AppendText(text, display.DescriptionPrefix + " ");
        AppendEmphasis(text, display.Co2Emphasis);
        AppendText(text, " " + display.OfCo2 + " " + display.TreeNote + " ");
        AppendEmphasis(text, display.TreeEmphasis);
        AppendText(text, " " + display.TreesAbsorbing);
        AutomationProperties.SetName(text, display.DescriptionPlain);
        Grid.SetColumn(text, 1);
        row.Children.Add(text);

        return new Border
        {
            Background = DisplayTokens.Surface, // web bg-[var(--surface-2)]
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(BoxPadding),
            Child = row,
        };
    }

    private static void AppendText(TextBlock target, string text) =>
        target.Inlines.Add(new Run { Text = text });

    private static void AppendEmphasis(TextBlock target, string text) =>
        target.Inlines.Add(new Run
        {
            Text = text,
            FontWeight = FontWeights.SemiBold,                       // web font-semibold
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"), // web text-green-400
        });

    // ── Sub-stats (web grid-cols-3) ─────────────────────────────────────────────────────────────────────

    private static Grid BuildStatsGrid(IReadOnlyList<EnvironmentalMetric> stats)
    {
        var grid = new Grid { ColumnSpacing = StatSpacing };
        for (int c = 0; c < stats.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var cell = BuildStat(stats[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildStat(EnvironmentalMetric metric)
    {
        var cell = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        cell.Children.Add(new TextBlock
        {
            Text = metric.ValueText,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18), // web text-lg
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,                        // web text-white
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        cell.Children.Add(new TextBlock
        {
            Text = metric.Label,
            FontSize = 10,                          // web text-[10px]
            Foreground = DisplayTokens.TextMuted,   // web text-[var(--text-muted)]
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        AutomationProperties.SetName(cell, metric.AutomationName);
        return cell;
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

        if (_viewModel.State is EnvironmentalImpactState.Stale or EnvironmentalImpactState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == EnvironmentalImpactState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(EnvironmentalImpactState state)
    {
        bool offline = state == EnvironmentalImpactState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("costAnalysis.environment.stale", "Stale");

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

    private TsGlassPanel BuildLoading(EnvironmentalImpactDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = IconSize,
            BlockHeight = IconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 180,
            BlockHeight = 16,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);
        column.Children.Add(new TsStatGridSkeleton(2));
        column.Children.Add(new TsSkeleton
        {
            BlockHeight = 56,
            Radius = 8,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(new TsStatGridSkeleton(3));

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.Green,
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
            Title = _localizer.GetString("costAnalysis.environment.title", "Environmental Impact"),
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("costAnalysis.environment.error", "Couldn't load environmental impact"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.Green,
            Padding = new Thickness(OuterPadding),
            Content = error,
        };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Shared helpers ──────────────────────────────────────────────────────────────────────────────────

    private static TextBlock Glyph(string emoji)
    {
        var icon = new TextBlock
        {
            Text = emoji,
            FontSize = IconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        // The emoji is decorative; the surrounding title / sentence carry the meaning for Narrator.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static Brush TintBrush(string brushKey, double opacity)
    {
        var brush = DisplayTokens.Brush(brushKey);
        if (brush is SolidColorBrush solid)
        {
            return new SolidColorBrush(solid.Color) { Opacity = opacity };
        }

        return brush;
    }
}
