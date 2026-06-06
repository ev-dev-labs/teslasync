using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.A11y;

/// <summary>
/// Renders text that is hidden from sighted users but still exposed to assistive
/// technology (port of the web <c>VisuallyHidden</c> / the <c>sr-only</c> utility).
/// The text stays in the UI-Automation tree via <see cref="AutomationProperties"/>
/// while a 1×1 clip with zero opacity removes it from the visual layout.
/// </summary>
public partial class TsVisuallyHidden : Control
{
    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(
        nameof(Text), typeof(string), typeof(TsVisuallyHidden),
        new PropertyMetadata(string.Empty, OnTextChanged));

    public TsVisuallyHidden()
    {
        IsTabStop = false;
        Width = 1;
        Height = 1;
        Opacity = 0;
        Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 1, 1) };
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        AutomationProperties.SetLiveSetting(this, AutomationLiveSetting.Off);
    }

    /// <summary>The screen-reader-only text.</summary>
    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    /// <summary>Expose the hidden text to UI Automation as a plain text element.</summary>
    protected override AutomationPeer OnCreateAutomationPeer() => new TsVisuallyHiddenAutomationPeer(this);

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsVisuallyHidden)d;
        AutomationProperties.SetName(control, (string)e.NewValue);
    }

    private sealed class TsVisuallyHiddenAutomationPeer(TsVisuallyHidden owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((TsVisuallyHidden)Owner).Text : name;
        }
    }
}

/// <summary>
/// A polite/assertive UI-Automation live region (port of the web
/// <c>AnnouncerRegion</c> / an <c>aria-live</c> container). Hosts a visually-hidden
/// text node; calling <see cref="Announce"/> updates the text and raises the
/// automation event so a screen reader speaks the message without a focus move.
/// </summary>
public partial class TsAnnouncerRegion : Control
{
    private readonly TextBlock _live = new();

    public static readonly DependencyProperty AssertiveProperty = DependencyProperty.Register(
        nameof(Assertive), typeof(bool), typeof(TsAnnouncerRegion),
        new PropertyMetadata(false, OnAssertiveChanged));

    public TsAnnouncerRegion()
    {
        IsTabStop = false;
        Width = 1;
        Height = 1;
        Opacity = 0;
        Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 1, 1) };
        Feedback.LiveRegion.Configure(_live, assertive: false);
    }

    /// <summary>When true, announcements interrupt the screen reader (assertive).</summary>
    public bool Assertive
    {
        get => (bool)GetValue(AssertiveProperty);
        set => SetValue(AssertiveProperty, value);
    }

    /// <summary>The most recently announced message.</summary>
    public string LastMessage => _live.Text;

    /// <summary>Announce <paramref name="message"/> to assistive technology.</summary>
    public void Announce(string message)
    {
        _live.Text = message ?? string.Empty;
        AutomationProperties.SetName(this, _live.Text);
        Feedback.LiveRegion.Announce(_live);
        var peer = FrameworkElementAutomationPeer.FromElement(this)
            ?? FrameworkElementAutomationPeer.CreatePeerForElement(this);
        peer?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
    }

    /// <summary>Expose the live text to UI Automation.</summary>
    protected override AutomationPeer OnCreateAutomationPeer()
    {
        var peer = new FrameworkElementAutomationPeer(this);
        return peer;
    }

    private static void OnAssertiveChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var region = (TsAnnouncerRegion)d;
        Feedback.LiveRegion.Configure(region._live, assertive: (bool)e.NewValue);
        AutomationProperties.SetLiveSetting(
            region,
            (bool)e.NewValue ? AutomationLiveSetting.Assertive : AutomationLiveSetting.Polite);
    }
}
