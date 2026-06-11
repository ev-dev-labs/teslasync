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
/// The native WinUI 3 Vehicle-Detail powertrain feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx. It reproduces the web
/// <c>GlassPanel</c> chrome (the gear glyph + "Powertrain" title) wrapping a responsive grid of eight
/// <c>MetricCard</c>s — Shift State, Pack Voltage, Motor Current (F), Front / Rear Torque, Front / Rear RPM and
/// the peak Motor Temp — each formatted, unit-converted and em-dash-guarded exactly like the web. The web
/// component is a pure child of the Vehicle-Detail page that draws a friendly "No motor data available" empty
/// state when its <c>motorData</c> prop is null/undefined; the native feature-view owns its own cache-then-network
/// <c>/motor/latest</c> read and therefore renders every state the P2 contract mandates — a loading skeleton, the
/// populated card grid, a friendly empty surface, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. All data flows through the shared <see cref="MotorSectionViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name.
/// </summary>
public sealed partial class MotorSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent — Refresh
    private const string HeaderGlyph = "\uE713";        // Segoe Fluent — Setting (web Cog, the Powertrain mark)
    private const string EmptyGlyph = "\uE713";         // Same gear mark on the empty surface
    private const string HeaderAccentBrushKey = "TsColorInfoBrush"; // cyan, web text-[var(--neon-cyan)]
    private const double SkeletonHeight = 132;          // two card rows of skeleton chrome
    private const double FadeInDelayMs = 300;
    private const double ChipFontSize = 12;
    private const double HeaderIconSize = 16;           // web h-4 w-4
    private const double HeaderGap = 8;                 // web gap-2
    private const double BodyGap = 16;                  // web mb-4 (header → body)
    private const double CardGap = 12;                  // web gap-3
    private const int GridColumns = 4;                  // web lg:grid-cols-4

    private readonly MotorSectionViewModel _viewModel;
    private readonly MotorSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = BodyGap };
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = HeaderGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _headerIcon = new()
    {
        Glyph = HeaderGlyph,
        FontSize = HeaderIconSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
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
    /// <param name="source">The cache-then-network motor source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public MotorSection(
        IMotorSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        MotorSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new MotorSectionDiagnostics();
        _viewModel = new MotorSectionViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>motor-section</c>).</summary>
    public static string SurfaceId => MotorSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public MotorSectionViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the peak temperature in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MotorSectionSource"/> from the shared data
    /// layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> (the Vehicle-Detail route)
    /// or, when null, the primary vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static MotorSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        MotorSectionDiagnostics? diagnostics = null)
    {
        var source = new MotorSectionSource(vehicles, api, engine, options, vehicleId);
        return new MotorSection(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _headerIcon.Foreground = DisplayTokens.Brush(HeaderAccentBrushKey);
        AutomationProperties.SetAccessibilityView(_headerIcon, AccessibilityView.Raw);

        _titleRow.Children.Add(_headerIcon);
        _titleRow.Children.Add(_title);

        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(_actions);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(24); // web p-6
        _panel.Content = _root;
        _fade.Content = _panel;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
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
        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);

        UpdateFreshness(_viewModel.State);
        _bodyHost.Child = BuildBody(_viewModel.State);
    }

    private void UpdateFreshness(MotorSectionState state)
    {
        bool showActions = state is not (MotorSectionState.Loading or MotorSectionState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == MotorSectionState.Stale;
        bool offline = state == MotorSectionState.Offline;
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
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(MotorSectionState state) => state switch
    {
        MotorSectionState.Loading => BuildLoading(),
        MotorSectionState.Error => BuildError(),
        MotorSectionState.Empty => BuildEmpty(),
        _ => _viewModel.Display is { } display ? BuildContent(display) : BuildEmpty(),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = CardGap };
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        return stack;
    }

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

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private Grid BuildContent(MotorSectionDisplay display)
    {
        var cards = display.Cards;
        var grid = new Grid { ColumnSpacing = CardGap, RowSpacing = CardGap };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(cards.Count / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cards.Count; i++)
        {
            var card = BuildCard(cards[i]);
            Grid.SetColumn(card, i % GridColumns);
            Grid.SetRow(card, i / GridColumns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static TsMetricCard BuildCard(MotorSectionCard card)
    {
        var tile = new TsMetricCard
        {
            Label = card.Label,
            Value = card.ValueText,
            AccentBrushKey = card.AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MotorSectionAutomationPeer(this);

    private sealed class MotorSectionAutomationPeer(MotorSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((MotorSection)Owner).ViewModel.Title
                : name;
        }
    }
}
