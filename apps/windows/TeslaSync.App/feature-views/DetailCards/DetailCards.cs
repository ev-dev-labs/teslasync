using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Detail Cards surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/DetailCards.tsx. It renders the web's entrance-faded
/// pair of glass cards in a responsive one- / two-column grid (web <c>Grid cols={{ default: 1, md: 2 }}</c>):
/// a "Temperature Details" card whose <see cref="TsKVList"/> lists the front-motor, rear-motor, inverter and
/// battery temperatures (each converted to the user's unit at the render boundary — web <c>useUnits</c> —
/// with the em-dash for a missing sensor), and a "Power Summary" card whose list shows the recent-drive Peak
/// Power, Avg Peak Power and Max Regen figures plus the lifetime Total Regen (kWh) and CO₂ Saved rows. Every
/// label resolves through the i18n facade (web <c>useTranslation</c>). Every state renders — a loading
/// skeleton, the populated cards (entrance-faded, the native mapping of the web <c>FadeIn</c>), a friendly
/// empty surface when there is no drivetrain-health snapshot, an explicit retry surface on hard failure, plus
/// stale and offline freshness chips with a refresh affordance. All data flows through the shared
/// <see cref="DetailCardsViewModel"/>; the view never performs HTTP. Every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class DetailCards : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double HeaderBottomPadding = 8;
    private const double GridGap = 16;             // web gap-4
    private const double CardSpacing = 8;          // header ↔ list inside a card
    private const double ChipFontSize = 12;
    private const double MediumBreakpoint = 720;   // web md (1 → 2 columns)
    private const int LoadingSkeletonCards = 2;
    private const int LoadingSkeletonRows = 4;
    private const double TitleSkeletonWidth = 140;
    private const double TitleSkeletonHeight = 18;
    private const double RowSkeletonHeight = 14;
    private const double SkeletonRadius = 6;
    private const double CardSkeletonSpacing = 10;
    private const double CardSkeletonPadding = 16;

    private readonly DetailCardsViewModel _viewModel;
    private readonly DetailCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network drivetrain detail source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public DetailCards(
        IDetailCardsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        DetailCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new DetailCardsDiagnostics();
        _viewModel = new DetailCardsViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>detail-cards</c>).</summary>
    public static string SurfaceId => DetailCardsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DetailCardsViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the rows in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DetailCardsSource"/> from the shared
    /// data layer (the host's P2-core dependencies), scoping the reads to the primary (or explicit) vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="clock">The clock the Power-Summary window is derived from; defaults to now.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static DetailCards Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        Func<DateTimeOffset>? clock = null,
        DetailCardsDiagnostics? diagnostics = null)
    {
        var source = new DetailCardsSource(vehicles, api, engine, options, vehicleId, clock);
        return new DetailCards(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web pair is headerless; the native superset adds a single right-aligned freshness chip + refresh
        // control so the mandated stale / offline / refreshing states have a visible affordance.
        _freshnessChip.Content = _freshnessChipText;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
        _refresh.Click += OnRefreshClick;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.Padding = new Thickness(0, 0, 0, HeaderBottomPadding);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_actions);

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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // Re-flow the responsive grid when the available width crosses the breakpoint.
        if (e.PreviousSize.Width != e.NewSize.Width && IsGridState(_viewModel.State))
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
        _refresh.Click -= OnRefreshClick;
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
        AutomationProperties.SetName(this, _viewModel.Title);

        switch (_viewModel.State)
        {
            case DetailCardsState.Loading:
                Content = BuildLoading();
                break;

            case DetailCardsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        var state = _viewModel.State;
        bool stale = state == DetailCardsState.Stale;
        bool offline = state == DetailCardsState.Offline;

        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_freshness, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody()
    {
        if (!_viewModel.HasData)
        {
            return BuildEmpty();
        }

        // Map the web FadeIn entrance to a single section-level fade-in that honours reduce-motion while
        // preserving the responsive card layout.
        return new TsFadeIn { Content = BuildGrid(_viewModel.Display) };
    }

    private Grid BuildGrid(DetailCardsDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var card = BuildCard(display.Cards[i]);
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static TsCard BuildCard(DetailCardsCard card)
    {
        var content = new StackPanel { Spacing = CardSpacing };
        content.Children.Add(new TsCardHeader { Content = new PanelTitle { Value = card.Title } });

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

    private Grid BuildLoading()
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid
        {
            ColumnSpacing = GridGap,
            RowSpacing = GridGap,
            Padding = new Thickness(0, 4, 0, 4),
        };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(LoadingSkeletonCards / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < LoadingSkeletonCards; i++)
        {
            var card = BuildSkeletonCard();
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsCard BuildSkeletonCard()
    {
        var content = new StackPanel { Spacing = CardSkeletonSpacing };
        content.Children.Add(new TsSkeleton
        {
            BlockWidth = TitleSkeletonWidth,
            BlockHeight = TitleSkeletonHeight,
            Radius = SkeletonRadius,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        for (int i = 0; i < LoadingSkeletonRows; i++)
        {
            content.Children.Add(new TsSkeleton
            {
                BlockHeight = RowSkeletonHeight,
                Radius = SkeletonRadius,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        return new TsCard
        {
            Content = new Border { Padding = new Thickness(CardSkeletonPadding), Child = content },
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DetailCardsProjection.ThermometerGlyph,
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        // web: grid-cols-1 md:grid-cols-2.
        <= 0 => 2,
        < MediumBreakpoint => 1,
        _ => 2,
    };

    private static bool IsGridState(DetailCardsState state) =>
        state is DetailCardsState.Loaded or DetailCardsState.Stale or DetailCardsState.Offline or DetailCardsState.Loading;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DetailCardsAutomationPeer(this);

    private sealed class DetailCardsAutomationPeer(DetailCards owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DetailCards)Owner).ViewModel.Title
                : name;
        }
    }
}
