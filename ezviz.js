const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const e = exposes.presets;

module.exports = {
    fingerprint: [{
        modelID: 'CS-T55-R100-G\u0000\u0000\u0000\u0000',
        manufacturerName: 'EZVIZ',
    }],

    model: 'CS-T55',
    vendor: 'EZVIZ',
    description: 'EZVIZ T55 Radiator Valve',

    fromZigbee: [
        {
            cluster: 'hvacThermostat',
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                const result = {};

                if (msg.data.occupiedHeatingSetpoint !== undefined) {
                    result.occupied_heating_setpoint =
                        msg.data.occupiedHeatingSetpoint / 1000;
                }

                if (msg.data.localTemperature !== undefined) {
                    result.local_temperature =
                        msg.data.localTemperature / 100;
                }

                if (msg.data.systemMode !== undefined) {
                    const mode = msg.data.systemMode;

                    // 0/1 = thermostat OFF/HEAT mode.
                    // These values must not overwrite the reported heating activity.
                    const map = {
                        0: 'off',
                        1: 'heat',
                    };

                    if (map[mode] !== undefined) {
                        result.system_mode = map[mode];
                    }

                    // Observed in Zigbee captures and verified against the T55 display:
                    // 4 = heating icon ON (heating active).
                    // 16 = heating icon OFF (heating inactive).
                    // Do not overwrite system_mode: retain existing HVAC control.
                    if (mode === 4) {
                        result.heating_active = true;
                        result.running_state = 'heat';
                    } else if (mode === 16) {
                        result.heating_active = false;
                        result.running_state = 'idle';
                    }
                }

                return result;
            },
        },

        {
            // Temperature reported by the T55.
            cluster: 'msTemperatureMeasurement',
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                if (msg.data.measuredValue !== undefined) {
                    const temp = msg.data.measuredValue / 100;
                    return {
                        temperature: temp,
                        local_temperature: temp,
                    };
                }
            },
        },

        {
            // Battery reports in the range 0–100 are direct percentages.
            // Ignore the unreliable value 200 returned by explicit reads.
            cluster: 'genPowerCfg',
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                const result = {};
                if (msg.data.batteryPercentageRemaining !== undefined) {
                    const battery = msg.data.batteryPercentageRemaining;
                    if (battery >= 0 && battery <= 100) {
                        result.battery = battery;
                    }
                }
                return result;
            },
        },

        {
            // Child lock: genOnOff / 0x8000 / Boolean.
            // Local changes are reported; explicit reads are unreliable.
            cluster: 'genOnOff',
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                const value = msg.data[0x8000];
                if (value !== undefined) {
                    return {child_lock: value ? 'LOCK' : 'UNLOCK'};
                }
            },
        },

        {
            // Basic / 0x8001 / Enum8:
            // 1 = manual, 3 = holiday, 4 = auto.
            cluster: 'genBasic',
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                const value = msg.data[0x8001];
                if (value !== undefined) {
                    const map = {1: 'manual', 3: 'holiday', 4: 'auto'};
                    if (map[value] !== undefined) {
                        return {operating_mode: map[value]};
                    }
                }
            },
        },

        {
            // Manufacturer-specific cluster 0xFEC0:
            // F011 holiday temperature, Int16 ×10
            // F024 temperature calibration, Int16 ×10
            // F406 open window, Uint8
            // F407 anti-scale, Uint8
            // F408 frost protection, Uint8
            cluster: 0xFEC0,
            type: ['attributeReport', 'readResponse'],
            convert: (model, msg, publish, options, meta) => {
                const result = {};
                if (msg.data[0xF011] !== undefined) {
                    result.holiday_temperature = msg.data[0xF011] / 10;
                }
                if (msg.data[0xF024] !== undefined) {
                    result.local_temperature_calibration = msg.data[0xF024] / 10;
                }
                if (msg.data[0xF406] !== undefined) {
                    result.open_window_detection = msg.data[0xF406] ? 'ON' : 'OFF';
                }
                if (msg.data[0xF407] !== undefined) {
                    result.anti_scale_protection = msg.data[0xF407] ? 'ON' : 'OFF';
                }
                if (msg.data[0xF408] !== undefined) {
                    result.frost_protection = msg.data[0xF408] ? 'ON' : 'OFF';
                }
                return result;
            },
        },
    ],

    toZigbee: [
        {
            key: ['occupied_heating_setpoint'],
            convertSet: async (entity, key, value) => {
                const value1000 = Math.round(value * 1000);
                await entity.write('hvacThermostat', {
                    occupiedHeatingSetpoint: value1000,
                });
                return {state: {occupied_heating_setpoint: value}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read('hvacThermostat', ['occupiedHeatingSetpoint']);
            },
        },

        {
            // 0 = OFF, 1 = HEAT; the T55 may return READ_ONLY after applying the write.
            key: ['system_mode'],
            convertSet: async (entity, key, value) => {
                const map = {off: 0, heat: 1};
                const payloadValue = map[value];
                try {
                    await entity.write(
                        'hvacThermostat',
                        {systemMode: payloadValue},
                        {disableDefaultResponse: false, timeout: 2000},
                    );
                } catch (error) {
                    console.log(
                        'EZVIZ T55: Ignore systemMode READ_ONLY error ' +
                        '(device applied the change)',
                    );
                }
                return {state: {system_mode: value}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read('hvacThermostat', ['systemMode']);
            },
        },

        {
            // 1 = manual, 3 = holiday, 4 = auto (read only).
            // The T55 may return UNSUPPORTED_ATTRIBUTE despite applying the change.
            key: ['operating_mode'],
            convertSet: async (entity, key, value) => {
                const map = {manual: 1, holiday: 3};
                if (map[value] === undefined) {
                    throw new Error('EZVIZ T55: operating_mode can be manual or holiday');
                }
                try {
                    await entity.write(
                        'genBasic',
                        {0x8001: {value: map[value], type: 0x30}},
                        {disableDefaultResponse: false, timeout: 2000},
                    );
                } catch (error) {
                    console.log(
                        'EZVIZ T55: Ignore operating mode ' +
                        'UNSUPPORTED_ATTRIBUTE error (device applied the change)',
                    );
                }
                return {state: {operating_mode: value}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read('genBasic', [0x8001]);
            },
        },

        {
            // Holiday temperature: FEC0/F011, Int16 ×10, 5–30 °C.
            key: ['holiday_temperature'],
            convertSet: async (entity, key, value) => {
                const temperature = Number(value);
                if (!Number.isFinite(temperature) || temperature < 5 || temperature > 30) {
                    throw new Error('EZVIZ T55: holiday temperature must be between 5 and 30 °C');
                }
                const rawValue = Math.round(temperature * 10);
                await entity.write(0xFEC0, {
                    0xF011: {value: rawValue, type: 0x29},
                });
                return {state: {holiday_temperature: rawValue / 10}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read(0xFEC0, [0xF011]);
            },
        },

        {
            // Child lock: no GET, because explicit reads are unreliable.
            key: ['child_lock'],
            convertSet: async (entity, key, value) => {
                const locked = value === 'LOCK';
                await entity.write('genOnOff', {
                    0x8000: {value: locked, type: 0x10},
                });
                return {state: {child_lock: value}};
            },
        },

        {
            // Temperature calibration: FEC0/F024, Int16 ×10.
            // Round requested calibration to whole degrees (half away from zero).
            // Firmware appears to apply calibration in whole-degree increments.
            // The T55 may return INVALID_DATA_TYPE despite applying the change.
            key: ['local_temperature_calibration'],
            convertSet: async (entity, key, value) => {
                const calibration = Number(value);
                if (!Number.isFinite(calibration) || calibration < -9 || calibration > 4) {
                    throw new Error('EZVIZ T55: temperature calibration must be between -9 and +4 °C');
                }
                const roundedCalibration = Math.sign(calibration) * Math.round(Math.abs(calibration));
                const rawValue = roundedCalibration * 10;
                try {
                    await entity.write(
                        0xFEC0,
                        {0xF024: {value: rawValue, type: 0x29}},
                        {disableDefaultResponse: false, timeout: 2000},
                    );
                } catch (error) {
                    console.log(
                        'EZVIZ T55: Ignore calibration INVALID_DATA_TYPE ' +
                        '(device applied the change)',
                    );
                }
                return {state: {local_temperature_calibration: roundedCalibration}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read(0xFEC0, [0xF024]);
            },
        },

        {
            key: ['open_window_detection'],
            convertSet: async (entity, key, value) => {
                const enabled = value === 'ON';
                await entity.write(0xFEC0, {
                    0xF406: {value: enabled ? 1 : 0, type: 0x20},
                });
                return {state: {open_window_detection: enabled ? 'ON' : 'OFF'}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read(0xFEC0, [0xF406]);
            },
        },

        {
            key: ['anti_scale_protection'],
            convertSet: async (entity, key, value) => {
                const enabled = value === 'ON';
                await entity.write(0xFEC0, {
                    0xF407: {value: enabled ? 1 : 0, type: 0x20},
                });
                return {state: {anti_scale_protection: enabled ? 'ON' : 'OFF'}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read(0xFEC0, [0xF407]);
            },
        },

        {
            key: ['frost_protection'],
            convertSet: async (entity, key, value) => {
                const enabled = value === 'ON';
                await entity.write(0xFEC0, {
                    0xF408: {value: enabled ? 1 : 0, type: 0x20},
                });
                return {state: {frost_protection: enabled ? 'ON' : 'OFF'}};
            },
            convertGet: async (entity, key, meta) => {
                await entity.read(0xFEC0, [0xF408]);
            },
        },
    ],

    exposes: [
        e.battery(),

        // Read-only heating activity reported by the T55.
        e.binary(
            'heating_active',
            exposes.access.STATE,
            true,
            false,
        ).withDescription('Heating activity reported by the valve (SystemMode 4/16)'),

        e.binary(
            'child_lock',
            exposes.access.ALL,
            'LOCK',
            'UNLOCK',
        ).withDescription('Child lock'),

        exposes.enum(
            'operating_mode',
            exposes.access.ALL,
            ['manual', 'holiday'],
        ).withDescription('Operating mode of the valve'),

        exposes.numeric('holiday_temperature', exposes.access.ALL)
            .withUnit('°C')
            .withValueMin(5)
            .withValueMax(30)
            .withValueStep(0.5)
            .withDescription('Holiday mode target temperature'),

        exposes.numeric('local_temperature_calibration', exposes.access.ALL)
            .withUnit('°C')
            .withValueMin(-9)
            .withValueMax(4)
            .withValueStep(1)
            .withDescription('Local temperature calibration'),

        e.binary('open_window_detection', exposes.access.ALL, 'ON', 'OFF')
            .withDescription('Open window detection'),

        e.binary('anti_scale_protection', exposes.access.ALL, 'ON', 'OFF')
            .withDescription('Anti-scale protection'),

        e.binary('frost_protection', exposes.access.ALL, 'ON', 'OFF')
            .withDescription('Frost protection'),

        e.climate()
            .withSetpoint('occupied_heating_setpoint', 5, 30, 0.5)
            .withLocalTemperature()
            .withSystemMode(['off', 'heat'])
            .withRunningState(['idle', 'heat']),
    ],

    configure: async (device, coordinatorEndpoint) => {
        const endpoint = device.getEndpoint(1);

        try {
            await reporting.bind(
                endpoint,
                coordinatorEndpoint,
                ['hvacThermostat', 'msTemperatureMeasurement'],
            );
            await reporting.thermostatOccupiedHeatingSetpoint(endpoint);
            await reporting.thermostatTemperature(endpoint);
            await reporting.temperature(endpoint);
        } catch (e) {
            console.log('EZVIZ T55: Reporting configuration failed, ignoring error...');
        }

        // Read standard thermostat attributes during reconfiguration.
        try {
            await endpoint.read('hvacThermostat', [
                'occupiedHeatingSetpoint',
                'localTemperature',
                'systemMode',
            ]);
            console.log('EZVIZ T55: Initial thermostat state read OK');
        } catch (e) {
            console.log('EZVIZ T55: Initial thermostat state read failed: ' + e.message);
        }

        try {
            await endpoint.read('genBasic', [0x8001]);
            console.log('EZVIZ T55: Initial operating mode read OK');
        } catch (e) {
            console.log('EZVIZ T55: Initial operating mode read failed: ' + e.message);
        }

        try {
            await endpoint.read(0xFEC0, [
                0xF011, // Holiday temperature
                0xF024, // Temperature calibration
                0xF406, // Open window detection
                0xF407, // Anti-scale protection
                0xF408, // Frost protection
            ]);
            console.log('EZVIZ T55: Initial proprietary state read OK');
        } catch (e) {
            console.log('EZVIZ T55: Initial proprietary state read failed: ' + e.message);
        }

        // Do not explicitly read child_lock or battery (unreliable responses).
        // Heating activity and running_state update only on SystemMode 4/16 reports.
    },
};