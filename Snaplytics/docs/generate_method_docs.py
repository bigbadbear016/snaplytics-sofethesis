#!/usr/bin/env python3
import ast
import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parents[1]
OUT_MD = ROOT / "docs" / "method_line_by_line_documentation.md"
OUT_DOCX = ROOT / "docs" / "method_line_by_line_documentation.docx"

TARGET_DIRS = [ROOT / "backend", ROOT / "electron-app", ROOT / "HeigenKiosk"]

EXCLUDE_PARTS = {
    "node_modules",
    "migrations",
    "android",
    "ios",
    "build",
    ".git",
}

EXCLUDE_SUFFIXES = {
    ".zip",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".css",
    ".html",
    ".json",
    ".keystore",
    ".gradle",
    ".properties",
    ".xml",
    ".md",
    ".txt",
    ".lock",
}

INCLUDE_EXTS = {".py", ".js"}


@dataclass
class MethodDoc:
    file_path: Path
    name: str
    signature: str
    start_line: int
    end_line: int
    source_lines: List[str]


def should_include(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.suffix not in INCLUDE_EXTS:
        return False
    if any(part in EXCLUDE_PARTS for part in path.parts):
        return False
    if any(str(path).endswith(s) for s in EXCLUDE_SUFFIXES):
        return False
    return True


def discover_files() -> List[Path]:
    found = []
    for d in TARGET_DIRS:
        if not d.exists():
            continue
        for p in d.rglob("*"):
            if should_include(p):
                found.append(p)
    return sorted(found)


def get_py_signature(node: ast.AST) -> str:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return ""

    args = []
    for a in node.args.posonlyargs:
        args.append(a.arg)
    if node.args.posonlyargs:
        args.append("/")

    for a in node.args.args:
        args.append(a.arg)

    if node.args.vararg:
        args.append(f"*{node.args.vararg.arg}")
    elif node.args.kwonlyargs:
        args.append("*")

    for a in node.args.kwonlyargs:
        args.append(a.arg)

    if node.args.kwarg:
        args.append(f"**{node.args.kwarg.arg}")

    return f"{node.name}({', '.join(args)})"


def extract_python_methods(path: Path) -> List[MethodDoc]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    methods = []

    try:
        tree = ast.parse(text)
    except SyntaxError:
        return methods

    class StackVisitor(ast.NodeVisitor):
        def __init__(self):
            self.stack: List[str] = []

        def visit_ClassDef(self, node: ast.ClassDef):
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef):
            self._record(node)
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
            self._record(node, is_async=True)
            self.generic_visit(node)

        def _record(self, node, is_async=False):
            start = getattr(node, "lineno", None)
            end = getattr(node, "end_lineno", None)
            if not start or not end:
                return
            qual = ".".join(self.stack + [node.name]) if self.stack else node.name
            sig = get_py_signature(node)
            if is_async:
                sig = "async " + sig
            methods.append(
                MethodDoc(
                    file_path=path,
                    name=qual,
                    signature=sig,
                    start_line=start,
                    end_line=end,
                    source_lines=lines[start - 1 : end],
                )
            )

    StackVisitor().visit(tree)
    return methods


def is_js_method_start(line: str) -> bool:
    s = line.strip()
    if not s or s.startswith("//") or s.startswith("*"):
        return False

    if re.match(r"^(export\s+)?(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(", s):
        return True
    if re.match(r"^(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\([^;]*=>", s):
        return True
    if re.match(r"^(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?[A-Za-z_$][\w$]*\s*=>", s):
        return True
    if re.match(r"^[A-Za-z_$][\w$]*\s*:\s*(async\s*)?function\s*\(", s):
        return True
    if re.match(r"^[A-Za-z_$][\w$]*\s*:\s*(async\s*)?\([^;]*=>", s):
        return True
    if re.match(r"^(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*$", s):
        return True
    return False


def get_js_name_signature(line: str) -> Tuple[str, str]:
    s = line.strip().rstrip("{").strip()
    patterns = [
        (r"^(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\((.*)\)", lambda m: (m.group(3), f"{(m.group(2) or '').strip() + ' ' if m.group(2) else ''}function {m.group(3)}({m.group(4)})".strip())),
        (r"^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\((.*)\)\s*=>", lambda m: (m.group(2), f"{m.group(2)} = {(m.group(3) or '').strip() + ' ' if m.group(3) else ''}({m.group(4)}) =>".strip())),
        (r"^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?([A-Za-z_$][\w$]*)\s*=>", lambda m: (m.group(2), f"{m.group(2)} = {(m.group(3) or '').strip() + ' ' if m.group(3) else ''}{m.group(4)} =>".strip())),
        (r"^([A-Za-z_$][\w$]*)\s*:\s*(async\s*)?function\s*\((.*)\)", lambda m: (m.group(1), f"{m.group(1)}: {(m.group(2) or '').strip() + ' ' if m.group(2) else ''}function({m.group(3)})".strip())),
        (r"^([A-Za-z_$][\w$]*)\s*:\s*(async\s*)?\((.*)\)\s*=>", lambda m: (m.group(1), f"{m.group(1)}: {(m.group(2) or '').strip() + ' ' if m.group(2) else ''}({m.group(3)}) =>".strip())),
        (r"^(async\s+)?([A-Za-z_$][\w$]*)\s*\((.*)\)\s*$", lambda m: (m.group(2), f"{(m.group(1) or '').strip() + ' ' if m.group(1) else ''}{m.group(2)}({m.group(3)})".strip())),
    ]
    for pat, fn in patterns:
        m = re.match(pat, s)
        if m:
            n, sig = fn(m)
            return n, sig
    return (s[:40], s)


def extract_js_methods(path: Path, include_object_callables: bool = False) -> List[MethodDoc]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    methods = []

    # Use Babel AST to capture only named, user-defined JS callables.
    node_script = r"""
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const filePath = process.argv[1];
const code = fs.readFileSync(filePath, 'utf8');
const ast = parser.parse(code, {
  sourceType: 'unambiguous',
  plugins: [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
    'topLevelAwait'
  ]
});

function getParams(params) {
  return params.map((p) => {
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'RestElement' && p.argument && p.argument.type === 'Identifier') return '...' + p.argument.name;
    return 'param';
  }).join(', ');
}

const methods = [];

traverse(ast, {
  FunctionDeclaration(path) {
    const n = path.node;
    if (!n.id || !n.loc) return;
    const asyncPrefix = n.async ? 'async ' : '';
    methods.push({
      name: n.id.name,
      signature: `${asyncPrefix}function ${n.id.name}(${getParams(n.params)})`,
      start_line: n.loc.start.line,
      end_line: n.loc.end.line
    });
  },
  VariableDeclarator(path) {
    const n = path.node;
    if (!n.id || n.id.type !== 'Identifier' || !n.init || !n.loc) return;
    const init = n.init;
    if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') return;
    if (!init.loc) return;
    const isAsync = !!init.async;
    const params = getParams(init.params || []);
    const kind = path.parent && path.parent.kind ? path.parent.kind : 'const';
    methods.push({
      name: n.id.name,
      signature: `${kind} ${n.id.name} = ${isAsync ? 'async ' : ''}(${params}) =>`,
      start_line: n.loc.start.line,
      end_line: init.loc.end.line
    });
  },
  ClassMethod(path) {
    const n = path.node;
    if (!n.key || !n.loc) return;
    let name = null;
    if (n.key.type === 'Identifier') name = n.key.name;
    else if (n.key.type === 'StringLiteral') name = n.key.value;
    if (!name) return;
    const asyncPrefix = n.async ? 'async ' : '';
    methods.push({
      name,
      signature: `${asyncPrefix}${name}(${getParams(n.params || [])})`,
      start_line: n.loc.start.line,
      end_line: n.loc.end.line
    });
  },
  ObjectMethod(path) {
    if (!INCLUDE_OBJECT_CALLABLES) return;
    const n = path.node;
    if (!n.key || !n.loc) return;
    let name = null;
    if (n.key.type === 'Identifier') name = n.key.name;
    else if (n.key.type === 'StringLiteral') name = n.key.value;
    if (!name) return;
    const asyncPrefix = n.async ? 'async ' : '';
    methods.push({
      name,
      signature: `${asyncPrefix}${name}(${getParams(n.params || [])})`,
      start_line: n.loc.start.line,
      end_line: n.loc.end.line
    });
  },
  ObjectProperty(path) {
    if (!INCLUDE_OBJECT_CALLABLES) return;
    const n = path.node;
    if (!n.key || !n.value || !n.loc) return;
    if (n.value.type !== 'ArrowFunctionExpression' && n.value.type !== 'FunctionExpression') return;
    let name = null;
    if (n.key.type === 'Identifier') name = n.key.name;
    else if (n.key.type === 'StringLiteral') name = n.key.value;
    if (!name || !n.value.loc) return;
    const params = getParams(n.value.params || []);
    methods.push({
      name,
      signature: `${name}: ${n.value.async ? 'async ' : ''}(${params}) =>`,
      start_line: n.loc.start.line,
      end_line: n.value.loc.end.line
    });
  }
});

methods.sort((a, b) => a.start_line - b.start_line || a.end_line - b.end_line || a.name.localeCompare(b.name));
const uniq = [];
const seen = new Set();
for (const m of methods) {
  const k = `${m.name}:${m.start_line}:${m.end_line}`;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(m);
}
process.stdout.write(JSON.stringify(uniq));
"""

    env = os.environ.copy()
    node_paths = []
    if (ROOT / "HeigenKiosk" / "node_modules").exists():
        node_paths.append(str(ROOT / "HeigenKiosk" / "node_modules"))
    if (ROOT / "electron-app" / "node_modules").exists():
        node_paths.append(str(ROOT / "electron-app" / "node_modules"))
    if node_paths:
        env["NODE_PATH"] = os.pathsep.join(node_paths)

    try:
        proc = subprocess.run(
            [
                "node",
                "-e",
                f"const INCLUDE_OBJECT_CALLABLES = {str(include_object_callables).lower()};\n{node_script}",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        parsed = json.loads(proc.stdout.strip() or "[]")
    except Exception:
        return methods

    for item in parsed:
        start = int(item.get("start_line", 0))
        end = int(item.get("end_line", 0))
        if start <= 0 or end <= 0 or end < start:
            continue
        methods.append(
            MethodDoc(
                file_path=path,
                name=str(item.get("name", "unnamed")),
                signature=str(item.get("signature", "")),
                start_line=start,
                end_line=end,
                source_lines=lines[start - 1 : end],
            )
        )

    return methods


def explain_line(line: str) -> str:
    s = line.strip()
    if not s:
        return "Blank line used for readability and logical separation."
    if s.startswith("#"):
        return "Comment line documenting developer intent or context."
    if s.startswith("//"):
        return "Comment line describing behavior or rationale."
    if s.startswith("import ") or s.startswith("from "):
        return "Imports dependencies required by this method's implementation."
    if s in ("}", "};"):
        return "Closes the current block/scope."
    if s == "{":
        return "Opens a new block scope."
    if s.startswith("if ") or s.startswith("if("):
        return "Checks a condition to decide whether this execution path should run."
    if s.startswith("elif "):
        return "Checks an alternative condition if prior conditions did not match."
    if s.startswith("else"):
        return "Defines the fallback path when previous conditions are not satisfied."
    if s.startswith("for "):
        return "Iterates over a collection to apply repeated processing."
    if s.startswith("while "):
        return "Repeats execution while the condition remains true."
    if s.startswith("try"):
        return "Begins protected execution to catch runtime failures cleanly."
    if s.startswith("except") or s.startswith("catch"):
        return "Handles an error path raised in the protected block."
    if s.startswith("finally"):
        return "Runs cleanup logic regardless of success or failure."
    if s.startswith("return"):
        return "Returns a value to the caller and ends method execution for this path."
    if s.startswith("raise") or "throw " in s:
        return "Raises an error/exception to signal failure to the caller."
    if "await " in s:
        return "Waits for an asynchronous operation before continuing."
    if ".get(" in s or ".post(" in s or "fetch(" in s:
        return "Triggers an external API/network request as part of this flow."
    if "=" in s and "==" not in s and "=>" not in s:
        return "Assigns or updates a variable used by subsequent logic."
    if s.startswith("def ") or s.startswith("async def") or "function " in s or "=>" in s:
        return "Declares the callable signature and entry point for this method."
    return "Executes a core operation in this method's control flow."


def render_markdown(methods: List[MethodDoc]) -> str:
    by_file = {}
    for m in methods:
        by_file.setdefault(m.file_path, []).append(m)

    total_files = len(by_file)
    total_methods = len(methods)

    out = []
    out.append("# Method-Level Line-by-Line Documentation")
    out.append("")
    out.append("## Scope")
    out.append("")
    out.append("- Targets: Django backend (`backend/`), Electron app (`electron-app/`), HeigenKiosk React Native app (`HeigenKiosk/`)\n- Generated automatically from source files with `.py` and `.js` extensions (excluding migrations, node_modules, Android/iOS build trees, and non-code assets).")
    out.append("")
    out.append("## Coverage Summary")
    out.append("")
    out.append(f"- Total files with methods: {total_files}")
    out.append(f"- Total methods documented: {total_methods}")
    out.append("")

    for file_path in sorted(by_file):
        rel = file_path.relative_to(ROOT)
        methods_in_file = sorted(by_file[file_path], key=lambda m: m.start_line)
        out.append(f"## File: `{rel}`")
        out.append("")
        out.append(f"- Methods documented: {len(methods_in_file)}")
        out.append("")

        for idx, m in enumerate(methods_in_file, start=1):
            out.append(f"### {idx}. `{m.name}`")
            out.append("")
            out.append(f"- Signature: `{m.signature}`")
            out.append(f"- Source range: lines {m.start_line}-{m.end_line}")
            out.append("")
            out.append("#### Line-by-line")
            out.append("")
            for offs, src in enumerate(m.source_lines):
                ln = m.start_line + offs
                out.append(f"- Line {ln}:")
                out.append("  ```text")
                out.append(src)
                out.append("  ```")
                out.append(f"  Explanation: {explain_line(src)}")
            out.append("")

    return "\n".join(out)


def build_docs(include_object_callables: bool, out_md: Path, out_docx: Path):
    files = discover_files()
    methods: List[MethodDoc] = []

    for p in files:
        if p.suffix == ".py":
            methods.extend(extract_python_methods(p))
        elif p.suffix == ".js":
            methods.extend(extract_js_methods(p, include_object_callables=include_object_callables))

    methods.sort(key=lambda m: (str(m.file_path), m.start_line))

    md = render_markdown(methods)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(md, encoding="utf-8")

    subprocess.run(
        [
            "pandoc",
            str(out_md),
            "-o",
            str(out_docx),
        ],
        check=True,
    )

    print(f"Generated: {out_md}")
    print(f"Generated: {out_docx}")
    print(f"Methods documented: {len(methods)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--variant",
        choices=["full", "user", "both"],
        default="both",
        help="full: include object-literal callables; user: explicit declarations only; both: generate both sets",
    )
    args = parser.parse_args()

    docs_dir = ROOT / "docs"

    if args.variant in ("full", "both"):
        build_docs(
            include_object_callables=True,
            out_md=docs_dir / "method_line_by_line_documentation.md",
            out_docx=docs_dir / "method_line_by_line_documentation.docx",
        )
        build_docs(
            include_object_callables=True,
            out_md=docs_dir / "method_line_by_line_documentation_full.md",
            out_docx=docs_dir / "method_line_by_line_documentation_full.docx",
        )

    if args.variant in ("user", "both"):
        build_docs(
            include_object_callables=False,
            out_md=docs_dir / "method_line_by_line_documentation_user_methods.md",
            out_docx=docs_dir / "method_line_by_line_documentation_user_methods.docx",
        )


if __name__ == "__main__":
    main()
