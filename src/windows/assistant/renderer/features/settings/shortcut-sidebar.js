// Shortcuts that belong on one row: several keys doing one kind of thing.
const GROUPS = [
    { prefix: 'scrollAnswer', label: '捲動答案', english: 'Scroll' },
    { prefix: 'moveWindow', label: '移動視窗', english: 'Move' },
    { prefix: 'windowSizePreset', label: '視窗尺寸', english: 'Resize' }
];

const KEY_NAMES = {
    pageup: 'PgUp',
    pagedown: 'PgDn',
    left: '←',
    right: '→',
    up: '↑',
    down: '↓'
};

function displayKey(key) {
    return KEY_NAMES[key.toLowerCase()] || key;
}

// The modifiers every shortcut shares ("Alt+Shift"), or '' if they differ.
function sharedModifiers(shortcuts) {
    const modifierSets = shortcuts.map((shortcut) => shortcut.accelerator.split('+').slice(0, -1).join('+'));
    return modifierSets.every((modifiers) => modifiers && modifiers === modifierSets[0])
        ? modifierSets[0]
        : '';
}

function buildRows(shortcuts, modifiers) {
    const rows = [];
    const groupRows = new Map();

    for (const shortcut of shortcuts) {
        const key = modifiers
            ? displayKey(shortcut.accelerator.split('+').pop())
            : shortcut.accelerator;
        const group = GROUPS.find((entry) => shortcut.id.startsWith(entry.prefix));

        if (!group) {
            rows.push({ label: shortcut.buttonLabel, english: shortcut.englishLabel || '', keys: [key] });
            continue;
        }

        if (!groupRows.has(group.prefix)) {
            const row = { label: group.label, english: group.english, keys: [] };
            groupRows.set(group.prefix, row);
            rows.push(row);
        }
        groupRows.get(group.prefix).keys.push(key);
    }

    return rows;
}

// Fills the right-hand column with the shortcut list from `src/config.js`.
// Every shortcut shares the same modifiers, so those are shown once at the top
// and each row only shows the last key, which keeps the column narrow.
export function renderShortcutSidebar(sidebarElement, shortcuts) {
    const usable = (Array.isArray(shortcuts) ? shortcuts : []).filter(
        (shortcut) => shortcut && shortcut.id && shortcut.accelerator
    );

    sidebarElement.textContent = '';
    if (usable.length === 0) {
        return;
    }

    const modifiers = sharedModifiers(usable);

    const header = document.createElement('div');
    header.className = 'shortcut-sidebar-header';
    header.textContent = modifiers ? `${modifiers} +` : '快捷鍵';
    sidebarElement.appendChild(header);

    for (const row of buildRows(usable, modifiers)) {
        const rowElement = document.createElement('div');
        rowElement.className = 'shortcut-sidebar-row';

        const keysElement = document.createElement('span');
        keysElement.className = 'shortcut-sidebar-keys';
        for (const key of row.keys) {
            const keyElement = document.createElement('kbd');
            keyElement.textContent = key;
            keysElement.appendChild(keyElement);
        }

        const labelElement = document.createElement('span');
        labelElement.className = 'shortcut-sidebar-label';
        labelElement.textContent = row.label;

        rowElement.append(keysElement, labelElement);

        // The English name sits beside the Chinese one, unless they are the same word.
        if (row.english && row.english !== row.label) {
            const englishElement = document.createElement('span');
            englishElement.className = 'shortcut-sidebar-english';
            englishElement.textContent = row.english;
            rowElement.appendChild(englishElement);
        }
        sidebarElement.appendChild(rowElement);
    }
}
