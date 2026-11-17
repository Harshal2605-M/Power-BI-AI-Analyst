import React, { useState, useRef } from 'react';
import { 
  FileSpreadsheet, 
  UploadCloud, 
  Layers, 
  Code2, 
  BarChart2, 
  AlertCircle, 
  Sparkles, 
  Search, 
  Play, 
  Copy, 
  Check, 
  ExternalLink, 
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { parsePbixFile } from '../services/pbixParser';
import type { PbixParsedData } from '../services/pbixParser';
import { getApiBaseUrl } from '../config';

interface PbixStudioProps {
  pbixData: PbixParsedData | null;
  onPbixLoaded: (data: PbixParsedData) => void;
  onAskQuestion: (question: string) => void;
  isBridgeConnected: boolean;
  onRefreshBridge: () => void;
}

export const PbixStudio: React.FC<PbixStudioProps> = ({
  pbixData,
  onPbixLoaded,
  onAskQuestion,
  isBridgeConnected,
  onRefreshBridge
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'measures' | 'pages' | 'tables' | 'relationships'>('measures');
  const [measureSearch, setMeasureSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [copiedMeasure, setCopiedMeasure] = useState<string | null>(null);
  const [localFilePath, setLocalFilePath] = useState('');
  const [isOpeningLocal, setIsOpeningLocal] = useState(false);
  const [localOpenMessage, setLocalOpenMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileProcess = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pbix') && !file.name.toLowerCase().endsWith('.pbit')) {
      setErrorMsg('Please select a valid Power BI report file (.pbix or .pbit).');
      return;
    }

    setErrorMsg(null);
    setIsLoading(true);

    try {
      const parsed = await parsePbixFile(file, file.name);
      onPbixLoaded(parsed);
      if (parsed.pages.length > 0) {
        setSelectedPage(parsed.pages[0].name);
      }
    } catch (err: any) {
      console.error('Error parsing .pbix:', err);
      setErrorMsg(`Failed to extract .pbix file: ${err.message || 'File may be corrupted or encrypted.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const handleCopyDax = (name: string, expression: string) => {
    navigator.clipboard.writeText(expression);
    setCopiedMeasure(name);
    setTimeout(() => setCopiedMeasure(null), 2000);
  };

  const handleLaunchLocalPbix = async () => {
    if (!localFilePath.trim()) return;
    setIsOpeningLocal(true);
    setLocalOpenMessage(null);

    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/open-pbix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Bypass-Tunnel-Reminder': 'true',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ filePath: localFilePath.trim() })
      });

      const data = await res.json();
      if (res.ok) {
        setLocalOpenMessage(`✅ ${data.message || 'Power BI Desktop launched successfully!'}`);
        setTimeout(() => onRefreshBridge(), 3000);
      } else {
        setLocalOpenMessage(`⚠️ ${data.error || 'Failed to launch file.'}`);
      }
    } catch (err: any) {
      setLocalOpenMessage(`❌ Connection error: ${err.message}`);
    } finally {
      setIsOpeningLocal(false);
    }
  };

  // Filtered lists
  const filteredMeasures = pbixData
    ? pbixData.measures.filter(m => 
        m.name.toLowerCase().includes(measureSearch.toLowerCase()) ||
        (m.expression && m.expression.toLowerCase().includes(measureSearch.toLowerCase())) ||
        (m.tableName && m.tableName.toLowerCase().includes(measureSearch.toLowerCase()))
      )
    : [];

  const filteredTables = pbixData
    ? pbixData.tables.filter(t =>
        !t.name.startsWith('LocalDateTable_') &&
        !t.name.startsWith('DateTableTemplate_') &&
        t.name.toLowerCase().includes(tableSearch.toLowerCase())
      )
    : [];

  const activePageObj = pbixData && selectedPage
    ? pbixData.pages.find(p => p.name === selectedPage) || pbixData.pages[0]
    : pbixData?.pages[0];

  return (
    <div className="pbix-studio-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '3rem' }}>
      {/* Hero Banner */}
      <div 
        className="card" 
        style={{ 
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.08) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '1.5rem',
          borderRadius: '12px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
              <span className="pbi-badge" style={{ background: '#6366f1', color: 'white' }}>
                <FileSpreadsheet size={12} style={{ marginRight: '4px', display: 'inline' }} />
                PBIX FILE STUDIO
              </span>
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Power BI Report File (.PBIX) Analyzer</h2>
            </div>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '720px', lineHeight: 1.5 }}>
              Upload any Power BI (.pbix) or template (.pbit) file. The engine instantly unzips and extracts the semantic data model, DAX measures with exact formulas, relationships, and report canvas pages for deep Copilot AI analysis.
            </p>
          </div>

          {pbixData && (
            <button
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <UploadCloud size={14} />
              Upload Different .pbix
            </button>
          )}
        </div>
      </div>

      {/* Upload Dropzone (shown if no file or always available) */}
      {!pbixData && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: isDragging ? '2px dashed var(--primary)' : '2px dashed rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            padding: '3.5rem 2rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)',
            transition: 'all 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem'
          }}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            accept=".pbix,.pbit" 
            style={{ display: 'none' }} 
          />

          <div 
            style={{ 
              width: '64px', 
              height: '64px', 
              borderRadius: '50%', 
              background: 'rgba(99, 102, 241, 0.15)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--primary)'
            }}
          >
            {isLoading ? <RefreshCw size={28} className="spin" /> : <UploadCloud size={32} />}
          </div>

          <div>
            <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1.15rem', fontWeight: 700 }}>
              {isLoading ? 'Extracting Model & DAX Formulations...' : 'Drop your .pbix or .pbit file here'}
            </h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Supports all standard Power BI Desktop and Fabric report archives. All processing runs securely in memory.
            </p>
          </div>

          <button 
            type="button"
            className="btn btn-primary" 
            style={{ marginTop: '0.5rem', pointerEvents: 'none' }}
          >
            Browse Computer Files
          </button>
        </div>
      )}

      {errorMsg && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
          <AlertCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Optional: Local Power BI Desktop File Path Launch (When bridge is connected) */}
      <div 
        className="card" 
        style={{ 
          background: 'rgba(255, 255, 255, 0.02)', 
          border: '1px solid rgba(255, 255, 255, 0.07)', 
          padding: '1.25rem', 
          borderRadius: '12px' 
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={16} style={{ color: 'var(--primary)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Or Launch Local Windows .PBIX in Power BI Desktop</h4>
          </div>
          <span 
            className="badge" 
            style={{ 
              fontSize: '0.7rem', 
              background: isBridgeConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: isBridgeConnected ? '#34d399' : 'var(--text-muted)' 
            }}
          >
            {isBridgeConnected ? '● Gateway Bridge Online' : '○ Gateway Bridge Offline'}
          </span>
        </div>
        <p style={{ margin: '0 0 0.75rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Have a `.pbix` saved on your Windows computer? Enter the full path to launch it in Power BI Desktop and auto-bridge it via the local gateway.
        </p>
        
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-field"
            value={localFilePath}
            onChange={(e) => setLocalFilePath(e.target.value)}
            placeholder="C:\Users\Username\Documents\Sales_Analytics.pbix"
            style={{ flex: 1, minWidth: '280px', padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}
          />
          <button
            className="btn btn-primary"
            onClick={handleLaunchLocalPbix}
            disabled={isOpeningLocal || !localFilePath.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {isOpeningLocal ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
            Launch in Power BI Desktop
          </button>
        </div>

        {localOpenMessage && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: localOpenMessage.startsWith('✅') ? '#34d399' : '#fbbf24' }}>
            {localOpenMessage}
          </div>
        )}
      </div>

      {/* Model Overview & Extracted Content (if file loaded) */}
      {pbixData && (
        <>
          {/* Metadata KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                <span>File Name</span>
                <FileSpreadsheet size={14} style={{ color: 'var(--primary)' }} />
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={pbixData.fileName}>
                {pbixData.fileName}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {(pbixData.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB {pbixData.version ? `• v${pbixData.version}` : ''}
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                <span>DAX Measures</span>
                <Code2 size={14} style={{ color: '#a855f7' }} />
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#a855f7' }}>
                {pbixData.measures.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Calculated formulas extracted
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                <span>Model Tables</span>
                <Layers size={14} style={{ color: '#3b82f6' }} />
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#3b82f6' }}>
                {pbixData.tables.filter(t => !t.isHidden).length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {pbixData.tables.reduce((acc, t) => acc + t.columns.length, 0)} total columns
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                <span>Report Pages</span>
                <BarChart2 size={14} style={{ color: '#10b981' }} />
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>
                {pbixData.pages.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {pbixData.pages.reduce((acc, p) => acc + p.visuals.length, 0)} canvas visuals
              </div>
            </div>
          </div>

          {/* Quick AI Action Banner */}
          <div 
            className="card" 
            style={{ 
              background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(99, 102, 241, 0.08) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '1rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={18} style={{ color: '#10b981' }} />
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                  Ready for AI Analysis & Grounded DAX
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  This .pbix data model is synchronized with your Senior AI Analyst. You can ask business questions directly in the Copilot chat.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => onAskQuestion(`Summarize the entire ${pbixData.fileName} data model, key measures, and report pages.`)}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Sparkles size={13} />
                Ask Copilot to Summarize Model
              </button>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', gap: '0.5rem', overflowX: 'auto', flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' }}>
            <button
              onClick={() => setActiveSubTab('measures')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeSubTab === 'measures' ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeSubTab === 'measures' ? 'white' : 'var(--text-muted)',
                padding: '0.6rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <Code2 size={14} />
              DAX Measures ({pbixData.measures.length})
            </button>

            <button
              onClick={() => setActiveSubTab('pages')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeSubTab === 'pages' ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeSubTab === 'pages' ? 'white' : 'var(--text-muted)',
                padding: '0.6rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <BarChart2 size={14} />
              Pages & Visuals ({pbixData.pages.length})
            </button>

            <button
              onClick={() => setActiveSubTab('tables')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeSubTab === 'tables' ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeSubTab === 'tables' ? 'white' : 'var(--text-muted)',
                padding: '0.6rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <Layers size={14} />
              Tables & Schema ({pbixData.tables.filter(t => !t.isHidden).length})
            </button>

            <button
              onClick={() => setActiveSubTab('relationships')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeSubTab === 'relationships' ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeSubTab === 'relationships' ? 'white' : 'var(--text-muted)',
                padding: '0.6rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <ExternalLink size={14} />
              Relationships ({pbixData.relationships.length})
            </button>
          </div>

          {/* TAB 1: MEASURES */}
          {activeSubTab === 'measures' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="input-field"
                    value={measureSearch}
                    onChange={(e) => setMeasureSearch(e.target.value)}
                    placeholder="Search measures or formulas..."
                    style={{ paddingLeft: '32px', width: '100%', fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Showing {filteredMeasures.length} of {pbixData.measures.length} measures
                </div>
              </div>

              {filteredMeasures.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No DAX measures found matching your search.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {filteredMeasures.map((m, idx) => (
                    <div 
                      key={idx} 
                      className="card" 
                      style={{ 
                        padding: '1.2rem',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        background: 'rgba(255, 255, 255, 0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c084fc' }}>
                              [{m.name}]
                            </span>
                            {m.tableName && (
                              <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(255, 255, 255, 0.05)' }}>
                                Table: {m.tableName}
                              </span>
                            )}
                          </div>
                          {m.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                              {m.description}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleCopyDax(m.name, m.expression)}
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: '28px' }}
                            title="Copy DAX Expression"
                          >
                            {copiedMeasure === m.name ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
                            <span style={{ marginLeft: '4px' }}>{copiedMeasure === m.name ? 'Copied' : 'Copy'}</span>
                          </button>

                          <button
                            className="btn btn-secondary"
                            onClick={() => onAskQuestion(`Explain the formula and calculation logic of the DAX measure [${m.name}]:\n\`\`\`dax\n${m.expression}\n\`\`\``)}
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: '28px' }}
                          >
                            <Sparkles size={12} style={{ marginRight: '4px' }} />
                            Explain with AI
                          </button>

                          <button
                            className="btn btn-secondary"
                            onClick={() => onAskQuestion(`How can I optimize or improve this DAX measure [${m.name}] for performance?\n\`\`\`dax\n${m.expression}\n\`\`\``)}
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: '28px' }}
                          >
                            ⚡ Optimize
                          </button>
                        </div>
                      </div>

                      {/* Code Block for DAX */}
                      <pre 
                        style={{ 
                          background: 'rgba(0, 0, 0, 0.35)', 
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: '8px', 
                          padding: '0.75rem 1rem', 
                          fontSize: '0.8rem', 
                          fontFamily: 'monospace', 
                          color: '#e2e8f0', 
                          overflowX: 'auto',
                          margin: 0,
                          lineHeight: 1.5
                        }}
                      >
                        <code>{m.expression || '-- No DAX expression defined'}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REPORT PAGES & VISUALS */}
          {activeSubTab === 'pages' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Page Selector Pills */}
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                {pbixData.pages.map((p, idx) => (
                  <button
                    key={idx}
                    className={`btn ${activePageObj?.name === p.name ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSelectedPage(p.name)}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' }}
                  >
                    📄 {p.displayName} ({p.visuals.length} visuals)
                  </button>
                ))}
              </div>

              {activePageObj && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                      Visuals on "{activePageObj.displayName}"
                    </h3>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onAskQuestion(`Analyze the visual design, charts, and metric placement on report page "${activePageObj.displayName}". Suggest improvements and missing KPIs.`)}
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                    >
                      <Sparkles size={12} style={{ marginRight: '4px' }} />
                      Analyze Page Layout with AI
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                    {activePageObj.visuals.map((v, vIdx) => (
                      <div 
                        key={vIdx} 
                        className="card" 
                        style={{ 
                          padding: '1rem', 
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          background: 'rgba(255, 255, 255, 0.02)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc' }}>
                            {v.type}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                          {v.title || 'Untitled Visual'}
                        </div>
                        {v.fields.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Fields & Metrics:</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {v.fields.map((f, fIdx) => (
                                <span 
                                  key={fIdx} 
                                  style={{ 
                                    fontSize: '0.7rem', 
                                    background: 'rgba(255, 255, 255, 0.05)', 
                                    padding: '2px 6px', 
                                    borderRadius: '4px',
                                    color: '#cbd5e1'
                                  }}
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Static / decorative visual container</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TABLES & SCHEMA */}
          {activeSubTab === 'tables' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ position: 'relative', maxWidth: '360px' }}>
                <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="input-field"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search tables..."
                  style={{ paddingLeft: '32px', width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                {filteredTables.map((tbl, idx) => (
                  <div 
                    key={idx} 
                    className="card" 
                    style={{ 
                      padding: '1.2rem', 
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: 'rgba(255, 255, 255, 0.02)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Layers size={16} style={{ color: 'var(--primary)' }} />
                        <span style={{ fontSize: '1rem', fontWeight: 700 }}>{tbl.name}</span>
                      </div>
                      <span className="badge" style={{ fontSize: '0.7rem' }}>
                        {tbl.columns.length} columns
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {tbl.columns.map((c, cIdx) => (
                        <div 
                          key={cIdx} 
                          style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            fontSize: '0.78rem',
                            padding: '3px 6px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '4px'
                          }}
                        >
                          <span style={{ color: '#e2e8f0' }}>[{c.name}]</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{c.dataType}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      className="btn btn-secondary"
                      onClick={() => onAskQuestion(`What business metrics and insights can we calculate using the table '${tbl.name}' and its columns?`)}
                      style={{ marginTop: '0.75rem', width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                    >
                      <Sparkles size={12} style={{ marginRight: '4px' }} />
                      Explore Metrics for '{tbl.name}'
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: RELATIONSHIPS */}
          {activeSubTab === 'relationships' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {pbixData.relationships.length} relationships connecting tables in the semantic star/snowflake schema:
              </div>

              {pbixData.relationships.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No active relationships defined in this file (single flat table or implicit relationships).
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {pbixData.relationships.map((rel, idx) => (
                    <div 
                      key={idx} 
                      className="card" 
                      style={{ 
                        padding: '0.85rem 1.25rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          '{rel.fromTable}'[{rel.fromColumn}]
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          ── ({rel.crossFilteringBehavior || '1:many'}) ──▶
                        </span>
                        <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                          '{rel.toTable}'[{rel.toColumn}]
                        </span>
                      </div>

                      <span 
                        className="badge" 
                        style={{ 
                          fontSize: '0.7rem', 
                          background: rel.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          color: rel.isActive ? '#34d399' : 'var(--text-muted)'
                        }}
                      >
                        {rel.isActive ? 'Active Relationship' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
