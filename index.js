const ATEM = require('atem');
const fs = require('fs');
const JSON5 = require('json5');
const xkeys = require('xkeys');

const config = JSON5.parse(fs.readFileSync('config.json5'));
const keyMappings = {};
config.keys.forEach(mapping => keyMappings[mapping.key] = mapping);

let panel, switcher;
let currentWipe = 0;
let currentBrightness = config.initialBrightness;
let currentSourcePreview, currentSourceProgram;
let isShifted = false;

const COLOR_OFF = false;
const COLOR_RED = 'red';
const COLOR_BLUE = 'blue';
const COLOR_RED_BLUE = 'redblue';

const backlightCache = new Map();
const setLEDForKeyMapping = (keyMapping, color, flash) => {
    const params = [color, flash];

    let keys = [keyMapping.key];
    if (keyMapping.additionalLEDs) keys = keys.concat(keyMapping.additionalLEDs);

    keys.forEach(keyIndex => {
        const cachedParams = backlightCache.get(keyIndex);
        if (cachedParams && cachedParams.every((p, i) => p === params[i])) return;

        panel.setBacklight(keyIndex, color, flash && color !== false);

        backlightCache.set(keyIndex, params);
    });
};

const forEachMappingOfType = (type, callback) => {
    Object.values(keyMappings).filter(mapping => mapping.function == type).forEach(callback);
};

const flashAllSources = function() {
    forEachMappingOfType('source', mapping => setLEDForKeyMapping(mapping, COLOR_RED, true));
};

function updateSourceLights() {
    forEachMappingOfType('source', mapping => {
        let source = isShifted ? mapping.shiftSource : mapping.source;
        let color = COLOR_OFF;
        if (source !== undefined) {
            if (source == currentSourceProgram) {
                color = COLOR_RED;
                if (source == currentSourcePreview) color = COLOR_RED_BLUE;
            } else if (source == currentSourcePreview) {
                color = COLOR_BLUE;
            }
        }
        setLEDForKeyMapping(mapping, color)
    });

    forEachMappingOfType('source_pgm', mapping => {
        let source = isShifted ? mapping.shiftSource : mapping.source;
        setLEDForKeyMapping(mapping, source !== undefined && source == currentSourceProgram ? COLOR_RED : COLOR_OFF);
    });
}

async function main() {
    panel = await xkeys.setupXkeysPanel();
    switcher = new ATEM();

    panel.setBacklightIntensity(currentBrightness);
    panel.setFrequency(8);

    if (config.clearBacklightOnStartup) {
        panel.setAllBacklights(COLOR_OFF);
    } else {
        Object.values(keyMappings).forEach(mapping => setLEDForKeyMapping(mapping, COLOR_OFF));
    }

    switcher.ip = config.switcherIP;
    switcher.connect();
    flashAllSources();

    setupSwitcherHandlers();
    setupPanelHandlers();
}

function setupSwitcherHandlers() {
    switcher.on('connectionStateChange', state => {
        console.log(`ATEM connection state: ${state.description}`);
        if (state !== ATEM.ConnectionState.open) flashAllSources();
    });

    switcher.on('previewBus', source => {
        currentSourcePreview = source;
        updateSourceLights();
    });

    switcher.on('programBus', source => {
        currentSourceProgram = source;
        updateSourceLights();
    });

    let currentlyTransitioning = false;
    switcher.on('TrPs', packet => {
        const transitioning = (packet[1] & 1) == 1;

        if (transitioning == currentlyTransitioning) return;
        currentlyTransitioning = transitioning;

        forEachMappingOfType('auto', mapping => setLEDForKeyMapping(mapping, transitioning ? COLOR_RED : COLOR_OFF, true));
    });

    let currentlyFTB = false;
    switcher.on('FtbS', packet => {
        const isFTB = (packet[1] & 1) == 1 || (packet[2] & 1) == 1;

        if (isFTB == currentlyFTB) return;
        currentlyFTB = isFTB;

        forEachMappingOfType('ftb', mapping => setLEDForKeyMapping(mapping, isFTB ? COLOR_RED : COLOR_OFF, true));
    });

    switcher.on('TrSS', packet => {
        forEachMappingOfType('transition', mapping => setLEDForKeyMapping(mapping, mapping.transition == packet[1] ? COLOR_BLUE : COLOR_OFF));
    });

    switcher.on('TWpP', packet => {
        currentWipe = packet[2];
    });

    /*
    // For development purposes
    switcher.on('rawCommand', cmd => {
        if (cmd.name != 'Time') console.log(`Command ${cmd.name} received`);
    });
    */
}

function setupPanelHandlers() {
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
                setLEDForKeyMapping(mapping, programMode ? COLOR_RED : COLOR_OFF);
                break;
            case 'shift':
                isShifted = true;
                updateSourceLights();
                break;
            case 'shift_toggle':
                isShifted = !isShifted;
                updateSourceLights();
                break;
            case 'source':
            case 'source_pgm':
                let source = isShifted ? mapping.shiftSource : mapping.source;
                if (source === undefined) break;
                if (programMode || mapping.function == 'source_pgm') switcher.setProgram(source);
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
        }
    });

    panel.on('up', keyIndex => {
        const mapping = keyMappings[keyIndex];
        if (!mapping) return;

        switch (mapping.function) {
            case 'shift':
                isShifted = false;
                updateSourceLights();
                break;
        }
    });

    if (!config.disableTbar) {
        let lastTbarPosition = -1;
        let tbarReverse = false;

        panel.on('tbar', (index, position) => {
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
}

main();

