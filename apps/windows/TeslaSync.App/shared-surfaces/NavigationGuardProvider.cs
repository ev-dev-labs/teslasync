using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 navigation-guard context bridge — a parity port of the web
/// <c>useNavigationGuardContext()</c> reader (web/src/components/feedback/NavigationGuardProvider.tsx
/// L231-L234). WinUI has no React context, so the nearest-ancestor lookup is reproduced with an attached
/// <see cref="ControllerProperty"/> set by the provider and the tree-walking reader <see cref="GetNearest"/> —
/// the exact semantics of <c>useContext</c> with the web fallback <c>ctx ?? NOOP_CTX</c>: when no provider is in
/// scope <see cref="GetNearest"/> returns <see cref="NoOpNavigationGuardController.Instance"/> so a
/// guard-registering consumer never blocks navigation and never throws.
/// </summary>
public static class NavigationGuardContext
{
    /// <summary>
    /// The attached controller the provider sets on itself (the React context value). Read the nearest
    /// ancestor's value with <see cref="GetNearest"/> rather than this raw accessor, which returns only an
    /// element's own local value.
    /// </summary>
    public static readonly DependencyProperty ControllerProperty = DependencyProperty.RegisterAttached(
        "Controller",
        typeof(INavigationGuardController),
        typeof(NavigationGuardContext),
        new PropertyMetadata(null));

    /// <summary>Set the provided controller on <paramref name="element"/> (the provider sets this on itself).</summary>
    /// <param name="element">The element that provides the context (the provider).</param>
    /// <param name="value">The controller to provide.</param>
    public static void SetController(DependencyObject element, INavigationGuardController? value)
    {
        ArgumentNullException.ThrowIfNull(element);
        element.SetValue(ControllerProperty, value);
    }

    /// <summary>Read an element's own provided controller (its local attached value); <c>null</c> when it provides none.</summary>
    /// <param name="element">The element to read the local provided value from.</param>
    public static INavigationGuardController? GetController(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);
        return (INavigationGuardController?)element.GetValue(ControllerProperty);
    }

    /// <summary>
    /// Read the controller from the nearest ancestor provider (web <c>useNavigationGuardContext()</c>). Walks up
    /// the visual tree, falling back to the logical parent, and returns the first provided controller — or
    /// <see cref="NoOpNavigationGuardController.Instance"/> when no provider is in scope (the web
    /// <c>ctx ?? NOOP_CTX</c> fallback).
    /// </summary>
    /// <param name="element">The element reading the context (e.g. a dirty form registering its guard).</param>
    public static INavigationGuardController GetNearest(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);

        DependencyObject? current = element;
        while (current is not null)
        {
            if (GetController(current) is { } controller)
            {
                return controller;
            }

            current = GetParentObject(current);
        }

        return NoOpNavigationGuardController.Instance;
    }

    private static DependencyObject? GetParentObject(DependencyObject element)
    {
        DependencyObject? parent = VisualTreeHelper.GetParent(element);
        if (parent is not null)
        {
            return parent;
        }

        // Before the element is in the live visual tree, fall back to the logical parent so the lookup still
        // resolves the provider (e.g. during template realisation or in a detached subtree).
        return element is FrameworkElement frameworkElement ? frameworkElement.Parent : null;
    }
}

/// <summary>
/// The native WinUI 3 navigation-guard provider — a parity port of the web <c>NavigationGuardProvider</c>
/// (web/src/components/feedback/NavigationGuardProvider.tsx). Mounted once around the routed content (like the
/// web component under the router in <c>main.tsx</c>), it provides the process-wide
/// <see cref="INavigationGuardController"/> via <see cref="NavigationGuardContext"/> so a dirty form deep in the
/// tree registers its unsaved-changes guard and a navigation initiator awaits
/// <see cref="INavigationGuardController.ConfirmIfDirtyAsync"/>, and it hosts the warning confirm dialog the web
/// component renders (web <c>ConfirmDialog</c>, L216-L226): an amber warning panel with the blocking guard's
/// message, a "Discard changes" / "Keep editing" choice, and a "Don't ask again" silence checkbox
/// (web <c>silenceKey="unsaved-navigation"</c>). It also intercepts the shell's back affordance (web
/// <c>popstate</c>) and, on Discard, replays the back navigation through the bound navigator (web
/// <c>navigate(-1)</c>).
/// <para>
/// Like the web component it is a transparent wrapper: it renders its <see cref="ContentControl.Content"/>
/// unchanged and contributes no accessible node of its own (<see cref="AccessibilityView.Raw"/>), so Narrator
/// traverses straight to the hosted content; the only accessible surface it raises is the modal confirm dialog,
/// whose title and every button/checkbox carry a Narrator name. State coverage matches the web source exactly:
/// the synchronous in-process model has no loading / error / stale / offline chrome (see
/// <see cref="NavigationGuardState"/>); the states it has — inert (children only) and confirming (the dialog) —
/// are reproduced in full, all driven by the shared <see cref="NavigationGuardProviderViewModel"/>; the view
/// performs no I/O. It emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class NavigationGuardProvider : ContentControl, IDisposable
{
    private const string WarningGlyph = "\uE7BA"; // Segoe Fluent Warning — web Lucide AlertTriangle.
    private const double IconChipSize = 28;       // web rounded chip around the severity icon.
    private const double IconTintOpacity = 0.15;  // web bg-amber-300/15.
    private const double BorderTintOpacity = 0.3; // web border-amber-300/30.
    private const double DialogMinWidth = 320;    // web Modal size="sm".

    private readonly NavigationGuardProviderViewModel _viewModel;
    private readonly NavigationGuardProviderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private TsConfirmDialog? _dialog;
    private TsCheckbox? _silenceCheckbox;
    private bool _showing;
    private bool _resolutionHandled;
    private bool _started;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe provider over the passthrough localizer and the shared process-wide guard
    /// registry + silence store — the native analogue of mounting the web component at the router root.
    /// Production callers use the seam constructor to bind the shell's back affordance and navigator.
    /// </summary>
    public NavigationGuardProvider()
        : this(PassthroughLocalizer.Instance, NavigationGuardRegistry.Shared, InMemoryConfirmSilenceStore.Shared)
    {
    }

    /// <summary>Creates the provider over the i18n facade and the navigation-guard seams (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="registry">The guard-registry seam (web <c>guards</c> map + <c>findDirty</c>).</param>
    /// <param name="silence">The "Don't ask again" persistence seam (web <c>lib/confirmSilence</c>).</param>
    /// <param name="navigator">The back-navigation replay seam (web <c>navigate(-1)</c>); when null the deferred back is a no-op.</param>
    /// <param name="backSource">The intercepted back-navigation source (web <c>popstate</c>); when null no back is intercepted.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / confirm lifecycle events.</param>
    public NavigationGuardProvider(
        ILocalizer localizer,
        INavigationGuardRegistry registry,
        IConfirmSilenceStore silence,
        INavigationGuardNavigator? navigator = null,
        INavigationBackSource? backSource = null,
        NavigationGuardProviderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(silence);

        _diagnostics = diagnostics ?? new NavigationGuardProviderDiagnostics();
        _viewModel = new NavigationGuardProviderViewModel(registry, silence, localizer, navigator, backSource, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web provider renders a bare children fragment plus an out-of-flow
        // dialog, so hide the wrapper from Narrator and let the hosted content carry the semantics.
        AutomationProperties.SetAccessibilityView(
            this,
            NavigationGuardAccessibility.ProviderContributesAccessibleNode ? AccessibilityView.Content : AccessibilityView.Raw);

        // Publish the context value to descendants (web NavigationGuardContext.Provider value={ctxValue}).
        NavigationGuardContext.SetController(this, _viewModel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface slug (<c>NavigationGuardProvider</c>).</summary>
    public static string Slug => NavigationGuardProviderRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public NavigationGuardProviderViewModel ViewModel => _viewModel;

    /// <summary>The provided navigation-guard context value (web context value) — the same instance as <see cref="ViewModel"/>.</summary>
    public INavigationGuardController Controller => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        DismissDialog();
        NavigationGuardContext.SetController(this, null);
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new NavigationGuardProviderAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;

            // Mirror the web provider mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // A confirm may already be pending (a guard blocked navigation before the XamlRoot was ready); present it
        // now that the element is live.
        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsConfirming && !_showing)
        {
            _ = PresentDialogAsync();
        }
        else if (!_viewModel.IsConfirming && _showing && !_resolutionHandled)
        {
            DismissDialog();
        }
    }

    private async System.Threading.Tasks.Task PresentDialogAsync()
    {
        if (_showing || _disposed || XamlRoot is not { } xamlRoot)
        {
            return;
        }

        _showing = true;
        _resolutionHandled = false;

        var dialog = BuildDialog();
        dialog.XamlRoot = xamlRoot;
        dialog.PrimaryButtonClick += OnPrimaryButtonClick;
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog already owns this XamlRoot — the host owns ordering; surface nothing.
            dialog.PrimaryButtonClick -= OnPrimaryButtonClick;
            dialog.CloseButtonClick -= OnCloseButtonClick;
            dialog.Closed -= OnDialogClosed;
            _showing = false;
            _dialog = null;
            _silenceCheckbox = null;
        }
    }

    private TsConfirmDialog BuildDialog()
    {
        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.Title,
            PrimaryButtonText = _viewModel.ConfirmLabel,
            CloseButtonText = _viewModel.CancelLabel,
            IsDestructive = false, // web variant="warning" — not the destructive (danger) variant.
            Content = BuildDialogBody(),
        };
        AutomationProperties.SetName(dialog, _viewModel.DialogAutomationName);
        return dialog;
    }

    private StackPanel BuildDialogBody()
    {
        var icon = new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var iconChip = new Border
        {
            Width = IconChipSize,
            Height = IconChipSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            Background = TintBrush(IconTintOpacity),
            VerticalAlignment = VerticalAlignment.Top,
            Child = icon,
        };
        Grid.SetColumn(iconChip, 0);

        var message = new Text
        {
            Value = _viewModel.Message,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(message, _viewModel.Message);
        Grid.SetColumn(message, 1);

        var panel = new Grid { ColumnSpacing = 12 };
        panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        panel.Children.Add(iconChip);
        panel.Children.Add(message);

        // web severity panel: flex items-start gap-3 rounded-lg border p-3 bg-amber-300/15 border-amber-300/30.
        var severityCard = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 8),
            Background = TintBrush(IconTintOpacity),
            BorderBrush = TintBrush(BorderTintOpacity),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12),
            Child = panel,
        };

        var body = new StackPanel { Spacing = 16, MinWidth = DialogMinWidth };
        body.Children.Add(severityCard);

        if (_viewModel.ShowSilenceOption)
        {
            // web "Don't ask again for this action" checkbox (ConfirmDialog silenceKey honored).
            var checkbox = new TsCheckbox { Content = _viewModel.SilenceCheckboxLabel };
            AutomationProperties.SetName(checkbox, _viewModel.SilenceCheckboxLabel);
            _silenceCheckbox = checkbox;
            body.Children.Add(checkbox);
        }
        else
        {
            _silenceCheckbox = null;
        }

        return body;
    }

    private static SolidColorBrush TintBrush(double opacity)
    {
        if (DisplayTokens.Brush("TsColorWarningBrush") is SolidColorBrush warning)
        {
            return new SolidColorBrush(warning.Color) { Opacity = opacity };
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        // web onConfirm → handleConfirm (+ ConfirmDialog handleConfirmClick silence write when ticked).
        _resolutionHandled = true;
        bool dontAskAgain = _silenceCheckbox?.IsChecked == true;
        _viewModel.Confirm(dontAskAgain);
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        // web onCancel → handleCancel.
        _resolutionHandled = true;
        _viewModel.Cancel();
    }

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.PrimaryButtonClick -= OnPrimaryButtonClick;
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;

        bool handled = _resolutionHandled;
        _resolutionHandled = false;
        _showing = false;
        _dialog = null;
        _silenceCheckbox = null;

        // An Esc / light-dismiss with no button maps to the web Modal onClose → handleCancel (keep editing).
        if (!handled && !_disposed)
        {
            _viewModel.Cancel();
        }
    }

    private void DismissDialog()
    {
        if (_dialog is null)
        {
            return;
        }

        // Programmatic close (state changed externally / teardown): the resolution is already handled, so the
        // Closed handler must not re-resolve.
        _resolutionHandled = true;
        _dialog.Hide();
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class NavigationGuardProviderAutomationPeer(NavigationGuardProvider owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override bool IsControlElementCore() =>
            NavigationGuardAccessibility.ProviderContributesAccessibleNode && base.IsControlElementCore();
    }
}
