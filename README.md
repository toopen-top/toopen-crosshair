# ToOpen Crosshair

A GNOME Shell extension that draws a crosshair on the screen — always visible,
even in fullscreen games — without stealing mouse or keyboard input.

## Why not a plain Python window

Wayland offers no protocol for a regular app window to stay above other
fullscreen windows. This project makes **GNOME Shell itself** draw the
crosshair (`Main.layoutManager.addChrome`), in the compositor's UI layer:

- Always visible above fullscreen apps (Mutter disables direct scanout when an
  overlay is present)
- No injection, no hooks — input handling is completely unaffected
- Python handles install & tuning; the extension does the actual drawing

> Note: `addChrome`'s `trackFullscreen` must be `false`. That flag means
> "hide when fullscreen", so setting it to `true` would hide the crosshair in
> games.

## Installation

```bash
cd ~/Desktop/toopen-crosshair
python3 toopen-crosshair.py --install
```

Then **log out and back in once** (Wayland cannot hot-load a new extension;
this is a one-time step). A green crosshair appears at the center of the
screen.

## Common commands

```bash
python3 toopen-crosshair.py on | off | toggle     # toggle
python3 toopen-crosshair.py --status              # print current settings
python3 toopen-crosshair.py --prefs               # open the graphical preferences
python3 toopen-crosshair.py --doctor              # environment / install / log diagnostics

python3 toopen-crosshair.py --size 30 --thickness 3 --color '#ff0000' --dot
python3 toopen-crosshair.py --gap 6 --circle --circle-radius 20
python3 toopen-crosshair.py --opacity 0.85 --no-outline
python3 toopen-crosshair.py --monitor all         # all / primary / focused / index
python3 toopen-crosshair.py --offset-x 0 --offset-y -3   # fine-tune position

python3 toopen-crosshair.py --set size=34 gap=8    # any setting
```

The global shortcut `Super+C` toggles the crosshair (configurable or clearable
in preferences).

## Language

The preferences window uses English msgids + gettext, so it **follows the
system language** (`LC_MESSAGES`):

- Chinese system → Chinese UI
- Any other language → falls back to English
- Translations: `po/zh_CN.po`; compiled:
  `ext/locale/zh_CN/LC_MESSAGES/toopen-crosshair.mo`
- `--install` runs `msgfmt` automatically (hint if missing:
  `sudo pacman -S gettext`)

Edit the `.po`, re-run `--install`, reopen preferences to see the new strings.
The `metadata.json` name/description is read directly by GNOME and **cannot be
translated** (always English).

## Editing preferences without re-login

`prefs.js` is a stable thin shell that loads the real UI via
`import('prefs-ui.js?v=<mtime>')`; an mtime change → URL change → the ESM cache
inside the GNOME Shell process is invalidated automatically.

- Change `prefs-ui.js` / `.po`: `--install` then reopen preferences —
  **no re-login**
- Change `prefs.js` itself (the thin shell): re-login once (Shell caches only
  this one file)

## Settings reference

| Key | Meaning | Default |
|---|---|---|
| `enabled` | Show the crosshair | `true` |
| `size` | Total crosshair length (logical px) | 22 |
| `thickness` | Line width | 2 |
| `gap` | Center gap | 4 |
| `color` / `opacity` | Color / opacity | `#00ff00` / 1.0 |
| `outline` / `outline-color` | Dark outline (readable on bright backgrounds) | `true` / `#000000` |
| `dot` / `dot-size` | Center dot | `false` / 3 |
| `circle` / `circle-radius` | Surrounding ring | `false` / 11 |
| `monitor-mode` | `all` / `primary` / `focused` | `all` |
| `monitor-index` | Force a single monitor (`-1` = off) | `-1` |
| `offset-x` / `offset-y` | Center offset calibration | 0 |
| `toggle-keybinding` | Global shortcut | `['<Super>c']` |

## Troubleshooting

```bash
python3 toopen-crosshair.py --doctor
```

- **No crosshair after re-login**: run `--status`, check registration & state;
  should read `ENABLED`
- **JS errors in the log**:
  `journalctl -o cat /usr/bin/gnome-shell | grep -i crosshair`
- **Changed extension.js, want it live**:
  `python3 toopen-crosshair.py --reload`, or re-login
- **Changed prefs-ui.js / translations**: `--install` then close & reopen
  preferences
- **Preferences still English**: `--doctor` checks compiled translations &
  current locale; ensure the system locale is `zh_CN.UTF-8`
- **Crosshair not centered**: fine-tune with `--offset-x/--offset-y`
- **Full removal**: `python3 toopen-crosshair.py --uninstall` then re-login

## Known limitations

- Games launched under `gamescope` in exclusive DRM mode bypass the GNOME
  Shell UI layer, so the crosshair is not visible
- Competitive online games may treat on-screen crosshairs as cheating — use at
  your own risk
- Multi-monitor and fractional scaling are handled; if a screen is still
  off-center, calibrate with the offsets

## Layout

```
toopen-crosshair/
├── toopen-crosshair.py               # CLI entry point
├── po/zh_CN.po                       # Chinese translation (msgids in English)
├── ext/                              # extension source (--install copies it below)
│   ├── metadata.json
│   ├── extension.js                  # mount / monitors / shortcut
│   ├── painter.js                    # pure cairo drawing logic (unit-testable)
│   ├── prefs.js                      # preferences thin shell (mtime hot-reload)
│   ├── prefs-ui.js                   # preferences UI (gettext strings)
│   ├── locale/zh_CN/LC_MESSAGES/toopen-crosshair.mo   # generated by --install
│   └── schemas/…
└── installed at: ~/.local/share/gnome-shell/extensions/toopen-crosshair@toopen.top/
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
