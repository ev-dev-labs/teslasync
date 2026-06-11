using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>Drawer</c> modal/dialog surface — a parity port of web/src/components/ui/Drawer.tsx.
/// It reproduces the web composition as an edge-anchored modal side sheet: a dimmed, click-to-dismiss backdrop
/// (web overlay <c>onClick={onClose}</c>), a pane that anchors to the right (default) or left edge and spans the
/// window height (web <c>side</c> + <c>w-full max-w-md</c>), an optional header with the title and a close
/// affordance (web <c>{title &amp;&amp; ...}</c> + the close button), a scrollable body hosting the supplied
/// content — or a friendly empty state when none is supplied, so the body is never blank — and an optional
/// footer (web <c>{footer &amp;&amp; ...}</c>). It is hosted in a <see cref="Popup"/> (a focus scope), captures
/// the previously-focused element on open and restores it on close, focuses the first affordance on open and
/// closes on Escape — the WinUI analogue of the web focus trap, Escape handler and focus restoration. There is
/// deliberately no loading / empty / error / stale / offline data chrome because the web source performs no read;
/// all state flows through the shared <see cref="DrawerViewModel"/> so the view never performs I/O, every string
/// resolves through the i18n facade, and every interactive element carries a Narrator name. The surface uses no
/// bespoke animation, so it honours the reduced-motion setting by construction and all text scales with the
/// system font size.
/// </summary>
public sealed partial class Drawer : ContentControl, IDisposable
{
    private const string CloseGlyph = "\uE8BB";        // Segoe Fluent — ChromeClose (web Drawer close)
    private const double EdgePadding = 24;             // web px-6
    private const double HeaderVerticalPadding = 16;   // web py-4
    private const double FooterVerticalPadding = 16;   // web py-4

    private readonly DrawerViewModel _viewModel;

    private readonly Popup _popup = new();
    private readonly Grid _root = new();
    private readonly Border _scrim = new();
    private readonly Border _pane = new();
    private readonly Grid _header = new();
    private readonly SectionTitle _titleText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _closeButton = new()
    {
        Variant = ButtonVariant.Icon,
        Size = ControlSize.Small,
        IconGlyph = CloseGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ScrollViewer _bodyScroll = new();
    private readonly TsEmptyState _emptyState = new();
    private readonly Border _footerBorder = new();

    private UIElement? _content;
    private UIElement? _footerContent;
    private object? _restoreFocusTo;
    private bool _popupOpen;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, the initial edge and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="side">The edge the drawer slides in from (web <c>side</c>; defaults to right).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Drawer(ILocalizer localizer, DrawerSide side = DrawerSide.Right, DrawerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _viewModel = new DrawerViewModel(localizer, side, diagnostics);

        IsTabStop = false;
        AutomationProperties.SetAutomationId(this, "drawer");

        BuildOverlay();
        Content = _popup;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _closeButton.Click += OnCloseClick;
        _scrim.Tapped += OnScrimTapped;
        _root.KeyDown += OnRootKeyDown;
        _popup.Closed += OnPopupClosed;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when the drawer opens (web <c>open</c> becomes true).</summary>
    public event EventHandler? Opened
    {
        add => _viewModel.Opened += value;
        remove => _viewModel.Opened -= value;
    }

    /// <summary>Raised when the drawer closes / is dismissed (web <c>onClose</c>).</summary>
    public event EventHandler? Closed
    {
        add => _viewModel.Closed += value;
        remove => _viewModel.Closed -= value;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Drawer</c>).</summary>
    public static string Slug => DrawerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DrawerViewModel ViewModel => _viewModel;

    /// <summary>True while the drawer is open.</summary>
    public bool IsOpen => _viewModel.IsOpen;

    /// <summary>The optional drawer title (web <c>title</c>); empty hides the header.</summary>
    public string? Title
    {
        get => _viewModel.Title;
        set => _viewModel.Title = value ?? string.Empty;
    }

    /// <summary>The edge the drawer slides in from (web <c>side</c>).</summary>
    public DrawerSide Side
    {
        get => _viewModel.Side;
        set => _viewModel.Side = value;
    }

    /// <summary>The hosted body content (web <c>children</c>); null shows the friendly empty state.</summary>
    public UIElement? Body
    {
        get => _content;
        set
        {
            _content = value;
            _viewModel.HasContent = value is not null;
            _bodyScroll.Content = value ?? _emptyState;
        }
    }

    /// <summary>The optional footer content (web <c>footer</c>); null hides the footer region.</summary>
    public UIElement? Footer
    {
        get => _footerContent;
        set
        {
            _footerContent = value;
            _viewModel.HasFooter = value is not null;
            _footerBorder.Child = value;
        }
    }

    /// <summary>Open the drawer (web <c>open = true</c>).</summary>
    public void Open() => _viewModel.Open();

    /// <summary>Close the drawer (web <c>onClose</c>).</summary>
    public void Close() => _viewModel.Close();

    /// <summary>Detach from the view-model, dismiss the popup and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _closeButton.Click -= OnCloseClick;
        _scrim.Tapped -= OnScrimTapped;
        _root.KeyDown -= OnRootKeyDown;
        _popup.Closed -= OnPopupClosed;
        Unloaded -= OnUnloaded;
        _popupOpen = false;
        _popup.IsOpen = false;
    }

    private void BuildOverlay()
    {
        _scrim.Background = DisplayTokens.Brush("TsSurfaceOverlayBrush");

        _pane.Background = DisplayTokens.Surface;
        _pane.BorderBrush = DisplayTokens.Border;
        _pane.IsTabStop = true;

        var paneGrid = new Grid();
        paneGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        paneGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        paneGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        BuildHeader();
        Grid.SetRow(_header, 0);
        paneGrid.Children.Add(_header);

        _bodyScroll.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyScroll.VerticalScrollMode = ScrollMode.Auto;
        _bodyScroll.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyScroll.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyScroll.Padding = new Thickness(EdgePadding);
        _bodyScroll.Content = _emptyState;
        Grid.SetRow(_bodyScroll, 1);
        paneGrid.Children.Add(_bodyScroll);

        _footerBorder.BorderBrush = DisplayTokens.Border;
        _footerBorder.BorderThickness = new Thickness(0, 1, 0, 0);
        _footerBorder.Padding = new Thickness(EdgePadding, FooterVerticalPadding, EdgePadding, FooterVerticalPadding);
        _footerBorder.Visibility = Visibility.Collapsed;
        Grid.SetRow(_footerBorder, 2);
        paneGrid.Children.Add(_footerBorder);

        _pane.Child = paneGrid;

        _root.Children.Add(_scrim);
        _root.Children.Add(_pane);
        _popup.Child = _root;
    }

    private void BuildHeader()
    {
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnSpacing = 8;
        _header.Padding = new Thickness(EdgePadding, HeaderVerticalPadding, EdgePadding - 8, HeaderVerticalPadding);
        _header.BorderBrush = DisplayTokens.Border;
        _header.BorderThickness = new Thickness(0, 0, 0, 1);
        _header.Visibility = Visibility.Collapsed;

        Grid.SetColumn(_titleText, 0);
        _header.Children.Add(_titleText);

        Grid.SetColumn(_closeButton, 1);
        _header.Children.Add(_closeButton);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Render();

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        _titleText.Value = _viewModel.Title;
        _header.Visibility = _viewModel.HasTitle ? Visibility.Visible : Visibility.Collapsed;
        _footerBorder.Visibility = _viewModel.HasFooter ? Visibility.Visible : Visibility.Collapsed;
        _emptyState.Message = _viewModel.EmptyMessage;

        AutomationProperties.SetName(this, _viewModel.AccessibleName);
        AutomationProperties.SetName(_pane, _viewModel.AccessibleName);
        AutomationProperties.SetName(_closeButton, _viewModel.CloseLabel);
        ToolTipService.SetToolTip(_closeButton, _viewModel.CloseLabel);

        if (_viewModel.IsOpen && !_popupOpen)
        {
            OpenPopup();
        }
        else if (!_viewModel.IsOpen && _popupOpen)
        {
            ClosePopup();
        }
        else if (_popupOpen)
        {
            ApplyLayout();
        }
    }

    private void OpenPopup()
    {
        _restoreFocusTo = FocusManager.GetFocusedElement(XamlRoot);
        if (XamlRoot is not null)
        {
            _popup.XamlRoot = XamlRoot;
            ApplyLayout();
        }

        _popupOpen = true;
        _popup.IsOpen = true;
        FocusFirst();
    }

    private void ClosePopup()
    {
        _popupOpen = false;
        _popup.IsOpen = false;
        if (_restoreFocusTo is Control control)
        {
            control.Focus(FocusState.Programmatic);
        }

        _restoreFocusTo = null;
    }

    private void ApplyLayout()
    {
        if (XamlRoot is null)
        {
            return;
        }

        var size = XamlRoot.Size;
        _root.Width = size.Width;
        _root.Height = size.Height;

        _pane.Width = Math.Min(DrawerRegistration.DefaultPaneWidth, size.Width);
        _pane.Height = size.Height;

        bool right = _viewModel.Side == DrawerSide.Right;
        _pane.HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left;
        _pane.VerticalAlignment = VerticalAlignment.Stretch;
        _pane.BorderThickness = right ? new Thickness(1, 0, 0, 0) : new Thickness(0, 0, 1, 0);
    }

    private void FocusFirst()
    {
        if (_viewModel.HasTitle)
        {
            _closeButton.Focus(FocusState.Programmatic);
        }
        else
        {
            _pane.Focus(FocusState.Programmatic);
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => _viewModel.Close();

    private void OnScrimTapped(object sender, TappedRoutedEventArgs e)
    {
        e.Handled = true;
        _viewModel.Close();
    }

    private void OnRootKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape)
        {
            e.Handled = true;
            _viewModel.Close();
        }
    }

    private void OnPopupClosed(object? sender, object e)
    {
        if (_popupOpen)
        {
            _viewModel.Close();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
