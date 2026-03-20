// Shared PDF Viewer Modal — loaded as type="module"
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

var pdfDoc = null;
var pdfPages = [];
var pdfPageNum = 1;
var pdfBaseScale = 1.0;
var pdfUserZoom = 1.0;
var pdfRotation = 0;
var pdfCurrentUrl = '';
var zoomBadgeTimer = null;
var scrollTracking = true;
var pageObserver = null;

function ensureModal() {
  if (document.getElementById('pdfModal')) return;

  var overlay = document.createElement('div');
  overlay.className = 'pdf-modal-overlay';
  overlay.id = 'pdfModal';
  overlay.innerHTML = '<div class="pdf-modal-toolbar">' +
    '<div class="pdf-modal-toolbar-left">' +
      '<span class="pdf-toolbar-title" id="pdfToolbarTitle">Document</span>' +
    '</div>' +
    '<div class="pdf-modal-toolbar-center">' +
      '<button class="pdf-nav-btn" id="pdfPrev" title="Previous page">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<span class="pdf-page-info">' +
        '<input type="number" id="pdfPageInput" class="pdf-page-input" min="1" value="1"> / <span id="pdfPageCount">1</span>' +
      '</span>' +
      '<button class="pdf-nav-btn" id="pdfNext" title="Next page">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>' +
      '<span style="width:1px;height:24px;background:rgba(255,255,255,0.2);margin:0 4px"></span>' +
      '<button class="pdf-nav-btn" id="pdfZoomOut" title="Zoom out">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>' +
      '</button>' +
      '<span class="pdf-zoom-label" id="pdfZoomLabel">100%</span>' +
      '<button class="pdf-nav-btn" id="pdfZoomIn" title="Zoom in">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>' +
      '</button>' +
      '<span style="width:1px;height:24px;background:rgba(255,255,255,0.2);margin:0 4px"></span>' +
      '<button class="pdf-nav-btn" id="pdfRotateBtn" title="Rotate page">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38L21.5 8"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="pdf-modal-toolbar-right">' +
      '<a id="pdfDownloadBtn" href="#" download class="pdf-nav-btn" title="Download PDF" style="text-decoration:none;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '</a>' +
      '<button class="pdf-modal-close" id="pdfCloseBtn" title="Close viewer">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
  '</div>' +
  '<div class="pdf-modal-canvas-wrap" id="pdfCanvasWrap"></div>' +
  '<div class="pdf-zoom-badge" id="pdfZoomBadge">100%</div>';

  document.body.appendChild(overlay);

  // Wire up toolbar buttons
  document.getElementById('pdfPrev').addEventListener('click', function() { pdfPrevPage(); });
  document.getElementById('pdfNext').addEventListener('click', function() { pdfNextPage(); });
  document.getElementById('pdfZoomOut').addEventListener('click', function() { pdfZoom(-0.25); });
  document.getElementById('pdfZoomIn').addEventListener('click', function() { pdfZoom(0.25); });
  document.getElementById('pdfRotateBtn').addEventListener('click', function() { pdfRotatePage(); });
  document.getElementById('pdfCloseBtn').addEventListener('click', function() { closePdfViewer(); });
  document.getElementById('pdfPageInput').addEventListener('change', function() { pdfGoToPage(this.value); });

  // Pinch-to-zoom
  var pinchStartDist = 0;
  var pinchStartZoom = 1;
  var canvasWrap = document.getElementById('pdfCanvasWrap');

  canvasWrap.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      pinchStartZoom = pdfUserZoom;
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      setZoom(pinchStartZoom * (dist / pinchStartDist));
    }
  }, { passive: false });

  // Ctrl+scroll zoom (desktop)
  canvasWrap.addEventListener('wheel', function(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(pdfUserZoom + (-e.deltaY * 0.01));
    }
  }, { passive: false });

  // Track current page from scroll position + lazy render nearby pages
  var scrollRenderTimer = null;
  canvasWrap.addEventListener('scroll', function() {
    if (!scrollTracking || !pdfDoc) return;
    var wrapRect = canvasWrap.getBoundingClientRect();
    var wrapCenter = wrapRect.top + wrapRect.height / 3;
    var pages = canvasWrap.querySelectorAll('.pdf-page');
    var closest = 1;
    var closestDist = Infinity;
    pages.forEach(function(p) {
      var rect = p.getBoundingClientRect();
      var dist = Math.abs(rect.top + rect.height / 3 - wrapCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closest = parseInt(p.dataset.pageNum);
      }
    });
    if (closest !== pdfPageNum) {
      pdfPageNum = closest;
      updatePageUI();
    }
    // Debounced lazy render of nearby pages + unload distant ones
    clearTimeout(scrollRenderTimer);
    scrollRenderTimer = setTimeout(function() { renderNearbyPages(pdfPageNum); }, 100);
  });
}

function injectStyles() {
  if (document.getElementById('pdfViewerStyles')) return;
  var style = document.createElement('style');
  style.id = 'pdfViewerStyles';
  style.textContent =
    '.pdf-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;flex-direction:column;backdrop-filter:blur(4px)}' +
    '.pdf-modal-overlay.active{display:flex}' +
    '.pdf-modal-toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#2e4032;color:#fff;flex-shrink:0;flex-wrap:wrap;gap:8px}' +
    '.pdf-modal-toolbar-left{display:flex;align-items:center;gap:12px;flex-shrink:0}' +
    '.pdf-modal-toolbar-center{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;min-width:0}' +
    '.pdf-modal-toolbar-right{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}' +
    '.pdf-toolbar-title{font-size:0.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}' +
    '.pdf-nav-btn{background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}' +
    '.pdf-nav-btn:hover{background:rgba(255,255,255,0.25)}' +
    '.pdf-nav-btn:disabled{opacity:0.4;cursor:default}' +
    '.pdf-nav-btn:disabled:hover{background:rgba(255,255,255,0.15)}' +
    '.pdf-page-info{font-size:0.8rem;white-space:nowrap;min-width:80px;text-align:center;color:#fff}' +
    '.pdf-page-input{width:40px;padding:4px;text-align:center;border:1px solid rgba(255,255,255,0.3);border-radius:3px;background:rgba(255,255,255,0.1);color:#fff;font-size:0.8rem}' +
    '.pdf-zoom-label{font-size:0.75rem;opacity:0.8}' +
    '.pdf-modal-canvas-wrap{flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px;background:#525659;position:relative}' +
    '.pdf-page{flex-shrink:0;position:relative;background:#e8e4de}' +
    '.pdf-page canvas{display:block;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:none}' +
    '.pdf-zoom-badge{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 20px;border-radius:20px;font-size:0.9rem;font-weight:500;letter-spacing:0.03em;pointer-events:none;z-index:10001;opacity:0;transition:opacity 0.25s ease;backdrop-filter:blur(8px);box-shadow:0 2px 12px rgba(0,0,0,0.3)}' +
    '.pdf-zoom-badge.visible{opacity:1}' +
    '.pdf-modal-close{background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}' +
    '.pdf-modal-close:hover{background:rgba(220,80,80,0.7)}' +
    '@media(max-width:768px){.pdf-toolbar-title{display:none}.pdf-modal-toolbar{padding:8px 8px;gap:4px}.pdf-modal-toolbar-center{gap:4px}.pdf-nav-btn{width:32px;height:32px}.pdf-modal-close{width:32px;height:32px}.pdf-modal-canvas-wrap{padding:10px;gap:10px}}';
  document.head.appendChild(style);
}

function calcFitScale(page) {
  var wrap = document.getElementById('pdfCanvasWrap');
  var availWidth = wrap.clientWidth - 40;
  var viewport = page.getViewport({ scale: 1.0, rotation: pdfRotation });
  return availWidth / viewport.width;
}

function updateZoomUI() {
  var pct = Math.round(pdfUserZoom * 100) + '%';
  var label = document.getElementById('pdfZoomLabel');
  var badge = document.getElementById('pdfZoomBadge');
  if (label) label.textContent = pct;
  if (badge) {
    badge.textContent = pct;
    badge.classList.add('visible');
    clearTimeout(zoomBadgeTimer);
    zoomBadgeTimer = setTimeout(function() { badge.classList.remove('visible'); }, 1200);
  }
}

function updatePageUI() {
  document.getElementById('pdfPageInput').value = pdfPageNum;
  document.getElementById('pdfPrev').disabled = (pdfPageNum <= 1);
  document.getElementById('pdfNext').disabled = (!pdfDoc || pdfPageNum >= pdfDoc.numPages);
}

// Render a single page's canvas
function renderPageCanvas(page, canvas, viewport) {
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  page.render({ canvasContext: ctx, viewport: viewport });
}

// Unload a page's canvas to free memory (keep div dimensions for scroll stability)
function unloadPage(pageDiv) {
  if (!pageDiv.dataset.rendered) return;
  var canvas = pageDiv.querySelector('canvas');
  if (canvas) {
    // Replace canvas with a fresh one to release GPU memory
    var newCanvas = document.createElement('canvas');
    pageDiv.replaceChild(newCanvas, canvas);
  }
  delete pageDiv.dataset.rendered;
}

// Render a page by number if not already rendered
function renderPageByNum(num) {
  var wrap = document.getElementById('pdfCanvasWrap');
  var pageDiv = wrap.querySelector('[data-page-num="' + num + '"]');
  if (!pageDiv || pageDiv.dataset.rendered || !pdfPages[num - 1]) return;
  var page = pdfPages[num - 1];
  var scale = pdfBaseScale * pdfUserZoom;
  var viewport = page.getViewport({ scale: scale, rotation: pdfRotation });
  renderPageCanvas(page, pageDiv.querySelector('canvas'), viewport);
  pageDiv.dataset.rendered = '1';
}

// Render pages near the current page, unload distant ones
function renderNearbyPages(currentNum) {
  if (!pdfPages.length || !pdfDoc) return;
  var wrap = document.getElementById('pdfCanvasWrap');
  var buffer = 3; // Render 3 pages ahead/behind
  var unloadDist = 8; // Unload pages more than 8 away

  for (var i = 1; i <= pdfDoc.numPages; i++) {
    var dist = Math.abs(i - currentNum);
    if (dist <= buffer) {
      renderPageByNum(i);
    } else if (dist > unloadDist) {
      var pageDiv = wrap.querySelector('[data-page-num="' + i + '"]');
      if (pageDiv) unloadPage(pageDiv);
    }
  }
}

// Set up IntersectionObserver for lazy rendering / unloading
function setupPageObserver() {
  var wrap = document.getElementById('pdfCanvasWrap');
  if (pageObserver) pageObserver.disconnect();

  pageObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      var pageDiv = entry.target;
      var num = parseInt(pageDiv.dataset.pageNum);
      if (entry.isIntersecting) {
        renderPageByNum(num);
        // Also pre-render adjacent pages
        if (num > 1) renderPageByNum(num - 1);
        if (num < pdfDoc.numPages) renderPageByNum(num + 1);
      } else {
        // Unload distant pages to free memory (keep a buffer of 3 pages)
        var dist = Math.abs(num - pdfPageNum);
        if (dist > 5) unloadPage(pageDiv);
      }
    });
  }, { root: wrap, rootMargin: '2000px 0px' });

  wrap.querySelectorAll('.pdf-page').forEach(function(p) {
    pageObserver.observe(p);
  });

  // Fallback: explicitly render first few pages in case observer doesn't fire
  for (var i = 1; i <= Math.min(3, pdfDoc.numPages); i++) {
    renderPageByNum(i);
  }
}

function buildPages() {
  var wrap = document.getElementById('pdfCanvasWrap');
  wrap.innerHTML = '';

  var pagePromises = [];
  for (var i = 1; i <= pdfDoc.numPages; i++) {
    pagePromises.push(pdfDoc.getPage(i));
  }

  Promise.all(pagePromises).then(function(pages) {
    pdfPages = pages;
    pdfBaseScale = calcFitScale(pages[0]);
    var scale = pdfBaseScale * pdfUserZoom;

    // Create placeholder divs with correct dimensions (no canvas rendering yet)
    pages.forEach(function(page, idx) {
      var num = idx + 1;
      var viewport = page.getViewport({ scale: scale, rotation: pdfRotation });

      var pageDiv = document.createElement('div');
      pageDiv.className = 'pdf-page';
      pageDiv.dataset.pageNum = num;
      pageDiv.style.width = viewport.width + 'px';
      pageDiv.style.height = viewport.height + 'px';

      var canvas = document.createElement('canvas');
      pageDiv.appendChild(canvas);
      wrap.appendChild(pageDiv);
    });

    // Let IntersectionObserver handle rendering visible pages
    setupPageObserver();
    updatePageUI();
  });
}

function rerenderPages() {
  if (!pdfPages.length) return;
  var wrap = document.getElementById('pdfCanvasWrap');
  pdfBaseScale = calcFitScale(pdfPages[0]);
  var scale = pdfBaseScale * pdfUserZoom;

  // Update all placeholder sizes, clear rendered state
  pdfPages.forEach(function(page, idx) {
    var num = idx + 1;
    var viewport = page.getViewport({ scale: scale, rotation: pdfRotation });
    var pageDiv = wrap.querySelector('[data-page-num="' + num + '"]');
    if (!pageDiv) return;
    pageDiv.style.width = viewport.width + 'px';
    pageDiv.style.height = viewport.height + 'px';
    unloadPage(pageDiv);
  });

  // Re-render nearby pages with new scale, re-observe for future scrolls
  renderNearbyPages(pdfPageNum);
  setupPageObserver();
}

function scrollToPage(num) {
  var wrap = document.getElementById('pdfCanvasWrap');
  var pageDiv = wrap.querySelector('[data-page-num="' + num + '"]');
  // Render target + nearby pages before scrolling
  renderNearbyPages(num);
  if (pageDiv) {
    scrollTracking = false;
    pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function() { scrollTracking = true; }, 600);
  }
  pdfPageNum = num;
  updatePageUI();
}

function setZoom(newZoom) {
  newZoom = Math.max(0.5, Math.min(5, newZoom));
  newZoom = Math.round(newZoom * 100) / 100;
  if (newZoom === pdfUserZoom) return;
  pdfUserZoom = newZoom;
  updateZoomUI();
  if (pdfDoc) rerenderPages();
}

function openPdfViewer(url, title) {
  injectStyles();
  ensureModal();
  document.getElementById('pdfToolbarTitle').textContent = title || 'Document';
  document.getElementById('pdfDownloadBtn').href = url;
  document.getElementById('pdfModal').classList.add('active');
  document.body.style.overflow = 'hidden';

  if (pdfCurrentUrl !== url) {
    pdfDoc = null;
    pdfPages = [];
    pdfPageNum = 1;
    pdfBaseScale = 1.0;
    pdfUserZoom = 1.0;
    pdfRotation = 0;
    pdfCurrentUrl = url;
    updateZoomUI();
    pdfjsLib.getDocument(url).promise.then(function(doc) {
      pdfDoc = doc;
      document.getElementById('pdfPageCount').textContent = doc.numPages;
      document.getElementById('pdfPageInput').max = doc.numPages;
      buildPages();
    });
  } else {
    pdfBaseScale = 1.0;
    pdfUserZoom = 1.0;
    pdfRotation = 0;
    updateZoomUI();
    document.getElementById('pdfCanvasWrap').scrollTop = 0;
    rerenderPages();
  }
}

function closePdfViewer() {
  var modal = document.getElementById('pdfModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  var badge = document.getElementById('pdfZoomBadge');
  if (badge) badge.classList.remove('visible');
}

function pdfPrevPage() {
  if (pdfPageNum <= 1) return;
  scrollToPage(pdfPageNum - 1);
}

function pdfNextPage() {
  if (!pdfDoc || pdfPageNum >= pdfDoc.numPages) return;
  scrollToPage(pdfPageNum + 1);
}

function pdfGoToPage(val) {
  var num = parseInt(val, 10);
  if (!pdfDoc || isNaN(num) || num < 1 || num > pdfDoc.numPages) return;
  scrollToPage(num);
}

function pdfZoom(delta) {
  setZoom(pdfUserZoom + delta);
}

function pdfRotatePage() {
  pdfRotation = (pdfRotation + 90) % 360;
  pdfBaseScale = 1.0;
  if (pdfDoc) rerenderPages();
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  var modal = document.getElementById('pdfModal');
  if (!modal || !modal.classList.contains('active')) return;
  if (e.key === 'Escape') { closePdfViewer(); return; }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') pdfPrevPage();
  if (e.key === 'ArrowRight') pdfNextPage();
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(pdfUserZoom + 0.25); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(pdfUserZoom - 0.25); }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom(1.0); }
});

// Export to global scope
window.openPdfViewer = openPdfViewer;
window.closePdfViewer = closePdfViewer;
window.pdfPrevPage = pdfPrevPage;
window.pdfNextPage = pdfNextPage;
window.pdfGoToPage = pdfGoToPage;
window.pdfZoom = pdfZoom;
window.pdfRotatePage = pdfRotatePage;
