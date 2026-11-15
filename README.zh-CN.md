# ToOpen Crosshair（GNOME 全屏准星）

屏幕上始终显示的准星，**在全屏游戏中也可见**，且不抢鼠标键盘输入。

## 为什么不是纯 Python 窗口

Wayland 下没有任何协议允许普通应用窗口覆盖在其他全屏窗口之上。
本方案让 **GNOME Shell 自己绘制**准星（`Main.layoutManager.addChrome`），
绘制发生在合成器的 UI 层：

- 全屏应用之上一定可见（Mutter 检测到覆盖层会主动关闭 direct scanout）
- 不注入游戏进程、不 hook，输入区域完全不受影响
- Python 负责安装与调参，真正的绘制由扩展完成

> 注意：`addChrome` 的 `trackFullscreen` 必须为 `false`。该参数含义是
> 「全屏时隐藏」，设成 `true` 反而会在游戏里看不到准星。

## 安装

```bash
cd ~/Desktop/toopen-crosshair
python3 toopen-crosshair.py --install
```

然后 **注销并重新登录一次**（Wayland 无法热加载新扩展；只需一次）。
重登后屏幕正中央出现绿色十字。

## 常用命令

```bash
python3 toopen-crosshair.py on | off | toggle     # 开关
python3 toopen-crosshair.py --status              # 当前全部参数
python3 toopen-crosshair.py --prefs               # 图形设置面板
python3 toopen-crosshair.py --doctor              # 环境 / 安装 / 日志排错

python3 toopen-crosshair.py --size 30 --thickness 3 --color '#ff0000' --dot
python3 toopen-crosshair.py --gap 6 --circle --circle-radius 20
python3 toopen-crosshair.py --opacity 0.85 --no-outline
python3 toopen-crosshair.py --monitor all         # all / primary / focused / 索引
python3 toopen-crosshair.py --offset-x 0 --offset-y -3   # 位置校准

python3 toopen-crosshair.py --set size=34 gap=8    # 任意设置项
```

全局快捷键 `Super+C` 可随时开关（设置面板里可改或清空）。

## 界面语言 / 汉化

设置面板用「英文 msgid + gettext」实现，**跟随系统语言**（`LC_MESSAGES`）：

- 系统语言为中文 → 显示中文
- 其他语言 → 回退英文
- 翻译文件：`po/zh_CN.po`，编译产物：`ext/locale/zh_CN/LC_MESSAGES/toopen-crosshair.mo`
- `--install` 会自动调用 `msgfmt` 编译（缺少时提示 `sudo pacman -S gettext`）

改完 `.po` 后重新 `--install`，再重开设置面板即可看到新文案。
扩展的 `metadata.json` 名称/描述由 GNOME 直接读取，**不支持翻译**（固定英文）。

## 改设置面板不用重登

`prefs.js` 是一个固定的薄壳，按文件的 mtime 以
`import('prefs-ui.js?v=<mtime>')` 加载真正的界面；mtime 变化 → URL 变化 →
GNOME Shell 进程内的 ESM 缓存自动失效。

- 修改 `prefs-ui.js` / `.po`：`--install` 后重开面板即可，**无需注销**
- 修改 `prefs.js` 自身（薄壳）：仍需注销重登一次（Shell 只缓存这一个文件）

## 参数速查

| 键 | 含义 | 默认 |
|---|---|---|
| `enabled` | 是否显示 | `true` |
| `size` | 十字总长度（逻辑像素） | 22 |
| `thickness` | 线宽 | 2 |
| `gap` | 中心空隙 | 4 |
| `color` / `opacity` | 颜色 / 不透明度 | `#00ff00` / 1.0 |
| `outline` / `outline-color` | 深色描边（亮背景上仍清晰） | `true` / `#000000` |
| `dot` / `dot-size` | 中心点 | `false` / 3 |
| `circle` / `circle-radius` | 外圈 | `false` / 11 |
| `monitor-mode` | `all` / `primary` / `focused` | `all` |
| `monitor-index` | 强制单屏（`-1` 关闭） | `-1` |
| `offset-x` / `offset-y` | 中心偏移校准 | 0 |
| `toggle-keybinding` | 全局快捷键 | `['<Super>c']` |

## 排错

```bash
python3 toopen-crosshair.py --doctor
```

- **重登后准星没出现**：`--status` 看 `已注册` 与 `状态`；应显示 `ENABLED`
- **日志里有 JS 报错**：`journalctl -o cat /usr/bin/gnome-shell | grep -i crosshair`
- **改了 extension.js 想立刻生效**：`python3 toopen-crosshair.py --reload`，不行就重登
- **改了 prefs-ui.js / 翻译**：`--install` 后关掉重开设置面板即可，无需重登
- **设置面板文案仍是英文**：`--doctor` 看 `已编译翻译` 与 `当前语言`；确认系统语言是 `zh_CN.UTF-8`
- **准星位置不居中**：`--offset-x/--offset-y` 微调
- **想彻底移除**：`python3 toopen-crosshair.py --uninstall` 后重登

## 已知边界

- 用 `gamescope` 以独占 DRM 模式启动游戏时，GNOME Shell 的 UI 层被绕过，准星不可见
- 竞技类联网游戏可能把屏幕上叠加准星视为违规，风险自负
- 完全多显示器/分数缩放已适配；若某屏幕仍偏移，用 offset 校准

## 目录

```
toopen-crosshair/
├── toopen-crosshair.py                     # 命令行入口
├── po/zh_CN.po                      # 中文翻译（msgid 为英文）
├── ext/                             # 扩展源码（--install 会拷到下面位置）
│   ├── metadata.json
│   ├── extension.js                 # 挂载 / 显示器 / 快捷键
│   ├── painter.js                   # 纯 cairo 绘制逻辑（可单独测试）
│   ├── prefs.js                     # 设置面板薄壳（按 mtime 热加载）
│   ├── prefs-ui.js                  # 设置面板 UI（gettext 文案）
│   ├── locale/zh_CN/LC_MESSAGES/toopen-crosshair.mo   # --install 编译生成
│   └── schemas/…
└── 安装位置: ~/.local/share/gnome-shell/extensions/toopen-crosshair@toopen.top/
```
