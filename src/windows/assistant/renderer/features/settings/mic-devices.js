// The microphones Windows offers, and which one to record from.
//
// The saved choice is a device id plus its label. An id is '' for the Windows
// default. The label is kept so the device can still be found if its id
// changes, and so a missing device can be named.

const PSEUDO_DEVICE_IDS = new Set(['default', 'communications']);

function stripDefaultPrefix(label) {
    return String(label || '').replace(/^(Default|預設)\s*-\s*/i, '').trim();
}

export async function listMicDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const defaultEntry = inputs.find((device) => device.deviceId === 'default');

    return {
        defaultLabel: defaultEntry ? stripDefaultPrefix(defaultEntry.label) : '',
        devices: inputs
            .filter((device) => !PSEUDO_DEVICE_IDS.has(device.deviceId))
            .map((device, index) => ({ id: device.deviceId, label: device.label || `麥克風 ${index + 1}` }))
    };
}

// Finds the saved device among the connected ones: by id, then by label.
// `missing` is true when a specific device was chosen but is not connected.
export function findMicDevice(devices, choice) {
    if (!choice?.id) {
        return { device: null, missing: false };
    }

    const device = devices.find((entry) => entry.id === choice.id) ||
        (choice.label ? devices.find((entry) => entry.label === choice.label) : null);
    return { device: device || null, missing: !device };
}

// The device id to record from: '' means the Windows default.
export async function resolveMicDeviceId(choice) {
    if (!choice?.id) {
        return { deviceId: '', missing: false };
    }

    const { devices } = await listMicDevices();
    const { device, missing } = findMicDevice(devices, choice);
    return { deviceId: device ? device.id : '', missing };
}
