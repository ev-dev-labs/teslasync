using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized fullscreen toggle (mirrors the web <c>FullscreenButton</c>). Flips
/// the target <see cref="AppWindow"/> between the default and fullscreen
/// presenters and swaps its glyph to reflect the current state.
/// </summary>
public partial class TsFullscreenButton : TsButton
{
    public static readonly DependencyProperty AppWindowProperty = DependencyProperty.Register(
        nameof(AppWindow), typeof(AppWindow), typeof(TsFullscreenButton),
        new PropertyMetadata(null));

    public TsFullscreenButton()
    {
        Variant = Core.ButtonVariant.Subtle;
        IconGlyph = "\uE740";
        Click += OnToggleClick;
    }

    /// <summary>The window whose presenter is toggled.</summary>
    public AppWindow? AppWindow
    {
        get => (AppWindow?)GetValue(AppWindowProperty);
        set => SetValue(AppWindowProperty, value);
    }

    /// <summary>True when the target window is currently fullscreen.</summary>
    public bool IsFullscreen { get; private set; }

    private void OnToggleClick(object sender, RoutedEventArgs e)
    {
        if (AppWindow is null)
        {
            return;
        }

        if (IsFullscreen)
        {
            AppWindow.SetPresenter(AppWindowPresenterKind.Default);
            IconGlyph = "\uE740";
        }
        else
        {
            AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
            IconGlyph = "\uE73F";
        }

        IsFullscreen = !IsFullscreen;
    }
}
