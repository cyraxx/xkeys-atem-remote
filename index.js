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

const backlightCache = new Map();
const setLEDForKeyMapping = (keyMapping, blueOn, blueFlash, redOn, redFlash) => {
    const params = [blueOn, blueFlash, redOn, redFlash];

    let keys = [keyMapping.key];
    if (keyMapping.additionalLEDs) keys = keys.concat(keyMapping.additionalLEDs);

    keys.forEach(keyIndex => {
        const cachedParams = backlightCache.get(keyIndex);
        if (cachedParams && cachedParams.every((p, i) => p === params[i])) return;

        if (typeof blueOn == 'boolean') panel.setBacklight(keyIndex, blueOn, false, blueFlash);
        if (typeof redOn == 'boolean') panel.setBacklight(keyIndex, redOn, true, redFlash);

        backlightCache.set(keyIndex, params);
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

let flashShiftedSources = config.flashShiftedSources;


/* Switcher state change handlers */

switcher.on('connectionStateChange', state => {
    console.log(`ATEM connection state: ${state.description}`);
    if (state !== ATEM.ConnectionState.open) flashAllSources();
});

switcher.on('previewBus', source => {
    forEachMappingOfType('source', mapping => 
        {
            var sourceMatches = (mapping.source == source) && !(mapping.alwaysProgram);
            var shiftSourceMatches = (flashShiftedSources && mapping.shiftSource == source);
            setLEDForKeyMapping(mapping, (sourceMatches || shiftSourceMatches), shiftSourceMatches), null, null;  
        });
});

switcher.on('programBus', source => {
    forEachMappingOfType('source', mapping => 
        {
            var sourceMatches = (mapping.source == source) && !(mapping.alwaysPreview);
            var shiftSourceMatches = (flashShiftedSources && mapping.shiftSource == source) && !(mapping.alwaysPreview);
            setLEDForKeyMapping(mapping, null, null, (sourceMatches || shiftSourceMatches), shiftSourceMatches);  
        });
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
let shiftMode = false;

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
            let source = mapping.source;
            if (shiftMode && ('shiftSource' in mapping)) source = mapping.shiftSource;
            if ((programMode || mapping.alwaysProgram) && !mapping.alwaysPreview) switcher.setProgram(source);
            else switcher.setPreview(source);
            break;
        case 'backlight_up':
            currentBrightness = Math.min(currentBrightness + 10, 255);
            panel.setBacklightIntensity(currentBrightness);
            break;
        case 'backlight_down':
            currentBrightness = Math.max(currentBrightness - 10, 0);
            panel.setBacklightIntensity(currentBrightness);
            break;
        case 'shift':
            shiftMode = true;
            setLEDForKeyMapping(mapping, null, null, shiftMode, false);
            break;
        case 'shift_toggle':
            shiftMode = !shiftMode;
            setLEDForKeyMapping(mapping, null, null, shiftMode, false);
            break;
    }
});


panel.on('up', keyIndex => {
    
    const mapping = keyMappings[keyIndex];
    if (!mapping) return;

    switch (mapping.function) {
        case 'shift':
            shiftMode = false;
            setLEDForKeyMapping(mapping, null, null, shiftMode, false);
            break;
    }
});

/* T-bar handler */

if (!config.disableTbar) {
    let lastTbarPosition = -1;
    let tbarReverse = false;

    panel.on('tbar', position => {
        if (lastTbarPosition === -1) {
            lastTbarPosition = position;
            if (position >= 128) tbarReverse = true;
        }

        if (position === lastTbarPosition) return;
        lastTbarPosition = position;

        const atemPosition = Math.round((tbarReverse ? 255 - position : position) * 10000 / 255);
        switcher.sendCommand(new ATEM.Command('CTPs', Buffer.from([0, 0, atemPosition >>> 8, atemPosition & 0xFF])))

        if (atemPosition === 10000) tbarReverse = !tbarReverse;
    });
}
