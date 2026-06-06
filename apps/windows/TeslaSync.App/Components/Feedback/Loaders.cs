using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Centered full-region busy state (mirrors the web <c>PageLoader</c>). Shows a
/// <see cref="TsSpinner"/> with an optional localized message, sized to fill its
/// host so a page can render a single loading affordance. The message is
/// published to UI Automation as a polite live region.
/// </summary>
public partial class TsPageLoader : ContentControl
{
    private readonly TsSpinner _spinner = new() { Size = TeslaSync.App.Core.ControlSize.Large };

    public static readonly DependencyProperty MessageProperty = DependencyProperty.Register(
        nameof(Message), typeof(string), typeof(TsPageLoader),
        new PropertyMetadata("Loading", OnMessageChanged));

    public TsPageLoader()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 200;
        _spinner.HorizontalAlignment = HorizontalAlignment.Center;
        _spinner.VerticalAlignment = VerticalAlignment.Center;
        _spinner.Label = Message;
        Content = _spinner;
    }

    /// <summary>Localized busy message / accessible name.</summary>
    public string Message
    {
        get => (string)GetValue(MessageProperty);
        set => SetValue(MessageProperty, value);
    }

    private static void OnMessageChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPageLoader)d)._spinner.Label = (string)e.NewValue;
}

/// <summary>
/// Slim indeterminate top progress bar (mirrors the web <c>TopProgress</c> route
/// transition indicator). Pinned to the top of its host; toggle
/// <see cref="IsActive"/> during navigation / background work. Hidden from the
/// accessibility tree as a decorative indicator — the destination region
/// announces its own loading state.
/// </summary>
public partial class TsTopProgress : ContentControl
{
    private readonly ProgressBar _bar = new()
    {
        IsIndeterminate = true,
        Height = 3,
        VerticalAlignment = VerticalAlignment.Top,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    public static readonly DependencyProperty IsActiveProperty = DependencyProperty.Register(
        nameof(IsActive), typeof(bool), typeof(TsTopProgress),
        new PropertyMetadata(false, OnActiveChanged));

    public TsTopProgress()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
        Content = _bar;
        ApplyActive();
    }

    /// <summary>Whether the indeterminate bar is shown and animating.</summary>
    public bool IsActive
    {
        get => (bool)GetValue(IsActiveProperty);
        set => SetValue(IsActiveProperty, value);
    }

    private static void OnActiveChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTopProgress)d).ApplyActive();

    private void ApplyActive()
    {
        Visibility = IsActive ? Visibility.Visible : Visibility.Collapsed;
        _bar.ShowPaused = false;
        _bar.IsIndeterminate = IsActive;
    }
}
