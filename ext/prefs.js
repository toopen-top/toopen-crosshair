// 准星浮层 —— 设置面板入口（稳定薄壳）。
//
// GNOME Shell 会在自己的进程里 await import(prefs.js)，ESM 模块按 URL 缓存
// 且无法清除。所以这里保持极简、几乎不改动，真正的 UI 放在 prefs-ui.js，
// 并用文件的 mtime 作为 URL 版本号 —— 改完 UI 后 URL 变化，立即重新加载，
// 不需要注销重登。

import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function versionedUri(file) {
    try {
        const info = file.query_info('time::modified,time::modified-usec',
            Gio.FileQueryInfoFlags.NONE, null);
        // 秒 + 微秒，避免同一秒内的改动被 ESM 缓存吞掉
        const seconds = info.get_attribute_uint64('time::modified');
        const usec = info.get_attribute_uint32('time::modified-usec');
        return `${file.get_uri()}?v=${seconds}.${usec}`;
    } catch {
        return file.get_uri();
    }
}

export default class CrosshairPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const ui = this.dir.get_child('prefs-ui.js');
        const module = await import(versionedUri(ui));
        // 显式传入翻译函数：ExtensionBase 构造时已按 metadata 的
        // gettext-domain 绑定 <extension>/locale，这里直接用最可靠，
        // 不依赖 shell 的 stack 推断（带 ?v= 的 URL 更容易出偏差）。
        await module.fillPreferencesWindow(this, window, str => this.gettext(str));
    }
}
