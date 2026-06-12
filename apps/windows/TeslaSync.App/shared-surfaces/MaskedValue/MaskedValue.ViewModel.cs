using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.MaskedValueSurface;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MaskedValue"/> view — the native port of the web
/// component body (web/src/components/ui/MaskedValue.tsx). It mirrors the web source's behaviour exactly:
///
/// <list type="bullet">
///   <item>the controlled <see cref="IsRevealed"/> flag (web <c>const [revealed, setRevealed] =
///   useState(false)</c>), masked on first render, that swaps the code text between the masked projection and
///   the cleartext and flips the toggle between its reveal ("eye") and hide ("eye-off") affordances;</item>
///   <item>the inputs that shape rendering — <see cref="Value"/> (web <c>value</c>), <see cref="Variant"/>
///   (web <c>variant</c>), <see cref="ShowLast"/> (web <c>showLast</c>), <see cref="Copyable"/> (web
///   <c>copyable</c>), <see cref="AuditOnReveal"/> (web <c>auditOnReveal</c>), <see cref="AriaLabel"/> (web
///   <c>ariaLabel</c>) and <see cref="AutoHideMs"/> (web <c>autoHideMs</c>, default 30 000);</item>
///   <item>the <c>reveal</c> / <c>hide</c> routing — <see cref="Reveal"/> is a no-op on an empty value (web
///   <c>if (raw.length === 0) return</c>), otherwise it reveals and, when <see cref="AuditOnReveal"/> is set,
///   fires the best-effort reveal audit (web <c>postRevealAudit(variant)</c>); <see cref="Hide"/> re-masks;</item>
///   <item>the empty-value branch (web <c>raw.length === 0</c>) that renders the em-dash with no toggle and no
///   copy affordance — surfaced as <see cref="IsEmpty"/> / <see cref="DisplayText"/> / <see cref="ShowToggle"/>
///   / <see cref="ShowCopy"/>.</item>
/// </list>
///
/// The 30-second auto-hide (web <c>setTimeout(() =&gt; setRevealed(false), autoHideMs)</c>) is a view concern:
/// the view arms a one-shot timer keyed off <see cref="IsRevealed"/> + <see cref="AutoHideMs"/> and calls
/// <see cref="Hide"/>, keeping this holder free of UI-thread/timer concerns and unit-testable headlessly. The
/// reveal audit is fire-and-forget and never throws. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class MaskedValueViewModel : INotifyPropertyChanged
{
    private readonly IRevealAuditSink _audit;
    private readonly ILocalizer _localizer;
    private readonly MaskedValueDiagnostics? _diagnostics;

    private string _value = string.Empty;
    private MaskedValueVariant _variant = MaskedValueVariant.Generic;
    private int? _showLast;
    private bool _copyable;
    private bool _auditOnReveal;
    private string _ariaLabel = string.Empty;
    private int _autoHideMs = MaskedValueRegistration.DefaultAutoHideMs;
    private bool _isRevealed;

    /// <summary>Creates the holder over its reveal-audit seam (P1/S8) and the i18n facade.</summary>
    /// <param name="audit">The reveal-audit seam (web <c>postRevealAudit</c>); inert by default.</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MaskedValueViewModel(
        IRevealAuditSink audit,
        ILocalizer localizer,
        MaskedValueDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(audit);
        ArgumentNullException.ThrowIfNull(localizer);

        _audit = audit;
        _localizer = localizer;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>MaskedValue</c>).</summary>
    public static string Slug => MaskedValueRegistration.Slug;

    /// <summary>The diagnostics collector backing this holder (exposed for the view / tests).</summary>
    public MaskedValueDiagnostics? Diagnostics => _diagnostics;

    /// <summary>The raw value to mask (web <c>value</c>); null/empty renders the em-dash with no toggle.</summary>
    public string? Value
    {
        get => _value;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_value, next, StringComparison.Ordinal))
            {
                return;
            }

            _value = next;
            Raise(nameof(Value));
            Raise(nameof(Raw));
            Raise(nameof(IsEmpty));
            Raise(nameof(MaskedText));
            Raise(nameof(CodeText));
            Raise(nameof(DisplayText));
            Raise(nameof(ShowToggle));
            Raise(nameof(ShowCopy));
        }
    }

    /// <summary>The masking strategy (web <c>variant</c>).</summary>
    public MaskedValueVariant Variant
    {
        get => _variant;
        set
        {
            if (_variant == value)
            {
                return;
            }

            _variant = value;
            Raise(nameof(Variant));
            Raise(nameof(MaskedText));
            Raise(nameof(CodeText));
            Raise(nameof(DisplayText));
            Raise(nameof(VariantWireName));
        }
    }

    /// <summary>Optional override of the variant's default visible-suffix length (web <c>showLast</c>).</summary>
    public int? ShowLast
    {
        get => _showLast;
        set
        {
            if (_showLast == value)
            {
                return;
            }

            _showLast = value;
            Raise(nameof(ShowLast));
            Raise(nameof(MaskedText));
            Raise(nameof(CodeText));
            Raise(nameof(DisplayText));
        }
    }

    /// <summary>Whether a copy affordance that copies the cleartext is shown (web <c>copyable</c>, default off).</summary>
    public bool Copyable
    {
        get => _copyable;
        set
        {
            if (_copyable == value)
            {
                return;
            }

            _copyable = value;
            Raise(nameof(Copyable));
            Raise(nameof(ShowCopy));
        }
    }

    /// <summary>Whether each reveal posts the best-effort reveal audit (web <c>auditOnReveal</c>, default off).</summary>
    public bool AuditOnReveal
    {
        get => _auditOnReveal;
        set
        {
            if (_auditOnReveal == value)
            {
                return;
            }

            _auditOnReveal = value;
            Raise(nameof(AuditOnReveal));
        }
    }

    /// <summary>The human-readable accessible name for the surface (web required <c>ariaLabel</c>).</summary>
    public string AriaLabel
    {
        get => _ariaLabel;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_ariaLabel, next, StringComparison.Ordinal))
            {
                return;
            }

            _ariaLabel = next;
            Raise(nameof(AriaLabel));
        }
    }

    /// <summary>The auto-hide lifetime in milliseconds (web <c>autoHideMs</c>); 0 or less disables auto-hide.</summary>
    public int AutoHideMs
    {
        get => _autoHideMs;
        set
        {
            if (_autoHideMs == value)
            {
                return;
            }

            _autoHideMs = value;
            Raise(nameof(AutoHideMs));
            Raise(nameof(AutoHide));
        }
    }

    /// <summary>The raw value, never null (web <c>raw = value ?? ''</c>).</summary>
    public string Raw => _value;

    /// <summary>Whether the value is empty — the web <c>raw.length === 0</c> em-dash branch.</summary>
    public bool IsEmpty => _value.Length == 0;

    /// <summary>Whether the value is currently revealed (web <c>revealed</c> state); masked on first render.</summary>
    public bool IsRevealed => _isRevealed;

    /// <summary>The masked projection of the raw value (web <c>maskFor(raw, variant, showLast)</c>).</summary>
    public string MaskedText => MaskedValueProjection.Mask(_value, _variant, _showLast);

    /// <summary>
    /// The text of the code element when the value is present (web <c>revealed ? raw : masked</c>): the
    /// cleartext while revealed, otherwise the masked projection.
    /// </summary>
    public string CodeText => _isRevealed ? _value : MaskedText;

    /// <summary>
    /// The text actually rendered: the em-dash when the value is empty (web missing-data convention), otherwise
    /// <see cref="CodeText"/>.
    /// </summary>
    public string DisplayText => IsEmpty ? MaskedValueProjection.EmDash : CodeText;

    /// <summary>Whether the reveal/hide toggle is shown — only for a non-empty value (web empty branch has none).</summary>
    public bool ShowToggle => !IsEmpty;

    /// <summary>Whether the copy affordance is shown (web <c>copyable</c> and a non-empty value).</summary>
    public bool ShowCopy => _copyable && !IsEmpty;

    /// <summary>Whether to show the hide ("eye-off") icon rather than the reveal ("eye") icon (web <c>revealed</c>).</summary>
    public bool ShowEyeOffIcon => _isRevealed;

    /// <summary>The hide-toggle label (web <c>mask.hide</c> → "Hide value").</summary>
    public string HideLabel => _localizer.GetString(MaskedValueRegistration.HideKey, MaskedValueRegistration.HideFallback);

    /// <summary>The reveal-toggle label (web <c>mask.reveal</c> → "Reveal value").</summary>
    public string RevealLabel =>
        _localizer.GetString(MaskedValueRegistration.RevealKey, MaskedValueRegistration.RevealFallback);

    /// <summary>The copy affordance's accessible name (web <c>mask.copy</c> → "Copy value").</summary>
    public string CopyLabel => _localizer.GetString(MaskedValueRegistration.CopyKey, MaskedValueRegistration.CopyFallback);

    /// <summary>
    /// The current toggle label (web <c>revealed ? t('mask.hide') : t('mask.reveal')</c>): the hide label while
    /// revealed, otherwise the reveal label.
    /// </summary>
    public string ToggleLabel => _isRevealed ? HideLabel : RevealLabel;

    /// <summary>The wire identifier sent to the reveal audit for the current variant (web <c>variant</c>).</summary>
    public string VariantWireName => MaskedValueProjection.WireName(_variant);

    /// <summary>The auto-hide lifetime as a <see cref="TimeSpan"/>, for the view's one-shot timer.</summary>
    public TimeSpan AutoHide => TimeSpan.FromMilliseconds(_autoHideMs);

    /// <summary>
    /// Reveal the value (web <c>reveal</c>). A no-op on an empty value (web <c>if (raw.length === 0) return</c>);
    /// otherwise it enters the revealed state and, when <see cref="AuditOnReveal"/> is set, fires the
    /// best-effort reveal audit. The auto-hide timer is the view's concern.
    /// </summary>
    public void Reveal()
    {
        if (IsEmpty)
        {
            return;
        }

        SetRevealed(true);

        if (_auditOnReveal)
        {
            FireRevealAudit();
        }
    }

    /// <summary>Re-mask the value (web <c>hide</c>); also clears the view's auto-hide timer.</summary>
    public void Hide() => SetRevealed(false);

    /// <summary>
    /// Toggle reveal/hide (web <c>onClick={revealed ? hide : reveal}</c>): hide while revealed, otherwise reveal.
    /// </summary>
    public void Toggle()
    {
        if (_isRevealed)
        {
            Hide();
        }
        else
        {
            Reveal();
        }
    }

    private void SetRevealed(bool revealed)
    {
        if (_isRevealed == revealed)
        {
            return;
        }

        _isRevealed = revealed;
        Raise(nameof(IsRevealed));
        Raise(nameof(ShowEyeOffIcon));
        Raise(nameof(ToggleLabel));
        Raise(nameof(CodeText));
        Raise(nameof(DisplayText));
    }

    private void FireRevealAudit()
    {
        // web postRevealAudit: fire-and-forget; a synchronous throw or a rejected promise is swallowed so the
        // audit (defense-in-depth) never interferes with the reveal UX.
        try
        {
            _ = _audit.PostRevealAsync(VariantWireName);
        }
        catch
        {
            // silent by design — the visible mask, not the audit, is the primary protection.
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
