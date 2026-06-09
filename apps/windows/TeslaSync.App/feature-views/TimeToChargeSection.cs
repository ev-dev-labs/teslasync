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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Time-to-Charge surface — a parity port of
/// web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx. It renders the section title
/// ("Time-to-Charge Analysis"), the description, and the four metric cards the web lays out in its 2/4-column
/// grid: the 10%→80% and 20%→80% average durations (minutes) and the fastest / slowest charge sessions
/// (kWh/h, each captioned with its session id). A null metric renders an em-dash (web <c>value ?? '—'</c>).
/// The web component is a pure child of the Charging-Curve page; the native feature-view owns its own
/// cache-then-network read of the charging-sessions list, so it renders every state the P2 contract mandates
/// — the card skeletons while loading, a friendly empty surface when there are no sessions, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips over the cards otherwise. All data flows
/// through the shared <see cref="TimeToChargeSectionViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade (web <c>useTranslation</c>) and every interactive element carries a
/// Narrator name. The whole surface fades in on load (web <c>FadeIn delay=0.25</c>), honouring reduce-motion.
/// </summary>
public sealed partial class TimeToChargeSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeInDelayMs = 250;         // web FadeIn delay={0.25}
    private const int CardCount = 4;
    private const double CardSkeletonHeight = 96;
    private const double TwoColumnBreakpoint = 700; // below → 2 columns (web grid-cols-2), at/above → 4 (lg:grid-cols-4)
    private const double ValueFontSize = 24;        // web text-2xl
    private const double UnitFontSize = 14;         // web text-sm

    private readonly TimeToChargeSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TimeToChargeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly Grid _header = new();
    private readonly SectionTitle _title = new();
    private readonly TextBlock _description = new()
    {
        TextWrapping = TextWrapping.Wrap,
        FontSize = 14,
        Foreground = DisplayTokens.TextSecondary,
    };
    private readonly StackPanel _headerActions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics/clock.</summary>
    public TimeToChargeSection(
        ITimeToChargeSource source,
        ILocalizer localizer,
        TimeToChargeDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TimeToChargeDiagnostics();
        _viewModel = new TimeToChargeSectionViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        Content = new TsFadeIn { DelayMs = FadeInDelayMs, Content = _root };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>time-to-charge-section</c>).</summary>
    public static string SurfaceId => TimeToChargeRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TimeToChargeSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TimeToChargeSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), optionally scoped to one vehicle.
    /// </summary>
    public static TimeToChargeSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TimeToChargeDiagnostics? diagnostics = null,
        long? vehicleId = null)
    {
        var source = new TimeToChargeSectionSource(api, engine, options, vehicleId);
        return new TimeToChargeSection(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _title.Value = _viewModel.Title;
        _description.Text = _localizer.GetString(
            "charging.curve.timeToChargeDesc",
            "How long DC sessions take to reach key SOC thresholds");

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_headerActions, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_headerActions);

        _root.Children.Add(_header);
        _root.Children.Add(_description);
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
        var display = _viewModel.Display;
        _title.Value = display.Title;
        _description.Text = display.Description;
        AutomationProperties.SetName(this, display.Title);

        switch (_viewModel.State)
        {
            case TimeToChargeState.Loading:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildLoading();
                break;

            case TimeToChargeState.Error:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildError();
                break;

            case TimeToChargeState.Empty:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildEmpty();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildCards(display);
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private void UpdateHeader()
    {
        _headerActions.Visibility = Visibility.Visible;
        _headerActions.Children.Clear();

        if (_viewModel.State is TimeToChargeState.Stale or TimeToChargeState.Offline)
        {
            _headerActions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == TimeToChargeState.Offline;
        _headerActions.Children.Add(_freshness);

        _headerActions.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(TimeToChargeState state)
    {
        bool offline = state == TimeToChargeState.Offline;
        string text = offline
            ? _localizer.GetString("charging.curve.offlineChip", "Offline")
            : _localizer.GetString("charging.curve.staleChip", "Stale");

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
        };
        AutomationProperties.SetName(button, _localizer.GetString("charging.curve.refresh", "Refresh time-to-charge analysis"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Cards ─────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildCards(TimeToChargeDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
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

        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    private static TsGlassPanel BuildCard(TimeToChargeCardModel card)
    {
        var label = new Label
        {
            Value = CultureInfo.CurrentCulture.TextInfo.ToUpper(card.Label),
        };

        var value = new TextBlock
        {
            Text = card.Value,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        valueRow.Children.Add(value);

        if (!string.IsNullOrEmpty(card.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = card.Unit,
                FontSize = UnitFontSize,
                Foreground = DisplayTokens.TextSecondary,
                Margin = new Thickness(0, 0, 0, 2),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(label);
        column.Children.Add(valueRow);

        if (!string.IsNullOrEmpty(card.Subtitle))
        {
            column.Children.Add(new Caption { Value = card.Subtitle });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

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
        <= 0 => CardCount,
        < TwoColumnBreakpoint => 2,
        _ => CardCount,
    };

    private static bool IsCardState(TimeToChargeState state) =>
        state is TimeToChargeState.Loaded or TimeToChargeState.Stale or TimeToChargeState.Offline;

    // ── State bodies ──────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(CardCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < CardCount; i++)
        {
            var tile = new TsSkeleton { BlockHeight = CardSkeletonHeight };
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
            Title = _viewModel.Title,
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("charging.curve.timeToChargeError", "Couldn't load time-to-charge analysis"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            Title = _viewModel.Title,
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, _viewModel.EmptyMessage);
        return empty;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new TimeToChargeSectionAutomationPeer(this);

    private sealed class TimeToChargeSectionAutomationPeer(TimeToChargeSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TimeToChargeSection)Owner).ViewModel.Title
                : name;
        }
    }
}
