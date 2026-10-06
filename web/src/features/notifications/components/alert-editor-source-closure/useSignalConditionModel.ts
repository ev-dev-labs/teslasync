import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAvailableSignals } from '@/api/hooks/useSignals'
import { useDataState } from '@/hooks/useDataState'
import { useSettings } from '@/hooks/useSettings'
import type { SignalUnitKind } from '@/api/types'
import type { SignalValueType } from '@/types/signals'
import { unitKindForSignalDescriptor } from '@/lib/signals'
import { unitSymbol } from '@/lib/unitInput'
import {
  allowedOpsForSignalType, customSignalCategory, signalCatalog, signalCatalogByName, signalTypeForValueKind,
} from './signalCatalog'
import type { EditorState, SignalDefinition } from './types'

export function useSignalConditionModel(
  editor: EditorState,
  aiVehicleId: number | null | undefined,
  getTemplateCategory: (category: string) => string,
) {
  const { settings } = useSettings()
  const { t } = useTranslation()
  const availableSignalsQuery = useAvailableSignals(aiVehicleId ?? 0)
  const signalsState = useDataState(availableSignalsQuery)
  const signalTypeLabels = useMemo<Record<SignalValueType, string>>(() => ({
    numeric: t('notifications.alertStudio.signalTypes.numeric', 'Numeric'),
    text: t('notifications.alertStudio.signalTypes.text', 'Text'),
    bool: t('notifications.alertStudio.signalTypes.bool', 'Boolean'),
  }), [t])
  const getSignalCategoryLabel = useCallback((category: string) => (
    category === customSignalCategory
      ? t('notifications.alertStudio.signalCategories.custom', 'Custom')
      : getTemplateCategory(category)
  ), [getTemplateCategory, t])
  const selectedSignal = useMemo<SignalDefinition | null>(() => {
    const knownSignal = signalCatalogByName.get(editor.signal_name)
    if (knownSignal) return knownSignal
    const signalName = editor.signal_name.trim()
    if (!signalName) return null
    return {
      name: signalName,
      category: customSignalCategory,
      value_type: signalTypeForValueKind(editor.value_kind),
    }
  }, [editor.signal_name, editor.value_kind])
  const selectedSignalType = selectedSignal?.value_type ?? 'numeric'
  const selectedSignalDescriptor = useMemo(
    () => availableSignalsQuery.data?.signals.find(signal => signal.name === editor.signal_name) ?? null,
    [availableSignalsQuery.data?.signals, editor.signal_name],
  )
  const canonicalUnitHint = useMemo(() => {
    if (!aiVehicleId) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitNoVehicle',
        'Enter the canonical SI value emitted by Fleet Telemetry. Select a vehicle in the status line to load exact unit metadata.',
      )
    }
    if (availableSignalsQuery.isLoading && !signalsState.hasData) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitLoading',
        'Loading the canonical unit for this signal…',
      )
    }
    const hints: Record<SignalUnitKind, string> = {
      distance: t('notifications.alertStudio.editor.canonicalUnitDistance', 'Canonical SI input: meters (m).'),
      temperature: t('notifications.alertStudio.editor.canonicalUnitTemperature', 'Canonical input: degrees Celsius (°C).'),
      pressure: t('notifications.alertStudio.editor.canonicalUnitPressure', 'Canonical SI input: pascals (Pa).'),
      charge: t('notifications.alertStudio.editor.canonicalUnitCharge', 'Canonical input: percent from 0 to 100.'),
      speed: t('notifications.alertStudio.editor.canonicalUnitSpeed', 'Canonical SI input: meters per second (m/s).'),
      none: t(
        'notifications.alertStudio.editor.canonicalUnitFallback',
        'Enter the canonical numeric value emitted by Fleet Telemetry; this signal has no registered unit dimension.',
      ),
    }
    if (!selectedSignalDescriptor) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitUnavailable',
        'Unit metadata is unavailable for this signal. Enter the canonical numeric value emitted by Fleet Telemetry.',
      )
    }
    const symbol = unitSymbol(unitKindForSignalDescriptor(selectedSignalDescriptor.unit_kind), settings)
    return symbol ? t(
      'common.preferredUnitInputHint',
      'Enter {{unit}}. Saved thresholds remain canonical SI values.',
      { unit: symbol },
    ) : hints[selectedSignalDescriptor.unit_kind]
  }, [aiVehicleId, availableSignalsQuery.isLoading, signalsState.hasData, selectedSignalDescriptor, settings, t])
  const signalSelectOptions = useMemo(() => {
    const options = signalCatalog.map(signal => ({
      value: signal.name,
      label: t('notifications.alertStudio.signals.optionLabel', '{{name}} - {{type}} - {{category}}', {
        name: signal.name,
        type: signalTypeLabels[signal.value_type],
        category: getSignalCategoryLabel(signal.category),
      }),
    }))
    if (!selectedSignal || signalCatalogByName.has(selectedSignal.name)) return options
    return [{
      value: selectedSignal.name,
      label: t('notifications.alertStudio.signals.customOptionLabel', '{{name}} - {{type}} - Custom', {
        name: selectedSignal.name,
        type: signalTypeLabels[selectedSignal.value_type],
      }),
    }, ...options]
  }, [getSignalCategoryLabel, selectedSignal, signalTypeLabels, t])
  const operatorSelectOptions = useMemo(() => allowedOpsForSignalType(selectedSignalType).map(op => ({
    value: op,
    label: t(`notifications.alertStudio.operators.${op}`, op),
  })), [selectedSignalType, t])
  const boolOptions = useMemo(() => [
    { value: 'true', label: t('notifications.alertStudio.boolean.true', 'True') },
    { value: 'false', label: t('notifications.alertStudio.boolean.false', 'False') },
  ], [t])
  return {
    availableSignalsQuery, signalsState, selectedSignal, selectedSignalDescriptor,
    canonicalUnitHint, signalTypeLabels, getSignalCategoryLabel, signalSelectOptions,
    operatorSelectOptions, boolOptions,
  }
}
