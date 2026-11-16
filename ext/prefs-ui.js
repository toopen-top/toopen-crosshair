// 准星浮层 —— 设置面板 UI。
//
// 文案使用英文 msgid + gettext，翻译文件在 locale/<lang>/LC_MESSAGES/toopen-crosshair.mo，
// 因此界面语言自动跟随系统语言；缺少翻译时回退英文。
//
// 翻译函数由 prefs.js 传入（参数 _），这样不依赖 shell 的调用栈 URL 推断。
//
// 这个文件由 prefs.js 以 ?v=<mtime> 的形式加载，修改后无需重启 GNOME Shell。

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const MONITOR_MODES = ['all', 'primary', 'focused'];

// Adw 的 subtitle / 分组 description 按 Pango markup 解析，
// 所以 "<Super>c"、"a && b" 这类文本必须转义，否则会报 markup 警告。
const esc = text => text == null ? null : GLib.markup_escape_text(text, -1);

function addSwitch(group, settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle: esc(subtitle)});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

function addSpin(group, settings, key, title, lower, upper, step, subtitle) {
    const row = new Adw.SpinRow({
        title,
        subtitle: esc(subtitle),
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 10,
        }),
    });

    // GSettings 的整型/浮点型与 Adw.SpinRow 的 double 属性手动同步。
    // 注意：GJS 的 Gio.Settings 没有 get_type_string()，只有 Variant 有。
    const type = settings.get_value(key).get_type_string();
    if (type === 'd')
        row.digits = String(step).includes('.') ? 2 : 0;

    const read = () => {
        switch (type) {
        case 'i': return settings.get_int(key);
        case 'u': return settings.get_uint(key);
        case 'd': return settings.get_double(key);
        default: return 0;
        }
    };
    const write = value => {
        switch (type) {
        case 'i': settings.set_int(key, Math.round(value)); break;
        case 'u': settings.set_uint(key, Math.max(0, Math.round(value))); break;
        case 'd': settings.set_double(key, value); break;
        }
    };

    row.value = read();
    row.connect('notify::value', () => write(row.value));

    group.add(row);
    return row;
}

function addColor(group, settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle: esc(subtitle)});
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });

    const apply = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string(key)))
            button.rgba = rgba;
    };
    apply();
    button.connect('notify::rgba', () => {
        settings.set_string(key, button.rgba.to_string());
    });

    row.add_suffix(button);
    row.activatable_widget = button;
    group.add(row);
    return row;
}

// 快捷键：用 Gtk.Entry + EventControllerKey 捕捉按键，自动生成
// GNOME Shell 的 accelerator 字符串（如 <Super>c），用户无需手打格式。
function addShortcut(group, settings, key, title, subtitle, placeholder) {
    const row = new Adw.ActionRow({title, subtitle: esc(subtitle)});
    const entry = new Gtk.Entry({
        hexpand: true,
        valign: Gtk.Align.CENTER,
        placeholder_text: placeholder,
        secondary_icon_name: 'edit-clear-symbolic',
        secondary_icon_activatable: true,
    });

    entry.text = settings.get_strv(key)[0] ?? '';

    const controller = new Gtk.EventControllerKey();
    entry.add_controller(controller);
    controller.connect('key-pressed', (_ctrl, keyval, _keycode, state) => {
        // 单独按修饰键时不处理，等待真正的按键组合
        const modifierOnly = [
            Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
            Gdk.KEY_Control_L, Gdk.KEY_Control_R,
            Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
            Gdk.KEY_Super_L, Gdk.KEY_Super_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
            Gdk.KEY_ISO_Level3_Shift,
            Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock,
        ];
        if (modifierOnly.includes(keyval))
            return false;

        // 退格键清空（= 禁用快捷键）
        if (keyval === Gdk.KEY_BackSpace) {
            settings.set_strv(key, []);
            entry.text = '';
            return true;
        }

        const mods = state & (Gdk.ModifierType.SHIFT_MASK |
            Gdk.ModifierType.CONTROL_MASK |
            Gdk.ModifierType.ALT_MASK |
            Gdk.ModifierType.SUPER_MASK |
            Gdk.ModifierType.META_MASK);

        const accel = Gtk.accelerator_name(keyval, mods);
        if (accel) {
            settings.set_strv(key, [accel]);
            entry.text = accel;
            return true;
        }
        return false;
    });

    entry.connect('icon-release', (e, pos) => {
        if (pos === Gtk.EntryIconPosition.SECONDARY) {
            settings.set_strv(key, []);
            entry.text = '';
        }
    });

    row.add_suffix(entry);
    row.activatable_widget = entry;
    group.add(row);
    return row;
}

export function fillPreferencesWindow(prefs, window, _ = str => str) {
    const settings = prefs.getSettings();

    window.set_default_size(540, 640);

    const page = new Adw.PreferencesPage();

    // ── General ───────────────────────────────────────────────────
    const general = new Adw.PreferencesGroup({title: _('General')});
    addSwitch(general, settings, 'enabled', _('Show crosshair'), _('Default shortcut: Super+C'));
    addShortcut(general, settings, 'toggle-keybinding', _('Toggle shortcut'), _('Press keys to record, Backspace to clear'), _('Press a shortcut…'));
    page.add(general);

    // ── Shape ─────────────────────────────────────────────────────
    const shape = new Adw.PreferencesGroup({title: _('Shape')});
    addSpin(shape, settings, 'size', _('Length'), 2, 400, 1, _('Total length of the crosshair, in pixels'));
    addSpin(shape, settings, 'thickness', _('Thickness'), 1, 24, 1);
    addSpin(shape, settings, 'gap', _('Center gap'), 0, 200, 1, _('Empty space in the middle to keep the target visible'));
    addSwitch(shape, settings, 'dot', _('Center dot'), _('Add a solid dot in the exact center'));
    addSpin(shape, settings, 'dot-size', _('Dot size'), 1, 32, 1);
    addSwitch(shape, settings, 'circle', _('Ring'), _('Draw a ring around the crosshair'));
    addSpin(shape, settings, 'circle-radius', _('Ring radius'), 1, 300, 1);
    page.add(shape);

    // ── Colors ────────────────────────────────────────────────────
    const colors = new Adw.PreferencesGroup({title: _('Colors')});
    addColor(colors, settings, 'color', _('Crosshair color'));
    addSwitch(colors, settings, 'outline', _('Dark outline'), _('Keeps the crosshair readable on bright backgrounds'));
    addColor(colors, settings, 'outline-color', _('Outline color'));
    addSpin(colors, settings, 'opacity', _('Opacity'), 0.05, 1.0, 0.05, _('1.0 is fully opaque'));
    page.add(colors);

    // ── Position ──────────────────────────────────────────────────
    const position = new Adw.PreferencesGroup({title: _('Position')});
    const modeRow = new Adw.ComboRow({
        title: _('Monitors'),
        model: Gtk.StringList.new([
            _('All monitors'),
            _('Primary monitor'),
            _('Monitor with the active window'),
        ]),
        selected: Math.max(0, MONITOR_MODES.indexOf(settings.get_string('monitor-mode'))),
    });
    modeRow.connect('notify::selected', () => {
        settings.set_string('monitor-mode', MONITOR_MODES[modeRow.selected] ?? 'all');
    });
    position.add(modeRow);

    addSpin(position, settings, 'monitor-index', _('Force monitor index'), -1, 16, 1,
        _('-1 uses the selection above; 0, 1, … shows the crosshair only on that monitor'));
    addSpin(position, settings, 'offset-x', _('Horizontal offset'), -4000, 4000, 1,
        _('Fine-tune when the crosshair is not perfectly centered'));
    addSpin(position, settings, 'offset-y', _('Vertical offset'), -4000, 4000, 1);
    page.add(position);

    // ── About ─────────────────────────────────────────────────────
    const about = new Adw.PreferencesGroup({
        title: _('About'),
        description: esc(_('Displays a customizable crosshair at the center of the screen to help with aiming in fullscreen games. It is drawn by GNOME Shell directly on the topmost UI layer, so it stays visible above fullscreen windows and never blocks mouse or keyboard input.')),
    });

    const openUri = uri => {
        const launcher = new Gtk.UriLauncher({uri});
        launcher.launch(window, null, (src, result) => {
            try {
                src.launch_finish(result);
            } catch (e) {
                console.error(e.message);
            }
        });
    };

    about.add(new Adw.ActionRow({
        title: _('Author'),
        subtitle: esc('孤岛悬城'),
    }));

    const emailRow = new Adw.ActionRow({
        title: _('Email'),
        subtitle: esc('jixuancheng@qq.com'),
        activatable: true,
    });
    emailRow.connect('activated', () => openUri('mailto:jixuancheng@qq.com'));
    about.add(emailRow);

    const sourceRow = new Adw.ActionRow({
        title: _('Source code'),
        subtitle: esc('https://github.com/toopen-top/toopen-crosshair'),
        activatable: true,
    });
    sourceRow.connect('activated', () => openUri('https://github.com/toopen-top/toopen-crosshair'));
    about.add(sourceRow);

    page.add(about);

    window.add(page);
}
