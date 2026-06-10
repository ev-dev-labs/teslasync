using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RequestBuilder"/> view — the native port of the
/// web <c>RequestBuilder</c> component's local state (the <c>useState</c> field values, body, API key and the
/// destructive <c>confirmOpen</c> latch, plus the endpoint-change reset <c>useEffect</c>) in
/// web/src/features/admin/components/RequestBuilder.tsx. The web component is presentational: its endpoint and
/// loading flag arrive as props and its only hook is <c>useTranslation</c>, so there is no asynchronous load —
/// the single seam is the i18n facade and the injected <c>onSend</c> callback. This holder owns the per-field
/// values, the request body, the API key, the confirm latch and the loading flag; it recomputes the
/// render-ready <see cref="Display"/> on demand through the pure <see cref="RequestBuilderProjection"/>. The
/// send action reproduces the web <c>handleSend</c> two-step guard: a non-GET request first arms the confirm
/// banner, and only a confirmed (or GET) send echoes the assembled <see cref="OutgoingRequest"/> to the
/// <c>onSend</c> callback. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RequestBuilderViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly Action<OutgoingRequest>? _onSend;
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

    private ParsedEndpoint _endpoint;
    private string _body = string.Empty;
    private string _apiKey = string.Empty;
    private bool _confirmOpen;
    private bool _loading;

    /// <summary>Creates the holder over the i18n facade, the initial endpoint and the optional props.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string (web <c>useTranslation</c>).</param>
    /// <param name="endpoint">The initial endpoint (web <c>endpoint</c> prop).</param>
    /// <param name="onSend">The send callback (web <c>onSend</c> prop); invoked on a confirmed send.</param>
    /// <param name="loading">The initial loading flag (web <c>loading</c> prop).</param>
    public RequestBuilderViewModel(
        ILocalizer localizer,
        ParsedEndpoint endpoint,
        Action<OutgoingRequest>? onSend = null,
        bool loading = false)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(endpoint);

        _localizer = localizer;
        _endpoint = endpoint;
        _onSend = onSend;
        _loading = loading;
        SeedFromEndpoint(endpoint);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The currently selected endpoint (web <c>endpoint</c> prop).</summary>
    public ParsedEndpoint Endpoint => _endpoint;

    /// <summary>Whether a send is in flight (web <c>loading</c> prop) — the send button spins and disables.</summary>
    public bool Loading => _loading;

    /// <summary>Whether the destructive-confirm banner is armed (web <c>confirmOpen</c>).</summary>
    public bool ConfirmOpen => _confirmOpen;

    /// <summary>The current request-body text.</summary>
    public string Body => _body;

    /// <summary>The current API-key value (kept across endpoint changes, as on the web).</summary>
    public string ApiKey => _apiKey;

    /// <summary>A snapshot of the current field values keyed by parameter name.</summary>
    public IReadOnlyDictionary<string, string> Values => new Dictionary<string, string>(_values, StringComparer.Ordinal);

    /// <summary>
    /// The render-ready projection of the current inputs — recomputed on each read so it always reflects the
    /// latest field values, body, API key, confirm latch and loading flag. The projection is cheap (a bounded
    /// walk over the endpoint's parameters), so the view reads it on each rebuild and tests read it directly.
    /// </summary>
    public RequestBuilderDisplay Display =>
        RequestBuilderProjection.Project(_endpoint, _values, _body, _apiKey, _confirmOpen, _loading, _localizer);

    /// <summary>
    /// Replace the endpoint (the web <c>endpoint</c> prop changing) and reset the form — the native port of the
    /// endpoint-change <c>useEffect</c>: the field values are reseeded from the parameter defaults, the body is
    /// reseeded from the example / empty template, and the confirm latch is cleared. The API key is preserved
    /// (the web effect does not touch it). A no-op when the endpoint is unchanged.
    /// </summary>
    /// <param name="endpoint">The new endpoint.</param>
    public void SetEndpoint(ParsedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        if (RequestBuilderProjection.SameEndpoint(_endpoint, endpoint))
        {
            return;
        }

        _endpoint = endpoint;
        SeedFromEndpoint(endpoint);
        Raise(nameof(Endpoint));
        RaiseDisplay();
    }

    /// <summary>
    /// Set a path/query field value — the native analogue of the web input <c>onChange</c> driving the
    /// <c>params</c> state (and therefore the built URL). A no-op (no notification) when the value is unchanged.
    /// </summary>
    /// <param name="name">The parameter name being edited.</param>
    /// <param name="value">The new field value (null is treated as empty).</param>
    public void SetParam(string name, string? value)
    {
        ArgumentNullException.ThrowIfNull(name);

        string next = value ?? string.Empty;
        if (_values.TryGetValue(name, out string? existing) && string.Equals(existing, next, StringComparison.Ordinal))
        {
            return;
        }

        _values[name] = next;
        RaiseDisplay();
    }

    /// <summary>
    /// Set the request-body text — the native analogue of the web textarea <c>onChange</c>. The body affects no
    /// rendered chrome (only what is echoed on send), so it is stored without a notification.
    /// </summary>
    /// <param name="value">The new body text (null is treated as empty).</param>
    public void SetBody(string? value) => _body = value ?? string.Empty;

    /// <summary>
    /// Set the API-key value — the native analogue of the web auth-field <c>onChange</c>. The key affects no
    /// rendered chrome (only the headers echoed on send), so it is stored without a notification.
    /// </summary>
    /// <param name="value">The new API-key value (null is treated as empty).</param>
    public void SetApiKey(string? value) => _apiKey = value ?? string.Empty;

    /// <summary>
    /// Set the loading flag (the web <c>loading</c> prop changing) — the send button label and disabled state
    /// follow. A no-op when unchanged.
    /// </summary>
    /// <param name="loading">Whether a send is now in flight.</param>
    public void SetLoading(bool loading)
    {
        if (_loading == loading)
        {
            return;
        }

        _loading = loading;
        Raise(nameof(Loading));
        RaiseDisplay();
    }

    /// <summary>
    /// Attempt to send — the native port of the web <c>handleSend</c>. A destructive (non-GET) request that has
    /// not yet been confirmed arms the confirm banner and returns without sending; a GET request, or a
    /// destructive request whose banner is already armed, clears the banner and echoes the assembled
    /// <see cref="OutgoingRequest"/> to the injected <c>onSend</c> callback
    /// (web <c>onSend(buildUrl(), method, body || undefined, headers)</c>).
    /// </summary>
    public void RequestSend()
    {
        if (RequestBuilderProjection.IsDestructive(_endpoint) && !_confirmOpen)
        {
            _confirmOpen = true;
            Raise(nameof(ConfirmOpen));
            RaiseDisplay();
            return;
        }

        bool wasConfirmOpen = _confirmOpen;
        _confirmOpen = false;

        OutgoingRequest request = RequestBuilderProjection.BuildOutgoing(_endpoint, _values, _body, _apiKey);
        _onSend?.Invoke(request);

        if (wasConfirmOpen)
        {
            Raise(nameof(ConfirmOpen));
            RaiseDisplay();
        }
    }

    /// <summary>
    /// Dismiss the destructive-confirm banner without sending — the native port of the web <c>handleCancel</c>.
    /// A no-op when the banner is not armed.
    /// </summary>
    public void Cancel()
    {
        if (!_confirmOpen)
        {
            return;
        }

        _confirmOpen = false;
        Raise(nameof(ConfirmOpen));
        RaiseDisplay();
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project — the native analogue of react-i18next
    /// re-rendering the component after the active language changes.
    /// </summary>
    public void Reload() => RaiseDisplay();

    private void SeedFromEndpoint(ParsedEndpoint endpoint)
    {
        _values.Clear();
        foreach (KeyValuePair<string, string> seed in RequestBuilderProjection.BuildInitialValues(endpoint))
        {
            _values[seed.Key] = seed.Value;
        }

        _body = RequestBuilderProjection.BuildInitialBody(endpoint);
        _confirmOpen = false;
    }

    private void RaiseDisplay() => Raise(nameof(Display));

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
