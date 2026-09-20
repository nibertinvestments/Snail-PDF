import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const TOOL_OPTIONS = [
  { id: 'select', label: 'View' },
  { id: 'text', label: 'Text' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'draw', label: 'Draw' },
];

const COLORS = { highlight: '#facc15', text: '#2f6fed', draw: '#111827' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const buildId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const parsed = Number.parseInt(full, 16);
  return { r: ((parsed >> 16) & 255) / 255, g: ((parsed >> 8) & 255) / 255, b: (parsed & 255) / 255 };
}

function formatFileName(name) {
  return name?.replace(/\.pdf$/i, '') || 'edited-document';
}

function getSvgPath(points = []) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x * 100} ${point.y * 100}`).join(' ');
}

export default function App() {
  const fileInputRef = useRef(null);
  const pageContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [tool, setTool] = useState('select');
  const [noteText, setNoteText] = useState('New note');
  const [annotations, setAnnotations] = useState([]);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.page === pageNumber),
    [annotations, pageNumber],
  );

  useEffect(() => {
    if (!pdfDocument) return undefined;
    let canceled = false;
    let renderTask;
    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || canceled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await renderTask.promise;
        if (!canceled) setError('');
      } catch (renderError) {
        if (!canceled && renderError?.name !== 'RenderingCancelledException') {
          setError(renderError?.message || 'Unable to render the selected PDF page.');
        }
      }
    };
    renderPage();
    return () => { canceled = true; renderTask?.cancel(); };
  }, [pdfDocument, pageNumber, scale]);

  const openPdf = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a valid PDF file.');
      return;
    }
    try {
      const fileBytes = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBytes) }).promise;
      setPdfBytes(fileBytes);
      setPdfDocument(pdfDoc);
      setPageCount(pdfDoc.numPages);
      setPageNumber(1);
      setAnnotations([]);
      setDraftAnnotation(null);
      setFileName(file.name);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Unable to open this PDF.');
    }
  };

  const pointerPosition = (event) => {
    const bounds = pageContainerRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  };

  const startDraft = (event, type) => {
    const point = pointerPosition(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (type === 'text') {
      setAnnotations((current) => [...current, { id: buildId(), page: pageNumber, type, x: point.x, y: point.y, w: 0.28, h: 0.13, text: noteText.trim() || 'New note', color: COLORS.text }]);
    } else if (type === 'highlight') {
      setDraftAnnotation({ id: 'draft-highlight', page: pageNumber, type, startX: point.x, startY: point.y, x: point.x, y: point.y, w: 0, h: 0, color: COLORS.highlight });
    } else if (type === 'draw') {
      setDraftAnnotation({ id: 'draft-draw', page: pageNumber, type, color: COLORS.draw, points: [point] });
    }
  };

  const updateDraft = (event) => {
    if (!draftAnnotation) return;
    const point = pointerPosition(event);
    if (!point) return;
    if (draftAnnotation.type === 'highlight') {
      setDraftAnnotation((current) => ({ ...current, x: Math.min(current.startX, point.x), y: Math.min(current.startY, point.y), w: Math.abs(point.x - current.startX), h: Math.abs(point.y - current.startY) }));
    } else {
      setDraftAnnotation((current) => ({ ...current, points: [...current.points, point] }));
    }
  };

  const finalizeDraft = () => {
    if (!draftAnnotation) return;
    if (draftAnnotation.type === 'highlight' && draftAnnotation.w > 0.01 && draftAnnotation.h > 0.01) {
      setAnnotations((current) => [...current, { id: buildId(), page: draftAnnotation.page, type: 'highlight', x: draftAnnotation.x, y: draftAnnotation.y, w: draftAnnotation.w, h: draftAnnotation.h, color: draftAnnotation.color }]);
    } else if (draftAnnotation.type === 'draw' && draftAnnotation.points.length > 1) {
      setAnnotations((current) => [...current, { id: buildId(), page: draftAnnotation.page, type: 'draw', points: draftAnnotation.points, color: draftAnnotation.color }]);
    }
    setDraftAnnotation(null);
  };

  const exportPdf = async () => {
    if (!pdfBytes) return setError('Please upload a PDF before exporting.');
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const byPage = new Map();
      annotations.forEach((item) => byPage.set(item.page, [...(byPage.get(item.page) || []), item]));
      for (const [pageIndex, items] of byPage) {
        const page = pdfDoc.getPage(pageIndex - 1);
        const { width, height } = page.getSize();
        items.forEach((item) => {
          if (item.type === 'text') page.drawText(item.text, { x: item.x * width, y: height - item.y * height - item.h * height, size: 20, color: rgb(...Object.values(hexToRgb(item.color))) });
          if (item.type === 'highlight') page.drawRectangle({ x: item.x * width, y: height - item.y * height - item.h * height, width: item.w * width, height: item.h * height, color: rgb(...Object.values(hexToRgb(item.color))), opacity: 0.35 });
          if (item.type === 'draw') item.points.slice(1).forEach((point, index) => page.drawLine({ start: { x: item.points[index].x * width, y: height - item.points[index].y * height }, end: { x: point.x * width, y: height - point.y * height }, color: rgb(...Object.values(hexToRgb(item.color))), thickness: 2 }));
        });
      }
      const url = URL.createObjectURL(new Blob([await pdfDoc.save()], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = `${formatFileName(fileName)}-edited.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (saveError) { setError(saveError?.message || 'Unable to export the updated PDF.'); }
  };

  const pageAnnotations = [...currentPageAnnotations, draftAnnotation].filter((item) => item?.page === pageNumber);
  return (
    <div className="app-shell">
      <header className="topbar"><div><p className="eyebrow">Snail PDF</p><h1>PDF reader and editor</h1></div><div className="actions-group"><button className="secondary" onClick={() => fileInputRef.current?.click()}>Open PDF</button><input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => { openPdf(event.target.files?.[0]); event.target.value = ''; }} hidden /><button className="primary" onClick={exportPdf} disabled={!pdfBytes}>Download edited PDF</button></div></header>
      <div className="workspace"><aside className="sidebar"><div className="panel-card"><h2>Tools</h2><div className="tool-grid">{TOOL_OPTIONS.map((item) => <button key={item.id} className={item.id === tool ? 'tool-button active' : 'tool-button'} onClick={() => setTool(item.id)}>{item.label}</button>)}</div></div><div className="panel-card"><h2>Page controls</h2><div className="zoom-row"><button onClick={() => setScale((value) => clamp(Number((value - 0.1).toFixed(2)), 0.5, 3))}>−</button><span>{scale.toFixed(2)}×</span><button onClick={() => setScale((value) => clamp(Number((value + 0.1).toFixed(2)), 0.5, 3))}>+</button></div><div className="page-nav"><button onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber <= 1}>Prev</button><span>{pageNumber}/{pageCount || 0}</span><button onClick={() => setPageNumber((value) => Math.min(pageCount || 1, value + 1))} disabled={pageNumber >= pageCount}>Next</button></div></div><div className="panel-card"><h2>Note</h2><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={4} placeholder="Add a note" /></div></aside>
        <main className="viewer-shell">{error && <div className="status-banner error">{error}</div>}{!pdfDocument ? <div className="empty-state"><div className="empty-card"><h2>No PDF loaded</h2><p>Choose a PDF file to begin reading and editing.</p></div></div> : <div><div className="page-toolbar"><span>Page {pageNumber}</span><span>{annotations.length} mark(s)</span></div><div ref={pageContainerRef} className={`page-container tool-${tool}`} onPointerDown={(event) => tool !== 'select' && startDraft(event, tool)} onPointerMove={updateDraft} onPointerUp={finalizeDraft} onPointerCancel={finalizeDraft} onPointerLeave={finalizeDraft}><canvas ref={canvasRef} className="page-canvas" /><div className="annotation-layer">{pageAnnotations.map((item) => item.type === 'text' ? <div key={item.id} className="annotation text-annotation" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` }}>{item.text}</div> : item.type === 'highlight' ? <div key={item.id} className="annotation highlight-annotation" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%`, backgroundColor: item.color }} /> : <svg key={item.id} className="annotation draw-annotation" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={getSvgPath(item.points)} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>)}</div></div></div>}</main>
      </div>
    </div>
  );
}
