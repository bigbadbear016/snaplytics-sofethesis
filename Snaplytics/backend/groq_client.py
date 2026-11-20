"""Minimal Groq chat client (OpenAI-compatible API) using only the standard library.

GROQ_API_KEY may hold several comma-separated keys (key1,key2,key3). Calls rotate the
starting key to spread usage, and move to the next key when one is rate-limited or rejected.
Each call is stateless (the caller sends the chat history), so any key can continue a chat.
Any per-call failure (server error, timeout, unreadable reply) also tries the next key; only a
malformed request (plain 400) stops early, since every key would reject it the same way.
"""

import itertools
import json
import os
import time
import urllib.error
import urllib.request

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# 401 bad key, 403 blocked, 413 over this key's per-minute token budget, 429 rate limited.
_TRY_NEXT_KEY = {401, 403, 413, 429}
# Account-level problems Groq reports as 400; other 400s mean the request itself is bad.
_KEY_ERROR_CODES = {"organization_restricted", "invalid_api_key"}
_rotation = itertools.count()  # shortcut: per-process round-robin; use a shared store if multi-worker fairness matters
_cooldown_until = {}  # key -> time.monotonic() before which the key is skipped
_RATE_LIMIT_COOLDOWN = 60  # seconds; Groq limits reset per minute
_DEAD_KEY_COOLDOWN = 3600  # restricted/invalid account: recheck hourly


class GroqUnavailable(Exception):
    """Groq is not configured or the call failed; callers fall back silently."""


def _error_code(http_error):
    try:
        return json.loads(http_error.read().decode("utf-8"))["error"]["code"]
    except Exception:  # unreadable body: treat as a plain HTTP error
        return None


def _api_keys():
    return [k.strip() for k in os.getenv("GROQ_API_KEY", "").split(",") if k.strip()]


def chat_json(system, user, max_tokens=800, history=None):
    """Send a chat turn (after optional prior {role, content} turns) and parse the JSON reply."""
    keys = _api_keys()
    if not keys:
        raise GroqUnavailable("GROQ_API_KEY is not set")
    payload = json.dumps(
        {
            "model": os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            "messages": [
                {"role": "system", "content": system},
                *(history or []),
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.4,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")

    start = next(_rotation) % len(keys)
    order = keys[start:] + keys[:start]
    now = time.monotonic()
    # Skip keys that recently failed; if all are cooling down, try them all anyway.
    order = [k for k in order if _cooldown_until.get(k, 0) <= now] or order
    last_error = None
    for api_key in order:
        req = urllib.request.Request(
            GROQ_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "snaplytics-backend",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            dead_key = exc.code in (401, 403) or _error_code(exc) in _KEY_ERROR_CODES
            if dead_key or exc.code in _TRY_NEXT_KEY:
                # this key is limited or invalid; another account may still have quota
                _cooldown_until[api_key] = time.monotonic() + (
                    _DEAD_KEY_COOLDOWN if dead_key else _RATE_LIMIT_COOLDOWN
                )
                continue
            if exc.code >= 500:
                continue  # Groq-side hiccup: no cooldown, just try the next key
            raise GroqUnavailable(str(exc)) from exc
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            last_error = exc
            continue
        try:
            result = json.loads(body["choices"][0]["message"]["content"])
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            last_error = exc
            continue
        if not isinstance(result, dict):
            last_error = ValueError("model did not return a JSON object")
            continue
        return result
    raise GroqUnavailable(f"all {len(order)} Groq key(s) failed: {last_error}")
