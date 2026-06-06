using System.Windows.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Feedback;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Shared layout for the centred "state" surfaces (empty / error / query-error).
/// Builds a vertical column of an optional glyph, a title, a message and an
/// optional action button, and wires the action to either an
/// <see cref="ActionCommand"/> or the <see cref="ActionInvoked"/> event. The
/// whole surface is a live region so the state change is announced.
/// </summary>
public abstract partial class TsFeedbackState : ContentControl
{
    private readonly FontIcon _icon = new() { FontSize = 28, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly SectionTitle _title = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Text _message = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsButton _action = new() { Variant = TeslaSync.App.Core.ButtonVariant.Secondary, Visibility = Visibility.Collapsed };
    private readonly StackPanel _column;

    public static readonly DependencyProperty IconGlyphProperty = DependencyProperty.Register(
        nameof(IconGlyph), typeof(string), typeof(TsFeedbackState),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsFeedbackState),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty MessageProperty = DependencyProperty.Register(
        nameof(Message), typeof(string), typeof(TsFeedbackState),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty ActionTextProperty = DependencyProperty.Register(
        nameof(ActionText), typeof(string), typeof(TsFeedbackState),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty ActionCommandProperty = DependencyProperty.Register(
        nameof(ActionCommand), typeof(ICommand), typeof(TsFeedbackState),
        new PropertyMetadata(null));

    protected TsFeedbackState(bool assertive)
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        MinHeight = 160;
        _icon.Visibility = Visibility.Collapsed;
        _action.HorizontalAlignment = HorizontalAlignment.Center;
        _action.Click += (_, _) => InvokeAction();

        _column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 420,
        };
        _column.Children.Add(_icon);
        _column.Children.Add(_title);
        _column.Children.Add(_message);
        _column.Children.Add(_action);
        Content = _column;
        LiveRegion.Configure(_column, assertive);
    }

    /// <summary>Raised when the action / retry affordance is invoked.</summary>
    public event EventHandler? ActionInvoked;

    /// <summary>Optional leading Segoe Fluent Icons glyph.</summary>
    public string IconGlyph
    {
        get => (string)GetValue(IconGlyphProperty);
        set => SetValue(IconGlyphProperty, value);
    }

    /// <summary>Localized heading.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Localized descriptive message.</summary>
    public string Message
    {
        get => (string)GetValue(MessageProperty);
        set => SetValue(MessageProperty, value);
    }

    /// <summary>Localized action / retry button label (empty hides the button).</summary>
    public string ActionText
    {
        get => (string)GetValue(ActionTextProperty);
        set => SetValue(ActionTextProperty, value);
    }

    /// <summary>Optional MVVM command invoked by the action button.</summary>
    public ICommand? ActionCommand
    {
        get => (ICommand?)GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }

    private protected FontIcon Icon => _icon;

    private static void OnContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFeedbackState)d).ApplyContent();

    private protected void ApplyContent()
    {
        var hasIcon = !string.IsNullOrEmpty(IconGlyph);
        _icon.Glyph = IconGlyph;
        _icon.Visibility = hasIcon ? Visibility.Visible : Visibility.Collapsed;

        _title.Value = Title;
        _title.Visibility = string.IsNullOrEmpty(Title) ? Visibility.Collapsed : Visibility.Visible;

        _message.Value = Message;
        _message.Visibility = string.IsNullOrEmpty(Message) ? Visibility.Collapsed : Visibility.Visible;

        var hasAction = !string.IsNullOrEmpty(ActionText);
        _action.Text = ActionText;
        _action.Visibility = hasAction ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, string.IsNullOrEmpty(Title) ? Message : Title);
        LiveRegion.Announce(_column);
    }

    private void InvokeAction()
    {
        ActionInvoked?.Invoke(this, EventArgs.Empty);
        if (ActionCommand is { } command && command.CanExecute(null))
        {
            command.Execute(null);
        }
    }
}

/// <summary>
/// "No data" empty surface (mirrors the web <c>EmptyState</c>). Always rendered in
/// place of a hidden panel so a region never collapses silently; shows a glyph,
/// title, message and an optional call-to-action.
/// </summary>
public partial class TsEmptyState : TsFeedbackState
{
    public TsEmptyState()
        : base(assertive: false)
    {
        IconGlyph = "\uE7C3"; // Page / empty document
        ApplyContent();
    }
}

/// <summary>
/// Inline error surface with a retry affordance (mirrors the web
/// <c>ErrorDisplay</c>). Uses an assertive live region so failures interrupt,
/// and tints the glyph with the danger token.
/// </summary>
public partial class TsErrorDisplay : TsFeedbackState
{
    public TsErrorDisplay()
        : base(assertive: true)
    {
        IconGlyph = "\uEA39"; // ErrorBadge
        Icon.Foreground = TypographyTokens.Brush("TsColorDangerBrush");
        ApplyContent();
    }
}

/// <summary>
/// Error surface bound to an <see cref="AsyncState{T}"/> query result (mirrors
/// the web <c>QueryError</c>). Exposes <see cref="AttemptCount"/> so repeated
/// failures can be surfaced, and drives its retry button straight into the
/// async state's retry path.
/// </summary>
public partial class TsQueryError : TsFeedbackState
{
    public static readonly DependencyProperty AttemptCountProperty = DependencyProperty.Register(
        nameof(AttemptCount), typeof(int), typeof(TsQueryError),
        new PropertyMetadata(0));

    public TsQueryError()
        : base(assertive: true)
    {
        IconGlyph = "\uE783"; // Error / cloud-off style
        Icon.Foreground = TypographyTokens.Brush("TsColorDangerBrush");
        ApplyContent();
    }

    /// <summary>Number of load attempts so far (for "tried N times" messaging).</summary>
    public int AttemptCount
    {
        get => (int)GetValue(AttemptCountProperty);
        set => SetValue(AttemptCountProperty, value);
    }
}
