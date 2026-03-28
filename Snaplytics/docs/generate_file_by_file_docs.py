#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT_MD = ROOT / 'docs' / 'file_by_file_documentation.md'
OUT_DOCX = ROOT / 'docs' / 'file_by_file_documentation.docx'

TARGET_DIRS = [ROOT / 'backend', ROOT / 'electron-app', ROOT / 'HeigenKiosk']
INCLUDE_EXTS = {'.py', '.js'}
EXCLUDE_PARTS = {'node_modules', 'migrations', 'android', 'ios', 'build', '.git'}
EXCLUDE_SUFFIXES = {
    '.zip', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.css', '.html', '.json',
    '.keystore', '.gradle', '.properties', '.xml', '.md', '.txt', '.lock'
}


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


def discover_files():
    files = []
    for d in TARGET_DIRS:
        if d.exists():
            for p in d.rglob('*'):
                if should_include(p):
                    files.append(p)
    return sorted(files)


def explain_line(line: str) -> str:
    s = line.strip()
    if not s:
        return 'Blank line for visual separation.'
    if s.startswith('#') or s.startswith('//') or s.startswith('/*') or s.startswith('*'):
        return 'Comment line documenting intent, behavior, or context.'
    if s.startswith('import ') or s.startswith('from '):
        return 'Imports dependency modules used in this file.'
    if s.startswith('export '):
        return 'Exports a symbol so other modules can consume it.'
    if s.startswith('class '):
        return 'Declares a class that encapsulates related behavior/state.'
    if s.startswith('def ') or s.startswith('async def '):
        return 'Declares a Python function/method.'
    if 'function ' in s:
        return 'Declares a JavaScript function.'
    if '=>' in s:
        return 'Defines an arrow function or callback expression.'
    if s.startswith('if ') or s.startswith('if('):
        return 'Checks a condition to choose a code path.'
    if s.startswith('elif '):
        return 'Alternative conditional branch after a previous condition failed.'
    if s.startswith('else'):
        return 'Fallback branch executed when earlier conditions are not met.'
    if s.startswith('for ') or s.startswith('for('):
        return 'Iterates through a collection or range.'
    if s.startswith('while ') or s.startswith('while('):
        return 'Repeats logic while the condition remains true.'
    if s.startswith('try'):
        return 'Starts guarded logic to handle runtime exceptions safely.'
    if s.startswith('except') or s.startswith('catch'):
        return 'Handles exceptions/errors from guarded logic.'
    if s.startswith('finally'):
        return 'Runs cleanup logic regardless of success/failure.'
    if s.startswith('return'):
        return 'Returns a result from the current function.'
    if s.startswith('raise') or 'throw ' in s:
        return 'Raises/throws an error to signal failure.'
    if s in ('{', '}', '};'):
        return 'Opens or closes a code block scope.'
    if 'await ' in s:
        return 'Waits for an asynchronous operation to complete.'
    if '=' in s and '==' not in s and '=>' not in s:
        return 'Assigns or updates a value used later in execution.'
    return 'Performs a core operation in this file\'s logic.'


def build_markdown(files):
    out = []
    out.append('# File-by-File Documentation')
    out.append('')
    out.append('## Scope')
    out.append('')
    out.append('- Projects: `backend` (Django), `electron-app` (Electron), `HeigenKiosk` (React Native)')
    out.append('- Format: file-by-file walkthrough with line-level explanations')
    out.append('')
    out.append('## Coverage Summary')
    out.append('')
    out.append(f'- Total files documented: {len(files)}')
    out.append('')

    for file_path in files:
        rel = file_path.relative_to(ROOT)
        lines = file_path.read_text(encoding='utf-8', errors='replace').splitlines()
        out.append(f'## File: `{rel}`')
        out.append('')
        out.append(f'- Language: {"Python" if file_path.suffix == ".py" else "JavaScript"}')
        out.append(f'- Total lines: {len(lines)}')
        out.append('')
        out.append('### File Explanation (Line-by-Line)')
        out.append('')

        for i, line in enumerate(lines, start=1):
            out.append(f'- Line {i}:')
            out.append('  ```text')
            out.append(line)
            out.append('  ```')
            out.append(f'  Explanation: {explain_line(line)}')

        out.append('')

    return '\n'.join(out)


def main():
    files = discover_files()
    md = build_markdown(files)
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text(md, encoding='utf-8')

    subprocess.run(['pandoc', str(OUT_MD), '-o', str(OUT_DOCX)], check=True)

    print(f'Generated: {OUT_MD}')
    print(f'Generated: {OUT_DOCX}')
    print(f'Files documented: {len(files)}')


if __name__ == '__main__':
    main()
