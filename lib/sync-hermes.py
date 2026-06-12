#!/usr/bin/env python3
"""Sync a cursor-bridge model list into Hermes Agent's config.yaml.

Single source of truth for the Hermes sync policy — used by both
`select-models.mjs` (via spawn) and `set-hermesagent.sh`:
  - custom_providers: one entry per model under the given provider name
    (entries for other providers are kept intact)
  - model.default: when it points at this bridge and names a model that is
    no longer in the list (e.g. an id Cursor removed), switch it to the
    first model so the default is always selectable

Usage: sync-hermes.py <config.yaml> <models-json-array> <base-url> <provider-name>
"""
import json
import sys

import yaml

config_path, models_json, base_url, provider = sys.argv[1:5]
models = json.loads(models_json)

with open(config_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f) or {}

kept = [p for p in (cfg.get("custom_providers") or []) if p.get("name") != provider]
cfg["custom_providers"] = kept + [
    {"name": provider, "base_url": base_url, "api_key": "",
     "api_mode": "chat_completions", "model": m}
    for m in models
]

top = cfg.get("model") or {}
if top.get("base_url") == base_url and models and top.get("default") not in models:
    old = top.get("default")
    top["default"] = models[0]
    cfg["model"] = top
    print(f"  default model {old} not in list -> switched to {models[0]}")

with open(config_path, "w", encoding="utf-8") as f:
    yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

print(f"  -> {len(models)} models written for {provider}")
