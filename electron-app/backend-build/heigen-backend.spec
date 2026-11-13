from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


project_root = Path(SPECPATH).parents[1]
snaplytics_root = project_root / "Snaplytics"


hiddenimports = []
for package in ("Snaplytics", "backend", "endpoints", "recommender"):
    hiddenimports.extend(collect_submodules(package))


datas = []
for package in ("backend", "endpoints", "recommender"):
    datas.extend(collect_data_files(package))


a = Analysis(
    [str(snaplytics_root / "packaging" / "backend_launcher.py")],
    pathex=[str(snaplytics_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="heigen-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
