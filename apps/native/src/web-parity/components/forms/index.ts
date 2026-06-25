// Native parity port of web/src/components/forms/index.ts.
// This barrel preserves the web forms public API surface while the individual
// form modules are ported to React Native one file at a time. Only modules that
// already have a native parity implementation are actively re-exported; every
// other web export is recorded below as a forward declaration so the intended
// surface stays visible and is trivially enabled when its dedicated native
// module lands. Re-exporting a not-yet-ported module would break `tsc --noEmit`,
// so the deferred set is documented via nativeFormsBarrelCapabilities instead.

export {ComboboxMulti, type ComboboxMultiProps} from './ComboboxMulti';
export {UnitInput, type UnitInputProps} from './UnitInput';

// --- Pending native ports --------------------------------------------------
// The web exports below have no native parity module yet. They are intentionally
// left as forward declarations (commented out, not active re-exports) because
// importing from a missing module would fail typecheck. Each line mirrors the
// exact web export so the public surface is preserved for the next conversion
// pass; uncomment a line once its source module is ported to native.
//
// export {ActiveFilterChips, type ActiveFilterChipsProps, type FilterChipDescriptor} from './ActiveFilterChips';
// export {Combobox, type ComboboxProps, type ComboboxOptions} from './Combobox';
// export {CurrencyInput, type CurrencyInputProps, type CurrencyInputChangePayload} from './CurrencyInput';
// export {DatePresetChips, type DatePresetChipsProps, type DatePresetSelection} from './DatePresetChips';
// export {DateRangeFilter} from './DateRangeFilter';
// export {RangePicker, type RangePickerProps, type RangePickerValue} from './RangePicker';
// export {FilterBar, type FilterBarProps} from './FilterBar';
// export {FormField, type FormFieldProps} from './FormField';
// export {FormSection} from './FormSection';
// export {PillFilterBar, type PillFilterBarProps, type PillItem} from './PillFilterBar';
// export {SearchInput, type SearchInputProps} from './SearchInput';
// export {TagInput, type TagInputProps, type TagInputHandle, type TagSeparator} from './TagInput';
// export {TreeSelect, type TreeSelectProps, type TreeGroup, type TreeLeaf} from './TreeSelect';
// export {VehicleSelect, type VehicleSelectProps} from './VehicleSelect';
// export {VehicleMultiSelect, hydrateVehicleSelection, buildVehiclePayload, type VehicleMultiSelectProps, type VehicleSelection} from './VehicleMultiSelect';

export const nativeFormsBarrelCapabilities = {
  ported: ['ComboboxMulti', 'UnitInput'],
  pending: [
    'ActiveFilterChips',
    'Combobox',
    'CurrencyInput',
    'DatePresetChips',
    'DateRangeFilter',
    'RangePicker',
    'FilterBar',
    'FormField',
    'FormSection',
    'PillFilterBar',
    'SearchInput',
    'TagInput',
    'TreeSelect',
    'VehicleSelect',
    'VehicleMultiSelect',
  ],
  reason:
    'Native forms modules are converted one file at a time; pending modules have no native parity implementation yet, so they are forward-declared in the barrel instead of re-exported to keep `tsc --noEmit` green.',
} as const;
