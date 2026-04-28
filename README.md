# Region Editor

1. 用浏览器打开 `/home/tcd/code/tools/region-editor/index.html`。
2. 加载 `maps/<map>.png`。
3. 可选加载 `maps/<map>.yaml`，只读取 `resolution` 和 `origin`。
4. 手动添加 `region`，选择颜色。
5. 用 `框选` 画多边形，或用 `填充` flood-fill 连通区域。
6. 导出：
   - `<map>.region.json`：可继续编辑的源数据
   - `<map>.region.png`：区域颜色掩码
   - `<map>.lua`：运行时 Lua 查表
