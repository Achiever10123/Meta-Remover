import { useState, useCallback, useRef, useEffect } from 'react';
import { readMetadata, FileMetadata, MetadataEntry, getCategoryLabel, formatFileSize } from './utils/metadataReader';
import { removeMetadata, getCleanedFilename, RemovalOptions, DEFAULT_OPTIONS } from './utils/metadataRemover';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// Fix leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// SVG filter for liquid glass refraction (Chromium only)
function LiquidGlassSVG() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <filter id="liquid-glass-refraction">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" result="noise" seed="5" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

// Detect Chromium
function isChromium(): boolean {
  return /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
}

// Theme hook
function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('metawipe-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    document.documentElement.className = dark ? 'dark' : 'light';
    localStorage.setItem('metawipe-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return { dark, toggle: () => setDark(d => !d) };
}

// Mouse tracking for liquid glass
function useMouseTracking(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--mouse-x', `${x}%`);
      el.style.setProperty('--mouse-y', `${y}%`);
    };
    el.addEventListener('mousemove', handler);
    return () => el.removeEventListener('mousemove', handler);
  }, [ref]);
}

// File type helpers
function getFileCategory(file: File): 'image' | 'pdf' | 'office' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf';
  return 'office';
}

function getBadgeClass(cat: string): string {
  if (cat === 'image') return 'badge-image';
  if (cat === 'pdf') return 'badge-pdf';
  return 'badge-office';
}

function getFileIcon(file: File): string {
  const cat = getFileCategory(file);
  if (cat === 'image') return 'fa-image';
  if (cat === 'pdf') return 'fa-file-pdf';
  return 'fa-file-word';
}

// Main App
export default function App() {
  const { dark, toggle: toggleTheme } = useTheme();
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [removalOptions, setRemovalOptions] = useState<RemovalOptions>(DEFAULT_OPTIONS);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [selectiveMode, setSelectiveMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useMouseTracking(containerRef);

  const chromium = isChromium();

  const handleFiles = useCallback(async (newFiles: FileList | File[]) => {
    const fileArr = Array.from(newFiles);
    setProcessing(true);

    const results: FileMetadata[] = [];
    for (const file of fileArr) {
      try {
        const meta = await readMetadata(file);
        results.push(meta);
      } catch (err) {
        console.error('Error reading metadata:', err);
        results.push({
          file,
          entries: [{ key: 'Error', value: 'Failed to read metadata', category: 'file', removable: false }],
          hasExif: false,
          hasIptc: false,
          hasXmp: false,
          fileSize: file.size,
          mimeType: file.type,
        });
      }
    }

    setFiles(prev => [...prev, ...results]);
    if (results.length > 0 && selectedIdx === -1) {
      setSelectedIdx(files.length);
    }
    setProcessing(false);
  }, [files.length, selectedIdx]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleClean = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);

    const opts: Partial<RemovalOptions> = { ...removalOptions };
    if (selectiveMode) {
      opts.selectedFields = Array.from(selectedFields);
    }

    if (files.length === 1) {
      // Single file download
      const meta = files[0];
      try {
        const cleaned = await removeMetadata(meta.file, opts);
        const name = getCleanedFilename(meta.file.name);
        saveAs(cleaned, name);
      } catch (err) {
        console.error('Clean error:', err);
      }
    } else {
      // Batch - ZIP download
      const zip = new JSZip();
      for (const meta of files) {
        try {
          const cleaned = await removeMetadata(meta.file, opts);
          const name = getCleanedFilename(meta.file.name);
          zip.file(name, cleaned);
        } catch (err) {
          console.error('Clean error for', meta.file.name, err);
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'metawipe-cleaned.zip');
    }

    setProcessing(false);
  }, [files, removalOptions, selectiveMode, selectedFields]);

  const handleCleanSeparate = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);

    const opts: Partial<RemovalOptions> = { ...removalOptions };

    for (const meta of files) {
      try {
        const cleaned = await removeMetadata(meta.file, opts);
        const name = getCleanedFilename(meta.file.name);
        saveAs(cleaned, name);
      } catch (err) {
        console.error('Clean error:', err);
      }
    }

    setProcessing(false);
  }, [files, removalOptions]);

  const clearFiles = () => {
    setFiles([]);
    setSelectedIdx(-1);
    setSelectedFields(new Set());
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(-1);
    else if (selectedIdx > idx) setSelectedIdx(prev => prev - 1);
  };

  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllFields = () => {
    const file = selectedIdx >= 0 ? files[selectedIdx] : null;
    if (!file) return;
    const allRemovable = file.entries.filter(e => e.removable).map(e => e.key);
    setSelectedFields(new Set(allRemovable));
  };

  const deselectAllFields = () => setSelectedFields(new Set());

  const selectedFile = selectedIdx >= 0 ? files[selectedIdx] : null;
  const totalRemovableFields = selectedFile?.entries.filter(e => e.removable).length || 0;

  // Group entries by category
  const groupedEntries = selectedFile
    ? selectedFile.entries.reduce((acc, entry) => {
        if (!acc[entry.category]) acc[entry.category] = [];
        acc[entry.category].push(entry);
        return acc;
      }, {} as Record<string, MetadataEntry[]>)
    : {};

  return (
    <div ref={containerRef} className={`min-h-screen ${chromium ? 'chromium-glass' : ''}`} style={{ background: dark ? 'var(--bg-primary)' : 'var(--bg-primary)' }}>
      <LiquidGlassSVG />

      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: dark
          ? 'radial-gradient(ellipse at 20% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(168, 85, 247, 0.06) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(59, 130, 246, 0.05) 0%, transparent 50%)'
          : 'radial-gradient(ellipse at 20% 50%, rgba(99, 102, 241, 0.06) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(168, 85, 247, 0.04) 0%, transparent 50%)'
      }} />

      {/* Header */}
      <header className="liquid-glass mx-4 mt-4 px-6 py-3 flex items-center justify-between" style={{ borderRadius: '12px' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
            <i className="fa-solid fa-shield-halved text-white text-sm" />
          </div>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            MetaWipe
          </h1>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            Local-First
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <i className="fa-solid fa-lock mr-1" />
            100% Browser-Based
          </span>
          <button onClick={toggleTheme} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            <i className={`fa-solid ${dark ? 'fa-sun' : 'fa-moon'} text-sm`} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex gap-4 p-4" style={{ height: 'calc(100vh - 80px)' }}>
        {/* Left Panel - File List & Drop Zone */}
        <div className="flex flex-col gap-4" style={{ width: '280px', minWidth: '280px' }}>
          {/* Drop Zone */}
          <div
            className={`liquid-glass p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${dragActive ? 'drag-active' : ''}`}
            style={{ minHeight: '160px', borderRadius: '16px' }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
              <i className="fa-solid fa-cloud-arrow-up text-xl" style={{ color: '#818cf8' }} />
            </div>
            <p className="text-sm font-medium text-center" style={{ color: 'var(--text-primary)' }}>
              Drop files here
            </p>
            <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-secondary)' }}>
              Images, PDF, Office docs
            </p>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="liquid-glass flex-1 overflow-hidden flex flex-col" style={{ borderRadius: '16px' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  FILES ({files.length})
                </span>
                <button onClick={clearFiles} className="text-xs px-2 py-1 rounded transition-colors" style={{ color: 'var(--danger)' }}>
                  <i className="fa-solid fa-trash-can mr-1" />Clear
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {files.map((meta, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${idx === selectedIdx ? 'ring-1' : ''}`}
                    style={{
                      background: idx === selectedIdx ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                      border: idx === selectedIdx ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid transparent',
                    }}
                    onClick={() => setSelectedIdx(idx)}
                  >
                    <i className={`fa-solid ${getFileIcon(meta.file)} text-sm`} style={{ color: 'var(--text-secondary)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{meta.file.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(meta.fileSize)}</p>
                    </div>
                    <span className={`badge ${getBadgeClass(getFileCategory(meta.file))}`}>
                      {getFileCategory(meta.file)}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="opacity-0 group-hover:opacity-100 text-xs p-1" style={{ color: 'var(--text-secondary)' }}>
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center - Metadata Display */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {selectedFile ? (
            <>
              {/* File Preview & Quick Info */}
              <div className="liquid-glass p-4 flex items-center gap-4" style={{ borderRadius: '16px' }}>
                {selectedFile.thumbnail && (
                  <img src={selectedFile.thumbnail} alt="Thumbnail" className="w-16 h-16 rounded-lg object-cover" style={{ border: '1px solid var(--glass-border)' }} />
                )}
                <div className="flex-1">
                  <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{selectedFile.file.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(selectedFile.fileSize)}</span>
                    {selectedFile.hasExif && <span className="badge badge-image">EXIF</span>}
                    {selectedFile.hasIptc && <span className="badge badge-pdf">IPTC</span>}
                    {selectedFile.hasXmp && <span className="badge badge-office">XMP</span>}
                    {selectedFile.gps && <span className="badge badge-image"><i className="fa-solid fa-location-dot mr-1" />GPS</span>}
                  </div>
                </div>
              </div>

              {/* Selective Mode Controls */}
              {selectiveMode && totalRemovableFields > 0 && (
                <div className="liquid-glass px-4 py-2 flex items-center justify-between" style={{ borderRadius: '12px' }}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {selectedFields.size} / {totalRemovableFields} fields selected
                  </span>
                  <div className="flex gap-2">
                    <button onClick={selectAllFields} className="text-[10px] px-2 py-1 rounded transition-colors" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                      Select All
                    </button>
                    <button onClick={deselectAllFields} className="text-[10px] px-2 py-1 rounded transition-colors" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' }}>
                      Deselect All
                    </button>
                  </div>
                </div>
              )}

              {/* Metadata Tables */}
              <div className="flex-1 overflow-y-auto space-y-3">
                {Object.entries(groupedEntries).map(([category, entries]) => (
                  <div key={category} className="liquid-glass overflow-hidden" style={{ borderRadius: '12px' }}>
                    <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.1)' }}>
                      <i className={`fa-solid ${category === 'exif' ? 'fa-camera' : category === 'iptc' ? 'fa-newspaper' : category === 'xmp' ? 'fa-code' : category === 'gps' ? 'fa-location-dot' : category === 'pdf' ? 'fa-file-pdf' : 'fa-file'} text-xs`} style={{ color: 'var(--accent)' }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        {getCategoryLabel(category)}
                      </span>
                      <span className="text-[10px] ml-auto px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                        {entries.length} fields
                      </span>
                    </div>
                    <table className="meta-table">
                      <tbody>
                        {entries.map((entry, i) => (
                          <tr key={i} className={`${selectiveMode && entry.removable ? 'cursor-pointer hover:bg-white/5' : ''}`} onClick={() => selectiveMode && entry.removable && toggleField(entry.key)}>
                            {selectiveMode && entry.removable && (
                              <td style={{ width: '20px', padding: '4px 0 4px 8px' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedFields.has(entry.key)}
                                  onChange={() => toggleField(entry.key)}
                                  className="w-3 h-3 rounded"
                                  style={{ accentColor: 'var(--accent)' }}
                                />
                              </td>
                            )}
                            <td>{entry.key}</td>
                            <td>{String(entry.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                {Object.keys(groupedEntries).length === 0 && (
                  <div className="liquid-glass p-8 text-center" style={{ borderRadius: '12px' }}>
                    <i className="fa-solid fa-circle-check text-3xl mb-3" style={{ color: 'var(--success)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No metadata found in this file</p>
                  </div>
                )}
              </div>
            </>
          ) : files.length > 0 ? (
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-1">
                {files.map((meta, idx) => (
                  <div
                    key={idx}
                    className="liquid-glass p-3 cursor-pointer transition-all hover:scale-[1.02] animate-fade-in"
                    style={{ borderRadius: '12px', animationDelay: `${idx * 50}ms` }}
                    onClick={() => setSelectedIdx(idx)}
                  >
                    {meta.thumbnail ? (
                      <img src={meta.thumbnail} alt="" className="w-full h-24 object-cover rounded-lg mb-2" style={{ border: '1px solid var(--glass-border)' }} />
                    ) : (
                      <div className="w-full h-24 rounded-lg mb-2 flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.1)' }}>
                        <i className={`fa-solid ${getFileIcon(meta.file)} text-2xl`} style={{ color: '#818cf8' }} />
                      </div>
                    )}
                    <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{meta.file.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(meta.fileSize)}</span>
                      <div className="flex gap-1">
                        {meta.hasExif && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#818cf8' }} title="Has EXIF" />}
                        {meta.hasIptc && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#f87171' }} title="Has IPTC" />}
                        {meta.hasXmp && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} title="Has XMP" />}
                        {meta.gps && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fbbf24' }} title="Has GPS" />}
                      </div>
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {meta.entries.filter(e => e.removable).length} removable fields
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.1)' }}>
                  <i className="fa-solid fa-file-shield text-3xl" style={{ color: '#818cf8' }} />
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No file selected</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Drop files or click the upload area to get started</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="flex flex-col gap-4" style={{ width: '300px', minWidth: '300px' }}>
          {/* GPS Map */}
          {selectedFile?.gps && (
            <div className="liquid-glass overflow-hidden" style={{ borderRadius: '16px', height: '220px' }}>
              <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <i className="fa-solid fa-map-location-dot text-xs" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>GPS Location</span>
              </div>
              <div style={{ height: '180px' }}>
                <MapContainer
                  center={[selectedFile.gps.latitude, selectedFile.gps.longitude]}
                  zoom={13}
                  style={{ height: '100%', width: '100%', borderRadius: '0 0 16px 16px' }}
                  zoomControl={false}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <Marker position={[selectedFile.gps.latitude, selectedFile.gps.longitude]}>
                    <Popup>
                      <div className="text-xs">
                        <strong>Lat:</strong> {selectedFile.gps.latitude.toFixed(6)}<br />
                        <strong>Lng:</strong> {selectedFile.gps.longitude.toFixed(6)}
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </div>
          )}

          {/* Removal Options */}
          <div className="liquid-glass p-4 flex-1 overflow-y-auto" style={{ borderRadius: '16px' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
              <i className="fa-solid fa-eraser mr-2" />Removal Options
            </h3>

            <div className="space-y-3">
              <OptionToggle label="EXIF Data" checked={removalOptions.removeExif} onChange={(v) => setRemovalOptions(o => ({ ...o, removeExif: v }))} />
              <OptionToggle label="IPTC Data" checked={removalOptions.removeIptc} onChange={(v) => setRemovalOptions(o => ({ ...o, removeIptc: v }))} />
              <OptionToggle label="XMP Data" checked={removalOptions.removeXmp} onChange={(v) => setRemovalOptions(o => ({ ...o, removeXmp: v }))} />
              <OptionToggle label="GPS Data" checked={removalOptions.removeGps} onChange={(v) => setRemovalOptions(o => ({ ...o, removeGps: v }))} />
              <OptionToggle label="Trailing Data" checked={removalOptions.removeTrailing} onChange={(v) => setRemovalOptions(o => ({ ...o, removeTrailing: v }))} desc="Post-EOI tracking payloads" />

              <div className="pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
                <OptionToggle label="Selective Mode" checked={selectiveMode} onChange={setSelectiveMode} desc="Choose individual fields" />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 space-y-2">
              <button
                onClick={handleClean}
                disabled={files.length === 0 || processing}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)' }}
              >
                {processing ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-2" />Processing...</>
                ) : files.length > 1 ? (
                  <><i className="fa-solid fa-file-zipper mr-2" />Clean & ZIP Download</>
                ) : (
                  <><i className="fa-solid fa-wand-magic-sparkles mr-2" />Clean & Download</>
                )}
              </button>

              {files.length > 1 && (
                <button
                  onClick={handleCleanSeparate}
                  disabled={processing}
                  className="w-full py-2 px-4 rounded-xl text-xs font-medium transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  <i className="fa-solid fa-download mr-1" />Download Separately
                </button>
              )}
            </div>

            {/* Protocol Status */}
            <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--glass-border)' }}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                Protocol Status
              </h4>
              <div className="space-y-1.5">
                <ProtocolStatus active={removalOptions.removeXmp} label="XMP App1 Hard-Wipe" />
                <ProtocolStatus active={removalOptions.removeIptc} label="IPTC App13 Nullify" />
                <ProtocolStatus active={removalOptions.removeTrailing} label="Trailing Data Clear" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {processing && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="liquid-glass p-8 text-center" style={{ borderRadius: '20px' }}>
            <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.2)' }}>
              <i className="fa-solid fa-spinner fa-spin text-xl" style={{ color: '#818cf8' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Processing files...</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>All processing happens locally in your browser</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components
function OptionToggle({ label, checked, onChange, desc }: { label: string; checked: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {desc && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</p>}
      </div>
      <div
        className={`toggle-switch ${checked ? 'active' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function ProtocolStatus({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full" style={{ background: active ? 'var(--success)' : 'rgba(255,255,255,0.15)' }} />
      <span className="text-[10px]" style={{ color: active ? 'var(--success)' : 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}
