#!/usr/bin/env python3
"""Convert a KBL harness plus a formboard layout into harness.json for the VR app.

KBL describes wiring (connectors, wires, connections, modules) but in this demo carries no
formboard geometry. The layout file places connectors, pegs and branch points on the board grid
and lists the bundle segments. Each wire's routing path is the shortest path through that
topology between its two connectors.

Usage:
  python3 tools/kbl_to_harness.py            # writes src/data/harness.json
  python3 tools/kbl_to_harness.py --check    # validate only, non-zero exit on problems
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KBL = ROOT / "data" / "door_harness_kbl.xml"
LAYOUT = ROOT / "data" / "board_layout.json"
OUT = ROOT / "src" / "data" / "harness.json"


def read_kbl(path):
    h = ET.parse(path).getroot().find("Harness")
    connectors = {c.get("id"): c.get("description") for c in h.findall("Connector_occurrence")}
    wires = {w.get("id"): w.attrib for w in h.findall("Wire_occurrence")}
    connections = []
    for c in h.findall("Connection"):
        ends = [e.get("contact_point") for e in c.findall("Extremity")]
        connections.append({"wire": c.get("wire"), "signal": c.get("signal_name"), "ends": ends})
    modules = [
        {"id": m.get("id"), "label": m.get("description"),
         "wires": [r.get("ref") for r in m.findall("Controlled_component")]}
        for m in h.findall("Module")
    ]
    return {"id": h.get("id"), "description": h.get("description"),
            "connectors": connectors, "wires": wires, "connections": connections, "modules": modules}


def shortest_path(adj, start, goal):
    prev = {start: None}
    queue = deque([start])
    while queue:
        n = queue.popleft()
        if n == goal:
            break
        for m in adj.get(n, ()):
            if m not in prev:
                prev[m] = n
                queue.append(m)
    if goal not in prev:
        return None
    path, n = [], goal
    while n is not None:
        path.append(n)
        n = prev[n]
    return path[::-1]


def build(kbl, layout):
    problems = []
    node_ids = {n["id"] for n in layout["nodes"]}
    adj = {}
    for a, b in layout["segments"]:
        for n in (a, b):
            if n not in node_ids:
                problems.append(f"segment uses unknown node {n}")
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    nodes = []
    for n in layout["nodes"]:
        node = dict(n)
        if n["kind"] == "connector":
            if n["id"] not in kbl["connectors"]:
                problems.append(f"layout connector {n['id']} not in KBL")
            node["label"] = kbl["connectors"].get(n["id"], n["id"])
        nodes.append(node)

    wires = []
    for c in kbl["connections"]:
        w = kbl["wires"].get(c["wire"])
        if w is None:
            problems.append(f"connection uses unknown wire {c['wire']}")
            continue
        a, b = (e.split(".")[0] for e in c["ends"])
        path = shortest_path(adj, a, b)
        if path is None:
            problems.append(f"no board path for {c['wire']} ({a} -> {b})")
            continue
        wires.append({
            "id": c["wire"], "colour": w["colour"],
            "cross_section_mm2": float(w["cross_section_mm2"]), "length_mm": int(w["length_mm"]),
            "signal": c["signal"], "from": c["ends"][0], "to": c["ends"][1], "path": path,
        })

    harness = {
        "id": kbl["id"], "description": kbl["description"], "board": layout["board"],
        "nodes": nodes, "segments": layout["segments"], "modules": kbl["modules"], "wires": wires,
    }
    return harness, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    harness, problems = build(read_kbl(KBL), json.loads(LAYOUT.read_text(encoding="utf-8")))
    for p in problems:
        print("problem:", p, file=sys.stderr)
    if problems:
        sys.exit(1)
    if args.check:
        print(f"ok: {len(harness['wires'])} wires routed on {len(harness['nodes'])} nodes")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(harness, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(harness['wires'])} wires")


if __name__ == "__main__":
    main()
