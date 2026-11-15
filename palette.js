// Turns the colors Chromaleon wrote for GTK into a Ptyxis palette. No GNOME Shell imports, so it also runs under
// plain `gjs` (see test/palette.test.js).
//
// Chromaleon (https://github.com/Fabito02/ChromaLeon) tints GTK4 apps by writing lines like
//     @define-color view_bg_color mix(#0e0e10, @accent_bg_color, 0.15);
// into ~/.config/gtk-4.0/custom-accent.css, once per color scheme. We read those lines back instead of keeping any
// color values of our own, so the terminal follows whatever Chromaleon decides: accent, tint strength, "darker", etc.

import GLib from 'gi://GLib';

// Which Chromaleon color paints which Ptyxis palette key. This is the only policy in the extension.
const ROLES = {
    Background: 'view_bg_color',
    TitlebarBackground: 'headerbar_bg_color',
};

const HEX = '#[0-9a-fA-F]{6}';
const ACCENT_RE = new RegExp(`@define-color\\s+accent_bg_color\\s+(${HEX})`);
const SCHEME_RE = /@media \(prefers-color-scheme: (light|dark)\) \{([\s\S]*?)\n\}/g;
const MIX_RE = new RegExp(`@define-color\\s+(\\w+)\\s+mix\\(\\s*(${HEX})\\s*,\\s*@accent_bg_color\\s*,\\s*([\\d.]+)\\s*\\)`, 'g');

/** GTK's mix(a, b, f): linear interpolation per sRGB channel, from `a` (f = 0) to `b` (f = 1). */
export function mix(a, b, f) {
    const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [ca, cb] = [channels(a), channels(b)];
    return '#' + ca.map((c, i) => Math.round(c * (1 - f) + cb[i] * f).toString(16).padStart(2, '0')).join('');
}

/**
 * Reads Chromaleon's GTK4 stylesheet and returns the tinted colors, e.g. `{dark: {view_bg_color: '#1f1c33', ...}, light: {...}}`.
 * Returns null when the stylesheet has no tint (Chromaleon's tinting is off, or it is following the system accent).
 */
export function parseTints(css) {
    const accent = css.match(ACCENT_RE)?.[1];
    if (!accent)
        return null;

    const tints = {};
    for (const [, scheme, block] of css.matchAll(SCHEME_RE)) {
        tints[scheme] = {};
        for (const [, role, neutral, ratio] of block.matchAll(MIX_RE))
            tints[scheme][role] = mix(neutral, accent, Number(ratio));
    }

    const complete = ['light', 'dark'].every(scheme => Object.values(ROLES).every(role => tints[scheme]?.[role]));
    return complete ? tints : null;
}

/** Returns the text of a Ptyxis palette file: `baseText` (a palette file) with the tinted colors swapped in. */
export function buildPalette(tints, baseText) {
    const palette = new GLib.KeyFile();
    palette.load_from_bytes(new GLib.Bytes(new TextEncoder().encode(baseText)), GLib.KeyFileFlags.NONE);
    palette.set_string('Palette', 'Name', 'Chromaleon');
    for (const [scheme, section] of [['light', 'Light'], ['dark', 'Dark']]) {
        for (const [key, role] of Object.entries(ROLES))
            palette.set_string(section, key, tints[scheme][role]);
    }
    return palette.to_data()[0];
}
