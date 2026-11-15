#!/usr/bin/env python3
"""
准星（ToOpen Crosshair）控制脚本。

准星本身由 GNOME Shell 扩展绘制，位于 shell UI 层，
因此在全屏游戏中也不会被覆盖，并且完全不干扰鼠标键盘输入。

用法示例：
    python3 toopen-crosshair.py --install          # 安装扩展（装完需注销重登一次）
    python3 toopen-crosshair.py on / off / toggle
    python3 toopen-crosshair.py --size 28 --thickness 3 --color '#00ff00' --dot
    python3 toopen-crosshair.py --monitor all
    python3 toopen-crosshair.py --status
    python3 toopen-crosshair.py --prefs            # 打开图形设置
    python3 toopen-crosshair.py --doctor           # 环境与排错检查
    python3 toopen-crosshair.py --uninstall
"""

from __future__ import annotations

import argparse
import ast
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

UUID = "toopen-crosshair@toopen.top"
SCHEMA_ID = "org.gnome.shell.extensions.toopen-crosshair"
HERE = Path(__file__).resolve().parent
EXT_SRC = HERE / "ext"
PO_DIR = HERE / "po"
LOCALE_DIR = EXT_SRC / "locale"
DEST = Path.home() / ".local/share/gnome-shell/extensions" / UUID
SCHEMA_DIR = DEST / "schemas"
SETTINGS_PREFIX = "/org/gnome/shell/extensions/toopen-crosshair/"

MONITOR_MODES = ("all", "primary", "focused")

# argparse 属性 -> GSettings 键
SHORTCUTS = {
    "size": "size",
    "thickness": "thickness",
    "gap": "gap",
    "color": "color",
    "opacity": "opacity",
    "dot_size": "dot-size",
    "outline_color": "outline-color",
    "circle_radius": "circle-radius",
    "offset_x": "offset-x",
    "offset_y": "offset-y",
}

TYPE_LABEL = {
    "b": "布尔",
    "u": "非负整数",
    "i": "整数",
    "d": "小数",
    "s": "字符串",
    "as": "字符串列表",
    "enum": "枚举",
}


class Fail(RuntimeError):
    pass


def run(cmd, check=True):
    # LC_ALL=C keeps gnome-extensions output parseable regardless of locale.
    env = {**os.environ, "LC_ALL": "C"}
    proc = subprocess.run([str(c) for c in cmd], text=True,
                          capture_output=True, env=env)
    if check and proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise Fail(f"命令失败：{' '.join(str(c) for c in cmd)}\n{msg}")
    return proc


def gs(*args, check=True):
    return run(["gsettings", "--schemadir", SCHEMA_DIR, *args], check)


def installed() -> bool:
    return (SCHEMA_DIR / "gschemas.compiled").is_file()


def require_installed() -> None:
    if not installed():
        raise Fail("扩展尚未安装。先运行：python3 toopen-crosshair.py --install")


def key_type(key: str) -> str:
    out = gs("range", SCHEMA_ID, key).stdout.strip()
    if not out:
        return "?"
    first = out.splitlines()[0].strip()
    parts = first.split()
    if parts[0] in ("type", "range") and len(parts) > 1:
        return parts[1]
    if first == "enum":
        return "enum"
    return "?"


NUMERIC_PREFIXES = ("uint64 ", "int64 ", "uint32 ", "int32 ",
                    "uint16 ", "int16 ", "uint8 ", "int8 ")


def key_value(key: str) -> str:
    raw = gs("get", SCHEMA_ID, key).stdout.strip()
    for prefix in NUMERIC_PREFIXES:
        if raw.startswith(prefix):
            return raw[len(prefix):]
    if len(raw) > 1 and raw.startswith("'") and raw.endswith("'"):
        return raw[1:-1]
    return raw


def set_key(key: str, value) -> None:
    gs("set", SCHEMA_ID, key, str(value))


def set_bool(key: str, value: bool) -> None:
    set_key(key, "true" if value else "false")


# ── Shell 级启用列表 ─────────────────────────────────────────────────
# gnome-extensions enable 需要 shell 已经扫描到该扩展；Wayland 下新装的扩展
# 在重登前无法被扫描，所以这里直接维护 dconf 里的启用列表。

def shell_enabled_extensions() -> list[str]:
    raw = run(["gsettings", "get", "org.gnome.shell",
               "enabled-extensions"], check=False).stdout.strip()
    raw = raw.removeprefix("@as ").strip()
    if not raw:
        return []
    try:
        items = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    return [str(i) for i in items] if isinstance(items, list) else []


def set_shell_enabled_extensions(items: list[str]) -> None:
    value = "[" + ", ".join(f"'{i}'" for i in items) + "]"
    run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", value])


def add_to_shell_enabled() -> bool:
    items = shell_enabled_extensions()
    if UUID in items:
        return False
    items.append(UUID)
    set_shell_enabled_extensions(items)
    return True


def remove_from_shell_enabled() -> bool:
    items = shell_enabled_extensions()
    if UUID not in items:
        return False
    set_shell_enabled_extensions([i for i in items if i != UUID])
    return True


# ── 安装 / 卸载 ──────────────────────────────────────────────────────

def compile_translations() -> list[str]:
    """把 po/<lang>.po 编译成 ext/locale/<lang>/LC_MESSAGES/toopen-crosshair.mo。

    界面文案用英文 msgid + gettext，因此语言自动跟随系统（LC_MESSAGES）。
    返回成功编译的语言列表。
    """
    if not PO_DIR.is_dir():
        return []
    if shutil.which("msgfmt") is None:
        print("⚠️  未找到 msgfmt，跳过翻译编译（界面将显示英文）")
        print("   Arch 下安装：sudo pacman -S gettext")
        return []

    compiled = []
    # 清理所有旧 .mo（编译产物，可安全重建；避免改名后残留旧域名的 .mo）
    for mo in LOCALE_DIR.glob("*/LC_MESSAGES/*.mo"):
        mo.unlink()

    for po in sorted(PO_DIR.glob("*.po")):
        lang = po.stem
        out = LOCALE_DIR / lang / "LC_MESSAGES" / "toopen-crosshair.mo"
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            run(["msgfmt", "--check", "-o", out, po])
        except Fail as exc:
            raise Fail(f"翻译编译失败：{po}\n{exc}") from None
        compiled.append(lang)

    return compiled


def prefs_changed_after_login() -> bool:
    """prefs.js 是否在本次 GNOME Shell 启动之后被更新过。

    GNOME Shell 在自身进程内 import(prefs.js) 且无法清除 ESM 缓存，
    所以该项为 True 时，设置面板可能仍在用旧代码，需要注销重登一次。
    """
    pids = run(["pgrep", "-x", "gnome-shell"], check=False).stdout.split()
    prefs = DEST / "prefs.js"
    if not pids or not prefs.is_file():
        return False
    elapsed = run(["ps", "-o", "etimes=", "-p", pids[0]], check=False).stdout.strip()
    try:
        started = time.time() - int(elapsed)
    except ValueError:
        return False
    return prefs.stat().st_mtime > started


def cmd_install(_args):
    if not EXT_SRC.is_dir():
        raise Fail(f"找不到扩展源码目录：{EXT_SRC}")

    if shutil.which("glib-compile-schemas") is None:
        raise Fail("缺少 glib-compile-schemas（Arch：sudo pacman -S glib2）")

    # 先编译翻译，再同步，保证 .mo 一起进安装目录
    langs = compile_translations()

    DEST.mkdir(parents=True, exist_ok=True)
    # 逐文件同步，避免删除正在运行的扩展目录导致 shell 把扩展标记为异常
    for src in EXT_SRC.rglob("*"):
        if not src.is_file():
            continue
        target = DEST / src.relative_to(EXT_SRC)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
    for dst in DEST.rglob("*"):
        if not dst.is_file() or dst.name == "gschemas.compiled":
            continue
        if not (EXT_SRC / dst.relative_to(DEST)).exists():
            dst.unlink()

    # 编译设置 schema
    run(["glib-compile-schemas", SCHEMA_DIR])

    enable = run(["gnome-extensions", "enable", UUID], check=False)
    enabled_now = enable.returncode == 0
    added = add_to_shell_enabled()

    print(f"✅ 已安装到 {DEST}")
    print("   schema 编译完成")
    if langs:
        print(f"   翻译编译完成：{', '.join(langs)}（界面语言跟随系统）")
    if enabled_now:
        print("✅ 扩展已在当前会话启用，准星改动立即生效")
        if prefs_changed_after_login():
            print("⚠️  prefs.js 在本次登录后被更新过，设置面板可能仍用旧缓存。")
            print("   若面板报错或文案没变，注销重登一次即可（仅此一次）。")
        else:
            print("   设置面板：关掉重开即可，无需注销。")
    elif added:
        print("✅ 已加入 GNOME 的启用列表（重登后自动加载）")
        print()
        print("👉 现在请：注销并重新登录一次（Wayland 无法热加载新扩展）")
        print("   重登后执行：python3 toopen-crosshair.py --status")
        print("   屏幕正中央应出现绿色十字；全屏游戏里同样可见。")


def cmd_uninstall(_args):
    run(["gnome-extensions", "disable", UUID], check=False)
    if remove_from_shell_enabled():
        print("已从 GNOME 启用列表移除")
    if DEST.exists():
        shutil.rmtree(DEST)
        print(f"🗑  已删除 {DEST}")
    else:
        print("扩展目录不存在，跳过")
    run(["dconf", "reset", "-f", SETTINGS_PREFIX], check=False)
    print("已重置设置。注销重登后彻底移除。")


# ── 开关 ────────────────────────────────────────────────────────────

def cmd_on(_args):
    require_installed()
    set_bool("enabled", True)
    print("准星：开")


def cmd_off(_args):
    require_installed()
    set_bool("enabled", False)
    print("准星：关")


def cmd_toggle(_args):
    require_installed()
    current = key_value("enabled") == "true"
    set_bool("enabled", not current)
    print(f"准星：{'关' if current else '开'}")


# ── 调参 ────────────────────────────────────────────────────────────

def cmd_monitor(args):
    require_installed()
    raw = str(args.monitor).strip()
    if raw in MONITOR_MODES:
        set_key("monitor-mode", raw)
        set_key("monitor-index", -1)
        print(f"显示器模式：{raw}")
    else:
        try:
            index = int(raw)
        except ValueError:
            raise Fail("--monitor 只接受 all / primary / focused 或显示器索引（0、1…）")
        set_key("monitor-index", index)
        print(f"强制显示器索引：{index}")


def cmd_set(args):
    require_installed()
    if not args.set:
        return
    for item in args.set:
        if "=" not in item:
            raise Fail(f"格式应为 key=value，收到：{item}")
        key, value = item.split("=", 1)
        key = key.strip()
        typ = key_type(key)
        if typ == "?":
            raise Fail(f"未知设置项：{key}")
        set_key(key, value.strip())
        print(f"{key} = {value.strip()}")


def apply_shortcuts(args) -> None:
    changed = []
    for attr, key in SHORTCUTS.items():
        value = getattr(args, attr, None)
        if value is not None:
            set_key(key, value)
            changed.append(f"{key}={value}")

    for flag, key, value in (
        ("dot", "dot", True),
        ("no_dot", "dot", False),
        ("circle", "circle", True),
        ("no_circle", "circle", False),
        ("outline", "outline", True),
        ("no_outline", "outline", False),
    ):
        if getattr(args, flag, False):
            set_bool(key, value)
            changed.append(f"{key}={'true' if value else 'false'}")

    if changed:
        print("已更新：" + ", ".join(changed))


# ── 状态 / 诊断 ─────────────────────────────────────────────────────

STATUS_KEYS = [
    ("enabled", "开关"),
    ("monitor-mode", "显示器模式"),
    ("monitor-index", "强制显示器索引"),
    ("size", "长度"),
    ("thickness", "线宽"),
    ("gap", "中心空隙"),
    ("color", "颜色"),
    ("opacity", "不透明度"),
    ("outline", "深色描边"),
    ("outline-color", "描边颜色"),
    ("dot", "中心点"),
    ("dot-size", "中心点大小"),
    ("circle", "外圈"),
    ("circle-radius", "外圈半径"),
    ("offset-x", "水平偏移"),
    ("offset-y", "垂直偏移"),
    ("toggle-keybinding", "快捷键"),
]


def cmd_status(_args):
    if not installed():
        print("未安装。运行：python3 toopen-crosshair.py --install")
        return
    print(f"扩展目录：{DEST}")
    listed = run(["gnome-extensions", "list"], check=False).stdout.split()
    print(f"已注册  ：{'是' if UUID in listed else '否（可能需注销重登）'}")
    state = run(["gnome-extensions", "show", UUID], check=False).stdout
    for line in state.splitlines():
        if "State:" in line:
            print(f"状态    ：{line.split(':', 1)[1].strip()}")
    print()
    for key, label in STATUS_KEYS:
        try:
            value = key_value(key)
        except Fail:
            value = "<读取失败>"
        typ = TYPE_LABEL.get(key_type(key), "")
        print(f"{label}: {value}" + (f"   ({typ})" if typ else ""))


def cmd_doctor(_args):
    print("== 环境 ==")
    shell = run(["gnome-shell", "--version"], check=False).stdout.strip()
    print(f"GNOME Shell : {shell or '未知'}")
    print(f"会话类型    : {sys.platform} / {run(['sh', '-c', 'echo $XDG_SESSION_TYPE'], check=False).stdout.strip()}")
    print(f"Python      : {sys.version.split()[0]}")
    print(f"glib-compile-schemas: {'有' if shutil.which('glib-compile-schemas') else '缺失'}")
    print(f"msgfmt      : {'有' if shutil.which('msgfmt') else '缺失（sudo pacman -S gettext）'}")
    mos = sorted(p.parent.parent.name for p in LOCALE_DIR.glob("*/LC_MESSAGES/toopen-crosshair.mo"))
    print(f"已编译翻译  : {', '.join(mos) if mos else '无'}")
    lang_env = os.environ.get("LC_ALL") or os.environ.get("LC_MESSAGES") or os.environ.get("LANG") or "未设置"
    print(f"当前语言    : {lang_env}")

    print("\n== 安装检查 ==")
    print(f"源码目录 : {EXT_SRC} ({'存在' if EXT_SRC.is_dir() else '缺失'})")
    print(f"目标目录 : {DEST} ({'存在' if DEST.is_dir() else '缺失'})")
    print(f"schema   : {'已编译' if installed() else '未编译'}")

    if installed():
        print("\n== 设置项完整性 ==")
        missing = []
        for key, _label in STATUS_KEYS:
            if key_type(key) == "?":
                missing.append(key)
        print("全部就绪" if not missing else f"缺失：{', '.join(missing)}")

        print("\n== 扩展状态 ==")
        show = run(["gnome-extensions", "show", UUID], check=False)
        print(show.stdout.strip() or show.stderr.strip() or "gnome-extensions 无输出")

        print("\n== 最近日志中的 crosshair 记录 ==")
        lines = []
        for journal in (["journalctl", "--user"], ["journalctl"]):
            log = run([*journal, "-o", "cat", "-n", "600"], check=False).stdout
            lines += [ln for ln in log.splitlines() if "crosshair" in ln.lower()]
        print("\n".join(lines[-15:]) if lines else "（无）")


def cmd_prefs(_args):
    require_installed()
    proc = run(["gnome-extensions", "prefs", UUID], check=False)
    if proc.returncode != 0:
        raise Fail(proc.stderr.strip() or proc.stdout.strip() or "无法打开设置窗口")


def cmd_reload(_args):
    require_installed()
    run(["gnome-extensions", "disable", UUID], check=False)
    proc = run(["gnome-extensions", "enable", UUID], check=False)
    print("已尝试重新加载。若外观没变化，请注销重登。")
    if proc.returncode != 0:
        print(proc.stderr.strip())


# ── 入口 ────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="toopen-crosshair.py",
        description="GNOME 全屏游戏准星（Shell 层绘制，永不被覆盖）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python3 toopen-crosshair.py --install
  python3 toopen-crosshair.py on
  python3 toopen-crosshair.py --size 30 --thickness 3 --color '#ff0000' --dot
  python3 toopen-crosshair.py --monitor focused
  python3 toopen-crosshair.py --offset-x 0 --offset-y -2
""")

    p.add_argument("--install", action="store_true", help="安装扩展并编译 schema")
    p.add_argument("--uninstall", action="store_true", help="卸载扩展并重置设置")
    p.add_argument("--status", action="store_true", help="显示当前配置")
    p.add_argument("--doctor", action="store_true", help="环境与排错检查")
    p.add_argument("--prefs", action="store_true", help="打开图形设置界面")
    p.add_argument("--reload", action="store_true", help="禁用后重新启用扩展")

    actions = p.add_argument_group("开关")
    actions.add_argument("action", nargs="?", choices=["on", "off", "toggle"],
                         help="on / off / toggle")

    shape = p.add_argument_group("外观")
    shape.add_argument("--size", type=int, help="十字总长度，默认 22")
    shape.add_argument("--thickness", type=int, help="线宽，默认 2")
    shape.add_argument("--gap", type=int, help="中心空隙，默认 4")
    shape.add_argument("--color", help="颜色，如 '#00ff00'")
    shape.add_argument("--opacity", type=float, help="不透明度 0.05~1.0")
    shape.add_argument("--dot", action="store_true", help="显示中心点")
    shape.add_argument("--no-dot", action="store_true", help="隐藏中心点")
    shape.add_argument("--dot-size", type=int, help="中心点直径")
    shape.add_argument("--circle", action="store_true", help="显示外圈")
    shape.add_argument("--no-circle", action="store_true", help="隐藏外圈")
    shape.add_argument("--circle-radius", type=int, help="外圈半径")
    shape.add_argument("--outline", action="store_true", help="开启深色描边")
    shape.add_argument("--no-outline", action="store_true", help="关闭深色描边")
    shape.add_argument("--outline-color", help="描边颜色")

    pos = p.add_argument_group("位置")
    pos.add_argument("--monitor", help="all / primary / focused，或显示器索引")
    pos.add_argument("--offset-x", type=int, help="水平偏移像素")
    pos.add_argument("--offset-y", type=int, help="垂直偏移像素")

    p.add_argument("--set", nargs="+", metavar="KEY=VALUE",
                   help="直接设置任意 GSettings 键，如 --set size=28 gap=6")
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.install:
            cmd_install(args)
        elif args.uninstall:
            cmd_uninstall(args)
        elif args.status:
            cmd_status(args)
        elif args.doctor:
            cmd_doctor(args)
        elif args.prefs:
            cmd_prefs(args)
        elif args.reload:
            cmd_reload(args)
        else:
            require_installed()
            if args.monitor:
                cmd_monitor(args)
            apply_shortcuts(args)
            cmd_set(args)
            if args.action:
                {"on": cmd_on, "off": cmd_off,
                 "toggle": cmd_toggle}[args.action](args)
            if not any([args.monitor, args.set, args.action]) and \
                    not any(getattr(args, a) is not None for a in SHORTCUTS) and \
                    not any(getattr(args, f) for f in
                            ("dot", "no_dot", "circle", "no_circle",
                             "outline", "no_outline")):
                parser.print_help()
    except Fail as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
