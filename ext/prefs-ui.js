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

// Adw.EntryRow 没有 subtitle 属性（不同于 ActionRow / SwitchRow / SpinRow），
// 所以格式说明放在分组描述里。
function addEntry(group, settings, key, title) {
    // 快捷键在 GSettings 里是字符串数组，只取/存第一个元素。
    const row = new Adw.EntryRow({title});
    row.text = settings.get_strv(key)[0] ?? '';
    row.connect('changed', () => {
        const text = row.text.trim();
        settings.set_strv(key, text ? [text] : []);
    });
    group.add(row);
    return row;
}

export function fillPreferencesWindow(prefs, window, _ = str => str) {
    const settings = prefs.getSettings();

    window.set_default_size(540, 640);

    const page = new Adw.PreferencesPage();

    // ── General ───────────────────────────────────────────────────
    const general = new Adw.PreferencesGroup({
        title: _('General'),
        description: esc(_('The crosshair is drawn by GNOME Shell itself, so it stays visible above fullscreen windows and never blocks mouse or keyboard input. Shortcut format: <Super>c, <Control><Alt>x — leave empty to disable.')),
    });
    addSwitch(general, settings, 'enabled', _('Show crosshair'), _('Default shortcut: Super+C'));
    addEntry(general, settings, 'toggle-keybinding', _('Toggle shortcut'));
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
    const about = new Adw.PreferencesGroup({title: _('About')});
    about.add(new Adw.ActionRow({
        title: _('After changing the code'),
        subtitle: esc(_('Run: python3 toopen-crosshair.py --install')),
    }));
    about.add(new Adw.ActionRow({
        title: _('Command line'),
        subtitle: esc(_('python3 toopen-crosshair.py --status / --size 30 / --dot / --monitor primary')),
    }));
    page.add(about);

    window.add(page);
}
