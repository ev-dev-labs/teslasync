import {
  GEAR_BG_COLORS,
  GEAR_COLORS,
  isChargeComplete,
  isCharging,
  parseBuckleStatus,
  parseCabinOverheatMode,
  parseChargePort,
  parseChargePortLatch,
  parseClimateKeeperMode,
  parseEnumBool,
  parseGear,
  parseHvacPower,
  parseSettingEnum,
  parseWindowState,
} from '../src/web-parity/lib/parseEnums';

describe('web-parity parseEnums', () => {
  describe('parseEnumBool', () => {
    it('passes native booleans through unchanged', () => {
      expect(parseEnumBool(true)).toBe(true);
      expect(parseEnumBool(false)).toBe(false);
    });

    it('treats any "Off" / "false" / "0" / empty string as false', () => {
      expect(parseEnumBool('HvacPowerStateOff')).toBe(false);
      expect(parseEnumBool('false')).toBe(false);
      expect(parseEnumBool('0')).toBe(false);
      expect(parseEnumBool('')).toBe(false);
    });

    it('treats any other non-empty enum string as true', () => {
      expect(parseEnumBool('SentryModeStateArmed')).toBe(true);
      expect(parseEnumBool('HvacPowerStateOn')).toBe(true);
    });

    it('treats numbers as truthy unless zero, and rejects other types', () => {
      expect(parseEnumBool(5)).toBe(true);
      expect(parseEnumBool(0)).toBe(false);
      expect(parseEnumBool(null)).toBe(false);
      expect(parseEnumBool(undefined)).toBe(false);
      expect(parseEnumBool({})).toBe(false);
    });
  });

  describe('parseBuckleStatus', () => {
    it('only the exact latched enum is buckled', () => {
      expect(parseBuckleStatus('BuckleStatusLatched')).toBe(true);
      expect(parseBuckleStatus('BuckleStatusUnlatched')).toBe(false);
    });

    it('narrows bool and number inputs defensively', () => {
      expect(parseBuckleStatus(true)).toBe(true);
      expect(parseBuckleStatus(1)).toBe(true);
      expect(parseBuckleStatus(0)).toBe(false);
      expect(parseBuckleStatus(null)).toBe(false);
    });
  });

  describe('isCharging / isChargeComplete', () => {
    it('detects active charging substrings', () => {
      expect(isCharging('DetailedChargeStateCharging')).toBe(true);
      expect(isCharging('DetailedChargeStateStarting')).toBe(true);
      expect(isCharging('Enable')).toBe(true);
      expect(isCharging('DetailedChargeStateComplete')).toBe(false);
    });

    it('detects charge-complete substring', () => {
      expect(isChargeComplete('DetailedChargeStateComplete')).toBe(true);
      expect(isChargeComplete('DetailedChargeStateCharging')).toBe(false);
    });

    it('rejects non-string / empty inputs', () => {
      expect(isCharging('')).toBe(false);
      expect(isCharging(null)).toBe(false);
      expect(isChargeComplete(false)).toBe(false);
    });
  });

  describe('parseHvacPower', () => {
    it('passes native booleans through and parses enum strings', () => {
      expect(parseHvacPower(true)).toBe(true);
      expect(parseHvacPower(false)).toBe(false);
      expect(parseHvacPower('HvacPowerStateOn')).toBe(true);
      expect(parseHvacPower('HvacPowerStatePrecondition')).toBe(true);
      expect(parseHvacPower('HvacPowerStateOff')).toBe(false);
      expect(parseHvacPower(null)).toBe(false);
    });
  });

  describe('parseWindowState', () => {
    it('strips the prefix and maps ordered substrings', () => {
      expect(parseWindowState('WindowStateClosed')).toBe('Closed');
      expect(parseWindowState('WindowStatePartiallyOpen')).toBe('Partial');
      expect(parseWindowState('WindowStateOpen')).toBe('Open');
    });

    it('falls back to the stripped value and empty for null', () => {
      expect(parseWindowState('WindowStateFoo')).toBe('Foo');
      expect(parseWindowState('')).toBe('');
      expect(parseWindowState(null)).toBe('');
    });
  });

  describe('parseCabinOverheatMode', () => {
    it('checks multi-word variants before single-word On', () => {
      expect(
        parseCabinOverheatMode('CabinOverheatProtectionModeStateFanOnly'),
      ).toBe('Fan Only');
      expect(
        parseCabinOverheatMode('CabinOverheatProtectionModeStateNoCooling'),
      ).toBe('No Cooling');
      expect(parseCabinOverheatMode('CabinOverheatProtectionModeStateOn')).toBe(
        'On',
      );
      expect(
        parseCabinOverheatMode('CabinOverheatProtectionModeStateOff'),
      ).toBe('Off');
    });
  });

  describe('parseClimateKeeperMode', () => {
    it('maps each keeper mode to its display label', () => {
      expect(parseClimateKeeperMode('ClimateKeeperModeStateOff')).toBe('Off');
      expect(parseClimateKeeperMode('ClimateKeeperModeStateOn')).toBe('On');
      expect(parseClimateKeeperMode('ClimateKeeperModeStateDog')).toBe(
        'Dog Mode',
      );
      expect(parseClimateKeeperMode('ClimateKeeperModeStateCamp')).toBe(
        'Camp Mode',
      );
    });
  });

  describe('parseChargePort / parseChargePortLatch', () => {
    it('strips the anchored prefix and maps open/closed', () => {
      expect(parseChargePort('ChargePortOpen')).toBe('Open');
      expect(parseChargePort('ChargePortClosed')).toBe('Closed');
    });

    it('strips the latch prefix and maps engaged/disengaged', () => {
      expect(parseChargePortLatch('ChargePortLatchEngaged')).toBe('Engaged');
      expect(parseChargePortLatch('ChargePortLatchDisengaged')).toBe(
        'Disengaged',
      );
    });

    it('returns empty for null inputs', () => {
      expect(parseChargePort(null)).toBe('');
      expect(parseChargePortLatch(null)).toBe('');
    });
  });

  describe('re-exported parsers', () => {
    it('re-exports parseGear from ./gear', () => {
      expect(parseGear('ShiftStateDrive')).toBe('D');
      expect(parseGear('ShiftStateReverse')).toBe('R');
      expect(parseGear('ShiftStatePark')).toBe('P');
      expect(parseGear('ShiftStateNeutral')).toBe('N');
      expect(parseGear('<nil>')).toBeNull();
    });

    it('re-exports the gear color token maps', () => {
      expect(GEAR_COLORS.D).toBe('text-emerald-300');
      expect(GEAR_BG_COLORS.R).toBe('bg-neon-red/10 text-neon-red');
    });

    it('re-exports parseSettingEnum from ./parseSettingEnum', () => {
      expect(parseSettingEnum('DistanceUnitMiles', 'distance')).toBe('Miles');
      expect(parseSettingEnum('TemperatureUnitCelsius', 'temperature')).toBe(
        'Celsius',
      );
      expect(parseSettingEnum(null, 'pressure')).toBe('—');
    });
  });
});
