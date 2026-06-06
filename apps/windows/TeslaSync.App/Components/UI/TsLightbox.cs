using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Core;
using Windows.Foundation;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Full-screen image viewer (mirrors the web <c>Lightbox</c>). Opens a dimmed
/// overlay <see cref="Popup"/> with a zoomable image, a close affordance, and
/// keyboard support (Escape closes, +/- zoom). Focus is restored to the opener on
/// dismiss.
/// </summary>
public partial class TsLightbox : ContentControl
{
    private const double MinZoom = 1.0;
    private const double MaxZoom = 5.0;
    private const double ZoomStep = 0.25;

    private readonly Popup _popup = new();
    private readonly Image _image = new() { Stretch = Stretch.Uniform };
    private readonly ScaleTransform _scale = new() { ScaleX = 1, ScaleY = 1 };
    private readonly TsButton _close = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE711" };
    private readonly Grid _overlay;
    private object? _restoreFocusTo;

    public static readonly DependencyProperty SourceProperty = DependencyProperty.Register(
        nameof(Source), typeof(ImageSource), typeof(TsLightbox),
        new PropertyMetadata(null, OnSourceChanged));

    public static readonly DependencyProperty SourceUriProperty = DependencyProperty.Register(
        nameof(SourceUri), typeof(Uri), typeof(TsLightbox),
        new PropertyMetadata(null, OnSourceUriChanged));

    public static readonly DependencyProperty IsOpenProperty = DependencyProperty.Register(
        nameof(IsOpen), typeof(bool), typeof(TsLightbox),
        new PropertyMetadata(false, OnIsOpenChanged));

    public static readonly DependencyProperty CloseLabelProperty = DependencyProperty.Register(
        nameof(CloseLabel), typeof(string), typeof(TsLightbox),
        new PropertyMetadata(null, OnCloseLabelChanged));

    public static readonly DependencyProperty AltTextProperty = DependencyProperty.Register(
        nameof(AltText), typeof(string), typeof(TsLightbox),
        new PropertyMetadata(null, OnAltTextChanged));

    public TsLightbox()
    {
        IsTabStop = false;
        _image.RenderTransform = _scale;
        _image.RenderTransformOrigin = new Point(0.5, 0.5);

        _close.HorizontalAlignment = HorizontalAlignment.Right;
        _close.VerticalAlignment = VerticalAlignment.Top;
        _close.Margin = new Thickness(16);

        _overlay = new Grid
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Black) { Opacity = 0.85 },
        };
        _overlay.Children.Add(_image);
        _overlay.Children.Add(_close);
        _overlay.PointerWheelChanged += OnWheel;
        _overlay.KeyDown += OnKeyDown;
        _overlay.IsTabStop = true;

        _popup.Child = _overlay;
        Content = _popup;

        _close.Click += (s, e) => IsOpen = false;
        _popup.Closed += (s, e) => IsOpen = false;
    }

    public ImageSource? Source
    {
        get => (ImageSource?)GetValue(SourceProperty);
        set => SetValue(SourceProperty, value);
    }

    /// <summary>Convenience setter that loads an image from a URI.</summary>
    public Uri? SourceUri
    {
        get => (Uri?)GetValue(SourceUriProperty);
        set => SetValue(SourceUriProperty, value);
    }

    public bool IsOpen
    {
        get => (bool)GetValue(IsOpenProperty);
        set => SetValue(IsOpenProperty, value);
    }

    /// <summary>Localized accessible name for the close button.</summary>
    public string? CloseLabel
    {
        get => (string?)GetValue(CloseLabelProperty);
        set => SetValue(CloseLabelProperty, value);
    }

    /// <summary>Localized alternative text announced for the image.</summary>
    public string? AltText
    {
        get => (string?)GetValue(AltTextProperty);
        set => SetValue(AltTextProperty, value);
    }

    private static void OnSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsLightbox)d)._image.Source = (ImageSource?)e.NewValue;

    private static void OnSourceUriChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var box = (TsLightbox)d;
        box.Source = e.NewValue is Uri uri ? new BitmapImage(uri) : null;
    }

    private static void OnIsOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var box = (TsLightbox)d;
        if ((bool)e.NewValue)
        {
            box.Open();
        }
        else
        {
            box.Close();
        }
    }

    private static void OnCloseLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var box = (TsLightbox)d;
        if (!string.IsNullOrEmpty(box.CloseLabel))
        {
            AutomationProperties.SetName(box._close, box.CloseLabel);
            ToolTipService.SetToolTip(box._close, box.CloseLabel);
        }
    }

    private static void OnAltTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var box = (TsLightbox)d;
        if (!string.IsNullOrEmpty(box.AltText))
        {
            AutomationProperties.SetName(box._image, box.AltText);
        }
    }

    private void Open()
    {
        _restoreFocusTo = FocusManager.GetFocusedElement(XamlRoot);
        if (XamlRoot is not null)
        {
            _popup.XamlRoot = XamlRoot;
            _overlay.Width = XamlRoot.Size.Width;
            _overlay.Height = XamlRoot.Size.Height;
        }

        SetZoom(MinZoom);
        _popup.IsOpen = true;
        _overlay.Focus(FocusState.Programmatic);
    }

    private void Close()
    {
        _popup.IsOpen = false;
        if (_restoreFocusTo is Control control)
        {
            control.Focus(FocusState.Programmatic);
        }

        _restoreFocusTo = null;
    }

    private void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        var delta = e.GetCurrentPoint(_overlay).Properties.MouseWheelDelta;
        SetZoom(_scale.ScaleX + (delta > 0 ? ZoomStep : -ZoomStep));
        e.Handled = true;
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case Windows.System.VirtualKey.Escape:
                e.Handled = true;
                IsOpen = false;
                break;
            case Windows.System.VirtualKey.Add:
                e.Handled = true;
                SetZoom(_scale.ScaleX + ZoomStep);
                break;
            case Windows.System.VirtualKey.Subtract:
                e.Handled = true;
                SetZoom(_scale.ScaleX - ZoomStep);
                break;
            default:
                break;
        }
    }

    private void SetZoom(double zoom)
    {
        var clamped = Math.Clamp(zoom, MinZoom, MaxZoom);
        _scale.ScaleX = clamped;
        _scale.ScaleY = clamped;
    }
}
