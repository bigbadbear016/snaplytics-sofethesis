#!/usr/bin/env python3
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
OUT_MD = DOCS_DIR / "function_groups_documentation.md"
OUT_DOCX = DOCS_DIR / "function_groups_documentation.docx"

sys.path.insert(0, str(DOCS_DIR))
import generate_method_docs as gmd  # noqa: E402


@dataclass
class GroupRule:
    name: str
    purpose: str
    path_keywords: tuple[str, ...] = ()
    method_keywords: tuple[str, ...] = ()


GROUP_RULES = [
    GroupRule(
        "Authentication & Access Control",
        "Functions that create, validate, and protect authenticated sessions and account access.",
        path_keywords=("auth", "staff-guard", "supabase-client"),
        method_keywords=("login", "signup", "auth", "token", "password", "forgot", "reset", "guard", "session"),
    ),
    GroupRule(
        "Authenticated User Creation",
        "Functions that register users and initialize user data during sign-up or onboarding.",
        path_keywords=("signup", "onboarding"),
        method_keywords=("createuser", "signup", "register", "create_staff", "createprofile"),
    ),
    GroupRule(
        "Profile & Staff Management",
        "Functions that load, edit, and persist profile or staff-specific information.",
        path_keywords=("profile", "staff"),
        method_keywords=("profile", "staff", "avatar", "photo"),
    ),
    GroupRule(
        "Package & Add-on Catalog CRUD",
        "Functions that create/read/update/delete package and add-on catalog data.",
        path_keywords=("package", "addons", "shared_package_data"),
        method_keywords=("package", "addon", "catalog", "create", "update", "delete", "list", "get", "fetch"),
    ),
    GroupRule(
        "Category Management",
        "Functions that retrieve and maintain category structure used by packages and add-ons.",
        path_keywords=("category",),
        method_keywords=("category", "categories"),
    ),
    GroupRule(
        "Customer Management",
        "Functions that capture and manage customer records and customer lookup operations.",
        path_keywords=("customer",),
        method_keywords=("customer", "email", "phone"),
    ),
    GroupRule(
        "Booking Workflow",
        "Functions that build, submit, queue, and update booking transactions.",
        path_keywords=("booking", "kiosk", "queue", "summary"),
        method_keywords=("booking", "book", "queue", "status", "submit", "confirm", "checkout"),
    ),
    GroupRule(
        "Recommendations & Personalization",
        "Functions that fetch or compute recommendation and popularity outputs.",
        path_keywords=("recommend",),
        method_keywords=("recommend", "popular", "refreshrecommender"),
    ),
    GroupRule(
        "Notifications",
        "Functions that prepare or dispatch notification messages/events.",
        path_keywords=("notif", "notification"),
        method_keywords=("notify", "notif", "toast", "alert"),
    ),
    GroupRule(
        "API & HTTP Client Utilities",
        "Functions that encapsulate API requests, pagination, error handling, and transport-level concerns.",
        path_keywords=("api", "client", "views", "utils"),
        method_keywords=("request", "fetch", "api", "http", "serialize", "deserialize", "response"),
    ),
    GroupRule(
        "UI Components & Rendering",
        "Functions that render reusable UI blocks and component-level presentation behavior.",
        path_keywords=("components", "screen", "ui", "icon"),
        method_keywords=("render", "screen", "modal", "card", "button", "icon", "input"),
    ),
    GroupRule(
        "App Lifecycle & Navigation",
        "Functions that initialize app state and orchestrate navigation or session flow between pages/screens.",
        path_keywords=("app", "main", "preload", "index", "kiosk"),
        method_keywords=("init", "start", "open", "close", "navigate", "back", "reset", "boot"),
    ),
    GroupRule(
        "Django Models, Signals & Admin",
        "Functions that define backend data model behavior, admin registration, and signal-driven side effects.",
        path_keywords=("models", "signals", "admin", "apps.py"),
        method_keywords=("save", "clean", "signal", "ready", "admin"),
    ),
    GroupRule(
        "ETL & Data Operations",
        "Functions that extract, transform, load, or move operational data between systems.",
        path_keywords=("etl", "run_etl", "management/commands"),
        method_keywords=("extract", "transform", "load", "etl", "sync", "migrate"),
    ),
    GroupRule(
        "Testing & Validation Helpers",
        "Functions used to verify behavior through tests or explicit validation routines.",
        path_keywords=("test",),
        method_keywords=("test", "assert", "validate", "verify"),
    ),
]


ACTION_VERBS = [
    ("create", "Creates new data or records"),
    ("add", "Adds data into an existing structure"),
    ("get", "Retrieves data for downstream use"),
    ("fetch", "Retrieves data from an API or service"),
    ("load", "Loads state or resources into memory/UI"),
    ("update", "Updates existing records or state"),
    ("edit", "Modifies existing values"),
    ("delete", "Removes records or entities"),
    ("remove", "Removes existing data from a collection/store"),
    ("render", "Builds UI output for display"),
    ("show", "Displays content or state to users"),
    ("hide", "Hides content from view"),
    ("open", "Opens a view, modal, or resource"),
    ("close", "Closes a view, modal, or resource"),
    ("handle", "Handles an event-driven interaction"),
    ("submit", "Submits collected data to a destination"),
    ("validate", "Validates input or business rules"),
    ("reset", "Resets state to defaults"),
    ("refresh", "Refreshes data/state to latest values"),
    ("sync", "Synchronizes data across components/services"),
]


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def infer_role(method_name: str) -> str:
    n = method_name.lower()
    for key, desc in ACTION_VERBS:
        if n.startswith(key) or key in n:
            return desc
    return "Executes business logic for this feature area"


def score_rule(rule: GroupRule, file_path: str, method_name: str) -> int:
    p = file_path.lower()
    m = method_name.lower()
    score = 0
    for kw in rule.path_keywords:
        if kw in p:
            score += 3
    for kw in rule.method_keywords:
        if kw in m:
            score += 2
    return score


def assign_group(file_path: str, method_name: str) -> str:
    best_name = "Miscellaneous Utility Functions"
    best_score = 0
    for rule in GROUP_RULES:
        s = score_rule(rule, file_path, method_name)
        if s > best_score:
            best_score = s
            best_name = rule.name
    return best_name


def group_purpose(group_name: str) -> str:
    for rule in GROUP_RULES:
        if rule.name == group_name:
            return rule.purpose
    return "Functions that are project-specific utilities not strongly matched to another group."


def main() -> None:
    files = gmd.discover_files()
    methods = []
    for p in files:
        if p.suffix == ".py":
            methods.extend(gmd.extract_python_methods(p))
        elif p.suffix == ".js":
            methods.extend(gmd.extract_js_methods(p, include_object_callables=False))

    methods.sort(key=lambda m: (str(m.file_path), m.start_line))

    grouped = defaultdict(list)
    for m in methods:
        rel = str(m.file_path.relative_to(ROOT))
        group = assign_group(rel, m.name)
        grouped[group].append(m)

    ordered_groups = sorted(grouped.keys(), key=lambda g: (-len(grouped[g]), g))

    lines = []
    lines.append("# Function Groups Documentation")
    lines.append("")
    lines.append("## Scope")
    lines.append("")
    lines.append("- Projects: `backend` (Django), `electron-app` (Electron), `HeigenKiosk` (React Native)")
    lines.append("- Grouping basis: purpose alignment across function names + file context")
    lines.append("- Function set: user-defined named methods/functions")
    lines.append("")
    lines.append("## Coverage Summary")
    lines.append("")
    lines.append(f"- Total grouped functions: {len(methods)}")
    lines.append(f"- Total functional groups: {len(ordered_groups)}")
    lines.append("")

    for idx, gname in enumerate(ordered_groups, start=1):
        items = sorted(grouped[gname], key=lambda m: (str(m.file_path), m.start_line, m.name.lower()))
        lines.append(f"## {idx}. {gname}")
        lines.append("")
        lines.append(f"- Purpose: {group_purpose(gname)}")
        lines.append(f"- Functions in group: {len(items)}")
        lines.append("")
        lines.append("### Included Functions")
        lines.append("")
        for m in items:
            rel = m.file_path.relative_to(ROOT)
            lines.append(f"- `{m.name}` in `{rel}` (lines {m.start_line}-{m.end_line}): {infer_role(m.name)}.")
        lines.append("")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["pandoc", str(OUT_MD), "-o", str(OUT_DOCX)], check=True)

    print(f"Generated: {OUT_MD}")
    print(f"Generated: {OUT_DOCX}")
    print(f"Grouped functions: {len(methods)}")
    print(f"Groups: {len(ordered_groups)}")


if __name__ == "__main__":
    main()
