import { useUpdateCheck, useVersionInfo } from '@/api/hooks/useSettings';
import { useChangelog } from '@/hooks/useChangelog';

const BUILD_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';
const BUILD_SHA: string = import.meta.env.VITE_GIT_SHA || 'dev';

function formatUptime(seconds: number | undefined | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function useBuildNews() {
  const changelog = useChangelog();
  const { data: updateCheck } = useUpdateCheck();
  return {
    changelog,
    updateCheck,
    hasBuildNews: !!updateCheck?.update_available || changelog.hasUnseen,
  };
}

export function useAboutBuild() {
  const { changelog, updateCheck, hasBuildNews } = useBuildNews();
  const { data: versionInfo } = useVersionInfo({ refetchInterval: 60_000 });
  const appVersion =
    (versionInfo?.app_version && versionInfo.app_version !== 'unknown'
      ? versionInfo.app_version
      : BUILD_VERSION) || 'dev';

  return {
    ...changelog,
    versionInfo,
    updateCheck,
    hasBuildNews,
    appVersion,
    sha: BUILD_SHA,
    updateAvailable: !!updateCheck?.update_available,
    uptime: formatUptime(versionInfo?.uptime_seconds),
  };
}
