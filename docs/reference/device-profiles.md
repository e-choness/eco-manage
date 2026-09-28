# Device profiles

A profile says how to read and control one kind of device: which protocol it speaks, which
[reading fields](./mqtt.md#reading) it reports and where each comes from, and which actions it
accepts with their hard limits. The gateway reads devices and applies commands from the profile;
ingest refuses fields a device's profile doesn't declare; the rules and the API check commands
against its limits before proposing or approving. Profiles are JSON files in
[`packages/profiles/src/profiles/`](https://github.com/e-choness/eco-manage/tree/main/packages/profiles/src/profiles),
checked against the schema in `schema.ts` when they load.

## Built in

| Profile | Device | Protocol | Actions (limits) | Remote fixes |
| ------- | ------ | -------- | ---------------- | ------------ |
| `sunspec-inverter@3` | Three-phase string inverter (SunSpec models 1, 103, 120–123, 160) | Modbus TCP | `export_limit` (0–100%, up to 4 h), `restart` | restart |
| `sunspec-storage-802@2` | Hybrid inverter with LFP battery (SunSpec models 802/803) | Modbus TCP | `set_reserve` (10–100%), `force_discharge` / `force_charge` (0–60 kW, up to 6 h), `peak_shave_target` (0–1,000 kW, up to 12 h), `grid_charge`, `restart` | restart |
| `ct-meter-3ph@2` | Three-phase CT meter, class 0.5 (model code CT3-100) | Modbus RTU | none | |
| `ocpp16-generic@1` | AC charger, OCPP 1.6J (the gateway is its local central system) | OCPP 1.6J | `set_charging_profile` (a schedule, up to 24 h), `limit_current` (6–32 A, up to 4 h), `remote_start`, `remote_stop`, `change_availability`, `reset` | soft reset |
| `sg-ready-heatpump@1` | Air-to-water heat pump, SG-Ready relays and vendor Modbus | SG-Ready | `sg_mode` (modes 1–4, up to 2 h), `sg_schedule` (up to 4 h), `setpoint_offset` (−3 to +3 °C, up to 2 h) | |
| `gateway@1` | The EcoManage gateway agent | MQTT | `restart` | restart |

SG-Ready relay control isn't in the gateway agent yet; the simulator implements it.

## Format

```json
{
  "id": "sunspec-inverter@3",
  "version": 3,
  "vendor": "SunSpec",
  "model": "Three-phase string inverter (models 1, 103, 120-123, 160)",
  "protocol": "modbus-tcp",
  "deviceTypes": ["pv"],
  "fields": ["p_kw", "e_out_kwh", "state", "fault", "v", "a", "hz", "pf", "dc", "t_c"],
  "read": [
    { "field": "p_kw", "reg": 40083, "type": "int16", "scaleReg": 40084, "mult": 0.001 },
    { "field": "e_out_kwh", "reg": 40093, "type": "acc32", "scaleReg": 40095, "mult": 0.001 }
  ],
  "write": {
    "export_limit": {
      "description": "Limit AC output to a share of nameplate power (model 123 WMaxLimPct), reverting after the timeout",
      "reg": 40232,
      "revertReg": 40235,
      "params": { "pct": { "type": "number", "unit": "%", "min": 0, "max": 100 } },
      "maxDurationMin": 240
    }
  },
  "states": { "1": "off", "2": "sleeping" },
  "faults": { "bit0": "Ground fault" },
  "fixes": [{ "id": "restart", "label": "Remote restart (Modbus restart register)", "action": "restart" }],
  "pollMs": 5000,
  "reviewed": true
}
```

(Abridged from the real file, which maps every field and has more actions, states and faults.)

| Key | Meaning |
| --- | ------- |
| `id` | `name@version`; the version must equal `version` |
| `protocol` | `modbus-tcp`, `modbus-rtu`, `ocpp-1.6j`, `sg-ready` or `mqtt` |
| `deviceTypes` | Which device types may use it: `pv`, `battery`, `meter`, `submeter`, `ev`, `heatpump`, `gateway` |
| `fields` | The reading fields it reports (`ts` and `q` are always allowed) |
| `read` | Where each field comes from: a Modbus register (`reg`, `type` of `int16`, `uint16`, `int32`, `uint32`, `acc32`, `acc64`, `float32`, `bitfield16`, `bitfield32` or `enum16`; optional `scaleReg`, `mult` and `table` of `holding` or `input`), or a protocol message (`message`, optional `measurand` and `mult`). Every field read must be in `fields` |
| `write` | Actions by name: a `description`, the register or message, `params` (each `number`, `integer`, `boolean`, `time` or `schedule`, with `unit`, `min` and `max`), `maxDurationMin`, `revertReg`, and for registers the written `type`, `scaleReg` and `mult` (register = value ÷ mult ÷ 10^scale factor) |
| `states`, `faults` | Codes to text |
| `fixes` | Remote fixes alerts may offer: `{ id, label, action, params }`, each using one of the `write` actions |
| `pollMs` | How often the gateway reads it (at least 500) |
| `reviewed` | Checked against a real device |

Register addresses are 0-based, for devices whose SunSpec common model is 65 registers long. A
device documented from 1, or whose block starts elsewhere, gets a `regOffset` in the gateway's
configuration rather than a new profile.

**Limits are safety.** The gateway refuses any command outside `min`/`max`, and ends any action at
`maxDurationMin` even without an end time. Give every numeric parameter both, and every action that
holds a state a `maxDurationMin`. Adding a profile: [Extending](../develop/extending.md#a-new-kind-of-device).
