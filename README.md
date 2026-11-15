# Ptyxis Chromaleon

A GNOME Shell extension that tints a [Ptyxis](https://gitlab.gnome.org/chergert/ptyxis) profile the way
[ChromaLeon](https://github.com/Fabito02/ChromaLeon) tints GTK windows.

ChromaLeon mixes your wallpaper accent into Adwaita's grays and writes the result to
`~/.config/gtk-4.0/custom-accent.css`. Ptyxis' window chrome picks that up, but the terminal area is painted from the
palette's `Background`, which stays plain gray. This extension closes that gap.

## How it works

- It watches `~/.config/gtk-4.0/custom-accent.css` with inotify. Nothing runs until ChromaLeon rewrites that file.
- It reads the `mix(<gray>, @accent_bg_color, <ratio>)` lines ChromaLeon wrote and evaluates them. No color is chosen by
  this extension: accent, tint strength, "darker" and light/dark all come from ChromaLeon.
- It writes the result to a single palette, `~/.local/share/org.gnome.Ptyxis/palettes/chromaleon.palette`.
- `view_bg_color` becomes the terminal background and `headerbar_bg_color` the titlebar. The palette has a `[Light]`
  and a `[Dark]` section, like Ptyxis' own GNOME palette. Ptyxis picks the right one itself when the system appearance
  changes, instantly and without the profile changing. The extension is not involved in that switch.
- Ptyxis reloads a rewritten palette file but does not repaint terminals that are already open. So after writing, the
  extension resets and re-sets the profile's `palette` setting, which does repaint them.
- On first start it creates a **"Chromaleon" profile** in Ptyxis that uses that palette. Your other profiles are never
  touched. Choose it in Ptyxis (or make it the default) to get the tinted terminal. Its palette setting belongs to the
  extension.

Text and ANSI colors are not tinted by ChromaLeon, so they come from `base.palette`, a copy of Ptyxis' built-in GNOME
palette. Swap that file to change them.

## Install

```sh
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/ptyxis-chromaleon@sunilsimha.github.io
gnome-extensions enable ptyxis-chromaleon@sunilsimha.github.io
```

On Wayland a new extension is only discovered after logging out and back in. Logs: `journalctl --user -g ptyxis-chromaleon`.

Disabling the extension leaves the profile and palette in place (GNOME disables extensions on every screen lock).
Delete the profile in Ptyxis' preferences and `chromaleon.palette` to remove them.

## Limits

- If ChromaLeon's tinting is off, or it follows the system accent (`gnome-colors`), its stylesheet has no tinted
  colors. The extension logs a warning and leaves the palette alone.
- Needs GNOME Shell 51.

## Test

```sh
gjs -m test/palette.test.js
```

`test/custom-accent.css` is a real stylesheet written by ChromaLeon.
