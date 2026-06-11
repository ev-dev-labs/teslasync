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
/// Carries the in-app route the <see cref="VehicleHeader"/> back affordance requests navigation to, so the host
/// can route it (the native analogue of the web header's <c>&lt;Link to="/vehicles"&gt;</c>).
/// </summary>
/// <param name="route">The in-app route to navigate to (e.g. <c>/vehicles</c>).</param>
public sealed class VehicleHeaderNavigationEventArgs(string route) : EventArgs
{
    /// <summary>The in-app route the host should navigate to.</summary>
    public string Route { get; } = route;
}

/// <summary>
/// The native WinUI 3 vehicle-header surface — a parity port of
/// web/src/features/vehicles/components/VehicleHeader.tsx. It renders the web's always-visible header row: a
/// back affordance (web <c>&lt;Link to="/vehicles"&gt;</c>), the vehicle title (web
/// <c>display_name || vin || t('common.vehicle')</c>) beside the live status badge (web
/// <c>getVehicleStatus(state)</c>), the model/trim/VIN subtitle, and the Wake Up button (web
/// <c>useWakeVehicle</c>) that shows a busy ring while the command is in flight and, on success, refetches the
/// vehicle state after a settle window. Every state renders — the loading skeleton bar, the retry surface on
/// hard failure, the friendly empty header when no vehicle resolves, and stale / offline freshness chips over
/// the bar. All data flows through the shared <see cref="VehicleHeaderViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class VehicleHeader : ContentControl, IDisposable
{
    private const string BackGlyph = "\uE72B";    // Segoe Fluent — Back (web ArrowLeft)
    private const string PowerGlyph = "\uE7E8";   // Segoe Fluent — Power (web Power)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string VehiclesRoute = "/vehicles";
    private const int FadeDelayMs = 50;
    private const double BarSpacing = 16;          // web flex gap-4
    private const double TitleSpacing = 10;        // web gap-3 between title and status badge
    private const double TitleFontSize = 26;

    private readonly VehicleHeaderViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleHeaderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsFadeIn _body = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network header source plus wake mutation.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleHeader(
        IVehicleHeaderSource source,
        ILocalizer localizer,
        VehicleHeaderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleHeaderDiagnostics();
        _viewModel = new VehicleHeaderViewModel(source, localizer, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the back affordance is invoked; the host navigates to <see cref="VehicleHeaderNavigationEventArgs.Route"/>.</summary>
    public event EventHandler<VehicleHeaderNavigationEventArgs>? NavigationRequested;

    /// <summary>The canonical surface id (<c>vehicle-header</c>).</summary>
    public static string SurfaceId => VehicleHeaderRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public VehicleHeaderViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleHeaderSource"/> from the shared
    /// data layer (the page host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="vehicleId">An explicit vehicle id, or null for the primary roster vehicle.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static VehicleHeader Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        VehicleHeaderDiagnostics? diagnostics = null)
    {
        var source = new VehicleHeaderSource(api, engine, options, vehicleId);
        return new VehicleHeader(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        Grid.SetRow(_header, 0);
        Grid.SetRow(_body, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_body);
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
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case VehicleHeaderState.Loading:
                Content = BuildLoading();
                break;

            case VehicleHeaderState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _body.Content = BuildBar(display);
                Content = _root;
                break;
        }
    }

    // ── Header (stale/offline chip + freshness + refresh) ────────────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is VehicleHeaderState.Stale or VehicleHeaderState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == VehicleHeaderState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(VehicleHeaderState state)
    {
        bool offline = state == VehicleHeaderState.Offline;
        string text = offline
            ? VehicleHeaderRegistration.OfflineLabel(_localizer)
            : VehicleHeaderRegistration.StaleLabel(_localizer);

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
        AutomationProperties.SetName(button, VehicleHeaderRegistration.RefreshLabel(_localizer));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Header bar (back + title/status/subtitle + wake) ─────────────────────────────────────────────

    private StackPanel BuildBar(VehicleHeaderDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };

        var bar = new Grid { ColumnSpacing = BarSpacing, VerticalAlignment = VerticalAlignment.Center };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var back = BuildBackButton();
        Grid.SetColumn(back, 0);
        bar.Children.Add(back);

        var titleBlock = BuildTitleBlock(display);
        Grid.SetColumn(titleBlock, 1);
        bar.Children.Add(titleBlock);

        var wake = BuildWakeButton();
        Grid.SetColumn(wake, 2);
        bar.Children.Add(wake);

        column.Children.Add(bar);

        // Web parity: the wake mutation surfaces a toast. The native superset shows the same copy inline and
        // announces it so Narrator users hear the wake result.
        if (_viewModel.WakeStatusMessage is { Length: > 0 } wakeMessage)
        {
            column.Children.Add(BuildWakeStatus(wakeMessage, _viewModel.WakeFailed));
        }

        // The empty header still renders the bar; a friendly hint sits beneath it rather than a blank box.
        if (!display.HasVehicle)
        {
            var hint = new Caption { Value = _viewModel.EmptyMessage, HorizontalAlignment = HorizontalAlignment.Left };
            AutomationProperties.SetName(hint, _viewModel.EmptyMessage);
            column.Children.Add(hint);
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private TsButton BuildBackButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = BackGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.BackLabel);
        button.Click += OnBackClick;
        return button;
    }

    private static StackPanel BuildTitleBlock(VehicleHeaderDisplay display)
    {
        var column = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(new TextBlock
        {
            Text = display.Name,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new TsStatusBadge
        {
            Status = display.Status,
            AccentBrushKey = display.StatusAccentKey,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(titleRow);

        if (!string.IsNullOrWhiteSpace(display.Subtitle))
        {
            column.Children.Add(new Caption
            {
                Value = display.Subtitle,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        return column;
    }

    private TsButton BuildWakeButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Primary,
            IconGlyph = PowerGlyph,
            Text = _viewModel.WakeLabel,
            IsLoading = _viewModel.IsWaking,
            IsEnabled = _viewModel.WakeButtonEnabled,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.WakeLabel);
        button.Click += OnWakeClick;
        return button;
    }

    private static TextBlock BuildWakeStatus(string message, bool failed)
    {
        var text = new TextBlock
        {
            Text = message,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.Brush(
                StatusResources.AccentBrushKey(failed ? StatusKind.Danger : StatusKind.Success)),
        };
        LiveRegion.Configure(text);
        LiveRegion.Announce(text);
        AutomationProperties.SetName(text, message);
        return text;
    }

    private void OnBackClick(object sender, RoutedEventArgs e) =>
        NavigationRequested?.Invoke(this, new VehicleHeaderNavigationEventArgs(VehiclesRoute));

    private void OnWakeClick(object sender, RoutedEventArgs e) => _ = _viewModel.WakeAsync();

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var bar = new Grid { ColumnSpacing = BarSpacing, VerticalAlignment = VerticalAlignment.Center };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var back = new TsSkeleton { BlockWidth = 32, BlockHeight = 32, Radius = 8, ReduceMotion = MotionPreference.ReduceMotion };
        Grid.SetColumn(back, 0);
        bar.Children.Add(back);

        var titleColumn = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 26, Radius = 8, ReduceMotion = MotionPreference.ReduceMotion });
        titleColumn.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 14, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });
        Grid.SetColumn(titleColumn, 1);
        bar.Children.Add(titleColumn);

        var wake = new TsSkeleton { BlockWidth = 110, BlockHeight = 40, Radius = 10, ReduceMotion = MotionPreference.ReduceMotion };
        Grid.SetColumn(wake, 2);
        bar.Children.Add(wake);

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(bar);

        AutomationProperties.SetName(column, VehicleHeaderRegistration.LoadingLabel(_localizer));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? VehicleHeaderRegistration.LoadErrorMessage(_localizer),
            ActionText = VehicleHeaderRegistration.RetryLabel(_localizer),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleHeaderAutomationPeer(this);

    private sealed class VehicleHeaderAutomationPeer(VehicleHeader owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Header;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((VehicleHeader)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
