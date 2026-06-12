using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Components.Vehicles;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>VehicleTwin</c> shared surface — a parity port of
/// web/src/components/vehicles/VehicleTwin.tsx. It is the paint-aware digital-twin schematic the web app shows for
/// a vehicle: the door / window / lock / charge / lighting state drawn as a side-view car, tinted by the
/// per-vehicle paint (web <c>useVehiclePaint</c>: a manual override, else inferred from the Tesla
/// <c>exterior_color</c>, else Pearl White). The schematic itself is the atomic <see cref="TsVehicleTwin"/>
/// component (built by the component-library bundle); this surface owns the live binding around it — the
/// cache-then-network <see cref="VehicleTwinViewModel"/> driving the mutually-exclusive loading / loaded / empty /
/// error / stale / offline states (a skeleton while first loading, a friendly empty state when no vehicle
/// resolves, a retry affordance on a hard failure, a stale chip with an auto-refresh past the freshness window,
/// and an offline chip over the last-known twin). Every string resolves through the i18n facade, the surface
/// carries a composed Narrator description, and it emits the <c>view.opened</c> diagnostic once when shown. All
/// state flows through the view-model; the view performs no I/O.
/// </summary>
public sealed partial class VehicleTwin : ContentControl, IDisposable
{
    private const double HeaderSpacing = 8;
    private const double RootSpacing = 10;
    private const double SkeletonChromeHeight = 168;
    private const double SkeletonCaptionWidth = 160;

    private readonly VehicleTwinViewModel _viewModel;
    private readonly VehicleTwinDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = HeaderSpacing,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Grid _bodyHost = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsVehicleTwin _twin = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private bool _opened;
    private bool _renderQueued;
    private bool _staleRefreshRequested;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no bound seams (the designer / parameterless host entry point): it renders the
    /// empty state over an in-memory paint store and the passthrough localizer. Supply an explicit source,
    /// localizer and size via the other constructor to drive data, i18n and scale from the composition root.
    /// </summary>
    public VehicleTwin()
        : this(new StaticVehicleTwinSource(), new InMemoryVehiclePaintOverrideStore(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its data source, paint store, localizer, render scale and diagnostics.</summary>
    /// <param name="source">The cache-then-network twin source.</param>
    /// <param name="paintStore">The per-vehicle paint-override store (web <c>useVehiclePaint</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string (P1/S10).</param>
    /// <param name="size">The render scale (web <c>size</c>; default <see cref="VehicleTwinSize.Medium"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleTwin(
        IVehicleTwinSource source,
        IVehiclePaintOverrideStore paintStore,
        ILocalizer localizer,
        VehicleTwinSize size = VehicleTwinSize.Medium,
        VehicleTwinDiagnostics? diagnostics = null)
        : this(new VehicleTwinViewModel(source, paintStore, localizer, size), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleTwin(VehicleTwinViewModel viewModel, VehicleTwinDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new VehicleTwinDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        AutomationProperties.SetAutomationId(this, VehicleTwinRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(_twin, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>VehicleTwin</c>).</summary>
    public static string Slug => VehicleTwinRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehicleTwinViewModel ViewModel => _viewModel;

    /// <summary>The render scale; reassigning re-projects the twin at the new size.</summary>
    public VehicleTwinSize Size
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <inheritdoc />
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

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _root.RowSpacing = RootSpacing;

        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

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
        if (_viewModel.State is not VehicleTwinViewState.Stale)
        {
            _staleRefreshRequested = false;
        }

        switch (_viewModel.State)
        {
            case VehicleTwinViewState.Loading:
                _header.Children.Clear();
                SetBody(BuildLoading());
                AutomationProperties.SetName(this, _viewModel.LoadingMessage);
                break;

            case VehicleTwinViewState.Error:
                _header.Children.Clear();
                SetBody(BuildError());
                AutomationProperties.SetName(this, _viewModel.ErrorMessage ?? ErrorFallback());
                break;

            case VehicleTwinViewState.Empty:
                _header.Children.Clear();
                SetBody(BuildEmpty());
                AutomationProperties.SetName(this, _viewModel.EmptyTitle);
                break;

            default:
                UpdateHeader();
                ShowTwin();
                MaybeAutoRefresh();
                break;
        }
    }

    private void UpdateHeader()
    {
        _header.Children.Clear();

        TsBadge? chip = _viewModel.State switch
        {
            VehicleTwinViewState.Offline => StatusChip(_viewModel.OfflineLabel, StatusKind.Danger),
            VehicleTwinViewState.Stale => StatusChip(_viewModel.StaleLabel, StatusKind.Warning),
            _ when _viewModel.IsFetching => StatusChip(_viewModel.RefreshingLabel, StatusKind.Info),
            _ => null,
        };

        if (chip is not null)
        {
            _header.Children.Add(chip);
        }
    }

    private void ShowTwin()
    {
        if (_viewModel.Display is not { } display)
        {
            // No projected twin (defensive): fall back to the empty surface rather than a blank body.
            SetBody(BuildEmpty());
            AutomationProperties.SetName(this, _viewModel.EmptyTitle);
            return;
        }

        _twin.SetModel(display.Model);
        _twin.SetPaint(display.Paint);
        _twin.MaxWidth = VehicleTwinRegistration.Width(display.Size);

        SetBody(_twin);
        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void MaybeAutoRefresh()
    {
        // Web parity for the stale branch: a cached twin past the freshness window auto-refreshes once. The guard
        // (cleared whenever the state leaves Stale) keeps a persistently-stale source from looping.
        if (_viewModel.State is not VehicleTwinViewState.Stale || _staleRefreshRequested)
        {
            return;
        }

        _staleRefreshRequested = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => _ = _viewModel.RetryAsync());
        }
        else
        {
            _ = _viewModel.RetryAsync();
        }
    }

    private void SetBody(UIElement content)
    {
        _bodyHost.Children.Clear();
        _bodyHost.Children.Add(content);
    }

    private StackPanel BuildLoading()
    {
        double width = VehicleTwinRegistration.Width(_viewModel.Size);
        var column = new StackPanel
        {
            Spacing = HeaderSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton { BlockHeight = SkeletonChromeHeight, BlockWidth = width });
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = SkeletonCaptionWidth });

        AutomationProperties.SetName(column, _viewModel.LoadingMessage);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.EmptyTitle,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? ErrorFallback(),
            ActionText = _viewModel.RetryText,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static string ErrorFallback() => VehicleTwinRegistration.ErrorFallback;

    private static TsBadge StatusChip(string text, StatusKind status)
    {
        var chip = new TsBadge
        {
            Status = status,
            Dot = true,
            Content = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }
}
