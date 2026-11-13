/** Use only on a fresh redirect from the authenticated, verified GitHub artifact
 * endpoint. This is not a general URL or outbound-network allowlist. */
export function verifiedGitHubArtifactLocation(raw: string, archiveHosts: readonly string[], allowGitHubResultsAzureHosts = false): URL {
    // Inspect the raw authority too: URL normalizes an explicit :443 away.
    const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(raw)?.[1];
    const location = new URL(raw);
    if (raw.includes('#') || !authority || authority !== location.hostname || location.protocol !== 'https:' || location.username || location.password || location.port || location.hash ||
        !(archiveHosts.includes(location.hostname) || (allowGitHubResultsAzureHosts === true && /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/.test(location.hostname))))
        throw Error('QA_ARCHIVE_HOST_INVALID');
    return location;
}
