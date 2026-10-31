# EZVIZ T55 radiator valve — Zigbee2MQTT external converter

Community-developed external converter for the **EZVIZ T55** Zigbee thermostatic radiator valve (model `CS-T55`, fingerprint `CS-T55-R100-G` with four trailing NUL bytes).

**Status:** experimental / community contribution. Developed and tested with one physical valve. **Not official Zigbee2MQTT support.** Contributions, forks and upstream integration are welcome; active maintenance and user support are **not guaranteed**.

## Background and attribution

Developed by **majkls12** with assistance from **OpenAI ChatGPT**. The implementation was derived through hands-on testing and reverse engineering of Zigbee traffic exchanged while operating the valve through its official EZVIZ application, including packet capture, attribute analysis, and comparison against physical valve behavior. It is an independently developed community implementation, not supplied or endorsed by EZVIZ or the Zigbee2MQTT maintainers.

## Supported features

- Target heating setpoint, current temperature, and on/off (`system_mode`) control.
- Heating activity (`heating_active`) and climate `running_state` (`heat` / `idle`), based on observed nonstandard `hvacThermostat.systemMode` reports (`4` / `16`).
- Battery percentage reports (ignores unreliable explicit-read value `200`).
- Child lock, manual/holiday operating mode, holiday target temperature.
- Local temperature calibration, open-window detection, anti-scale protection, frost protection.

**Temperature calibration rounding:** the device appears to apply calibration only in whole °C increments. Incoming decimal requests are rounded to the nearest whole degree, with halves rounded **away from zero** (e.g. `-0.1 → 0`, `-0.6 → -1`, `-1.5 → -2`, `+0.6 → +1`). The converter returns the rounded value to Zigbee2MQTT. This avoids sending unsupported fractional-degree calibration values to the valve. The rounding behavior has not yet been extensively tested across different controller setups.

## Installation

1. Download `ezviz-t55.js` from this repository.
2. Place it in the `external_converters` directory beside your Zigbee2MQTT `configuration.yaml`, or use the Zigbee2MQTT frontend's external converter editor where supported.
3. Restart/reload Zigbee2MQTT as appropriate and verify that the converter loads.
4. Pair the valve or verify that the existing paired valve resolves to this definition.

**Compatibility:** developed against the Zigbee2MQTT 2.7.2-dev environment. Other versions have not been systematically tested. Recent Zigbee2MQTT versions may require explicitly enabling external JavaScript (`enable_external_js`). See the [official external converter documentation](https://www.zigbee2mqtt.io/advanced/more/external_converters.html).

## Known issue: failed IAS enrollment during interview

A full device interview can fail even while the valve communicates and its features work:

```text
Interview failed because of failed IAS enroll (zoneState didn't change)
```

The device advertises `ssIasZone` (`0x0500`) but does not complete the enrollment state transition expected by `zigbee-herdsman`. The Zigbee2MQTT UI can therefore show an interview warning/exclamation mark. **This issue is unresolved.** A fix may require changes in `zigbee-herdsman` interview handling rather than this external converter alone. Do not assume that repeated pairing/interview attempts will solve it.

For a related (different device) upstream investigation, see [zigbee2mqtt issue #32480](https://github.com/Koenkk/zigbee2mqtt/issues/32480). This is a reference, not a claim that the same fix applies to the T55.

## Technical notes for contributors

| Zigbee cluster / attribute | Observed meaning |
| --- | --- |
| `hvacThermostat.occupiedHeatingSetpoint` | Setpoint uses unusual ×1000 scaling |
| `hvacThermostat.systemMode` `0` / `1` | Off / heat operating mode |
| `hvacThermostat.systemMode` `4` / `16` | Heating active / idle reports, *not* ordinary mode changes |
| `genBasic` `0x8001` | Operating mode: `1` manual, `3` holiday, `4` auto (auto read-only in this converter) |
| `genOnOff` `0x8000` | Child lock |
| `0xFEC0` `0xF011` | Holiday target temperature (signed int16, ×10) |
| `0xFEC0` `0xF024` | Local temperature calibration (signed int16, ×10) |
| `0xFEC0` `0xF406` | Open-window detection |
| `0xFEC0` `0xF407` | Anti-scale protection |
| `0xFEC0` `0xF408` | Frost protection |

**Caveats:** The converter currently catches and suppresses some Zigbee write errors based on observations that the valve can apply a write while returning an error status. The catches are broad and should be reviewed before upstream adoption, since genuine communication failures could otherwise be hidden. Some GET/read responses are unreliable. Heating state was checked against physical operation but is not a measured valve-opening percentage. No official certification or multi-device testing has been performed.

## Contributing / maintenance

This code is shared so other users and Zigbee2MQTT contributors can review, improve, fork, or integrate it upstream. No response time, ongoing support, or further development is promised. Please preserve credit and follow the MIT license.

## License

MIT — see [LICENSE](LICENSE).