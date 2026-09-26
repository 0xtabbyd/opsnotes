/**
 * OpsNotes v0.4 - draw.io Embed Integration Module
 * Embeds official diagrams.net (draw.io) via iframe postMessage protocol
 * Enables complete, enterprise-grade diagramming for networks, servers, and topologies
 */

let toastFn = null;

let currentCallback = null;
let currentXml = '';
let lastSavedXml = '';
let currentTitle = 'ネットワーク構成図';
let isIframeReady = false;

// Official diagrams.net embed URL with Japanese UI, atlas theme, spin indicator, and library sidebar
const DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&ui=atlas&spin=1&proto=json&configure=1&lang=ja&libraries=1&noSaveBtn=0&saveAndExit=1';
// postMessage受信時に送信元を検証するためのオリジン
const DRAWIO_ORIGIN = 'https://embed.diagrams.net';

export function initDrawioModal(opts = {}) {
  if (opts && opts.showToast) toastFn = opts.showToast;
  const modalOverlay = document.getElementById('drawioModalOverlay');
  const btnClose = document.getElementById('btnCloseDrawioModal');
  const btnSave = document.getElementById('btnSaveDrawioToNote');
  const iframe = document.getElementById('drawioEmbedFrame');
  const titleInput = document.getElementById('drawioDiagramTitle');

  if (!modalOverlay || !iframe) return;

  // 1. Close Modal Handlers
  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeDrawioModal();
    });
  }

  // 2. Save Button on Topbar (Requests export from draw.io)
  if (btnSave) {
    btnSave.addEventListener('click', (e) => {
      e.preventDefault();
      requestDrawioExport();
    });
  }

  // 3. Close on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.style.display !== 'none') {
      closeDrawioModal();
    }
  });

  // 4. Listen for postMessage from draw.io embed
  window.addEventListener('message', (event) => {
    // 送信元がdraw.ioのiframeであることを確認する。
    // 検証しないと任意のサイト/iframeから偽メッセージを注入され、
    // 意図しない図データの読み込み・保存を誘発されうる。
    if (event.origin !== DRAWIO_ORIGIN) return;
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || typeof event.data !== 'string') return;

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    handleDrawioMessage(msg, iframe, modalOverlay, titleInput);
  });
}

function handleDrawioMessage(msg, iframe, modalOverlay, titleInput) {
  const loadingIndicator = document.getElementById('drawioLoadingIndicator');

  switch (msg.event) {
    case 'init': {
      isIframeReady = true;
      if (loadingIndicator) loadingIndicator.style.display = 'none';

      // Load initial XML or empty diagram
      iframe.contentWindow.postMessage(JSON.stringify({
        action: 'load',
        autosave: 1,
        xml: currentXml || ''
      }), DRAWIO_ORIGIN);
      break;
    }

    case 'configure': {
      // Configure default libraries (network, AWS, GCP, Cisco, flowchart, etc.)
      iframe.contentWindow.postMessage(JSON.stringify({
        action: 'configure',
        config: {
          defaultLibraries: 'general;uml;er;bpmn;flowchart;basic;arrows2;cisco;aws4;azure;gcp2'
        }
      }), DRAWIO_ORIGIN);
      break;
    }

    case 'save': {
      // User clicked 'Save' inside draw.io!
      lastSavedXml = msg.xml || '';
      iframe.contentWindow.postMessage(JSON.stringify({
        action: 'export',
        format: 'xmlsvg'
      }), DRAWIO_ORIGIN);
      break;
    }

    case 'export': {
      // Received exported SVG with embedded XML
      const rawData = msg.data || '';
      const xmlData = msg.xml || lastSavedXml || '';
      handleExportComplete(rawData, xmlData, titleInput);
      break;
    }

    case 'exit': {
      // User clicked Exit inside draw.io
      closeDrawioModal();
      break;
    }
  }
}

function requestDrawioExport() {
  const iframe = document.getElementById('drawioEmbedFrame');
  if (!iframe || !iframe.contentWindow) return;

  const btnSave = document.getElementById('btnSaveDrawioToNote');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';
  }

  // Request SVG export containing XML
  iframe.contentWindow.postMessage(JSON.stringify({
    action: 'export',
    format: 'xmlsvg'
  }), DRAWIO_ORIGIN);
}

function handleExportComplete(svgDataUri, xmlString, titleInput) {
  const btnSave = document.getElementById('btnSaveDrawioToNote');
  if (btnSave) {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存してメモに挿入';
  }

  const svgString = decodeSvgData(svgDataUri);
  const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : currentTitle;

  const diagramData = {
    version: '1.0',
    type: 'drawio',
    title: title || 'ネットワーク構成図',
    updatedAt: new Date().toISOString(),
    xml: xmlString,
    svg: svgString
  };

  if (typeof currentCallback === 'function') {
    currentCallback(diagramData);
  }

  closeDrawioModal();
  if (toastFn) toastFn('draw.io 構成図をメモに保存・反映しました', 'success');
}

export function openDrawioModal(options = {}, callback = null) {
  const modalOverlay = document.getElementById('drawioModalOverlay');
  const iframe = document.getElementById('drawioEmbedFrame');
  const titleInput = document.getElementById('drawioDiagramTitle');
  const loadingIndicator = document.getElementById('drawioLoadingIndicator');

  if (!modalOverlay || !iframe) return;

  currentCallback = callback;
  currentXml = options.xml || '';
  lastSavedXml = currentXml;
  currentTitle = options.title || 'ネットワーク構成図';

  if (titleInput) {
    titleInput.value = currentTitle;
  }

  modalOverlay.style.display = 'flex';
  if (loadingIndicator) loadingIndicator.style.display = 'flex';

  // Always reload iframe to guarantee clean state
  iframe.src = DRAWIO_EMBED_URL;
}

export function openDrawioWithData(diagramData, callback) {
  openDrawioModal({
    xml: diagramData.xml || '',
    title: diagramData.title || 'ネットワーク構成図'
  }, callback);
}

export function closeDrawioModal() {
  const modalOverlay = document.getElementById('drawioModalOverlay');
  const iframe = document.getElementById('drawioEmbedFrame');

  if (modalOverlay) modalOverlay.style.display = 'none';
  if (iframe) iframe.src = 'about:blank';

  currentCallback = null;
  currentXml = '';
  lastSavedXml = '';
}

function decodeSvgData(dataStr) {
  if (!dataStr) return '';
  if (dataStr.startsWith('data:image/svg+xml;base64,')) {
    try {
      const b64 = dataStr.substring('data:image/svg+xml;base64,'.length);
      const binStr = atob(b64);
      const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (e) {
      console.error('Failed to decode base64 SVG:', e);
      return '';
    }
  } else if (dataStr.startsWith('data:image/svg+xml,')) {
    return decodeURIComponent(dataStr.substring('data:image/svg+xml,'.length));
  } else if (dataStr.trim().startsWith('<svg')) {
    return dataStr;
  }
  return dataStr;
}
