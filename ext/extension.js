// Crosshair Overlay — GNOME Shell extension
// Draws a crosshair in the shell UI layer, so it stays visible above
// fullscreen windows (games, videos, ...) and never steals input.

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {paintCrosshair} from './painter.js';

const PAINT_KEYS = [
    'size', 'thickness', 'gap', 'color', 'opacity', 'outline',
    'outline-color', 'dot', 'dot-size', 'circle', 'circle-radius',
    'offset-x', 'offset-y',
];

const Crosshair = GObject.registerClass({
    GTypeName: 'CrosshairOverlay',
}, class Crosshair extends St.DrawingArea {
    _init(settings, monitor) {
        super._init({
            style_class: 'crosshair-overlay',
            reactive: false,
            can_focus: false,
        });
        this._settings = settings;
        this._monitor = monitor;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [surfaceWidth, surfaceHeight] = this.get_surface_size();
        const s = this._settings;

        paintCrosshair(cr, {
            surfaceWidth,
            surfaceHeight,
            monitorWidth: this._monitor.width,
            monitorHeight: this._monitor.height,
            offsetX: s.get_int('offset-x'),
            offsetY: s.get_int('offset-y'),
            size: s.get_uint('size'),
            thickness: s.get_uint('thickness'),
            gap: s.get_uint('gap'),
            color: s.get_string('color'),
            opacity: s.get_double('opacity'),
            outline: s.get_boolean('outline'),
            outlineColor: s.get_string('outline-color'),
            dot: s.get_boolean('dot'),
            dotSize: s.get_uint('dot-size'),
            circle: s.get_boolean('circle'),
            circleRadius: s.get_uint('circle-radius'),
        });
    }
});

export default class CrosshairExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._actors = [];
        this._settingsSignals = [];
        this._layoutSignals = [];
        this._focusSignal = 0;
        this._unredirectDisabled = false;

        this._rebuild();

        for (const key of ['monitor-mode', 'monitor-index', 'enabled']) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._rebuild()));
        }
        for (const key of PAINT_KEYS) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._repaintAll()));
        }

        this._layoutSignals.push(
            Main.layoutManager.connect('monitors-changed', () => this._rebuild()));
        this._focusSignal = global.display.connect('notify::focus-window', () => {
            if (this._settings.get_string('monitor-mode') === 'focused')
                this._rebuild();
        });

        Main.wm.addKeybinding(
            'toggle-keybinding',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._settings.set_boolean(
                'enabled', !this._settings.get_boolean('enabled')));
    }

    disable() {
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        for (const id of this._layoutSignals)
            Main.layoutManager.disconnect(id);
        this._layoutSignals = [];

        if (this._focusSignal) {
            global.display.disconnect(this._focusSignal);
            this._focusSignal = 0;
        }

        Main.wm.removeKeybinding('toggle-keybinding');
        this._destroyActors();

        this._settings = null;
        this._actors = [];
    }

    _targetMonitors() {
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0)
            return [];

        const forced = this._settings.get_int('monitor-index');
        if (forced >= 0 && forced < monitors.length)
            return [monitors[forced]];

        const mode = this._settings.get_string('monitor-mode');
        if (mode === 'all')
            return monitors;
        if (mode === 'focused') {
            const idx = global.display.get_current_monitor();
            if (idx >= 0 && idx < monitors.length)
                return [monitors[idx]];
        }
        const primary = Main.layoutManager.primaryMonitor;
        return primary ? [primary] : [monitors[0]];
    }

    _destroyActors() {
        for (const actor of this._actors) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._actors = [];
        this._disableUnredirect();
    }

    // 全屏游戏时 Mutter 会 direct scanout（直接扫描输出、绕过合成器），
    // 导致整个 GNOME Shell UI 层（含准星）不参与合成而“消失”。
    // 与 GNOME 显示 OSD/通知气泡到全屏窗口之上的做法一致：
    // 有准星在显示期间禁用 unredirect，强制走正常合成路径。
    // 二者是计数式的，务必成对调用，否则会触发 mutter 的 CRITICAL 告警。
    _enableUnredirect() {
        if (this._unredirectDisabled)
            return;
        global.compositor.disable_unredirect();
        this._unredirectDisabled = true;
    }

    _disableUnredirect() {
        if (!this._unredirectDisabled)
            return;
        global.compositor.enable_unredirect();
        this._unredirectDisabled = false;
    }

    _rebuild() {
        this._destroyActors();
        if (!this._settings || !this._settings.get_boolean('enabled'))
            return;

        for (const monitor of this._targetMonitors()) {
            const area = new Crosshair(this._settings, monitor);
            area.set_position(monitor.x, monitor.y);
            area.set_size(monitor.width, monitor.height);
            // trackFullscreen MUST stay false: in GNOME Shell's LayoutManager
            // it means "hide this chrome actor whenever a fullscreen window is
            // visible", which is the exact opposite of what we want.
            // The actor is non-reactive, so it never captures input.
            Main.layoutManager.addChrome(area, {
                affectsStruts: false,
                trackFullscreen: false,
            });
            this._actors.push(area);
        }
        this._enableUnredirect();
    }

    _repaintAll() {
        for (const actor of this._actors)
            actor.queue_repaint();
    }
}
