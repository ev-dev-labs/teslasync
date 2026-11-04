import unittest

from si_canonical_gate import check_go


def diff(line, path="internal/service/vehicle_service.go"):
    return f"+++ b/{path}\n+{line}\n"


class CanonicalGateTests(unittest.TestCase):
    def test_upstream_field_references_keep_their_immutable_identifiers(self):
        for line in [
            'value := state["LifetimeDcChargeEnergyKwh"]',
            'case "LifetimeDcChargeEnergyKwh":',
            'field := ftproto.Field_LifetimeDcChargeEnergyKwh',
            'Field_LifetimeDcChargeEnergyKwh Field = 276',
            'case Field_LifetimeDcChargeEnergyKwh:',
            'return Field_LifetimeDcChargeEnergyKwh',
            'name: "LifetimeDcChargeEnergyKwh/kWh_to_Wh"',
            'name: "LifetimeDcChargeEnergyKwh/ignores_display_preference"',
            "{name: 'LifetimeDcChargeEnergyKwh', unit: 'Wh'}",
        ]:
            with self.subTest(line=line):
                self.assertEqual(check_go(diff(line)), [])

    def test_vendor_reference_cannot_hide_a_legacy_application_identifier(self):
        for line in [
            'value := state["NominalFullPackEnergyKwh"]; AvgPowerKw := 3',
            'value := state["LifetimeDcChargeEnergyKwh"]; DistanceMi := 3',
            'field := ftproto.Field_NominalFullPackEnergyKwh; RegenKwh := 3',
        ]:
            with self.subTest(line=line):
                self.assertEqual(len(check_go(diff(line))), 1)

    def test_application_fields_and_json_tags_remain_forbidden(self):
        for line in [
            "LifetimeDcChargeEnergyKwh float64",
            "AppLifetimeDcChargeEnergyKwh float64",
            'EnergyWh float64 `json:"lifetime_dc_charge_energy_kwh"`',
            'EnergyWh float64 `json:"LifetimeDcChargeEnergyKwh"`',
            'EnergyWh float64 `json:"NominalFullPackEnergyKwh"`',
        ]:
            with self.subTest(line=line):
                self.assertEqual(len(check_go(diff(line))), 1)

    def test_only_exact_authoritative_field_names_are_recognized(self):
        for line in [
            'value := state["InventedChargeEnergyKwh"]',
            'value := state["AppLifetimeDcChargeEnergyKwh"]',
            "field := ftproto.Field_InventedChargeEnergyKwh",
        ]:
            with self.subTest(line=line):
                self.assertEqual(len(check_go(diff(line))), 1)


if __name__ == "__main__":
    unittest.main()
