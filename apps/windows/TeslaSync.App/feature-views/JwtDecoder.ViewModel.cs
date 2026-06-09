using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="JwtDecoder"/> view — the native port of the web
/// <c>JwtDecoderTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx). It owns the current token text (the web
/// <c>useState('')</c>), re-runs the pure <see cref="JwtDecoderCodec"/> decode and re-projects through
/// <see cref="JwtDecoderProjection"/> on every edit (the web <c>useMemo</c> recompute), and exposes the
/// resulting <see cref="Display"/> plus the mutually-exclusive <see cref="State"/> so the view is a thin
/// renderer. The decode is synchronous and runs entirely on this device — there is no asynchronous load — so
/// the only seam is the i18n facade (the web's single <c>useTranslation</c> hook); <see cref="Reload"/>
/// re-resolves every label after the active language changes. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class JwtDecoderViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _jwt;
    private JwtDecoderDisplay _display;

    /// <summary>Creates the holder over the i18n facade and an optional initial token.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="initialJwt">The initial token text (defaults to empty — the web resting state).</param>
    public JwtDecoderViewModel(ILocalizer localizer, string? initialJwt = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _jwt = initialJwt ?? string.Empty;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current token text (the web <c>jwt</c> state).</summary>
    public string Jwt => _jwt;

    /// <summary>The projected, render-ready display for the current token.</summary>
    public JwtDecoderDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(Title));
            Raise(nameof(HasError));
            Raise(nameof(HasHeader));
            Raise(nameof(HasPayload));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public JwtDecoderState State => _display.State;

    /// <summary>The localized card title (also the surface Narrator name).</summary>
    public string Title => _display.Title;

    /// <summary>True when the "Invalid Jwt" failure message is shown (web <c>decoded.error</c>).</summary>
    public bool HasError => _display.HasError;

    /// <summary>True when the decoded-header panel is shown (web <c>decoded.header</c>).</summary>
    public bool HasHeader => _display.HasHeader;

    /// <summary>True when the decoded-payload panel is shown (web <c>decoded.payload</c>).</summary>
    public bool HasPayload => _display.HasPayload;

    /// <summary>
    /// Set the current token and re-decode + re-project — the native analogue of the web textarea
    /// <c>onChange</c> driving the <c>useMemo</c>. A no-op when the text is unchanged so the view is not
    /// re-rendered needlessly.
    /// </summary>
    /// <param name="jwt">The new token text (null is treated as empty).</param>
    public void UpdateText(string? jwt)
    {
        string next = jwt ?? string.Empty;
        if (string.Equals(_jwt, next, StringComparison.Ordinal))
        {
            return;
        }

        _jwt = next;
        Display = Project();
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project the current token — the native analogue of
    /// react-i18next re-rendering the tool after the active language changes.
    /// </summary>
    public void Reload() => Display = Project();

    private JwtDecoderDisplay Project() =>
        JwtDecoderProjection.Project(JwtDecoderCodec.Decode(_jwt), _localizer);

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
