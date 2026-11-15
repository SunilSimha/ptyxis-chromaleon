// Keeps a Ptyxis profile tinted like Chromaleon tints GTK windows.
//
// Chromaleon rewrites ~/.config/gtk-4.0/custom-accent.css whenever its colors change. We watch that one file with
// inotify (nothing runs while it is untouched), turn its tinted colors into a Ptyxis palette (see palette.js), and
// point a dedicated "Chromaleon" Ptyxis profile at that palette.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildPalette, parseTints} from './palette.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const LOG = '[ptyxis-chromaleon]';
const CHROMALEON_CSS = GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', 'custom-accent.css']);

// Ptyxis identifies a palette by its file name without ".palette". Like Ptyxis' own GNOME palette, ours has a [Light]
// and a [Dark] section and Ptyxis picks one by itself when the system appearance changes, so the profile never has to
// change when that happens. We only rewrite the file when Chromaleon's colors change.
const PALETTE_ID = 'chromaleon';
const PALETTE_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'org.gnome.Ptyxis', 'palettes', `${PALETTE_ID}.palette`]);

// Fixed, so the extension finds its profile again after a restart instead of creating a new one every time.
const PROFILE_UUID = 'a240a0c05dca4889937be7547640cc82';

// Chromaleon can write the file several times for one change; wait for it to settle.
const SETTLE_MS = 200;
// Ptyxis reloads a changed palette file 100 ms later. Wait for that before telling open terminals to repaint.
const PTYXIS_RELOAD_MS = 300;

async function readText(path, cancellable) {
    const [bytes] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
    return new TextDecoder().decode(bytes);
}

export default class PtyxisChromaleon extends Extension {
    enable() {
        this._cancellable = new Gio.Cancellable();
        this._timers = {};

        this._ptyxis = this._ensureProfile();
        if (!this._ptyxis)
            return;

        this._monitor = Gio.File.new_for_path(CHROMALEON_CSS).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._later('sync', SETTLE_MS, () => this._sync()));

        // Chromaleon may have changed colors while we were disabled.
        this._sync();
    }

    // Deliberately leaves the profile and palette in place. GNOME disables extensions every time the screen locks,
    // so undoing our changes here would flip the terminal back and forth on every lock and unlock.
    disable() {
        this._cancellable?.cancel();
        this._monitor?.cancel();
        Object.values(this._timers ?? {}).forEach(id => GLib.Source.remove(id));
        this._cancellable = this._monitor = this._timers = this._ptyxis = null;
    }

    /** Makes sure the "Chromaleon" profile exists and uses our palette. Returns Ptyxis' settings, or null without Ptyxis. */
    _ensureProfile() {
        const source = Gio.SettingsSchemaSource.get_default();
        if (!source.lookup('org.gnome.Ptyxis', true) || !source.lookup('org.gnome.Ptyxis.Profile', true)) {
            console.warn(`${LOG} Ptyxis is not installed, doing nothing`);
            return null;
        }

        const app = new Gio.Settings({schema_id: 'org.gnome.Ptyxis'});
        const uuids = app.get_strv('profile-uuids');
        if (!uuids.includes(PROFILE_UUID))
            app.set_strv('profile-uuids', [...uuids, PROFILE_UUID]);

        const profile = new Gio.Settings({
            schema_id: 'org.gnome.Ptyxis.Profile',
            path: `/org/gnome/Ptyxis/Profiles/${PROFILE_UUID}/`,
        });
        profile.set_string('label', 'Chromaleon');
        profile.set_string('palette', PALETTE_ID);
        return app;
    }

    /**
     * Makes open terminals pick up the rewritten palette. Ptyxis does not repaint a terminal when the file changes; it
     * does when the `palette` setting of the terminal's profile changes. Setting the same value again changes nothing,
     * so reset the setting first. That has to be done for every profile that uses our palette, not just ours: the
     * palette can be chosen in any profile's preferences.
     *
     * The sync() matters: while another settings write is in flight (ChromaLeon makes several), dconf merges a reset
     * and a set of the same key into one write that changes nothing, and Ptyxis never repaints.
     */
    _repaint() {
        for (const uuid of this._ptyxis?.get_strv('profile-uuids') ?? []) {
            const profile = new Gio.Settings({
                schema_id: 'org.gnome.Ptyxis.Profile',
                path: `/org/gnome/Ptyxis/Profiles/${uuid}/`,
            });
            if (profile.get_string('palette') !== PALETTE_ID)
                continue;
            profile.reset('palette');
            Gio.Settings.sync();
            profile.set_string('palette', PALETTE_ID);
        }
    }

    /** Regenerates the palette from Chromaleon's stylesheet, if that changes anything. */
    async _sync() {
        try {
            const tints = parseTints(await readText(CHROMALEON_CSS, this._cancellable));
            if (!tints) {
                console.warn(`${LOG} ${CHROMALEON_CSS} has no tinted colors (is Chromaleon's tinting on?), leaving the palette alone`);
                return;
            }

            const base = await readText(GLib.build_filenamev([this.path, 'base.palette']), this._cancellable);
            const palette = buildPalette(tints, base);
            if (palette === await readText(PALETTE_FILE, this._cancellable).catch(() => null))
                return;

            GLib.mkdir_with_parents(GLib.path_get_dirname(PALETTE_FILE), 0o755);
            await Gio.File.new_for_path(PALETTE_FILE).replace_contents_bytes_async(
                new GLib.Bytes(new TextEncoder().encode(palette)), null, false, Gio.FileCreateFlags.NONE, this._cancellable);

            this._later('repaint', PTYXIS_RELOAD_MS, () => this._repaint());
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`${LOG} ${e.message}`);
        }
    }

    /** Runs `callback` after `ms`, replacing any callback still waiting under the same name. */
    _later(name, ms, callback) {
        if (this._timers[name])
            GLib.Source.remove(this._timers[name]);
        this._timers[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            delete this._timers[name];
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }
}
