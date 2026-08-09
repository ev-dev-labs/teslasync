import { useTranslation } from 'react-i18next'
import { Grid, Stack } from '@/components/layout'
import { AlertBanner } from '@/components/feedback'
import { Badge, GlassPanel, Heading, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { EnterprisePayerCard } from './EnterprisePayerCard'
import { EnterpriseRolesCard } from './EnterpriseRolesCard'
import { PaidVehicleSpecsCard } from './PaidVehicleSpecsCard'
import { VehicleMetadataCards } from './VehicleMetadataCards'
import { VehiclePricingCard } from './VehiclePricingCard'

interface VehicleManagementWorkspaceProps {
  vehicleId?: number
}

const MANAGEMENT_GRID_COLUMNS = { default: 1, xl: 2 } as const

export function VehicleManagementWorkspace({
  vehicleId,
}: VehicleManagementWorkspaceProps) {
  const { t } = useTranslation()

  return (
    <section
      aria-labelledby="vehicle-management-title"
      data-testid="vehicle-management-workspace"
    >
      <Stack gap={4}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-xl bg-violet-500/10 p-2 text-violet-300">
                <Icons.database className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <Heading level="section" as="h2" id="vehicle-management-title">
                  {t(
                    'vehicleManagement.title',
                    'Vehicle Management workspace',
                  )}
                </Heading>
                <Text variant="bodySm" as="p">
                  {t(
                    'vehicleManagement.description',
                    'Account metadata, paid specifications, pricing, and enterprise controls are separate from physical vehicle commands.',
                  )}
                </Text>
              </div>
            </div>
            <Badge variant="neutral" size="lg">
              <Icons.users className="h-4 w-4" aria-hidden="true" />
              {t('vehicleManagement.catalogBadge', '8 official endpoints')}
            </Badge>
          </div>

          {!vehicleId && (
            <AlertBanner
              variant="info"
              className="mt-4"
              title={t(
                'vehicleManagement.noVehicleTitle',
                'Vehicle selection required',
              )}
            >
              {t(
                'vehicleManagement.noVehicle',
                'All endpoint cards remain visible, but vehicle-scoped reads and mutations stay unavailable until a vehicle is selected.',
              )}
            </AlertBanner>
          )}
        </GlassPanel>

        <Grid cols={MANAGEMENT_GRID_COLUMNS} gap={4}>
          <VehicleMetadataCards vehicleId={vehicleId} />
          <PaidVehicleSpecsCard vehicleId={vehicleId} />
          <VehiclePricingCard />
          <EnterpriseRolesCard vehicleId={vehicleId} />
          <EnterprisePayerCard vehicleId={vehicleId} />
        </Grid>
      </Stack>
    </section>
  )
}
