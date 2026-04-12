import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCurrentUser, useUpdateUser } from '@/api/hooks/useUser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const { data: user, isLoading, error } = useCurrentUser();
  const updateUser = useUpdateUser();
  const [displayName, setDisplayName] = useState('');

  // Initialize form when user loads
  if (user && !displayName) {
    setDisplayName(user.displayName ?? '');
  }

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Manage your account and preferences')}
      loading={isLoading}
      error={error as Error | null}
    >
      <Card>
        <CardHeader title="Profile" subtitle="Update your account information" />
        <div className="space-y-4">
          <Input
            label="Email"
            value={user?.email ?? ''}
            disabled
            hint="Email cannot be changed"
          />
          <Input
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button
            loading={updateUser.isPending}
            onClick={() => updateUser.mutate({ displayName })}
          >
            Save Changes
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
}
