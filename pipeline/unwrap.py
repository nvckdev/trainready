#!/usr/bin/env python3
"""Unwrap a persisted MCP tool result into plain JSON.
Handles both raw-JSON files and [{type:text,text:"..."}] envelopes."""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
raw = open(src).read().strip()
data = json.loads(raw)
if isinstance(data, list) and data and isinstance(data[0], dict) and "text" in data[0]:
    data = json.loads(data[0]["text"])
json.dump(data, open(dst, "w"), indent=1)
print(f"{dst}: count={data.get('count', 'n/a')}")
