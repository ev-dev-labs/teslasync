#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const API_ROOT = path.resolve(process.cwd(), 'src', 'api');
const HOOKS_ROOT = path.join(API_ROOT, 'hooks');

// Every hook that directly creates a TanStack mutation must be classified.
// Live-only mutations must retain a request-boundary requiresLiveMode guard;
// mode-independent mutations are deliberately usable while viewing cached or
// historical data and must be reclassified explicitly before that changes.
const LIVE_ONLY_MUTATIONS = {
  'hooks/useActionCenter.ts': ['useApplyActionCenterAction'],
  'hooks/useAdmin.ts': [
    'useCreateApiKey',
    'useDeleteApiKey',
    'useRevokeApiKey',
    'useUpdateMaintenance',
  ],
  'hooks/useAdvancedIntelligence.ts': ['useStartFederatedRound'],
  'hooks/useAutomations.ts': [
    'useImportAutomations',
    'useToggleAutomation',
    'useReEnableAutomation',
    'useDeleteAutomation',
    'useBulkAutomationsUpdate',
    'useTestRunAutomation',
    'useCreateAutomationFull',
    'useUpdateAutomationFull',
  ],
  'hooks/useCharging.ts': ['useApplySchedule', 'useBulkDeleteCharging'],
  'hooks/useDataRepair.ts': [
    'useApplyDriveRepair',
    'useApplyChargingRepair',
    'useUpdateCharging',
    'useCloseCharging',
    'useDiscardCharging',
    'useUpdateDrive',
    'useCloseDrive',
    'useDiscardDrive',
  ],
  'hooks/useDLQ.ts': ['useDLQReplay'],
  'hooks/useDriving.ts': ['useBulkDeleteDrives'],
  'hooks/useEnergy.ts': ['useUpdateTOUSettings'],
  'hooks/useFeatureFlags.ts': ['useSetFlag', 'useDeleteFlag'],
  'hooks/useFleetOps.ts': ['useFleetMutation'],
  'hooks/useGuard.ts': [
    'useSetGuardConfig',
    'useGuardPanic',
    'useAcknowledgeGuardEvent',
  ],
  'hooks/useLocations.ts': [
    'useBulkGeofencesDelete',
    'useArchiveGeofence',
    'useUnarchiveGeofence',
    'useMarkGeofenceReviewed',
    'useRenameGeofence',
    'useUpdateGeofenceCategory',
    'useCreateGeofenceRate',
    'useDeleteGeofenceRate',
    'useApplyGeofenceRate',
  ],
  'hooks/useRbacMatrix.ts': ['useUpsertRbacCells'],
  'hooks/useRedisSignals.ts': [
    'usePurgeRedisSignals',
    'usePurgeAllRedisSignals',
  ],
  'hooks/useServiceIntelligence.ts': ['useImportCommunicationsCatalog'],
  'hooks/useSettings.ts': [
    'useSyncVehicles',
    'useToggleAPISuspend',
    'useUpdatePollingConfig',
  ],
  'hooks/useSettingsBackup.ts': ['useApplyImport'],
  'hooks/useSettingsReset.ts': ['useResetSection', 'useResetAllSettings'],
  'hooks/useVehicleCommand.ts': ['useVehicleCommand'],
  'hooks/useVehicles.ts': [
    'useRefreshVehicle',
    'useDeleteVehicle',
    'useSyncVehicles',
    'useWakeVehicle',
    'useSetEnterprisePayer',
  ],
  'hooks/useWatch.ts': ['useWatchCommand'],
};

const MODE_INDEPENDENT_MUTATIONS = {
  'hooks/useAdmin.ts': ['useCreateExport'],
  'hooks/useAdvancedIntelligence.ts': [
    'useSimulationMutation',
    'useCreateCausalExperiment',
  ],
  'hooks/useAiSettings.ts': ['useSaveAiSettings', 'useValidateAiProvider'],
  'hooks/useAlertMessageHelpers.ts': ['useAlertMessagePreview'],
  'hooks/useAnnotations.ts': [
    'useCreateAnnotation',
    'useUpdateAnnotation',
    'useDeleteAnnotation',
  ],
  'hooks/useBenchmarks.ts': [
    'useOptInBenchmarks',
    'useCreateBenchmarkRelease',
    'useRevokeBenchmarks',
  ],
  'hooks/useCharging.ts': [
    'useRefreshTeslaChargingHistory',
    'useRefreshTeslaChargingSessions',
    'useOptimizeCharge',
  ],
  'hooks/useChat.ts': [
    'useRenameChatSession',
    'useDeleteChatSession',
    'useSendChatMessage',
  ],
  'hooks/useDashboardLayouts.ts': [
    'useCreateDashboardLayout',
    'useUpdateDashboardLayout',
    'useDeleteDashboardLayout',
    'useApplyDashboardLayout',
  ],
  'hooks/useDriving.ts': ['usePlanTrip'],
  'hooks/useEnergy.ts': [
    'useRefreshTeslaEnergySites',
    'useRefreshTeslaEnergySiteInfo',
    'useRefreshTeslaEnergyHistory',
    'useRefreshTeslaBackupHistory',
    'useRefreshTeslaWCChargingHistory',
    'useRefreshTeslaEnergyLiveStatus',
  ],
  'hooks/useExports.ts': [
    'useCreateExport',
    'useCreateAccountExport',
    'useBulkExportsDelete',
    'useCreateScheduledExport',
    'useUpdateScheduledExport',
    'useDeleteScheduledExport',
    'useRunScheduledExportNow',
  ],
  'hooks/useFeedback.ts': [
    'useSubmitFeedback',
    'useUpdateFeedback',
    'useBulkUpdateFeedback',
  ],
  'hooks/useImpersonation.ts': ['useStartImpersonation', 'useEndImpersonation'],
  'hooks/useIncidents.ts': [
    'useCreateIncident',
    'usePatchIncident',
    'useAppendIncidentUpdate',
    'useDeleteIncident',
  ],
  'hooks/useNotificationChannels.ts': [
    'useTestWebhookChannel',
    'useWebhookSignaturePreview',
  ],
  'hooks/useNotifications.ts': [
    'useMarkAlertRead',
    'useBulkSetAlertsRead',
    'useAcknowledgeAlert',
    'useCommentAlert',
    'useReopenAlert',
    'usePreviewComputedMetric',
    'useSaveAlertRule',
    'useDeleteAlertRule',
    'useToggleAlertRule',
    'useBulkEnableRules',
    'useBulkDisableRules',
    'useTestAlertRule',
    'useSnoozeAlertRule',
    'useUpdateNotificationPreference',
    'useMarkNotificationsRead',
    'useBulkMarkRead',
    'useMarkNotificationsUnread',
    'useArchiveNotifications',
    'useUnarchiveNotifications',
    'useDeleteNotifications',
    'useSaveChannel',
    'useDeleteChannel',
    'useToggleChannel',
    'useTestChannel',
    'useSaveQuietHours',
    'useDeleteQuietHours',
  ],
  'hooks/useOwnership.ts': [
    'useUpsertInsurancePolicy',
    'useDeleteInsurancePolicy',
    'useCreateTariff',
    'useDeleteTariff',
    'useSimulateTariffs',
    'useCreateInvoice',
    'useDeleteInvoice',
    'useCreateDispute',
    'useCreateDriverProfile',
    'useDeleteDriverProfile',
    'useAssignDrive',
    'useCreateWarranty',
    'useDeleteWarranty',
    'useCreateWarrantyClaim',
    'useUpsertRetentionPolicy',
    'useDeleteRetentionPolicy',
    'useSimulateGovernance',
    'useRecordPrediction',
    'useRecordOutcome',
    'useCreateJurisdictionRate',
    'useDeleteJurisdictionRate',
    'useCreateFiling',
    'useCreateConsumable',
    'useDeleteConsumable',
    'useCreateConsumableEvent',
    'useCreateSubscription',
    'useDeleteSubscription',
  ],
  'hooks/usePinned.ts': ['useTogglePin', 'useReorderPin'],
  'hooks/usePush.ts': ['useSubscribePush', 'useUnsubscribePush'],
  'hooks/useSavedViews.ts': [
    'useCreateSavedView',
    'useUpdateSavedView',
    'useDeleteSavedView',
    'useSetDefaultSavedView',
  ],
  'hooks/useSessions.ts': ['useRevokeSession', 'useRevokeAllOtherSessions'],
  'hooks/useSettings.ts': [
    'useSaveSettings',
    'useAuthURL',
    'useRefreshAuth',
    'useDisconnectAuth',
    'usePollGasPrice',
    'useToggleGasPrice',
    'useUpdateGasPriceConfig',
    'useSaveDashboardLayouts',
  ],
  'hooks/useSettingsBackup.ts': ['useExportSettings', 'useDryRunImport'],
  'hooks/useSharing.ts': ['useCreateShareLink', 'useRevokeShareLink'],
  'hooks/useSystemDiagnostic.ts': ['useRunDiagnostic'],
  'hooks/useTOTP.ts': [
    'useTOTPEnroll',
    'useTOTPVerify',
    'useTOTPStepUp',
    'useTOTPRevoke',
    'useTOTPRegenerateBackupCodes',
  ],
  'hooks/useTelemetry.ts': [
    'useRefreshFleetTelemetryErrorVINs',
    'useRefreshFleetTelemetryErrors',
  ],
  'hooks/useUser.ts': [
    'useUpdateUser',
    'useRefreshTeslaFeatureConfig',
    'useRefreshTeslaRegion',
    'useRefreshTeslaOrders',
    'useRefreshTeslaProfile',
  ],
  'hooks/useVehicleAccess.ts': [
    'useRefreshVehicleDrivers',
    'useRefreshVehicleInvitations',
    'useRemoveVehicleDriver',
    'useCreateVehicleInvitation',
    'useRevokeVehicleInvitation',
  ],
  'hooks/useVehiclePhoto.ts': [
    'useUploadVehiclePhoto',
    'useDeleteVehiclePhoto',
  ],
  'hooks/useVehicleSettings.ts': [
    'useUpsertVehicleSetting',
    'useResetVehicleSetting',
  ],
  'hooks/useVehicles.ts': [
    'useRefreshVehicleMobileEnabled',
    'useRefreshVehicleOptions',
    'useRefreshVehicleSpecs',
    'useRefreshVehicleSubscriptions',
    'useRefreshVehicleUpgrades',
    'useRefreshWarrantyDetails',
    'useVehiclePricing',
    'useRefreshEnterpriseRoles',
  ],
};

const INFRASTRUCTURE_MUTATIONS = {
  'hooks/useOptimisticMutation.ts': ['useOptimisticMutation'],
};

const DELEGATED_GUARDS = {
  'hooks/useFleetOps.ts#useFleetMutation': [
    'hooks/useFleetOps.ts#useCreateMutation',
    'hooks/useFleetOps.ts#useUpdateMutation',
    'hooks/useFleetOps.ts#useDeleteMutation',
  ],
  'hooks/useRedisSignals.ts#usePurgeRedisSignals': [
    'devtools.ts#purgeRedisSignals',
  ],
  'hooks/useRedisSignals.ts#usePurgeAllRedisSignals': [
    'devtools.ts#purgeAllRedisSignals',
  ],
};

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      files.push(...walk(file));
    } else if (
      /\.(?:ts|tsx)$/.test(name) &&
      !/\.test\.(?:ts|tsx)$/.test(name)
    ) {
      files.push(file);
    }
  }
  return files;
}

function declarationName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.text;
  }
  return null;
}

function declarationBody(node) {
  if (ts.isFunctionDeclaration(node)) return node.body;
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return node.initializer.body;
  }
  return null;
}

function containsCall(node, names) {
  let found = false;
  function visit(current) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      names.has(current.expression.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function containsLiveGuard(node) {
  let found = false;
  function visit(current) {
    if (
      ts.isPropertyAssignment(current) &&
      ((ts.isIdentifier(current.name) &&
        current.name.text === 'requiresLiveMode') ||
        (ts.isStringLiteral(current.name) &&
          current.name.text === 'requiresLiveMode')) &&
      current.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function flattenCatalog(catalog) {
  const keys = new Set();
  for (const [file, symbols] of Object.entries(catalog)) {
    for (const symbol of symbols) keys.add(`${file}#${symbol}`);
  }
  return keys;
}

const declarations = new Map();
const mutationHooks = new Set();
const guardedDeclarations = new Set();

for (const file of walk(HOOKS_ROOT).concat(path.join(API_ROOT, 'devtools.ts'))) {
  const relative = path.relative(API_ROOT, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  function visit(node) {
    const name = declarationName(node);
    const body = declarationBody(node);
    if (name && body) {
      const key = `${relative}#${name}`;
      declarations.set(key, body);
      if (
        name.startsWith('use') &&
        containsCall(body, new Set(['useMutation', 'useOptimisticMutation']))
      ) {
        mutationHooks.add(key);
      }
      if (containsLiveGuard(body)) guardedDeclarations.add(key);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const liveOnly = flattenCatalog(LIVE_ONLY_MUTATIONS);
const modeIndependent = flattenCatalog(MODE_INDEPENDENT_MUTATIONS);
const infrastructure = flattenCatalog(INFRASTRUCTURE_MUTATIONS);
const classified = new Set([
  ...liveOnly,
  ...modeIndependent,
  ...infrastructure,
]);
const approvedGuardTargets = new Set(liveOnly);
for (const guards of Object.values(DELEGATED_GUARDS)) {
  for (const guard of guards) approvedGuardTargets.add(guard);
}

const failures = [];

for (const key of mutationHooks) {
  if (!classified.has(key)) {
    failures.push(`${key}: mutation hook has no operational-mode classification`);
  }
}

for (const key of classified) {
  if (!mutationHooks.has(key)) {
    failures.push(`${key}: catalog entry no longer declares a mutation hook`);
  }
}

for (const key of liveOnly) {
  const guards = DELEGATED_GUARDS[key] ?? [key];
  for (const guard of guards) {
    const declaration = declarations.get(guard);
    if (!declaration) {
      failures.push(`${key}: guard target ${guard} does not exist`);
    } else if (!containsLiveGuard(declaration)) {
      failures.push(
        `${key}: guard target ${guard} is missing requiresLiveMode: true`,
      );
    }
  }
}

for (const key of modeIndependent) {
  const declaration = declarations.get(key);
  if (declaration && containsLiveGuard(declaration)) {
    failures.push(
      `${key}: mode-independent mutation gained a live guard; reclassify it`,
    );
  }
}

for (const key of guardedDeclarations) {
  if (!approvedGuardTargets.has(key)) {
    failures.push(`${key}: live guard is missing from the policy catalog`);
  }
}

if (failures.length > 0) {
  console.error('Live mutation policy audit failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Live mutation policy audit passed: ${liveOnly.size} live-only, ` +
    `${modeIndependent.size} mode-independent, ` +
    `${infrastructure.size} infrastructure mutation hooks.`,
);
