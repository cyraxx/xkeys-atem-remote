const ATEM = require('atem');
const fs = require('fs');
const JSON5 = require('json5');
const { XKeys } = require('xkeys');

const config = JSON5.parse(fs.readFileSync('config.json5'));
const keyMappings = {};
config.keys.forEach(mapping => keyMappings[mapping.key] = mapping);

const panel = new XKeys();
const switcher = new ATEM();

/* Helper functions */

const setLEDForKeyMapping = (keyMapping, blueOn, blueFlash, redOn, redFlash) => {
    let keys = [keyMapping.key];
    if (keyMapping.additionalLEDs) keys = keys.concat(keyMapping.additionalLEDs);

    keys.forEach(keyIndex => {
        if (typeof blueOn == 'boolean') panel.setBacklight(keyIndex, blueOn, false, blueFlash);
        if (typeof redOn == 'boolean') panel.setBacklight(keyIndex, redOn, true, redFlash);
    });
};

const forEachMappingOfType = (type, callback) => {
    Object.values(keyMappings).filter(mapping => mapping.function == type).forEach(callback);
};

const flashAllSources = function() {
    forEachMappingOfType('source', mapping => setLEDForKeyMapping(mapping, false, false, true, true));
};

/* Init */

let currentBrightness = config.initialBrightness;
panel.setBacklightIntensity(currentBrightness);
panel.setFrequency(8);

if (config.clearBacklightOnStartup) {
    panel.setAllBacklights(false, false);
    panel.setAllBacklights(false, true);
} else {
    Object.values(keyMappings).forEach(mapping => setLEDForKeyMapping(mapping, false, false, false, false));
}

switcher.ip = config.switcherIP;
switcher.connect();
flashAllSources();

/* Switcher state change handlers */

switcher.on('connectionStateChange', state => {
    console.log(`ATEM connection state: ${state.description}`);
    if (state !== ATEM.ConnectionState.open) flashAllSources();
});

switcher.on('previewBus', source => {
    forEachMappingOfType('source', mapping => setLEDForKeyMapping(mapping, mapping.source == source, false, null, null));
});

switcher.on('programBus', source => {
    forEachMappingOfType('source', mapping => setLEDForKeyMapping(mapping, null, null, mapping.source == source, false));
});

let currentlyTransitioning = false;
switcher.on('TrPs', packet => {
    const transitioning = (packet[1] & 1) == 1;

    if (transitioning == currentlyTransitioning) return;
    currentlyTransitioning = transitioning;

    forEachMappingOfType('auto', mapping => setLEDForKeyMapping(mapping, null, null, transitioning, transitioning));
});

let currentlyFTB = false;
switcher.on('FtbS', packet => {
    const isFTB = (packet[1] & 1) == 1 || (packet[2] & 1) == 1;

    if (isFTB == currentlyFTB) return;
    currentlyFTB = isFTB;

    forEachMappingOfType('ftb', mapping => setLEDForKeyMapping(mapping, null, null, isFTB, isFTB));
});

switcher.on('TrSS', packet => {
    forEachMappingOfType('transition', mapping => setLEDForKeyMapping(mapping, mapping.transition == packet[1], false, null, null));
});

let currentWipe;
switcher.on('TWpP', packet => {
    currentWipe = packet[2];
});

/*
// For development purposes
switcher.on('rawCommand', cmd => {
    if (cmd.name != 'Time') console.log(`Command ${cmd.name} received`);
});
*/

/* Panel button handlers */

let programMode = false;

panel.on('down', keyIndex => {
    if (config.showKeyPresses) console.log(`Key ${keyIndex} pressed`);

    const mapping = keyMappings[keyIndex];
    if (!mapping) return;

    switch (mapping.function) {
        case 'cut':
            switcher.cut();
            break;
        case 'auto':
            switcher.auto();
            break;
        case 'ftb':
            switcher.sendCommand(new ATEM.Command('FtbA', Buffer.from([0, 2, 0, 0])));
            break;
        case 'transition':
            switcher.sendCommand(new ATEM.Command('CTTp', Buffer.from([1, 0, mapping.transition, 0])));
            break;
        case 'wipe_prev':
        case 'wipe_next':
            const data = Buffer.alloc(20, 0);
            data[1] = 2;
            if (mapping.function == 'wipe_prev') data[4] = Math.max(currentWipe - 1, 0);
            else data[4] = Math.min(currentWipe + 1, 17);
            switcher.sendCommand(new ATEM.Command('CTWp', data));
            break;
        case 'program_mode':
            programMode = !programMode;
            setLEDForKeyMapping(mapping, null, null, programMode, false);
            break;
        case 'source':
            if (programMode) switcher.setProgram(mapping.source);
            else switcher.setPreview(mapping.source);
            break;
        case 'backlight_up':
            currentBrightness = Math.min(currentBrightness + 10, 255);
            panel.setBacklightIntensity(currentBrightness);
            break;
        case 'backlight_down':
            currentBrightness = Math.max(currentBrightness - 10, 0);
            panel.setBacklightIntensity(currentBrightness);
            break;
    }
});
