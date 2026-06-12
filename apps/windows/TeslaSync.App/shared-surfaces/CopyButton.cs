using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 copy surface — a parity port of the web <c>CopyButton</c>
/// (web/src/components/ui/CopyButton.tsx). It renders a single ghost button that copies a caller-supplied string
/// (<see cref="Text"/>) to the clipboard, swaps its icon + label from "Copy" (copy glyph) to "Copied" (check
/// glyph) for two seconds, and — when <see cref="WithToast"/> is set and a toast overlay is hosted — announces the
/// outcome on the shared toast queue. The button is a <see cref="TsButton"/> (the web <c>Button</c> primitive),
/// defaulting to the subtle/small variant (web <c>variant="ghost" size="sm"</c>) with a leading copy icon that
/// becomes a check on success. All state flows through the shared <see cref="CopyButtonViewModel"/>; the view
/// performs only the platform clipboard write (through <see cref="SystemClipboardCopier"/>) and the two-second
/// revert timer (web <c>setTimeout(() =&gt; setCopied(false), 2000)</c>). Every label resolves through the i18n
/// facade.
///
/// <para>
/// State coverage: the web source is a presentational control with no data fetch — it issues no query, so it has
/// no loading / empty / error / stale / offline chrome to reproduce. The states it actually has are reproduced in
/// full: idle ("Copy" + copy icon), copied ("Copied" + check icon for two seconds, then auto-revert), disabled
/// (via <see cref="Disabled"/>, the web <c>disabled</c> prop), icon-only (via <see cref="IconOnly"/>, label
/// dropped with an accessible name retained) and the two click outcomes — success (confirmation, the
/// <see cref="OnCopy"/> callback, and an optional success toast) and failure (an optional error toast plus a
/// failed-write diagnostic, staying idle).
/// </para>
/// </summary>
public sealed partial class CopyButton : ContentControl, IDisposable
{
    private const string CopyGlyph = "\uE8C8";    // Segoe Fluent "Copy" — the web Copy idle icon.
    private const string CopiedGlyph = "\uE73E";  // Segoe Fluent "CheckMark" — the web CheckCircle confirmation icon.
    private const double IconSize = 14;           // web h-3.5 w-3.5.

    private readonly CopyButtonViewModel _viewModel;
    private readonly CopyButtonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _button;
    private readonly DispatcherTimer _revertTimer;

    private bool _disabled;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface bound to the platform clipboard, a fresh headless toast queue and the
    /// passthrough localizer — the native analogue of mounting the web component in an isolated host. Production
    /// callers use the seam constructor.
    /// </summary>
    public CopyButton()
        : this(
            SystemClipboardCopier.Instance,
            new ToastController(),
            PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its clipboard seam, the optional shared toast queue, localizer and diagnostics.</summary>
    /// <param name="clipboard">The clipboard-write seam (web <c>navigator.clipboard.writeText</c>).</param>
    /// <param name="toast">The shared toast queue (web <c>useOptionalToast()</c>); may be null when no overlay is hosted.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> and <c>copy.failed</c> events.</param>
    public CopyButton(
        IClipboardCopier clipboard,
        IToastController? toast,
        ILocalizer localizer,
        CopyButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new CopyButtonDiagnostics();
        _viewModel = new CopyButtonViewModel(clipboard, toast, localizer, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            FontSize = IconSize,
        };
        _button.Click += OnButtonClick;

        _revertTimer = new DispatcherTimer { Interval = CopyButtonRegistration.RevertDelay };
        _revertTimer.Tick += OnRevertTick;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is the button itself, so the surface hides itself from
        // Narrator and lets the button carry the accessible semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _button;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>CopyButton</c>).</summary>
    public static string Slug => CopyButtonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public CopyButtonViewModel ViewModel => _viewModel;

    /// <summary>The value copied to the clipboard (web <c>text</c> prop).</summary>
    public string Text
    {
        get => _viewModel.Text;
        set => _viewModel.Text = value;
    }

    /// <summary>Override of the default "Copy" / "Copied" label (web <c>label</c> prop).</summary>
    public string? Label
    {
        get => _viewModel.LabelOverride;
        set => _viewModel.LabelOverride = value;
    }

    /// <summary>Whether to render only the icon, dropping the visible label (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly
    {
        get => _viewModel.IconOnly;
        set => _viewModel.IconOnly = value;
    }

    /// <summary>Whether a success/failure toast is raised on copy (web <c>withToast</c> prop, default off).</summary>
    public bool WithToast
    {
        get => _viewModel.WithToast;
        set => _viewModel.WithToast = value;
    }

    /// <summary>Optional accessible-name override (web <c>ariaLabel</c> prop).</summary>
    public string? AriaLabel
    {
        get => _viewModel.AriaLabelOverride;
        set => _viewModel.AriaLabelOverride = value;
    }

    /// <summary>Optional callback invoked after a successful copy (web <c>onCopy</c> prop).</summary>
    public Action? OnCopy
    {
        get => _viewModel.OnCopy;
        set => _viewModel.OnCopy = value;
    }

    /// <summary>Visual emphasis variant of the underlying button (web <c>variant</c>, default subtle/ghost).</summary>
    public ButtonVariant Variant
    {
        get => _button.Variant;
        set => _button.Variant = value;
    }

    /// <summary>Sizing scale of the underlying button (web <c>size</c>, default small).</summary>
    public ControlSize Size
    {
        get => _button.Size;
        set => _button.Size = value;
    }

    /// <summary>Whether the button is disabled and ignores clicks (web <c>disabled</c> prop).</summary>
    public bool Disabled
    {
        get => _disabled;
        set
        {
            _disabled = value;
            _button.IsEnabled = !value;
        }
    }

    /// <summary>Optional native tooltip shown on hover (web <c>title</c> prop).</summary>
    public string? Title
    {
        get => ToolTipService.GetToolTip(_button) as string;
        set => ToolTipService.SetToolTip(_button, value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _revertTimer.Stop();
        _revertTimer.Tick -= OnRevertTick;
        _button.Click -= OnButtonClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new CopyButtonAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnButtonClick(object sender, RoutedEventArgs e)
    {
        // web: a disabled Button never fires onClick — guard defensively in case IsEnabled was bypassed.
        if (_disabled)
        {
            return;
        }

        _viewModel.Copy();
    }

    private void OnRevertTick(object? sender, object e)
    {
        // web: setTimeout(() => setCopied(false), 2000) — one-shot revert back to the idle label/icon.
        _revertTimer.Stop();
        _viewModel.ResetCopied();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _button.IconGlyph = _viewModel.ShowCheckIcon ? CopiedGlyph : CopyGlyph;
        _button.Text = _viewModel.VisibleLabel;

        // The accessible name: the resolved aria-label when present (icon-only or explicit override), otherwise
        // the visible text so the control is never unlabelled. Set after Text so it wins over TsButton's
        // text-derived default name.
        AutomationProperties.SetName(
            _button,
            _viewModel.ResolvedAriaLabel ?? _viewModel.VisibleLabel ?? string.Empty);

        // Arm the one-shot revert timer when the confirmation state is entered (web setTimeout on setCopied(true)).
        if (_viewModel.IsCopied)
        {
            _revertTimer.Stop();
            _revertTimer.Start();
        }
        else
        {
            _revertTimer.Stop();
        }
    }

    private sealed class CopyButtonAutomationPeer : FrameworkElementAutomationPeer
    {
        public CopyButtonAutomationPeer(CopyButton owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }

            CopyButtonViewModel vm = ((CopyButton)Owner).ViewModel;
            return vm.ResolvedAriaLabel ?? vm.VisibleLabel ?? string.Empty;
        }
    }
}

/// <summary>
/// The production <see cref="IClipboardCopier"/> — the WinUI host's clipboard binding (the native analogue of the
/// web <c>navigator.clipboard.writeText</c> primary path). It packages the text and calls
/// <see cref="Clipboard.SetContent(DataPackage)"/>, returning <see langword="true"/> on success and swallowing any
/// platform failure (e.g. the clipboard being locked by another process) as <see langword="false"/> so the
/// view-model takes the failure path — reproducing the web component's <c>try</c> / <c>catch</c>. The synchronous
/// WinRT call is wrapped in a completed task so the seam stays awaitable.
/// </summary>
public sealed class SystemClipboardCopier : IClipboardCopier
{
    /// <summary>The shared copier instance.</summary>
    public static SystemClipboardCopier Instance { get; } = new();

    private SystemClipboardCopier()
    {
    }

    /// <inheritdoc />
    public Task<bool> CopyTextAsync(string text)
    {
        try
        {
            var package = new DataPackage();
            package.SetText(text ?? string.Empty);
            Clipboard.SetContent(package);
            return Task.FromResult(true);
        }
        catch (Exception)
        {
            // web catch path: navigator.clipboard.writeText rejected (e.g. clipboard locked / unavailable) — the
            // view-model maps a failed write to the failure path (optional error toast + failed-write diagnostic).
            return Task.FromResult(false);
        }
    }
}
