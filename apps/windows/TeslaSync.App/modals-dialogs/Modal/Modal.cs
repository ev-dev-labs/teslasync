using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.System;
using Windows.UI.Core;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>Modal</c> surface — a parity port of web/src/components/ui/Modal.tsx. It hosts a
/// light-dismiss-free <see cref="Popup"/> whose child is a dimmed, blurred scrim (the web
/// <c>--surface-overlay backdrop-blur-sm</c>, an acrylic that falls back to an opaque system colour in
/// High&#160;Contrast — the web <c>forced-colors:bg-[Canvas]</c>) under a centered dialog surface (web
/// <c>--surface-1</c> + <c>--glass-border</c>, rounded) with an OPTIONAL header — a truncating
/// <see cref="SectionTitle"/> title and a 44&#160;×&#160;44 close button (web <c>h-11 w-11</c>, WCAG&#160;2.5.5)
/// — over a scrollable content area. It reproduces the web behaviour: focus moves into the dialog on open
/// (first focusable, else the body), Esc closes, Tab / Shift+Tab are trapped (wrapping first↔last), a backdrop
/// click closes, and focus returns to the opener on close. Below the web <c>sm</c> (640&#160;px) breakpoint the
/// dialog is full-bleed edge-to-edge; at or above it the dialog takes its <see cref="ModalSize"/> max-width
/// (capped to 96% of the viewport) and a 90% max-height. The web component is a pure presentational container
/// with no read query, so the surface has no loading / empty / error / stale / offline state. The view holds no
/// business logic — it binds the shared <see cref="ModalViewModel"/>; the close label resolves through the i18n
/// facade, the dialog and close button carry Narrator names, and the surface adds no bespoke motion so
/// reduced-motion is honoured by construction.
/// </summary>
public sealed partial class Modal : ContentControl, IDisposable
{
    private const string CloseGlyph = "\uE711"; // Segoe Fluent — ChromeClose (web lucide X)
    private const double Gutter = 16;            // web sm:p-4
    private const double HeaderHorizontalPadding = 24;
    private const double BodyHorizontalPadding = 24;

    private readonly ModalViewModel _viewModel;
    private readonly Popup _popup = new() { IsLightDismissEnabled = false };
    private readonly Grid _root = new() { IsTabStop = false };
    private readonly Border _scrim = new();
    private readonly Border _surface = new();
    private readonly Grid _surfaceLayout = new();
    private readonly Border _header = new();
    private readonly SectionTitle _titleText = new();
    private readonly TsButton _close = new() { Variant = ButtonVariant.Subtle, IconGlyph = CloseGlyph };
    private readonly ScrollViewer _bodyHost = new();
    private readonly ContentPresenter _bodyPresenter = new();

    private object? _restoreFocusTo;
    private object? _body;
    private bool _opened;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade resolving the close label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public Modal(ILocalizer localizer, ModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ModalViewModel(localizer, diagnostics);

        IsTabStop = false;
        BuildVisualTree();

        Content = _popup;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised once the modal has fully closed (web <c>onClose</c> aftermath), for any dismiss path.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>Modal</c>).</summary>
    public static string SurfaceId => ModalRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ModalViewModel ViewModel => _viewModel;

    /// <summary>The optional dialog title (web <c>title</c>). Null / empty renders no header.</summary>
    public string? Title
    {
        get => _viewModel.Title;
        set => _viewModel.Title = value;
    }

    /// <summary>The width preset (web <c>size</c>; default <see cref="ModalSize.Md"/>).</summary>
    public ModalSize Size
    {
        get => _viewModel.Size;
        set
        {
            _viewModel.Size = value;
            if (_popup.IsOpen && _popup.XamlRoot is { } xamlRoot)
            {
                ApplyLayout(xamlRoot.Size);
            }
        }
    }

    /// <summary>The accessible label used when no <see cref="Title"/> is rendered (web <c>ariaLabel</c>).</summary>
    public string? AriaLabel
    {
        get => _viewModel.AriaLabel;
        set => _viewModel.AriaLabel = value;
    }

    /// <summary>The modal body (web <c>children</c>). Hosted in the scrollable content area.</summary>
    public object? Body
    {
        get => _body;
        set
        {
            _body = value;
            _bodyPresenter.Content = value;
        }
    }

    /// <summary>Whether the modal is currently open (web <c>open</c>).</summary>
    public bool IsOpen => _popup.IsOpen;

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Captures the opener
    /// for focus restoration, moves focus into the dialog, and emits <c>view.opened</c> on first show.
    /// Idempotent while already showing.
    /// </summary>
    public void Show(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_popup.IsOpen || _disposed)
        {
            return;
        }

        _closeRaised = false;
        _restoreFocusTo = FocusManager.GetFocusedElement(xamlRoot);
        _popup.XamlRoot = xamlRoot;

        Render();
        ApplyLayout(xamlRoot.Size);

        _popup.IsOpen = true;
        _viewModel.IsOpen = true;

        MoveInitialFocus();

        if (!_opened)
        {
            _opened = true;
            _viewModel.NotifyOpened();
        }
    }

    /// <summary>Close the modal (web <c>open=false</c>). Idempotent; restores focus and raises <see cref="Closed"/>.</summary>
    public void Hide()
    {
        if (_popup.IsOpen)
        {
            _popup.IsOpen = false;
        }
        else
        {
            FinishClose();
        }
    }

    /// <summary>Detach from the view-model, dismiss the popup and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Unloaded -= OnUnloaded;
        _popup.IsOpen = false;
    }

    private void BuildVisualTree()
    {
        _scrim.Background = DisplayTokens.Brush("TsMaterialOverlayBrush");
        _scrim.PointerPressed += OnScrimPointerPressed;

        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _close.Width = ModalRegistration.CloseButtonMinSize;
        _close.Height = ModalRegistration.CloseButtonMinSize;
        _close.MinWidth = ModalRegistration.CloseButtonMinSize;
        _close.MinHeight = ModalRegistration.CloseButtonMinSize;
        _close.HorizontalAlignment = HorizontalAlignment.Right;
        _close.VerticalAlignment = VerticalAlignment.Center;
        _close.Click += OnCloseClick;

        var headerGrid = new Grid
        {
            ColumnSpacing = 12,
            Padding = new Thickness(HeaderHorizontalPadding, 16, HeaderHorizontalPadding - 8, 12),
        };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleText, 0);
        Grid.SetColumn(_close, 1);
        headerGrid.Children.Add(_titleText);
        headerGrid.Children.Add(_close);

        _header.Child = headerGrid;
        _header.BorderBrush = DisplayTokens.Border;
        _header.BorderThickness = new Thickness(0, 0, 0, 1);

        _bodyHost.IsTabStop = true;
        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(BodyHorizontalPadding, 12, BodyHorizontalPadding, 24);
        _bodyHost.Content = _bodyPresenter;

        _surfaceLayout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _surfaceLayout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _surfaceLayout.Children.Add(_header);
        _surfaceLayout.Children.Add(_bodyHost);

        _surface.Background = DisplayTokens.Surface;
        _surface.BorderBrush = DisplayTokens.Border;
        _surface.BorderThickness = new Thickness(1);
        _surface.Child = _surfaceLayout;

        _root.Children.Add(_scrim);
        _root.Children.Add(_surface);
        _root.KeyDown += OnRootKeyDown;

        _popup.Child = _root;
        _popup.Closed += OnPopupClosed;
    }

    private void Render()
    {
        bool hasTitle = _viewModel.HasTitle;
        _titleText.Value = _viewModel.Title ?? string.Empty;
        _header.Visibility = hasTitle ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(_close, _viewModel.CloseLabel);
        ToolTipService.SetToolTip(_close, _viewModel.CloseLabel);

        string accessibleName = _viewModel.AccessibleName;
        AutomationProperties.SetName(_surface, accessibleName);
        AutomationProperties.SetIsDialog(_surface, true);
    }

    private void ApplyLayout(Size viewport)
    {
        if (viewport.Width > 0)
        {
            _root.Width = viewport.Width;
        }

        if (viewport.Height > 0)
        {
            _root.Height = viewport.Height;
        }

        bool fullBleed = ModalProjection.IsFullBleed(viewport.Width);
        _surface.MaxWidth = ModalProjection.EffectiveMaxWidth(_viewModel.Size, viewport.Width);
        _surface.MaxHeight = ModalProjection.EffectiveMaxHeight(viewport.Width, viewport.Height);

        if (fullBleed)
        {
            _surface.HorizontalAlignment = HorizontalAlignment.Stretch;
            _surface.VerticalAlignment = VerticalAlignment.Stretch;
            _surface.Margin = new Thickness(0);
            _surface.CornerRadius = new CornerRadius(0);
        }
        else
        {
            _surface.HorizontalAlignment = HorizontalAlignment.Center;
            _surface.VerticalAlignment = VerticalAlignment.Center;
            _surface.Margin = new Thickness(Gutter);
            _surface.CornerRadius = DisplayTokens.Radius("TsRadiusLg", 16);
        }
    }

    private void MoveInitialFocus()
    {
        if (FocusManager.FindFirstFocusableElement(_surface) is Control first)
        {
            first.Focus(FocusState.Programmatic);
        }
        else
        {
            _bodyHost.Focus(FocusState.Programmatic);
        }
    }

    private void OnRootKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Escape:
                e.Handled = true;
                RequestClose();
                break;
            case VirtualKey.Tab:
                TrapTab(e);
                break;
            default:
                break;
        }
    }

    private void TrapTab(KeyRoutedEventArgs e)
    {
        var first = FocusManager.FindFirstFocusableElement(_surface) as Control;
        var last = FocusManager.FindLastFocusableElement(_surface) as Control;
        if (first is null || last is null)
        {
            e.Handled = true;
            _bodyHost.Focus(FocusState.Programmatic);
            return;
        }

        var root = _popup.XamlRoot ?? XamlRoot;
        object? current = root is null ? null : FocusManager.GetFocusedElement(root);
        bool shift = IsShiftDown();

        if (shift && ReferenceEquals(current, first))
        {
            e.Handled = true;
            last.Focus(FocusState.Programmatic);
        }
        else if (!shift && ReferenceEquals(current, last))
        {
            e.Handled = true;
            first.Focus(FocusState.Programmatic);
        }
    }

    private void OnScrimPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        e.Handled = true;
        RequestClose();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => RequestClose();

    private void RequestClose()
    {
        if (_disposed)
        {
            return;
        }

        _viewModel.RequestClose();
        Hide();
    }

    private void OnPopupClosed(object? sender, object e) => FinishClose();

    private void FinishClose()
    {
        _viewModel.IsOpen = false;

        if (_restoreFocusTo is Control control)
        {
            control.Focus(FocusState.Programmatic);
        }

        _restoreFocusTo = null;
        _opened = false;

        if (!_closeRaised)
        {
            _closeRaised = true;
            Closed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(ModalViewModel.Title):
            case nameof(ModalViewModel.HasTitle):
            case nameof(ModalViewModel.AccessibleName):
            case nameof(ModalViewModel.CloseLabel):
                Render();
                break;
            default:
                break;
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private static bool IsShiftDown() =>
        InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(CoreVirtualKeyStates.Down);
}
