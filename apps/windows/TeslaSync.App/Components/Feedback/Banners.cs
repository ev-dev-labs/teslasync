using System.Windows.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Shared base for the banner / callout family (mirrors the web
/// <c>AlertBanner</c> plus the conditional app banners). Renders a tokenized,
/// accent-tinted strip with a semantic <see cref="Variant"/> glyph, an optional
/// <see cref="Title"/>, a <see cref="Message"/>, up to two action buttons and an
/// optional dismiss affordance. The strip is a live region whose urgency follows
/// the variant (danger interrupts, everything else is polite), and it never
/// surfaces tokens or PII — only consumer-supplied localized strings.
/// </summary>
public partial class TsBannerBase : ContentControl
{
    private readonly FontIcon _glyph = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Top };
    private readonly PanelTitle _title = new();
    private readonly Text _message = new();
    private readonly StackPanel _textColumn;
    private readonly TsButton _secondaryAction = new() { Variant = ButtonVariant.Subtle, Visibility = Visibility.Collapsed };
    private readonly TsButton _primaryAction = new() { Variant = ButtonVariant.Secondary, Visibility = Visibility.Collapsed };
    private readonly TsButton _dismiss = new() { Variant = ButtonVariant.Icon, IconGlyph = "\uE711", Visibility = Visibility.Collapsed };
    private readonly Rectangle _accentBar = new() { Width = 3 };
    private readonly Border _surface;

    public static readonly DependencyProperty VariantProperty = DependencyProperty.Register(
        nameof(Variant), typeof(CalloutVariant), typeof(TsBannerBase),
        new PropertyMetadata(CalloutVariant.Info, OnVariantChanged));

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsBannerBase),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty MessageProperty = DependencyProperty.Register(
        nameof(Message), typeof(string), typeof(TsBannerBase),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty ActionTextProperty = DependencyProperty.Register(
        nameof(ActionText), typeof(string), typeof(TsBannerBase),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty SecondaryActionTextProperty = DependencyProperty.Register(
        nameof(SecondaryActionText), typeof(string), typeof(TsBannerBase),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty ActionCommandProperty = DependencyProperty.Register(
        nameof(ActionCommand), typeof(ICommand), typeof(TsBannerBase),
        new PropertyMetadata(null));

    public static readonly DependencyProperty SecondaryActionCommandProperty = DependencyProperty.Register(
        nameof(SecondaryActionCommand), typeof(ICommand), typeof(TsBannerBase),
        new PropertyMetadata(null));

    public static readonly DependencyProperty DismissibleProperty = DependencyProperty.Register(
        nameof(Dismissible), typeof(bool), typeof(TsBannerBase),
        new PropertyMetadata(false, OnContentChanged));

    public static readonly DependencyProperty IsOpenProperty = DependencyProperty.Register(
        nameof(IsOpen), typeof(bool), typeof(TsBannerBase),
        new PropertyMetadata(true, OnOpenChanged));

    public TsBannerBase()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _message.HorizontalAlignment = HorizontalAlignment.Left;
        _title.Visibility = Visibility.Collapsed;
        _textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_message);

        _primaryAction.Click += (_, _) => InvokePrimary();
        _secondaryAction.Click += (_, _) => InvokeSecondary();
        _dismiss.Click += (_, _) => Dismiss();
        AutomationProperties.SetName(_dismiss, "Dismiss");

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_secondaryAction);
        actions.Children.Add(_primaryAction);

        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(12, 10, 8, 10) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_glyph, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(actions, 2);
        Grid.SetColumn(_dismiss, 3);
        grid.Children.Add(_glyph);
        grid.Children.Add(_textColumn);
        grid.Children.Add(actions);
        grid.Children.Add(_dismiss);

        var inner = new Grid();
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_accentBar, 0);
        Grid.SetColumn(grid, 1);
        inner.Children.Add(_accentBar);
        inner.Children.Add(grid);

        _surface = new Border
        {
            Child = inner,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Background = TypographyTokens.Brush("TsColorSurfaceBrush"),
        };
        Content = _surface;

        ApplyVariant();
        ApplyContent();
    }

    /// <summary>Raised when the primary action is invoked.</summary>
    public event EventHandler? ActionInvoked;

    /// <summary>Raised when the secondary action is invoked.</summary>
    public event EventHandler? SecondaryActionInvoked;

    /// <summary>Raised when the banner is dismissed.</summary>
    public event EventHandler? Dismissed;

    /// <summary>Semantic emphasis (accent, glyph, urgency).</summary>
    public CalloutVariant Variant
    {
        get => (CalloutVariant)GetValue(VariantProperty);
        set => SetValue(VariantProperty, value);
    }

    /// <summary>Optional localized heading.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Localized banner message.</summary>
    public string Message
    {
        get => (string)GetValue(MessageProperty);
        set => SetValue(MessageProperty, value);
    }

    /// <summary>Localized primary action label (empty hides it).</summary>
    public string ActionText
    {
        get => (string)GetValue(ActionTextProperty);
        set => SetValue(ActionTextProperty, value);
    }

    /// <summary>Localized secondary action label (empty hides it).</summary>
    public string SecondaryActionText
    {
        get => (string)GetValue(SecondaryActionTextProperty);
        set => SetValue(SecondaryActionTextProperty, value);
    }

    /// <summary>Optional MVVM command for the primary action.</summary>
    public ICommand? ActionCommand
    {
        get => (ICommand?)GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }

    /// <summary>Optional MVVM command for the secondary action.</summary>
    public ICommand? SecondaryActionCommand
    {
        get => (ICommand?)GetValue(SecondaryActionCommandProperty);
        set => SetValue(SecondaryActionCommandProperty, value);
    }

    /// <summary>Whether the user can dismiss the banner.</summary>
    public bool Dismissible
    {
        get => (bool)GetValue(DismissibleProperty);
        set => SetValue(DismissibleProperty, value);
    }

    /// <summary>Whether the banner is shown.</summary>
    public bool IsOpen
    {
        get => (bool)GetValue(IsOpenProperty);
        set => SetValue(IsOpenProperty, value);
    }

    /// <summary>Dismiss (hide) the banner and raise <see cref="Dismissed"/>.</summary>
    public void Dismiss()
    {
        if (!IsOpen)
        {
            return;
        }

        IsOpen = false;
        Dismissed?.Invoke(this, EventArgs.Empty);
    }

    private static void OnVariantChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsBannerBase)d).ApplyVariant();

    private static void OnContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsBannerBase)d).ApplyContent();

    private static void OnOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var banner = (TsBannerBase)d;
        banner.Visibility = banner.IsOpen ? Visibility.Visible : Visibility.Collapsed;
        if (banner.IsOpen)
        {
            LiveRegion.Announce(banner._surface);
        }
    }

    private void ApplyVariant()
    {
        var accent = TypographyTokens.Brush(CalloutVariants.AccentBrushKey(Variant));
        _glyph.Glyph = CalloutVariants.Glyph(Variant);
        if (accent is not null)
        {
            _glyph.Foreground = accent;
            _accentBar.Fill = accent;
            _surface.BorderBrush = accent;
        }

        LiveRegion.Configure(_surface, CalloutVariants.IsAssertive(Variant));
    }

    private void ApplyContent()
    {
        _title.Value = Title;
        _title.Visibility = string.IsNullOrEmpty(Title) ? Visibility.Collapsed : Visibility.Visible;
        _message.Value = Message;

        _primaryAction.Text = ActionText;
        _primaryAction.Visibility = string.IsNullOrEmpty(ActionText) ? Visibility.Collapsed : Visibility.Visible;
        _secondaryAction.Text = SecondaryActionText;
        _secondaryAction.Visibility = string.IsNullOrEmpty(SecondaryActionText) ? Visibility.Collapsed : Visibility.Visible;
        _dismiss.Visibility = Dismissible ? Visibility.Visible : Visibility.Collapsed;

        var name = string.IsNullOrEmpty(Title) ? Message : $"{Title}. {Message}";
        AutomationProperties.SetName(this, name);
        if (IsOpen)
        {
            LiveRegion.Announce(_surface);
        }
    }

    private void InvokePrimary()
    {
        ActionInvoked?.Invoke(this, EventArgs.Empty);
        if (ActionCommand is { } command && command.CanExecute(null))
        {
            command.Execute(null);
        }
    }

    private void InvokeSecondary()
    {
        SecondaryActionInvoked?.Invoke(this, EventArgs.Empty);
        if (SecondaryActionCommand is { } command && command.CanExecute(null))
        {
            command.Execute(null);
        }
    }
}

/// <summary>General-purpose alert strip (mirrors the web <c>AlertBanner</c>).</summary>
public partial class TsAlertBanner : TsBannerBase
{
    public TsAlertBanner() => Dismissible = true;
}

/// <summary>
/// Compact inline callout (mirrors the web <c>InlineCallout</c>): a non-dismissible
/// variant-tinted note rendered inside form/section flow rather than pinned.
/// </summary>
public partial class TsInlineCallout : TsBannerBase
{
    public TsInlineCallout()
    {
        Dismissible = false;
        Margin = new Thickness(0, 4, 0, 4);
    }
}

/// <summary>Recoverable-draft notice (mirrors the web <c>DraftRecoveryBanner</c>).</summary>
public partial class TsDraftRecoveryBanner : TsBannerBase
{
    public TsDraftRecoveryBanner()
    {
        Variant = CalloutVariant.Info;
        Dismissible = true;
    }
}

/// <summary>Inline draft-restore prompt (mirrors the web <c>DraftRestorePrompt</c>).</summary>
public partial class TsDraftRestorePrompt : TsBannerBase
{
    public TsDraftRestorePrompt()
    {
        Variant = CalloutVariant.Info;
        Margin = new Thickness(0, 4, 0, 4);
    }
}

/// <summary>Network-offline notice (mirrors the web <c>OfflineBanner</c>).</summary>
public partial class TsOfflineBanner : TsBannerBase
{
    public TsOfflineBanner() => Variant = CalloutVariant.Warning;
}

/// <summary>Stale live-data notice (mirrors the web <c>LiveStaleDataBanner</c>).</summary>
public partial class TsLiveStaleDataBanner : TsBannerBase
{
    public TsLiveStaleDataBanner()
    {
        Variant = CalloutVariant.Warning;
        Dismissible = true;
    }
}

/// <summary>Tesla re-authentication prompt (mirrors the web <c>TeslaReauthBanner</c>).</summary>
public partial class TsTeslaReauthBanner : TsBannerBase
{
    public TsTeslaReauthBanner() => Variant = CalloutVariant.Warning;
}

/// <summary>API rate-limit notice (mirrors the web <c>RateLimitBanner</c>).</summary>
public partial class TsRateLimitBanner : TsBannerBase
{
    public TsRateLimitBanner() => Variant = CalloutVariant.Warning;
}

/// <summary>Scheduled-maintenance notice (mirrors the web <c>MaintenanceBanner</c>).</summary>
public partial class TsMaintenanceBanner : TsBannerBase
{
    public TsMaintenanceBanner()
    {
        Variant = CalloutVariant.Info;
        Dismissible = true;
    }
}

/// <summary>Active-impersonation notice (mirrors the web <c>ImpersonationBanner</c>).</summary>
public partial class TsImpersonationBanner : TsBannerBase
{
    public TsImpersonationBanner() => Variant = CalloutVariant.Warning;
}

/// <summary>Unsupported-browser / environment notice (mirrors the web <c>BrowserCompatBanner</c>).</summary>
public partial class TsBrowserCompatBanner : TsBannerBase
{
    public TsBrowserCompatBanner()
    {
        Variant = CalloutVariant.Warning;
        Dismissible = true;
    }
}

/// <summary>Historical "time machine" mode notice (mirrors the web <c>TimeMachineBanner</c>).</summary>
public partial class TsTimeMachineBanner : TsBannerBase
{
    public TsTimeMachineBanner() => Variant = CalloutVariant.Info;
}

/// <summary>Concurrent-edit conflict notice (mirrors the web <c>EditConflictBanner</c>).</summary>
public partial class TsEditConflictBanner : TsBannerBase
{
    public TsEditConflictBanner() => Variant = CalloutVariant.Danger;
}

/// <summary>Cookie / storage consent prompt (mirrors the web <c>CookieConsentBanner</c>).</summary>
public partial class TsCookieConsentBanner : TsBannerBase
{
    public TsCookieConsentBanner() => Variant = CalloutVariant.Info;
}
