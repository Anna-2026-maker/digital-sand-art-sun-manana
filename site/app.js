(function () {
  "use strict";

  const sandApp = document.getElementById("sandApp");
  const canvas = document.getElementById("sandCanvas");
  const guideCanvas = document.getElementById("guideCanvas");
  const canvasViewport = document.getElementById("canvasViewport");
  const stage = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { alpha: false });
  const buffer = document.createElement("canvas");
  const bctx = buffer.getContext("2d");

  const statusNode = document.getElementById("status");
  const welcomeNode = document.getElementById("welcome");
  const brushInput = document.getElementById("brushSizeInput");
  const brushOutput = document.getElementById("brushSizeOutput");
  const pauseButton = document.getElementById("pauseButton");
  const undoButton = document.getElementById("undoButton");
  const redoButton = document.getElementById("redoButton");
  const clearButton = document.getElementById("clearButton");
  const canvasLockButton = document.getElementById("canvasLockButton");
  const generateButton = document.getElementById("generateButton");
  const sandImageInput = document.getElementById("sandImageInput");
  const guideButton = document.getElementById("guideButton");
  const guideImageInput = document.getElementById("guideImageInput");
  const guideButtonHint = document.getElementById("guideButtonHint");
  const guideControls = document.getElementById("guideControls");
  const guideToggleButton = document.getElementById("guideToggleButton");
  const guideAdjustButton = document.getElementById("guideAdjustButton");
  const guideFrame = document.getElementById("guideFrame");
  const guideAdjustPanel = document.getElementById("guideAdjustPanel");
  const guideConfirmButton = document.getElementById("guideConfirmButton");
  const toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
  const drawerToggleButton = document.getElementById("drawerToggleButton");
  const toolDock = document.getElementById("toolDock");
  const drawerScrim = document.getElementById("drawerScrim");
  const saveImageButton = document.getElementById("saveImageButton");
  const postNoteButton = document.getElementById("postNoteButton");
  const saveProjectButton = document.getElementById("saveProjectButton");
  const saveNewProjectButton = document.getElementById("saveNewProjectButton");
  const projectGallery = document.getElementById("projectGallery");
  const projectStatus = document.getElementById("projectStatus");
  const landscapeButton = document.getElementById("landscapeButton");
  const windQuickButton = document.getElementById("windQuickButton");

  const state = {
    tool: "sand",
    size: 48,
    started: false,
    paused: false,
    width: 1,
    height: 1,
    cols: 1,
    rows: 1,
    field: new Float32Array(1),
    noise: new Float32Array(1),
    image: null,
    activePointers: new Map(),
    viewLocked: true,
    viewScale: 1,
    viewX: 0,
    viewY: 0,
    viewPointers: new Map(),
    viewGesture: null,
    toolHandleDrag: null,
    drawerSwipe: null,
    drawerSwipeSuppressClick: false,
    lastFrameAt: performance.now(),
    history: [],
    future: [],
    guideReady: false,
    guideVisible: true,
    guideAdjusting: false,
    guideX: 0,
    guideY: 0,
    guideScale: 1,
    guideRotation: 0,
    guidePointers: new Map(),
    guideGesture: null,
    currentProjectId: null,
    forcedLandscape: false,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function markStarted() {
    if (!state.started) {
      state.started = true;
      welcomeNode.classList.add("hidden");
    }
  }

  function openDrawer() {
    toolDock.classList.remove("swiping");
    toolDock.style.transform = "";
    stage.classList.add("drawer-open");
    drawerToggleButton.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    stage.classList.remove("drawer-open");
    drawerToggleButton.setAttribute("aria-expanded", "false");
    toolDock.classList.remove("swiping");
    toolDock.style.transform = "";
  }

  function isLandscapeViewport() {
    return state.viewportWidth > state.viewportHeight;
  }

  function updateViewportMetrics() {
    const visual = window.visualViewport;
    const width = Math.max(1, Math.round(visual && visual.width ? visual.width : window.innerWidth));
    const height = Math.max(1, Math.round(visual && visual.height ? visual.height : window.innerHeight));
    state.viewportWidth = width;
    state.viewportHeight = height;
    document.documentElement.style.setProperty("--app-vw", width + "px");
    document.documentElement.style.setProperty("--app-vh", height + "px");
  }

  function stageInteractionPoint(clientX, clientY) {
    if (state.forcedLandscape) {
      return { x: clientY, y: state.viewportWidth - clientX };
    }
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function syncLandscapeMode() {
    updateViewportMetrics();
    const actualLandscape = isLandscapeViewport();
    if (actualLandscape) state.forcedLandscape = false;
    const active = actualLandscape || state.forcedLandscape;
    sandApp.classList.toggle("landscape-active", active);
    sandApp.classList.toggle("forced-landscape", state.forcedLandscape);
    document.body.classList.toggle("forced-landscape-mode", state.forcedLandscape);
    landscapeButton.classList.toggle("active", active);
    landscapeButton.querySelector("b").textContent = state.forcedLandscape ? "竖版" : "横版";
    landscapeButton.querySelector("small").textContent = state.forcedLandscape ? "点击返回竖版" : (actualLandscape ? "当前为横版" : "旋转手机使用横版");
  }

  function requestLandscapeMode() {
    closeDrawer();
    updateViewportMetrics();
    if (isLandscapeViewport()) {
      setStatus("当前正在使用横版画台");
      return;
    }
    state.forcedLandscape = !state.forcedLandscape;
    syncLandscapeMode();
    setStatus(state.forcedLandscape ? "横版画台已开启 · 请将手机向左旋转使用" : "已返回竖版画台");
    window.requestAnimationFrame(scheduleCanvasSetup);
  }

  const PROJECT_STORAGE_KEY = "manana-sunset-sand-art-projects-v2";
  const LEGACY_PROJECT_STORAGE_KEY = "manana-sunset-sand-art-project-v1";
  const PROJECT_SCHEMA_VERSION = 2;
  const MAX_SAVED_PROJECTS = 8;
  const FIELD_MAX_VALUE = 1.45;
  const SAND_PIXEL_SIZE = 1.5;
  const MAX_RENDER_CELLS = 320000;

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 8192;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function isValidProject(project) {
    return Boolean(project && typeof project.id === "string" && typeof project.data === "string" &&
      Number.isInteger(project.cols) && Number.isInteger(project.rows) && project.cols > 0 && project.rows > 0);
  }

  function writeStoredProjects(projects) {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ schema: PROJECT_SCHEMA_VERSION, projects: projects }));
  }

  function readStoredProjects() {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (raw) {
        const library = JSON.parse(raw);
        if (library && library.schema === PROJECT_SCHEMA_VERSION && Array.isArray(library.projects)) {
          return library.projects.filter(isValidProject).slice(0, MAX_SAVED_PROJECTS);
        }
      }
      const legacyRaw = localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY);
      if (!legacyRaw) return [];
      const legacy = JSON.parse(legacyRaw);
      if (!legacy || typeof legacy.data !== "string" || !Number.isInteger(legacy.cols) || !Number.isInteger(legacy.rows)) return [];
      const migrated = Object.assign({}, legacy, {
        id: "legacy-" + String(legacy.savedAt || Date.now()),
        thumbnail: "",
        schema: PROJECT_SCHEMA_VERSION
      });
      writeStoredProjects([migrated]);
      return [migrated];
    } catch (error) {
      return [];
    }
  }

  function projectTimeLabel(savedAt) {
    const date = new Date(savedAt);
    if (!Number.isFinite(date.getTime())) return "已有工程";
    const pad = function (value) { return String(value).padStart(2, "0"); };
    return pad(date.getMonth() + 1) + "/" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function createProjectThumbnail() {
    const preview = document.createElement("canvas");
    preview.width = 144;
    preview.height = 96;
    const previewContext = preview.getContext("2d");
    previewContext.fillStyle = "#ffe08a";
    previewContext.fillRect(0, 0, preview.width, preview.height);
    previewContext.drawImage(canvas, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/jpeg", 0.62);
  }

  function encodeProjectField() {
    const maxStoredPixels = 240000;
    const maxStoredEdge = 720;
    const scale = Math.min(1, Math.sqrt(maxStoredPixels / state.field.length), maxStoredEdge / state.cols, maxStoredEdge / state.rows);
    const cols = Math.max(1, Math.round(state.cols * scale));
    const rows = Math.max(1, Math.round(state.rows * scale));
    const bytes = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y += 1) {
      const sourceY = Math.min(state.rows - 1, Math.floor((y + 0.5) / rows * state.rows));
      for (let x = 0; x < cols; x += 1) {
        const sourceX = Math.min(state.cols - 1, Math.floor((x + 0.5) / cols * state.cols));
        const value = state.field[sourceY * state.cols + sourceX];
        bytes[y * cols + x] = Math.round(Math.max(0, Math.min(1, value / FIELD_MAX_VALUE)) * 255);
      }
    }
    return { cols: cols, rows: rows, data: bytesToBase64(bytes) };
  }

  function renderProjectGallery(projects) {
    projectGallery.textContent = "";
    if (projects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "project-empty";
      empty.textContent = "还没有保存的工程";
      projectGallery.appendChild(empty);
      return;
    }
    projects.forEach(function (project, index) {
      const item = document.createElement("article");
      item.className = "project-card" + (project.id === state.currentProjectId ? " current" : "");
      const openButton = document.createElement("button");
      openButton.className = "project-open";
      openButton.type = "button";
      openButton.setAttribute("aria-label", "继续编辑工程 " + projectTimeLabel(project.savedAt));
      if (project.thumbnail) {
        const image = document.createElement("img");
        image.src = project.thumbnail;
        image.alt = "沙画工程缩略图";
        openButton.appendChild(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "project-placeholder";
        placeholder.textContent = "沙画";
        openButton.appendChild(placeholder);
      }
      const meta = document.createElement("span");
      meta.className = "project-meta";
      const name = document.createElement("b");
      name.textContent = "沙画工程 " + String(projects.length - index);
      const time = document.createElement("small");
      time.textContent = projectTimeLabel(project.savedAt);
      meta.appendChild(name);
      meta.appendChild(time);
      openButton.appendChild(meta);
      openButton.addEventListener("click", function () { loadProject(project.id); });

      const removeButton = document.createElement("button");
      removeButton.className = "project-delete";
      removeButton.type = "button";
      removeButton.setAttribute("aria-label", "删除这个工程");
      removeButton.textContent = "×";
      removeButton.addEventListener("click", function () { deleteProject(project.id); });
      item.appendChild(openButton);
      item.appendChild(removeButton);
      projectGallery.appendChild(item);
    });
  }

  function syncProjectUi(projects) {
    const stored = projects || readStoredProjects();
    projectStatus.textContent = stored.length + " 个工程";
    renderProjectGallery(stored);
  }

  function saveProject(announce, saveAsNew) {
    try {
      const projects = readStoredProjects();
      const existingIndex = projects.findIndex(function (item) { return item.id === state.currentProjectId; });
      const createNew = saveAsNew === true || existingIndex < 0;
      if (createNew && projects.length >= MAX_SAVED_PROJECTS) {
        if (announce !== false) setStatus("最多保存 8 个本机工程 · 请先删除一个旧工程");
        return false;
      }
      const encodedField = encodeProjectField();
      const projectId = createNew ? "sand-" + Date.now() + "-" + Math.floor(Math.random() * 100000) : state.currentProjectId;
      const project = {
        schema: PROJECT_SCHEMA_VERSION,
        id: projectId,
        savedAt: Date.now(),
        cols: encodedField.cols,
        rows: encodedField.rows,
        started: state.started,
        tool: state.tool,
        brushSize: state.size,
        thumbnail: createProjectThumbnail(),
        data: encodedField.data
      };
      const nextProjects = projects.filter(function (item) { return item.id !== projectId; });
      nextProjects.unshift(project);
      writeStoredProjects(nextProjects);
      state.currentProjectId = projectId;
      syncProjectUi(nextProjects);
      if (announce !== false) setStatus(createNew ? "新工程已保存 · 可从缩略图继续创作" : "当前工程已更新");
      return true;
    } catch (error) {
      if (announce !== false) setStatus("工程保存失败 · 当前设备缓存空间可能不足");
      return false;
    }
  }

  function loadProject(projectId) {
    try {
      const projects = readStoredProjects();
      const project = projects.find(function (item) { return item.id === projectId; });
      if (!project) throw new Error("未找到工程");
      const bytes = base64ToBytes(project.data);
      if (bytes.length !== project.cols * project.rows) throw new Error("工程数据不完整");
      for (let y = 0; y < state.rows; y += 1) {
        const sourceY = Math.min(project.rows - 1, Math.floor(y / state.rows * project.rows));
        for (let x = 0; x < state.cols; x += 1) {
          const sourceX = Math.min(project.cols - 1, Math.floor(x / state.cols * project.cols));
          state.field[y * state.cols + x] = bytes[sourceY * project.cols + sourceX] / 255 * FIELD_MAX_VALUE;
        }
      }
      state.size = Math.max(8, Math.min(200, Number(project.brushSize) || 48));
      brushInput.value = String(state.size);
      brushOutput.textContent = String(state.size);
      state.started = Boolean(project.started) || bytes.some(function (value) { return value > 0; });
      welcomeNode.classList.toggle("hidden", state.started);
      state.history.length = 0;
      state.future.length = 0;
      state.viewScale = 1;
      state.viewX = 0;
      state.viewY = 0;
      updateCanvasView();
      if (project.tool === "sand" || project.tool === "shape" || project.tool === "light") setTool(project.tool);
      state.currentProjectId = project.id;
      syncProjectUi(projects);
      closeDrawer();
      setStatus("工程已恢复 · 可以继续创作");
    } catch (error) {
      setStatus("工程读取失败 · 保存数据可能已被系统清理");
      syncProjectUi();
    }
  }

  function deleteProject(projectId) {
    if (!confirm("删除这个本机沙画工程？此操作无法撤回。")) return;
    try {
      const projects = readStoredProjects().filter(function (item) { return item.id !== projectId; });
      writeStoredProjects(projects);
      if (state.currentProjectId === projectId) state.currentProjectId = null;
      syncProjectUi(projects);
      setStatus("工程已删除 · 当前画面不会被清空");
    } catch (error) {
      setStatus("工程删除失败，请稍后重试");
    }
  }

  const MIN_VIEW_SCALE = 0.4;
  const MAX_VIEW_SCALE = 4;
  const TOUCH_NAVIGATION_AVAILABLE = "ontouchstart" in window;

  function maxViewScale() {
    return MAX_VIEW_SCALE;
  }

  function clampView() {
    state.viewScale = Math.max(MIN_VIEW_SCALE, Math.min(maxViewScale(), state.viewScale));
    const maxX = Math.abs(state.width * (1 - state.viewScale) * 0.5);
    const maxY = Math.abs(state.height * (1 - state.viewScale) * 0.5);
    state.viewX = Math.max(-maxX, Math.min(maxX, state.viewX));
    state.viewY = Math.max(-maxY, Math.min(maxY, state.viewY));
  }

  function updateCanvasView() {
    clampView();
    canvasViewport.style.transform = "translate3d(" + state.viewX + "px," + state.viewY + "px,0) scale(" + state.viewScale + ")";
  }

  function viewPointList() {
    return Array.from(state.viewPointers.values()).slice(0, 2);
  }

  function refreshViewGesture() {
    const points = viewPointList();
    if (points.length === 0) {
      state.viewGesture = null;
      return;
    }
    const center = points.length === 1
      ? { x: points[0].x, y: points[0].y }
      : { x: (points[0].x + points[1].x) * 0.5, y: (points[0].y + points[1].y) * 0.5 };
    state.viewGesture = {
      centerX: center.x,
      centerY: center.y,
      distance: points.length === 2 ? Math.max(20, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)) : 0,
      scale: state.viewScale,
      x: state.viewX,
      y: state.viewY
    };
  }

  function beginCanvasNavigation(event) {
    if (TOUCH_NAVIGATION_AVAILABLE && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.viewPointers.set(event.pointerId, stageInteractionPoint(event.clientX, event.clientY));
    refreshViewGesture();
  }

  function applyViewGesture() {
    const points = viewPointList();
    const gesture = state.viewGesture;
    if (!gesture || points.length === 0) return;
    const center = points.length === 1
      ? { x: points[0].x, y: points[0].y }
      : { x: (points[0].x + points[1].x) * 0.5, y: (points[0].y + points[1].y) * 0.5 };
    if (points.length === 1 || gesture.distance === 0) {
      state.viewX = gesture.x + center.x - gesture.centerX;
      state.viewY = gesture.y + center.y - gesture.centerY;
    } else {
      const distance = Math.max(20, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const nextScale = Math.max(MIN_VIEW_SCALE, Math.min(maxViewScale(), gesture.scale * distance / gesture.distance));
      const stageCenterX = state.width * 0.5;
      const stageCenterY = state.height * 0.5;
      const contentX = (gesture.centerX - stageCenterX - gesture.x) / gesture.scale;
      const contentY = (gesture.centerY - stageCenterY - gesture.y) / gesture.scale;
      state.viewScale = nextScale;
      state.viewX = center.x - stageCenterX - contentX * nextScale;
      state.viewY = center.y - stageCenterY - contentY * nextScale;
    }
    updateCanvasView();
  }

  function moveCanvasNavigation(event) {
    if (TOUCH_NAVIGATION_AVAILABLE && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    if (!state.viewPointers.has(event.pointerId)) return;
    event.preventDefault();
    state.viewPointers.set(event.pointerId, stageInteractionPoint(event.clientX, event.clientY));
    applyViewGesture();
  }

  function endCanvasNavigation(event) {
    if (TOUCH_NAVIGATION_AVAILABLE && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    if (!state.viewPointers.has(event.pointerId)) return;
    state.viewPointers.delete(event.pointerId);
    try { canvas.releasePointerCapture(event.pointerId); } catch (error) { void error; }
    refreshViewGesture();
    if (state.viewPointers.size === 0) setStatus("画台已解锁 · 当前显示 " + Math.round(state.viewScale * 100) + "%");
  }

  function zoomCanvasAt(clientX, clientY, nextScale) {
    const point = stageInteractionPoint(clientX, clientY);
    const stageCenterX = state.width * 0.5;
    const stageCenterY = state.height * 0.5;
    const contentX = (point.x - stageCenterX - state.viewX) / state.viewScale;
    const contentY = (point.y - stageCenterY - state.viewY) / state.viewScale;
    state.viewScale = Math.max(MIN_VIEW_SCALE, Math.min(maxViewScale(), nextScale));
    state.viewX = point.x - stageCenterX - contentX * state.viewScale;
    state.viewY = point.y - stageCenterY - contentY * state.viewScale;
    updateCanvasView();
  }

  function syncTouchNavigationPoints(touches) {
    state.viewPointers.clear();
    for (let index = 0; index < Math.min(2, touches.length); index += 1) {
      const touch = touches[index];
      state.viewPointers.set(touch.identifier, stageInteractionPoint(touch.clientX, touch.clientY));
    }
  }

  function beginTouchNavigation(event) {
    if (state.viewLocked) return;
    event.preventDefault();
    syncTouchNavigationPoints(event.touches);
    refreshViewGesture();
  }

  function moveTouchNavigation(event) {
    if (state.viewLocked) return;
    event.preventDefault();
    syncTouchNavigationPoints(event.touches);
    applyViewGesture();
  }

  function endTouchNavigation(event) {
    if (state.viewLocked) return;
    event.preventDefault();
    syncTouchNavigationPoints(event.touches);
    refreshViewGesture();
    if (state.viewPointers.size === 0) setStatus("画台已解锁 · 当前显示 " + Math.round(state.viewScale * 100) + "%");
  }

  function setCanvasLocked(locked) {
    state.viewLocked = locked;
    state.activePointers.clear();
    state.viewPointers.clear();
    state.viewGesture = null;
    canvasViewport.classList.toggle("navigating", !locked);
    canvasLockButton.classList.toggle("unlocked", !locked);
    canvasLockButton.setAttribute("aria-pressed", String(locked));
    canvasLockButton.setAttribute("aria-label", locked ? "画台已锁定，点击解锁移动和缩放" : "画台已解锁，点击锁定并继续画画");
    canvasLockButton.querySelector("em").textContent = locked ? "画台锁定" : "移动画台";
    updateCanvasView();
    if (!locked && state.guideAdjusting) {
      state.guideAdjusting = false;
      syncGuideUi();
    }
    setStatus(locked ? "画台已锁定 · 可继续画画" : "画台已解锁 · 单指移动，双指缩小或放大");
  }

  function setToolHandleY(nextY) {
    const height = drawerToggleButton.offsetHeight || 82;
    const minY = Math.min(124, Math.max(12, stage.clientHeight - height - 12));
    const maxY = Math.max(minY, stage.clientHeight - height - 14);
    drawerToggleButton.style.top = Math.round(Math.max(minY, Math.min(maxY, nextY))) + "px";
  }

  function beginToolHandleDrag(event) {
    event.preventDefault();
    drawerToggleButton.setPointerCapture(event.pointerId);
    const point = stageInteractionPoint(event.clientX, event.clientY);
    state.toolHandleDrag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startTop: drawerToggleButton.offsetTop,
      moved: false,
      fixed: sandApp.classList.contains("landscape-active")
    };
    if (!state.toolHandleDrag.fixed) drawerToggleButton.classList.add("dragging");
  }

  function moveToolHandleDrag(event) {
    const drag = state.toolHandleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (drag.fixed) return;
    const point = stageInteractionPoint(event.clientX, event.clientY);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) setToolHandleY(drag.startTop + dy);
  }

  function endToolHandleDrag(event, cancelled) {
    const drag = state.toolHandleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    try { drawerToggleButton.releasePointerCapture(event.pointerId); } catch (error) { void error; }
    drawerToggleButton.classList.remove("dragging");
    state.toolHandleDrag = null;
    if (!cancelled && (drag.fixed || !drag.moved)) openDrawer();
  }

  function beginDrawerSwipe(event) {
    if (!stage.classList.contains("drawer-open")) return;
    const point = stageInteractionPoint(event.clientX, event.clientY);
    state.drawerSwipe = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      horizontal: false
    };
  }

  function moveDrawerSwipe(event) {
    const swipe = state.drawerSwipe;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const point = stageInteractionPoint(event.clientX, event.clientY);
    swipe.x = point.x;
    swipe.y = point.y;
    const dx = Math.max(0, swipe.x - swipe.startX);
    const dy = Math.abs(swipe.y - swipe.startY);
    if (!swipe.horizontal && dx > 10 && dx > dy * 1.2) {
      swipe.horizontal = true;
      toolDock.classList.add("swiping");
      try { toolDock.setPointerCapture(event.pointerId); } catch (error) { void error; }
    }
    if (!swipe.horizontal) return;
    event.preventDefault();
    toolDock.style.transform = "translateX(" + Math.min(toolDock.offsetWidth || 300, dx) + "px)";
  }

  function endDrawerSwipe(event) {
    const swipe = state.drawerSwipe;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const dx = Math.max(0, swipe.x - swipe.startX);
    const shouldClose = swipe.horizontal && dx > Math.min(88, (toolDock.offsetWidth || 300) * 0.28);
    if (swipe.horizontal) {
      state.drawerSwipeSuppressClick = true;
      setTimeout(function () { state.drawerSwipeSuppressClick = false; }, 420);
    }
    state.drawerSwipe = null;
    toolDock.classList.remove("swiping");
    try { toolDock.releasePointerCapture(event.pointerId); } catch (error) { void error; }
    if (shouldClose) {
      closeDrawer();
      return;
    }
    toolDock.style.transform = "";
  }

  function createNoise(length) {
    const noise = new Float32Array(length);
    for (let i = 0; i < length; i += 1) noise[i] = Math.random();
    return noise;
  }

  function setupCanvas() {
    const oldField = state.field;
    const oldCols = state.cols;
    const oldRows = state.rows;
    const guideCopy = document.createElement("canvas");
    if (state.guideReady && guideCanvas.width > 0 && guideCanvas.height > 0) {
      guideCopy.width = guideCanvas.width;
      guideCopy.height = guideCanvas.height;
      guideCopy.getContext("2d").drawImage(guideCanvas, 0, 0);
    }
    state.width = Math.max(1, Math.round(stage.clientWidth));
    state.height = Math.max(1, Math.round(stage.clientHeight));
    const idealCols = Math.max(1, Math.ceil(state.width / SAND_PIXEL_SIZE));
    const idealRows = Math.max(1, Math.ceil(state.height / SAND_PIXEL_SIZE));
    const densityScale = Math.min(1, Math.sqrt(MAX_RENDER_CELLS / (idealCols * idealRows)));
    state.cols = Math.max(1, Math.floor(idealCols * densityScale));
    state.rows = Math.max(1, Math.floor(idealRows * densityScale));
    buffer.width = state.cols;
    buffer.height = state.rows;
    state.field = new Float32Array(state.cols * state.rows);
    state.noise = createNoise(state.field.length);

    if (oldField.length > 1 && oldCols > 0 && oldRows > 0) {
      for (let y = 0; y < state.rows; y += 1) {
        for (let x = 0; x < state.cols; x += 1) {
          const oldX = Math.min(oldCols - 1, Math.floor((x / state.cols) * oldCols));
          const oldY = Math.min(oldRows - 1, Math.floor((y / state.rows) * oldRows));
          state.field[y * state.cols + x] = oldField[oldY * oldCols + oldX];
        }
      }
    }

    state.image = bctx.createImageData(state.cols, state.rows);
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.width * ratio);
    canvas.height = Math.round(state.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    guideCanvas.width = state.width;
    guideCanvas.height = state.height;
    if (guideCopy.width > 0 && guideCopy.height > 0) {
      guideCanvas.getContext("2d").drawImage(guideCopy, 0, 0, state.width, state.height);
    }
    updateGuideTransform();
    updateCanvasView();
  }

  function snapshot() {
    state.history.push(state.field.slice());
    if (state.history.length > 12) state.history.shift();
    state.future.length = 0;
  }

  function stamp(screenX, screenY, radius, amount) {
    const gridX = (screenX / state.width) * state.cols;
    const gridY = (screenY / state.height) * state.rows;
    const gridRadius = Math.max(1, (radius / state.width) * state.cols);
    const minY = Math.max(1, Math.floor(gridY - gridRadius));
    const maxY = Math.min(state.rows - 1, Math.ceil(gridY + gridRadius));
    const minX = Math.max(1, Math.floor(gridX - gridRadius));
    const maxX = Math.min(state.cols - 1, Math.ceil(gridX + gridRadius));

    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        const distance = Math.hypot(x - gridX, y - gridY) / gridRadius;
        if (distance >= 1) continue;
        const falloff = Math.pow(1 - distance, 1.7);
        const index = y * state.cols + x;
        state.field[index] = Math.max(0, Math.min(1.45, state.field[index] + amount * falloff * (0.72 + state.noise[index] * 0.55)));
      }
    }
  }

  function paint(x0, y0, x1, y1, radius, speed) {
    state.future.length = 0;
    const distance = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, radius * 0.12)));
    const amount = 0.0022 + Math.max(0, 1 - speed / 1.25) * 0.005;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, amount);
    }
  }

  function push(x0, y0, x1, y1, radius, erase) {
    state.future.length = 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.max(1, Math.ceil(distance / 3));
    const nx = dx / distance;
    const ny = dy / distance;

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const centerX = x0 + dx * t;
      const centerY = y0 + dy * t;
      const gridX = (centerX / state.width) * state.cols;
      const gridY = (centerY / state.height) * state.rows;
      const gridRadius = Math.max(1, (radius / state.width) * state.cols);

      for (let y = Math.max(1, Math.floor(gridY - gridRadius)); y < Math.min(state.rows - 1, Math.ceil(gridY + gridRadius)); y += 1) {
        for (let x = Math.max(1, Math.floor(gridX - gridRadius)); x < Math.min(state.cols - 1, Math.ceil(gridX + gridRadius)); x += 1) {
          const normalizedDistance = Math.hypot(x - gridX, y - gridY) / gridRadius;
          if (normalizedDistance >= 1) continue;
          const index = y * state.cols + x;
          const moved = state.field[index] * (erase ? 0.16 : 0.1) * Math.pow(1 - normalizedDistance, 1.4);
          state.field[index] -= moved;
          if (erase) continue;
          const side = (x - gridX) * -ny + (y - gridY) * nx;
          const endX = Math.round(x + nx * gridRadius * 0.78 - ny * (side > 0 ? gridRadius * 0.26 : -gridRadius * 0.26));
          const endY = Math.round(y + ny * gridRadius * 0.78 + nx * (side > 0 ? gridRadius * 0.26 : -gridRadius * 0.26));
          if (endX > 0 && endX < state.cols - 1 && endY > 0 && endY < state.rows - 1) {
            const endIndex = endY * state.cols + endX;
            state.field[endIndex] = Math.min(1.45, state.field[endIndex] + moved * 0.92);
          }
        }
      }
    }
  }


  const sunsetColors = window.MananaColor.palette;

  function render() {
    const data = state.image.data;
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        const index = y * state.cols + x;
        const pixel = index * 4;
        const raw = state.field[index];
        const value = raw < 0.28 && state.noise[index] > raw * 3.65 ? 0 : raw;
        const left = state.field[index - (x > 0 ? 1 : 0)];
        const right = state.field[index + (x < state.cols - 1 ? 1 : 0)];
        const up = state.field[index - (y > 0 ? state.cols : 0)];
        const down = state.field[index + (y < state.rows - 1 ? state.cols : 0)];
        const slope = (left - right) * 0.33 + (up - down) * 0.18;
        const grain = Math.min(1, value * 5.2) * (state.noise[index] - 0.5) * 34;
        const impurity = value > 0.035 && Math.sin(index * 91.137) > 0.94 ? 30 : 0;
        const absorb = 1 - Math.exp(-value * 5.1);
        const edge = Math.min(28, Math.abs(slope) * 145);
        const color = Math.round(absorb * 4095) * 3;
        data[pixel] = sunsetColors[color] + slope * 90 + grain * 0.65 + edge - impurity * 0.6;
        data[pixel + 1] = sunsetColors[color + 1] + slope * 52 + grain * 0.48 + edge * 0.5 - impurity * 0.4;
        data[pixel + 2] = sunsetColors[color + 2] + slope * 22 + grain * 0.25 + edge * 0.24 - impurity * 0.15;
        data[pixel + 3] = 255;
      }
    }
    bctx.putImageData(state.image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, state.width, state.height);
    const glow = ctx.createRadialGradient(state.width * 0.5, state.height * 0.48, 20, state.width * 0.5, state.height * 0.48, Math.max(state.width, state.height) * 0.72);
    glow.addColorStop(0, "rgba(255,208,98,.035)");
    glow.addColorStop(1, "rgba(160,38,12,.07)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  function frame(now) {
    const delta = Math.min(40, now - state.lastFrameAt);
    state.lastFrameAt = now;
    state.activePointers.forEach(function (pointer, pointerId) {
      if (pointer.hoverMode && now > pointer.hoverUntil) {
        state.activePointers.delete(pointerId);
        return;
      }
      if (state.paused) return;
      const stillFor = now - pointer.lastMoveAt;
      if (stillFor > 420 && state.tool === "sand") {
        const build = Math.min(1, (stillFor - 420) / 2800);
        stamp(pointer.x, pointer.y, pointer.radius * (1 + build * 0.52), delta * (0.000045 + build * 0.00016));
      } else if (stillFor > 420 && state.tool === "light") {
        stamp(pointer.x, pointer.y, pointer.radius, -delta * 0.00045);
      }
    });
    wind.tick(delta, now);
    render();
    requestAnimationFrame(frame);
  }

  function localPoint(event) {
    const point = stageInteractionPoint(event.clientX, event.clientY);
    return {
      x: (point.x - state.width * 0.5 - state.viewX) / state.viewScale + state.width * 0.5,
      y: (point.y - state.height * 0.5 - state.viewY) / state.viewScale + state.height * 0.5
    };
  }

  function makePointer(event, hoverMode) {
    const point = localPoint(event);
    const now = performance.now();
    return {
      x: point.x,
      y: point.y,
      lastX: point.x,
      lastY: point.y,
      lastMoveAt: now,
      lastEventAt: now,
      hoverMode: hoverMode,
      hoverUntil: hoverMode ? now + 760 : 0,
      pointerType: event.pointerType,
      radius: state.size
    };
  }

  function beginSandPointer(event) {
    if (wind.busy()) return;
    if (!state.viewLocked) {
      beginCanvasNavigation(event);
      return;
    }
    event.preventDefault();
    if (state.paused) return;
    canvas.setPointerCapture(event.pointerId);
    if (state.activePointers.size === 0) snapshot();
    const pointer = makePointer(event, false);
    state.activePointers.set(event.pointerId, pointer);
    if (state.tool === "sand") stamp(pointer.x, pointer.y, pointer.radius, 0.0045);
    markStarted();
    setStatus(state.activePointers.size > 1 ? "多指创作 · 每根手指使用当前画笔大小" : "当前画笔大小：" + state.size);
  }

  function moveSandPointer(event) {
    if (wind.busy()) return;
    if (!state.viewLocked) {
      moveCanvasNavigation(event);
      return;
    }
    event.preventDefault();
    if (state.paused) return;
    const now = performance.now();
    let pointer = state.activePointers.get(event.pointerId);
    if (!pointer) {
      if (event.pointerType !== "mouse") return;
      snapshot();
      pointer = makePointer(event, true);
      state.activePointers.set(event.pointerId, pointer);
      markStarted();
      return;
    }

    const point = localPoint(event);
    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.radius = state.size;
    if (event.pointerType === "mouse" && pointer.hoverMode) pointer.hoverUntil = now + 760;
    const distance = Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY);
    if (distance <= 0.7) return;
    const speed = distance / Math.max(4, now - pointer.lastEventAt);
    pointer.lastMoveAt = now;
    pointer.lastEventAt = now;
    if (state.tool === "sand") {
      paint(pointer.lastX, pointer.lastY, pointer.x, pointer.y, pointer.radius, speed);
      setStatus(state.activePointers.size > 1 ? "双指落砂 · 两处沙粒同时堆积" : (speed > 0.8 ? "轻轻划过 · 留下薄而稀疏的沙层" : "缓慢移动 · 沙层会铺得更厚"));
    } else if (state.tool === "shape") {
      push(pointer.lastX, pointer.lastY, pointer.x, pointer.y, pointer.radius, false);
      setStatus(state.activePointers.size > 1 ? "多指塑形 · 同时推动两处沙粒" : "慢慢推移沙粒，边缘会形成自然的沙脊");
    } else {
      push(pointer.lastX, pointer.lastY, pointer.x, pointer.y, pointer.radius, true);
      setStatus(state.activePointers.size > 1 ? "多指透光 · 同时擦开两处灯板区域" : "擦去沙层，重新露出温暖的灯光");
    }
  }

  function endSandPointer(event) {
    if (!state.viewLocked) {
      endCanvasNavigation(event);
      return;
    }
    state.activePointers.delete(event.pointerId);
    try { canvas.releasePointerCapture(event.pointerId); } catch (error) { void error; }
  }

  function setTool(tool) {
    state.tool = tool;
    toolButtons.forEach(function (button) {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    const labels = { sand: "落砂模式 · 长按添加沙粒", shape: "塑形模式 · 推移并堆积已有沙粒", light: "透光模式 · 擦去沙粒露出灯板" };
    setStatus(labels[tool]);
  }

  function undo() {
    wind.release();
    const previous = state.history.pop();
    if (!previous || previous.length !== state.field.length) return;
    state.future.push(state.field.slice());
    if (state.future.length > 12) state.future.shift();
    state.field.set(previous);
    setStatus("已撤回上一步 · 可使用取消撤回恢复");
  }

  function redo() {
    wind.release();
    const next = state.future.pop();
    if (!next || next.length !== state.field.length) return;
    state.history.push(state.field.slice());
    if (state.history.length > 12) state.history.shift();
    state.field.set(next);
    markStarted();
    setStatus("已取消撤回 · 恢复刚才的操作");
  }

  function clearSand() {
    wind.release();
    snapshot();
    state.field.fill(0);
    state.started = false;
    welcomeNode.classList.remove("hidden");
    setStatus("画台已清空 · 触摸屏幕重新开始");
  }

  async function bitmapFromFile(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("请选择图片文件");
    if (typeof createImageBitmap !== "function") throw new Error("当前小红书版本不支持本地图片解析");
    return createImageBitmap(file);
  }

  function drawBitmapContained(context, bitmap, width, height) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  async function generateSandFromFile(file) {
    generateButton.disabled = true;
    generateButton.querySelector("b").textContent = "生成中…";
    setStatus("正在本地分析图片并生成沙画…");
    try {
      const bitmap = await bitmapFromFile(file);
      snapshot();
      const source = document.createElement("canvas");
      source.width = state.cols;
      source.height = state.rows;
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      drawBitmapContained(sourceContext, bitmap, state.cols, state.rows);
      const pixels = sourceContext.getImageData(0, 0, state.cols, state.rows).data;
      window.MananaColor.photoToField(pixels, state.cols, state.rows, state.field);
      bitmap.close();
      markStarted();
      setTool("shape");
      setStatus("沙画已生成 · 可继续塑形、落砂或透光");
      closeDrawer();
    } catch (error) {
      setStatus(error.message || "图片读取失败，请更换图片重试");
    } finally {
      generateButton.disabled = false;
      generateButton.querySelector("b").textContent = "自动生成沙画";
      sandImageInput.value = "";
    }
  }

  async function createGuideFromFile(file) {
    setStatus("正在本地生成线稿辅助…");
    try {
      const bitmap = await bitmapFromFile(file);
      const width = Math.max(1, state.width);
      const height = Math.max(1, state.height);
      guideCanvas.width = width;
      guideCanvas.height = height;
      const source = document.createElement("canvas");
      source.width = width;
      source.height = height;
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      drawBitmapContained(sourceContext, bitmap, width, height);
      bitmap.close();

      const sourceImage = sourceContext.getImageData(0, 0, width, height);
      const output = sourceContext.createImageData(width, height);
      const luminance = new Float32Array(width * height);
      for (let index = 0; index < luminance.length; index += 1) {
        const pixel = index * 4;
        luminance[index] = sourceImage.data[pixel] * 0.299 + sourceImage.data[pixel + 1] * 0.587 + sourceImage.data[pixel + 2] * 0.114;
      }
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          const pixel = index * 4;
          const gx = -luminance[index - width - 1] - 2 * luminance[index - 1] - luminance[index + width - 1] + luminance[index - width + 1] + 2 * luminance[index + 1] + luminance[index + width + 1];
          const gy = -luminance[index - width - 1] - 2 * luminance[index - width] - luminance[index - width + 1] + luminance[index + width - 1] + 2 * luminance[index + width] + luminance[index + width + 1];
          const edge = Math.hypot(gx, gy);
          if (edge > 72) {
            output.data[pixel] = 72;
            output.data[pixel + 1] = 34;
            output.data[pixel + 2] = 8;
            output.data[pixel + 3] = Math.min(205, 45 + edge * 0.45);
          }
        }
      }
      guideCanvas.getContext("2d").putImageData(output, 0, 0);
      state.guideReady = true;
      state.guideVisible = true;
      resetGuideTransform();
      guideControls.hidden = false;
      guideButtonHint.textContent = "更换参考图";
      enterGuideAdjustment();
    } catch (error) {
      setStatus(error.message || "线稿生成失败，请更换图片重试");
    } finally {
      guideImageInput.value = "";
    }
  }

  function resetGuideTransform() {
    state.guideX = 0;
    state.guideY = 0;
    state.guideScale = 1;
    state.guideRotation = 0;
    updateGuideTransform();
  }

  function updateGuideTransform() {
    const transform = "translate(" + state.guideX + "px," + state.guideY + "px) scale(" + state.guideScale + ") rotate(" + state.guideRotation + "deg)";
    guideCanvas.style.transform = transform;
    guideFrame.style.transform = transform;
  }

  function syncGuideUi() {
    guideCanvas.classList.toggle("visible", state.guideReady && state.guideVisible);
    guideCanvas.classList.toggle("adjusting", state.guideReady && state.guideAdjusting);
    guideFrame.classList.toggle("visible", state.guideReady && state.guideAdjusting);
    guideAdjustPanel.hidden = !(state.guideReady && state.guideAdjusting);
    stage.classList.toggle("guide-adjusting", state.guideReady && state.guideAdjusting);
    guideToggleButton.textContent = state.guideVisible ? "隐藏辅助线" : "显示辅助线";
    guideAdjustButton.textContent = "调整参考线";
    guideAdjustButton.classList.toggle("active", state.guideAdjusting);
  }

  function guidePointList() {
    return Array.from(state.guidePointers.values()).slice(0, 2);
  }

  function refreshGuideGesture() {
    const points = guidePointList();
    if (points.length === 0) {
      state.guideGesture = null;
      return;
    }
    const center = points.length === 1
      ? { x: points[0].x, y: points[0].y }
      : { x: (points[0].x + points[1].x) * 0.5, y: (points[0].y + points[1].y) * 0.5 };
    state.guideGesture = {
      centerX: center.x,
      centerY: center.y,
      distance: points.length === 2 ? Math.max(20, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)) : 0,
      angle: points.length === 2 ? Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) : 0,
      x: state.guideX,
      y: state.guideY,
      scale: state.guideScale,
      rotation: state.guideRotation
    };
  }

  function applyGuideGesture() {
    const points = guidePointList();
    const gesture = state.guideGesture;
    if (!gesture || points.length === 0) return;
    const center = points.length === 1
      ? { x: points[0].x, y: points[0].y }
      : { x: (points[0].x + points[1].x) * 0.5, y: (points[0].y + points[1].y) * 0.5 };
    state.guideX = gesture.x + (center.x - gesture.centerX) / state.viewScale;
    state.guideY = gesture.y + (center.y - gesture.centerY) / state.viewScale;
    if (points.length === 2 && gesture.distance > 0) {
      const distance = Math.max(20, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const angle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
      state.guideScale = Math.max(0.25, Math.min(4, gesture.scale * distance / gesture.distance));
      state.guideRotation = gesture.rotation + (angle - gesture.angle) * 180 / Math.PI;
    }
    updateGuideTransform();
  }

  function beginGuidePointer(event) {
    if (!state.guideAdjusting) return;
    if (TOUCH_NAVIGATION_AVAILABLE && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    guideCanvas.setPointerCapture(event.pointerId);
    state.guidePointers.set(event.pointerId, stageInteractionPoint(event.clientX, event.clientY));
    refreshGuideGesture();
  }

  function moveGuidePointer(event) {
    if (!state.guideAdjusting || !state.guidePointers.has(event.pointerId)) return;
    event.preventDefault();
    state.guidePointers.set(event.pointerId, stageInteractionPoint(event.clientX, event.clientY));
    applyGuideGesture();
  }

  function endGuidePointer(event) {
    if (!state.guidePointers.has(event.pointerId)) return;
    state.guidePointers.delete(event.pointerId);
    try { guideCanvas.releasePointerCapture(event.pointerId); } catch (error) { void error; }
    refreshGuideGesture();
  }

  function syncGuideTouchPoints(touches) {
    state.guidePointers.clear();
    for (let index = 0; index < Math.min(2, touches.length); index += 1) {
      const touch = touches[index];
      state.guidePointers.set(touch.identifier, stageInteractionPoint(touch.clientX, touch.clientY));
    }
  }

  function beginGuideTouch(event) {
    if (!state.guideAdjusting) return;
    event.preventDefault();
    syncGuideTouchPoints(event.touches);
    refreshGuideGesture();
  }

  function moveGuideTouch(event) {
    if (!state.guideAdjusting) return;
    event.preventDefault();
    syncGuideTouchPoints(event.touches);
    applyGuideGesture();
  }

  function endGuideTouch(event) {
    if (!state.guideAdjusting) return;
    event.preventDefault();
    syncGuideTouchPoints(event.touches);
    refreshGuideGesture();
  }

  function enterGuideAdjustment() {
    if (!state.guideReady) return;
    state.guideVisible = true;
    state.guideAdjusting = true;
    state.guidePointers.clear();
    state.guideGesture = null;
    setCanvasLocked(true);
    closeDrawer();
    syncGuideUi();
    setStatus("调整参考线 · 单指移动，双指缩放与旋转，完成后点确定");
  }

  function confirmGuideAdjustment() {
    state.guideAdjusting = false;
    state.guidePointers.clear();
    state.guideGesture = null;
    syncGuideUi();
    setStatus("参考线位置已确定 · 可以开始描摹");
  }

  function getMiniToolApi() {
    if (window.xhs && window.xhs.miniTool) return window.xhs.miniTool;
    return null;
  }

  function sandArtworkDataUrl() {
    return canvas.toDataURL("image/png");
  }

  function downloadArtwork() {
    const link = document.createElement("a");
    link.href = sandArtworkDataUrl();
    link.download = "manana-sunset-sand-art-" + new Date().toISOString().slice(0, 10) + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function dataUrlToFile(dataUrl) {
    const parts = dataUrl.split(",");
    const mime = (parts[0].match(/data:([^;]+)/) || [null, "image/png"])[1];
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], "manana-sunset-sand-art.png", { type: mime });
  }

  async function createArtworkTempFile(miniTool) {
    const dataUrl = sandArtworkDataUrl();
    if (typeof miniTool.writeTempFile !== "function") return dataUrl;
    const result = await miniTool.writeTempFile({ data: dataUrl });
    if (!result || typeof result.filePath !== "string" || !result.filePath) {
      throw new Error("作品临时文件生成失败，请重试");
    }
    return result.filePath;
  }

  async function saveArtworkToAlbum() {
    const miniTool = getMiniToolApi();
    if (!miniTool || typeof miniTool.saveImageToPhotosAlbum !== "function") {
      downloadArtwork();
      setStatus("作品 PNG 已下载");
      closeDrawer();
      return;
    }
    saveImageButton.disabled = true;
    setStatus("正在保存作品到系统相册…");
    try {
      const filePath = await createArtworkTempFile(miniTool);
      await miniTool.saveImageToPhotosAlbum({ filePath: filePath });
      setStatus("作品已保存到系统相册");
      closeDrawer();
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : "保存失败，请检查相册权限后重试";
      setStatus(message);
    } finally {
      saveImageButton.disabled = false;
    }
  }

  async function postArtworkToXhs() {
    const miniTool = getMiniToolApi();
    if (!miniTool || typeof miniTool.postNote !== "function") {
      try {
        const file = dataUrlToFile(sandArtworkDataUrl());
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ title: "我的指尖沙画", text: "我用指尖沙画画台创作了一幅作品", files: [file] });
          setStatus("作品已分享");
        } else {
          downloadArtwork();
          setStatus("当前浏览器不支持图片分享 · 已为你下载作品");
        }
        closeDrawer();
      } catch (error) {
        if (error && error.name === "AbortError") setStatus("已取消分享");
        else setStatus("分享失败 · 可以使用“下载作品”保存图片");
      }
      return;
    }
    postNoteButton.disabled = true;
    setStatus("正在打开小红书笔记发布页…");
    try {
      saveProject(false);
      await miniTool.postNote({
        title: "我的数字沙画",
        content: "用指尖沙画画台创作的作品",
        pageType: "photo_publish",
        mediaInfo: {
          image_resources: [{ url: sandArtworkDataUrl() }]
        }
      });
      setStatus("已打开笔记发布页 · 可继续编辑并发布");
      closeDrawer();
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : "未能打开发布页，请稍后重试";
      setStatus(message);
    } finally {
      postNoteButton.disabled = false;
    }
  }

  canvas.addEventListener("pointerdown", beginSandPointer);
  canvas.addEventListener("pointermove", moveSandPointer);
  canvas.addEventListener("pointerup", endSandPointer);
  canvas.addEventListener("pointercancel", endSandPointer);
  canvas.addEventListener("lostpointercapture", endSandPointer);
  canvas.addEventListener("touchstart", beginTouchNavigation, { passive: false });
  canvas.addEventListener("touchmove", moveTouchNavigation, { passive: false });
  canvas.addEventListener("touchend", endTouchNavigation, { passive: false });
  canvas.addEventListener("touchcancel", endTouchNavigation, { passive: false });
  canvas.addEventListener("wheel", function (event) {
    if (state.viewLocked) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomCanvasAt(event.clientX, event.clientY, state.viewScale * factor);
    setStatus("画台已解锁 · 当前显示 " + Math.round(state.viewScale * 100) + "%");
  }, { passive: false });
  canvas.addEventListener("pointerleave", function (event) {
    const pointer = state.activePointers.get(event.pointerId);
    if (pointer && pointer.hoverMode) state.activePointers.delete(event.pointerId);
  });

  guideCanvas.addEventListener("pointerdown", beginGuidePointer);
  guideCanvas.addEventListener("pointermove", moveGuidePointer);
  guideCanvas.addEventListener("pointerup", endGuidePointer);
  guideCanvas.addEventListener("pointercancel", endGuidePointer);
  guideCanvas.addEventListener("lostpointercapture", endGuidePointer);
  guideCanvas.addEventListener("touchstart", beginGuideTouch, { passive: false });
  guideCanvas.addEventListener("touchmove", moveGuideTouch, { passive: false });
  guideCanvas.addEventListener("touchend", endGuideTouch, { passive: false });
  guideCanvas.addEventListener("touchcancel", endGuideTouch, { passive: false });

  toolButtons.forEach(function (button) {
    button.addEventListener("click", function () { setTool(button.dataset.tool); });
  });
  brushInput.addEventListener("input", function () {
    state.size = Number(brushInput.value);
    brushOutput.textContent = String(state.size);
    state.activePointers.forEach(function (pointer) { pointer.radius = state.size; });
    setStatus("画笔大小已调整为 " + state.size);
  });
  pauseButton.addEventListener("click", function () {
    wind.release();
    state.paused = !state.paused;
    pauseButton.classList.toggle("active", state.paused);
    pauseButton.querySelector("em").textContent = state.paused ? "恢复" : "暂停";
    setStatus(state.paused ? "已暂停 · 所有触摸操作已冻结" : "已恢复 · 可继续创作");
  });
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  clearButton.addEventListener("click", clearSand);
  canvasLockButton.addEventListener("click", function () { setCanvasLocked(!state.viewLocked); });
  windQuickButton.addEventListener("click", function () { openDrawer(); document.getElementById("windSettings").scrollIntoView({ block: "center", behavior: "smooth" }); });

  generateButton.addEventListener("click", function () { sandImageInput.click(); });
  sandImageInput.addEventListener("change", function () { generateSandFromFile(sandImageInput.files && sandImageInput.files[0]); });
  guideButton.addEventListener("click", function () { guideImageInput.click(); });
  guideImageInput.addEventListener("change", function () { createGuideFromFile(guideImageInput.files && guideImageInput.files[0]); });
  guideToggleButton.addEventListener("click", function () {
    state.guideVisible = !state.guideVisible;
    syncGuideUi();
    setStatus(state.guideVisible ? "辅助线已显示" : "辅助线已隐藏 · 当前只显示沙画");
  });
  guideAdjustButton.addEventListener("click", function () {
    enterGuideAdjustment();
  });
  guideConfirmButton.addEventListener("click", confirmGuideAdjustment);
  drawerToggleButton.addEventListener("pointerdown", beginToolHandleDrag);
  drawerToggleButton.addEventListener("pointermove", moveToolHandleDrag);
  drawerToggleButton.addEventListener("pointerup", function (event) { endToolHandleDrag(event, false); });
  drawerToggleButton.addEventListener("pointercancel", function (event) { endToolHandleDrag(event, true); });
  drawerToggleButton.addEventListener("click", function (event) { if (event.detail === 0) openDrawer(); });
  toolDock.addEventListener("pointerdown", beginDrawerSwipe);
  toolDock.addEventListener("pointermove", moveDrawerSwipe);
  toolDock.addEventListener("pointerup", endDrawerSwipe);
  toolDock.addEventListener("pointercancel", endDrawerSwipe);
  toolDock.addEventListener("click", function (event) {
    if (!state.drawerSwipeSuppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    state.drawerSwipeSuppressClick = false;
  }, true);
  drawerScrim.addEventListener("click", closeDrawer);
  saveImageButton.addEventListener("click", saveArtworkToAlbum);
  postNoteButton.addEventListener("click", postArtworkToXhs);
  saveProjectButton.addEventListener("click", function () { saveProject(true, false); });
  saveNewProjectButton.addEventListener("click", function () { saveProject(true, true); });
  landscapeButton.addEventListener("click", requestLandscapeMode);

  ["contextmenu", "selectstart", "dragstart", "copy"].forEach(function (eventName) {
    document.addEventListener(eventName, function (event) { event.preventDefault(); }, { passive: false });
  });
  document.addEventListener("selectionchange", function () {
    const selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
  });

  window.addEventListener("keydown", function (event) {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      closeDrawer();
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (command && key === "x") {
      event.preventDefault();
      clearSand();
      return;
    }
    if (key === "a") setTool("sand");
    if (key === "s") setTool("shape");
    if (key === "d") setTool("light");
    if (key === "f") pauseButton.click();
  });

  let resizeTimer = null;
  function scheduleCanvasSetup() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      state.activePointers.clear();
      state.viewPointers.clear();
      state.guidePointers.clear();
      state.viewGesture = null;
      state.guideGesture = null;
      syncLandscapeMode();
      setupCanvas();
      if (drawerToggleButton.style.top) setToolHandleY(drawerToggleButton.offsetTop);
    }, 160);
  }
  window.addEventListener("resize", scheduleCanvasSetup);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleCanvasSetup);
  if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
    window.screen.orientation.addEventListener("change", scheduleCanvasSetup);
  }
  window.addEventListener("orientationchange", scheduleCanvasSetup);
  window.addEventListener("pageshow", scheduleCanvasSetup);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) scheduleCanvasSetup();
  });
  const wind = window.MananaWind.attach({ state, snapshot, localPoint, status: setStatus, started: markStarted, closeDrawer });
  syncLandscapeMode();
  setupCanvas();
  syncProjectUi();
  requestAnimationFrame(frame);
}());
