using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The default no-backend consent-requirement source the parameterless (shell-registered) <c>PrivacyPage</c>
/// hosts its <c>PrivacySection</c> against — the local-state default, mirroring the other W7 pages' empty
/// sources (<c>EmptyActiveSessionsFeed</c> / the open-mode TOTP controller). It emits the cache-then-network
/// sequence <c>Loading → Empty</c>, which the section's view-model coalesces to "consent not required" and the
/// "preview" body copy — exactly the web behaviour when <c>useVersionInfo</c> has no data
/// (web <c>Boolean(versionQuery.data?.require_cookie_consent)</c> reads <c>undefined</c> as <c>false</c>). The
/// recent-pages clearer and the cookie-consent grant / withdraw / reset controls are pure client-side surfaces
/// and stay fully live; only the deployment-wide requirement flag has no backend here. A host behind a
/// configured backend wires the repository-backed <see cref="ConsentRequirementSource"/> through the DI
/// constructor instead, so this source keeps the page mountable without a backend.
/// </summary>
public sealed class EmptyConsentRequirementSource : IConsentRequirementSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyConsentRequirementSource Instance { get; } = new();

    private EmptyConsentRequirementSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<bool>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Mirror a cache-then-network read with no cache and no backend: the first content-bearing emission is
        // Loading, then a successful-but-empty terminal emission the section maps to "consent not required".
        yield return RepositoryResult<bool>.Loading();
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<bool>.Empty();

        await Task.CompletedTask.ConfigureAwait(false);
    }
}
