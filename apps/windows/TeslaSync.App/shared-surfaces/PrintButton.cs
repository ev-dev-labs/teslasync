using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Graphics.Printing;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 print surface — a parity port of the web <c>PrintButton</c>
/// (web/src/components/ui/PrintButton.tsx). It renders a single ghost button that opens the platform print
/// experience for the current view, optionally running a caller-supplied <see cref="BeforePrint"/> hook first
/// (expand panels, switch tabs) and ignoring re-entrant clicks while a print is in flight. The button is a
/// <see cref="TsButton"/> (the web <c>Button</c> primitive), defaulting to the subtle/small variant (web
/// <c>variant="ghost" size="sm"</c>) with a leading printer icon (web <c>&lt;Printer /&gt;</c>). All state flows
/// through the shared <see cref="PrintButtonViewModel"/>; the view performs only the platform print invocation
/// (through <see cref="SystemPrintInvoker"/>) and the marshalling of view-model changes onto the UI thread. Every
/// label resolves through the i18n facade.
///
/// <para>
/// State coverage: the web source is a presentational control with no data fetch — it issues no query, so (like
/// the shipped <c>CopyButton</c> / <c>FullscreenButton</c> surfaces) it has no loading / empty / error / stale /
/// offline chrome to reproduce. The states it actually has are reproduced in full: idle ("Print" + printer icon),
/// printing (the busy flag set for the duration of the click, guarding re-entrancy — the web shows no visual busy
/// affordance), disabled (via <see cref="Disabled"/>, the web <c>disabled</c> prop), icon-only (via
/// <see cref="IconOnly"/>, label dropped with an accessible name retained) and the two click outcomes — success
/// (the print experience opens) and failure (a thrown <see cref="BeforePrint"/> hook, or the print experience
/// failing to open, both recorded and returning to idle).
/// </para>
///
/// <para>
/// Parity note: the web button carries <c>data-print-hide</c> so the page's <c>@media print</c> stylesheet drops
/// it from the printed output. WinUI prints an explicit print-document source rather than a snapshot of the live
/// visual tree, so the button is inherently absent from the printed page and the attribute has no native analogue.
/// </para>
/// </summary>
public sealed partial class PrintButton : ContentControl, IDisposable
{
    private const string PrinterGlyph = "\uE749";  // Segoe Fluent "Print" — the web Printer lucide icon.
    private const double IconSize = 14;             // web h-3.5 w-3.5.

    private readonly PrintButtonViewModel _viewModel;
    private readonly PrintButtonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _button;

    private bool _disabled;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface bound to the inert print invoker and the passthrough localizer — the native
    /// analogue of mounting the web component in an isolated host with no print document wired. Production callers
    /// use the seam constructor with a <see cref="SystemPrintInvoker"/> over the host window handle.
    /// </summary>
    public PrintButton()
        : this(NoOpPrintInvoker.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its print seam, localizer and diagnostics.</summary>
    /// <param name="printer">The print-trigger seam (web <c>window.print()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> and <c>print.failed</c> events.</param>
    public PrintButton(
        IPrintInvoker printer,
        ILocalizer localizer,
        PrintButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(printer);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new PrintButtonDiagnostics();
        _viewModel = new PrintButtonViewModel(printer, localizer, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            FontSize = IconSize,
        };
        _button.Click += OnButtonClick;

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

    /// <summary>The canonical surface slug (<c>PrintButton</c>).</summary>
    public static string Slug => PrintButtonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PrintButtonViewModel ViewModel => _viewModel;

    /// <summary>Override of the default "Print" label (web <c>label</c> prop).</summary>
    public string? Label
    {
        get => _viewModel.LabelOverride;
        set => _viewModel.LabelOverride = value;
    }

    /// <summary>Whether to render only the printer icon, dropping the visible label (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly
    {
        get => _viewModel.IconOnly;
        set => _viewModel.IconOnly = value;
    }

    /// <summary>Optional accessible-name override (web <c>ariaLabel</c> prop).</summary>
    public string? AriaLabel
    {
        get => _viewModel.AriaLabelOverride;
        set => _viewModel.AriaLabelOverride = value;
    }

    /// <summary>
    /// Optional setup hook run before the print experience opens (web <c>beforePrint</c> prop) — e.g. expand
    /// collapsed sections. Awaited in full before the dialog opens; if it throws, the surface stays idle.
    /// </summary>
    public Func<Task>? BeforePrint
    {
        get => _viewModel.BeforePrint;
        set => _viewModel.BeforePrint = value;
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

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _button.Click -= OnButtonClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PrintButtonAutomationPeer(this);

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

        _viewModel.Print();
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
        _button.IconGlyph = PrinterGlyph;
        _button.Text = _viewModel.VisibleLabel;

        // The accessible name: the resolved aria-label when present (icon-only or explicit override), otherwise
        // the visible text so the control is never unlabelled. Set after Text so it wins over TsButton's
        // text-derived default name.
        AutomationProperties.SetName(
            _button,
            _viewModel.ResolvedAriaLabel ?? _viewModel.VisibleLabel ?? string.Empty);
    }

    private sealed class PrintButtonAutomationPeer : FrameworkElementAutomationPeer
    {
        public PrintButtonAutomationPeer(PrintButton owner)
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

            PrintButtonViewModel vm = ((PrintButton)Owner).ViewModel;
            return vm.ResolvedAriaLabel ?? vm.VisibleLabel ?? string.Empty;
        }
    }
}

/// <summary>
/// The production <see cref="IPrintInvoker"/> — the WinUI host's print binding (the native analogue of the web
/// <c>window.print()</c> primary path). It opens the Windows system print experience for the host window via
/// <see cref="PrintManagerInterop.ShowPrintUIForWindowAsync(IntPtr)"/>, returning the platform's "was shown"
/// result and swallowing any failure (e.g. the host has not registered a print task, or the user dismissed the
/// experience) as <see langword="false"/> so the view-model takes the failure path — reproducing the web
/// component's resilient <c>try</c> / <c>finally</c> around <c>window.print()</c>. The host supplies the printed
/// document by registering a <c>PrintManager.PrintTaskRequested</c> handler for the same window, exactly as the
/// web page supplies it through its <c>@media print</c> stylesheet.
/// </summary>
public sealed class SystemPrintInvoker : IPrintInvoker
{
    private readonly IntPtr _windowHandle;

    /// <summary>Creates the invoker over the handle of the window whose print experience is opened.</summary>
    /// <param name="windowHandle">The host window handle (HWND) the print UI is shown for.</param>
    public SystemPrintInvoker(IntPtr windowHandle) => _windowHandle = windowHandle;

    /// <inheritdoc />
    public async Task<bool> PrintAsync()
    {
        try
        {
            return await PrintManagerInterop.ShowPrintUIForWindowAsync(_windowHandle).AsTask().ConfigureAwait(false);
        }
        catch (Exception)
        {
            // web finally path: window.print() failing (no print path, dismissed, locked) maps to a failed open;
            // the view-model records it and returns to idle rather than surfacing a platform exception.
            return false;
        }
    }
}
