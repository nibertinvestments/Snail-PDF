import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const TOOLS = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'highlight', label: 'Highlight', shortcut: 'H' },
  { id: 'draw', label: 'Draw', shortcut: 'D' },
];
const COLORS = { highlight: '#facc15', text: '#2563eb', draw: '#111827' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fileStem = (name) => (name || 'edited-document').replace(/\.pdf$/i, '');

function colorFromHex(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(full, 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function cloneAnnotations(value) {
  return value.map((item) => ({ ...item, points: item.points?.map((point) => ({ ...point })) }));
}

export default function App() {
  const inputRef = useRef(null);
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [fileName, setFileName] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [tool, setTool] = useState('select');
  const [noteText, setNoteText] = useState('New note');
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const annotations = history[historyIndex] || [];
  const pageAnnotations = useMemo(() => annotations.filter((item) => item.page === pageNumber), [annotations, pageNumber]);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const commit = useCallback((next) => {
    setHistory((current) => [...current.slice(0, historyIndex + 1), cloneAnnotations(next)]);
    setHistoryIndex((current) => current + 1);
    setSelectedId(null);
  }, [historyIndex]);

  const renderPage = useCallback(async () => {
    if (!pdf) return;
    renderTaskRef.current?.cancel();
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTaskRef.current = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await renderTaskRef.current.promise;
      setError('');
    } catch (renderError) {
      if (renderError?.name !== 'RenderingCancelledException') setError(renderError?.message || 'Unable to render this page.');
    }
  }, [pdf, pageNumber, scale]);

  useEffect(() => { renderPage(); return () => renderTaskRef.current?.cancel(); }, [renderPage]);

  const openPdf = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a valid PDF file.');
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      setSourceBytes(bytes);
      setPdf(document);
      setFileName(file.name);
      setPageNumber(1);
      setHistory([[]]);
      setHistoryIndex(0);
      setSelectedId(null);
      setDraft(null);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Unable to open this PDF.');
    } finally { setBusy(false); }
  };

  const pointFromEvent = (event) => {
    const bounds = pageRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return null;
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
  };

  const startPointer = (event) => {
    if (tool === 'select') { setSelectedId(null); return; }
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === 'text') {
      const text = noteText.trim() || 'New note';
      commit([...annotations, { id: id(), page: pageNumber, type: 'text', x: point.x, y: point.y, w: 0.3, h: 0.09, text, color: COLORS.text }]);
    } else if (tool === 'highlight') {
      setDraft({ type: 'highlight', page: pageNumber, startX: point.x, startY: point.y, x: point.x, y: point.y, w: 0, h: 0, color: COLORS.highlight });
    } else if (tool === 'draw') {
      setDraft({ type: 'draw', page: pageNumber, points: [point], color: COLORS.draw });
    }
  };

  const movePointer = (event) => {
    if (!draft) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (draft.type === 'highlight') {
      setDraft((current) => ({ ...current, x: Math.min(current.startX, point.x), y: Math.min(current.startY, point.y), w: Math.abs(point.x - current.startX), h: Math.abs(point.y - current.startY) }));
    } else {
      setDraft((current) => ({ ...current, points: [...current.points, point] }));
    }
  };

  const endPointer = () => {
    if (!draft) return;
    if (draft.type === 'highlight' && draft.w >= 0.005 && draft.h >= 0.005) commit([...annotations, { id: id(), page: draft.page, type: 'highlight', x: draft.x, y: draft.y, w: draft.w, h: draft.h, color: draft.color }]);
    if (draft.type === 'draw' && draft.points.length > 1) commit([...annotations, { id: id(), page: draft.page, type: 'draw', points: draft.points, color: draft.color }]);
    setDraft(null);
  };

  const undo = () => { if (canUndo) { setHistoryIndex((current) => current - 1); setSelectedId(null); } };
  const redo = () => { if (canRedo) { setHistoryIndex((current) => current + 1); setSelectedId(null); } };
  const removeSelected = () => { if (selectedId) commit(annotations.filter((item) => item.id !== selectedId)); };

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') removeSelected();
      else { const match = TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase()); if (match) setTool(match.id); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const buildPdf = async () => {
    if (!sourceBytes) throw new Error('Please open a PDF first.');
    const document = await PDFDocument.load(sourceBytes.slice());
    const byPage = new Map();
    annotations.forEach((item) => byPage.set(item.page, [...(byPage.get(item.page) || []), item]));
    for (const [pageIndex, items] of byPage) {
      const page = document.getPage(pageIndex - 1);
      const { width, height } = page.getSize();
      items.forEach((item) => {
        if (item.type === 'text') page.drawText(item.text, { x: item.x * width, y: height - (item.y + item.h) * height, size: Math.max(8, item.h * height * 0.72), color: colorFromHex(item.color) });
        if (item.type === 'highlight') page.drawRectangle({ x: item.x * width, y: height - (item.y + item.h) * height, width: item.w * width, height: item.h * height, color: colorFromHex(item.color), opacity: 0.38 });
        if (item.type === 'draw') item.points.slice(1).forEach((point, index) => page.drawLine({ start: { x: item.points[index].x * width, y: height - item.points[index].y * height }, end: { x: point.x * width, y: height - point.y * height }, thickness: 2.5, color: colorFromHex(item.color), opacity: 0.95 }));
      });
    }
    return document.save();
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const bytes = await buildPdf();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = `${fileStem(fileName)}-edited.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch (saveError) { setError(saveError?.message || 'Unable to save the edited PDF.'); }
    finally { setBusy(false); }
  };

  const printPdf = async () => {
    setBusy(true);
    try {
      const bytes = await buildPdf();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const printWindow = window.open(url, '_blank', 'noopener,noreferrer');
      if (!printWindow) throw new Error('Allow pop-ups to print the PDF.');
      const print = () => { printWindow.focus(); printWindow.print(); };
      printWindow.addEventListener('load', print, { once: true });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (printError) { setError(printError?.message || 'Unable to print the edited PDF.'); }
    finally { setBusy(false); }
  };

  const visibleAnnotations = [...pageAnnotations, ...(draft?.page === pageNumber ? [draft] : [])];
  return <div className="app-shell">
    <header className="topbar"><div><p className="eyebrow">Snail PDF</p><h1>PDF reader and editor</h1>{fileName && <p className="file-name">{fileName}</p>}</div><div className="actions-group"><button className="secondary" onClick={() => inputRef.current?.click()}>Open PDF</button><button className="secondary" onClick={undo} disabled={!canUndo} title="Ctrl/Cmd+Z">Undo</button><button className="secondary" onClick={redo} disabled={!canRedo} title="Ctrl/Cmd+Y">Redo</button><button className="secondary" onClick={printPdf} disabled={!pdf || busy}>Print</button><button className="primary" onClick={downloadPdf} disabled={!pdf || busy}>{busy ? 'Working…' : 'Save PDF'}</button><input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { openPdf(event.target.files?.[0]); event.target.value = ''; }} /></div></header>
    <div className="workspace"><aside className="sidebar"><section className="panel-card"><h2>Tools</h2><div className="tool-grid">{TOOLS.map((item) => <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => setTool(item.id)}>{item.label}<kbd>{item.shortcut}</kbd></button>)}</div>{tool === 'text' && <label className="field-label">Text<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows="3" /></label>}{selectedId && <button className="danger" onClick={removeSelected}>Delete selected</button>}</section><section className="panel-card"><h2>View</h2><div className="zoom-row"><button onClick={() => setScale((value) => clamp(value - 0.1, 0.5, 3))}>−</button><strong>{Math.round(scale * 100)}%</strong><button onClick={() => setScale((value) => clamp(value + 0.1, 0.5, 3))}>+</button></div>{pdf && <div className="page-nav"><button disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>‹</button><span>Page {pageNumber} / {pdf.numPages}</span><button disabled={pageNumber >= pdf.numPages} onClick={() => setPageNumber((value) => value + 1)}>›</button></div>}</section></aside>
      <main className="viewer-shell">{error && <div className="status-banner error">{error}</div>}{!pdf ? <div className="empty-state"><div className="empty-card"><h2>No PDF loaded</h2><p>Open a PDF to read, annotate, save, or print it.</p><button className="primary" onClick={() => inputRef.current?.click()}>Choose PDF</button></div></div> : <><div className="page-toolbar"><span>{tool === 'select' ? 'Click an annotation to select it' : `Click or drag to use ${tool}`}</span><span>{pageAnnotations.length} annotation{pageAnnotations.length === 1 ? '' : 's'}</span></div><div ref={pageRef} className={`page-container tool-${tool}`} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}><canvas ref={canvasRef} /><svg className="annotation-layer" viewBox="0 0 1 1" preserveAspectRatio="none">{visibleAnnotations.map((item) => item.type === 'highlight' ? <rect key={item.id} className={item.id === selectedId ? 'annotation selected' : 'annotation'} x={item.x} y={item.y} width={item.w} height={item.h} fill={item.color} fillOpacity=".38" onPointerDown={(event) => { event.stopPropagation(); setSelectedId(item.id); }} /> : item.type === 'text' ? <g key={item.id} className={item.id === selectedId ? 'annotation selected' : 'annotation'} onPointerDown={(event) => { event.stopPropagation(); setSelectedId(item.id); }}><rect x={item.x} y={item.y} width={item.w} height={item.h} fill="white" fillOpacity=".82" /><text x={item.x + .01} y={item.y + item.h * .72} fill={item.color} fontSize={item.h * .7}>{item.text}</text></g> : <polyline key={item.id} className={item.id === selectedId ? 'annotation selected' : 'annotation'} points={item.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={item.color} strokeWidth=".004" strokeLinecap="round" strokeLinejoin="round" onPointerDown={(event) => { event.stopPropagation(); setSelectedId(item.id); }} />)}</svg></div></>}</main>
    </div>
  </div>;
}
