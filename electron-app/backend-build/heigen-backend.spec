from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


project_root = Path(SPECPATH).parents[1]
snaplytics_root = project_root / "Snaplytics"


hiddenimports = []
hiddenimports.extend(collect_submodules("rest_framework"))
hiddenimports.extend(collect_submodules("corsheaders"))
for package_dir in (
    snaplytics_root / "Snaplytics",
    snaplytics_root / "backend",
    snaplytics_root / "endpoints",
    snaplytics_root / "recommender",
    snaplytics_root / "renewal",
    snaplytics_root / "etl",
):
    for source_file in package_dir.rglob("*.py"):
        relative = source_file.relative_to(snaplytics_root).with_suffix("")
        module_name = ".".join(relative.parts)
        if module_name.endswith(".__init__"):
            module_name = module_name[: -len(".__init__")]
        hiddenimports.append(module_name)
hiddenimports.extend(
    [
        "backend",
        "backend.apps",
        "backend.models",
        "backend.admin",
        "backend.views",
        "backend.signals",
        "backend.auth_utils",
        "backend.coupon_utils",
        "backend.loyalty_utils",
        "backend.renewal_shadow",
        "backend.renewal_utils",
        "endpoints",
        "endpoints.apps",
        "endpoints.models",
        "endpoints.admin",
        "endpoints.views",
        "endpoints.serializers",
        "endpoints.urls",
        "endpoints.authentication",
        "recommender",
        "corsheaders",
        "corsheaders.apps",
        "corsheaders.middleware",
        "rest_framework",
        "rest_framework.apps",
        "rest_framework.authtoken",
        "Snaplytics.settings",
        "Snaplytics.urls",
        "Snaplytics.wsgi",
        "Snaplytics.asgi",
    ]
)


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
