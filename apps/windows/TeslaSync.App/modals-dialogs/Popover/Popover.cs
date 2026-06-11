using System.Numerics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.System;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>Popover</c> surface — a parity port of web/src/components/ui/Popover.tsx. It shows
/// <see cref="PopoverContent"/> in a light-dismiss, non-modal <see cref="Popup"/> positioned relative to an
/// <see cref="Anchor"/> element: the requested <see cref="Side"/> auto-flips when the content would overflow,
/// the content is aligned along the cross axis (<see cref="Align"/>) and clamped inside the viewport, exactly
/// as the web component's <c>compute()</c> positioner does (the math lives in the headless
/// <see cref="PopoverProjection"/>). Like the web primitive it is intentionally NOT a focus trap: pressing
/// <c>Escape</c> or pointing down outside dismisses it (light dismiss), and focus is restored to the anchor on
/// close. The web component performs no data read, so the surface has no loading / empty / error / stale /
/// offline state — its states are closed, open-but-unpositioned (hidden until measured) and open-and-positioned.
/// The view never holds business logic — it binds the shared <see cref="PopoverViewModel"/>; the accessible
/// region name resolves through the i18n facade and carries a Narrator label, and the surface adds no bespoke
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class Popover : ContentControl, IDisposable
{
    private readonly PopoverViewModel _viewModel;
    private readonly Popup _popup = new();
    private readonly Border _surface = new();
    private readonly ContentPresenter _presenter = new();

    private FrameworkElement? _anchor;
    private XamlRoot? _trackedRoot;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the surface over the i18n facade and an optional PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the accessible region label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public Popover(ILocalizer localizer, PopoverDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new PopoverViewModel(localizer, diagnostics);

        IsTabStop = false;
        AutomationProperties.SetAutomationId(this, "popover");

        BuildSurface();

        _popup.Child = _surface;
        _popup.IsLightDismissEnabled = true;
        _popup.LightDismissOverlayMode = LightDismissOverlayMode.Off;
        _popup.Closed += OnPopupClosed;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.Opened += OnViewModelOpened;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        _viewModel.FocusRestoreRequested += OnViewModelFocusRestoreRequested;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised once the popover has closed, carrying the dismiss cause (web <c>onClose</c>).</summary>
    public event EventHandler<PopoverDismissReason>? Closed;

    /// <summary>The canonical surface slug (<c>Popover</c>).</summary>
    public static string SurfaceId => PopoverRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public PopoverViewModel ViewModel => _viewModel;

    /// <summary>
    /// The element the popover positions against (web <c>anchorRef</c>). When unset the surface positions
    /// against itself so a consumer can wrap a trigger directly.
    /// </summary>
    public FrameworkElement? Anchor
    {
        get => _anchor;
        set
        {
            if (ReferenceEquals(_anchor, value))
            {
                return;
            }

            DetachAnchor();
            _anchor = value;
            AttachAnchor();
            if (_viewModel.IsOpen)
            {
                UpdatePlacementFromVisuals();
            }
        }
    }

    /// <summary>The content shown inside the popover surface (web <c>children</c>).</summary>
    public object? PopoverContent
    {
        get => _presenter.Content;
        set => _presenter.Content = value;
    }

    /// <summary>Requested side relative to the anchor (web <c>side</c>; default <see cref="PopoverSide.Bottom"/>).</summary>
    public PopoverSide Side
    {
        get => _viewModel.Side;
        set => _viewModel.Side = value;
    }

    /// <summary>Cross-axis alignment (web <c>align</c>; default <see cref="PopoverAlign.Start"/>).</summary>
    public PopoverAlign Align
    {
        get => _viewModel.Align;
        set => _viewModel.Align = value;
    }

    /// <summary>Pixel gap between the anchor and the popover (web <c>sideOffset</c>; default 6).</summary>
    public double SideOffset
    {
        get => _viewModel.SideOffset;
        set => _viewModel.SideOffset = value;
    }

    /// <summary>Consumer-supplied accessible label (web <c>ariaLabel</c>).</summary>
    public string? AriaLabel
    {
        get => _viewModel.AriaLabel;
        set => _viewModel.AriaLabel = value;
    }

    /// <summary>Whether the popover is shown (web <c>open</c>). Setting it opens / closes the surface.</summary>
    public bool IsOpen
    {
        get => _viewModel.IsOpen;
        set
        {
            if (value)
            {
                _viewModel.Open();
            }
            else
            {
                _viewModel.Close(PopoverDismissReason.Programmatic);
            }
        }
    }

    /// <summary>Open the popover programmatically (web <c>open=true</c>).</summary>
    public void Show() => _viewModel.Open();

    /// <summary>Close the popover programmatically (web consumer <c>onClose</c>).</summary>
    public void Hide() => _viewModel.Close(PopoverDismissReason.Programmatic);

    /// <summary>Detach from the view-model, dismiss the popup and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopTrackingRoot();
        DetachAnchor();
        _surface.KeyDown -= OnSurfaceKeyDown;
        _surface.SizeChanged -= OnSurfaceSizeChanged;
        _popup.Closed -= OnPopupClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Opened -= OnViewModelOpened;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _viewModel.FocusRestoreRequested -= OnViewModelFocusRestoreRequested;
        _popup.IsOpen = false;
    }

    private void BuildSurface()
    {
        _surface.Child = _presenter;
        _surface.Background = DisplayTokens.Surface;
        _surface.BorderBrush = DisplayTokens.Border;
        _surface.BorderThickness = new Thickness(1);
        _surface.CornerRadius = DisplayTokens.Radius("TsRadiusLg", 16);
        _surface.Shadow = new ThemeShadow();
        _surface.Translation = new Vector3(0, 0, 32);
        _surface.KeyDown += OnSurfaceKeyDown;
        _surface.SizeChanged += OnSurfaceSizeChanged;

        AutomationProperties.SetName(_surface, _viewModel.ResolvedAriaLabel);
        AutomationProperties.SetAutomationId(_surface, "popover-surface");
    }

    private FrameworkElement ResolveAnchor() => _anchor ?? this;

    private void AttachAnchor()
    {
        if (_anchor is { } anchor)
        {
            anchor.SizeChanged += OnAnchorSizeChanged;
        }
    }

    private void DetachAnchor()
    {
        if (_anchor is { } anchor)
        {
            anchor.SizeChanged -= OnAnchorSizeChanged;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _started = true;
        if (_viewModel.IsOpen && !_popup.IsOpen)
        {
            ShowPopup();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelOpened(object? sender, EventArgs e)
    {
        if (_started || XamlRoot is not null)
        {
            ShowPopup();
        }
    }

    private void OnViewModelCloseRequested(object? sender, PopoverDismissReason reason)
    {
        HidePopup();
        Closed?.Invoke(this, reason);
    }

    private void OnViewModelFocusRestoreRequested(object? sender, EventArgs e) =>
        _ = ResolveAnchor().Focus(FocusState.Programmatic);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(PopoverViewModel.ResolvedAriaLabel):
                AutomationProperties.SetName(_surface, _viewModel.ResolvedAriaLabel);
                break;
            case nameof(PopoverViewModel.Side):
            case nameof(PopoverViewModel.Align):
            case nameof(PopoverViewModel.SideOffset):
                if (_viewModel.IsOpen)
                {
                    UpdatePlacementFromVisuals();
                }

                break;
            default:
                break;
        }
    }

    private void ShowPopup()
    {
        if (_disposed || XamlRoot is null)
        {
            // Not yet attached to a XamlRoot — OnLoaded re-shows once the surface is live.
            return;
        }

        // Hide until measured + positioned (web visibility: hidden at top/left -9999).
        _surface.Opacity = 0;
        _popup.HorizontalOffset = PopoverRegistration.OffscreenCoordinate;
        _popup.VerticalOffset = PopoverRegistration.OffscreenCoordinate;
        _popup.XamlRoot = XamlRoot;
        _popup.IsOpen = true;

        StartTrackingRoot(XamlRoot);
        UpdatePlacementFromVisuals();
    }

    private void HidePopup()
    {
        StopTrackingRoot();
        _surface.Opacity = 0;
        _popup.IsOpen = false;
    }

    private void UpdatePlacementFromVisuals()
    {
        if (!_viewModel.IsOpen || _popup.XamlRoot is not { } root)
        {
            return;
        }

        var viewport = new PopoverViewport(root.Size.Width, root.Size.Height);

        FrameworkElement anchor = ResolveAnchor();
        GeneralTransform transform = anchor.TransformToVisual(null);
        Point topLeft = transform.TransformPoint(new Point(0, 0));
        var anchorRect = new PopoverRect(topLeft.X, topLeft.Y, anchor.ActualWidth, anchor.ActualHeight);

        _surface.Measure(new Size(viewport.Width, viewport.Height));
        Size desired = _surface.DesiredSize;
        double width = desired.Width > 0 ? desired.Width : _surface.ActualWidth;
        double height = desired.Height > 0 ? desired.Height : _surface.ActualHeight;
        var content = new PopoverSize(width, height);

        _viewModel.UpdatePlacement(anchorRect, content, viewport);

        if (_viewModel.Placement is { } placement)
        {
            _popup.HorizontalOffset = placement.Left;
            _popup.VerticalOffset = placement.Top;
            _surface.Opacity = 1;
        }
    }

    private void StartTrackingRoot(XamlRoot root)
    {
        if (ReferenceEquals(_trackedRoot, root))
        {
            return;
        }

        StopTrackingRoot();
        _trackedRoot = root;
        _trackedRoot.Changed += OnXamlRootChanged;
    }

    private void StopTrackingRoot()
    {
        if (_trackedRoot is { } root)
        {
            root.Changed -= OnXamlRootChanged;
            _trackedRoot = null;
        }
    }

    private void OnXamlRootChanged(XamlRoot sender, XamlRootChangedEventArgs args) => UpdatePlacementFromVisuals();

    private void OnAnchorSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_viewModel.IsOpen)
        {
            UpdatePlacementFromVisuals();
        }
    }

    private void OnSurfaceSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_viewModel.IsOpen)
        {
            UpdatePlacementFromVisuals();
        }
    }

    private void OnSurfaceKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape && _viewModel.HandleKey("Escape"))
        {
            e.Handled = true;
        }
    }

    private void OnPopupClosed(object? sender, object e)
    {
        // Light dismiss (pointer outside / system) closed the popup without going through the view-model.
        if (_viewModel.IsOpen)
        {
            _viewModel.Close(PopoverDismissReason.PointerOutside);
        }
    }
}
