/**
 * OpsNotes Canvas - Shapes, Architectural Items & Network Devices Definitions
 */

export const SHAPE_TYPES = {
  // Navigation & Edit
  SELECT: 'select',
  PAN: 'pan',

  // Wiring & Paths
  ORTHOGONAL: 'orthogonal',
  LINE: 'line',
  POLYLINE: 'polyline',

  // Basic Shapes
  RECT: 'rect',
  ROUNDRECT: 'roundrect',
  CIRCLE: 'circle',
  TEXT: 'text',

  // Architectural items
  WALL: 'wall',
  DOOR: 'door',
  SLIDING_DOOR: 'sliding-door',
  WINDOW: 'window',
  PILLAR: 'pillar',
  RACK: 'rack',

  // Network Devices
  DEVICE_ROUTER: 'device-router',
  DEVICE_SWITCH: 'device-switch',
  DEVICE_SERVER: 'device-server',
  DEVICE_NAS: 'device-nas',
  DEVICE_FIREWALL: 'device-firewall',
  DEVICE_AP: 'device-ap',
  DEVICE_CLOUD: 'device-cloud',
  DEVICE_PC: 'device-pc',
  DEVICE_GENERIC: 'device-generic',
  DEVICE_VM: 'device-vm'
};

export const VLAN_PRESETS = {
  'vlan-mgmt': { stroke: '#f97316', strokeWidth: 2, strokeStyle: 'dashed', label: 'MGMT' },
  'vlan-server': { stroke: '#3b82f6', strokeWidth: 2, strokeStyle: 'solid', label: 'VLAN 10' },
  'vlan-dmz': { stroke: '#10b981', strokeWidth: 2, strokeStyle: 'solid', label: 'VLAN 20' },
  'trunk': { stroke: '#ef4444', strokeWidth: 3, strokeStyle: 'solid', label: 'TRUNK' }
};

export function createId() {
  return 'el_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Returns theme-appropriate stroke color (White in dark themes, Dark charcoal in light themes)
 */
export function getDefaultThemeStrokeColor() {
  const theme = document.documentElement.getAttribute('data-theme') || 'monokai-ristretto';
  const isLight = theme.includes('light') || theme.includes('latte');
  return isLight ? '#1e293b' : '#ffffff';
}

/**
 * Returns default fill color (#ffffff)
 */
export function getDefaultThemeFillColor() {
  return '#ffffff';
}

/**
 * Checks if a color hex is light (used for high contrast text color)
 */
export function isColorLight(color) {
  if (!color || color === 'transparent' || color === 'none') return false;
  if (color === '#ffffff' || color.toLowerCase() === 'white') return true;
  if (color.startsWith('#') && color.length >= 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
  }
  return false;
}

/**
 * Returns magnetic connection ports (Top, Right, Bottom, Left) for an element
 */
export function getConnectionPorts(el) {
  if (el.points && el.points.length > 0) return [];
  const x = el.x;
  const y = el.y;
  const w = el.width || 100;
  const h = el.height || 60;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rot = (el.rotation || 0) * Math.PI / 180;

  const rawPorts = [
    { side: 'top', x: cx, y },
    { side: 'right', x: x + w, y: cy },
    { side: 'bottom', x: cx, y: y + h },
    { side: 'left', x, y: cy }
  ];

  if (!rot) return rawPorts;

  return rawPorts.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      side: p.side,
      x: Math.round(cx + dx * Math.cos(rot) - dy * Math.sin(rot)),
      y: Math.round(cy + dx * Math.sin(rot) + dy * Math.cos(rot))
    };
  });
}

/**
 * Returns the pair of nearest connection ports between two elements
 */
export function getBestPortPair(el1, el2) {
  const ports1 = getConnectionPorts(el1);
  const ports2 = getConnectionPorts(el2);
  let best = null;
  let minDistance = Infinity;

  for (const p1 of ports1) {
    for (const p2 of ports2) {
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (d < minDistance) {
        minDistance = d;
        best = { p1, p2, distance: d };
      }
    }
  }
  return best;
}

/**
 * Factory for creating a new element data object
 */
export function createElement(type, x, y, strokeParam = null, fillParam = null) {
  const themeStroke = strokeParam || getDefaultThemeStrokeColor();
  // User Requirement: 塗りつぶしのデフォルトを白色にしてください。
  const defaultWhiteFill = fillParam !== null ? fillParam : '#ffffff';

  const base = {
    id: createId(),
    type,
    x,
    y,
    width: 100,
    height: 60,
    rotation: 0,
    flipX: false,
    flipY: false,
    stroke: themeStroke,
    strokeWidth: 2,
    strokeStyle: 'solid',
    fill: defaultWhiteFill,
    textColor: '#0f172a',
    title: '',
    gateway: '',
    dns: '',
    vlan: '',
    notes: '',
    customProps: []
  };

  switch (type) {
    case SHAPE_TYPES.RECT:
      return { ...base, width: 120, height: 80, stroke: themeStroke, fill: defaultWhiteFill };

    case SHAPE_TYPES.ROUNDRECT:
      return { ...base, width: 120, height: 80, rx: 8, stroke: themeStroke, fill: defaultWhiteFill };

    case SHAPE_TYPES.CIRCLE:
      return { ...base, width: 90, height: 90, stroke: themeStroke, fill: defaultWhiteFill };

    case SHAPE_TYPES.TEXT:
      return {
        ...base,
        width: 120,
        height: 32,
        fill: 'transparent',
        stroke: 'none',
        text: 'テキスト',
        fontSize: 14,
        textAlign: 'left',
        textColor: themeStroke
      };

    case SHAPE_TYPES.LINE:
    case SHAPE_TYPES.ORTHOGONAL:
      return {
        ...base,
        fill: 'none',
        stroke: strokeParam || '#0284c7', // デフォルトLANケーブル青
        strokeWidth: 2.5,
        cableLabel: '',
        cableType: 'cat6',
        points: [{ x, y }, { x: x + 120, y: y + (type === SHAPE_TYPES.ORTHOGONAL ? 60 : 0) }]
      };

    case SHAPE_TYPES.POLYLINE:
      return {
        ...base,
        fill: 'none',
        stroke: themeStroke,
        points: [{ x, y }]
      };

    // Architectural Items
    case SHAPE_TYPES.WALL:
      return {
        ...base,
        width: 180,
        height: 18,
        stroke: themeStroke,
        strokeWidth: 2,
        fill: defaultWhiteFill
      };

    case SHAPE_TYPES.DOOR:
      return {
        ...base,
        width: 60,
        height: 60,
        stroke: themeStroke,
        strokeWidth: 2,
        fill: 'none'
      };

    case SHAPE_TYPES.SLIDING_DOOR:
      return {
        ...base,
        width: 80,
        height: 20,
        stroke: themeStroke,
        strokeWidth: 2,
        fill: defaultWhiteFill
      };

    case SHAPE_TYPES.WINDOW:
      return {
        ...base,
        width: 120,
        height: 16,
        stroke: '#0284c7',
        strokeWidth: 1.5,
        fill: defaultWhiteFill
      };

    case SHAPE_TYPES.PILLAR:
      return {
        ...base,
        width: 40,
        height: 40,
        stroke: themeStroke,
        strokeWidth: 2,
        fill: defaultWhiteFill
      };

    case SHAPE_TYPES.RACK:
      return {
        ...base,
        width: 80,
        height: 120,
        stroke: themeStroke,
        strokeWidth: 2,
        fill: defaultWhiteFill,
        hostname: 'Rack-01'
      };

    // Network Devices (デフォルト白塗りつぶし、枠線はそれぞれの色)
    case SHAPE_TYPES.DEVICE_ROUTER:
      return {
        ...base,
        width: 100,
        height: 70,
        hostname: 'Router-01',
        ip: '192.168.1.1',
        stroke: '#0284c7', // Sky Blue
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_SWITCH:
      return {
        ...base,
        width: 110,
        height: 70,
        hostname: 'SW-L2-01',
        ip: '192.168.1.2',
        stroke: '#059669', // Emerald Green
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_SERVER:
      return {
        ...base,
        width: 110,
        height: 74,
        hostname: 'srv-pve-01',
        ip: '192.168.1.10',
        stroke: '#7c3aed', // Purple
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_NAS:
      return {
        ...base,
        width: 100,
        height: 74,
        hostname: 'nas-storage-01',
        ip: '192.168.1.20',
        stroke: '#d97706', // Amber
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_FIREWALL:
      return {
        ...base,
        width: 100,
        height: 70,
        hostname: 'OPNsense',
        ip: '192.168.1.254',
        stroke: '#dc2626', // Red
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_AP:
      return {
        ...base,
        width: 90,
        height: 70,
        hostname: 'AP-Living',
        ip: '192.168.1.5',
        stroke: '#2563eb', // Royal Blue
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_CLOUD:
      return {
        ...base,
        width: 110,
        height: 70,
        hostname: 'Internet / WAN',
        ip: '',
        stroke: '#64748b', // Slate
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_PC:
      return {
        ...base,
        width: 90,
        height: 70,
        hostname: 'Workstation',
        ip: '192.168.1.100',
        stroke: '#0891b2', // Cyan
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_GENERIC:
      return {
        ...base,
        width: 100,
        height: 70,
        hostname: 'Node-01',
        ip: '192.168.1.50',
        icon: '🔲',
        stroke: '#4f46e5', // Indigo
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    case SHAPE_TYPES.DEVICE_VM:
      return {
        ...base,
        width: 100,
        height: 70,
        hostname: 'docker-app',
        ip: '192.168.1.30',
        icon: '🐳',
        stroke: '#0284c7', // Docker Blue
        fill: defaultWhiteFill,
        textColor: '#0f172a'
      };

    default:
      return base;
  }
}

/**
 * Returns SVG dasharray string based on strokeStyle
 */
export function getDashArray(style, width) {
  if (style === 'dashed') return `${width * 4} ${width * 2}`;
  if (style === 'dotted') return `${width} ${width * 2}`;
  return 'none';
}

/**
 * Renders an element into an SVG <g> DOM element
 */
/**
 * Renders title label on top-left of shape (for non-device zones/groups)
 */
export function renderShapeTitle(g, el) {
  if (!el.title || !el.title.trim()) return;
  const titleText = el.title.trim();
  const fontSize = 11;
  const paddingX = 8;
  const paddingY = 16;

  const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textNode.setAttribute('x', el.x + paddingX);
  textNode.setAttribute('y', el.y + paddingY);
  textNode.setAttribute('font-size', `${fontSize}px`);
  textNode.setAttribute('font-weight', '700');
  textNode.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
  textNode.setAttribute('fill', el.textColor || el.stroke || '#64748b');
  textNode.setAttribute('pointer-events', 'none');
  textNode.setAttribute('class', 'canvas-shape-title-text');
  textNode.textContent = titleText;

  g.appendChild(textNode);
}

export function renderElementToSvg(el) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', el.id);
  g.setAttribute('class', 'canvas-element');
  g.setAttribute('data-id', el.id);
  g.setAttribute('data-type', el.type);

  const dashArray = getDashArray(el.strokeStyle, el.strokeWidth || 2);
  const fill = el.fill || 'transparent';
  const stroke = el.stroke || '#8b949e';
  const strokeWidth = el.strokeWidth || 2;

  // Rotation and Flip Transforms
  const transforms = [];
  let cx, cy;
  if (el.points && el.points.length > 0) {
    const b = getElementBounds(el);
    cx = b.x + b.width / 2;
    cy = b.y + b.height / 2;
  } else {
    cx = el.x + (el.width || 0) / 2;
    cy = el.y + (el.height || 0) / 2;
  }

  if (el.rotation) {
    transforms.push(`rotate(${el.rotation} ${cx} ${cy})`);
  }
  if (el.flipX || el.flipY) {
    const sx = el.flipX ? -1 : 1;
    const sy = el.flipY ? -1 : 1;
    transforms.push(`translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
  }
  if (transforms.length > 0) {
    g.setAttribute('transform', transforms.join(' '));
  }

  switch (el.type) {
    case SHAPE_TYPES.RECT: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('fill', fill);
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(rect);
      renderShapeTitle(g, el);
      renderDevicePortSockets(g, el, stroke);
      break;
    }

    case SHAPE_TYPES.ROUNDRECT: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('rx', el.rx || 8);
      rect.setAttribute('ry', el.rx || 8);
      rect.setAttribute('fill', fill);
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(rect);
      renderShapeTitle(g, el);
      renderDevicePortSockets(g, el, stroke);
      break;
    }

    case SHAPE_TYPES.CIRCLE: {
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ellipse.setAttribute('cx', cx);
      ellipse.setAttribute('cy', cy);
      ellipse.setAttribute('rx', el.width / 2);
      ellipse.setAttribute('ry', el.height / 2);
      ellipse.setAttribute('fill', fill);
      ellipse.setAttribute('stroke', stroke);
      ellipse.setAttribute('stroke-width', strokeWidth);
      ellipse.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(ellipse);
      renderShapeTitle(g, el);
      renderDevicePortSockets(g, el, stroke);
      break;
    }

    case SHAPE_TYPES.TEXT: {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const align = el.textAlign || 'left';
      const w = el.width || 120;
      let anchor = 'start';
      let textX = el.x;
      if (align === 'center') {
        anchor = 'middle';
        textX = el.x + w / 2;
      } else if (align === 'right') {
        anchor = 'end';
        textX = el.x + w;
      }
      text.setAttribute('x', textX);
      text.setAttribute('y', el.y + (el.fontSize || 14));
      text.setAttribute('text-anchor', anchor);
      text.setAttribute('font-size', el.fontSize || 14);
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('fill', el.textColor || stroke);
      text.textContent = el.text || 'テキスト';
      g.appendChild(text);
      break;
    }

    case SHAPE_TYPES.LINE: {
      const p1 = el.points[0] || { x: el.x, y: el.y };
      const p2 = el.points[1] || { x: el.x + el.width, y: el.y + el.height };
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', p1.x);
      line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x);
      line.setAttribute('y2', p2.y);
      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', strokeWidth);
      line.setAttribute('stroke-dasharray', dashArray);
      line.setAttribute('stroke-linecap', 'round');
      g.appendChild(line);

      // Terminal connector dots with border
      renderCableConnectors(g, [p1, p2], stroke, strokeWidth);

      // Optional Cable Label badge at mid-point
      if (el.cableLabel) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        renderCableLabelBadge(g, midX, midY, el.cableLabel, stroke);
      }
      break;
    }

    case SHAPE_TYPES.ORTHOGONAL: {
      // 2-point orthogonal (カギ折れ配線): (x1,y1) -> (midX, y1) -> (midX, y2) -> (x2, y2)
      const p1 = el.points[0] || { x: el.x, y: el.y };
      const p2 = el.points[1] || { x: el.x + el.width, y: el.y + el.height };
      const midX = Math.round((p1.x + p2.x) / 2);
      const d = `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeWidth);
      path.setAttribute('stroke-dasharray', dashArray);
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      g.appendChild(path);

      // Terminal connector dots with border
      renderCableConnectors(g, [p1, p2], stroke, strokeWidth);

      // Optional Cable Label badge at mid-turn
      if (el.cableLabel) {
        const midY = (p1.y + p2.y) / 2;
        renderCableLabelBadge(g, midX, midY, el.cableLabel, stroke);
      }
      break;
    }

    case SHAPE_TYPES.POLYLINE: {
      const points = el.points || [];
      if (points.length > 0) {
        const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', pointsStr);
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', stroke);
        poly.setAttribute('stroke-width', strokeWidth);
        poly.setAttribute('stroke-dasharray', dashArray);
        poly.setAttribute('stroke-linejoin', 'round');
        poly.setAttribute('stroke-linecap', 'round');
        poly.style.pointerEvents = 'stroke';
        g.appendChild(poly);

        // Render point anchors
        points.forEach(p => {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', p.x);
          c.setAttribute('cy', p.y);
          c.setAttribute('r', Math.max(2.5, strokeWidth));
          c.setAttribute('fill', stroke);
          g.appendChild(c);
        });
      }
      break;
    }

    // Architectural Elements
    case SHAPE_TYPES.WALL: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('fill', el.fill || '#30363d');
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      g.appendChild(rect);
      break;
    }

    case SHAPE_TYPES.DOOR: {
      // 90-degree swing arc door
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const r = Math.min(el.width, el.height);
      const d = `M ${el.x} ${el.y} L ${el.x + r} ${el.y} A ${r} ${r} 0 0 1 ${el.x} ${el.y + r} Z`;
      arc.setAttribute('d', d);
      arc.setAttribute('fill', 'rgba(139, 148, 158, 0.15)');
      arc.setAttribute('stroke', stroke);
      arc.setAttribute('stroke-width', strokeWidth);
      arc.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(arc);
      break;
    }

    case SHAPE_TYPES.SLIDING_DOOR: {
      const w = el.width || 80;
      const h = el.height || 20;

      // 1. Opening frame / guide line (開口枠・レール)
      const rail = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      rail.setAttribute('x1', el.x);
      rail.setAttribute('y1', el.y + h / 2);
      rail.setAttribute('x2', el.x + w);
      rail.setAttribute('y2', el.y + h / 2);
      rail.setAttribute('stroke', stroke);
      rail.setAttribute('stroke-width', '1');
      rail.setAttribute('stroke-dasharray', '3 3');
      rail.setAttribute('opacity', '0.6');
      g.appendChild(rail);

      // 2. Door jambs at both ends (左右の方立・枠受け)
      const jambL = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      jambL.setAttribute('x', el.x);
      jambL.setAttribute('y', el.y);
      jambL.setAttribute('width', 6);
      jambL.setAttribute('height', h);
      jambL.setAttribute('fill', stroke);
      g.appendChild(jambL);

      const jambR = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      jambR.setAttribute('x', el.x + w - 6);
      jambR.setAttribute('y', el.y);
      jambR.setAttribute('width', 6);
      jambR.setAttribute('height', h);
      jambR.setAttribute('fill', stroke);
      g.appendChild(jambR);

      // 3. Sliding door panel (スライド戸板)
      const panelW = Math.round(w * 0.55);
      const panelH = Math.max(6, Math.round(h * 0.35));
      const panelY = el.y + Math.round((h - panelH) / 2);
      const doorPanel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      doorPanel.setAttribute('x', el.x + 6);
      doorPanel.setAttribute('y', panelY);
      doorPanel.setAttribute('width', panelW);
      doorPanel.setAttribute('height', panelH);
      doorPanel.setAttribute('rx', 2);
      doorPanel.setAttribute('fill', el.fill && el.fill !== 'none' ? el.fill : '#ffffff');
      doorPanel.setAttribute('stroke', stroke);
      doorPanel.setAttribute('stroke-width', strokeWidth);
      g.appendChild(doorPanel);

      // 4. Slide direction indicator arrow (スライド方向矢印)
      const arrowY = panelY + panelH / 2;
      const arrowX1 = el.x + 6 + panelW + 4;
      const arrowX2 = el.x + w - 10;
      if (arrowX2 > arrowX1 + 8) {
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrow.setAttribute('d', `M ${arrowX1} ${arrowY} L ${arrowX2} ${arrowY} M ${arrowX2 - 4} ${arrowY - 3} L ${arrowX2} ${arrowY} L ${arrowX2 - 4} ${arrowY + 3}`);
        arrow.setAttribute('stroke', stroke);
        arrow.setAttribute('stroke-width', '1.5');
        arrow.setAttribute('fill', 'none');
        arrow.setAttribute('stroke-linecap', 'round');
        arrow.setAttribute('stroke-linejoin', 'round');
        g.appendChild(arrow);
      }
      break;
    }

    case SHAPE_TYPES.WINDOW: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('fill', '#1e293b');
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      g.appendChild(rect);

      // Glass divider line
      const midY = el.y + el.height / 2;
      const glass = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      glass.setAttribute('x1', el.x + 4);
      glass.setAttribute('y1', midY);
      glass.setAttribute('x2', el.x + el.width - 4);
      glass.setAttribute('y2', midY);
      glass.setAttribute('stroke', '#38bdf8');
      glass.setAttribute('stroke-width', 2);
      g.appendChild(glass);
      break;
    }

    case SHAPE_TYPES.PILLAR: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('fill', el.fill || '#21262d');
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      g.appendChild(rect);

      // Diagonal cross hatching
      const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l1.setAttribute('x1', el.x);
      l1.setAttribute('y1', el.y);
      l1.setAttribute('x2', el.x + el.width);
      l1.setAttribute('y2', el.y + el.height);
      l1.setAttribute('stroke', stroke);
      l1.setAttribute('stroke-width', 1);
      l1.setAttribute('opacity', '0.6');
      g.appendChild(l1);

      const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l2.setAttribute('x1', el.x + el.width);
      l2.setAttribute('y1', el.y);
      l2.setAttribute('x2', el.x);
      l2.setAttribute('y2', el.y + el.height);
      l2.setAttribute('stroke', stroke);
      l2.setAttribute('stroke-width', 1);
      l2.setAttribute('opacity', '0.6');
      g.appendChild(l2);
      break;
    }

    case SHAPE_TYPES.RACK: {
      // 19" Rack Cabinet
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', el.width);
      rect.setAttribute('height', el.height);
      rect.setAttribute('rx', 4);
      rect.setAttribute('fill', el.fill || '#161b22');
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
      g.appendChild(rect);

      // Mounting posts inside rack
      const uCount = 5;
      const step = (el.height - 24) / uCount;
      for (let i = 0; i < uCount; i++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        line.setAttribute('x', el.x + 8);
        line.setAttribute('y', el.y + 20 + i * step);
        line.setAttribute('width', el.width - 16);
        line.setAttribute('height', step - 4);
        line.setAttribute('fill', '#21262d');
        line.setAttribute('stroke', '#30363d');
        line.setAttribute('stroke-width', 1);
        g.appendChild(line);
      }

      // Title
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      title.setAttribute('x', el.x + el.width / 2);
      title.setAttribute('y', el.y + 14);
      title.setAttribute('text-anchor', 'middle');
      title.setAttribute('font-size', '10');
      title.setAttribute('font-weight', 'bold');
      title.setAttribute('fill', '#e6edf3');
      title.textContent = el.hostname || 'Rack';
      g.appendChild(title);
      renderDevicePortSockets(g, el, stroke);
      break;
    }

    // Network Devices
    default: {
      if (el.type.startsWith('device-')) {
        renderNetworkDevice(g, el, stroke, fill, strokeWidth, dashArray);
      }
      break;
    }
  }

  return g;
}

/**
 * Renders Network Devices with distinct SVGs and Host/IP labels
 */
function renderNetworkDevice(g, el, stroke, fill, strokeWidth, dashArray) {
  // Container Box
  const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  box.setAttribute('x', el.x);
  box.setAttribute('y', el.y);
  box.setAttribute('width', el.width);
  box.setAttribute('height', el.height);
  box.setAttribute('rx', 8);
  box.setAttribute('fill', fill);
  box.setAttribute('stroke', stroke);
  box.setAttribute('stroke-width', strokeWidth);
  box.setAttribute('stroke-dasharray', dashArray);
  g.appendChild(box);

  // Icon Badge Container (left or top)
  const iconG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  iconG.setAttribute('transform', `translate(${el.x + 10}, ${el.y + 10})`);

  let emoji = el.icon || '🌐';
  if (!el.icon) {
    if (el.type === SHAPE_TYPES.DEVICE_SWITCH) emoji = '🔀';
    else if (el.type === SHAPE_TYPES.DEVICE_SERVER) emoji = '🖥️';
    else if (el.type === SHAPE_TYPES.DEVICE_NAS) emoji = '💾';
    else if (el.type === SHAPE_TYPES.DEVICE_FIREWALL) emoji = '🛡️';
    else if (el.type === SHAPE_TYPES.DEVICE_AP) emoji = '📡';
    else if (el.type === SHAPE_TYPES.DEVICE_CLOUD) emoji = '☁️';
    else if (el.type === SHAPE_TYPES.DEVICE_PC) emoji = '💻';
    else if (el.type === SHAPE_TYPES.DEVICE_GENERIC) emoji = '🔲';
    else if (el.type === SHAPE_TYPES.DEVICE_VM) emoji = '🐳';
  }

  const isLightBg = isColorLight(fill);
  const textColor = el.textColor || (isLightBg ? '#0f172a' : '#ffffff');
  const subTextColor = el.textColor ? el.textColor : (isLightBg ? '#475569' : '#94a3b8');

  const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  iconText.setAttribute('x', '0');
  iconText.setAttribute('y', '18');
  iconText.setAttribute('font-size', '18');
  iconText.textContent = emoji;
  iconG.appendChild(iconText);
  g.appendChild(iconG);

  // Hostname
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  host.setAttribute('x', el.x + 36);
  host.setAttribute('y', el.y + 22);
  host.setAttribute('font-size', '11');
  host.setAttribute('font-weight', 'bold');
  host.setAttribute('fill', textColor);
  host.textContent = el.hostname || 'Device';
  g.appendChild(host);

  // IP Address
  if (el.ip) {
    const ip = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ip.setAttribute('x', el.x + 12);
    ip.setAttribute('y', el.y + 44);
    ip.setAttribute('font-size', '10');
    ip.setAttribute('font-family', 'monospace');
    ip.setAttribute('fill', subTextColor);
    ip.textContent = el.ip;
    g.appendChild(ip);
  }

  // Active status LED indicator
  const led = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  led.setAttribute('cx', el.x + el.width - 12);
  led.setAttribute('cy', el.y + 12);
  led.setAttribute('r', 3);
  led.setAttribute('fill', '#10b981');
  g.appendChild(led);

  // Distinct visual connection port sockets (Top, Right, Bottom, Left)
  renderDevicePortSockets(g, el, stroke);
}

/**
 * Renders distinct visual connection port sockets on element borders
 */
export function renderDevicePortSockets(g, el, stroke) {
  const ports = getConnectionPorts(el);
  if (!ports || ports.length === 0) return;

  ports.forEach(p => {
    const portG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    portG.setAttribute('class', 'device-port-socket');
    portG.setAttribute('data-side', p.side);

    // Outer socket tab
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', p.x - 5);
    rect.setAttribute('y', p.y - 5);
    rect.setAttribute('width', 10);
    rect.setAttribute('height', 10);
    rect.setAttribute('rx', 2.5);
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', '1.5');
    rect.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))';
    portG.appendChild(rect);

    // Inner connector pin
    const pin = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    pin.setAttribute('x', p.x - 2);
    pin.setAttribute('y', p.y - 2);
    pin.setAttribute('width', 4);
    pin.setAttribute('height', 4);
    pin.setAttribute('rx', 1);
    pin.setAttribute('fill', stroke);
    portG.appendChild(pin);

    g.appendChild(portG);
  });
}

/**
 * Computes bounding rectangle of an element
 */
export function getElementBounds(el) {
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
    x: el.x,
    y: el.y,
    width: el.width || 100,
    height: el.height || 60
  };
}

/**
 * Renders full diagram data to standalone SVG string (used for note embeds and export)
 */
export function renderDiagramToSvgString(diagramData) {
  const elements = diagramData.elements || [];
  if (elements.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120" class="opsnotes-canvas-svg" style="border-radius: 6px;"><text x="50%" y="55%" text-anchor="middle" fill="#8b949e" font-size="13">（空のキャンバス構成図）</text></svg>`;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  elements.forEach(el => {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  });

  const pad = 24;
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);

  // Render elements into temporary container
  const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tempSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  tempSvg.setAttribute('class', 'opsnotes-canvas-svg');
  tempSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  tempSvg.setAttribute('width', `${w}`);
  tempSvg.setAttribute('height', `${h}`);
  tempSvg.setAttribute('style', 'border-radius: 6px; font-family: sans-serif;');

  elements.forEach(el => {
    const node = renderElementToSvg(el);
    tempSvg.appendChild(node);
  });

  // Note embeds and standalone exports must NOT display interactive port sockets
  tempSvg.querySelectorAll('.device-port-socket').forEach(s => s.remove());

  return tempSvg.outerHTML;
}

/**
 * Renders connector terminal dots at cable endpoints
 */
function renderCableConnectors(g, points, stroke, strokeWidth) {
  points.forEach(p => {
    const r = Math.max(3.5, strokeWidth * 1.3);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    dot.setAttribute('r', r);
    dot.setAttribute('fill', stroke);
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '1.5');
    g.appendChild(dot);
  });
}

/**
 * Renders an inline pill badge for cable speed/label
 */
function renderCableLabelBadge(g, midX, midY, label, stroke) {
  const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  badgeG.setAttribute('class', 'cable-label-badge');

  // Estimate text width
  const textLen = label.length;
  const badgeW = Math.max(36, textLen * 7 + 14);
  const badgeH = 18;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', midX - badgeW / 2);
  rect.setAttribute('y', midY - badgeH / 2);
  rect.setAttribute('width', badgeW);
  rect.setAttribute('height', badgeH);
  rect.setAttribute('rx', '4');
  rect.setAttribute('fill', '#0f172a');
  rect.setAttribute('stroke', stroke);
  rect.setAttribute('stroke-width', '1.5');
  badgeG.appendChild(rect);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', midX);
  text.setAttribute('y', midY + 4);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', '600');
  text.setAttribute('fill', '#ffffff');
  text.textContent = label;
  badgeG.appendChild(text);

  g.appendChild(badgeG);
}


