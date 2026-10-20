import { useState, useCallback, useRef } from 'react';
import { readMetadata, FileMetadata, getCategoryLabel, formatFileSize } from './utils/metadataReader';
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







// File type helpers
function getFileCategory(file: File): 'image' | 'pdf' | 'office' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf';
  return 'office';
}

function getFileIcon(file: File): string {
  const cat = getFileCategory(file);
  if (cat === 'image') return 'fa-image';
  if (cat === 'pdf') return 'fa-file-pdf';
  return 'fa-file-word';
}

// Main App
export default function App() {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [removalOptions, setRemovalOptions] = useState<RemovalOptions>(DEFAULT_OPTIONS);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [selectiveMode, setSelectiveMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (newFiles: FileList | File[]) => {
    const fileArr = Array.from(newFiles);
    setProcessing(true);

    const results: FileMetadata[] = [];
    for (const file of fileArr) {
      try {
        const meta = await readMetadata(file);
        results.push(meta);
      } catch (err) {
        console.error('Error reading meta', err);
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
      const meta = files[0];
      try {
        const cleaned = await removeMetadata(meta.file, opts);
        const name = getCleanedFilename(meta.file.name);
        saveAs(cleaned, name);
      } catch (err) {
        console.error('Clean error:', err);
      }
    } else {
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

  return (
    <div ref={containerRef} className="min-h-screen relative" style={{ background: 'var(--bg-primary)' }}>

      {/* Main Content Container */}
      <div className="min-h-screen p-5 md:p-6 lg:p-8">
        
        {/* Header */}
        <header className="neu-card mb-5 md:mb-6 px-5 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <path d="M16 2L4 8v8c0 7.18 5.12 13.9 12 16 6.88-2.1 12-8.82 12-16V8L16 2z" fill="url(#icon-gradient)" opacity="0.9"/>
              <path d="M13 17l-3-3 1.5-1.5L13 14l5.5-5.5L20 10l-7 7z" fill="white" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              MetaWipe
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>
              100% Browser-Based
            </span>
            <div className="neu-button w-10 h-10 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--accent)' }} />
            </div>
          </div>
        </header>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
          
          {/* Left Column - Dropzone */}
          <div className="flex flex-col gap-5 md:gap-6">
            {/* Main Dropzone */}
            <div
              className={`neu-inset p-6 sm:p-8 md:p-10 lg:p-12 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[280px] sm:min-h-[320px] md:min-h-[400px] ${dragActive ? 'drag-active' : ''}`}
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
              
              <div className="neu-button w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mb-4 sm:mb-6">
                <i className="fa-solid fa-cloud-arrow-up text-2xl sm:text-3xl" style={{ color: 'var(--accent)' }} />
              </div>
              
              <h2 className="text-lg sm:text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Drop files here
              </h2>
              <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
                Images, PDF, Office docs
              </p>
            </div>

            {/* File List (when files are loaded) */}
            {files.length > 0 && (
              <div className="neu-card overflow-hidden">
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    FILES ({files.length})
                  </span>
                  <button onClick={clearFiles} className="neu-button text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--danger)' }}>
                    <i className="fa-solid fa-trash-can mr-1" />Clear
                  </button>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-3 space-y-2">
                  {files.map((meta, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${idx === selectedIdx ? 'neu-inset' : 'neu-button'}`}
                      onClick={() => setSelectedIdx(idx)}
                    >
                      <i className={`fa-solid ${getFileIcon(meta.file)} text-lg`} style={{ color: idx === selectedIdx ? 'var(--accent)' : 'var(--text-secondary)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{meta.file.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(meta.fileSize)}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="neu-button text-xs p-2 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Control Panel */}
          <div className="flex flex-col gap-6">
            
            {/* No File Selected State */}
            {!selectedFile && files.length === 0 && (
              <div className="neu-card p-12 flex flex-col items-center justify-center min-h-[400px]">
                <div className="neu-button w-24 h-24 rounded-full flex items-center justify-center mb-6">
                  <i className="fa-solid fa-file-shield text-4xl" style={{ color: 'var(--text-secondary)' }} />
                </div>
                <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No file selected</h3>
                <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>Drop files or click the upload area to get started</p>
              </div>
            )}

            {/* Metadata Display (when file is selected) */}
            {selectedFile && (
              <div className="neu-card p-6 overflow-hidden">
                <div className="flex items-center gap-4 mb-4">
                  {selectedFile.thumbnail && (
                    <img src={selectedFile.thumbnail} alt="Thumbnail" className="w-16 h-16 rounded-xl object-cover neu-inset" />
                  )}
                  <div className="flex-1">
                    <h2 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{selectedFile.file.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(selectedFile.fileSize)}</span>
                      {selectedFile.hasExif && <span className="badge badge-image">EXIF</span>}
                      {selectedFile.hasIptc && <span className="badge badge-pdf">IPTC</span>}
                      {selectedFile.hasXmp && <span className="badge badge-office">XMP</span>}
                    </div>
                  </div>
                </div>

                {/* Selective Mode Controls */}
                {selectiveMode && totalRemovableFields > 0 && (
                  <div className="neu-inset mb-4 p-3 rounded-xl flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {selectedFields.size} / {totalRemovableFields} fields selected
                    </span>
                    <div className="flex gap-2">
                      <button onClick={selectAllFields} className="neu-button text-xs px-3 py-1 rounded-lg" style={{ color: 'var(--accent)' }}>
                        Select All
                      </button>
                      <button onClick={deselectAllFields} className="neu-button text-xs px-3 py-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                        Deselect All
                      </button>
                    </div>
                  </div>
                )}

                {/* Metadata Tables */}
                <div className="max-h-[400px] overflow-y-auto space-y-3">
                  {Object.entries(selectedFile.entries.reduce((acc, entry) => {
                    if (!acc[entry.category]) acc[entry.category] = [];
                    acc[entry.category].push(entry);
                    return acc;
                  }, {} as Record<string, any[]>)).map(([category, entries]) => (
                    <div key={category} className="neu-inset rounded-xl overflow-hidden">
                      <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                        <i className={`fa-solid ${category === 'exif' ? 'fa-camera' : category === 'iptc' ? 'fa-newspaper' : category === 'xmp' ? 'fa-code' : category === 'gps' ? 'fa-location-dot' : 'fa-file'} text-xs`} style={{ color: 'var(--accent)' }} />
                        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          {getCategoryLabel(category)}
                        </span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {entries.map((entry: any, i: number) => (
                            <tr key={i} className={`${selectiveMode && entry.removable ? 'cursor-pointer hover:bg-black/5' : ''}`} onClick={() => selectiveMode && entry.removable && toggleField(entry.key)}>
                              {selectiveMode && entry.removable && (
                                <td style={{ width: '30px', padding: '6px 8px' }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedFields.has(entry.key)}
                                    onChange={() => toggleField(entry.key)}
                                    className="w-3.5 h-3.5 rounded"
                                    style={{ accentColor: 'var(--accent)' }}
                                  />
                                </td>
                              )}
                              <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{entry.key}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{String(entry.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GPS Map */}
            {selectedFile?.gps && (
              <div className="neu-card overflow-hidden">
                <div className="px-6 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <i className="fa-solid fa-map-location-dot text-sm" style={{ color: 'var(--accent)' }} />
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>GPS Location</span>
                </div>
                <div style={{ height: '200px' }}>
                  <MapContainer
                    center={[selectedFile.gps.latitude, selectedFile.gps.longitude]}
                    zoom={13}
                    style={{ height: '100%', width: '100%' }}
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

            {/* Removal Options Panel */}
            <div className="neu-card p-5 sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider mb-5 sm:mb-6" style={{ color: 'var(--text-secondary)' }}>
                Removal Options
              </h3>

              <div className="space-y-4 sm:space-y-5">
                <OptionToggle label="EXIF Data" checked={removalOptions.removeExif} onChange={(v) => setRemovalOptions(o => ({ ...o, removeExif: v }))} />
                <OptionToggle label="IPTC Data" checked={removalOptions.removeIptc} onChange={(v) => setRemovalOptions(o => ({ ...o, removeIptc: v }))} />
                <OptionToggle label="XMP Data" checked={removalOptions.removeXmp} onChange={(v) => setRemovalOptions(o => ({ ...o, removeXmp: v }))} />
                <OptionToggle label="GPS Data" checked={removalOptions.removeGps} onChange={(v) => setRemovalOptions(o => ({ ...o, removeGps: v }))} />
                <OptionToggle label="Trailing Data" checked={removalOptions.removeTrailing} onChange={(v) => setRemovalOptions(o => ({ ...o, removeTrailing: v }))} desc="Post-EOI tracking payloads" />
                <div className="pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <OptionToggle label="Selective Mode" checked={selectiveMode} onChange={setSelectiveMode} desc="Choose individual fields" />
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleClean}
                disabled={files.length === 0 || processing}
                className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
              >
                {processing ? (
                  <><i className="fa-solid fa-spinner fa-spin" />Processing...</>
                ) : (
                  <><i className="fa-solid fa-wand-magic-sparkles" />Clean & Download</>
                )}
              </button>

              {/* Protocol Status */}
              <div className="mt-6 pt-6" style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Protocol Status
                </h4>
                <div className="space-y-2">
                  <ProtocolStatus active={removalOptions.removeXmp} label="XMP App1 Hard-Wipe" />
                  <ProtocolStatus active={removalOptions.removeIptc} label="IPTC App13 Nullify" />
                  <ProtocolStatus active={removalOptions.removeTrailing} label="Trailing Data Clear" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {processing && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(30, 41, 59, 0.8)', backdropFilter: 'blur(8px)' }}>
          <div className="neu-card p-8 text-center">
            <div className="neu-button w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center">
              <i className="fa-solid fa-spinner fa-spin text-2xl" style={{ color: 'var(--accent)' }} />
            </div>
            <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Processing files...</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>All processing happens locally in your browser</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components
function OptionToggle({ label, checked, onChange, desc }: { label: string; checked: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <span className="text-sm sm:text-base font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</p>}
      </div>
      <div
        className={`neu-toggle ${checked ? 'active' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function ProtocolStatus({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: active ? 'var(--success)' : 'var(--neu-shadow-dark)' }} />
      <span className="text-xs" style={{ color: active ? 'var(--success)' : 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}
