using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The data port the <see cref="UsersPageViewModel"/> reads through — the native analogue of the web <c>UsersPage</c>'s
/// two hooks: a status read (web <c>useImpersonationStatus</c> → <c>GET /admin/impersonate</c>, classified to the
/// open-vs-active distinction the page needs) and a candidates read (web <c>useImpersonationCandidates</c> →
/// <c>GET /admin/impersonate/candidates</c>). The view-model is the only consumer; implementations never touch a WinUI
/// type. The status fetch is resilient — like the web hook, a transport fault is invisible to the page (the page only
/// reads <c>open</c>/<c>active</c>), so it resolves to <see cref="UsersImpersonationStatus.Inactive"/> rather than
/// throwing; the candidates fetch throws on a genuine failure so the view-model can surface the failure surface.
/// </summary>
public interface IImpersonationSubjectsFeed
{
    /// <summary>Read the impersonation status (web <c>useImpersonationStatus</c>), classified to open / inactive / active.</summary>
    Task<UsersImpersonationStatus> FetchStatusAsync(CancellationToken cancellationToken);

    /// <summary>Read the impersonation candidates (web <c>useImpersonationCandidates</c>), resolving open-mode vs the session list.</summary>
    Task<ImpersonationCandidatesSnapshot> FetchCandidatesAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default no-backend subjects feed the parameterless (shell-registered) <see cref="UsersPage"/> hosts itself
/// against — the local-state default, mirroring the other W7 pages' empty feeds. The status resolves to
/// <see cref="UsersImpersonationStatus.Inactive"/> and the candidates resolve to an empty session list, so the page
/// surfaces the friendly empty state (the web "single-subject install" case where the actor is the only subject). The
/// generated-client-backed source (<see cref="ImpersonationSubjectsClientFeed"/>) is wired separately from the shared
/// data layer (web's TanStack hooks); this feed keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyImpersonationSubjectsFeed : IImpersonationSubjectsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyImpersonationSubjectsFeed Instance { get; } = new();

    private EmptyImpersonationSubjectsFeed()
    {
    }

    /// <inheritdoc />
    public Task<UsersImpersonationStatus> FetchStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(UsersImpersonationStatus.Inactive);
    }

    /// <inheritdoc />
    public Task<ImpersonationCandidatesSnapshot> FetchCandidatesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ImpersonationCandidatesSnapshot.EmptySession);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IImpersonationSubjectsFeed"/> — the native data adapter for the admin
/// Subjects surface. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>get_api_v1_admin_impersonate</c> for the status query (web <c>useImpersonationStatus</c>) and
/// <c>get_api_v1_admin_impersonate_candidates</c> for the candidates query (web <c>useImpersonationCandidates</c>). The
/// 501 <c>AUTH_MODE_OPEN</c> response is treated exactly as the web hooks treat it — a successful "feature unavailable"
/// signal: the status resolves to <see cref="UsersImpersonationStatus.Open"/> and the candidates resolve to
/// <see cref="ImpersonationCandidatesSnapshot.Open"/>, never an error. A status transport fault resolves to
/// <see cref="UsersImpersonationStatus.Inactive"/> (web parity: a status error leaves <c>open</c>/<c>active</c> false);
/// any other candidates failure surfaces as the client's <see cref="ApiException"/> so the view-model can render the
/// failure surface. No HTTP touches the view; the JSON round-trips through the tolerant snapshot parsers.
/// </summary>
public sealed class ImpersonationSubjectsClientFeed : IImpersonationSubjectsFeed
{
    private static readonly ApiRequest StatusRequest = new(UsersPageRegistration.StatusOperation);
    private static readonly ApiRequest CandidatesRequest = new(UsersPageRegistration.CandidatesOperation);

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ImpersonationSubjectsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<UsersImpersonationStatus> FetchStatusAsync(CancellationToken cancellationToken)
    {
        try
        {
            var json = await _api.SendAsync<JsonElement>(StatusRequest, cancellationToken).ConfigureAwait(false);
            var snapshot = ImpersonationStatusSnapshot.FromJson(json);
            return snapshot.Mode == ImpersonationMode.Active
                ? UsersImpersonationStatus.Active
                : UsersImpersonationStatus.Inactive;
        }
        catch (ApiException ex) when (string.Equals(ex.ErrorCode, UsersPageRegistration.AuthModeOpenCode, StringComparison.Ordinal))
        {
            // Mirror web useImpersonationStatus: a 501 AUTH_MODE_OPEN is the open-access signal, not an error.
            return UsersImpersonationStatus.Open;
        }
        catch (ApiException)
        {
            // web parity: a status query error leaves open/active false, so the page proceeds to the candidates query.
            return UsersImpersonationStatus.Inactive;
        }
        catch (HttpRequestException)
        {
            return UsersImpersonationStatus.Inactive;
        }
    }

    /// <inheritdoc />
    public async Task<ImpersonationCandidatesSnapshot> FetchCandidatesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var json = await _api.SendAsync<JsonElement>(CandidatesRequest, cancellationToken).ConfigureAwait(false);
            return ImpersonationCandidatesSnapshot.FromJson(json);
        }
        catch (ApiException ex) when (string.Equals(ex.ErrorCode, UsersPageRegistration.AuthModeOpenCode, StringComparison.Ordinal))
        {
            // Mirror web useImpersonationCandidates: AUTH_MODE_OPEN maps to the open snapshot (the page shows no subjects).
            return ImpersonationCandidatesSnapshot.Open;
        }
    }
}

/// <summary>
/// An inert <see cref="IImpersonationSource"/> the parameterless (local-state) <see cref="UsersPage"/> hands to the
/// per-row impersonate button when no generated client is wired. The default empty feed resolves to the empty state, so
/// no rows — and therefore no buttons — are ever built against this source; it exists only so the per-row affordance is
/// always a real <see cref="UserImpersonateButton"/> (never a fabricated stand-in) even in the no-backend default. The
/// status stream yields a single unknown snapshot and the start mutation reports a privacy-safe failure.
/// </summary>
internal sealed class InertImpersonationSource : IImpersonationSource
{
    /// <summary>The shared singleton instance.</summary>
    public static InertImpersonationSource Instance { get; } = new();

    private InertImpersonationSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<ImpersonationStatusSnapshot>.Loaded(ImpersonationStatusSnapshot.Unknown, default);
    }

    /// <inheritdoc />
    public Task<ImpersonationStartOutcome> StartAsync(string subject, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(subject);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ImpersonationStartOutcome.Fail(
            new RepositoryError(RepositoryErrorKind.Unknown, "Impersonation is unavailable without a backend connection.")));
    }
}
