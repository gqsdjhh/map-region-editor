(function () {
  "use strict";

  const DEFAULT_REGION = {
    id: 0,
    name: "unknown",
    color: "#000000",
  };

  const BLACK_PIXEL_THRESHOLD = 8;
  const ToolMode = {
    polygon: "polygon",
    fill: "fill",
  };

  const state = {
    baseImage: null,
    baseBlackPixels: null,
    mapImageName: "",
    mapName: "",
    width: 0,
    height: 0,
    resolution: 0.05,
    originX: 0,
    originY: 0,
    zoom: 4,
    overlayOpacity: 0.55,
    regions: [cloneRegion(DEFAULT_REGION)],
    fillPatches: [],
    polygons: [],
    activeRegionId: 0,
    toolMode: ToolMode.polygon,
    selectedOperation: null,
    drawingPoints: [],
    hoverPixel: null,
    nextPolygonId: 1,
    nextFillPatchId: 1,
    nextOperationOrder: 1,
    rasterDirty: true,
    rasterRows: null,
    maskCanvas: null,
  };

  const elements = {
    mapImageInput: document.getElementById("map-image-input"),
    mapYamlInput: document.getElementById("map-yaml-input"),
    regionJsonInput: document.getElementById("region-json-input"),
    mapNameInput: document.getElementById("map-name-input"),
    resolutionInput: document.getElementById("resolution-input"),
    originXInput: document.getElementById("origin-x-input"),
    originYInput: document.getElementById("origin-y-input"),
    mapSizeLabel: document.getElementById("map-size-label"),
    newRegionNameInput: document.getElementById("new-region-name-input"),
    newRegionColorInput: document.getElementById("new-region-color-input"),
    addRegionButton: document.getElementById("add-region-button"),
    polygonToolButton: document.getElementById("polygon-tool-button"),
    fillToolButton: document.getElementById("fill-tool-button"),
    selectedRegionLabel: document.getElementById("selected-region-label"),
    selectedRegionNameInput: document.getElementById("selected-region-name-input"),
    selectedRegionColorInput: document.getElementById("selected-region-color-input"),
    regionList: document.getElementById("region-list"),
    polygonList: document.getElementById("polygon-list"),
    pendingPointsLabel: document.getElementById("pending-points-label"),
    zoomRange: document.getElementById("zoom-range"),
    zoomLabel: document.getElementById("zoom-label"),
    overlayRange: document.getElementById("overlay-range"),
    overlayLabel: document.getElementById("overlay-label"),
    pointerLabel: document.getElementById("pointer-label"),
    finishPolygonButton: document.getElementById("finish-polygon-button"),
    cancelPolygonButton: document.getElementById("cancel-polygon-button"),
    exportJsonButton: document.getElementById("export-json-button"),
    exportPngButton: document.getElementById("export-png-button"),
    exportLuaButton: document.getElementById("export-lua-button"),
    status: document.getElementById("status"),
    canvas: document.getElementById("editor-canvas"),
  };

  const canvasContext = elements.canvas.getContext("2d");

  init();

  function init() {
    bindEvents();
    syncInputsFromState();
    renderSidebar();
    renderCanvas();
  }

  function bindEvents() {
    elements.mapImageInput.addEventListener("change", onMapImageSelected);
    elements.mapYamlInput.addEventListener("change", onMapYamlSelected);
    elements.regionJsonInput.addEventListener("change", onRegionJsonSelected);

    elements.mapNameInput.addEventListener("input", () => {
      state.mapName = elements.mapNameInput.value.trim();
      renderSidebar();
    });

    elements.resolutionInput.addEventListener("input", () => {
      state.resolution = toNumber(elements.resolutionInput.value, state.resolution);
      renderSidebar();
    });

    elements.originXInput.addEventListener("input", () => {
      state.originX = toNumber(elements.originXInput.value, state.originX);
      renderSidebar();
    });

    elements.originYInput.addEventListener("input", () => {
      state.originY = toNumber(elements.originYInput.value, state.originY);
      renderSidebar();
    });

    elements.addRegionButton.addEventListener("click", addRegionFromInputs);
    elements.polygonToolButton.addEventListener("click", () => setToolMode(ToolMode.polygon));
    elements.fillToolButton.addEventListener("click", () => setToolMode(ToolMode.fill));
    elements.selectedRegionNameInput.addEventListener("input", updateSelectedRegionName);
    elements.selectedRegionColorInput.addEventListener("input", updateSelectedRegionColor);

    elements.zoomRange.addEventListener("input", () => {
      state.zoom = toNumber(elements.zoomRange.value, state.zoom);
      renderSidebar();
      renderCanvas();
    });

    elements.overlayRange.addEventListener("input", () => {
      state.overlayOpacity = toNumber(elements.overlayRange.value, 55) / 100;
      renderSidebar();
      renderCanvas();
    });

    elements.finishPolygonButton.addEventListener("click", finishPolygon);
    elements.cancelPolygonButton.addEventListener("click", cancelPolygon);

    elements.exportJsonButton.addEventListener("click", exportJson);
    elements.exportPngButton.addEventListener("click", exportPng);
    elements.exportLuaButton.addEventListener("click", exportLua);

    elements.canvas.addEventListener("click", onCanvasClick);
    elements.canvas.addEventListener("dblclick", onCanvasDoubleClick);
    elements.canvas.addEventListener("mousemove", onCanvasMouseMove);
    elements.canvas.addEventListener("mouseleave", () => {
      state.hoverPixel = null;
      renderSidebar();
      renderCanvas();
    });
    elements.canvas.addEventListener("contextmenu", onCanvasContextMenu);
  }

  async function onMapImageSelected(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const image = await loadImageFromFile(file);
      state.baseImage = image;
      state.mapImageName = file.name;
      state.width = image.naturalWidth || image.width;
      state.height = image.naturalHeight || image.height;
      state.baseBlackPixels = collectBaseBlackPixels(image, state.width, state.height);
      if (!state.mapName) {
        state.mapName = stripExtension(file.name);
      }
      markRasterDirty();
      setStatus(`Loaded map PNG: ${file.name}`);
      syncInputsFromState();
      renderSidebar();
      renderCanvas();
    } catch (error) {
      setStatus(`Failed to load map PNG: ${error.message}`, "error");
    } finally {
      elements.mapImageInput.value = "";
    }
  }

  async function onMapYamlSelected(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseMapYaml(text);
      state.resolution = parsed.resolution;
      state.originX = parsed.originX;
      state.originY = parsed.originY;
      if (!state.mapName) {
        state.mapName = stripExtension(file.name).replace(/\.region$/, "");
      }
      setStatus(`Loaded map YAML: ${file.name}`);
      syncInputsFromState();
      renderSidebar();
    } catch (error) {
      setStatus(`Failed to parse map YAML: ${error.message}`, "error");
    } finally {
      elements.mapYamlInput.value = "";
    }
  }

  async function onRegionJsonSelected(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      importRegionJson(payload);
      setStatus(`Loaded region JSON: ${file.name}`);
    } catch (error) {
      setStatus(`Failed to load region JSON: ${error.message}`, "error");
    } finally {
      elements.regionJsonInput.value = "";
    }
  }

  function importRegionJson(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("region JSON root should be an object");
    }

    const map = payload.map || {};
    if (typeof map.name === "string" && map.name.trim() !== "") {
      state.mapName = map.name.trim();
    }
    if (typeof map.image === "string") {
      state.mapImageName = map.image;
    }
    if (typeof map.width === "number") {
      state.width = map.width;
    }
    if (typeof map.height === "number") {
      state.height = map.height;
    }
    if (state.baseBlackPixels && state.baseBlackPixels.length !== state.width * state.height) {
      state.baseBlackPixels = null;
    }
    if (typeof map.resolution === "number") {
      state.resolution = map.resolution;
    }
    if (map.origin && typeof map.origin === "object") {
      if (typeof map.origin.x === "number") {
        state.originX = map.origin.x;
      }
      if (typeof map.origin.y === "number") {
        state.originY = map.origin.y;
      }
    }

    state.regions = normalizeRegions(payload.regions);
    state.polygons = normalizePolygons(payload.polygons);
    state.fillPatches = normalizeFillPatches(payload.fills, state.width, state.height);
    state.activeRegionId = state.regions[0].id;
    state.selectedOperation = null;
    state.drawingPoints = [];
    state.nextPolygonId = nextPolygonId(state.polygons);
    state.nextFillPatchId = nextFillPatchId(state.fillPatches);
    state.nextOperationOrder = nextOperationOrder(state.polygons, state.fillPatches);
    markRasterDirty();
    syncInputsFromState();
    renderSidebar();
    renderCanvas();
  }

  function normalizeRegions(rawRegions) {
    const regions = [cloneRegion(DEFAULT_REGION)];
    if (!Array.isArray(rawRegions)) {
      return regions;
    }

    rawRegions.forEach((region) => {
      if (!region || typeof region !== "object") {
        return;
      }
      if (region.id === 0) {
        regions[0] = {
          id: 0,
          name: typeof region.name === "string" && region.name.trim() !== "" ? region.name.trim() : "unknown",
          color: normalizeHexColor(region.color || "#000000"),
        };
        return;
      }

      if (typeof region.id !== "number" || !Number.isInteger(region.id) || region.id < 0) {
        return;
      }

      regions.push({
        id: region.id,
        name: typeof region.name === "string" && region.name.trim() !== "" ? region.name.trim() : `region_${region.id}`,
        color: normalizeHexColor(region.color || "#ffffff"),
      });
    });

    const unique = [];
    const seen = new Set();
    regions.sort((left, right) => left.id - right.id).forEach((region) => {
      if (seen.has(region.id)) {
        return;
      }
      seen.add(region.id);
      unique.push(region);
    });
    return unique;
  }

  function normalizePolygons(rawPolygons) {
    if (!Array.isArray(rawPolygons)) {
      return [];
    }

    const validRegionIds = new Set(state.regions.map((region) => region.id));
    return rawPolygons.flatMap((polygon, index) => {
      if (!polygon || typeof polygon !== "object") {
        return [];
      }

      const regionId = Number.isInteger(polygon.region_id) ? polygon.region_id : polygon.regionId;
      if (!validRegionIds.has(regionId)) {
        return [];
      }

      const points = Array.isArray(polygon.points)
        ? polygon.points
            .map((point) => {
              if (!Array.isArray(point) || point.length < 2) {
                return null;
              }
              const x = Number(point[0]);
              const y = Number(point[1]);
              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
              }
              return { x, y };
            })
            .filter(Boolean)
        : [];

      if (points.length < 3) {
        return [];
      }

      return [{
        id: Number.isInteger(polygon.id) ? polygon.id : index + 1,
        regionId,
        order: Number.isInteger(polygon.order) ? polygon.order : index + 1,
        points,
      }];
    });
  }

  function normalizeFillPatches(rawPatches, width, height) {
    if (!Array.isArray(rawPatches) || width <= 0 || height <= 0) {
      return [];
    }

    const validRegionIds = new Set(state.regions.map((region) => region.id));
    return rawPatches.flatMap((patch, index) => {
      if (!patch || typeof patch !== "object") {
        return [];
      }

      const regionId = Number.isInteger(patch.region_id) ? patch.region_id : patch.regionId;
      if (!validRegionIds.has(regionId)) {
        return [];
      }

      const runs = normalizeRuns(patch.runs, width, height);
      if (runs.length === 0) {
        return [];
      }

      return [{
        id: Number.isInteger(patch.id) ? patch.id : index + 1,
        regionId,
        order: Number.isInteger(patch.order) ? patch.order : index + 1,
        runs,
      }];
    });
  }

  function normalizeRuns(rawRuns, width, height) {
    if (!Array.isArray(rawRuns)) {
      return [];
    }

    return rawRuns.flatMap((run) => {
      if (
        !Array.isArray(run) ||
        run.length < 3 ||
        !Number.isInteger(run[0]) ||
        !Number.isInteger(run[1]) ||
        !Number.isInteger(run[2])
      ) {
        return [];
      }

      const y = run[0];
      const x1 = run[1];
      const x2 = run[2];
      if (y < 0 || y >= height || x1 < 0 || x2 < x1 || x2 >= width) {
        return [];
      }

      return [{ y, x1, x2 }];
    });
  }

  function onCanvasClick(event) {
    if (!hasCanvasGeometry()) {
      setStatus("Load a map PNG or region JSON with size metadata first.", "warn");
      return;
    }

    const pixel = eventToPixel(event);
    if (!pixel) {
      return;
    }

    if (state.toolMode === ToolMode.fill) {
      fillRegionAt(pixel.x, pixel.y);
      return;
    }

    state.drawingPoints.push(pixel);
    renderSidebar();
    renderCanvas();
  }

  function onCanvasDoubleClick(event) {
    event.preventDefault();
    if (state.toolMode !== ToolMode.polygon) {
      return;
    }
    if (state.drawingPoints.length >= 3) {
      finishPolygon();
    }
  }

  function onCanvasMouseMove(event) {
    if (!hasCanvasGeometry()) {
      return;
    }

    state.hoverPixel = eventToPixel(event);
    renderSidebar();
    renderCanvas();
  }

  function onCanvasContextMenu(event) {
    event.preventDefault();
    if (state.toolMode !== ToolMode.polygon) {
      return;
    }
    if (state.drawingPoints.length === 0) {
      return;
    }
    state.drawingPoints.pop();
    renderSidebar();
    renderCanvas();
  }

  function finishPolygon() {
    if (state.drawingPoints.length < 3) {
      setStatus("A polygon needs at least 3 vertices.", "warn");
      return;
    }

    state.polygons.push({
      id: state.nextPolygonId++,
      regionId: state.activeRegionId,
      order: state.nextOperationOrder++,
      points: state.drawingPoints.map((point) => ({ x: point.x, y: point.y })),
    });
    state.selectedOperation = { type: "polygon", id: state.polygons[state.polygons.length - 1].id };
    state.drawingPoints = [];
    markRasterDirty();
    setStatus(`Added polygon to region ${currentRegion().name}.`);
    renderSidebar();
    renderCanvas();
  }

  function cancelPolygon() {
    if (state.drawingPoints.length === 0) {
      return;
    }
    state.drawingPoints = [];
    setStatus("Discarded pending polygon.");
    renderSidebar();
    renderCanvas();
  }

  function addRegionFromInputs() {
    const name = elements.newRegionNameInput.value.trim();
    const color = normalizeHexColor(elements.newRegionColorInput.value);
    if (name === "") {
      setStatus("Region name cannot be empty.", "warn");
      return;
    }

    if (state.regions.some((region) => region.name === name)) {
      setStatus(`Region name already exists: ${name}`, "warn");
      return;
    }

    const nextId = nextRegionId(state.regions);
    state.regions.push({ id: nextId, name, color });
    state.activeRegionId = nextId;
    elements.newRegionNameInput.value = "";
    renderSidebar();
    renderCanvas();
    setStatus(`Added region ${name} with id ${nextId}.`);
  }

  function updateSelectedRegionName() {
    const region = currentRegion();
    if (!region) {
      return;
    }

    const nextName = elements.selectedRegionNameInput.value.trim();
    if (nextName === "") {
      return;
    }
    if (state.regions.some((candidate) => candidate.id !== region.id && candidate.name === nextName)) {
      setStatus(`Region name already exists: ${nextName}`, "warn");
      return;
    }

    region.name = nextName;
    renderSidebar();
  }

  function updateSelectedRegionColor() {
    const region = currentRegion();
    if (!region) {
      return;
    }

    region.color = normalizeHexColor(elements.selectedRegionColorInput.value);
    markRasterDirty();
    renderSidebar();
    renderCanvas();
  }

  function deleteRegion(regionId) {
    if (regionId === 0) {
      setStatus("Region id 0 is the default background and cannot be deleted.", "warn");
      return;
    }

    const region = state.regions.find((item) => item.id === regionId);
    if (!region) {
      return;
    }

    const polygonCount = state.polygons.filter((polygon) => polygon.regionId === regionId).length;
    const confirmed = window.confirm(
      `Delete region ${region.name} and ${polygonCount} polygon(s) assigned to it?`
    );
    if (!confirmed) {
      return;
    }

    state.regions = state.regions.filter((item) => item.id !== regionId);
    state.polygons = state.polygons.filter((polygon) => polygon.regionId !== regionId);
    state.fillPatches = state.fillPatches.filter((patch) => patch.regionId !== regionId);
    state.activeRegionId = 0;
    state.selectedOperation = null;
    markRasterDirty();
    renderSidebar();
    renderCanvas();
  }

  function deletePolygon(polygonId) {
    state.polygons = state.polygons.filter((polygon) => polygon.id !== polygonId);
    if (isSelectedOperation("polygon", polygonId)) {
      state.selectedOperation = null;
    }
    markRasterDirty();
    renderSidebar();
    renderCanvas();
  }

  function deleteFillPatch(patchId) {
    state.fillPatches = state.fillPatches.filter((patch) => patch.id !== patchId);
    if (isSelectedOperation("fill", patchId)) {
      state.selectedOperation = null;
    }
    markRasterDirty();
    renderSidebar();
    renderCanvas();
  }

  function exportJson() {
    if (!hasCanvasGeometry()) {
      setStatus("Map size is not available; cannot export region JSON.", "warn");
      return;
    }

    const payload = buildRegionJsonPayload();
    const filename = `${safeMapName()}.region.json`;
    downloadText(filename, `${JSON.stringify(payload, null, 2)}\n`);
    setStatus(`Downloaded ${filename}.`);
  }

  function exportPng() {
    if (!hasCanvasGeometry()) {
      setStatus("Map size is not available; cannot export region PNG.", "warn");
      return;
    }

    rebuildRasterIfNeeded();
    const filename = `${safeMapName()}.region.png`;
    downloadCanvas(filename, state.maskCanvas);
    setStatus(`Downloaded ${filename}.`);
  }

  function exportLua() {
    if (!hasCanvasGeometry()) {
      setStatus("Map size is not available; cannot export Lua.", "warn");
      return;
    }

    rebuildRasterIfNeeded();
    const filename = `${safeMapName()}.lua`;
    downloadText(filename, buildLuaModule());
    setStatus(`Downloaded ${filename}.`);
  }

  function buildRegionJsonPayload() {
    return {
      version: 1,
      map: {
        name: safeMapName(),
        image: state.mapImageName || `${safeMapName()}.png`,
        width: state.width,
        height: state.height,
        resolution: state.resolution,
        origin: {
          x: state.originX,
          y: state.originY,
        },
        protected_black_runs: protectedBlackRuns(),
      },
      regions: state.regions
        .slice()
        .sort((left, right) => left.id - right.id)
        .map((region) => ({
          id: region.id,
          name: region.name,
          color: region.color,
        })),
      polygons: state.polygons.map((polygon) => ({
        id: polygon.id,
        region_id: polygon.regionId,
        order: polygon.order,
        points: polygon.points.map((point) => [point.x, point.y]),
      })),
      fills: state.fillPatches.map((patch) => ({
        id: patch.id,
        region_id: patch.regionId,
        order: patch.order,
        runs: patch.runs.map((run) => [run.y, run.x1, run.x2]),
      })),
    };
  }

  function buildLuaModule() {
    rebuildRasterIfNeeded();
    const lines = [];
    lines.push("-- Generated by tools/region-editor");
    lines.push("return {");
    lines.push(`  width = ${state.width},`);
    lines.push(`  height = ${state.height},`);
    lines.push(`  resolution = ${formatNumber(state.resolution)},`);
    lines.push("  origin = {");
    lines.push(`    x = ${formatNumber(state.originX)},`);
    lines.push(`    y = ${formatNumber(state.originY)},`);
    lines.push("  },");
    lines.push("  names = {");
    state.regions
      .slice()
      .sort((left, right) => left.id - right.id)
      .forEach((region) => {
        lines.push(`    [${region.id}] = ${quoteLuaString(region.name)},`);
      });
    lines.push("  },");
    lines.push("  rows = {");
    for (const row of state.rasterRows) {
      lines.push(`    { ${row.join(", ")} },`);
    }
    lines.push("  },");
    lines.push("}");
    lines.push("");
    return lines.join("\n");
  }

  function rebuildRasterIfNeeded() {
    if (!state.rasterDirty) {
      return;
    }

    if (!hasCanvasGeometry()) {
      return;
    }

    const rows = new Array(state.height);
    for (let y = 0; y < state.height; y += 1) {
      rows[y] = new Array(state.width);
      for (let x = 0; x < state.width; x += 1) {
        rows[y][x] = 0;
      }
    }

    const operations = [
      ...state.polygons.map((polygon) => ({ type: "polygon", order: polygon.order, value: polygon })),
      ...state.fillPatches.map((patch) => ({ type: "fill", order: patch.order, value: patch })),
    ].sort((left, right) => left.order - right.order);

    for (const operation of operations) {
      if (operation.type === "polygon") {
        applyPolygonToRows(rows, operation.value);
      } else {
        applyFillPatchToRows(rows, operation.value);
      }
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = state.width;
    maskCanvas.height = state.height;
    const maskContext = maskCanvas.getContext("2d");
    const imageData = maskContext.createImageData(state.width, state.height);
    const regionColors = new Map(state.regions.map((region) => [region.id, hexToRgb(region.color)]));

    let offset = 0;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const rgb = regionColors.get(rows[y][x]) || hexToRgb(DEFAULT_REGION.color);
        imageData.data[offset + 0] = rgb.r;
        imageData.data[offset + 1] = rgb.g;
        imageData.data[offset + 2] = rgb.b;
        imageData.data[offset + 3] = 255;
        offset += 4;
      }
    }
    maskContext.putImageData(imageData, 0, 0);

    state.rasterRows = rows;
    state.maskCanvas = maskCanvas;
    state.rasterDirty = false;
  }

  function applyPolygonToRows(rows, polygon) {
    const bbox = polygonBounds(polygon.points, state.width, state.height);
    for (let y = bbox.minY; y <= bbox.maxY; y += 1) {
      const sampleY = y + 0.5;
      for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
        const sampleX = x + 0.5;
        if (pointInPolygon(sampleX, sampleY, polygon.points)) {
          rows[y][x] = polygon.regionId;
        }
      }
    }
  }

  function applyFillPatchToRows(rows, patch) {
    for (const run of patch.runs) {
      for (let x = run.x1; x <= run.x2; x += 1) {
        if (!isBaseBlackPixel(x, run.y)) {
          rows[run.y][x] = patch.regionId;
        }
      }
    }
  }

  function renderSidebar() {
    syncInputsFromState();
    renderToolMode();
    renderRegionList();
    renderPolygonList();
    elements.pendingPointsLabel.textContent = String(state.drawingPoints.length);
    elements.zoomLabel.textContent = `${state.zoom}x`;
    elements.overlayLabel.textContent = `${Math.round(state.overlayOpacity * 100)}%`;
    elements.pointerLabel.textContent = formatPointerLabel();
  }

  function renderToolMode() {
    elements.polygonToolButton.classList.toggle("active", state.toolMode === ToolMode.polygon);
    elements.fillToolButton.classList.toggle("active", state.toolMode === ToolMode.fill);
  }

  function renderRegionList() {
    elements.regionList.innerHTML = "";
    state.regions
      .slice()
      .sort((left, right) => left.id - right.id)
      .forEach((region) => {
        const item = document.createElement("div");
        item.className = `list-item${region.id === state.activeRegionId ? " active" : ""}`;

        const topRow = document.createElement("div");
        topRow.className = "row";
        const swatch = document.createElement("div");
        swatch.className = "swatch";
        swatch.style.backgroundColor = region.color;
        const label = document.createElement("strong");
        label.textContent = `${region.name} (#${region.id})`;
        topRow.appendChild(swatch);
        topRow.appendChild(label);

        const buttonRow = document.createElement("div");
        buttonRow.className = "row space-between";
        const useButton = document.createElement("button");
        useButton.type = "button";
        useButton.textContent = region.id === state.activeRegionId ? "Active" : "Use";
        useButton.addEventListener("click", () => {
          state.activeRegionId = region.id;
          state.selectedOperation = null;
          renderSidebar();
          renderCanvas();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.className = "danger";
        deleteButton.disabled = region.id === 0;
        deleteButton.addEventListener("click", () => deleteRegion(region.id));

        buttonRow.appendChild(useButton);
        buttonRow.appendChild(deleteButton);

        item.appendChild(topRow);
        item.appendChild(buttonRow);
        elements.regionList.appendChild(item);
      });

    const activeRegion = currentRegion();
    if (activeRegion) {
      elements.selectedRegionLabel.textContent = `${activeRegion.name} (#${activeRegion.id})`;
      elements.selectedRegionNameInput.value = activeRegion.name;
      elements.selectedRegionColorInput.value = activeRegion.color;
    } else {
      elements.selectedRegionLabel.textContent = "none";
      elements.selectedRegionNameInput.value = "";
      elements.selectedRegionColorInput.value = DEFAULT_REGION.color;
    }
  }

  function renderPolygonList() {
    elements.polygonList.innerHTML = "";

    const operations = currentRegionOperations();
    if (operations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "readonly";
      empty.textContent = "No operations for the active region.";
      elements.polygonList.appendChild(empty);
      return;
    }

    operations.forEach((operation, index) => {
      const item = document.createElement("div");
      item.className = `list-item${isSelectedOperation(operation.type, operation.value.id) ? " active" : ""}`;
      const region = regionById(operation.value.regionId) || DEFAULT_REGION;

      const labelRow = document.createElement("div");
      labelRow.className = "row";
      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.backgroundColor = region.color;
      const label = document.createElement("strong");
      label.textContent = `${operation.type === "polygon" ? "框选" : "填充"} ${index + 1}: ${region.name}`;
      labelRow.appendChild(swatch);
      labelRow.appendChild(label);

      const meta = document.createElement("div");
      meta.className = "readonly";
      if (operation.type === "polygon") {
        meta.textContent = `${operation.value.points.length} vertices`;
      } else {
        meta.textContent = `${operation.value.runs.length} spans`;
      }

      const buttonRow = document.createElement("div");
      buttonRow.className = "row space-between";
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = isSelectedOperation(operation.type, operation.value.id) ? "Selected" : "Select";
      selectButton.addEventListener("click", () => {
        state.selectedOperation = { type: operation.type, id: operation.value.id };
        renderSidebar();
        renderCanvas();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.className = "danger";
      deleteButton.addEventListener("click", () => {
        if (operation.type === "polygon") {
          deletePolygon(operation.value.id);
        } else {
          deleteFillPatch(operation.value.id);
        }
      });

      buttonRow.appendChild(selectButton);
      buttonRow.appendChild(deleteButton);

      item.appendChild(labelRow);
      item.appendChild(meta);
      item.appendChild(buttonRow);
      elements.polygonList.appendChild(item);
    });
  }

  function currentRegionOperations() {
    return [
      ...state.polygons
        .filter((polygon) => polygon.regionId === state.activeRegionId)
        .map((polygon) => ({ type: "polygon", order: polygon.order, value: polygon })),
      ...state.fillPatches
        .filter((patch) => patch.regionId === state.activeRegionId)
        .map((patch) => ({ type: "fill", order: patch.order, value: patch })),
    ].sort((left, right) => left.order - right.order);
  }

  function isSelectedOperation(type, id) {
    return state.selectedOperation !== null && state.selectedOperation.type === type && state.selectedOperation.id === id;
  }

  function renderCanvas() {
    const width = Math.max(1, Math.round(state.width * state.zoom));
    const height = Math.max(1, Math.round(state.height * state.zoom));
    elements.canvas.width = width;
    elements.canvas.height = height;

    canvasContext.clearRect(0, 0, width, height);
    canvasContext.imageSmoothingEnabled = false;

    if (state.baseImage) {
      canvasContext.drawImage(state.baseImage, 0, 0, width, height);
    } else {
      canvasContext.fillStyle = "#ffffff";
      canvasContext.fillRect(0, 0, width, height);
    }

    if (hasCanvasGeometry()) {
      rebuildRasterIfNeeded();
      if (state.maskCanvas) {
        canvasContext.save();
        canvasContext.globalAlpha = state.overlayOpacity;
        canvasContext.drawImage(state.maskCanvas, 0, 0, width, height);
        canvasContext.restore();
      }
      drawPolygonOutlines();
      drawPendingPolygon();
    } else {
      drawCanvasPlaceholder(width, height);
    }
  }

  function drawCanvasPlaceholder(width, height) {
    canvasContext.fillStyle = "#475569";
    canvasContext.font = "14px Arial";
    canvasContext.fillText("Load a map PNG to start editing.", 16, Math.max(24, height / 2));
  }

  function drawPolygonOutlines() {
    state.polygons.forEach((polygon) => {
      const region = regionById(polygon.regionId) || DEFAULT_REGION;
      canvasContext.strokeStyle = region.color;
      canvasContext.lineWidth = isSelectedOperation("polygon", polygon.id) ? 3 : 1;
      canvasContext.beginPath();
      polygon.points.forEach((point, index) => {
        const x = point.x * state.zoom + state.zoom / 2;
        const y = point.y * state.zoom + state.zoom / 2;
        if (index === 0) {
          canvasContext.moveTo(x, y);
        } else {
          canvasContext.lineTo(x, y);
        }
      });
      canvasContext.closePath();
      canvasContext.stroke();
    });

    if (state.selectedOperation && state.selectedOperation.type === "fill") {
      const patch = state.fillPatches.find((candidate) => candidate.id === state.selectedOperation.id);
      if (patch) {
        const region = regionById(patch.regionId) || DEFAULT_REGION;
        canvasContext.strokeStyle = region.color;
        canvasContext.lineWidth = 2;
        for (const run of patch.runs) {
          canvasContext.strokeRect(
            run.x1 * state.zoom,
            run.y * state.zoom,
            (run.x2 - run.x1 + 1) * state.zoom,
            state.zoom
          );
        }
      }
    }
  }

  function drawPendingPolygon() {
    if (state.drawingPoints.length === 0) {
      return;
    }

    const region = currentRegion() || DEFAULT_REGION;
    canvasContext.strokeStyle = region.color;
    canvasContext.fillStyle = region.color;
    canvasContext.lineWidth = 2;
    canvasContext.beginPath();
    state.drawingPoints.forEach((point, index) => {
      const x = point.x * state.zoom + state.zoom / 2;
      const y = point.y * state.zoom + state.zoom / 2;
      if (index === 0) {
        canvasContext.moveTo(x, y);
      } else {
        canvasContext.lineTo(x, y);
      }
      canvasContext.fillRect(x - 2, y - 2, 4, 4);
    });
    if (state.hoverPixel) {
      canvasContext.lineTo(
        state.hoverPixel.x * state.zoom + state.zoom / 2,
        state.hoverPixel.y * state.zoom + state.zoom / 2
      );
    }
    canvasContext.stroke();
  }

  function drawDownloadLink(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function downloadText(filename, text) {
    drawDownloadLink(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
  }

  function downloadCanvas(filename, canvas) {
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("Failed to serialize canvas.", "error");
        return;
      }
      drawDownloadLink(blob, filename);
    }, "image/png");
  }

  function setToolMode(mode) {
    if (state.toolMode === mode) {
      return;
    }
    if (state.drawingPoints.length > 0) {
      state.drawingPoints = [];
      setStatus("Discarded pending polygon.");
    }
    state.toolMode = mode;
    renderSidebar();
    renderCanvas();
  }

  function fillRegionAt(startX, startY) {
    if (isBaseBlackPixel(startX, startY)) {
      setStatus("Fill skipped: black map pixels are protected.", "warn");
      return;
    }

    rebuildRasterIfNeeded();

    const targetRegionId = state.rasterRows[startY][startX];
    const replacementRegionId = state.activeRegionId;
    if (targetRegionId === replacementRegionId) {
      return;
    }

    const visited = new Uint8Array(state.width * state.height);
    const filledPixels = [];
    const queue = [{ x: startX, y: startY }];
    visited[startY * state.width + startX] = 1;

    while (queue.length > 0) {
      const point = queue.pop();
      filledPixels.push(point);
      const neighbors = [
        { x: point.x + 1, y: point.y },
        { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 },
        { x: point.x, y: point.y - 1 },
      ];

      for (const neighbor of neighbors) {
        if (
          neighbor.x < 0 ||
          neighbor.y < 0 ||
          neighbor.x >= state.width ||
          neighbor.y >= state.height
        ) {
          continue;
        }

        const index = neighbor.y * state.width + neighbor.x;
        if (
          visited[index] === 1 ||
          isBaseBlackPixel(neighbor.x, neighbor.y) ||
          state.rasterRows[neighbor.y][neighbor.x] !== targetRegionId
        ) {
          continue;
        }

        visited[index] = 1;
        queue.push(neighbor);
      }
    }

    const runs = pixelsToRuns(filledPixels);
    if (runs.length === 0) {
      return;
    }

    state.fillPatches.push({
      id: state.nextFillPatchId++,
      regionId: replacementRegionId,
      order: state.nextOperationOrder++,
      runs,
    });

    markRasterDirty();
    setStatus(`Filled region with ${currentRegion().name}.`);
    renderSidebar();
    renderCanvas();
  }

  function pixelsToRuns(pixels) {
    const byRow = new Map();
    for (const pixel of pixels) {
      if (!byRow.has(pixel.y)) {
        byRow.set(pixel.y, []);
      }
      byRow.get(pixel.y).push(pixel.x);
    }

    const runs = [];
    for (const y of Array.from(byRow.keys()).sort((left, right) => left - right)) {
      const xs = byRow.get(y).sort((left, right) => left - right);
      let x1 = xs[0];
      let x2 = xs[0];
      for (let index = 1; index < xs.length; index += 1) {
        const x = xs[index];
        if (x === x2 + 1) {
          x2 = x;
          continue;
        }
        runs.push({ y, x1, x2 });
        x1 = x;
        x2 = x;
      }
      runs.push({ y, x1, x2 });
    }
    return runs;
  }

  function protectedBlackRuns() {
    if (!state.baseBlackPixels || state.baseBlackPixels.length !== state.width * state.height) {
      return [];
    }

    const runs = [];
    for (let y = 0; y < state.height; y += 1) {
      let x = 0;
      while (x < state.width) {
        while (x < state.width && !isBaseBlackPixel(x, y)) {
          x += 1;
        }
        if (x >= state.width) {
          break;
        }
        const x1 = x;
        while (x < state.width && isBaseBlackPixel(x, y)) {
          x += 1;
        }
        runs.push([y, x1, x - 1]);
      }
    }
    return runs;
  }

  function collectBaseBlackPixels(image, width, height) {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d");
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.drawImage(image, 0, 0, width, height);

    const imageData = sourceContext.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = imageData.data[offset + 0];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const alpha = imageData.data[offset + 3];
      if (
        alpha > 0 &&
        red <= BLACK_PIXEL_THRESHOLD &&
        green <= BLACK_PIXEL_THRESHOLD &&
        blue <= BLACK_PIXEL_THRESHOLD
      ) {
        pixels[index] = 1;
      }
    }
    return pixels;
  }

  function isBaseBlackPixel(x, y) {
    if (!state.baseBlackPixels || state.baseBlackPixels.length !== state.width * state.height) {
      return false;
    }
    return state.baseBlackPixels[y * state.width + x] === 1;
  }

  function eventToPixel(event) {
    if (!hasCanvasGeometry()) {
      return null;
    }
    const rect = elements.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const x = clamp(Math.floor(canvasX / state.zoom), 0, state.width - 1);
    const y = clamp(Math.floor(canvasY / state.zoom), 0, state.height - 1);
    return { x, y };
  }

  function pointInPolygon(sampleX, sampleY, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
      const intersects =
        (yi > sampleY) !== (yj > sampleY) &&
        sampleX < ((xj - xi) * (sampleY - yi)) / ((yj - yi) || Number.EPSILON) + xi;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  function polygonBounds(points, width, height) {
    let minX = width - 1;
    let minY = height - 1;
    let maxX = 0;
    let maxY = 0;
    points.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
    return {
      minX: clamp(Math.floor(minX), 0, width - 1),
      minY: clamp(Math.floor(minY), 0, height - 1),
      maxX: clamp(Math.ceil(maxX), 0, width - 1),
      maxY: clamp(Math.ceil(maxY), 0, height - 1),
    };
  }

  function parseMapYaml(text) {
    const resolutionMatch = text.match(/^\s*resolution\s*:\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$/m);
    const originMatch = text.match(
      /^\s*origin\s*:\s*\[\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\]\s*$/m
    );
    if (!resolutionMatch) {
      throw new Error("missing resolution");
    }
    if (!originMatch) {
      throw new Error("missing origin");
    }
    return {
      resolution: Number(resolutionMatch[1]),
      originX: Number(originMatch[1]),
      originY: Number(originMatch[2]),
    };
  }

  async function loadImageFromFile(file) {
    const dataUrl = await readFileAsDataUrl(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = dataUrl;
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("file read failed"));
      reader.readAsDataURL(file);
    });
  }

  function syncInputsFromState() {
    elements.mapNameInput.value = state.mapName;
    elements.resolutionInput.value = String(state.resolution);
    elements.originXInput.value = String(state.originX);
    elements.originYInput.value = String(state.originY);
    elements.mapSizeLabel.textContent = hasCanvasGeometry() ? `${state.width} x ${state.height}` : "not loaded";
    elements.zoomRange.value = String(state.zoom);
    elements.overlayRange.value = String(Math.round(state.overlayOpacity * 100));
  }

  function formatPointerLabel() {
    if (!state.hoverPixel) {
      return "-";
    }
    const x = state.hoverPixel.x;
    const y = state.hoverPixel.y;
    const worldX = state.originX + (x + 0.5) * state.resolution;
    const worldY = state.originY + (state.height - y - 0.5) * state.resolution;
    return `pixel (${x}, ${y}), world (${formatNumber(worldX)}, ${formatNumber(worldY)})`;
  }

  function currentRegion() {
    return regionById(state.activeRegionId);
  }

  function regionById(regionId) {
    return state.regions.find((region) => region.id === regionId) || null;
  }

  function safeMapName() {
    return state.mapName && state.mapName.trim() !== "" ? state.mapName.trim() : "region_map";
  }

  function hasCanvasGeometry() {
    return Number.isInteger(state.width) && state.width > 0 && Number.isInteger(state.height) && state.height > 0;
  }

  function nextRegionId(regions) {
    return regions.reduce((maxId, region) => Math.max(maxId, region.id), 0) + 1;
  }

  function nextPolygonId(polygons) {
    return polygons.reduce((maxId, polygon) => Math.max(maxId, polygon.id), 0) + 1;
  }

  function nextFillPatchId(patches) {
    return patches.reduce((maxId, patch) => Math.max(maxId, patch.id), 0) + 1;
  }

  function nextOperationOrder(polygons, patches) {
    const polygonMax = polygons.reduce((maxOrder, polygon) => Math.max(maxOrder, polygon.order || 0), 0);
    const patchMax = patches.reduce((maxOrder, patch) => Math.max(maxOrder, patch.order || 0), 0);
    return Math.max(polygonMax, patchMax) + 1;
  }

  function setStatus(message, level) {
    elements.status.textContent = message;
    elements.status.className = "status";
    if (level) {
      elements.status.classList.add(level);
    }
  }

  function markRasterDirty() {
    state.rasterDirty = true;
    state.rasterRows = null;
    state.maskCanvas = null;
  }

  function normalizeHexColor(value) {
    const candidate = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(candidate)) {
      return candidate;
    }
    if (/^#[0-9a-f]{3}$/.test(candidate)) {
      return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`;
    }
    return DEFAULT_REGION.color;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
    };
  }

  function formatNumber(value) {
    return Number(value).toFixed(4).replace(/\.?0+$/, "");
  }

  function quoteLuaString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function cloneRegion(region) {
    return {
      id: region.id,
      name: region.name,
      color: region.color,
    };
  }

  function stripExtension(filename) {
    return String(filename).replace(/\.[^.]+$/, "");
  }

  function toNumber(raw, fallback) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
