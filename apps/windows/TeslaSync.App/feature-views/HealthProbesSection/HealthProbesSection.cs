using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Health Probes Section surface — a parity port of
/// web/src/features/system/components/status/HealthProbesSection.tsx. It renders the liveness / readiness
/// disclosure: the shared <see cref="AccordionSection"/> (the web <c>AccordionSection</c> — a HeartPulse glyph,
/// the "Health Probes" title and the "Liveness and readiness checks" description, open by default) heading two
/// probe cards (Liveness — /healthz and Readiness — /readyz), each a <see cref="TsCard"/> with a titled header,
/// a status badge and a <see cref="TsKVList"/> of metrics. The two header dot badges (Live / Ready) plus a
/// freshness chip ride in the accordion header. Every state renders — a loading skeleton pair, the populated
/// cards, a friendly empty surface when the health body is absent, an explicit retry surface on hard failure,
/// plus stale and offline freshness affordances. All data flows through the shared
/// <see cref="HealthProbesSectionViewModel"/>; the view never performs HTTP. Every label resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class HealthProbesSection : ContentControl, IDisposable
{
    // Segoe Fluent — Health (web lucide HeartPulse), matching the sibling /system/health Uptime Monitor surface.
    private const string HealthGlyph = "\uE95E";

    private const int LoadingSkeletonCards = 2;
    private const double SkeletonCardHeight = 144;   // web Skeleton h-36 (9rem)
    private const double CardSpacing = 12;           // web gap-4 within a card / between cards
    private const double NarrowBreakpoint = 540;     // web Grid cols={{ default: 1, md: 2 }}

    private readonly HealthProbesSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly HealthProbesSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly AccordionSection _accordion;
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network system-health source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The wall clock (overridable in tests).</param>
    public HealthProbesSection(
        IHealthProbesSectionSource source,
        ILocalizer localizer,
        HealthProbesSectionDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new HealthProbesSectionDiagnostics();
        _viewModel = new HealthProbesSectionViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The web wraps the whole section in <AccordionSection> (a GlassPanel disclosure); reuse the native
        // port so the chevron, hover, divider, fade-in and Narrator expanded-state come for free. Its own
        // diagnostics stay silent (default null sink) so only this surface's view.opened reaches the sink.
        var model = new AccordionSectionModel(
            Title: _viewModel.Title,
            Description: _viewModel.Description,
            IconGlyph: HealthGlyph,
            DefaultOpen: true);
        _accordion = new AccordionSection(localizer, model);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.Title);

        Content = _accordion;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>health-probes-section</c>).</summary>
    public static string SurfaceId => HealthProbesSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public HealthProbesSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="HealthProbesSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static HealthProbesSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        HealthProbesSectionDiagnostics? diagnostics = null)
    {
        var source = new HealthProbesSectionSource(api, engine, options);
        return new HealthProbesSection(source, localizer, diagnostics);
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
        // Re-flow the responsive card grid when the available width crosses the breakpoint.
        if (e.PreviousSize.Width != e.NewSize.Width && IsCardState(_viewModel.State))
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
        // The accordion (glass panel + header) stays visible in every state (web parity: the AccordionSection is
        // always rendered); only the badge row and the disclosed body swap between the surfaces.
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _accordion.Badges = BuildBadges();
        _accordion.Body = BuildBody();
    }

    private List<UIElement> BuildBadges()
    {
        var badges = new List<UIElement>(3);

        // Web parity: the Live / Ready status badges ride in the header only once a health body is present.
        if (_viewModel.HasData)
        {
            var display = _viewModel.Display;
            badges.Add(StatusBadge(display.LiveBadgeText, display.LiveBadgeStatus, dot: true));
            badges.Add(StatusBadge(display.ReadyBadgeText, display.ReadyBadgeStatus, dot: true));
        }

        // The freshness chip is the native-mandated stale / offline / refreshing / error affordance.
        badges.Add(_freshness);
        return badges;
    }

    private UIElement BuildBody() => _viewModel.State switch
    {
        HealthProbesState.Loading => BuildLoading(),
        HealthProbesState.Error => BuildError(),
        HealthProbesState.Empty => BuildEmpty(),
        _ => BuildCards(_viewModel.Display),
    };

    // ── Cards ────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildCards(HealthProbesDisplay display)
    {
        var grid = BuildResponsiveGrid(LoadingSkeletonCards);
        AddToCell(grid, BuildCard(display.Liveness), 0);
        AddToCell(grid, BuildCard(display.Readiness), 1);
        return grid;
    }

    private static TsCard BuildCard(HealthProbeCard card)
    {
        var content = new StackPanel { Spacing = CardSpacing };

        // web CardHeader: a title on the left and the status Badge as the right-aligned action.
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new PanelTitle { Value = card.Title, VerticalAlignment = VerticalAlignment.Center };
        var statusBadge = StatusBadge(card.StatusText, card.StatusKind, dot: false);
        statusBadge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(title, 0);
        Grid.SetColumn(statusBadge, 1);
        header.Children.Add(title);
        header.Children.Add(statusBadge);
        content.Children.Add(header);

        var items = new List<TsKeyValue>(card.Rows.Count);
        foreach (var row in card.Rows)
        {
            items.Add(new TsKeyValue(row.Label, row.Value));
        }

        content.Children.Add(new TsKVList { Items = items });

        var tsCard = new TsCard
        {
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(tsCard, card.AutomationName);
        return tsCard;
    }

    private static TsBadge StatusBadge(string text, TeslaSync.App.Core.StatusKind status, bool dot) => new()
    {
        Status = status,
        Dot = dot,
        Content = text,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── State bodies ───────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        var grid = BuildResponsiveGrid(LoadingSkeletonCards);
        for (int i = 0; i < LoadingSkeletonCards; i++)
        {
            AddToCell(grid, new TsSkeleton { BlockHeight = SkeletonCardHeight }, i);
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
                ?? _localizer.GetString("healthProbes.error", "Couldn't load health probes"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Layout helpers ─────────────────────────────────────────────────────────────────────────────

    private Grid BuildResponsiveGrid(int cellCount)
    {
        int columns = ColumnsForWidth(ActualWidth);
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(cellCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private static void AddToCell(Grid grid, FrameworkElement element, int index)
    {
        int columns = Math.Max(1, grid.ColumnDefinitions.Count);
        Grid.SetColumn(element, index % columns);
        Grid.SetRow(element, index / columns);
        grid.Children.Add(element);
    }

    private static int ColumnsForWidth(double width) => width is > 0 and < NarrowBreakpoint ? 1 : 2;

    private static bool IsCardState(HealthProbesState state) =>
        state is HealthProbesState.Loaded or HealthProbesState.Stale or HealthProbesState.Offline;

    protected override AutomationPeer OnCreateAutomationPeer() => new HealthProbesSectionAutomationPeer(this);

    private sealed class HealthProbesSectionAutomationPeer(HealthProbesSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((HealthProbesSection)Owner).ViewModel.Title
                : name;
        }
    }
}
