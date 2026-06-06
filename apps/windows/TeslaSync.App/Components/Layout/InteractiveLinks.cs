using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Navigation;
using Windows.ApplicationModel.DataTransfer;

namespace TeslaSync.App.Components.Layout;

/// <summary>
/// A breadcrumb trail (port of the web <c>Breadcrumbs</c>). Renders interactive
/// crumbs separated by chevrons; the trailing current crumb is plain text. Activating
/// a non-current crumb raises <see cref="CrumbActivated"/> with its route key.
/// </summary>
public partial class TsBreadcrumbs : ContentControl
{
    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    public TsBreadcrumbs()
    {
        IsTabStop = false;
        Content = _row;
        AutomationProperties.SetName(this, "Breadcrumb");
    }

    /// <summary>Raised with the route key when a non-current crumb is activated.</summary>
    public event EventHandler<string>? CrumbActivated;

    /// <summary>Replace the trail from ordered (label, key) segments.</summary>
    public void SetTrail(IReadOnlyList<(string Label, string Key)> segments)
    {
        ArgumentNullException.ThrowIfNull(segments);
        SetCrumbs(BreadcrumbTrail.Build(segments));
    }

    /// <summary>Replace the trail from pre-built crumbs.</summary>
    public void SetCrumbs(IReadOnlyList<Crumb> crumbs)
    {
        ArgumentNullException.ThrowIfNull(crumbs);
        _row.Children.Clear();

        for (int i = 0; i < crumbs.Count; i++)
        {
            var crumb = crumbs[i];
            if (i > 0)
            {
                _row.Children.Add(new FontIcon
                {
                    Glyph = "\uE76C",
                    FontSize = 12,
                    Foreground = DisplayTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            if (crumb.IsCurrent)
            {
                var current = new Caption { Value = crumb.Label };
                AutomationProperties.SetName(current, crumb.Label);
                _row.Children.Add(current);
            }
            else
            {
                _row.Children.Add(BuildLink(crumb));
            }
        }
    }

    private HyperlinkButton BuildLink(Crumb crumb)
    {
        var link = new HyperlinkButton
        {
            Content = crumb.Label,
            Padding = new Thickness(2, 0, 2, 0),
        };
        AutomationProperties.SetName(link, crumb.Label);
        link.Click += (_, _) => CrumbActivated?.Invoke(this, crumb.Key);
        return link;
    }
}

/// <summary>
/// Copies a shareable link to the clipboard (port of the web <c>CopyLinkButton</c>).
/// On click it writes <see cref="LinkText"/> to the system clipboard, announces the
/// result to assistive technology and briefly swaps to a "copied" affordance.
/// </summary>
public partial class TsCopyLinkButton : ContentControl
{
    private readonly TsButton _button = new() { Variant = TeslaSync.App.Core.ButtonVariant.Secondary };
    private readonly DispatcherTimer _resetTimer = new() { Interval = TimeSpan.FromSeconds(2) };

    public static readonly DependencyProperty LinkTextProperty = DependencyProperty.Register(
        nameof(LinkText), typeof(string), typeof(TsCopyLinkButton), new PropertyMetadata(string.Empty));

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsCopyLinkButton),
        new PropertyMetadata("Copy link", OnLabelChanged));

    public static readonly DependencyProperty CopiedLabelProperty = DependencyProperty.Register(
        nameof(CopiedLabel), typeof(string), typeof(TsCopyLinkButton), new PropertyMetadata("Copied"));

    public TsCopyLinkButton()
    {
        IsTabStop = false;
        _button.IconGlyph = "\uE71B";
        _button.Text = Label;
        _button.Click += OnCopyClicked;
        _resetTimer.Tick += OnResetTick;
        Content = _button;
    }

    /// <summary>Raised after the link is copied to the clipboard.</summary>
    public event EventHandler? Copied;

    /// <summary>The URL/text copied to the clipboard.</summary>
    public string LinkText
    {
        get => (string)GetValue(LinkTextProperty);
        set => SetValue(LinkTextProperty, value);
    }

    /// <summary>Localized idle button label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Localized post-copy label.</summary>
    public string CopiedLabel
    {
        get => (string)GetValue(CopiedLabelProperty);
        set => SetValue(CopiedLabelProperty, value);
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsCopyLinkButton)d;
        control._button.Text = (string)e.NewValue;
    }

    private void OnCopyClicked(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(LinkText))
        {
            return;
        }

        var package = new DataPackage();
        package.SetText(LinkText);
        Clipboard.SetContent(package);

        _button.Text = CopiedLabel;
        _button.IconGlyph = "\uE73E";
        AutomationProperties.SetName(_button, CopiedLabel);
        Feedback.LiveRegion.Announce(_button);
        Copied?.Invoke(this, EventArgs.Empty);

        _resetTimer.Stop();
        _resetTimer.Start();
    }

    private void OnResetTick(object? sender, object e)
    {
        _resetTimer.Stop();
        _button.Text = Label;
        _button.IconGlyph = "\uE71B";
        AutomationProperties.SetName(_button, Label);
    }
}

/// <summary>
/// A navigation link that prefetches its target on hover/focus (port of the web
/// <c>PrefetchLink</c>). Raises <see cref="Prefetch"/> once when the pointer enters or
/// the link gains focus, and <see cref="Navigate"/> when activated. The host wires
/// these to its query prefetch + router.
/// </summary>
public partial class TsPrefetchLink : ContentControl
{
    private readonly HyperlinkButton _link = new();
    private bool _prefetched;

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsPrefetchLink),
        new PropertyMetadata(string.Empty, OnLabelChanged));

    public static readonly DependencyProperty RouteKeyProperty = DependencyProperty.Register(
        nameof(RouteKey), typeof(string), typeof(TsPrefetchLink), new PropertyMetadata(string.Empty));

    public TsPrefetchLink()
    {
        IsTabStop = false;
        _link.Click += (_, _) => Navigate?.Invoke(this, RouteKey);
        _link.PointerEntered += (_, _) => RaisePrefetch();
        _link.GotFocus += (_, _) => RaisePrefetch();
        Content = _link;
    }

    /// <summary>Raised once when the target should be prefetched.</summary>
    public event EventHandler<string>? Prefetch;

    /// <summary>Raised with the route key when the link is activated.</summary>
    public event EventHandler<string>? Navigate;

    /// <summary>Localized link label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Stable route key passed to <see cref="Prefetch"/> / <see cref="Navigate"/>.</summary>
    public string RouteKey
    {
        get => (string)GetValue(RouteKeyProperty);
        set => SetValue(RouteKeyProperty, value);
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsPrefetchLink)d;
        control._link.Content = (string)e.NewValue;
        AutomationProperties.SetName(control._link, (string)e.NewValue);
    }

    private void RaisePrefetch()
    {
        if (_prefetched || string.IsNullOrEmpty(RouteKey))
        {
            return;
        }

        _prefetched = true;
        Prefetch?.Invoke(this, RouteKey);
    }
}
