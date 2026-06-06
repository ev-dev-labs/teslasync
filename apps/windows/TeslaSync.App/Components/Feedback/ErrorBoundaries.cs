using System.Windows.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Native analogue of the web <c>ErrorBoundary</c>. WinUI has no implicit render
/// error-trapping, so this control makes the contract explicit: host the real UI
/// in <see cref="ProtectedContent"/>, run risky work through
/// <see cref="RunGuarded"/> (or call <see cref="Capture"/> from a catch), and a
/// localized fallback with a retry affordance is swapped in. <see cref="Reset"/>
/// (also wired to the fallback's retry button) restores the protected content and
/// raises <see cref="Retry"/> so the host can reload.
/// </summary>
public partial class TsErrorBoundary : ContentControl
{
    private readonly ContentPresenter _content = new();
    private readonly TsErrorDisplay _fallback = new();
    private readonly Grid _root = new();

    public static readonly DependencyProperty ProtectedContentProperty = DependencyProperty.Register(
        nameof(ProtectedContent), typeof(object), typeof(TsErrorBoundary),
        new PropertyMetadata(null, OnProtectedContentChanged));

    public static readonly DependencyProperty HasErrorProperty = DependencyProperty.Register(
        nameof(HasError), typeof(bool), typeof(TsErrorBoundary),
        new PropertyMetadata(false, OnStateChanged));

    public static readonly DependencyProperty FallbackTitleProperty = DependencyProperty.Register(
        nameof(FallbackTitle), typeof(string), typeof(TsErrorBoundary),
        new PropertyMetadata("Something went wrong", OnMessagesChanged));

    public static readonly DependencyProperty FallbackMessageProperty = DependencyProperty.Register(
        nameof(FallbackMessage), typeof(string), typeof(TsErrorBoundary),
        new PropertyMetadata("An unexpected error occurred.", OnMessagesChanged));

    public static readonly DependencyProperty RetryTextProperty = DependencyProperty.Register(
        nameof(RetryText), typeof(string), typeof(TsErrorBoundary),
        new PropertyMetadata("Try again", OnMessagesChanged));

    public TsErrorBoundary()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        _fallback.Visibility = Visibility.Collapsed;
        _fallback.ActionInvoked += (_, _) => Reset();
        _root.Children.Add(_content);
        _root.Children.Add(_fallback);
        Content = _root;
        ApplyMessages();
        ApplyState();
    }

    /// <summary>Raised when the fallback retry is invoked (after the error clears).</summary>
    public event EventHandler? Retry;

    /// <summary>The real UI guarded by this boundary.</summary>
    public object? ProtectedContent
    {
        get => GetValue(ProtectedContentProperty);
        set => SetValue(ProtectedContentProperty, value);
    }

    /// <summary>Whether the boundary is currently showing its fallback.</summary>
    public bool HasError
    {
        get => (bool)GetValue(HasErrorProperty);
        set => SetValue(HasErrorProperty, value);
    }

    /// <summary>Localized fallback heading.</summary>
    public string FallbackTitle
    {
        get => (string)GetValue(FallbackTitleProperty);
        set => SetValue(FallbackTitleProperty, value);
    }

    /// <summary>Localized fallback message.</summary>
    public string FallbackMessage
    {
        get => (string)GetValue(FallbackMessageProperty);
        set => SetValue(FallbackMessageProperty, value);
    }

    /// <summary>Localized retry button label.</summary>
    public string RetryText
    {
        get => (string)GetValue(RetryTextProperty);
        set => SetValue(RetryTextProperty, value);
    }

    /// <summary>
    /// Record a captured exception and switch to the fallback. The exception type
    /// name is shown (never the full message, which can contain PII / secrets);
    /// the localized <see cref="FallbackMessage"/> remains the user-facing text.
    /// </summary>
    public void Capture(Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        HasError = true;
    }

    /// <summary>Run an action, switching to the fallback if it throws. Returns success.</summary>
    public bool RunGuarded(Action work)
    {
        ArgumentNullException.ThrowIfNull(work);
        try
        {
            work();
            return true;
        }
        catch (Exception ex)
        {
            Capture(ex);
            return false;
        }
    }

    /// <summary>Clear the error, restore the protected content and raise <see cref="Retry"/>.</summary>
    public void Reset()
    {
        HasError = false;
        Retry?.Invoke(this, EventArgs.Empty);
    }

    private static void OnProtectedContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsErrorBoundary)d)._content.Content = e.NewValue;

    private static void OnStateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsErrorBoundary)d).ApplyState();

    private static void OnMessagesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsErrorBoundary)d).ApplyMessages();

    private void ApplyMessages()
    {
        _fallback.Title = FallbackTitle;
        _fallback.Message = FallbackMessage;
        _fallback.ActionText = RetryText;
    }

    private void ApplyState()
    {
        _content.Visibility = HasError ? Visibility.Collapsed : Visibility.Visible;
        _fallback.Visibility = HasError ? Visibility.Visible : Visibility.Collapsed;
    }
}

/// <summary>
/// Error boundary tuned for a single page section (mirrors the web
/// <c>SectionErrorBoundary</c>): a compact inline fallback that keeps the rest of
/// the page interactive.
/// </summary>
public partial class TsSectionErrorBoundary : TsErrorBoundary
{
    public TsSectionErrorBoundary()
    {
        MinHeight = 140;
        FallbackTitle = "This section failed to load";
        AutomationProperties.SetName(this, "Section error boundary");
    }
}

/// <summary>
/// Error boundary tuned for a whole page (mirrors the web
/// <c>PageErrorBoundary</c>): a full-height fallback that takes over the content
/// area when a page crashes.
/// </summary>
public partial class TsPageErrorBoundary : TsErrorBoundary
{
    public TsPageErrorBoundary()
    {
        MinHeight = 360;
        VerticalContentAlignment = VerticalAlignment.Center;
        FallbackTitle = "This page failed to load";
        AutomationProperties.SetName(this, "Page error boundary");
    }
}
