using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>PedalUsage</c> feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/PedalUsage.tsx. It renders the web panel: a single glass
/// panel holding the "Pedal Usage" title and a three-up row — a throttle radial gauge (cyan) over a "Throttle
/// Position" caption, a brake radial gauge (red) over a "Brake Pedal Position" caption, and a decorative
/// pedal icon + a danger/success "Brake Active / Brake Inactive" badge over a "Brake Pedal Status" caption. The
/// web component reads one live snapshot via <c>useDriveDynamicsLatest(vehicleId)</c>; the native surface binds
/// the same snapshot through the shared <see cref="PedalUsageViewModel"/> so every state — loading (skeleton),
/// ready, empty (the web "No pedal telemetry received yet" surface), error (retry), stale (stale chip) and
/// offline (offline chip) — renders as a visible surface, never hidden. All value derivation and formatting
/// happen in the WinUI-free <see cref="PedalUsageProjection"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every tile carries a Narrator name.
/// </summary>
public sealed partial class PedalUsage : ContentControl, IDisposable
{
    // Decorative icon for the brake-pedal-status tile. The web uses lucide's Footprints, which has no Segoe
    // Fluent equivalent; the Gauge glyph stands in as a driving-telemetry motif. It is Narrator-hidden — the
    // badge carries the meaning — so the exact glyph is purely visual.
    private const string PedalStatusGlyph = "\uE9D9"; // Segoe Fluent — Gauge (web Footprints, decorative)

    private const double PanelPadding = 24;   // web p-6
    private const double ContentSpacing = 16; // web title mb-4
    private const double GridGutter = 24;     // web gap-6
    private const double GaugeMinWidth = 160; // collapse 3→2→1 columns when narrow (web grid-cols-1 sm:grid-cols-3)
    private const int GaugeColumns = 3;        // web sm:grid-cols-3
    private const double GaugeDiameter = 140;  // web RadialGauge size={140}
    private const double IconSize = 32;        // web Footprints h-8 w-8
    private const int FadeDelayMs = 100;       // web FadeIn delay 0.1
    private const int SkeletonTileCount = 3;   // skeleton chrome mirrors the three-up row

    private readonly PedalUsageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly PedalUsageDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PedalUsage(
        IPedalUsageSource source,
        ILocalizer localizer,
        PedalUsageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new PedalUsageDiagnostics();
        _viewModel = new PedalUsageViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>PedalUsage</c>).</summary>
    public static string Slug => PedalUsageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public PedalUsageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="PedalUsageSource"/> from the shared data
    /// layer (the driving-dynamics host's P2-core dependencies) for a single vehicle.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle whose pedal telemetry to render (web <c>vehicleId</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static PedalUsage Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long vehicleId,
        PedalUsageDiagnostics? diagnostics = null)
    {
        var source = new PedalUsageSource(api, engine, options, vehicleId);
        return new PedalUsage(source, localizer, diagnostics);
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
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

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
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        Content = _viewModel.State switch
        {
            PedalUsageState.Loading => BuildLoading(),
            PedalUsageState.Empty => BuildEmpty(),
            PedalUsageState.Error => BuildError(),
            _ => BuildContent(),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: title + three-up gauge row) ─────────────────────────────
    private TsFadeIn BuildContent()
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(showChip: true));
        stack.Children.Add(BuildGaugeRow(_viewModel.Content));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private Grid BuildHeader(bool showChip)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new SectionTitle
        {
            Value = _viewModel.Content.Title,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 0);
        grid.Children.Add(title);

        if (showChip && _viewModel.State is PedalUsageState.Stale or PedalUsageState.Offline)
        {
            var chip = BuildFreshnessChip(_viewModel.State);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private TsBadge BuildFreshnessChip(PedalUsageState state)
    {
        bool offline = state == PedalUsageState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock
            {
                Text = text,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TsGrid BuildGaugeRow(PedalUsageContent content)
    {
        var grid = new TsGrid { Columns = GaugeColumns, Gutter = GridGutter, ItemMinWidth = GaugeMinWidth };
        grid.Children.Add(BuildGaugeTile(content.Throttle));
        grid.Children.Add(BuildGaugeTile(content.Brake));
        grid.Children.Add(BuildBrakeStatusTile(content.BrakeStatus));
        return grid;
    }

    // web: <div className="flex flex-col items-center gap-2"> RadialGauge + <span>caption</span> </div>
    private static StackPanel BuildGaugeTile(PedalGaugeDisplayItem gauge)
    {
        var gaugeControl = new TsRadialGauge
        {
            Value = gauge.Value,
            Max = gauge.Max,
            Label = gauge.GaugeLabel,
            Unit = gauge.Unit,
            Decimals = gauge.Decimals,
            Role = AccentRole(gauge.Accent),
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(gaugeControl, AccessibilityView.Raw);

        var caption = new Caption { Value = gauge.CaptionText, HorizontalAlignment = HorizontalAlignment.Center };

        var tile = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(gaugeControl);
        tile.Children.Add(caption);

        AutomationProperties.SetName(tile, gauge.AutomationName);
        return tile;
    }

    // web: <div className="flex flex-col items-center justify-center gap-3"> Footprints + Badge + <span>caption</span> </div>
    private static StackPanel BuildBrakeStatusTile(PedalBrakeStatusContent status)
    {
        var icon = new FontIcon
        {
            Glyph = PedalStatusGlyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var badge = new TsBadge
        {
            Status = status.BadgeStatus,
            Content = new TextBlock
            {
                Text = status.BadgeText,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            },
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var caption = new Caption { Value = status.CaptionText, HorizontalAlignment = HorizontalAlignment.Center };

        var tile = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        tile.Children.Add(icon);
        tile.Children.Add(badge);
        tile.Children.Add(caption);

        AutomationProperties.SetName(tile, status.AutomationName);
        return tile;
    }

    // ── Loading (the parent is still fetching the snapshot) ────────────────────────────────────────────────
    private TsGlassPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 20 });

        var grid = new TsGrid { Columns = GaugeColumns, Gutter = GridGutter, ItemMinWidth = GaugeMinWidth };
        for (int i = 0; i < SkeletonTileCount; i++)
        {
            var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(new TsSkeleton { BlockWidth = GaugeDiameter, BlockHeight = GaugeDiameter });
            column.Children.Add(new TsSkeleton { BlockWidth = 96, BlockHeight = 12 });
            grid.Children.Add(column);
        }

        stack.Children.Add(grid);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                _viewModel.SurfaceName,
                _localizer.GetString("common.loading", "Loading")));
        return panel;
    }

    // ── Empty (web: !hasAny → "No pedal telemetry received yet") ────────────────────────────────────────────
    private TsFadeIn BuildEmpty()
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(showChip: false));
        stack.Children.Add(new TsEmptyState { IconGlyph = PedalStatusGlyph, Message = _viewModel.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError()
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(showChip: false));

        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("dynamics.pedalError", "Couldn't load pedal telemetry"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnErrorRetry;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static ChartRole AccentRole(PedalGaugeAccent accent) => accent switch
    {
        // Token colours match the web hexes exactly: Regen #06B6D4 (web throttle #06b6d4),
        // Temperature #EF4444 (web brake #ef4444).
        PedalGaugeAccent.Cyan => ChartRole.Regen,
        PedalGaugeAccent.Red => ChartRole.Temperature,
        _ => ChartRole.None,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PedalUsageAutomationPeer(this);

    private sealed class PedalUsageAutomationPeer(PedalUsage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((PedalUsage)Owner).ViewModel.SurfaceName : name;
        }
    }
}
