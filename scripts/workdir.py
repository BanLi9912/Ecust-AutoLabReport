"""Create (or reuse) the per-experiment work folder and print its path.

Default root: the user's real Desktop, resolved through the Windows Known Folder
API so that OneDrive-redirected Desktops still work. Override with --root or the
LAB_REPORT_HOME environment variable.

Usage:
    python workdir.py "分子磁化率测定"
    python workdir.py "分子磁化率测定" --root D:\\lab  --quiet
"""

from __future__ import annotations

import argparse
import ctypes
import os
import sys
from pathlib import Path
from ctypes import wintypes

DESKTOP_FOLDER = "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}"
SUBDIRS = ("paper", "figs", "html/gen", "html/final", "shots")
BAD = '\\/:*?"<>|'


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]


def known_folder(rfid: str) -> Path | None:
    """Resolve a Windows known folder id; None when the API is unavailable."""
    try:
        guid = _GUID()
        if ctypes.windll.ole32.CLSIDFromString(ctypes.c_wchar_p(rfid), ctypes.byref(guid)) != 0:
            return None
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(
            ctypes.byref(guid), 0, None, ctypes.byref(out)
        ) != 0:
            return None
        path = Path(out.value)
        ctypes.windll.ole32.CoTaskMemFree(out)
        return path
    except Exception:
        return None


def default_root() -> Path:
    env = os.environ.get("LAB_REPORT_HOME")
    if env:
        return Path(env).expanduser()
    desktop = known_folder(DESKTOP_FOLDER)
    if desktop is None or not desktop.is_dir():
        home = Path.home()
        for cand in (home / "Desktop", home / "OneDrive" / "Desktop"):
            if cand.is_dir():
                desktop = cand
                break
        else:
            desktop = home
    return desktop / "实验报告"


def safe_name(name: str) -> str:
    cleaned = "".join(("_" if ch in BAD else ch) for ch in name).strip().strip(".")
    return cleaned or "未命名实验"


def make(name: str, root: Path | None = None) -> Path:
    work = (root or default_root()).expanduser() / safe_name(name)
    for sub in SUBDIRS:
        (work / sub).mkdir(parents=True, exist_ok=True)
    return work.resolve()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="为一次实验报告建工作目录，并打印路径")
    ap.add_argument("name", help="实验名称，用作文件夹名")
    ap.add_argument("--root", help="根目录，默认 桌面\\实验报告")
    ap.add_argument("--quiet", action="store_true", help="只打印路径")
    args = ap.parse_args(argv)

    work = make(args.name, Path(args.root) if args.root else None)
    if not args.quiet:
        print(f"work = {work}")
        for sub in SUBDIRS:
            print(f"  {sub}{os.sep}")
        print("再次运行同一实验名会复用这个目录，不会清空已有文件。")
    else:
        print(work)
    return 0


if __name__ == "__main__":
    sys.exit(main())
