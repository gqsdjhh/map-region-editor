#!/usr/bin/env python3

"""Convert a manual region JSON file into a Lua lookup table."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_payload(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    if not isinstance(payload, dict):
        raise ValueError("region json root should be an object")
    return payload


def normalize_regions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_regions = payload.get("regions")
    if not isinstance(raw_regions, list):
        raise ValueError("regions should be a list")

    regions: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for raw_region in raw_regions:
        if not isinstance(raw_region, dict):
            raise ValueError("each region should be an object")

        region_id = raw_region.get("id")
        name = raw_region.get("name")
        color = raw_region.get("color")
        if not isinstance(region_id, int) or region_id < 0:
            raise ValueError(f"invalid region id: {region_id!r}")
        if region_id in seen_ids:
            raise ValueError(f"duplicated region id: {region_id}")
        if not isinstance(name, str) or not name:
            raise ValueError(f"invalid region name for id {region_id}")
        if not isinstance(color, str) or not color.startswith("#") or len(color) != 7:
            raise ValueError(f"invalid color for region id {region_id}: {color!r}")

        seen_ids.add(region_id)
        regions.append({
            "id": region_id,
            "name": name,
            "color": color.lower(),
        })

    regions.sort(key=lambda region: region["id"])
    if not regions or regions[0]["id"] != 0:
        raise ValueError("regions must define background region id 0")
    return regions


def normalize_map(payload: dict[str, Any]) -> dict[str, Any]:
    raw_map = payload.get("map")
    if not isinstance(raw_map, dict):
        raise ValueError("map should be an object")

    width = raw_map.get("width")
    height = raw_map.get("height")
    resolution = raw_map.get("resolution")
    origin = raw_map.get("origin")
    if not isinstance(width, int) or width <= 0:
        raise ValueError(f"invalid map width: {width!r}")
    if not isinstance(height, int) or height <= 0:
        raise ValueError(f"invalid map height: {height!r}")
    if not isinstance(resolution, (int, float)):
        raise ValueError(f"invalid map resolution: {resolution!r}")
    if not isinstance(origin, dict):
        raise ValueError("map.origin should be an object")

    origin_x = origin.get("x")
    origin_y = origin.get("y")
    if not isinstance(origin_x, (int, float)):
        raise ValueError(f"invalid map origin.x: {origin_x!r}")
    if not isinstance(origin_y, (int, float)):
        raise ValueError(f"invalid map origin.y: {origin_y!r}")

    return {
        "name": str(raw_map.get("name") or "region_map"),
        "width": width,
        "height": height,
        "resolution": float(resolution),
        "origin_x": float(origin_x),
        "origin_y": float(origin_y),
    }


def normalize_polygons(
    payload: dict[str, Any],
    valid_region_ids: set[int],
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    raw_polygons = payload.get("polygons")
    if not isinstance(raw_polygons, list):
        raise ValueError("polygons should be a list")

    polygons: list[dict[str, Any]] = []
    for index, raw_polygon in enumerate(raw_polygons):
        if not isinstance(raw_polygon, dict):
            raise ValueError("each polygon should be an object")

        region_id = raw_polygon.get("region_id")
        raw_points = raw_polygon.get("points")
        if not isinstance(region_id, int) or region_id not in valid_region_ids:
            raise ValueError(f"invalid polygon region_id: {region_id!r}")
        if not isinstance(raw_points, list) or len(raw_points) < 3:
            raise ValueError("polygon.points should have at least 3 vertices")

        points: list[tuple[float, float]] = []
        for raw_point in raw_points:
            if (
                not isinstance(raw_point, list)
                or len(raw_point) < 2
                or not isinstance(raw_point[0], (int, float))
                or not isinstance(raw_point[1], (int, float))
            ):
                raise ValueError(f"invalid polygon point: {raw_point!r}")
            x = float(raw_point[0])
            y = float(raw_point[1])
            if x < 0 or y < 0 or x > width or y > height:
                raise ValueError(f"polygon point out of bounds: {raw_point!r}")
            points.append((x, y))

        polygons.append({
            "region_id": region_id,
            "order": raw_polygon.get("order") if isinstance(raw_polygon.get("order"), int) else index + 1,
            "points": points,
        })
    return polygons


def normalize_runs(raw_runs: Any, width: int, height: int) -> list[tuple[int, int, int]]:
    if not isinstance(raw_runs, list):
        return []

    runs: list[tuple[int, int, int]] = []
    for raw_run in raw_runs:
        if (
            not isinstance(raw_run, list)
            or len(raw_run) < 3
            or not isinstance(raw_run[0], int)
            or not isinstance(raw_run[1], int)
            or not isinstance(raw_run[2], int)
        ):
            raise ValueError(f"invalid run: {raw_run!r}")
        y, x1, x2 = raw_run[0], raw_run[1], raw_run[2]
        if y < 0 or y >= height or x1 < 0 or x2 < x1 or x2 >= width:
            raise ValueError(f"run out of bounds: {raw_run!r}")
        runs.append((y, x1, x2))
    return runs


def normalize_fill_patches(
    payload: dict[str, Any],
    valid_region_ids: set[int],
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    raw_patches = payload.get("fills", [])
    if not isinstance(raw_patches, list):
        raise ValueError("fills should be a list")

    patches: list[dict[str, Any]] = []
    for index, raw_patch in enumerate(raw_patches):
        if not isinstance(raw_patch, dict):
            raise ValueError("each fill patch should be an object")
        region_id = raw_patch.get("region_id")
        if not isinstance(region_id, int) or region_id not in valid_region_ids:
            raise ValueError(f"invalid fill patch region_id: {region_id!r}")
        runs = normalize_runs(raw_patch.get("runs"), width, height)
        if not runs:
            continue
        patches.append({
            "region_id": region_id,
            "order": raw_patch.get("order") if isinstance(raw_patch.get("order"), int) else index + 1,
            "runs": runs,
        })
    return patches


def protected_pixels(payload: dict[str, Any], width: int, height: int) -> set[tuple[int, int]]:
    raw_map = payload.get("map")
    if not isinstance(raw_map, dict):
        return set()

    pixels: set[tuple[int, int]] = set()
    for y, x1, x2 in normalize_runs(raw_map.get("protected_black_runs", []), width, height):
        for x in range(x1, x2 + 1):
            pixels.add((x, y))
    return pixels


def polygon_bounds(points: list[tuple[float, float]], width: int, height: int) -> tuple[int, int, int, int]:
    min_x = max(0, min(int(point[0]) for point in points))
    min_y = max(0, min(int(point[1]) for point in points))
    max_x = min(width - 1, max(int(point[0]) for point in points))
    max_y = min(height - 1, max(int(point[1]) for point in points))
    return min_x, min_y, max_x, max_y


def point_in_polygon(sample_x: float, sample_y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    previous_x, previous_y = points[-1]
    for current_x, current_y in points:
        intersects = ((current_y > sample_y) != (previous_y > sample_y)) and (
            sample_x
            < ((previous_x - current_x) * (sample_y - current_y)) / ((previous_y - current_y) or 1e-12)
            + current_x
        )
        if intersects:
            inside = not inside
        previous_x, previous_y = current_x, current_y
    return inside


def rasterize(
    width: int,
    height: int,
    polygons: list[dict[str, Any]],
    fill_patches: list[dict[str, Any]],
    protected: set[tuple[int, int]],
) -> list[list[int]]:
    rows = [[0 for _ in range(width)] for _ in range(height)]
    operations = [
        *({"type": "polygon", "order": polygon["order"], "value": polygon} for polygon in polygons),
        *({"type": "fill", "order": patch["order"], "value": patch} for patch in fill_patches),
    ]
    operations.sort(key=lambda operation: operation["order"])

    for operation in operations:
        if operation["type"] == "polygon":
            polygon = operation["value"]
            min_x, min_y, max_x, max_y = polygon_bounds(polygon["points"], width, height)
            for y in range(min_y, max_y + 1):
                sample_y = y + 0.5
                for x in range(min_x, max_x + 1):
                    sample_x = x + 0.5
                    if point_in_polygon(sample_x, sample_y, polygon["points"]):
                        rows[y][x] = polygon["region_id"]
        else:
            patch = operation["value"]
            for y, x1, x2 in patch["runs"]:
                for x in range(x1, x2 + 1):
                    if (x, y) not in protected:
                        rows[y][x] = patch["region_id"]
    return rows


def quote_lua_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def format_number(value: float) -> str:
    text = f"{value:.6f}"
    text = text.rstrip("0").rstrip(".")
    return text or "0"


def build_lua_module(map_info: dict[str, Any], regions: list[dict[str, Any]], rows: list[list[int]]) -> str:
    lines = [
        "-- Generated by tools/export_region_map.py",
        "return {",
        f"  width = {map_info['width']},",
        f"  height = {map_info['height']},",
        f"  resolution = {format_number(map_info['resolution'])},",
        "  origin = {",
        f"    x = {format_number(map_info['origin_x'])},",
        f"    y = {format_number(map_info['origin_y'])},",
        "  },",
        "  names = {",
    ]
    for region in regions:
        lines.append(f"    [{region['id']}] = {quote_lua_string(region['name'])},")
    lines.extend([
        "  },",
        "  rows = {",
    ])
    for row in rows:
        row_values = ", ".join(str(value) for value in row)
        lines.append(f"    {{ {row_values} }},")
    lines.extend([
        "  },",
        "}",
        "",
    ])
    return "\n".join(lines)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_json", type=Path, help="Path to <map>.region.json")
    parser.add_argument(
        "output_lua",
        type=Path,
        nargs="?",
        help="Output path for the generated Lua module. Defaults to <map>.lua beside the JSON file.",
    )
    return parser.parse_args()


def default_output_path(input_json: Path) -> Path:
    name = input_json.name
    if name.endswith(".region.json"):
        return input_json.with_name(name.removesuffix(".region.json") + ".lua")
    return input_json.with_suffix(".lua")


def main() -> int:
    args = parse_arguments()
    payload = load_payload(args.input_json)
    map_info = normalize_map(payload)
    regions = normalize_regions(payload)
    polygons = normalize_polygons(
        payload,
        valid_region_ids={region["id"] for region in regions},
        width=map_info["width"],
        height=map_info["height"],
    )
    fill_patches = normalize_fill_patches(
        payload,
        valid_region_ids={region["id"] for region in regions},
        width=map_info["width"],
        height=map_info["height"],
    )
    rows = rasterize(
        map_info["width"],
        map_info["height"],
        polygons,
        fill_patches,
        protected_pixels(payload, map_info["width"], map_info["height"]),
    )
    lua_module = build_lua_module(map_info, regions, rows)

    output_path = args.output_lua or default_output_path(args.input_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(lua_module, encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
