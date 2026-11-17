import { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Send, 
  Terminal, 
  Play, 
  Sparkles, 
  Clock, 
  HelpCircle,
  BarChart2,
  Activity,
  Table as TableIcon,
  Link,
  RefreshCw,
  AlertCircle,
  Brain,
  Zap,
  Maximize2,
  Minimize2,
  Search,
  X
} from 'lucide-react';
import { daxEngine } from './db/daxEngine';
import { parseFuzzyQuestion, generateInsights, groundedRepository } from './services/daxGenerator';
import { askLLM, toDaxResult } from './services/llmService';
import { getApiBaseUrl, setApiBaseUrl } from './config';
import type { DaxResult } from './db/daxEngine';
import type { GroundedQuery } from './services/daxGenerator';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  statusSteps?: { name: string; status: 'pending' | 'running' | 'completed' }[];
  queryInfo?: GroundedQuery;
  daxResult?: any;
  suggestions?: string[];
  insights?: {
    summary: string;
    bullets: string[];
    recommendations: string[];
  };
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [activeQuery, setActiveQuery] = useState<GroundedQuery | null>(null);
  const [currentDax, setCurrentDax] = useState('');
  const [daxResult, setDaxResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'settings'>('overview');
  const [viewTab, setViewTab] = useState<'visual' | 'table'>('visual');
  const [gridSearch, setGridSearch] = useState('');
  const [isVisualizerFullScreen, setIsVisualizerFullScreen] = useState(false);
  const [isDevToolsExpanded, setIsDevToolsExpanded] = useState(false);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  
  // PowerBI MCP Live Server Bridge State
  const [bridgeStatus, setBridgeStatus] = useState({
    isConnected: false,
    connectionName: 'No Model Connected',
    isOffline: true
  });
  const [localInstances, setLocalInstances] = useState<any[]>([]);
  const [liveTables, setLiveTables] = useState<any[]>([]);
  const [fabricWorkspace, setFabricWorkspace] = useState('');
  const [fabricModel, setFabricModel] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [customGatewayUrl, setCustomGatewayUrl] = useState(getApiBaseUrl());

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize: check live status on load
  useEffect(() => {
    syncBridgeStatus();
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, []);

  useEffect(() => {
    const chatHistoryEl = document.querySelector('.chat-history');
    if (chatHistoryEl) {
      chatHistoryEl.scrollTo({
        top: chatHistoryEl.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  const handleTabChange = (tab: 'overview' | 'explorer' | 'settings') => {
    setActiveTab(tab);
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };

  // Auto-fetch schema tables when connection changes
  useEffect(() => {
    if (bridgeStatus.isConnected) {
      fetchLiveTables();
    } else {
      setLiveTables([]);
    }
  }, [bridgeStatus.isConnected, bridgeStatus.connectionName]);

  // Background polling to auto-sync instances and handle connection changes
  useEffect(() => {
    const interval = setInterval(() => {
      syncBridgeStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Helper for requests with tunnel support (bypasses localtunnel/ngrok reminder screens)
  const apiFetch = (path: string, options: RequestInit = {}) => {
    const baseUrl = getApiBaseUrl();
    const headers = {
      'Bypass-Tunnel-Reminder': 'true',
      'ngrok-skip-browser-warning': 'true',
      ...(options.headers || {})
    };
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };

  // Synchronize bridge state with local proxy backend server
  const syncBridgeStatus = async () => {
    try {
      const res = await apiFetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        const connected = !!data.activeConnection;
        
        setBridgeStatus({
          isConnected: connected,
          connectionName: data.activeConnection || 'No Model Connected',
          isOffline: false
        });
        
        fetchLocalInstances(!connected);

        if (connected) {
          fetchLiveTables();
        } else {
          setLiveTables([]);
        }
      } else {
        setBridgeStatus(prev => ({ ...prev, isOffline: true }));
      }
    } catch {
      setBridgeStatus({
        isConnected: false,
        connectionName: 'No Model Connected',
        isOffline: true
      });
    }
  };

  // Poll open local .pbix files running on user computer via MCP
  const fetchLocalInstances = async (shouldAutoConnect = true) => {
    try {
      const res = await apiFetch('/api/instances');
      if (res.ok) {
        const data = await res.json();
        if (data && data.content && data.content[0]) {
          const payload = JSON.parse(data.content[0].text);
          const instances = payload.data || payload.localInstances || [];
          setLocalInstances(instances);
          
          if (shouldAutoConnect && instances.length === 1 && !isConnecting) {
            const inst = instances[0];
            handleConnectLocal(inst.port, inst.name || inst.parentWindowTitle || 'Untitled Model');
          }
        }
      }
    } catch {
      setLocalInstances([]);
    }
  };

  // Fetch actual tables and columns from the live PowerBI model via MCP
  const fetchLiveTables = async () => {
    try {
      const res = await apiFetch('/api/tables');
      if (res.ok) {
        const data = await res.json();
        if (data && data.content && data.content[0]) {
          const payload = JSON.parse(data.content[0].text);
          const tablesArray = payload.data || payload.tables || (Array.isArray(payload) ? payload : []);
          
          const enrichedTables = [];
          for (const tbl of tablesArray) {
            try {
              const colRes = await apiFetch(`/api/columns?tableName=${encodeURIComponent(tbl.name)}`);
              if (colRes.ok) {
                const colData = await colRes.json();
                if (colData && colData.content && colData.content[0]) {
                  const colPayload = JSON.parse(colData.content[0].text);
                  const tableObj = colPayload.data?.[0] || colPayload;
                  const colsArray = tableObj.columns || [];
                  
                  tbl.fields = colsArray.map((c: any) => ({
                    name: c.name,
                    key: c.dataType || 'Dimension'
                  }));
                }
              }
            } catch {
              tbl.fields = [];
            }
            enrichedTables.push(tbl);
          }
          setLiveTables(enrichedTables);
        }
      }
    } catch {
      setLiveTables([]);
    }
  };

  // Connect to local open PowerBI desktop via port
  const handleConnectLocal = async (port: number, name: string) => {
    setIsConnecting(true);
    try {
      const res = await apiFetch('/api/connect-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port })
      });
      if (res.ok) {
        setBridgeStatus({
          isConnected: true,
          connectionName: name || `Local-${port}`,
          isOffline: false
        });
        await fetchLiveTables();
        const infoMsg: Message = {
          id: 'sys_' + Date.now(),
          sender: 'assistant',
          text: `Connected to Power BI model: **${name || `Port ${port}`}**. Ask any question to analyze your data!`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, infoMsg]);
      }
    } catch (e) {
      console.error(e);
    }
    setIsConnecting(false);
  };

  // Connect to Microsoft Fabric XMLA
  const handleConnectFabric = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fabricWorkspace || !fabricModel) return;
    setIsConnecting(true);
    try {
      const res = await apiFetch('/api/connect-fabric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceName: fabricWorkspace,
          semanticModelName: fabricModel
        })
      });
      if (res.ok) {
        setBridgeStatus({
          isConnected: true,
          connectionName: `${fabricWorkspace} / ${fabricModel}`,
          isOffline: false
        });
        await fetchLiveTables();
        const infoMsg: Message = {
          id: 'sys_' + Date.now(),
          sender: 'assistant',
          text: `Connected to Fabric XMLA: Workspace **${fabricWorkspace}** • Model **${fabricModel}**.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, infoMsg]);
      }
    } catch (e) {
      console.error(e);
    }
    setIsConnecting(false);
  };

  // Execute a business query end-to-end
  const handleExecuteQuestion = async (questionText: string) => {
    if (!questionText.trim()) return;

    const userMsgId = 'u_' + Date.now();
    const assistantMsgId = 'a_' + Date.now();

    const userMessage: Message = {
      id: userMsgId,
      sender: 'user',
      text: questionText,
      timestamp: new Date()
    };

    // LIVE MODE: use Gemini to generate DAX from real schema
    if (bridgeStatus.isConnected) {
      const liveSteps = [
        { name: 'Reading live model schema', status: 'running' as const },
        { name: 'Gemini generating DAX query', status: 'pending' as const },
        { name: 'Executing DAX via Modeling MCP', status: 'pending' as const },
        { name: 'Synthesizing chart & narrative', status: 'pending' as const },
      ];

      const assistantMessage: Message = {
        id: assistantMsgId,
        sender: 'assistant',
        text: 'Analyzing your question against the active Power BI semantic model...',
        timestamp: new Date(),
        statusSteps: liveSteps
      };

      setMessages(prev => [...prev, userMessage, assistantMessage]);

      const advanceStep = (stepIdx: number) => {
        setMessages(prev => prev.map(msg => {
          if (msg.id !== assistantMsgId || !msg.statusSteps) return msg;
          return {
            ...msg,
            statusSteps: msg.statusSteps.map((s, i) => {
              if (i < stepIdx) return { ...s, status: 'completed' as const };
              if (i === stepIdx) return { ...s, status: 'running' as const };
              return s;
            })
          };
        }));
      };

      try {
        advanceStep(1);

        const askResponse = await askLLM(questionText);

        advanceStep(2);

        const result = toDaxResult(askResponse);
        setDaxResult(result);

        advanceStep(3);

        const liveQueryInfo: GroundedQuery = {
          question: questionText,
          dax: askResponse.dax,
          category: 'general',
          chartType: detectChartType(questionText, result),
          description: askResponse.explanation || 'Live query result from active Power BI model.'
        };
        setActiveQuery(liveQueryInfo);
        setCurrentDax(askResponse.dax);

        const businessInsights = generateInsights(questionText, result);

        setMessages(prev => prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          return {
            ...msg,
            text: askResponse.error
              ? `⚠️ DAX execution notice: ${askResponse.error}`
              : `✅ **DAX executed successfully against your model.**\n${askResponse.explanation}`,
            statusSteps: undefined,
            queryInfo: liveQueryInfo,
            daxResult: result,
            insights: businessInsights,
            suggestions: askResponse.suggestions || []
          };
        }));

      } catch (err: any) {
        setMessages(prev => prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          return {
            ...msg,
            text: `❌ AI query failed: ${err.message}. Please verify the connection or try rephrasing.`,
            statusSteps: undefined
          };
        }));
      }
      return;
    }

    // OFFLINE MODE: inform user to connect
    const queryInfo = parseFuzzyQuestion(questionText);
    setActiveQuery(queryInfo);

    const assistantMessage: Message = {
      id: assistantMsgId,
      sender: 'assistant',
      text: '⚠️ No Power BI model is currently connected. Please open a Power BI Desktop file and connect under Connection Settings to query your data.',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
  };

  // Auto-detect best chart type from question and result shape
  const detectChartType = (q: string, result: DaxResult): 'bar' | 'line' | 'donut' | 'table' | 'decomposition' | 'comparison' => {
    const lower = q.toLowerCase();
    if (lower.includes('trend') || lower.includes('over time') || lower.includes('month') || lower.includes('year') || lower.includes('date')) return 'line';
    if (lower.includes('distribution') || lower.includes('breakdown') || lower.includes('share') || lower.includes('split') || lower.includes('percentage')) return 'donut';
    if (lower.includes('compare') || lower.includes('vs') || lower.includes('versus')) return 'comparison';
    if (result.columns.length > 3 || lower.includes('detail') || lower.includes('list') || lower.includes('all')) return 'table';
    return 'bar';
  };

  // Run manually modified DAX query inside console editor
  const handleRunCustomDax = async () => {
    if (!currentDax.trim()) return;
    const result = await daxEngine.evaluate(currentDax);
    setDaxResult(result);

    const qText = activeQuery ? activeQuery.question : "Custom DAX Execution";
    const businessInsights = generateInsights(qText, result);

    const updateMsg: Message = {
      id: 'dax_upd_' + Date.now(),
      sender: 'assistant',
      text: 'Custom DAX query executed manually from the editor console.',
      timestamp: new Date(),
      insights: businessInsights,
      daxResult: result,
      queryInfo: {
        question: "Custom DAX Execution",
        dax: currentDax,
        category: 'general',
        chartType: activeQuery ? activeQuery.chartType : 'bar',
        description: 'Manual execution of DAX syntax from console.'
      }
    };
    setMessages(prev => [...prev, updateMsg]);
  };

  const handleSuggestionClick = (q: string) => {
    handleExecuteQuestion(q);
  };

  const categoriesList = [
    { id: 'all', label: 'All Queries' },
    { id: 'trend', label: 'Trends' },
    { id: 'ranking', label: 'Rankings' },
    { id: 'distribution', label: 'Distributions' },
    { id: 'comparison', label: 'Comparisons' },
    { id: 'summary', label: 'Summaries' }
  ];

  const filteredSuggestions = groundedRepository.filter(g => {
    if (filterCategory === 'all') return true;
    return g.category === filterCategory;
  }).slice(0, 7);

  return (
    <div className="app-container">
      <div className="grid-overlay" />
      <div className="glow-orb" style={{ width: '450px', height: '450px', top: '-100px', left: '5%', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 70%)', animation: 'pulse-slow 20s infinite' }} />
      <div className="glow-orb" style={{ width: '500px', height: '500px', bottom: '-150px', right: '10%', background: 'radial-gradient(circle, rgba(217, 70, 239, 0.1) 0%, transparent 75%)', animation: 'pulse-slow-reverse 25s infinite' }} />
      <div className="glow-orb" style={{ width: '350px', height: '350px', top: '35%', left: '40%', background: 'radial-gradient(circle, rgba(20, 184, 166, 0.08) 0%, transparent 70%)', animation: 'pulse-slow 18s infinite' }} />

      {/* Brand Left Navigation Sidebar */}
      <div className="left-nav-sidebar">
        <div className="nav-brand">
          <div className="brand-dot" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #ffffff 60%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Power BI AI Analyst
          </h2>
        </div>

        <div className="nav-list">
          <div 
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} 
            onClick={() => handleTabChange('overview')}
          >
            <BarChart2 size={16} />
            <span>Dashboard Overview</span>
          </div>
          
          <div 
            className={`nav-item ${activeTab === 'explorer' ? 'active' : ''}`} 
            onClick={() => handleTabChange('explorer')}
          >
            <Database size={16} />
            <span>Schema Explorer</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} 
            onClick={() => handleTabChange('settings')}
            style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '1.5rem' }}
          >
            <Link size={16} />
            <span>Connection Settings</span>
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Enterprise Edition</span>
          <span style={{ fontSize: '0.6rem', color: 'var(--primary)', fontWeight: 600 }}>v3.6.0 Stable</span>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="main-workspace">
        {/* Pinned Top Navigation Header */}
        <div className="top-nav-header">
          <div className="title-group" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <span className="pbi-badge" style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)', color: 'white', border: 'none', boxShadow: '0 0 10px rgba(99, 102, 241, 0.3)' }}>
              MODELING MCP
            </span>
            <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>
              {activeTab === 'overview' && 'Power BI Model Overview'}
              {activeTab === 'explorer' && 'Semantic Model Schema Explorer'}
              {activeTab === 'settings' && 'MCP Connection Gateway Manager'}
            </h1>
            
            {bridgeStatus.isConnected ? (
              <>
                <span 
                  className="badge" 
                  onClick={() => handleTabChange('settings')}
                  style={{ cursor: 'pointer', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Zap size={10} style={{ color: '#10b981' }} />
                  LIVE: {bridgeStatus.connectionName}
                </span>
                <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', border: '1px solid rgba(139, 92, 246, 0.25)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Brain size={10} />
                  Gemini AI-Powered
                </span>
              </>
            ) : (
              <span 
                className="badge" 
                onClick={() => handleTabChange('settings')}
                style={{ cursor: 'pointer', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span className="copilot-status-dot" style={{ background: '#f59e0b', width: '5px', height: '5px', animation: 'none' }} />
                Offline (Connect to Power BI)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              className="btn btn-secondary" 
              onClick={syncBridgeStatus}
              style={{ padding: '0.35rem 0.6rem', height: '32px' }}
              title="Refresh connection status"
            >
              <RefreshCw size={12} className={isConnecting ? 'spin' : ''} />
            </button>
            
            <button 
              className="btn btn-secondary" 
              onClick={() => setCopilotCollapsed(!copilotCollapsed)}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', height: '32px' }}
            >
              {copilotCollapsed ? 'Open AI Copilot' : 'Collapse Sidebar'}
            </button>
          </div>
        </div>

        {/* Scrollable Dashboard Canvas */}
        <div className="dashboard-canvas">
          {/* Section Subtitle Deck */}
          <div className="tab-title-deck" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.25rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeTab === 'overview' && 'Model Analytics & AI Insights'}
              {activeTab === 'explorer' && 'Live Schema Tables & Columns Explorer'}
              {activeTab === 'settings' && 'Power BI Desktop / Fabric XMLA Gateway Bridge'}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {activeTab === 'overview' && 'Ask analytical questions in natural language to run grounded DAX queries against your model.'}
              {activeTab === 'explorer' && 'Browse active tables, column data types, and semantic structures discovered in your Power BI model.'}
              {activeTab === 'settings' && 'Establish local Power BI Desktop connections or cloud-based XMLA workspace endpoints to query semantic models.'}
            </p>
          </div>

          {/* Dedicated Tab Panel Content - Settings Page */}
          {activeTab === 'settings' && (
            <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', borderColor: bridgeStatus.isConnected ? 'rgba(16, 185, 129, 0.25)' : 'var(--glass-border)', transition: 'all var(--transition-normal)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Link size={20} style={{ color: bridgeStatus.isConnected ? 'var(--success)' : 'var(--primary)' }} />
                  <h3 style={{ fontSize: '1.05rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {bridgeStatus.isConnected ? `Bridge Status: Connected to ${bridgeStatus.connectionName}` : 'Power BI Modeling MCP Gateway Manager'}
                  </h3>
                  {bridgeStatus.isConnected && (
                    <span className="pbi-badge" style={{ background: 'var(--success-glow)', border: '1px solid var(--success)', color: 'var(--success)', textShadow: 'none', boxShadow: 'none', padding: '0.1rem 0.5rem', fontSize: '0.7rem' }}>ACTIVE CONNECTION</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {bridgeStatus.isOffline && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={14} />
                      Express Proxy Offline (Run node server.cjs)
                    </span>
                  )}
                </div>
              </div>

              {/* Dynamic Gateway URL Configuration for Any Visitor */}
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', padding: '1.25rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={14} style={{ color: 'var(--secondary)' }} />
                    MCP Gateway Endpoint URL
                  </label>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Configured per visitor in browser localStorage</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="chat-text-input"
                    placeholder="http://localhost:3001 or https://your-tunnel.loca.lt"
                    value={customGatewayUrl}
                    onChange={(e) => setCustomGatewayUrl(e.target.value)}
                    style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', borderRadius: '6px', fontSize: '0.8rem', padding: '0.4rem 0.75rem', color: 'white' }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setApiBaseUrl(customGatewayUrl);
                      syncBridgeStatus();
                    }}
                    style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '6px' }}
                  >
                    Save &amp; Connect
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  💡 <strong>For anyone using this deployed app:</strong> To connect to Power BI Desktop running on your PC, start your local bridge (<code style={{ color: 'var(--primary)' }}>node server.cjs</code>), expose it with a free HTTPS tunnel (<code style={{ color: 'var(--primary)' }}>npx localtunnel --port 3001</code>), and paste the tunnel URL above!
                </p>
              </div>

              {!bridgeStatus.isOffline ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
                  {/* Option A: Connect to open local Desktop files */}
                  <div>
                    <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.6rem', fontWeight: '600' }}>
                      Option A: Connect to Open Power BI Desktop Files
                    </h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.4 }}>
                      Discovered active database ports running on your computer. Conversational queries will automatically execute against the selected live semantic model.
                    </p>
                    {localInstances.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {localInstances.map((inst: any) => (
                          <div 
                            key={inst.port} 
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.8rem' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{inst.name || 'Untitled Model'}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Local Server Port: localhost:{inst.port}</span>
                            </div>
                            <button 
                              className="btn btn-primary" 
                              disabled={isConnecting}
                              onClick={() => handleConnectLocal(inst.port, inst.name)}
                              style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem', borderRadius: '4px' }}
                            >
                              {isConnecting ? 'Connecting...' : 'Connect'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', padding: '1rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', lineHeight: 1.4 }}>
                        <AlertCircle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                        <span>No open Power BI Desktop instances discovered. Open a PBIX file and click the refresh button at the top to sync.</span>
                      </div>
                    )}
                  </div>

                  {/* Option B: Connect to Fabric workspace models */}
                  <form onSubmit={handleConnectFabric} style={{ borderLeft: '1px dashed var(--glass-border)', paddingLeft: '2rem' }}>
                    <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.6rem', fontWeight: '600' }}>
                      Option B: Connect to Fabric XMLA Semantic Models
                    </h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.4 }}>
                      Bridge the dashboard to corporate Microsoft Fabric workspaces using a secure XMLA endpoint connector.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fabric Workspace Name</label>
                        <input 
                          type="text" 
                          className="chat-text-input" 
                          placeholder="e.g. Sales Analytics Workspace" 
                          value={fabricWorkspace}
                          onChange={(e) => setFabricWorkspace(e.target.value)}
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', fontSize: '0.8rem', height: '36px', width: '100%', padding: '0 0.75rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Semantic Model Name</label>
                        <input 
                          type="text" 
                          className="chat-text-input" 
                          placeholder="e.g. Enterprise_Sales_Model" 
                          value={fabricModel}
                          onChange={(e) => setFabricModel(e.target.value)}
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', fontSize: '0.8rem', height: '36px', width: '100%', padding: '0 0.75rem' }}
                        />
                      </div>
                      <button 
                        type="submit" 
                        className="btn btn-secondary" 
                        disabled={isConnecting || !fabricWorkspace || !fabricModel}
                        style={{ fontSize: '0.8rem', padding: '0.5rem', width: '100%', height: '38px', background: 'var(--bg-tertiary)', marginTop: '0.5rem', color: 'white', borderColor: 'var(--primary)' }}
                      >
                        {isConnecting ? 'Establishing Secure Connect...' : 'Connect to Fabric XMLA'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '1rem 0', lineHeight: 1.6, textAlign: 'center' }}>
                  <AlertCircle size={24} style={{ color: 'var(--danger)', margin: '0 auto 0.5rem auto' }} />
                  <span>The Express gateway server bridges the front-end dashboard to your registered PowerBI Modeling MCP executable.</span>
                  <br />
                  <span>To launch it, please run <strong>node server.cjs</strong> inside your terminal workspace.</span>
                </div>
              )}
            </div>
          )}

          {/* Schema Explorer Dedicated View */}
          {activeTab === 'explorer' && (
            <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Database size={20} style={{ color: 'var(--primary)' }} />
                  <h3 style={{ fontSize: '1.05rem', fontWeight: '700' }}>
                    Semantic Model Tables & Columns
                  </h3>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {liveTables.length} Active Tables Discovered
                </span>
              </div>

              {liveTables.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                  {liveTables.map((tbl: any) => (
                    <div key={tbl.name} className="schema-table-box" style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '1rem' }}>
                      <div className="schema-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                        <Database size={14} />
                        <span>{tbl.name}</span>
                        <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: 'auto', color: 'var(--text-secondary)' }}>
                          {tbl.fields?.length || 0} fields
                        </span>
                      </div>
                      <div className="schema-table-fields" style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {tbl.fields && tbl.fields.length > 0 ? (
                          tbl.fields.map((f: any) => (
                            <div key={f.name} className="schema-field-item" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                              <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                              <span className="field-type" style={{ color: 'var(--primary)', fontSize: '0.7rem' }}>{f.key}</span>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No column details cached.</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                  <Database size={36} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem auto' }} />
                  <h4>No Semantic Model Tables Discovered</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Connect to an active Power BI Desktop model or Fabric workspace under Connection Settings to explore tables and fields.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Active Analysis Core Canvas Grid (Overview Tab) */}
          {activeTab === 'overview' && (() => {
            const filteredDaxResult = daxResult ? {
              ...daxResult,
              rows: daxResult.rows ? daxResult.rows.filter((row: any) => {
                if (!gridSearch) return true;
                const q = gridSearch.toLowerCase();
                return daxResult.columns.some((c: string) => {
                  const val = row[c];
                  return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
                });
              }) : []
            } : null;

            return (
              <div className="charts-grid" style={{ gridTemplateColumns: '1fr' }}>
                {/* Main Visualizer Window */}
                <div className="glass-panel" style={{ height: '620px', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                        {activeQuery ? activeQuery.question : 'Power BI Model Analytics'}
                      </h3>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {activeQuery ? activeQuery.description : 'Interactive data visualization and analysis from your connected semantic model.'}
                      </span>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginLeft: 'auto' }}>
                      {viewTab === 'table' && (
                        <div className="input-container" style={{ 
                          padding: '0.25rem 0.6rem', 
                          height: '28px', 
                          border: '1px solid var(--glass-border)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.35rem', 
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: '6px',
                          transition: 'all 0.25s ease',
                          width: gridSearch ? '140px' : '100px'
                        }}>
                          <Search size={12} style={{ color: 'var(--text-muted)' }} />
                          <input 
                            type="text" 
                            placeholder="Search grid..." 
                            value={gridSearch}
                            onChange={(e) => setGridSearch(e.target.value)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.7rem', outline: 'none', width: '100%' }} 
                          />
                          {gridSearch && (
                            <X size={12} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setGridSearch('')} />
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', background: 'var(--bg-primary)', padding: '0.2rem', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
                        <button 
                          className={`btn ${viewTab === 'visual' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setViewTab('visual')}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}
                        >
                          <BarChart2 size={12} style={{ marginRight: '4px' }} />
                          Visual
                        </button>
                        <button 
                          className={`btn ${viewTab === 'table' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setViewTab('table')}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', marginLeft: '0.25rem' }}
                        >
                          <TableIcon size={12} style={{ marginRight: '4px' }} />
                          Data Grid
                        </button>
                      </div>

                      <button
                        className="btn btn-secondary"
                        onClick={() => setIsVisualizerFullScreen(true)}
                        style={{ padding: '0.25rem', width: '28px', height: '28px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Expand to Full Screen"
                      >
                        <Maximize2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Content Switcher: Custom Relational Charts vs relational table grid */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                    {filteredDaxResult && filteredDaxResult.rows && filteredDaxResult.rows.length > 0 ? (
                      viewTab === 'visual' ? (
                        filteredDaxResult.rows.length === 1 && filteredDaxResult.rows[0].Error ? (
                          <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px dashed rgba(239, 68, 68, 0.25)', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                            <AlertCircle size={32} style={{ color: '#ef4444' }} />
                            <h4 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', margin: 0 }}>DAX Execution Syntax Error</h4>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                              {filteredDaxResult.rows[0].Error}
                            </p>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Please review the Grounded DAX Execution Editor inside the Collapsible Advanced Console.
                            </span>
                          </div>
                        ) : (
                          <div style={{ width: '100%', height: '450px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <CustomSvgChart 
                              chartType={activeQuery ? activeQuery.chartType : 'bar'} 
                              daxResult={filteredDaxResult} 
                            />
                          </div>
                        )
                      ) : (
                        <div className="results-table-container" style={{ width: '100%', maxHeight: '440px', overflowY: 'auto', alignSelf: 'stretch' }}>
                          <table className="results-table">
                            <thead>
                              <tr>
                                {filteredDaxResult.columns.map((c: string) => (
                                  <th key={c}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {filteredDaxResult.rows.length > 0 ? (
                                filteredDaxResult.rows.map((row: any, idx: number) => (
                                  <tr key={idx}>
                                    {filteredDaxResult.columns.map((c: string) => {
                                      const val = row[c];
                                      let displayVal = val;
                                      if (typeof val === 'number') {
                                        const cLower = c ? String(c).toLowerCase() : '';
                                        if (cLower.includes('rate') || cLower.includes('%') || cLower.includes('percent')) {
                                          displayVal = val <= 1.0 ? `${Math.round(val * 1000) / 10}%` : `${val}%`;
                                        }
                                      }
                                      return <td key={c}>{displayVal !== null && displayVal !== undefined ? String(displayVal) : 'None'}</td>;
                                    })}
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={filteredDaxResult.columns.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                    No matching rows.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : (
                      <div style={{ color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <Activity size={32} className="pulse-slow" style={{ color: 'var(--text-muted)' }} />
                        <span>Ask a question in the AI Copilot to query your model and visualize results.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Interactive Narrative Insights Widget */}
                <div className="glass-panel insight-card" style={{ height: '350px', display: 'flex', flexDirection: 'column', padding: '1.25rem', gap: '1rem', overflowY: 'auto' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                      {bridgeStatus.isConnected 
                        ? <Brain size={16} style={{ color: '#a78bfa' }} />
                        : <Sparkles size={16} style={{ color: 'var(--secondary)' }} />
                      }
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                        {bridgeStatus.isConnected ? 'Gemini-Powered AI Analyst' : 'AI Analyst Narrative'}
                      </h3>
                      {bridgeStatus.isConnected && (
                        <span style={{ fontSize: '0.65rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '4px', padding: '1px 6px', marginLeft: 'auto' }}>
                          Google Gemini
                        </span>
                      )}
                    </div>

                    {messages.length > 0 && messages[messages.length - 1]?.insights ? (
                      <div>
                        <div className="insight-summary">
                          {messages[messages.length - 1].insights?.summary}
                        </div>
                        <ul className="insight-bullets">
                          {messages[messages.length - 1].insights?.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                        
                        <div className="insight-actions">
                          <h4>Recommended Business Actions</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                            {messages[messages.length - 1].insights?.recommendations.map((r, i) => (
                              <div key={i} className="action-item">
                                {r}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 0', gap: '0.5rem' }}>
                        <HelpCircle size={24} style={{ color: 'var(--text-muted)' }} />
                        <span>Awaiting execution completion to synthesize key business recommendations.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Collapsible Developer Tools & Grounded DAX Console */}
          <div className={`dev-tools-accordion ${isDevToolsExpanded ? 'expanded' : ''}`}>
            <div className="dev-tools-trigger" onClick={() => setIsDevToolsExpanded(!isDevToolsExpanded)}>
              <h3 style={{ margin: 0, fontSize: '0.85rem' }}>
                <Terminal size={14} style={{ color: 'var(--secondary)' }} />
                Developer Tools & Grounded DAX Console
              </h3>
              <span>{isDevToolsExpanded ? 'Collapse Console ▲' : 'Expand Advanced Tools (DAX & Schema Browser) ▼'}</span>
            </div>
            {isDevToolsExpanded && (
              <div className="dev-tools-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', borderTop: '1px dashed rgba(255, 255, 255, 0.03)', paddingTop: '1.25rem', animation: 'slide-down var(--transition-normal)' }}>
                {/* Grounded DAX Execution Editor */}
                <div className="glass-panel dax-console-card">
                  <div className="dax-console-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Terminal size={16} style={{ color: 'var(--secondary)' }} />
                      <h3 style={{ fontSize: '0.95rem' }}>Grounded DAX Execution Editor</h3>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Modify syntax overrides and re-evaluate directly against Analysis Services
                    </span>
                  </div>

                  <div className="dax-editor-container">
                    <textarea
                      className="dax-code-textarea"
                      value={currentDax}
                      onChange={(e) => setCurrentDax(e.target.value)}
                      placeholder="EVALUATE SUMMARIZECOLUMNS( ... )"
                    />
                    <button className="dax-run-btn" onClick={handleRunCustomDax}>
                      <Play size={10} fill="white" />
                      Run Query
                    </button>
                  </div>
                </div>

                {/* Semantic Schema Browser */}
                <div className="glass-panel schema-browser">
                  <div className="schema-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Database size={16} style={{ color: 'var(--primary)' }} />
                      <h3 style={{ fontSize: '0.95rem' }}>
                        {bridgeStatus.isConnected ? 'Live Power BI Schema Browser' : 'Semantic Schema Browser'}
                      </h3>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {bridgeStatus.isConnected 
                        ? `${liveTables.length} Active Tables Discovered via MCP` 
                        : 'Connect to Power BI to browse schema'}
                    </span>
                  </div>

                  {/* Tables visualization */}
                  <div className="schema-tables">
                    {liveTables.map((tbl: any) => (
                      <div key={tbl.name} className="schema-table-box" style={{ borderColor: 'rgba(16, 129, 185, 0.15)' }}>
                        <div className="schema-table-title" style={{ color: '#10b981' }}>
                          <Database size={12} />
                          <span>{tbl.name}</span>
                          <span style={{ fontSize: '0.6rem', background: 'rgba(255,255,255,0.05)', padding: '0.05rem 0.25rem', borderRadius: '3px', marginLeft: 'auto', color: 'var(--text-secondary)' }}>
                            Live Table
                          </span>
                        </div>
                        <div className="schema-table-fields" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                          {tbl.fields && tbl.fields.length > 0 ? (
                            tbl.fields.map((f: any) => (
                              <div key={f.name} className="schema-field-item">
                                <span>{f.name}</span>
                                <span className="field-type" style={{ color: 'var(--primary)' }}>{f.key}</span>
                              </div>
                            ))
                          ) : (
                            <div className="schema-field-item">
                              <span style={{ color: 'var(--text-muted)' }}>Fields:</span>
                              <span className="field-type" style={{ color: 'var(--primary)' }}>Dynamic</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Copilot Side Console panel */}
      <div className={`copilot-sidebar ${copilotCollapsed ? 'collapsed' : ''}`}>
        <div className="copilot-header">
          <div className="copilot-user-info">
            <div className="copilot-avatar">
              <Sparkles size={18} style={{ color: 'white' }} />
            </div>
            <div className="copilot-name-group">
              <h3>Senior AI Analyst</h3>
              <p>
                <span className="copilot-status-dot" />
                Copilot online
              </p>
            </div>
          </div>
          <button 
            className="btn btn-secondary btn-icon"
            onClick={() => setCopilotCollapsed(true)}
            style={{ width: '24px', height: '24px', borderRadius: '6px' }}
          >
            ×
          </button>
        </div>

        {/* Conversation Thread history */}
        <div className="chat-history">
          <div className="message-bubble assistant">
            <div className="message-content">
              Hello! I am your AI Power BI Analyst. I connect directly to your active Power BI Desktop or Fabric semantic model.
              <br /><br />
              Ask me any question about your data — trends, rankings, summaries, distributions, or calculations. I formulate grounded DAX queries, execute them via MCP, and render charts and insights.
            </div>
          </div>

          {messages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.sender}`}>
              <div className="message-content" style={{ whiteSpace: 'pre-line' }}>
                {msg.text}
                
                {msg.statusSteps && (
                  <div className="pipeline-stepper">
                    {msg.statusSteps.map((step: any, idx: number) => (
                      <div key={idx} className={`pipeline-step ${step.status}`}>
                        <div className="pipeline-step-dot" />
                        <span>{step.name} ({step.status})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {msg.queryInfo && (
                <div style={{ padding: '0.4rem 0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderTop: 'none', borderBottomRightRadius: msg.suggestions && msg.suggestions.length > 0 ? '0px' : '8px', borderBottomLeftRadius: msg.suggestions && msg.suggestions.length > 0 ? '0px' : '8px', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Grounded DAX formulated</span>
                  <div style={{ display: 'flex', gap: '0.35rem', color: 'var(--secondary)' }}>
                    <Clock size={10} style={{ display: 'inline', alignSelf: 'center' }} />
                    <span>Exec: {msg.daxResult?.executionTimeMs || 0}ms</span>
                  </div>
                </div>
              )}

              {msg.suggestions && msg.suggestions.length > 0 && (
                <div style={{ padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.04)', borderTop: 'none', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.1rem', fontWeight: '600' }}>
                    💡 Related Insights & Next Actions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {msg.suggestions.map((s, idx) => (
                      <div 
                        key={idx} 
                        onClick={() => handleSuggestionClick(s)}
                        style={{ 
                          textAlign: 'left', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap', 
                          padding: '0.3rem 0.5rem', 
                          borderRadius: '4px', 
                          fontSize: '0.75rem', 
                          background: 'rgba(99, 102, 241, 0.08)', 
                          border: '1px solid rgba(99, 102, 241, 0.15)',
                          cursor: 'pointer',
                          color: 'var(--primary)',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)';
                          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
                          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.15)';
                        }}
                      >
                        <span style={{ fontSize: '0.8rem', color: 'var(--secondary)' }}>•</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Categories filters */}
        <div className="suggestions-box">
          <div className="suggestions-title">Query Categories</div>
          <div className="suggestions-list" style={{ gap: '0.35rem' }}>
            {categoriesList.map((cat: any) => (
              <span 
                key={cat.id} 
                className="suggestion-pill"
                onClick={() => setFilterCategory(cat.id)}
                style={{ 
                  background: filterCategory === cat.id ? 'var(--primary)' : 'var(--bg-tertiary)',
                  color: filterCategory === cat.id ? 'white' : 'var(--text-secondary)'
                }}
              >
                {cat.label}
              </span>
            ))}
          </div>
        </div>

        {/* Suggestion prompt list */}
        <div className="suggestions-box" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div className="suggestions-title">Example Questions</div>
          <div className="suggestions-list" style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
            {filteredSuggestions.map((g: any, idx: number) => (
              <div 
                key={idx} 
                className="suggestion-pill" 
                onClick={() => handleSuggestionClick(g.question)}
                style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: '280px' }}
              >
                {g.question}
              </div>
            ))}
          </div>
        </div>

        {/* Interactive Text input panel */}
        <div className="chat-input-panel">
          <form onSubmit={(e) => { e.preventDefault(); handleExecuteQuestion(inputValue); setInputValue(''); }}>
            <div className="input-container">
              <input
                type="text"
                className="chat-text-input"
                placeholder="Ask any question about your data..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <button 
                type="submit" 
                className="chat-send-btn"
                disabled={!inputValue.trim()}
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Full-Screen Visualizer Modal Window */}
      {isVisualizerFullScreen && (() => {
        const filteredDaxResult = daxResult ? {
          ...daxResult,
          rows: daxResult.rows ? daxResult.rows.filter((row: any) => {
            if (!gridSearch) return true;
            const q = gridSearch.toLowerCase();
            return daxResult.columns.some((c: string) => {
              const val = row[c];
              return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
            });
          }) : []
        } : null;

        return (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(5, 7, 15, 0.95)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            animation: 'fade-in 0.2s ease-out'
          }}>
            <div style={{
              width: '90vw',
              height: '85vh',
              maxWidth: '1400px',
              background: 'rgba(10, 15, 30, 0.7)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              padding: '2rem',
              gap: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.35rem' }}>
                    {activeQuery ? activeQuery.question : 'Power BI Model Analytics'}
                  </h2>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {activeQuery ? activeQuery.description : 'Interactive data analysis from your connected Power BI semantic model.'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {viewTab === 'table' && (
                    <div className="input-container" style={{ 
                      padding: '0.4rem 0.8rem', 
                      height: '36px', 
                      border: '1px solid var(--glass-border)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem', 
                      background: 'rgba(0,0,0,0.4)',
                      borderRadius: '8px',
                      width: '240px'
                    }}>
                      <Search size={14} style={{ color: 'var(--text-muted)' }} />
                      <input 
                        type="text" 
                        placeholder="Search active dataset..." 
                        value={gridSearch}
                        onChange={(e) => setGridSearch(e.target.value)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', width: '100%' }} 
                      />
                      {gridSearch && (
                        <X size={14} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setGridSearch('')} />
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', background: 'var(--bg-primary)', padding: '0.3rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                    <button 
                      className={`btn ${viewTab === 'visual' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setViewTab('visual')}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: '6px' }}
                    >
                      <BarChart2 size={14} style={{ marginRight: '5px' }} />
                      Visual
                    </button>
                    <button 
                      className={`btn ${viewTab === 'table' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setViewTab('table')}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', borderRadius: '6px', marginLeft: '0.35rem' }}
                    >
                      <TableIcon size={14} style={{ marginRight: '5px' }} />
                      Data Grid
                    </button>
                  </div>

                  <button
                    className="btn btn-secondary"
                    onClick={() => setIsVisualizerFullScreen(false)}
                    style={{ padding: '0.4rem', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}
                    title="Close Full Screen"
                  >
                    <Minimize2 size={16} />
                  </button>
                </div>
              </div>

              {/* Content Switcher */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, width: '100%' }}>
                {filteredDaxResult && filteredDaxResult.rows && filteredDaxResult.rows.length > 0 ? (
                  viewTab === 'visual' ? (
                    filteredDaxResult.rows.length === 1 && filteredDaxResult.rows[0].Error ? (
                      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px dashed rgba(239, 68, 68, 0.25)', padding: '2rem', borderRadius: '16px', textAlign: 'center', maxWidth: '500px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <AlertCircle size={40} style={{ color: '#ef4444' }} />
                        <h4 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>DAX Execution Syntax Error</h4>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                          {filteredDaxResult.rows[0].Error}
                        </p>
                      </div>
                    ) : (
                      <div style={{ width: '100%', height: '85%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <CustomSvgChart 
                          chartType={activeQuery ? activeQuery.chartType : 'bar'} 
                          daxResult={filteredDaxResult} 
                        />
                      </div>
                    )
                  ) : (
                    <div className="results-table-container" style={{ width: '100%', height: '100%', overflowY: 'auto', alignSelf: 'stretch', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                      <table className="results-table" style={{ fontSize: '0.9rem' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                          <tr>
                            {filteredDaxResult.columns.map((c: string) => (
                              <th key={c} style={{ padding: '0.85rem 1.25rem', fontSize: '0.85rem' }}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDaxResult.rows.length > 0 ? (
                            filteredDaxResult.rows.map((row: any, idx: number) => (
                              <tr key={idx} style={{ transition: 'all 0.15s ease' }}>
                                {filteredDaxResult.columns.map((c: string) => {
                                  const val = row[c];
                                  let displayVal = val;
                                  if (typeof val === 'number') {
                                    const cLower = c ? String(c).toLowerCase() : '';
                                    if (cLower.includes('rate') || cLower.includes('%') || cLower.includes('percent')) {
                                      displayVal = val <= 1.0 ? `${Math.round(val * 1000) / 10}%` : `${val}%`;
                                    }
                                  }
                                  return <td key={c} style={{ padding: '0.85rem 1.25rem' }}>{displayVal !== null && displayVal !== undefined ? String(displayVal) : 'None'}</td>;
                                })}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={filteredDaxResult.columns.length} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                                No matching rows found in the dataset.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>No data loaded in the active workspace.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Custom interactive SVG Chart renderer to support Bar, Line, Donut and Decomposition tree
function CustomSvgChart({ chartType, daxResult }: { chartType: string; daxResult: DaxResult }) {
  const rawRows = daxResult.rows;
  const cols = daxResult.columns;

  if (!rawRows || rawRows.length === 0) return null;

  const rows = rawRows.slice(0, 20);

  const isPercent = (col: string) => {
    if (!col) return false;
    const c = col.toLowerCase();
    return c.includes('rate') || c.includes('%') || c.includes('percent');
  };
  
  const numericCols = cols.filter((c: string) => c && typeof rows[0]?.[c] === 'number');
  const primaryMetric = numericCols[0] || cols[0] || '';
  const primaryDimension = cols.find((c: string) => c && !numericCols.includes(c)) || cols[0] || '';

  const values = rows.map((r: any) => {
    const v = Number(r[primaryMetric]);
    return isNaN(v) ? 0 : v;
  });
  const labels = rows.map((r: any) => String((primaryDimension && r[primaryDimension] !== undefined) ? r[primaryDimension] : 'None'));
  
  const rawMax = Math.max(...values, 1);
  const maxVal = isNaN(rawMax) ? 1 : rawMax;

  const chartHeight = 350;
  const chartWidth = 750;
  const padding = 45;

  // Render Bar Charts
  if (chartType === 'bar') {
    const barWidth = Math.max(16, Math.min(48, (chartWidth - padding * 2) / rows.length - 8));
    const totalBarsWidth = rows.length * (barWidth + 8);
    const startX = Math.max(padding, (chartWidth - totalBarsWidth) / 2);

    return (
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, index) => {
          const y = chartHeight - padding - ratio * (chartHeight - padding * 2);
          return (
            <line 
              key={index}
              x1={padding} 
              y1={y} 
              x2={chartWidth - padding} 
              y2={y} 
              stroke="rgba(255,255,255,0.03)" 
              strokeWidth={1} 
            />
          );
        })}

        {rows.map((row: any, idx: number) => {
          const valRaw = Number(row[primaryMetric]);
          const val = isNaN(valRaw) ? 0 : valRaw;
          const heightRatioRaw = val / maxVal;
          const heightRatio = isNaN(heightRatioRaw) ? 0 : heightRatioRaw;
          const barHeight = Math.max(2, heightRatio * (chartHeight - padding * 2));
          const x = startX + idx * (barWidth + 8);
          const y = chartHeight - padding - barHeight;

          return (
            <g key={idx} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}>
              <title>{`${labels[idx]}: ${val}`}</title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill="url(#primaryGrad)"
                style={{ filter: 'drop-shadow(0px 2px 4px rgba(99, 102, 241, 0.2))' }}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                fill="var(--text-primary)"
                fontSize={8}
                fontWeight={600}
                textAnchor="middle"
              >
                {isPercent(primaryMetric) 
                  ? `${Math.round(val * 100)}%` 
                  : val}
              </text>
              <text
                x={x + barWidth / 2}
                y={chartHeight - padding + 15}
                fill="var(--text-secondary)"
                fontSize={8}
                textAnchor="middle"
                transform={labels[idx] && labels[idx].length > 10 ? `rotate(-15, ${x + barWidth / 2}, ${chartHeight - padding + 15})` : undefined}
              >
                {labels[idx] && labels[idx].length > 12 ? `${labels[idx].substring(0, 10)}...` : labels[idx]}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // Render Line Trends
  if (chartType === 'line') {
    const totalPoints = labels.length;
    const startX = padding + 10;
    const pointWidth = (chartWidth - padding * 2 - 20) / Math.max(totalPoints - 1, 1);
    
    const points = rows.map((row: any, idx: number) => {
      const valRaw = Number(row[primaryMetric]);
      const val = isNaN(valRaw) ? 0 : valRaw;
      const x = startX + idx * pointWidth;
      const ratioRaw = val / maxVal;
      const ratio = isNaN(ratioRaw) ? 0 : ratioRaw;
      const y = chartHeight - padding - ratio * (chartHeight - padding * 2);
      return { x, y, label: labels[idx], val };
    });

    const pathD = points.reduce((d: string, p: any, idx: number) => {
      const px = isNaN(p.x) ? 0 : p.x;
      const py = isNaN(p.y) ? 0 : p.y;
      return idx === 0 ? `M ${px} ${py}` : `${d} L ${px} ${py}`;
    }, '');

    const areaD = points.length > 0 
      ? `${pathD} L ${points[points.length - 1].x} ${chartHeight - padding} L ${points[0].x} ${chartHeight - padding} Z`
      : '';

    return (
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, index) => {
          const y = chartHeight - padding - ratio * (chartHeight - padding * 2);
          return (
            <line 
              key={index}
              x1={padding} 
              y1={y} 
              x2={chartWidth - padding} 
              y2={y} 
              stroke="rgba(255,255,255,0.03)" 
              strokeWidth={1} 
            />
          );
        })}

        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        {areaD && <path d={areaD} fill="url(#areaGrad)" />}

        <path 
          d={pathD} 
          fill="none" 
          stroke="var(--primary)" 
          strokeWidth={2.5} 
          style={{ filter: 'drop-shadow(0px 4px 6px rgba(99, 102, 241, 0.3))' }}
        />

        {points.map((p: any, idx: number) => {
          return (
            <g key={idx} style={{ cursor: 'pointer' }}>
              <title>{`${p.label}: ${isPercent(primaryMetric) ? `${Math.round(p.val * 1000) / 10}%` : p.val}`}</title>
              <circle
                cx={p.x}
                cy={p.y}
                r={4}
                fill="var(--secondary)"
                stroke="#fff"
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y - 8}
                fill="var(--text-primary)"
                fontSize={8}
                fontWeight={600}
                textAnchor="middle"
              >
                {isPercent(primaryMetric) ? `${Math.round(p.val * 100)}%` : p.val}
              </text>
              <text
                x={p.x}
                y={chartHeight - padding + 15}
                fill="var(--text-secondary)"
                fontSize={8}
                textAnchor="middle"
              >
                {p.label && p.label.includes('-') ? p.label.split('-')[2] || p.label : p.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // Render segmented pie/donuts
  if (chartType === 'donut' || chartType === 'pie') {
    const cx = chartWidth / 2 - 40;
    const cy = chartHeight / 2;
    const r = 80;
    const strokeWidth = 24;
    const circ = 2 * Math.PI * r;

    let accumulatedPercent = 0;

    const colors = [
      'var(--primary)',
      'var(--secondary)',
      '#10b981',
      '#f59e0b',
      '#ef4444',
      '#3b82f6',
      '#ec4899',
      '#64748b'
    ];

    const totalVal = values.reduce((sum, v) => sum + v, 0) || 1;

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: '2rem' }}>
        <svg width={cx * 2} height={chartHeight} style={{ overflow: 'visible' }}>
          {rows.map((row: any, idx: number) => {
            const valRaw = Number(row[primaryMetric]);
            const val = isNaN(valRaw) ? 0 : valRaw;
            const percent = val / totalVal;
            const strokeDasharray = `${percent * circ} ${circ}`;
            const strokeDashoffset = -(accumulatedPercent * circ);
            accumulatedPercent += percent;

            return (
              <circle
                key={idx}
                cx={cx}
                cy={cy}
                r={r}
                fill="transparent"
                stroke={colors[idx % colors.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
              >
                <title>{`${labels[idx]}: ${val} (${Math.round(percent * 100)}%)`}</title>
              </circle>
            );
          })}
        </svg>

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '280px', overflowY: 'auto' }}>
          {rows.map((row: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: colors[idx % colors.length] }} />
              <span style={{ color: 'var(--text-secondary)' }}>{labels[idx]}:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row[primaryMetric]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback Table Chart View
  return (
    <div style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
      Select Data Grid view above to inspect full tabular detail.
    </div>
  );
}
