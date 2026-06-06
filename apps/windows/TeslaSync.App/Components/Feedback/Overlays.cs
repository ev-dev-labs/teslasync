using System.Globalization;
using System.Windows.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Auth gate (mirrors the web <c>RequiresAuth</c>). Shows
/// <see cref="ProtectedContent"/> when <see cref="IsAuthenticated"/> is true,
/// otherwise a localized sign-in prompt whose button raises
/// <see cref="SignInRequested"/> / runs <see cref="SignInCommand"/>. Integrates
/// with W4 auth state through the boolean flag only — it never receives or
/// renders tokens or PII.
/// </summary>
public partial class TsRequiresAuth : ContentControl
{
    private readonly ContentPresenter _content = new();
    private readonly TsEmptyState _prompt = new();
    private readonly Grid _root = new();

    public static readonly DependencyProperty ProtectedContentProperty = DependencyProperty.Register(
        nameof(ProtectedContent), typeof(object), typeof(TsRequiresAuth),
        new PropertyMetadata(null, OnProtectedChanged));

    public static readonly DependencyProperty IsAuthenticatedProperty = DependencyProperty.Register(
        nameof(IsAuthenticated), typeof(bool), typeof(TsRequiresAuth),
        new PropertyMetadata(false, OnStateChanged));

    public static readonly DependencyProperty PromptTitleProperty = DependencyProperty.Register(
        nameof(PromptTitle), typeof(string), typeof(TsRequiresAuth),
        new PropertyMetadata("Sign in required", OnPromptChanged));

    public static readonly DependencyProperty PromptMessageProperty = DependencyProperty.Register(
        nameof(PromptMessage), typeof(string), typeof(TsRequiresAuth),
        new PropertyMetadata("Please sign in to view this content.", OnPromptChanged));

    public static readonly DependencyProperty SignInTextProperty = DependencyProperty.Register(
        nameof(SignInText), typeof(string), typeof(TsRequiresAuth),
        new PropertyMetadata("Sign in", OnPromptChanged));

    public static readonly DependencyProperty SignInCommandProperty = DependencyProperty.Register(
        nameof(SignInCommand), typeof(ICommand), typeof(TsRequiresAuth),
        new PropertyMetadata(null));

    public TsRequiresAuth()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        _prompt.IconGlyph = "\uE72E"; // Lock
        _prompt.ActionInvoked += (_, _) => SignInRequested?.Invoke(this, EventArgs.Empty);
        _root.Children.Add(_content);
        _root.Children.Add(_prompt);
        Content = _root;
        ApplyPrompt();
        ApplyState();
    }

    /// <summary>Raised when the sign-in affordance is invoked.</summary>
    public event EventHandler? SignInRequested;

    /// <summary>Content shown to authenticated users.</summary>
    public object? ProtectedContent
    {
        get => GetValue(ProtectedContentProperty);
        set => SetValue(ProtectedContentProperty, value);
    }

    /// <summary>Whether the current user is authenticated.</summary>
    public bool IsAuthenticated
    {
        get => (bool)GetValue(IsAuthenticatedProperty);
        set => SetValue(IsAuthenticatedProperty, value);
    }

    /// <summary>Localized prompt heading.</summary>
    public string PromptTitle
    {
        get => (string)GetValue(PromptTitleProperty);
        set => SetValue(PromptTitleProperty, value);
    }

    /// <summary>Localized prompt message.</summary>
    public string PromptMessage
    {
        get => (string)GetValue(PromptMessageProperty);
        set => SetValue(PromptMessageProperty, value);
    }

    /// <summary>Localized sign-in button label.</summary>
    public string SignInText
    {
        get => (string)GetValue(SignInTextProperty);
        set => SetValue(SignInTextProperty, value);
    }

    /// <summary>Optional MVVM command invoked on sign-in.</summary>
    public ICommand? SignInCommand
    {
        get => (ICommand?)GetValue(SignInCommandProperty);
        set => SetValue(SignInCommandProperty, value);
    }

    private static void OnProtectedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRequiresAuth)d)._content.Content = e.NewValue;

    private static void OnStateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRequiresAuth)d).ApplyState();

    private static void OnPromptChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRequiresAuth)d).ApplyPrompt();

    private void ApplyPrompt()
    {
        _prompt.Title = PromptTitle;
        _prompt.Message = PromptMessage;
        _prompt.ActionText = SignInText;
        _prompt.ActionCommand = SignInCommand;
    }

    private void ApplyState()
    {
        _content.Visibility = IsAuthenticated ? Visibility.Visible : Visibility.Collapsed;
        _prompt.Visibility = IsAuthenticated ? Visibility.Collapsed : Visibility.Visible;
    }
}

/// <summary>A single keyboard-shortcut row (keys + localized description).</summary>
public sealed record ShortcutItem(string Keys, string Description);

/// <summary>
/// Keyboard-shortcuts reference dialog (mirrors the web
/// <c>KeyboardShortcutsDialog</c>). Lists <see cref="Shortcuts"/> as
/// key/description rows inside a focus-trapping <see cref="ContentDialog"/>.
/// </summary>
public partial class TsKeyboardShortcutsDialog : ContentDialog
{
    private readonly StackPanel _list = new() { Spacing = 8 };

    public static readonly DependencyProperty ShortcutsProperty = DependencyProperty.Register(
        nameof(Shortcuts), typeof(IReadOnlyList<ShortcutItem>), typeof(TsKeyboardShortcutsDialog),
        new PropertyMetadata(null, OnShortcutsChanged));

    public TsKeyboardShortcutsDialog()
    {
        Title = "Keyboard shortcuts";
        CloseButtonText = "Close";
        DefaultButton = ContentDialogButton.Close;
        Content = new ScrollViewer { Content = _list };
    }

    /// <summary>The shortcut rows to display.</summary>
    public IReadOnlyList<ShortcutItem>? Shortcuts
    {
        get => (IReadOnlyList<ShortcutItem>?)GetValue(ShortcutsProperty);
        set => SetValue(ShortcutsProperty, value);
    }

    private static void OnShortcutsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsKeyboardShortcutsDialog)d).Rebuild();

    private void Rebuild()
    {
        _list.Children.Clear();
        foreach (var item in Shortcuts ?? [])
        {
            var row = new Grid { ColumnSpacing = 16 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var description = new Text { Value = item.Description };
            var keys = new TsBadge { Status = StatusKind.Neutral, Content = item.Keys };
            Grid.SetColumn(description, 0);
            Grid.SetColumn(keys, 1);
            row.Children.Add(description);
            row.Children.Add(keys);
            _list.Children.Add(row);
        }
    }
}

/// <summary>A single guided-tour step.</summary>
public sealed record TourStep(string Title, string Body);

/// <summary>
/// Guided product tour overlay (mirrors the web <c>TourOverlay</c>). Walks the
/// user through <see cref="Steps"/> in a light-dismiss popup card with
/// Back / Next / Done and a Skip affordance. <see cref="Start"/> opens at the
/// first step; <see cref="Stop"/> ends the tour.
/// </summary>
public partial class TsTourOverlay : ContentControl
{
    private readonly Popup _popup = new() { IsLightDismissEnabled = false };
    private readonly PanelTitle _title = new();
    private readonly Text _body = new();
    private readonly Caption _counter = new();
    private readonly TsButton _back = new() { Variant = ButtonVariant.Subtle };
    private readonly TsButton _next = new() { Variant = ButtonVariant.Primary };
    private readonly TsButton _skip = new() { Variant = ButtonVariant.Subtle };
    private int _index;

    public static readonly DependencyProperty StepsProperty = DependencyProperty.Register(
        nameof(Steps), typeof(IReadOnlyList<TourStep>), typeof(TsTourOverlay),
        new PropertyMetadata(null, OnStepsChanged));

    public static readonly DependencyProperty BackTextProperty = DependencyProperty.Register(
        nameof(BackText), typeof(string), typeof(TsTourOverlay), new PropertyMetadata("Back", OnLabelsChanged));

    public static readonly DependencyProperty NextTextProperty = DependencyProperty.Register(
        nameof(NextText), typeof(string), typeof(TsTourOverlay), new PropertyMetadata("Next", OnLabelsChanged));

    public static readonly DependencyProperty DoneTextProperty = DependencyProperty.Register(
        nameof(DoneText), typeof(string), typeof(TsTourOverlay), new PropertyMetadata("Done", OnLabelsChanged));

    public static readonly DependencyProperty SkipTextProperty = DependencyProperty.Register(
        nameof(SkipText), typeof(string), typeof(TsTourOverlay), new PropertyMetadata("Skip", OnLabelsChanged));

    public TsTourOverlay()
    {
        IsTabStop = false;
        _back.Click += (_, _) => Move(-1);
        _next.Click += (_, _) => Move(1);
        _skip.Click += (_, _) => Stop();

        var nav = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        nav.Children.Add(_back);
        nav.Children.Add(_next);

        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_skip, 0);
        Grid.SetColumn(nav, 1);
        footer.Children.Add(_skip);
        footer.Children.Add(nav);

        var column = new StackPanel { Spacing = 8, Width = 320 };
        column.Children.Add(_counter);
        column.Children.Add(_title);
        column.Children.Add(_body);
        column.Children.Add(footer);

        var card = new Border
        {
            Child = column,
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            Background = TypographyTokens.Brush("TsColorSurfaceBrush"),
            BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
        };
        _popup.Child = card;
        LiveRegion.Configure(column);
        ApplyLabels();
    }

    /// <summary>Raised when the tour completes or is skipped.</summary>
    public event EventHandler? Closed;

    /// <summary>The ordered tour steps.</summary>
    public IReadOnlyList<TourStep>? Steps
    {
        get => (IReadOnlyList<TourStep>?)GetValue(StepsProperty);
        set => SetValue(StepsProperty, value);
    }

    /// <summary>Localized "Back" label.</summary>
    public string BackText
    {
        get => (string)GetValue(BackTextProperty);
        set => SetValue(BackTextProperty, value);
    }

    /// <summary>Localized "Next" label.</summary>
    public string NextText
    {
        get => (string)GetValue(NextTextProperty);
        set => SetValue(NextTextProperty, value);
    }

    /// <summary>Localized "Done" label (last step).</summary>
    public string DoneText
    {
        get => (string)GetValue(DoneTextProperty);
        set => SetValue(DoneTextProperty, value);
    }

    /// <summary>Localized "Skip" label.</summary>
    public string SkipText
    {
        get => (string)GetValue(SkipTextProperty);
        set => SetValue(SkipTextProperty, value);
    }

    /// <summary>Start the tour at the first step.</summary>
    public void Start()
    {
        if ((Steps ?? []).Count == 0 || XamlRoot is null)
        {
            return;
        }

        _index = 0;
        _popup.XamlRoot = XamlRoot;
        CenterPopup();
        _popup.IsOpen = true;
        ApplyStep();
    }

    /// <summary>End the tour and raise <see cref="Closed"/>.</summary>
    public void Stop()
    {
        if (!_popup.IsOpen)
        {
            return;
        }

        _popup.IsOpen = false;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private static void OnStepsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTourOverlay)d).ApplyStep();

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTourOverlay)d).ApplyLabels();

    private void Move(int delta)
    {
        var steps = Steps ?? [];
        var next = _index + delta;
        if (next >= steps.Count)
        {
            Stop();
            return;
        }

        _index = Math.Clamp(next, 0, Math.Max(0, steps.Count - 1));
        ApplyStep();
    }

    private void ApplyLabels()
    {
        _back.Text = BackText;
        _skip.Text = SkipText;
        ApplyStep();
    }

    private void ApplyStep()
    {
        var steps = Steps ?? [];
        if (steps.Count == 0)
        {
            return;
        }

        var step = steps[Math.Clamp(_index, 0, steps.Count - 1)];
        _title.Value = step.Title;
        _body.Value = step.Body;
        _counter.Value = string.Format(
            CultureInfo.CurrentCulture, "{0} / {1}", _index + 1, steps.Count);
        _back.Visibility = _index > 0 ? Visibility.Visible : Visibility.Collapsed;
        _next.Text = _index >= steps.Count - 1 ? DoneText : NextText;
    }

    private void CenterPopup()
    {
        if (XamlRoot is null)
        {
            return;
        }

        var size = XamlRoot.Size;
        _popup.HorizontalOffset = Math.Max(0, (size.Width - 352) / 2);
        _popup.VerticalOffset = Math.Max(0, (size.Height - 240) / 2);
    }
}

/// <summary>A background job's progress (0–100, with a done flag).</summary>
public sealed record JobProgress(string Id, string Label, double Percent, bool IsComplete);

/// <summary>
/// Background-job progress drawer (mirrors the web <c>JobProgressDrawer</c>).
/// Hosts a live list of <see cref="Jobs"/> with per-job progress bars inside a
/// side <see cref="TsDrawer"/>; toggle with <see cref="IsOpen"/>.
/// </summary>
public partial class TsJobProgressDrawer : ContentControl
{
    private readonly TsDrawer _drawer = new() { Side = DrawerSide.Right, PaneWidth = 380 };
    private readonly StackPanel _list = new() { Spacing = 12, Padding = new Thickness(16) };
    private readonly SectionTitle _heading = new();
    private readonly TsEmptyState _empty = new();

    public static readonly DependencyProperty JobsProperty = DependencyProperty.Register(
        nameof(Jobs), typeof(IReadOnlyList<JobProgress>), typeof(TsJobProgressDrawer),
        new PropertyMetadata(null, OnJobsChanged));

    public static readonly DependencyProperty IsOpenProperty = DependencyProperty.Register(
        nameof(IsOpen), typeof(bool), typeof(TsJobProgressDrawer),
        new PropertyMetadata(false, OnOpenChanged));

    public static readonly DependencyProperty HeadingProperty = DependencyProperty.Register(
        nameof(Heading), typeof(string), typeof(TsJobProgressDrawer),
        new PropertyMetadata("Background jobs", OnTextChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsJobProgressDrawer),
        new PropertyMetadata("No active jobs", OnTextChanged));

    public TsJobProgressDrawer()
    {
        IsTabStop = false;
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_heading);
        column.Children.Add(_empty);
        column.Children.Add(_list);
        _drawer.DrawerContent = new ScrollViewer { Content = column };
        Content = _drawer;
        ApplyText();
        Rebuild();
    }

    /// <summary>The jobs to display.</summary>
    public IReadOnlyList<JobProgress>? Jobs
    {
        get => (IReadOnlyList<JobProgress>?)GetValue(JobsProperty);
        set => SetValue(JobsProperty, value);
    }

    /// <summary>Whether the drawer is open.</summary>
    public bool IsOpen
    {
        get => (bool)GetValue(IsOpenProperty);
        set => SetValue(IsOpenProperty, value);
    }

    /// <summary>Localized drawer heading.</summary>
    public string Heading
    {
        get => (string)GetValue(HeadingProperty);
        set => SetValue(HeadingProperty, value);
    }

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    private static void OnJobsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsJobProgressDrawer)d).Rebuild();

    private static void OnOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsJobProgressDrawer)d)._drawer.IsOpen = (bool)e.NewValue;

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsJobProgressDrawer)d).ApplyText();

    private void ApplyText()
    {
        _heading.Value = Heading;
        _empty.Message = EmptyMessage;
    }

    private void Rebuild()
    {
        _list.Children.Clear();
        var jobs = Jobs ?? [];
        _empty.Visibility = jobs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var job in jobs)
        {
            var row = new StackPanel { Spacing = 4 };
            var header = new Grid();
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var label = new Text { Value = job.Label };
            var pct = new Caption
            {
                Value = job.IsComplete
                    ? "100%"
                    : string.Format(CultureInfo.CurrentCulture, "{0:0}%", job.Percent),
            };
            Grid.SetColumn(label, 0);
            Grid.SetColumn(pct, 1);
            header.Children.Add(label);
            header.Children.Add(pct);

            var bar = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = Math.Clamp(job.Percent, 0, 100),
                IsIndeterminate = !job.IsComplete && job.Percent <= 0,
            };
            row.Children.Add(header);
            row.Children.Add(bar);
            _list.Children.Add(row);
        }
    }
}

/// <summary>
/// Transient achievement / success toast stack (mirrors the web
/// <c>AchievementToastStack</c>). <see cref="Push"/> adds a toast that
/// auto-dismisses after <see cref="DurationSeconds"/>; each is announced via an
/// assertive live region.
/// </summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage(
    "Naming",
    "CA1711:Identifiers should not have incorrect suffix",
    Justification = "Name intentionally mirrors the web AchievementToastStack component for cross-platform parity.")]
public partial class TsAchievementToastStack : ContentControl
{
    private readonly StackPanel _stack = new()
    {
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    public static readonly DependencyProperty DurationSecondsProperty = DependencyProperty.Register(
        nameof(DurationSeconds), typeof(double), typeof(TsAchievementToastStack),
        new PropertyMetadata(5.0));

    public TsAchievementToastStack()
    {
        IsTabStop = false;
        Content = _stack;
        LiveRegion.Configure(_stack, assertive: true);
    }

    /// <summary>Seconds a toast stays before auto-dismissing.</summary>
    public double DurationSeconds
    {
        get => (double)GetValue(DurationSecondsProperty);
        set => SetValue(DurationSecondsProperty, value);
    }

    /// <summary>Push a new achievement toast.</summary>
    public void Push(string title, string message)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new PanelTitle { Value = title ?? string.Empty });
        if (!string.IsNullOrEmpty(message))
        {
            column.Children.Add(new Text { Value = message });
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        row.Children.Add(new FontIcon { Glyph = "\uE735", Foreground = TypographyTokens.Brush("TsColorSuccessBrush") });
        row.Children.Add(column);

        var card = new Border
        {
            Child = row,
            Padding = new Thickness(14, 12, 14, 12),
            CornerRadius = new CornerRadius(10),
            Background = TypographyTokens.Brush("TsColorSurfaceBrush"),
            BorderBrush = TypographyTokens.Brush("TsColorSuccessBrush"),
            BorderThickness = new Thickness(1),
            MaxWidth = 360,
        };
        AutomationProperties.SetName(card, string.IsNullOrEmpty(message) ? title : $"{title}. {message}");
        _stack.Children.Add(card);
        LiveRegion.Announce(_stack);

        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(Math.Max(1, DurationSeconds)) };
        timer.Tick += (s, _) =>
        {
            timer.Stop();
            _stack.Children.Remove(card);
        };
        timer.Start();
    }
}

/// <summary>A changelog release entry.</summary>
public sealed record ChangelogEntry(string Version, string Date, IReadOnlyList<string> Changes);

/// <summary>
/// "What's new" changelog dialog (mirrors the web <c>ChangelogDialog</c>). Lists
/// <see cref="Entries"/> as versioned change groups inside a focus-trapping
/// <see cref="ContentDialog"/>.
/// </summary>
public partial class TsChangelogDialog : ContentDialog
{
    private readonly StackPanel _list = new() { Spacing = 16 };

    public static readonly DependencyProperty EntriesProperty = DependencyProperty.Register(
        nameof(Entries), typeof(IReadOnlyList<ChangelogEntry>), typeof(TsChangelogDialog),
        new PropertyMetadata(null, OnEntriesChanged));

    public TsChangelogDialog()
    {
        Title = "What's new";
        CloseButtonText = "Close";
        DefaultButton = ContentDialogButton.Close;
        Content = new ScrollViewer { Content = _list, MaxHeight = 480 };
    }

    /// <summary>The release entries to display.</summary>
    public IReadOnlyList<ChangelogEntry>? Entries
    {
        get => (IReadOnlyList<ChangelogEntry>?)GetValue(EntriesProperty);
        set => SetValue(EntriesProperty, value);
    }

    private static void OnEntriesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChangelogDialog)d).Rebuild();

    private void Rebuild()
    {
        _list.Children.Clear();
        foreach (var entry in Entries ?? [])
        {
            var group = new StackPanel { Spacing = 4 };
            var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            header.Children.Add(new PanelTitle { Value = entry.Version });
            header.Children.Add(new Caption { Value = entry.Date, VerticalAlignment = VerticalAlignment.Bottom });
            group.Children.Add(header);

            foreach (var change in entry.Changes ?? [])
            {
                var bullet = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                bullet.Children.Add(new Text { Value = "\u2022" });
                bullet.Children.Add(new Text { Value = change });
                group.Children.Add(bullet);
            }

            _list.Children.Add(group);
        }
    }
}

/// <summary>
/// Accessibility skip link (mirrors the web <c>SkipToContent</c>). Visually
/// hidden until it receives keyboard focus, then offers to move focus to
/// <see cref="Target"/> — letting keyboard / Narrator users bypass navigation.
/// </summary>
public partial class TsSkipToContent : ContentControl
{
    private readonly TsButton _link = new() { Variant = ButtonVariant.Primary };

    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(
        nameof(Text), typeof(string), typeof(TsSkipToContent),
        new PropertyMetadata("Skip to main content", OnTextChanged));

    public static readonly DependencyProperty TargetProperty = DependencyProperty.Register(
        nameof(Target), typeof(Control), typeof(TsSkipToContent),
        new PropertyMetadata(null));

    public TsSkipToContent()
    {
        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        _link.Text = Text;
        _link.Opacity = 0;
        _link.GotFocus += (_, _) => _link.Opacity = 1;
        _link.LostFocus += (_, _) => _link.Opacity = 0;
        _link.Click += (_, _) => MoveFocusToTarget();
        Content = _link;
    }

    /// <summary>Localized link label.</summary>
    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    /// <summary>The control focus jumps to (typically the page's main region).</summary>
    public Control? Target
    {
        get => (Control?)GetValue(TargetProperty);
        set => SetValue(TargetProperty, value);
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSkipToContent)d)._link.Text = (string)e.NewValue;

    private void MoveFocusToTarget() => Target?.Focus(FocusState.Programmatic);
}
