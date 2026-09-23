import {
  SHAPE_TYPES,
  createElement,
  renderElementToSvg,
  getElementBounds,
  getConnectionPorts,
  getBestPortPair,
  getDefaultThemeStrokeColor,
  getDefaultThemeFillColor
} from './shapes.js';

/**
 * Helper to identify network device elements that can connect cables
 */
export function isConnectableDevice(el) {
  if (!el || el.points) return false;
  return typeof el.type === 'string' && (el.type.startsWith('device-') || el.type === SHAPE_TYPES.RACK);
}

export class CanvasEngine {
  constructor(svgElement, workspaceElement, options = {}) {
    this.svg = svgElement;
    this.workspace = workspaceElement;
    this.viewportGroup = svgElement.querySelector('#canvasViewportGroup');
    this.elementsLayer = svgElement.querySelector('#canvasElementsLayer');
    this.previewLayer = svgElement.querySelector('#canvasPreviewLayer');
    this.selectionLayer = svgElement.querySelector('#canvasSelectionLayer');

    // Callbacks
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.onZoomChange = options.onZoomChange || (() => {});
    this.onCoordinatesChange = options.onCoordinatesChange || (() => {});
    this.onChange = options.onChange || (() => {});

    // Transform State (Pan & Zoom)
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.2;
    this.maxScale = 4.0;

    // Grid & Snap
    this.gridSnap = true;
    this.gridSize = 20;

    // Tool & Mode
    this.activeTool = SHAPE_TYPES.SELECT;
    this.defaultStroke = getDefaultThemeStrokeColor();
    this.defaultFill = getDefaultThemeFillColor();
    this.defaultStrokeWidth = 2;
    this.defaultStrokeStyle = 'solid';

    // Elements & Selection
    this.elements = [];
    this.selectedId = null;

    // Interactive Drag / Pan / Draw State
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.isSpacePressed = false;

    this.isDraggingElement = false;
    this.dragStartWorld = { x: 0, y: 0 };
    this.elementInitialPos = null;
    this.attachedCables = [];

    // Interactive Resize & Rotate State
    this.isResizing = false;
    this.activeHandleKey = null;
    this.activeHandleType = null;
    this.activePointIndex = -1;
    this.resizeStartWorld = { x: 0, y: 0 };
    this.resizeInitialEl = null;

    this.isRotating = false;
    this.rotateCx = 0;
    this.rotateCy = 0;

    this.isDrawing = false;
    this.drawingElement = null;
    this.polylinePoints = [];
    this.wireStartEl = null;
    this.wireStartPt = null;
    this.wireIsClickMode = false;
    this.wireMouseDownPos = null;

    // History (Undo / Redo)
    this.undoStack = [];
    this.redoStack = [];

    this._bindEvents();
    this.applyTransform();
  }

  // ==========================================
  // Coordinate Conversion & Snapping
  // ==========================================
  screenToWorld(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.scale,
      y: (clientY - rect.top - this.panY) / this.scale
    };
  }

  snap(val) {
    if (!this.gridSnap) return Math.round(val);
    return Math.round(val / this.gridSize) * this.gridSize;
  }

  snapPoint(pt) {
    return {
      x: this.snap(pt.x),
      y: this.snap(pt.y)
    };
  }

  // ==========================================
  // Pan & Zoom Engine
  // ==========================================
  applyTransform() {
    if (this.viewportGroup) {
      this.viewportGroup.setAttribute(
        'transform',
        `matrix(${this.scale}, 0, 0, ${this.scale}, ${this.panX}, ${this.panY})`
      );
    }
    this.onZoomChange(Math.round(this.scale * 100));
  }

  zoomAt(factor, clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const cx = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const cy = clientY !== undefined ? clientY - rect.top : rect.height / 2;

    const worldX = (cx - this.panX) / this.scale;
    const worldY = (cy - this.panY) / this.scale;

    const newScale = Math.min(Math.max(this.scale * factor, this.minScale), this.maxScale);
    if (newScale === this.scale) return;

    this.panX = cx - worldX * newScale;
    this.panY = cy - worldY * newScale;
    this.scale = newScale;

    this.applyTransform();
  }

  setZoom(scale) {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, scale));
    this.applyTransform();
  }

  zoomIn() {
    this.setZoom(this.scale * 1.2);
  }

  zoomOut() {
    this.setZoom(this.scale / 1.2);
  }

  resetZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  setGridSnap(enabled) {
    this.gridSnap = enabled;
  }

  setActiveTool(tool) {
    // If finishing active polyline
    if (this.activeTool === SHAPE_TYPES.POLYLINE && this.polylinePoints.length > 1) {
      this._commitPolyline();
    } else {
      this._cancelDrawing();
    }

    this.activeTool = tool;
    this.workspace.classList.toggle('is-pan-tool', tool === SHAPE_TYPES.PAN);
    this.workspace.classList.toggle('is-drawing', tool !== SHAPE_TYPES.SELECT && tool !== SHAPE_TYPES.PAN);

    // Toggle Wiring Banner & wiring-active class
    const wiringBanner = document.getElementById('canvasWiringBanner');
    const isWiring = tool === SHAPE_TYPES.ORTHOGONAL || tool === SHAPE_TYPES.LINE;
    this.workspace.classList.toggle('wiring-active', isWiring);
    if (wiringBanner) {
      wiringBanner.style.display = isWiring ? 'flex' : 'none';
    }

    if (isWiring) {
      this._renderPortHighlights();
    } else if (this.previewLayer) {
      this.previewLayer.innerHTML = '';
    }
  }

  /**
   * Find nearest connection port on network devices within threshold
   */
  _findNearestPort(worldPt, threshold = 22) {
    let nearest = null;
    let minDistance = threshold;

    for (const el of this.elements) {
      // Don't snap wire to another wire's ports
      if (el.points && el.points.length > 0) continue;
      // Only connect to network devices (avoids background rectangles/shapes!)
      if (!isConnectableDevice(el)) continue;

      const ports = getConnectionPorts(el);
      for (const p of ports) {
        const d = Math.hypot(worldPt.x - p.x, worldPt.y - p.y);
        if (d < minDistance) {
          minDistance = d;
          nearest = { port: p, element: el, distance: d };
        }
      }
    }
    return nearest;
  }

  /**
   * Render port indicator dots for wiring tools and point-dragging
   */
  _renderPortHighlights(activePort = null, forceShow = false) {
    const isWiring = this.activeTool === SHAPE_TYPES.ORTHOGONAL || this.activeTool === SHAPE_TYPES.LINE;
    const isPointDrag = this.activeHandleType === 'point';
    if (!isWiring && !isPointDrag && !forceShow) return;

    // Remove existing port highlights
    const existingHighlights = this.previewLayer.querySelectorAll('.canvas-port-highlight-group, .canvas-port-dot');
    existingHighlights.forEach(d => d.remove());

    const sideNames = {
      top: '上ポート',
      right: '右ポート',
      bottom: '下ポート',
      left: '左ポート'
    };

    for (const el of this.elements) {
      if (el.points && el.points.length > 0) continue;
      if (!isConnectableDevice(el)) continue;
      const ports = getConnectionPorts(el);
      for (const p of ports) {
        const isMatched = activePort && Math.abs(activePort.x - p.x) < 2 && Math.abs(activePort.y - p.y) < 2;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'canvas-port-highlight-group');
        g.style.pointerEvents = 'none';

        if (isMatched) {
          // Glow effect for active snapped port
          const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          halo.setAttribute('cx', p.x);
          halo.setAttribute('cy', p.y);
          halo.setAttribute('r', '14');
          halo.setAttribute('fill', 'rgba(16, 185, 129, 0.35)');
          halo.setAttribute('stroke', '#10b981');
          halo.setAttribute('stroke-width', '2');
          g.appendChild(halo);

          const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          core.setAttribute('cx', p.x);
          core.setAttribute('cy', p.y);
          core.setAttribute('r', '6');
          core.setAttribute('fill', '#10b981');
          core.setAttribute('stroke', '#ffffff');
          core.setAttribute('stroke-width', '2');
          g.appendChild(core);

          // Snapped Tooltip Badge
          const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const badgeY = p.side === 'top' ? p.y - 18 : p.y + 20;
          const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          badgeBg.setAttribute('x', p.x - 48);
          badgeBg.setAttribute('y', badgeY - 11);
          badgeBg.setAttribute('width', '96');
          badgeBg.setAttribute('height', '18');
          badgeBg.setAttribute('rx', '4');
          badgeBg.setAttribute('fill', '#10b981');
          badgeBg.setAttribute('stroke', '#ffffff');
          badgeBg.setAttribute('stroke-width', '1');
          badgeG.appendChild(badgeBg);

          const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          badgeText.setAttribute('x', p.x);
          badgeText.setAttribute('y', badgeY + 2);
          badgeText.setAttribute('text-anchor', 'middle');
          badgeText.setAttribute('font-size', '10');
          badgeText.setAttribute('font-weight', 'bold');
          badgeText.setAttribute('fill', '#ffffff');
          badgeText.textContent = `接続 (${sideNames[p.side] || 'ポート'})`;
          badgeG.appendChild(badgeText);
          g.appendChild(badgeG);

        } else {
          // Visible target ring for all available ports
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.setAttribute('cx', p.x);
          ring.setAttribute('cy', p.y);
          ring.setAttribute('r', '8');
          ring.setAttribute('fill', 'rgba(56, 189, 248, 0.2)');
          ring.setAttribute('stroke', '#38bdf8');
          ring.setAttribute('stroke-width', '1.5');
          g.appendChild(ring);

          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', p.x);
          dot.setAttribute('cy', p.y);
          dot.setAttribute('r', '4');
          dot.setAttribute('fill', '#0284c7');
          dot.setAttribute('stroke', '#ffffff');
          dot.setAttribute('stroke-width', '1.5');
          g.appendChild(dot);

          // Small side hint
          const hint = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          let tx = p.x;
          let ty = p.y;
          if (p.side === 'top') ty -= 11;
          else if (p.side === 'bottom') ty += 16;
          else if (p.side === 'left') { tx -= 14; ty += 3; }
          else if (p.side === 'right') { tx += 14; ty += 3; }

          hint.setAttribute('x', tx);
          hint.setAttribute('y', ty);
          hint.setAttribute('text-anchor', 'middle');
          hint.setAttribute('font-size', '8');
          hint.setAttribute('font-weight', '600');
          hint.setAttribute('fill', '#38bdf8');
          hint.textContent = p.side.toUpperCase();
          g.appendChild(hint);
        }

        this.previewLayer.appendChild(g);
      }
    }
  }

  spawnElementAtCenter(type) {
    const rect = this.workspace.getBoundingClientRect();
    const centerWorld = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const snapped = this.snapPoint(centerWorld);

    this._pushHistory();
    const themeStroke = getDefaultThemeStrokeColor();
    const themeFill = getDefaultThemeFillColor();

    const newEl = createElement(
      type,
      snapped.x - 50,
      snapped.y - 35,
      themeStroke,
      themeFill
    );
    newEl.strokeWidth = this.defaultStrokeWidth;
    newEl.strokeStyle = this.defaultStrokeStyle;

    this.elements.push(newEl);
    this.render();
    this.selectElement(newEl.id);
    this.setActiveTool(SHAPE_TYPES.SELECT);
    this.onChange();
    return newEl;
  }

  // ==========================================
  // Events Binding
  // ==========================================
  _bindEvents() {
    // Wheel Zoom
    this.workspace.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    // Mouse Down
    this.workspace.addEventListener('mousedown', (e) => this._handleMouseDown(e));

    // Mouse Move
    window.addEventListener('mousemove', (e) => this._handleMouseMove(e));

    // Mouse Up
    window.addEventListener('mouseup', (e) => this._handleMouseUp(e));

    // Double Click (for polyline termination or text edit)
    this.workspace.addEventListener('dblclick', (e) => this._handleDblClick(e));

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => this._handleKeyDown(e));
    window.addEventListener('keyup', (e) => this._handleKeyUp(e));
  }

  _handleMouseDown(e) {
    // 1. Middle mouse click OR Space key pressed OR Pan tool active -> Start Pan
    if (e.button === 1 || this.isSpacePressed || this.activeTool === SHAPE_TYPES.PAN) {
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      this.workspace.classList.add('is-panning');
      e.preventDefault();
      return;
    }

    // Only left click for drawing and selecting
    if (e.button !== 0) return;

    const world = this.screenToWorld(e.clientX, e.clientY);
    const snapped = this.snapPoint(world);

    // 2. Select Tool
    if (this.activeTool === SHAPE_TYPES.SELECT) {
      // Check handles first!
      const hitHandle = this._hitTestHandle(world);
      if (hitHandle) {
        this._pushHistory();
        if (hitHandle.type === 'rotate') {
          this.isRotating = true;
          this.rotateCx = hitHandle.cx;
          this.rotateCy = hitHandle.cy;
          return;
        }
        if (hitHandle.type === 'resize') {
          this.isResizing = true;
          this.activeHandleType = 'resize';
          this.activeHandleKey = hitHandle.key;
          this.resizeStartWorld = world;
          const el = this.getElementById(this.selectedId);
          this.resizeInitialEl = {
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            rotation: el.rotation || 0
          };
          this.attachedCables = this._findAttachedCables(el);
          return;
        }
        if (hitHandle.type === 'point') {
          this.isResizing = true;
          this.activeHandleType = 'point';
          this.activePointIndex = hitHandle.index;
          return;
        }
      }

      const targetElement = this._hitTest(world);
      if (targetElement) {
        this.selectElement(targetElement.id);
        this.isDraggingElement = true;
        this.dragStartWorld = world;
        this.elementInitialPos = {
          x: targetElement.x,
          y: targetElement.y,
          points: targetElement.points ? JSON.parse(JSON.stringify(targetElement.points)) : null
        };
        this.attachedCables = this._findAttachedCables(targetElement);
      } else {
        this.selectElement(null);
      }
      return;
    }

    // 3. Polyline Drawing Tool (Click point-by-point)
    if (this.activeTool === SHAPE_TYPES.POLYLINE) {
      if (this.polylinePoints.length === 0) {
        this._pushHistory();
        this.polylinePoints = [snapped, { ...snapped }];
        this.isDrawing = true;
      } else {
        // Add point
        this.polylinePoints[this.polylinePoints.length - 1] = snapped;
        this.polylinePoints.push({ ...snapped });
      }
      this._renderPolylinePreview();
      return;
    }

    // 4. Line / Orthogonal Wiring Tool
    if (this.activeTool === SHAPE_TYPES.LINE || this.activeTool === SHAPE_TYPES.ORTHOGONAL) {
      const hitEl = this._hitTest(world);
      const nearest = this._findNearestPort(world);

      // Mode A: Second click in 2-click mode (Finalize connection!)
      if (this.wireIsClickMode && this.drawingElement) {
        // If clicked on a second device, connect best port pair automatically!
        if (hitEl && this.wireStartEl && hitEl.id !== this.wireStartEl.id && isConnectableDevice(hitEl) && isConnectableDevice(this.wireStartEl)) {
          const best = getBestPortPair(this.wireStartEl, hitEl);
          if (best) {
            this.drawingElement.points = [
              { x: best.p1.x, y: best.p1.y },
              { x: best.p2.x, y: best.p2.y }
            ];
            this._finishWiring(
              { elementId: this.wireStartEl.id, side: best.p1.side },
              { elementId: hitEl.id, side: best.p2.side }
            );
            return;
          }
        }

        const endPt = nearest ? { x: nearest.port.x, y: nearest.port.y } : snapped;
        this.drawingElement.points[1] = endPt;
        const startBinding = this.wireStartEl ? { elementId: this.wireStartEl.id, side: this.wireStartSide || null } : null;
        const endBinding = nearest ? { elementId: nearest.element.id, side: nearest.port.side } : null;
        this._finishWiring(startBinding, endBinding);
        return;
      }

      // Mode B: First click (Start wiring)
      this._pushHistory();
      this.isDrawing = true;
      this.wireMouseDownPos = { x: e.clientX, y: e.clientY };
      this.wireStartEl = (hitEl && isConnectableDevice(hitEl)) ? hitEl : (nearest ? nearest.element : null);

      let startPt = nearest ? { x: nearest.port.x, y: nearest.port.y } : snapped;
      let startSide = nearest ? nearest.port.side : null;

      // If clicked inside a device without pinpointing exact port, pick closest port to click
      if (!nearest && this.wireStartEl) {
        const ports = getConnectionPorts(this.wireStartEl);
        if (ports.length > 0) {
          let minD = Infinity;
          for (const p of ports) {
            const d = Math.hypot(world.x - p.x, world.y - p.y);
            if (d < minD) { minD = d; startPt = { x: p.x, y: p.y }; startSide = p.side; }
          }
        }
      }

      this.wireStartSide = startSide;
      this.wireStartPt = startPt;
      this.drawingElement = createElement(
        this.activeTool,
        startPt.x,
        startPt.y,
        this.defaultStroke,
        this.defaultFill
      );
      this.drawingElement.strokeWidth = this.defaultStrokeWidth;
      this.drawingElement.strokeStyle = this.defaultStrokeStyle;
      this.drawingElement.points = [startPt, { ...startPt }];
      return;
    }

    // 5. Place Shapes, Devices, Architectural items on canvas click
    this._pushHistory();
    let placePt = snapped;
    const isArch = [SHAPE_TYPES.DOOR, SHAPE_TYPES.SLIDING_DOOR, SHAPE_TYPES.WINDOW, SHAPE_TYPES.PILLAR].includes(this.activeTool);
    if (isArch) {
      placePt = this._snapToExistingLines(world, 18);
    }

    const newEl = createElement(
      this.activeTool,
      placePt.x,
      placePt.y,
      this.defaultStroke,
      this.defaultFill
    );
    newEl.strokeWidth = this.defaultStrokeWidth;
    newEl.strokeStyle = this.defaultStrokeStyle;

    this.elements.push(newEl);
    this.render();
    this.selectElement(newEl.id);
    this.onChange();

    // Reset tool to select after placing shape
    this.setActiveTool(SHAPE_TYPES.SELECT);
  }

  _handleMouseMove(e) {
    // 1. Panning
    if (this.isPanning) {
      this.panX = e.clientX - this.panStartX;
      this.panY = e.clientY - this.panStartY;
      this.applyTransform();
      return;
    }

    const world = this.screenToWorld(e.clientX, e.clientY);
    const snapped = this.snapPoint(world);

    // Update Coordinate Status Bar
    this.onCoordinatesChange(Math.round(world.x), Math.round(world.y));

    // 2. Rotating Element
    if (this.isRotating && this.selectedId) {
      const el = this.getElementById(this.selectedId);
      if (el) {
        const cx = this.rotateCx;
        const cy = this.rotateCy;
        const angleRad = Math.atan2(world.y - cy, world.x - cx);
        let deg = (angleRad * 180 / Math.PI) + 90;
        if (deg < 0) deg += 360;
        deg = deg % 360;

        if (this.gridSnap || e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }

        el.rotation = Math.round(deg) % 360;
        this.render();
        this._updateSelectionHighlight();
        this.onSelectionChange(el);
      }
      return;
    }

    // 3. Resizing Element
    if (this.isResizing && this.selectedId) {
      const el = this.getElementById(this.selectedId);
      if (!el) return;

      if (this.activeHandleType === 'point') {
        const nearest = this._findNearestPort(world, 24);
        let targetPt = snapped;
        if (nearest) {
          targetPt = { x: nearest.port.x, y: nearest.port.y };
          this._activeSnapPort = nearest;
        } else {
          this._activeSnapPort = null;
        }
        el.points[this.activePointIndex] = targetPt;
        this.render();
        this._updateSelectionHighlight();
        if (this._activeSnapPort) {
          this._renderPortHighlights(this._activeSnapPort.port, true);
        } else if (this.previewLayer) {
          this.previewLayer.innerHTML = '';
        }
        return;
      }

      const rot = (this.resizeInitialEl.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);

      const rawDx = world.x - this.resizeStartWorld.x;
      const rawDy = world.y - this.resizeStartWorld.y;

      const localDx = rawDx * cos - rawDy * sin;
      const localDy = rawDx * sin + rawDy * cos;

      const initX = this.resizeInitialEl.x;
      const initY = this.resizeInitialEl.y;
      const initW = this.resizeInitialEl.width;
      const initH = this.resizeInitialEl.height;

      let newX = initX;
      let newY = initY;
      let newW = initW;
      let newH = initH;

      const minSize = 20;

      const anchorRatios = {
        'se': { x: 0,   y: 0 },
        'e':  { x: 0,   y: 0.5 },
        's':  { x: 0.5, y: 0 },
        'ne': { x: 0,   y: 1 },
        'nw': { x: 1,   y: 1 },
        'n':  { x: 0.5, y: 1 },
        'sw': { x: 1,   y: 0 },
        'w':  { x: 1,   y: 0.5 }
      };

      switch (this.activeHandleKey) {
        case 'se':
          newW = Math.max(minSize, initW + localDx);
          newH = Math.max(minSize, initH + localDy);
          break;
        case 'e':
          newW = Math.max(minSize, initW + localDx);
          break;
        case 's':
          newH = Math.max(minSize, initH + localDy);
          break;
        case 'ne':
          newW = Math.max(minSize, initW + localDx);
          newH = Math.max(minSize, initH - localDy);
          break;
        case 'nw':
          newW = Math.max(minSize, initW - localDx);
          newH = Math.max(minSize, initH - localDy);
          break;
        case 'n':
          newH = Math.max(minSize, initH - localDy);
          break;
        case 'sw':
          newW = Math.max(minSize, initW - localDx);
          newH = Math.max(minSize, initH + localDy);
          break;
        case 'w':
          newW = Math.max(minSize, initW - localDx);
          break;
      }

      if (this.gridSnap) {
        newW = Math.max(minSize, Math.round(newW / this.gridSize) * this.gridSize);
        newH = Math.max(minSize, Math.round(newH / this.gridSize) * this.gridSize);
      }

      // Calculate anchor point that remains completely stationary in world space
      const ratio = anchorRatios[this.activeHandleKey] || { x: 0.5, y: 0.5 };
      const initCx = initX + initW / 2;
      const initCy = initY + initH / 2;
      const localAnchorX = initX + ratio.x * initW;
      const localAnchorY = initY + ratio.y * initH;

      const fixedWorldX = initCx + (localAnchorX - initCx) * cos - (localAnchorY - initCy) * sin;
      const fixedWorldY = initCy + (localAnchorX - initCx) * sin + (localAnchorY - initCy) * cos;

      const relX = ratio.x * newW - newW / 2;
      const relY = ratio.y * newH - newH / 2;
      const rotRelX = relX * cos - relY * sin;
      const rotRelY = relX * sin + relY * cos;

      const newCenterWorldX = fixedWorldX - rotRelX;
      const newCenterWorldY = fixedWorldY - rotRelY;

      el.x = Math.round(newCenterWorldX - newW / 2);
      el.y = Math.round(newCenterWorldY - newH / 2);
      el.width = Math.round(newW);
      el.height = Math.round(newH);

      // Follow attached cable endpoints to new port locations during resize
      if (this.attachedCables && this.attachedCables.length > 0) {
        const newPorts = getConnectionPorts(el);
        const portMap = {};
        newPorts.forEach(p => { portMap[p.side] = p; });

        this.attachedCables.forEach(att => {
          if (att.cable && att.cable.points && att.cable.points[att.pointIndex]) {
            if (att.side && portMap[att.side]) {
              att.cable.points[att.pointIndex].x = portMap[att.side].x;
              att.cable.points[att.pointIndex].y = portMap[att.side].y;
            }
          }
        });
      }

      this.render();
      this._updateSelectionHighlight();
      this.onSelectionChange(el);
      return;
    }

    // 4. Dragging Element
    if (this.isDraggingElement && this.selectedId) {
      const el = this.getElementById(this.selectedId);
      if (el && this.elementInitialPos) {
        let dx = snapped.x - this.snap(this.dragStartWorld.x);
        let dy = snapped.y - this.snap(this.dragStartWorld.y);

        // 建築アイテム（扉・引き戸・窓・柱）の場合は、自由パスや壁の線分への吸着スナップ
        const isArch = [SHAPE_TYPES.DOOR, SHAPE_TYPES.SLIDING_DOOR, SHAPE_TYPES.WINDOW, SHAPE_TYPES.PILLAR].includes(el.type);
        if (isArch && !el.points) {
          const rawTargetPt = { x: this.elementInitialPos.x + dx, y: this.elementInitialPos.y + dy };
          const snappedArchPt = this._snapToExistingLines(rawTargetPt, 16);
          dx = snappedArchPt.x - this.elementInitialPos.x;
          dy = snappedArchPt.y - this.elementInitialPos.y;
        }

        if (el.points) {
          el.points = this.elementInitialPos.points.map(p => ({
            x: p.x + dx,
            y: p.y + dy
          }));
        } else {
          el.x = this.elementInitialPos.x + dx;
          el.y = this.elementInitialPos.y + dy;

          // 接続されているLANケーブルの端点を自動追従（ポート位置に正確に追従）
          if (this.attachedCables && this.attachedCables.length > 0) {
            const currentPorts = getConnectionPorts(el);
            const currentPortMap = {};
            currentPorts.forEach(p => { currentPortMap[p.side] = p; });

            this.attachedCables.forEach(att => {
              if (att.cable && att.cable.points && att.cable.points[att.pointIndex]) {
                if (att.side && currentPortMap[att.side]) {
                  att.cable.points[att.pointIndex].x = currentPortMap[att.side].x;
                  att.cable.points[att.pointIndex].y = currentPortMap[att.side].y;
                } else {
                  att.cable.points[att.pointIndex].x = att.initialPoint.x + dx;
                  att.cable.points[att.pointIndex].y = att.initialPoint.y + dy;
                }
              }
            });
          }
        }

        this.render();
        this._updateSelectionHighlight();
      }
      return;
    }

    // 5. Line / Orthogonal Wiring in progress
    if (this.isDrawing && this.drawingElement) {
      const hitEl = this._hitTest(world);
      const nearest = this._findNearestPort(world);

      // Auto port calculation when hovering over target device
      if (hitEl && this.wireStartEl && hitEl.id !== this.wireStartEl.id && (!hitEl.points || hitEl.points.length === 0)) {
        const best = getBestPortPair(this.wireStartEl, hitEl);
        if (best) {
          this.drawingElement.points[0] = { x: best.p1.x, y: best.p1.y };
          this.drawingElement.points[1] = { x: best.p2.x, y: best.p2.y };
          this._renderDrawingPreview(this.drawingElement);
          this._renderPortHighlights(best.p2);
          return;
        }
      }

      if (this.wireStartPt) {
        this.drawingElement.points[0] = { ...this.wireStartPt };
      }
      this.drawingElement.points[1] = nearest ? { x: nearest.port.x, y: nearest.port.y } : snapped;
      this._renderDrawingPreview(this.drawingElement);
      this._renderPortHighlights(nearest ? nearest.port : null);
      return;
    }

    // 6. Polyline In-Progress dynamic rubber-band
    if (this.isDrawing && this.activeTool === SHAPE_TYPES.POLYLINE && this.polylinePoints.length > 1) {
      this.polylinePoints[this.polylinePoints.length - 1] = snapped;
      this._renderPolylinePreview();
      return;
    }

    // 7. Hover cursor and hover port highlights in Select Mode
    if (this.activeTool === SHAPE_TYPES.SELECT) {
      const handle = this._hitTestHandle(world);
      if (handle) {
        this.workspace.style.cursor = handle.type === 'rotate' ? 'crosshair' : (handle.key ? `${handle.key}-resize` : 'crosshair');
      } else {
        const hit = this._hitTest(world);
        this.workspace.style.cursor = hit ? 'move' : 'default';
      }
    }
  }

  _handleMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.workspace.classList.remove('is-panning');
      return;
    }

    // 1. Finish Rotate
    if (this.isRotating) {
      this.isRotating = false;
      this.onChange();
      return;
    }

    // 2. Finish Resize / Point Drag
    if (this.isResizing) {
      if (this.activeHandleType === 'point' && this.selectedId) {
        const el = this.getElementById(this.selectedId);
        if (el && el.points && this.activePointIndex >= 0) {
          if (this._activeSnapPort) {
            const b = { elementId: this._activeSnapPort.element.id, side: this._activeSnapPort.port.side };
            if (this.activePointIndex === 0) el.startBinding = b;
            else if (this.activePointIndex === 1) el.endBinding = b;
            el.points[this.activePointIndex] = { x: this._activeSnapPort.port.x, y: this._activeSnapPort.port.y };
          } else {
            // ポートから離れた場所にドロップされたので、バインディングを解除
            if (this.activePointIndex === 0) el.startBinding = null;
            else if (this.activePointIndex === 1) el.endBinding = null;
          }
        }
        this._activeSnapPort = null;
        if (this.previewLayer) this.previewLayer.innerHTML = '';
        this.render();
      }

      this.isResizing = false;
      this.activeHandleKey = null;
      this.activeHandleType = null;
      this.activePointIndex = -1;
      this.resizeInitialEl = null;
      this.attachedCables = [];
      this.onChange();
      return;
    }

    // 4. Finish Dragging Element
    if (this.isDraggingElement) {
      this.isDraggingElement = false;
      this.attachedCables = [];
      this.onChange();
      return;
    }

    // 5. Finish Line / Orthogonal
    if (this.isDrawing && this.drawingElement) {
      const mouseDist = this.wireMouseDownPos ? Math.hypot(e.clientX - this.wireMouseDownPos.x, e.clientY - this.wireMouseDownPos.y) : 0;
      
      // If user merely clicked (< 8px movement), stay in 2-click mode waiting for second click!
      if (mouseDist < 8) {
        this.wireIsClickMode = true;
        return;
      }

      // Dragged to destination -> complete the cable!
      const world = this.screenToWorld(e.clientX, e.clientY);
      const snapped = this.snapPoint(world);
      const hitEl = this._hitTest(world);
      const nearest = this._findNearestPort(world);

      if (hitEl && this.wireStartEl && hitEl.id !== this.wireStartEl.id && isConnectableDevice(hitEl) && isConnectableDevice(this.wireStartEl)) {
        const best = getBestPortPair(this.wireStartEl, hitEl);
        if (best) {
          this.drawingElement.points = [
            { x: best.p1.x, y: best.p1.y },
            { x: best.p2.x, y: best.p2.y }
          ];
          this._finishWiring(
            { elementId: this.wireStartEl.id, side: best.p1.side },
            { elementId: hitEl.id, side: best.p2.side }
          );
          return;
        }
      }

      const endPt = nearest ? { x: nearest.port.x, y: nearest.port.y } : snapped;
      this.drawingElement.points[1] = endPt;
      const startBinding = this.wireStartEl ? { elementId: this.wireStartEl.id, side: this.wireStartSide || null } : null;
      const endBinding = nearest ? { elementId: nearest.element.id, side: nearest.port.side } : null;
      this._finishWiring(startBinding, endBinding);
    }
  }

  _handleDblClick(e) {
    if (this.activeTool === SHAPE_TYPES.POLYLINE && this.polylinePoints.length > 1) {
      this._commitPolyline();
      return;
    }

    // Double click element
    const world = this.screenToWorld(e.clientX, e.clientY);
    const target = this._hitTest(world);
    if (target && target.type === SHAPE_TYPES.TEXT) {
      const newText = prompt('テキストを入力してください:', target.text);
      if (newText !== null) {
        this._pushHistory();
        target.text = newText;
        this.render();
        this.onChange();
      }
    }
  }

  _handleKeyDown(e) {
    // Space for Pan Hand
    if (e.code === 'Space' && !this.isSpacePressed && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      this.isSpacePressed = true;
      this.workspace.classList.add('is-pan-tool');
      e.preventDefault();
    }

    // Delete / Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        this.deleteSelected();
        e.preventDefault();
      }
    }

    // ESC to cancel drawing / switch to select
    if (e.key === 'Escape') {
      if (this.activeTool === SHAPE_TYPES.POLYLINE && this.polylinePoints.length > 1) {
        this._commitPolyline();
      } else {
        this._cancelDrawing();
        this.setActiveTool(SHAPE_TYPES.SELECT);
        this.selectElement(null);
      }
    }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      this.redo();
      e.preventDefault();
    }
  }

  _handleKeyUp(e) {
    if (e.code === 'Space') {
      this.isSpacePressed = false;
      if (this.activeTool !== SHAPE_TYPES.PAN) {
        this.workspace.classList.remove('is-pan-tool');
      }
    }
  }

  // ==========================================
  // Polyline & Preview Helpers
  // ==========================================
  _renderDrawingPreview(el) {
    this.previewLayer.innerHTML = '';
    const svgNode = renderElementToSvg(el);
    svgNode.style.opacity = '0.75';
    this.previewLayer.appendChild(svgNode);
  }

  _renderPolylinePreview() {
    this.previewLayer.innerHTML = '';
    if (this.polylinePoints.length < 2) return;

    const tempEl = createElement(SHAPE_TYPES.POLYLINE, 0, 0, this.defaultStroke, this.defaultFill);
    tempEl.strokeWidth = this.defaultStrokeWidth;
    tempEl.strokeStyle = this.defaultStrokeStyle;
    tempEl.points = [...this.polylinePoints];

    const svgNode = renderElementToSvg(tempEl);
    svgNode.style.opacity = '0.8';
    this.previewLayer.appendChild(svgNode);
  }

  _commitPolyline() {
    if (this.polylinePoints.length > 1) {
      // Remove preview point at end
      const finalPoints = this.polylinePoints.slice(0, -1);
      if (finalPoints.length >= 2) {
        const poly = createElement(SHAPE_TYPES.POLYLINE, 0, 0, this.defaultStroke, this.defaultFill);
        poly.strokeWidth = this.defaultStrokeWidth;
        poly.strokeStyle = this.defaultStrokeStyle;
        poly.points = finalPoints;
        this.elements.push(poly);
        this.render();
        this.selectElement(poly.id);
        this.onChange();
      }
    }
    this.polylinePoints = [];
    this.isDrawing = false;
    this.previewLayer.innerHTML = '';
    this.setActiveTool(SHAPE_TYPES.SELECT);
  }

  _cancelDrawing() {
    this.isDrawing = false;
    this.drawingElement = null;
    this.polylinePoints = [];
    this.wireStartEl = null;
    this.wireStartPt = null;
    this.wireIsClickMode = false;
    this.wireMouseDownPos = null;
    if (this.previewLayer) {
      this.previewLayer.innerHTML = '';
    }
  }

  _finishWiring(startBinding = null, endBinding = null) {
    this.isDrawing = false;
    this.wireIsClickMode = false;
    this.wireStartEl = null;
    this.wireStartPt = null;
    this.wireMouseDownPos = null;
    if (this.previewLayer) {
      this.previewLayer.innerHTML = '';
    }

    if (this.drawingElement) {
      this.drawingElement.startBinding = startBinding;
      this.drawingElement.endBinding = endBinding;
      this.elements.push(this.drawingElement);
      const placedId = this.drawingElement.id;
      this.drawingElement = null;
      this.render();
      this.selectElement(placedId);
      this.onChange();
      this.setActiveTool(SHAPE_TYPES.SELECT);
    }
  }

  spawnCableAtCenter(type = SHAPE_TYPES.ORTHOGONAL) {
    const rect = this.workspace.getBoundingClientRect();
    const centerWorld = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const snapped = this.snapPoint(centerWorld);

    this._pushHistory();
    const cable = createElement(
      type,
      snapped.x - 70,
      snapped.y - 25,
      '#0284c7',
      'none'
    );
    cable.strokeWidth = 2.5;
    cable.points = [
      { x: snapped.x - 70, y: snapped.y - 25 },
      { x: snapped.x + 70, y: snapped.y + 25 }
    ];
    this.elements.push(cable);
    this.render();
    this.selectElement(cable.id);
    this.setActiveTool(SHAPE_TYPES.SELECT);
    this.onChange();
    return cable;
  }

  // ==========================================
  // Selection & Hit Testing
  // ==========================================
  selectElement(id) {
    this.selectedId = id;
    if (this.elementsLayer) {
      this.elementsLayer.querySelectorAll('.canvas-element').forEach(n => {
        n.classList.toggle('selected', n.getAttribute('data-id') === id);
      });
    }
    this._updateSelectionHighlight();
    const el = this.getElementById(id);
    this.onSelectionChange(el);
  }

  deleteSelected() {
    if (!this.selectedId) return;
    this._pushHistory();
    this.elements = this.elements.filter(el => el.id !== this.selectedId);
    this.selectElement(null);
    this.render();
    this.onChange();
  }

  bringToFront() {
    if (!this.selectedId) return;
    const idx = this.elements.findIndex(el => el.id === this.selectedId);
    if (idx !== -1 && idx < this.elements.length - 1) {
      this._pushHistory();
      const el = this.elements.splice(idx, 1)[0];
      this.elements.push(el);
      this.render();
      this._updateSelectionHighlight();
      this.onChange();
    }
  }

  sendToBack() {
    if (!this.selectedId) return;
    const idx = this.elements.findIndex(el => el.id === this.selectedId);
    if (idx > 0) {
      this._pushHistory();
      const el = this.elements.splice(idx, 1)[0];
      this.elements.unshift(el);
      this.render();
      this._updateSelectionHighlight();
      this.onChange();
    }
  }

  _updateSelectionHighlight() {
    this.selectionLayer.innerHTML = '';
    if (!this.selectedId) return;

    const el = this.getElementById(this.selectedId);
    if (!el) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'canvas-selection-group');

    // For point-based elements (wires, lines)
    if (el.points && el.points.length > 0) {
      el.points.forEach((pt, idx) => {
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('cx', pt.x);
        handle.setAttribute('cy', pt.y);
        handle.setAttribute('r', 6);
        handle.setAttribute('class', 'canvas-handle');
        handle.setAttribute('data-handle-type', 'point');
        handle.setAttribute('data-point-index', idx);
        g.appendChild(handle);
      });
      this.selectionLayer.appendChild(g);
      return;
    }

    // For box-based elements
    const x = el.x;
    const y = el.y;
    const w = el.width || 100;
    const h = el.height || 60;
    const pad = 5;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (el.rotation) {
      g.setAttribute('transform', `rotate(${el.rotation} ${cx} ${cy})`);
    }

    // Dashed Bounding Box
    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', x - pad);
    box.setAttribute('y', y - pad);
    box.setAttribute('width', w + pad * 2);
    box.setAttribute('height', h + pad * 2);
    box.setAttribute('class', 'canvas-selection-box');
    g.appendChild(box);

    // Connecting line to rotate handle
    const rotateLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rotateLine.setAttribute('x1', cx);
    rotateLine.setAttribute('y1', y - pad);
    rotateLine.setAttribute('x2', cx);
    rotateLine.setAttribute('y2', y - pad - 22);
    rotateLine.setAttribute('stroke', 'var(--accent-primary, #38bdf8)');
    rotateLine.setAttribute('stroke-width', '1.5');
    rotateLine.setAttribute('stroke-dasharray', '2 2');
    g.appendChild(rotateLine);

    // Rotate Handle (Round circle on top)
    const rotateHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotateHandle.setAttribute('cx', cx);
    rotateHandle.setAttribute('cy', y - pad - 22);
    rotateHandle.setAttribute('r', 6);
    rotateHandle.setAttribute('class', 'canvas-rotate-handle');
    rotateHandle.setAttribute('data-handle-type', 'rotate');
    rotateHandle.setAttribute('title', 'ドラッグで回転 (Shiftキーで15度刻み)');
    g.appendChild(rotateHandle);

    // 8 Resize Handles
    const handles = [
      { key: 'nw', x: x - pad, y: y - pad, cursor: 'nwse-resize' },
      { key: 'n',  x: cx, y: y - pad, cursor: 'ns-resize' },
      { key: 'ne', x: x + w + pad, y: y - pad, cursor: 'nesw-resize' },
      { key: 'e',  x: x + w + pad, y: cy, cursor: 'ew-resize' },
      { key: 'se', x: x + w + pad, y: y + h + pad, cursor: 'nwse-resize' },
      { key: 's',  x: cx, y: y + h + pad, cursor: 'ns-resize' },
      { key: 'sw', x: x - pad, y: y + h + pad, cursor: 'nesw-resize' },
      { key: 'w',  x: x - pad, y: cy, cursor: 'ew-resize' }
    ];

    handles.forEach(hd => {
      const hNode = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hNode.setAttribute('x', hd.x - 4.5);
      hNode.setAttribute('y', hd.y - 4.5);
      hNode.setAttribute('width', 9);
      hNode.setAttribute('height', 9);
      hNode.setAttribute('class', 'canvas-handle');
      hNode.setAttribute('data-handle-type', 'resize');
      hNode.setAttribute('data-handle-key', hd.key);
      hNode.style.cursor = hd.cursor;
      g.appendChild(hNode);
    });

    // 4 Connection Ports (Top, Right, Bottom, Left) on selected element
    const selectionPorts = [
      { side: '上ポート', x: cx, y },
      { side: '右ポート', x: x + w, y: cy },
      { side: '下ポート', x: cx, y: y + h },
      { side: '左ポート', x, y: cy }
    ];

    selectionPorts.forEach(p => {
      const portDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      portDot.setAttribute('cx', p.x);
      portDot.setAttribute('cy', p.y);
      portDot.setAttribute('r', '5');
      portDot.setAttribute('class', 'canvas-selection-port-dot');
      portDot.setAttribute('fill', '#0284c7');
      portDot.setAttribute('stroke', '#ffffff');
      portDot.setAttribute('stroke-width', '1.5');
      portDot.setAttribute('title', `LAN接続ポート: ${p.side}`);
      g.appendChild(portDot);
    });

    this.selectionLayer.appendChild(g);
  }

  _hitTestHandle(world) {
    if (!this.selectedId) return null;
    const el = this.getElementById(this.selectedId);
    if (!el) return null;

    // Point-based elements (wires)
    if (el.points && el.points.length > 0) {
      for (let i = 0; i < el.points.length; i++) {
        const pt = el.points[i];
        const dist = Math.hypot(world.x - pt.x, world.y - pt.y);
        if (dist <= 12) {
          return { type: 'point', index: i };
        }
      }
      return null;
    }

    const x = el.x;
    const y = el.y;
    const w = el.width || 100;
    const h = el.height || 60;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pad = 5;

    // Transform world point into element's local coordinate space
    const rot = (el.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const dx = world.x - cx;
    const dy = world.y - cy;
    const localX = cx + (dx * cos - dy * sin);
    const localY = cy + (dx * sin + dy * cos);

    // Check Rotate Handle (cx, y - pad - 22)
    const rotHandleDist = Math.hypot(localX - cx, localY - (y - pad - 22));
    if (rotHandleDist <= 14) {
      return { type: 'rotate', cx, cy };
    }

    // Check 8 Resize Handles
    const handlePositions = {
      nw: { x: x - pad, y: y - pad },
      n:  { x: cx, y: y - pad },
      ne: { x: x + w + pad, y: y - pad },
      e:  { x: x + w + pad, y: cy },
      se: { x: x + w + pad, y: y + h + pad },
      s:  { x: cx, y: y + h + pad },
      sw: { x: x - pad, y: y + h + pad },
      w:  { x: x - pad, y: cy }
    };

    for (const [key, pos] of Object.entries(handlePositions)) {
      if (Math.abs(localX - pos.x) <= 10 && Math.abs(localY - pos.y) <= 10) {
        return { type: 'resize', key, cx, cy };
      }
    }

    return null;
  }

  _distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  _projectPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return { x: x1, y: y1, distance: Math.hypot(px - x1, py - y1) };
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return { x: projX, y: projY, distance: Math.hypot(px - projX, py - projY) };
  }

  _findAttachedCables(targetEl) {
    if (!targetEl || targetEl.points) return [];
    
    // 背景図形（四角形、円、テキスト、壁など）はLAN追従対象外（問題3完全解決！）
    if (!isConnectableDevice(targetEl)) return [];

    const ports = getConnectionPorts(targetEl);
    const portMap = {};
    ports.forEach(p => { portMap[p.side] = p; });

    const attached = [];

    for (const el of this.elements) {
      if (el.id === targetEl.id) continue;
      if (el.type !== SHAPE_TYPES.LINE && el.type !== SHAPE_TYPES.ORTHOGONAL) continue;
      if (!el.points || el.points.length < 2) continue;

      // 1. 明示的なバインディング（startBinding / endBinding）を最優先チェック！
      if (el.startBinding && el.startBinding.elementId === targetEl.id) {
        attached.push({
          cable: el,
          pointIndex: 0,
          initialPoint: { ...el.points[0] },
          side: el.startBinding.side
        });
      }
      if (el.endBinding && el.endBinding.elementId === targetEl.id) {
        attached.push({
          cable: el,
          pointIndex: 1,
          initialPoint: { ...el.points[1] },
          side: el.endBinding.side
        });
      }

      // 既にバインドされている端点はフォールバックチェックをスキップ
      const hasBoundPt0 = attached.some(a => a.cable.id === el.id && a.pointIndex === 0);
      const hasBoundPt1 = attached.some(a => a.cable.id === el.id && a.pointIndex === 1);

      // 2. 過去のデータ等のためのフォールバック（デバイス型要素のみ、かつ厳密なポート近接8px以内のみ！）
      [0, 1].forEach(ptIdx => {
        if (ptIdx === 0 && hasBoundPt0) return;
        if (ptIdx === 1 && hasBoundPt1) return;

        const pt = el.points[ptIdx];
        if (!pt) return;

        for (const p of ports) {
          const d = Math.hypot(pt.x - p.x, pt.y - p.y);
          if (d <= 8) {
            // バインディングを自動補正・保存
            if (ptIdx === 0) el.startBinding = { elementId: targetEl.id, side: p.side };
            if (ptIdx === 1) el.endBinding = { elementId: targetEl.id, side: p.side };
            attached.push({
              cable: el,
              pointIndex: ptIdx,
              initialPoint: { x: pt.x, y: pt.y },
              side: p.side
            });
            break;
          }
        }
      });
    }
    return attached;
  }

  _snapToExistingLines(pt, threshold = 14) {
    let nearestPt = null;
    let minD = threshold;

    for (const el of this.elements) {
      if (el.id === this.selectedId) continue;

      if (el.type === SHAPE_TYPES.POLYLINE && el.points && el.points.length > 1) {
        for (const v of el.points) {
          const d = Math.hypot(pt.x - v.x, pt.y - v.y);
          if (d < minD) {
            minD = d;
            nearestPt = { x: v.x, y: v.y };
          }
        }
        for (let i = 0; i < el.points.length - 1; i++) {
          const p1 = el.points[i];
          const p2 = el.points[i + 1];
          const proj = this._projectPointOnSegment(pt.x, pt.y, p1.x, p1.y, p2.x, p2.y);
          if (proj.distance < minD) {
            minD = proj.distance;
            nearestPt = { x: proj.x, y: proj.y };
          }
        }
      } else if (el.type === SHAPE_TYPES.WALL) {
        const segments = [
          { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y },
          { x1: el.x, y1: el.y + el.height, x2: el.x + el.width, y2: el.y + el.height },
          { x1: el.x, y1: el.y, x2: el.x, y2: el.y + el.height },
          { x1: el.x + el.width, y1: el.y, x2: el.x + el.width, y2: el.y + el.height }
        ];
        for (const s of segments) {
          const proj = this._projectPointOnSegment(pt.x, pt.y, s.x1, s.y1, s.x2, s.y2);
          if (proj.distance < minD) {
            minD = proj.distance;
            nearestPt = { x: proj.x, y: proj.y };
          }
        }
      }
    }

    return nearestPt || pt;
  }

  _hitTest(worldPt) {
    // Iterate elements in reverse (top-most element first)
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];

      // Points-based elements (Polyline, Line, Orthogonal)
      if (el.points && el.points.length > 0) {
        const threshold = Math.max(8, (el.strokeWidth || 2) + 6);

        if (el.type === SHAPE_TYPES.ORTHOGONAL && el.points.length >= 2) {
          const p1 = el.points[0];
          const p2 = el.points[1];
          const midX = (p1.x + p2.x) / 2;
          const d1 = this._distanceToSegment(worldPt.x, worldPt.y, p1.x, p1.y, midX, p1.y);
          const d2 = this._distanceToSegment(worldPt.x, worldPt.y, midX, p1.y, midX, p2.y);
          const d3 = this._distanceToSegment(worldPt.x, worldPt.y, midX, p2.y, p2.x, p2.y);
          if (Math.min(d1, d2, d3) <= threshold) {
            return el;
          }
          continue;
        }

        // Polyline and Line: check distance to each line segment
        let hit = false;
        for (let j = 0; j < el.points.length - 1; j++) {
          const p1 = el.points[j];
          const p2 = el.points[j + 1];
          const d = this._distanceToSegment(worldPt.x, worldPt.y, p1.x, p1.y, p2.x, p2.y);
          if (d <= threshold) {
            hit = true;
            break;
          }
        }
        if (hit) return el;

        // If single point polyline
        if (el.points.length === 1) {
          if (Math.hypot(worldPt.x - el.points[0].x, worldPt.y - el.points[0].y) <= threshold) {
            return el;
          }
        }

        continue;
      }

      // Box-based elements (rect, devices, etc.)
      const x = el.x;
      const y = el.y;
      const w = el.width || 100;
      const h = el.height || 60;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const pad = 8;

      // Transform worldPt into local element space
      const rot = (el.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      const dx = worldPt.x - cx;
      const dy = worldPt.y - cy;
      const localX = cx + (dx * cos - dy * sin);
      const localY = cy + (dx * sin + dy * cos);

      if (
        localX >= x - pad &&
        localX <= x + w + pad &&
        localY >= y - pad &&
        localY <= y + h + pad
      ) {
        return el;
      }
    }
    return null;
  }

  rotateSelected(degrees) {
    if (!this.selectedId) return;
    const el = this.getElementById(this.selectedId);
    if (!el) return;
    this._pushHistory();
    el.rotation = ((el.rotation || 0) + degrees + 360) % 360;
    this.render();
    this._updateSelectionHighlight();
    this.onSelectionChange(el);
    this.onChange();
  }

  setRotation(deg) {
    if (!this.selectedId) return;
    const el = this.getElementById(this.selectedId);
    if (!el) return;
    this._pushHistory();
    el.rotation = (deg + 360) % 360;
    this.render();
    this._updateSelectionHighlight();
    this.onSelectionChange(el);
    this.onChange();
  }

  flipSelected(axis = 'horizontal') {
    if (!this.selectedId) return;
    const el = this.getElementById(this.selectedId);
    if (!el) return;
    this._pushHistory();
    if (axis === 'horizontal') {
      el.flipX = !el.flipX;
    } else {
      el.flipY = !el.flipY;
    }
    this.render();
    this._updateSelectionHighlight();
    this.onSelectionChange(el);
    this.onChange();
  }

  resizeSelected(w, h) {
    if (!this.selectedId) return;
    const el = this.getElementById(this.selectedId);
    if (!el) return;
    this._pushHistory();
    if (w !== undefined) el.width = Math.max(20, Math.round(w));
    if (h !== undefined) el.height = Math.max(20, Math.round(h));
    this.render();
    this._updateSelectionHighlight();
    this.onSelectionChange(el);
    this.onChange();
  }

  // ==========================================
  // History & Undo / Redo
  // ==========================================
  _pushHistory() {
    const snapshot = JSON.stringify(this.elements);
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const current = JSON.stringify(this.elements);
    this.redoStack.push(current);
    const prev = this.undoStack.pop();
    this.elements = JSON.parse(prev);
    this.selectElement(null);
    this.render();
    this.onChange();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const current = JSON.stringify(this.elements);
    this.undoStack.push(current);
    const next = this.redoStack.pop();
    this.elements = JSON.parse(next);
    this.selectElement(null);
    this.render();
    this.onChange();
  }

  // ==========================================
  // Public Accessors & Serializers
  // ==========================================
  getElementById(id) {
    return this.elements.find(el => el.id === id);
  }

  updateElementProperties(id, props) {
    const el = this.getElementById(id);
    if (!el) return;
    this._pushHistory();
    const oldAttached = this._findAttachedCables(el);
    Object.assign(el, props);

    if (('width' in props || 'height' in props || 'x' in props || 'y' in props) && oldAttached.length > 0) {
      const newPorts = getConnectionPorts(el);
      const portMap = {};
      newPorts.forEach(p => { portMap[p.side] = p; });
      oldAttached.forEach(att => {
        if (att.cable && att.cable.points && att.cable.points[att.pointIndex]) {
          if (att.side && portMap[att.side]) {
            att.cable.points[att.pointIndex].x = portMap[att.side].x;
            att.cable.points[att.pointIndex].y = portMap[att.side].y;
          }
        }
      });
    }

    this.render();
    this._updateSelectionHighlight();
    this.onChange();
  }

  render() {
    this.elementsLayer.innerHTML = '';
    this.elements.forEach(el => {
      const node = renderElementToSvg(el);
      if (this.selectedId && el.id === this.selectedId) {
        node.classList.add('selected');
      }
      this.elementsLayer.appendChild(node);
    });
    this._updateSelectionHighlight();
  }

  loadData(diagramData) {
    if (typeof diagramData === 'string') {
      try {
        diagramData = JSON.parse(diagramData);
      } catch (e) {
        diagramData = { elements: [] };
      }
    }
    const elems = (diagramData && Array.isArray(diagramData.elements)) ? diagramData.elements : [];
    this.elements = JSON.parse(JSON.stringify(elems));
    this.undoStack = [];
    this.redoStack = [];
    this.selectElement(null);
    this.resetZoom();
    this.render();
  }

  exportData(title = 'ネットワーク構成図') {
    return {
      version: '1.0',
      title,
      updatedAt: new Date().toISOString(),
      elements: JSON.parse(JSON.stringify(this.elements))
    };
  }

  exportStandaloneSvg() {
    // Calculate bounding box of all elements
    if (this.elements.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="50%" y="50%" text-anchor="middle" fill="#888">（空のキャンバス）</text></svg>`;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.elements.forEach(el => {
      const b = getElementBounds(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const pad = 30;
    const x = Math.floor(minX - pad);
    const y = Math.floor(minY - pad);
    const w = Math.ceil(maxX - minX + pad * 2);
    const h = Math.ceil(maxY - minY + pad * 2);

    // Deep clone elements layer
    const clone = this.elementsLayer.cloneNode(true);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" style="background-color: var(--bg-card, #1e222b); font-family: sans-serif;">\n${clone.innerHTML}\n</svg>`;
  }
}
