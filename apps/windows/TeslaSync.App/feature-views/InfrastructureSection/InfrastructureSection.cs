using Microsoft.UI.Dispatching;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Infrastructure Section surface — a parity port of
/// web/src/features/system/components/status/InfrastructureSection.tsx. It composes the shared
/// <see cref="AccordionSection"/> disclosure (globe glyph, "Infrastructure" title, a muted description and a
/// Connected/Disconnected header badge) around two diagnostic cards — "SSE Connection" and "Polling Engine",
/// each a <see cref="TsCard"/> with a <see cref="TsCardHeader"/> and a <see cref="TsKVList"/> — plus an optional
/// three-up <see cref="TsInlineMetric"/> row for the database-pool counts (shown only when the extended-health
/// body reported them, web parity). Every state renders: a loading skeleton, the populated cards (with a per-row
/// em-dash for any absent field, web parity), a disconnected empty surface (em-dash cards) for the empty state, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="InfrastructureSectionViewModel"/>; the view never performs HTTP. Every interactive element carries
/// a Narrator name.
/// </summary>
public sealed partial class InfrastructureSection : ContentControl, IDisposable
{
    private const double HeaderIconSize = 16;        // web icon h-4 w-4
    private const double CardSpacing = 16;            // web Grid gap-4
    private const double MetricSpacing = 12;          // web Grid gap-3
    private const double BodySpacing = 16;            // web body space-y-4
    private const double CardHeaderActionSpacing = 8;
    private const double TwoColumnBreakpoint = 520;   // web Grid md:grid-cols-2
    private const int LoadingSkeletonTiles = 2;
    private const int MetricColumns = 3;              // web Grid grid-cols-3

    private const string GlobeGlyph = "\uE774";       // section icon (web lucide Globe)
    private const string WifiGlyph = "\uE701";        // SSE card action (web lucide Wifi / WifiOff)

    private readonly InfrastructureSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly InfrastructureSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly AccordionSection _accordion;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private double _lastWidth = -1;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InfrastructureSection(
        IInfrastructureSectionSource source,
        ILocalizer localizer,
        InfrastructureSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new InfrastructureSectionDiagnostics();
        _viewModel = new InfrastructureSectionViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.Title);

        // The web wraps the section in the shared AccordionSection disclosure; reuse the native counterpart as
        // chrome and swap its revealed body / header badges as the view-model state changes.
        var model = new AccordionSectionModel(
            Title: _viewModel.Title,
            Description: _viewModel.Description,
            IconGlyph: GlobeGlyph,
            DefaultOpen: false);
        _accordion = new AccordionSection(localizer, model);
        Content = _accordion;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>infrastructure-section</c>).</summary>
    public static string SurfaceId => InfrastructureSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public InfrastructureSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="InfrastructureSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static InfrastructureSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        InfrastructureSectionDiagnostics? diagnostics = null)
    {
        var source = new InfrastructureSectionSource(api, engine, options);
        return new InfrastructureSection(source, localizer, diagnostics);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // Re-flow the responsive card grid when the available width crosses the one/two-column breakpoint.
        if (e.PreviousSize.Width == e.NewSize.Width)
        {
            return;
        }

        bool crossed = ColumnsForWidth(e.PreviousSize.Width) != ColumnsForWidth(e.NewSize.Width);
        if (crossed && IsContentState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
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
        // The accordion disclosure + its header stay visible in every state (web parity: the GlassPanel header
        // is always rendered). Only the header badges and the revealed body swap with the view-model state.
        _lastWidth = ActualWidth;
        _accordion.Badges = BuildBadges();
        _accordion.Body = BuildBody();
    }

    // ── Header badges (web AccordionSection `badges` slot + native freshness chip) ──────────────────────

    private UIElement[] BuildBadges()
    {
        var display = _viewModel.Display;

        // Web: <Badge variant={sseConnected ? 'success' : 'warning'} size="sm" dot>{Connected/Disconnected}</Badge>
        var connection = new TsBadge
        {
            Status = display.Connected ? StatusKind.Success : StatusKind.Warning,
            Dot = true,
            Content = display.ConnectionStatusText,
        };
        AutomationProperties.SetName(connection, display.ConnectionStatusText);

        // Native superset: a freshness chip so the mandated stale / offline / refreshing states have a visible
        // affordance in the always-visible header.
        var freshness = new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new UIElement[] { connection, freshness };
    }

    // ── Body (loading / error / content) ────────────────────────────────────────────────────────────────

    private UIElement BuildBody() => _viewModel.State switch
    {
        InfrastructureState.Loading => BuildLoading(),
        InfrastructureState.Error => BuildError(),
        _ => BuildContent(),
    };

    private StackPanel BuildContent()
    {
        var display = _viewModel.Display;
        var stack = new StackPanel { Spacing = BodySpacing };

        stack.Children.Add(BuildCardsGrid(display));

        // Web: {extHealth?.database_pool && (<Grid cols={{ default: 3 }}>…</Grid>)} — only when pool reported.
        if (display.Metrics is { Count: > 0 } metrics)
        {
            stack.Children.Add(BuildMetrics(metrics));
        }

        return stack;
    }

    private Grid BuildCardsGrid(InfrastructureDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var cards = new FrameworkElement[]
        {
            BuildCard(_viewModel.SseConnectionTitle, BuildSseAction(display), display.SseRows),
            BuildCard(_viewModel.PollingEngineTitle, BuildPollingAction(display), display.PollingRows),
        };

        int rows = (int)Math.Ceiling(cards.Length / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cards.Length; i++)
        {
            Grid.SetColumn(cards[i], i % columns);
            Grid.SetRow(cards[i], i / columns);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private static TsCard BuildCard(string title, FrameworkElement action, IReadOnlyList<InfrastructureRow> rows)
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(new TsCardHeader { Content = BuildCardHeaderContent(title, action) });
        body.Children.Add(new TsKVList { Items = ToKeyValues(rows) });

        var card = new TsCard { Content = body };
        AutomationProperties.SetName(card, title);
        return card;
    }

    private static Grid BuildCardHeaderContent(string title, FrameworkElement action)
    {
        // web CardHeader: a `title` on the left and an `action` node on the right.
        var grid = new Grid { ColumnSpacing = CardHeaderActionSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(action, 1);
        grid.Children.Add(heading);
        grid.Children.Add(action);
        return grid;
    }

    // Web SSE card action: <Wifi className="text-green-400"/> when connected, <WifiOff className="text-red-400"/>
    // otherwise. The colour is the only signal, so the glyph is decorative — the connection state is spoken by
    // the header badge and the "Connection State" row.
    private static FontIcon BuildSseAction(InfrastructureDisplay display)
    {
        var icon = new FontIcon
        {
            Glyph = WifiGlyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.Brush(
                StatusResources.AccentBrushKey(display.Connected ? StatusKind.Success : StatusKind.Danger)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    // Web Polling card action: <Badge variant={polling ? 'success' : 'neutral'}>{Active/Standby}</Badge>.
    private static TsBadge BuildPollingAction(InfrastructureDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.Polling ? StatusKind.Success : StatusKind.Neutral,
            Content = display.PollingStatusText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.PollingStatusText);
        return badge;
    }

    private static Grid BuildMetrics(IReadOnlyList<InfrastructureRow> metrics)
    {
        var grid = new Grid { ColumnSpacing = MetricSpacing };
        for (int c = 0; c < MetricColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < metrics.Count && i < MetricColumns; i++)
        {
            var metric = new TsInlineMetric { Label = metrics[i].Label, Value = metrics[i].Value };
            Grid.SetColumn(metric, i);
            grid.Children.Add(metric);
        }

        return grid;
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<InfrastructureRow> rows)
    {
        var items = new List<TsKeyValue>(rows.Count);
        foreach (var row in rows)
        {
            items.Add(new TsKeyValue(row.Label, row.Value));
        }

        return items;
    }

    // ── State bodies ────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(LoadingSkeletonTiles / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < LoadingSkeletonTiles; i++)
        {
            var tile = new TsStatSkeleton();
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("infrastructure.error", "Couldn't load infrastructure diagnostics"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private double AvailableWidth() => _lastWidth > 0 ? _lastWidth : ActualWidth;

    private static int ColumnsForWidth(double width) => width is > 0 and < TwoColumnBreakpoint ? 1 : 2;

    private static bool IsContentState(InfrastructureState state) =>
        state is InfrastructureState.Ready or InfrastructureState.Stale
            or InfrastructureState.Offline or InfrastructureState.Empty;

    protected override AutomationPeer OnCreateAutomationPeer() => new InfrastructureSectionAutomationPeer(this);

    private sealed class InfrastructureSectionAutomationPeer(InfrastructureSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((InfrastructureSection)Owner).ViewModel.Title : name;
        }
    }
}
