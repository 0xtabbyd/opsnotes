/**
 * OpsNotes Canvas - Modal Controller & UI Wireup
 */

import { CanvasEngine } from './canvasEngine.js';
import { SHAPE_TYPES, VLAN_PRESETS, getElementBounds } from './shapes.js';

let engine = null;
let currentSaveCallback = null;

export function initCanvasModal() {
  const modalOverlay = document.getElementById('canvasModalOverlay');
  const svg = document.getElementById('mainCanvasSvg');
  const workspace = document.getElementById('canvasWorkspace');
  if (!modalOverlay || !svg || !workspace) return;

  // Initialize Canvas Engine
  engine = new CanvasEngine(svg, workspace, {
    onSelectionChange: (el) => updateInspectorUI(el),
    onZoomChange: (percent) => {
      const zoomLabel = document.getElementById('canvasZoomLabel');
      if (zoomLabel) zoomLabel.textContent = `${percent}%`;
    },
    onCoordinatesChange: (x, y) => {
      const coords = document.getElementById('canvasCoordinates');
      if (coords) coords.textContent = `X: ${x}, Y: ${y}`;
    },
    onChange: () => {
      updateHistoryButtons();
    }
  });

  // Top Bar Controls
  const btnClose = document.getElementById('btnCloseCanvasModal');
  if (btnClose) btnClose.addEventListener('click', closeCanvasModal);

  const btnUndo = document.getElementById('btnCanvasUndo');
  if (btnUndo) btnUndo.addEventListener('click', () => engine.undo());

  const btnRedo = document.getElementById('btnCanvasRedo');
  if (btnRedo) btnRedo.addEventListener('click', () => engine.redo());

  const btnSnap = document.getElementById('btnCanvasSnap');
  if (btnSnap) {
    btnSnap.addEventListener('click', () => {
      const next = !engine.gridSnap;
      engine.setGridSnap(next);
      btnSnap.classList.toggle('active', next);
    });
  }

  // Zoom Controls
  const btnZoomIn = document.getElementById('btnCanvasZoomIn');
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => engine.zoomIn());

  const btnZoomOut = document.getElementById('btnCanvasZoomOut');
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => engine.zoomOut());

  const btnZoomReset = document.getElementById('btnCanvasZoomReset');
  if (btnZoomReset) btnZoomReset.addEventListener('click', () => engine.resetZoom());

  const zoomLabel = document.getElementById('canvasZoomLabel');
  if (zoomLabel) zoomLabel.addEventListener('dblclick', () => engine.resetZoom());

  // Export / Insert Controls
  const btnCopySvg = document.getElementById('btnCanvasCopySvg');
  if (btnCopySvg) {
    btnCopySvg.addEventListener('click', () => {
      const svgCode = engine.exportStandaloneSvg();
      navigator.clipboard.writeText(svgCode).then(() => {
        showToast('SVGコードをクリップボードにコピーしました', 'success');
      });
    });
  }

  const btnDownloadSvg = document.getElementById('btnCanvasDownloadSvg');
  if (btnDownloadSvg) {
    btnDownloadSvg.addEventListener('click', () => {
      const svgCode = engine.exportStandaloneSvg();
      const titleInput = document.getElementById('canvasDiagramTitle');
      const filename = `${(titleInput ? titleInput.value.trim() : 'diagram') || 'diagram'}.svg`;
      const blob = new Blob([svgCode], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('SVGファイルを保存しました', 'success');
    });
  }

  const btnInsertToNote = document.getElementById('btnCanvasInsertToNote');
  if (btnInsertToNote) {
    btnInsertToNote.addEventListener('click', () => {
      const titleInput = document.getElementById('canvasDiagramTitle');
      const title = (titleInput ? titleInput.value.trim() : 'ネットワーク構成図') || 'ネットワーク構成図';
      const data = engine.exportData(title);

      if (currentSaveCallback) {
        currentSaveCallback(data);
        showToast('メモ内の構成図を更新しました', 'success');
      } else {
        insertDiagramToActiveNote(data);
        showToast('メモに構成図を挿入しました', 'success');
      }
      closeCanvasModal();
    });
  }

  // Left Toolbar Tool Buttons
  const toolButtons = document.querySelectorAll('.canvas-toolbar .tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      if (!tool) return;

      if (tool === 'spawn-cable') {
        engine.spawnCableAtCenter(SHAPE_TYPES.ORTHOGONAL);
        const selectBtn = document.querySelector('.canvas-toolbar .tool-btn[data-tool="select"]');
        toolButtons.forEach(b => b.classList.remove('active'));
        if (selectBtn) selectBtn.classList.add('active');
        showToast('LANケーブルを中央に配置しました（端子をドラッグして機器に接続できます）', 'info');
        return;
      }

      const isInteractiveWiring = [
        SHAPE_TYPES.SELECT,
        SHAPE_TYPES.PAN,
        SHAPE_TYPES.ORTHOGONAL,
        SHAPE_TYPES.LINE,
        SHAPE_TYPES.POLYLINE
      ].includes(tool);

      if (isInteractiveWiring) {
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        engine.setActiveTool(tool);
      } else {
        // Direct 1-click spawn at current canvas view center!
        engine.spawnElementAtCenter(tool);
        // Switch tool button back to select
        const selectBtn = document.querySelector('.canvas-toolbar .tool-btn[data-tool="select"]');
        toolButtons.forEach(b => b.classList.remove('active'));
        if (selectBtn) selectBtn.classList.add('active');
        showToast('シェイプをキャンバスの中央に追加しました', 'info');
      }
    });
  });

  // Right Inspector UI Listeners
  bindInspectorControls();

  // Floating hover tooltip
  initCanvasHoverTooltip();
}

/**
 * Bind inspector inputs to selected element
 */
function bindInspectorControls() {
  const propStrokeColor = document.getElementById('propStrokeColor');
  const propFillColor = document.getElementById('propFillColor');
  const propTextColor = document.getElementById('propTextColor');
  const propStrokeWidth = document.getElementById('propStrokeWidth');
  const propStrokeWidthVal = document.getElementById('propStrokeWidthVal');
  const propStrokeStyle = document.getElementById('propStrokeStyle');

  // Size & Rotation
  const propWidth = document.getElementById('propWidth');
  const propHeight = document.getElementById('propHeight');
  const propRotation = document.getElementById('propRotation');
  const propRotationVal = document.getElementById('propRotationVal');
  const btnRotateCCW = document.getElementById('btnRotateCCW');
  const btnRotateCW = document.getElementById('btnRotateCW');
  const btnRotateReset = document.getElementById('btnRotateReset');

  // Device & Text Meta
  const propDeviceHostname = document.getElementById('propDeviceHostname');
  const propDeviceIp = document.getElementById('propDeviceIp');
  const propDeviceIcon = document.getElementById('propDeviceIcon');
  const propTextContent = document.getElementById('propTextContent');
  const propFontSize = document.getElementById('propFontSize');

  const btnDeleteSelected = document.getElementById('btnDeleteSelectedElement');
  const btnBringToFront = document.getElementById('btnBringToFront');
  const btnSendToBack = document.getElementById('btnSendToBack');

  // Popover Toggles
  const colorDropdowns = [
    { btn: 'btnStrokeDropdown', popover: 'popoverStrokeColor' },
    { btn: 'btnFillDropdown', popover: 'popoverFillColor' },
    { btn: 'btnTextColorDropdown', popover: 'popoverCanvasTextColor' }
  ];

  function closeAllColorPopovers() {
    colorDropdowns.forEach(d => {
      const p = document.getElementById(d.popover);
      if (p) p.style.display = 'none';
    });
  }

  colorDropdowns.forEach(d => {
    const btn = document.getElementById(d.btn);
    const pop = document.getElementById(d.popover);
    if (btn && pop) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = pop.style.display === 'block';
        closeAllColorPopovers();
        if (!isOpen) pop.style.display = 'block';
      });
      pop.addEventListener('click', (e) => e.stopPropagation());
    }
  });

  document.addEventListener('click', () => {
    closeAllColorPopovers();
  });

  // Palette Swatches Click Handler
  const swatchButtons = document.querySelectorAll('.palette-swatches-grid .palette-swatch-item');
  swatchButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = btn.getAttribute('data-color');
      const target = btn.closest('.palette-swatches-grid')?.getAttribute('data-target');
      if (!color || !target) return;

      if (target === 'stroke') {
        applyStrokeColor(color);
      } else if (target === 'fill') {
        applyFillColor(color);
      } else if (target === 'textColor') {
        applyTextColor(color);
      }
      closeAllColorPopovers();
    });
  });

  // Custom Color Input Events
  if (propStrokeColor) {
    propStrokeColor.addEventListener('input', (e) => applyStrokeColor(e.target.value));
  }
  if (propFillColor) {
    propFillColor.addEventListener('input', (e) => applyFillColor(e.target.value));
  }
  if (propTextColor) {
    propTextColor.addEventListener('input', (e) => applyTextColor(e.target.value));
  }

  if (propStrokeWidth) {
    propStrokeWidth.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (propStrokeWidthVal) propStrokeWidthVal.textContent = `${val}px`;
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { strokeWidth: val });
      } else if (engine) {
        engine.defaultStrokeWidth = val;
      }
    });
  }

  if (propStrokeStyle) {
    propStrokeStyle.addEventListener('change', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { strokeStyle: e.target.value });
      } else if (engine) {
        engine.defaultStrokeStyle = e.target.value;
      }
    });
  }

  // Size Controls
  if (propWidth) {
    propWidth.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 20 && engine && engine.selectedId) {
        engine.resizeSelected(val, undefined);
      }
    });
  }

  if (propHeight) {
    propHeight.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 20 && engine && engine.selectedId) {
        engine.resizeSelected(undefined, val);
      }
    });
  }

  // Rotation Controls
  if (propRotation) {
    propRotation.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (propRotationVal) propRotationVal.textContent = `${val}°`;
      if (engine && engine.selectedId) {
        engine.setRotation(val);
      }
    });
  }

  if (btnRotateCCW) {
    btnRotateCCW.addEventListener('click', () => {
      if (engine && engine.selectedId) engine.rotateSelected(-90);
    });
  }

  if (btnRotateCW) {
    btnRotateCW.addEventListener('click', () => {
      if (engine && engine.selectedId) engine.rotateSelected(90);
    });
  }

  if (btnRotateReset) {
    btnRotateReset.addEventListener('click', () => {
      if (engine && engine.selectedId) engine.setRotation(0);
    });
  }

  const btnFlipH = document.getElementById('btnFlipH');
  if (btnFlipH) {
    btnFlipH.addEventListener('click', () => {
      if (engine && engine.selectedId) {
        engine.flipSelected('horizontal');
      }
    });
  }

  const btnFlipV = document.getElementById('btnFlipV');
  if (btnFlipV) {
    btnFlipV.addEventListener('click', () => {
      if (engine && engine.selectedId) {
        engine.flipSelected('vertical');
      }
    });
  }

  // Device Meta
  const propShapeTitle = document.getElementById('propShapeTitle');
  if (propShapeTitle) {
    propShapeTitle.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { title: e.target.value });
      }
    });
  }

  if (propDeviceHostname) {
    propDeviceHostname.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { hostname: e.target.value });
      }
    });
  }

  if (propDeviceIp) {
    propDeviceIp.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { ip: e.target.value });
      }
    });
  }

  const propDeviceGateway = document.getElementById('propDeviceGateway');
  if (propDeviceGateway) {
    propDeviceGateway.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { gateway: e.target.value });
      }
    });
  }

  const propDeviceDns = document.getElementById('propDeviceDns');
  if (propDeviceDns) {
    propDeviceDns.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { dns: e.target.value });
      }
    });
  }

  const propDeviceVlan = document.getElementById('propDeviceVlan');
  if (propDeviceVlan) {
    propDeviceVlan.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { vlan: e.target.value });
      }
    });
  }

  const propDeviceNotes = document.getElementById('propDeviceNotes');
  if (propDeviceNotes) {
    propDeviceNotes.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { notes: e.target.value });
      }
    });
  }

  const btnAddCustomProp = document.getElementById('btnAddCustomProp');
  if (btnAddCustomProp) {
    btnAddCustomProp.addEventListener('click', () => {
      if (!engine || !engine.selectedId) return;
      const el = engine.getElementById(engine.selectedId);
      if (!el) return;
      if (!Array.isArray(el.customProps)) el.customProps = [];
      el.customProps.push({ key: '項目', value: '' });
      renderCustomPropsList(el);
      engine.onChange();
    });
  }

  if (propDeviceIcon) {
    propDeviceIcon.addEventListener('change', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { icon: e.target.value });
      }
    });
  }

  // Text Meta
  if (propTextContent) {
    propTextContent.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { text: e.target.value });
      }
    });
  }

  if (propFontSize) {
    propFontSize.addEventListener('change', (e) => {
      const size = parseInt(e.target.value, 10);
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { fontSize: size });
      }
    });
  }

  // Text Alignment Buttons
  const textAlignButtons = document.querySelectorAll('.text-align-btn');
  textAlignButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const align = btn.getAttribute('data-align');
      textAlignButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { textAlign: align });
      }
    });
  });

  // Cable Meta (Label & Cable Type Presets)
  const propCableLabel = document.getElementById('propCableLabel');
  if (propCableLabel) {
    propCableLabel.addEventListener('input', (e) => {
      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, { cableLabel: e.target.value });
      }
    });
  }

  const cablePresets = {
    cat6:  { stroke: '#0284c7', strokeWidth: 2.5, strokeStyle: 'solid', label: '1Gbps' },
    cat6a: { stroke: '#06b6d4', strokeWidth: 3, strokeStyle: 'solid', label: '10GbE' },
    fiber: { stroke: '#f97316', strokeWidth: 2.5, strokeStyle: 'solid', label: 'SFP+ (光)' },
    poe:   { stroke: '#8b5cf6', strokeWidth: 3, strokeStyle: 'solid', label: 'PoE' },
    trunk: { stroke: '#ef4444', strokeWidth: 3.5, strokeStyle: 'solid', label: 'TRUNK' },
    mgmt:  { stroke: '#64748b', strokeWidth: 2, strokeStyle: 'dashed', label: 'MGMT' }
  };

  const cableTypeButtons = document.querySelectorAll('.cable-type-btn');
  cableTypeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-preset');
      const preset = cablePresets[key];
      if (!preset) return;

      applyStrokeColor(preset.stroke);
      if (propStrokeWidth) propStrokeWidth.value = preset.strokeWidth;
      if (propStrokeWidthVal) propStrokeWidthVal.textContent = `${preset.strokeWidth}px`;
      if (propStrokeStyle) propStrokeStyle.value = preset.strokeStyle;
      if (propCableLabel) propCableLabel.value = preset.label;

      if (engine && engine.selectedId) {
        engine.updateElementProperties(engine.selectedId, {
          stroke: preset.stroke,
          strokeWidth: preset.strokeWidth,
          strokeStyle: preset.strokeStyle,
          cableLabel: preset.label
        });
      }
    });
  });

  // VLAN Presets
  const presetPills = document.querySelectorAll('.preset-pills .pill-btn');
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const presetKey = pill.getAttribute('data-preset');
      const preset = VLAN_PRESETS[presetKey];
      if (preset) {
        applyStrokeColor(preset.stroke);
        if (propStrokeWidth) propStrokeWidth.value = preset.strokeWidth;
        if (propStrokeWidthVal) propStrokeWidthVal.textContent = `${preset.strokeWidth}px`;
        if (propStrokeStyle) propStrokeStyle.value = preset.strokeStyle;

        if (engine && engine.selectedId) {
          engine.updateElementProperties(engine.selectedId, {
            stroke: preset.stroke,
            strokeWidth: preset.strokeWidth,
            strokeStyle: preset.strokeStyle
          });
        }
      }
    });
  });

  // Element Arrangement & Delete
  if (btnBringToFront) btnBringToFront.addEventListener('click', () => engine && engine.bringToFront());
  if (btnSendToBack) btnSendToBack.addEventListener('click', () => engine && engine.sendToBack());
  if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', () => engine && engine.deleteSelected());
}

/**
 * Apply Stroke Color to UI and Engine
 */
function applyStrokeColor(color, skipEngine = false) {
  const chip = document.getElementById('chipStrokeColor');
  const label = document.getElementById('labelStrokeColor');
  const input = document.getElementById('propStrokeColor');
  if (chip) chip.style.background = color === 'transparent' ? 'none' : color;
  if (label) label.textContent = color;
  if (input && color.startsWith('#')) input.value = color;

  if (!skipEngine && engine) {
    if (engine.selectedId) {
      engine.updateElementProperties(engine.selectedId, { stroke: color });
    } else {
      engine.defaultStroke = color;
    }
  }
}

/**
 * Apply Fill Color to UI and Engine
 */
function applyFillColor(color, skipEngine = false) {
  const chip = document.getElementById('chipFillColor');
  const label = document.getElementById('labelFillColor');
  const input = document.getElementById('propFillColor');
  if (chip) chip.style.background = color === 'transparent' ? 'none' : color;
  if (label) label.textContent = color === 'transparent' ? '透過 (なし)' : color;
  if (input && color.startsWith('#')) input.value = color;

  if (!skipEngine && engine) {
    if (engine.selectedId) {
      engine.updateElementProperties(engine.selectedId, { fill: color });
    } else {
      engine.defaultFill = color;
    }
  }
}

/**
 * Apply Text Color to UI and Engine
 */
function applyTextColor(color, skipEngine = false) {
  const chip = document.getElementById('chipTextColor');
  const label = document.getElementById('labelTextColor');
  const input = document.getElementById('propTextColor');
  if (chip) chip.style.background = color;
  if (label) label.textContent = color;
  if (input && color.startsWith('#')) input.value = color;

  if (!skipEngine && engine && engine.selectedId) {
    engine.updateElementProperties(engine.selectedId, { textColor: color });
  }
}

/**
 * Sync Inspector UI with selected element
 */
function updateInspectorUI(el) {
  const inspectorDimensions = document.getElementById('inspectorDimensions');
  const inspectorRotation = document.getElementById('inspectorRotation');
  const inspectorDeviceMeta = document.getElementById('inspectorDeviceMeta');
  const inspectorCableMeta = document.getElementById('inspectorCableMeta');
  const inspectorTextMeta = document.getElementById('inspectorTextMeta');
  const propStrokeWidth = document.getElementById('propStrokeWidth');
  const propStrokeWidthVal = document.getElementById('propStrokeWidthVal');
  const propStrokeStyle = document.getElementById('propStrokeStyle');
  const propWidth = document.getElementById('propWidth');
  const propHeight = document.getElementById('propHeight');
  const propRotation = document.getElementById('propRotation');
  const propRotationVal = document.getElementById('propRotationVal');
  const propDeviceHostname = document.getElementById('propDeviceHostname');
  const propDeviceIp = document.getElementById('propDeviceIp');
  const propDeviceIcon = document.getElementById('propDeviceIcon');
  const propCableLabel = document.getElementById('propCableLabel');
  const propTextContent = document.getElementById('propTextContent');
  const propFontSize = document.getElementById('propFontSize');

  if (!el) {
    if (inspectorDimensions) inspectorDimensions.style.display = 'none';
    if (inspectorRotation) inspectorRotation.style.display = 'none';
    const inspectorShapeTitleWrap = document.getElementById('inspectorShapeTitleWrap');
    if (inspectorShapeTitleWrap) inspectorShapeTitleWrap.style.display = 'none';
    if (inspectorDeviceMeta) inspectorDeviceMeta.style.display = 'none';
    if (inspectorCableMeta) inspectorCableMeta.style.display = 'none';
    if (inspectorTextMeta) inspectorTextMeta.style.display = 'none';
    return;
  }

  // Dimensions & Rotation Visibility
  const hasBoxDimensions = !el.points || el.points.length === 0;
  if (inspectorDimensions) {
    inspectorDimensions.style.display = hasBoxDimensions ? 'block' : 'none';
    if (hasBoxDimensions) {
      if (propWidth) propWidth.value = Math.round(el.width || 100);
      if (propHeight) propHeight.value = Math.round(el.height || 60);
    }
  }

  if (inspectorRotation) {
    inspectorRotation.style.display = hasBoxDimensions ? 'block' : 'none';
    if (hasBoxDimensions) {
      const rot = Math.round(el.rotation || 0) % 360;
      if (propRotation) propRotation.value = rot;
      if (propRotationVal) propRotationVal.textContent = `${rot}°`;

      const btnFlipH = document.getElementById('btnFlipH');
      const btnFlipV = document.getElementById('btnFlipV');
      if (btnFlipH) btnFlipH.classList.toggle('active', Boolean(el.flipX));
      if (btnFlipV) btnFlipV.classList.toggle('active', Boolean(el.flipY));
    }
  }

  // Stroke & Fill & TextColor Sync
  if (el.stroke) {
    applyStrokeColor(el.stroke, true);
  }
  if (el.fill) {
    applyFillColor(el.fill, true);
  }
  if (el.textColor) {
    applyTextColor(el.textColor, true);
  } else {
    applyTextColor('#0f172a', true);
  }

  if (el.strokeWidth !== undefined && propStrokeWidth) {
    propStrokeWidth.value = el.strokeWidth;
    if (propStrokeWidthVal) propStrokeWidthVal.textContent = `${el.strokeWidth}px`;
  }
  if (el.strokeStyle && propStrokeStyle) {
    propStrokeStyle.value = el.strokeStyle;
  }

  // LAN Cable Meta
  const isCable = el.type === SHAPE_TYPES.ORTHOGONAL || el.type === SHAPE_TYPES.LINE;
  if (inspectorCableMeta) {
    inspectorCableMeta.style.display = isCable ? 'block' : 'none';
    if (isCable && propCableLabel) {
      propCableLabel.value = el.cableLabel || '';
    }
  }

  // Shape Meta (Title for non-device shapes)
  const isDevice = el.type.startsWith('device-') || el.type === SHAPE_TYPES.RACK;
  const isShape = !isDevice && !isCable && el.type !== SHAPE_TYPES.TEXT;
  const inspectorShapeTitleWrap = document.getElementById('inspectorShapeTitleWrap');
  if (inspectorShapeTitleWrap) {
    inspectorShapeTitleWrap.style.display = isShape ? 'block' : 'none';
    if (isShape) {
      const propShapeTitle = document.getElementById('propShapeTitle');
      if (propShapeTitle) {
        propShapeTitle.value = el.title || '';
      }
    }
  }

  // Device Meta
  if (inspectorDeviceMeta) {
    inspectorDeviceMeta.style.display = isDevice ? 'block' : 'none';
    if (isDevice) {
      const propDeviceHostname = document.getElementById('propDeviceHostname');
      const propDeviceIp = document.getElementById('propDeviceIp');
      const propDeviceGateway = document.getElementById('propDeviceGateway');
      const propDeviceDns = document.getElementById('propDeviceDns');
      const propDeviceVlan = document.getElementById('propDeviceVlan');
      const propDeviceIcon = document.getElementById('propDeviceIcon');
      const propDeviceNotes = document.getElementById('propDeviceNotes');

      if (propDeviceHostname) propDeviceHostname.value = el.hostname || '';
      if (propDeviceIp) propDeviceIp.value = el.ip || '';
      if (propDeviceGateway) propDeviceGateway.value = el.gateway || '';
      if (propDeviceDns) propDeviceDns.value = el.dns || '';
      if (propDeviceVlan) propDeviceVlan.value = el.vlan || '';
      if (propDeviceNotes) propDeviceNotes.value = el.notes || '';
      if (propDeviceIcon) {
        propDeviceIcon.value = el.icon || '🔲';
      }
      renderCustomPropsList(el);
    }
  }

  // Text Meta
  const isText = el.type === SHAPE_TYPES.TEXT;
  if (inspectorTextMeta) {
    inspectorTextMeta.style.display = isText ? 'block' : 'none';
    if (isText) {
      if (propTextContent) propTextContent.value = el.text || '';
      if (propFontSize) propFontSize.value = el.fontSize || 14;

      const align = el.textAlign || 'left';
      const textAlignButtons = document.querySelectorAll('.text-align-btn');
      textAlignButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-align') === align);
      });
    }
  }
}

/**
 * Render dynamic custom key-value property fields
 */
function renderCustomPropsList(el) {
  const container = document.getElementById('deviceCustomPropsContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(el.customProps) || el.customProps.length === 0) {
    container.innerHTML = '<span style="font-size:0.73rem; color:var(--text-muted);">（カスタム属性なし）</span>';
    return;
  }

  el.customProps.forEach((item, index) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '4px';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'form-control form-control-sm font-mono';
    keyInput.style.width = '80px';
    keyInput.style.fontSize = '0.74rem';
    keyInput.placeholder = 'キー (例: MAC)';
    keyInput.value = item.key || '';
    keyInput.addEventListener('input', (e) => {
      item.key = e.target.value;
      if (engine) engine.onChange();
    });

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'form-control form-control-sm font-mono';
    valInput.style.flex = '1';
    valInput.style.minWidth = '0';
    valInput.style.fontSize = '0.74rem';
    valInput.placeholder = '値';
    valInput.value = item.value || '';
    valInput.addEventListener('input', (e) => {
      item.value = e.target.value;
      if (engine) engine.onChange();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-icon';
    delBtn.style.width = '24px';
    delBtn.style.height = '24px';
    delBtn.style.padding = '0';
    delBtn.title = '削除';
    delBtn.innerHTML = '<i class="fa-solid fa-xmark" style="font-size:0.75rem; color:var(--accent-danger);"></i>';
    delBtn.addEventListener('click', () => {
      el.customProps.splice(index, 1);
      renderCustomPropsList(el);
      if (engine) engine.onChange();
    });

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

/**
 * Initialize Floating Hover Tooltip with ample 20px offset distance
 */
function initCanvasHoverTooltip() {
  const tooltip = document.getElementById('canvasHoverTooltip');
  const workspace = document.getElementById('canvasWorkspace');
  if (!tooltip || !workspace || !engine) return;

  workspace.addEventListener('mousemove', (e) => {
    // Hide tooltip when interacting (dragging, drawing, panning, resizing)
    if (engine.isDraggingElement || engine.isDrawing || engine.isPanning || engine.isResizing || engine.isRotating) {
      tooltip.style.display = 'none';
      return;
    }

    const world = engine.screenToWorld(e.clientX, e.clientY);
    const hit = engine._hitTest(world);

    if (!hit) {
      tooltip.style.display = 'none';
      return;
    }

    const hasProps = Boolean(
      hit.hostname || hit.ip || hit.gateway || hit.dns || hit.vlan || hit.notes ||
      (Array.isArray(hit.customProps) && hit.customProps.length > 0) || hit.cableLabel
    );

    if (!hasProps) {
      tooltip.style.display = 'none';
      return;
    }

    // Build Tooltip HTML
    let html = '';
    const title = hit.hostname || (hit.type === SHAPE_TYPES.LINE || hit.type === SHAPE_TYPES.ORTHOGONAL ? 'LANケーブル' : hit.type);
    const icon = hit.icon || '';
    html += `<div class="tooltip-header"><span>${icon}</span> <span>${escapeHtml(title)}</span></div>`;

    html += `<div class="tooltip-grid">`;
    if (hit.ip) html += `<span class="tooltip-key">IP:</span><span class="tooltip-val">${escapeHtml(hit.ip)}</span>`;
    if (hit.gateway) html += `<span class="tooltip-key">GW:</span><span class="tooltip-val">${escapeHtml(hit.gateway)}</span>`;
    if (hit.dns) html += `<span class="tooltip-key">DNS:</span><span class="tooltip-val">${escapeHtml(hit.dns)}</span>`;
    if (hit.vlan) html += `<span class="tooltip-key">VLAN:</span><span class="tooltip-val">${escapeHtml(hit.vlan)}</span>`;
    if (hit.cableLabel) html += `<span class="tooltip-key">規格/速度:</span><span class="tooltip-val">${escapeHtml(hit.cableLabel)}</span>`;

    if (Array.isArray(hit.customProps)) {
      hit.customProps.forEach(cp => {
        if (cp.key && cp.value) {
          html += `<span class="tooltip-key">${escapeHtml(cp.key)}:</span><span class="tooltip-val">${escapeHtml(cp.value)}</span>`;
        }
      });
    }
    html += `</div>`;

    if (hit.notes) {
      html += `<div class="tooltip-notes">📝 ${escapeHtml(hit.notes)}</div>`;
    }

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    // Position calculation with ample distance (20px margin)
    const wsRect = workspace.getBoundingClientRect();
    const bounds = calcBounds(hit);

    const elScreenX = bounds.x * engine.scale + engine.panX;
    const elScreenY = bounds.y * engine.scale + engine.panY;
    const elScreenW = bounds.width * engine.scale;
    const elScreenH = bounds.height * engine.scale;

    const tipW = tooltip.offsetWidth || 210;
    const tipH = tooltip.offsetHeight || 110;
    const margin = 20; // Ample distance so it does NOT overlap with the shape

    let top = elScreenY - tipH - margin;
    if (top < 10) {
      top = elScreenY + elScreenH + margin;
    }

    let left = elScreenX + (elScreenW - tipW) / 2;
    left = Math.max(10, Math.min(wsRect.width - tipW - 10, left));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });

  workspace.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

function updateHistoryButtons() {
  const btnUndo = document.getElementById('btnCanvasUndo');
  const btnRedo = document.getElementById('btnCanvasRedo');
  if (btnUndo && engine) btnUndo.disabled = engine.undoStack.length === 0;
  if (btnRedo && engine) btnRedo.disabled = engine.redoStack.length === 0;
}

/**
 * Opens Canvas Modal in fresh state
 */
export function openCanvasModal() {
  currentSaveCallback = null;
  const modal = document.getElementById('canvasModalOverlay');
  if (!modal) return;

  const titleInput = document.getElementById('canvasDiagramTitle');
  if (titleInput) titleInput.value = 'ネットワーク構成図';

  modal.style.display = 'flex';
  if (engine) {
    engine.loadData({ elements: [] });
    // Set default fill to white as requested
    engine.defaultFill = '#ffffff';
    applyFillColor('#ffffff', true);
    applyTextColor('#0f172a', true);

    // Set default tool to select
    const selectBtn = document.querySelector('.canvas-toolbar .tool-btn[data-tool="select"]');
    if (selectBtn) selectBtn.click();
  }
}

/**
 * Opens Canvas Modal loaded with existing diagram data (for re-editing)
 */
export function openCanvasWithData(diagramData, onSave) {
  currentSaveCallback = onSave;
  const modal = document.getElementById('canvasModalOverlay');
  if (!modal) return;

  if (!engine) {
    initCanvasModal();
  }

  let data = diagramData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      data = { elements: [] };
    }
  }

  const titleInput = document.getElementById('canvasDiagramTitle');
  if (titleInput && data && data.title) {
    titleInput.value = data.title;
  }

  modal.style.display = 'flex';
  if (engine) {
    engine.loadData(data || { elements: [] });
    const selectBtn = document.querySelector('.canvas-toolbar .tool-btn[data-tool="select"]');
    if (selectBtn) selectBtn.click();
  }
}

/**
 * Closes Canvas Modal
 */
export function closeCanvasModal() {
  const modal = document.getElementById('canvasModalOverlay');
  if (modal) modal.style.display = 'none';
  currentSaveCallback = null;
}

/**
 * Inserts diagram Markdown block into active note textarea
 */
function insertDiagramToActiveNote(data) {
  const noteInput = document.getElementById('noteMarkdownInput');
  if (!noteInput) {
    // If not in note view, notify user
    showToast('メモエディタが開いていません', 'error');
    return;
  }

  const jsonStr = JSON.stringify(data, null, 2);
  const block = `\n\`\`\`opsnotes-canvas\n${jsonStr}\n\`\`\`\n`;

  const start = noteInput.selectionStart || noteInput.value.length;
  const end = noteInput.selectionEnd || noteInput.value.length;
  const original = noteInput.value;

  noteInput.value = original.substring(0, start) + block + original.substring(end);
  noteInput.selectionStart = noteInput.selectionEnd = start + block.length;
  noteInput.focus();

  // Trigger input event for auto-save and preview update
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Escapes HTML characters for safe rendering
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Computes bounding box for an element (with fallback if getElementBounds is unavailable)
 */
function calcBounds(el) {
  try {
    if (typeof getElementBounds === 'function') {
      return getElementBounds(el);
    }
  } catch (e) {}

  if (el.points && el.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    el.points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return {
      x: minX,
      y: minY,
      width: Math.max(20, maxX - minX),
      height: Math.max(20, maxY - minY)
    };
  }
  return {
    x: el.x || 0,
    y: el.y || 0,
    width: el.width || 100,
    height: el.height || 60
  };
}

