// Run with: gjs -m test/palette.test.js
//
// custom-accent.css is a real file written by Chromaleon (accent #816cf9, tinting strength 2, "darker" on). The expected
// colors were computed separately with Python's round(a * (1 - f) + b * f) per channel, not with the code under test.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import {buildPalette, mix, parseTints} from '../palette.js';

const here = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const read = path => new TextDecoder().decode(here.resolve_relative_path(path).load_contents(null)[1]);

let failures = 0;
function check(name, actual, expected) {
    const ok = actual === expected;
    if (!ok)
        failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${actual}, expected ${expected}`}`);
}

check('mix at 0 is the first color', mix('#102030', '#ffffff', 0), '#102030');
check('mix at 1 is the second color', mix('#102030', '#ffffff', 1), '#ffffff');

const tints = parseTints(read('test/custom-accent.css'));
check('dark view_bg_color', tints.dark.view_bg_color, '#1f1c33');
check('dark headerbar_bg_color', tints.dark.headerbar_bg_color, '#27243b');
check('light view_bg_color', tints.light.view_bg_color, '#eae6fe');
check('light headerbar_bg_color', tints.light.headerbar_bg_color, '#eae6fe');

check('no accent -> null', parseTints('@media (prefers-color-scheme: dark) {\n}\n'), null);
check('accent but no tint -> null', parseTints('@define-color accent_bg_color #816cf9;\n'), null);

const palette = new GLib.KeyFile();
palette.load_from_bytes(new GLib.Bytes(new TextEncoder().encode(buildPalette(tints, read('base.palette')))), GLib.KeyFileFlags.NONE);
check('palette Name', palette.get_string('Palette', 'Name'), 'Chromaleon');
check('palette dark Background', palette.get_string('Dark', 'Background'), '#1f1c33');
check('palette dark TitlebarBackground', palette.get_string('Dark', 'TitlebarBackground'), '#27243b');
check('palette light Background', palette.get_string('Light', 'Background'), '#eae6fe');
check('palette keeps base ANSI colors', palette.get_string('Dark', 'Color4'), '#1e78e4');
check('palette keeps UseSystemAccent', palette.get_boolean('Palette', 'UseSystemAccent'), true);

System.exit(failures ? 1 : 0);
