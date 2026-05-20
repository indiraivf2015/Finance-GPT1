import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { Brain, FileText, Activity, Users, Database, ChevronRight, ChevronDown, ChevronLeft, BarChart3, AlertCircle, Loader2, Upload, FileUp, CheckCircle2, FileSpreadsheet, Send, Sparkles, MessageSquare, Bot, User, RefreshCw, Clock, Zap, Target, ShieldAlert, TrendingUp, Lightbulb, Compass, MonitorPlay, Layers, ArrowUpRight, Plus, Command, Heart, AlertTriangle, Scale, DollarSign, PieChart, HeartHandshake, Baby, MapPin, Clapperboard, Film, PenTool, LayoutTemplate, X, Play, Scissors, Check, Share2, Download, Pause, Volume2, VolumeX, Maximize, Paperclip, Trash2, Table2, PlayCircle, Circle, Disc, FileSearch, FolderOpen } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart as RePieChart, Pie, Cell, 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis 
} from 'recharts';
import { INDIRA_CFO_DOCTRINE } from './doctrine';
import { getBackendBaseUrl, DEV_BACKEND_PORT } from './runtime-api';
import {
  pickFilesForQuery,
  formatCollectionSchemaBlock,
  buildRevenueMongoExample,
  buildMongoQueryRules,
  buildMongoRepairPrompt,
  formatAccessibleSourcesList,
  detectQueryTopics,
  type CollectionSchema,
} from './lib/mongo-query-hints';

// --- Types ---
declare global {
  interface Window {
    marked: {
      parse: (text: string) => string;
    };
    mermaid: {
      initialize: (config: any) => void;
      run: (config?: any) => Promise<void>;
    };
    alasql?: any;
    Papa?: any;
  }
}

// JSZip Declaration
declare var JSZip: any;

interface SimulationData {
  topEnd: string;
  bottomEnd: string;
  cxImpact: string;
  constraints: string;
  synthesis: string;
}

interface ChartData {
  title: string;
  chartType: 'bar' | 'pie' | 'radar';
  description?: string;
  data: any[];
  config?: {
    xKey?: string;
    yKey?: string; // For Bar
    nameKey?: string; // For Pie/Radar
    valueKey?: string; // For Pie/Radar
    colors?: string[];
  }
}

interface VideoTheme {
  id: number;
  title: string;
  rationale: string;
  emotionalHook: string;
  targetAudience: string;
  shortTag?: string; // e.g. "Cost Anxiety"
}

interface ScriptSegment {
  seq: number;
  duration: string;
  visual: string;
  audio: string;
}

interface Attachment {
  name: string;
  content: string;
  isCsv: boolean;
  isLarge: boolean;
  tableName?: string;
  collectionName?: string;
  headers?: string[];
  columnTypes?: Record<string, string>;
  rowCount?: number;
}

interface PlaylistItem {
  url: string;
  segment: ScriptSegment;
}

// --- Constants ---
const MAX_TEXT_PAYLOAD_SIZE = 30000; // Reduced to 30KB to be safe with quotas. CSVs will use Schema only.
const SAMPLE_VIDEO_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
const CHART_COLORS = ['#db2777', '#059669', '#d97706', '#7c3aed', '#2563eb', '#dc2626']; // Pink, Emerald, Amber, Violet, Blue, Red

// --- Nomenclature Definition ---
const DATA_LAYERS = [
  { id: 'master', title: 'A. MASTER / DIMENSION LAYER', subtitle: 'Center → Cluster → Entity lookup', icon: Database, color: 'bg-slate-500', textColor: 'text-slate-600', borderColor: 'border-slate-100', files: ['24_Center_Master.csv', '01_Index_of_Fortnightly.csv'] },
  { id: 'operational', title: 'B. OPERATIONAL VOLUME LAYER', subtitle: 'Footfall & ICSI cycle funnel', icon: Activity, color: 'bg-blue-500', textColor: 'text-blue-600', borderColor: 'border-blue-100', files: ['17_Footfall.csv', '19_ICSI.csv'] },
  { id: 'financial', title: 'C. FINANCIAL LAYER', subtitle: 'Revenue, Pharmacy & Collections', icon: DollarSign, color: 'bg-emerald-500', textColor: 'text-emerald-600', borderColor: 'border-emerald-100', files: ['21_Revenue.csv', '22_Pharmacy.csv', '23_CollectionDayonDay.csv'] },
  { id: 'mis_center', title: 'D. MIS SUMMARY — CENTER', subtitle: 'Center highlights & IIHL analysis', icon: BarChart3, color: 'bg-amber-500', textColor: 'text-amber-600', borderColor: 'border-amber-100', files: ['02_Top_10_Centers_Highlights_2526.csv', '03_All_Centers_Highlights_2526.csv', '04_All_Centers_Highlights_YTD.csv', '06_CenterlevelIIHLAnalysis2526.csv', '08_CenterlevelDetailedAnalysisYTD.csv'] },
  { id: 'mis_strategic', title: 'E. MIS SUMMARY — CLUSTER & STRATEGIC', subtitle: 'Cluster, Old-vs-New & business outlook', icon: Layers, color: 'bg-pink-500', textColor: 'text-pink-600', borderColor: 'border-pink-100', files: ['05_SummaryOverview.csv', '09_OldVsNewSummary.csv', '10_ClusterSummary.csv', '13_ClusterPerformanceReportYTD.csv', '14_ClusterLevelPerformanceRepo2526.csv', '15_Sheet3.csv'] }
];

// --- Helpers ---

// Circular JSON replacer for safe stringification
const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key: any, value: any) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

// Safe string converter to prevent [object Object] and circular errors
const safeString = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return String(val);
    if (val instanceof Error) return val.message || String(val);
    
    if (typeof val === 'object') {
        // Try to find a text property if it exists (common in API responses)
        if (val.text) return String(val.text);
        
        // Fallback to stringify but avoid [object Object] and circular refs
        try {
            const str = JSON.stringify(val, getCircularReplacer(), 2);
            return str === '{}' ? '' : str; // Hide empty objects
        } catch (e) {
            return '[Complex Object]';
        }
    }
    return String(val);
};

const safeRenderMarkdown = (content: any): { __html: string } => {
  // Use safeString to ensure we don't crash on circular objects or nulls
  const text = typeof content === 'string' ? content : safeString(content);
  
  if (typeof window !== 'undefined' && window.marked) {
    try {
       // Check for modern marked (parse method)
       if (typeof window.marked.parse === 'function') {
          const html = window.marked.parse(text);
          if (typeof html === 'string') {
             return { __html: html };
          }
       }
       // Check for legacy marked (function)
       else if (typeof window.marked === 'function') {
          const html = (window.marked as any)(text);
          if (typeof html === 'string') {
             return { __html: html };
          }
       }
    } catch (e) {
       console.error("Markdown render error:", e);
    }
  }
  
  // Fallback: Treat as plain text, preserving newlines
  return { __html: text.replace(/\n/g, '<br/>') };
};

// Custom Hook for Local Storage Persistence
function usePersistentState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      if (typeof window !== 'undefined') {
        const item = window.localStorage.getItem(key);
        return item ? JSON.parse(item) : initialValue;
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        // Use circular replacer to be safe when saving state
        window.localStorage.setItem(key, JSON.stringify(state, getCircularReplacer()));
      }
    } catch (error) {
      console.warn(`Error saving localStorage key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}

// --- Components ---

const WindowControls = () => (
  <div className="flex gap-1.5">
    <div className="w-2.5 h-2.5 rounded-full bg-red-400 hover:bg-red-500 transition-colors"></div>
    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 hover:bg-amber-500 transition-colors"></div>
    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 hover:bg-emerald-500 transition-colors"></div>
  </div>
);

// --- NEW COMPONENT: BiChartsWidget ---
const BiChartsWidget = ({ data }: { data: ChartData }) => {
  const colors = data.config?.colors || CHART_COLORS;
  
  // Parse numeric values if they came as strings
  const processedData = data.data.map(item => {
     const newItem = { ...item };
     if (data.chartType === 'bar' && data.config?.yKey) {
        const parsed = parseFloat(newItem[data.config.yKey]);
        newItem[data.config.yKey] = isNaN(parsed) ? 0 : parsed;
     }
     if ((data.chartType === 'pie' || data.chartType === 'radar') && data.config?.valueKey) {
        const parsed = parseFloat(newItem[data.config.valueKey]);
        newItem[data.config.valueKey] = isNaN(parsed) ? 0 : parsed;
     }
     return newItem;
  });

  // Safe tooltip formatter to avoid [object Object]
  const tooltipFormatter = (value: any, name: any, props: any) => {
      if (typeof value === 'object') return JSON.stringify(value);
      return [value, name];
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 shadow-lg p-6 overflow-hidden relative group">
       <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-500 via-rose-400 to-amber-400"></div>
       
       <div className="flex justify-between items-start mb-6">
           <div>
               <h3 className="text-lg font-bold text-slate-800">{safeString(data.title)}</h3>
               {data.description && <p className="text-sm text-slate-500 mt-1">{safeString(data.description)}</p>}
           </div>
           <div className="p-2 bg-slate-50 rounded-lg text-slate-400">
               {data.chartType === 'bar' && <BarChart3 size={20} />}
               {data.chartType === 'pie' && <PieChart size={20} />}
               {data.chartType === 'radar' && <Target size={20} />}
           </div>
       </div>

       <div className="w-full h-[350px]">
           <ResponsiveContainer width="100%" height="100%">
               {data.chartType === 'bar' ? (
                   <BarChart data={processedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis 
                         dataKey={data.config?.xKey || 'name'} 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: '#64748b', fontSize: 12 }} 
                         tickFormatter={(val) => safeString(val)}
                         dy={10}
                       />
                       <YAxis 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: '#64748b', fontSize: 12 }} 
                       />
                       <Tooltip 
                         formatter={tooltipFormatter}
                         cursor={{ fill: '#f8fafc' }}
                         contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                       />
                       <Legend />
                       <Bar 
                         dataKey={data.config?.yKey || 'value'} 
                         fill="#db2777" 
                         radius={[4, 4, 0, 0]} 
                         name={data.config?.yKey ? String(data.config.yKey).replace(/_/g, ' ') : 'Value'}
                       />
                   </BarChart>
               ) : data.chartType === 'pie' ? (
                   <RePieChart>
                        <Pie
                           data={processedData}
                           cx="50%"
                           cy="50%"
                           innerRadius={60}
                           outerRadius={100}
                           fill="#8884d8"
                           paddingAngle={2}
                           dataKey={data.config?.valueKey || 'value'}
                           nameKey={data.config?.nameKey || 'name'}
                           label={({name, percent}) => `${safeString(name)} ${(percent * 100).toFixed(0)}%`}
                        >
                           {processedData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} stroke="white" strokeWidth={2} />
                           ))}
                        </Pie>
                        <Tooltip formatter={tooltipFormatter} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Legend verticalAlign="bottom" height={36}/>
                   </RePieChart>
               ) : (
                   /* Radar Chart (Spider Chart) */
                   <RadarChart cx="50%" cy="50%" outerRadius="80%" data={processedData}>
                       <PolarGrid stroke="#e2e8f0" />
                       <PolarAngleAxis dataKey={data.config?.nameKey || 'subject'} tick={{ fill: '#64748b', fontSize: 11 }} />
                       <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                       <Radar
                           name="Strategy Score"
                           dataKey={data.config?.valueKey || 'A'}
                           stroke="#db2777"
                           fill="#db2777"
                           fillOpacity={0.5}
                       />
                       <Tooltip formatter={tooltipFormatter} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                       <Legend />
                   </RadarChart>
               )}
           </ResponsiveContainer>
       </div>
    </div>
  );
};

// ... [ThemesWidget, SimulatedPlayer, FileSlot, LayerInputGroup, SimulationWidget remain unchanged] ...
const ThemesWidget = ({ themes, logic, onThemeSelect }: { themes: VideoTheme[], logic?: string, onThemeSelect: (theme: VideoTheme) => void }) => {
  return (
    <div className="flex flex-col gap-4 w-full">
       <div className="flex items-center gap-2 text-slate-700 mb-1">
          <Clapperboard className="text-pink-600" size={20} />
          <h3 className="font-bold text-lg">Recommended Video Themes</h3>
       </div>
       
       {logic && (
           <div className="bg-pink-50 border border-pink-100 rounded-lg p-4 mb-2 text-sm text-slate-700 leading-relaxed italic animate-in fade-in slide-in-from-top-2">
               <span className="font-semibold text-pink-700 not-italic">Strategic Logic: </span>
               {safeString(logic)}
           </div>
       )}

       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {themes.map((theme) => (
             <div 
               key={theme.id} 
               onClick={() => onThemeSelect(theme)}
               onDoubleClick={() => onThemeSelect(theme)}
               className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-lg hover:border-pink-300 transition-all group relative overflow-hidden cursor-pointer active:scale-95"
             >
                <div className="absolute top-0 right-0 w-16 h-16 bg-pink-50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
                
                <div className="relative z-10">
                   <div className="flex justify-between items-start mb-2">
                      <span className="inline-block px-2 py-0.5 bg-pink-100 text-pink-700 text-[10px] font-bold uppercase tracking-wider rounded-sm">
                         Theme {theme.id}
                      </span>
                      <ArrowUpRight size={16} className="text-pink-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                   </div>
                   
                   <h4 className="font-bold text-slate-800 text-base mb-2 leading-tight group-hover:text-pink-700 transition-colors">
                      {safeString(theme.title)} 
                      {theme.shortTag && (
                          <span className="ml-2 font-normal text-slate-500 text-sm italic">
                              ({safeString(theme.shortTag)})
                          </span>
                      )}
                   </h4>
                   
                   {/* Full text shown - allow 4 lines */}
                   <p className="text-xs text-slate-600 mb-4 leading-relaxed line-clamp-4 font-medium opacity-90">
                      {safeString(theme.rationale)}
                   </p>
                   
                   <div className="space-y-2 pt-3 border-t border-slate-50">
                      <div className="flex items-start gap-2">
                         <Heart size={12} className="text-rose-500 mt-0.5 shrink-0" />
                         <span className="text-xs text-slate-600 italic">"{safeString(theme.emotionalHook)}"</span>
                      </div>
                      <div className="flex items-start gap-2">
                         <Users size={12} className="text-blue-500 mt-0.5 shrink-0" />
                         <span className="text-xs text-slate-600 font-medium">{safeString(theme.targetAudience)}</span>
                      </div>
                   </div>
                </div>
             </div>
          ))}
       </div>
    </div>
  );
};

const SimulatedPlayer = ({ 
  title, 
  subtitle, 
  playlist,
  onClose,
  autoPlay = false,
}: { 
  title: string, 
  subtitle: string, 
  playlist: PlaylistItem[],
  onClose?: () => void,
  autoPlay?: boolean,
}) => {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false); // Default unmuted for experience
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const currentItem = playlist[currentIndex];

  // Auto-advance logic
  const handleVideoEnded = () => {
      if (currentIndex < playlist.length - 1) {
          setCurrentIndex(prev => prev + 1);
          setProgress(0);
      } else {
          setIsPlaying(false); // Stop at end
      }
  };

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(e => console.log("Autoplay prevented:", e));
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, currentIndex]);

  // Update progress bar
  useEffect(() => {
      const vid = videoRef.current;
      const updateProgress = () => {
          if (vid && vid.duration) {
              setProgress((vid.currentTime / vid.duration) * 100);
          }
      };
      if (vid) {
          vid.addEventListener('timeupdate', updateProgress);
          return () => vid.removeEventListener('timeupdate', updateProgress);
      }
  }, [currentIndex]);


  const handlePlayToggle = () => {
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl flex flex-col group border border-slate-800 animate-in fade-in zoom-in-95 duration-300">
      {/* Close Button if modal */}
      {onClose && (
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors border border-white/10"
        >
          <X size={20} />
        </button>
      )}

      {/* Video Layer */}
      <div className="absolute inset-0 bg-black" onClick={handlePlayToggle}>
        <video 
            key={`${currentIndex}-${currentItem?.url}`} // Combine index and url to force remount
            ref={videoRef}
            src={currentItem?.url || SAMPLE_VIDEO_URL}
            className={`w-full h-full object-cover transition-opacity duration-700 ${isPlaying ? 'opacity-100' : 'opacity-40'}`}
            // Removed 'loop' to allow chaining
            muted={isMuted}
            playsInline
            onEnded={handleVideoEnded}
        />
        {/* Dark overlay when paused to make text pop */}
        <div className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}></div>
      </div>

      {/* Main Content Overlay Area - CLEARED FOR CLEAN VIDEO */}
      <div className="flex-1 relative flex flex-col justify-between pointer-events-none z-10">
         
         {/* Top Controls/Info */}
         <div className="p-6 flex justify-between items-start">
             <div className="absolute top-6 right-16 flex gap-1 z-20">
                 {playlist.length > 1 && playlist.map((_, idx) => (
                     <div key={idx} className={`w-3 h-1 rounded-full ${idx === currentIndex ? 'bg-pink-500' : 'bg-white/20'}`}></div>
                 ))}
             </div> 
         </div>

         {/* Center Play Button - Only show when paused */}
         <div className="absolute inset-0 flex items-center justify-center pointer-events-auto" onClick={handlePlayToggle}>
            {!isPlaying && (
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30 hover:scale-110 transition-transform shadow-xl shadow-pink-500/20 cursor-pointer group-hover:bg-pink-600/80 group-hover:border-pink-500">
                <Play size={36} className="text-white fill-current ml-2" />
            </div>
            )}
         </div>

         {/* NO BOTTOM TEXT OVERLAYS HERE AS REQUESTED */}
      </div>

      {/* Controls Bar - Always available on hover/pause */}
      <div className="h-16 bg-gradient-to-t from-black via-black/80 to-transparent absolute bottom-0 left-0 right-0 flex items-center px-6 gap-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
         <button onClick={(e) => { e.stopPropagation(); handlePlayToggle(); }} className="text-white hover:text-pink-500 transition-colors p-2">
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
         </button>
         
         <div className="text-xs font-mono text-white/90 min-w-[60px] font-medium">
            Scene {currentIndex + 1}
         </div>

         {/* Progress Bar */}
         <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-pink-500 transition-all duration-100 ease-linear shadow-[0_0_15px_rgba(236,72,153,0.8)]" style={{ width: `${progress}%` }}></div>
         </div>

         <div className="flex gap-4 text-white/90 items-center">
             <button 
                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                className="hover:text-pink-400 transition-colors"
             >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
             </button>
         </div>
      </div>
    </div>
  );
};

const FileSlot: React.FC<{ 
  fileName: string; 
  isUploaded: boolean; 
  isSelected: boolean; 
  onClick: () => void;
  onToggle: (e: React.MouseEvent) => void;
}> = ({ fileName, isUploaded, isSelected, onClick, onToggle }) => {
  return (
    <div
      className={`
        w-full flex items-center justify-between p-2.5 rounded-md border text-left transition-all duration-200 group relative overflow-hidden
        ${isUploaded 
          ? 'bg-pink-50/50 border-pink-200' 
          : 'bg-white border-slate-200 hover:border-pink-300 hover:shadow-sm'}
      `}
    >
      <button onClick={onClick} className="flex items-center gap-2.5 overflow-hidden z-10 flex-1 text-left">
        <div className={`
          p-1.5 rounded shrink-0 transition-colors
          ${isUploaded ? 'text-pink-600 bg-pink-100' : 'text-slate-400 group-hover:text-pink-500 group-hover:bg-pink-50'}
        `}>
          {isUploaded ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        </div>
        <span className={`text-xs font-medium truncate ${isUploaded ? 'text-pink-900' : 'text-slate-600'}`}>
          {fileName}
        </span>
      </button>

      {isUploaded && (
          <div 
            onClick={onToggle}
            className="cursor-pointer p-1 text-pink-600 hover:text-pink-800 transition-colors"
            title={isSelected ? "Include in Analysis" : "Exclude from Analysis"}
          >
             {isSelected ? <Disc size={16} fill="currentColor" /> : <Circle size={16} />}
          </div>
      )}
    </div>
  );
};

const LayerInputGroup: React.FC<{ 
  layer: typeof DATA_LAYERS[0]; 
  onDataChange: (files: Record<string, string>) => void; 
}> = ({ 
  layer, 
  onDataChange 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = usePersistentState<Record<string, string>>(`files_${layer.id}`, {});
  // Auto-collapse if complete, auto-expand if empty
  const [isExpanded, setIsExpanded] = useState(Object.keys(uploadedFiles).length === 0);
  
  useEffect(() => {
     onDataChange(uploadedFiles);
  }, [uploadedFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Loop through all selected files
      Array.from(files).forEach((file: File) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              setUploadedFiles(prev => ({ ...prev, [file.name]: event.target!.result as string }));
            }
          };
          reader.readAsText(file);
      });
    }
    if (e.target) e.target.value = '';
  };

  const uploadCount = Object.keys(uploadedFiles).length;
  const totalCount = layer.files.length;
  const progress = (uploadCount / totalCount) * 100;
  const isComplete = uploadCount === totalCount;

  return (
    <div className={`bg-white rounded-xl border ${isComplete ? 'border-slate-200' : layer.borderColor} overflow-hidden shadow-sm hover:shadow-md transition-all`}>
       {/* Header */}
       <div 
         className={`px-4 py-3 border-b border-slate-100 flex items-center justify-between cursor-pointer ${isExpanded ? 'bg-opacity-10 ' + layer.color : 'bg-white hover:bg-slate-50'}`}
         onClick={() => setIsExpanded(!isExpanded)}
       >
          <div className="flex items-center gap-3">
             <div className={`p-1.5 rounded-lg ${layer.color} text-white shadow-sm`}>
                <layer.icon size={16} />
             </div>
             <div>
                <h4 className={`text-xs font-bold ${layer.textColor} tracking-wide uppercase`}>{layer.title}</h4>
                <p className="text-[10px] text-slate-500 font-medium">{layer.subtitle}</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
             {isComplete && <CheckCircle2 size={16} className="text-emerald-500" />}
             <div className="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-full border border-slate-100 shadow-sm">
                {uploadCount}/{totalCount}
             </div>
             <ChevronDown size={16} className={`text-slate-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
       </div>
       
       {/* Progress Bar */}
       <div className="h-0.5 w-full bg-slate-100">
          <div className={`h-full transition-all duration-700 ${layer.color}`} style={{ width: `${progress}%` }}></div>
       </div>

       {/* Collapsible Content */}
       <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
           {/* File Slots */}
           <div className="p-3 flex flex-col gap-2">
              {layer.files.map(fileName => (
                 <FileSlot 
                    key={fileName}
                    fileName={fileName}
                    isUploaded={!!uploadedFiles[fileName]}
                    isSelected={true}
                    onClick={() => !uploadedFiles[fileName] && fileInputRef.current?.click()}
                    onToggle={() => {}}
                 />
              ))}
           </div>

           {/* Upload Action */}
           <div className="p-3 border-t border-slate-50 bg-slate-50/50">
              <button 
                 onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                 className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-500 hover:text-pink-600 bg-white border border-slate-200 hover:border-pink-200 rounded-lg py-2 transition-all active:scale-95 shadow-sm"
              >
                 <Upload size={12} /> UPLOAD LAYER DATA
              </button>
              <input type="file" ref={fileInputRef} className="hidden" multiple accept=".csv,.txt" onChange={handleFileChange} />
           </div>
       </div>
    </div>
  );
};

const SimulationWidget = ({ data }: { data: SimulationData }) => {
  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Synthesis Header */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-2xl shadow-xl relative overflow-hidden border border-gray-700/50">
        <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl -mr-10 -mt-20"></div>
        
        {/* Header Bar with Dots */}
        <div className="bg-white/5 px-6 py-3 border-b border-white/10 flex items-center justify-between relative z-10">
           <WindowControls />
           <div className="text-[10px] font-medium tracking-widest uppercase text-white/40">Scenario Synthesis</div>
        </div>

        <div className="relative z-10 p-8">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-pink-500/20 rounded-lg text-pink-300">
               <HeartHandshake size={24} />
             </div>
             <h3 className="text-2xl font-bold text-white tracking-tight">Executive Summary</h3>
          </div>
          <div 
             className="prose prose-invert prose-sm max-w-none text-gray-300 leading-relaxed [&>p]:mb-4" 
             dangerouslySetInnerHTML={safeRenderMarkdown(data.synthesis)} 
          />
        </div>
      </div>

      {/* 4-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* Top End Growth */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm flex flex-col overflow-hidden group hover:shadow-md transition-all">
          <div className="bg-emerald-50/50 px-5 py-4 border-b border-emerald-100 flex items-center gap-3">
             <div className="p-2 bg-white rounded-lg text-emerald-600 shadow-sm"><TrendingUp size={18} /></div>
             <h4 className="font-bold text-emerald-900 text-sm">Top-End Growth</h4>
          </div>
          <div className="p-5 flex-1 bg-gradient-to-b from-white to-emerald-50/10">
             <div className="markdown-body text-sm text-slate-600 space-y-2 [&>ul]:list-disc [&>ul]:pl-4 [&>ul>li]:marker:text-emerald-500" dangerouslySetInnerHTML={safeRenderMarkdown(data.topEnd)} />
          </div>
        </div>

        {/* Bottom End Growth */}
        <div className="bg-white rounded-2xl border border-blue-100 shadow-sm flex flex-col overflow-hidden group hover:shadow-md transition-all">
          <div className="bg-blue-50/50 px-5 py-4 border-b border-blue-100 flex items-center gap-3">
             <div className="p-2 bg-white rounded-lg text-blue-600 shadow-sm"><PieChart size={18} /></div>
             <h4 className="font-bold text-blue-900 text-sm">Bottom-End Growth</h4>
          </div>
          <div className="p-5 flex-1 bg-gradient-to-b from-white to-blue-50/10">
             <div className="markdown-body text-sm text-slate-600 space-y-2 [&>ul]:list-disc [&>ul]:pl-4 [&>ul>li]:marker:text-blue-500" dangerouslySetInnerHTML={safeRenderMarkdown(data.bottomEnd)} />
          </div>
        </div>

        {/* Customer Experience */}
        <div className="bg-white rounded-2xl border border-pink-100 shadow-sm flex flex-col overflow-hidden group hover:shadow-md transition-all">
          <div className="bg-pink-50/50 px-5 py-4 border-b border-pink-100 flex items-center gap-3">
             <div className="p-2 bg-white rounded-lg text-pink-600 shadow-sm"><Heart size={18} /></div>
             <h4 className="font-bold text-pink-900 text-sm">Patient Empathy & CX</h4>
          </div>
          <div className="p-5 flex-1 bg-gradient-to-b from-white to-pink-50/10">
             <div className="markdown-body text-sm text-slate-600 space-y-2 [&>ul]:list-disc [&>ul]:pl-4 [&>ul>li]:marker:text-pink-500" dangerouslySetInnerHTML={safeRenderMarkdown(data.cxImpact)} />
          </div>
        </div>

        {/* Constraints & Risks */}
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm flex flex-col overflow-hidden group hover:shadow-md transition-all">
          <div className="bg-amber-50/50 px-5 py-4 border-b border-amber-100 flex items-center gap-3">
             <div className="p-2 bg-white rounded-lg text-amber-600 shadow-sm"><Scale size={18} /></div>
             <h4 className="font-bold text-amber-900 text-sm">Challenges & Anxiety</h4>
          </div>
          <div className="p-5 flex-1 bg-gradient-to-b from-white to-amber-50/10">
             <div className="markdown-body text-sm text-slate-600 space-y-2 [&>ul]:list-disc [&>ul]:pl-4 [&>ul>li]:marker:text-amber-500" dangerouslySetInnerHTML={safeRenderMarkdown(data.constraints)} />
          </div>
        </div>

      </div>
    </div>
  );
};

// ... [CityContentStudio, App remain mostly unchanged except for Header button removal] ...
const CityContentStudio = ({ 
  onGenerateThemes, 
  onGenerateScript,
  isLoading,
  dataContext
}: { 
  onGenerateThemes: (city: string, strategy: string, dataContext: string) => Promise<{ themes: VideoTheme[], selectionLogic?: string } | null>;
  onGenerateScript: (theme: VideoTheme, city: string) => Promise<ScriptSegment[] | null>;
  isLoading: boolean;
  dataContext: string;
}) => {
  const [city, setCity] = usePersistentState('studio_city', '');
  const [strategy, setStrategy] = usePersistentState('studio_strategy', '');
  const [themes, setThemes] = usePersistentState<VideoTheme[] | null>('studio_themes', null);
  const [scriptSegments, setScriptSegments] = usePersistentState<ScriptSegment[] | null>('studio_scripts', null);
  const [selectedTheme, setSelectedTheme] = usePersistentState<VideoTheme | null>('studio_selected_theme', null);
  const [selectionLogic, setSelectionLogic] = usePersistentState('studio_logic', '');
  
  const [isPlayingFullStoryboard, setIsPlayingFullStoryboard] = useState(false);
  const [previewSegment, setPreviewSegment] = useState<ScriptSegment | null>(null);
  
  // Per-segment video generation state - Changed to Record for independence
  const [segmentVideos, setSegmentVideos] = useState<Record<number, string>>({});
  const [generatingSegments, setGeneratingSegments] = useState<Record<number, boolean>>({});
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  const handleSearch = async () => {
    if (!city.trim()) return;
    setThemes(null);
    setScriptSegments(null);
    setSelectedTheme(null);
    setSelectionLogic('');
    setIsPlayingFullStoryboard(false);
    setPreviewSegment(null);
    const result = await onGenerateThemes(city, strategy, dataContext);
    if (result) {
        setThemes(result.themes);
        setSelectionLogic(result.selectionLogic || '');
    }
  };

  const handleThemeSelect = async (theme: VideoTheme) => {
    setSelectedTheme(theme);
    setScriptSegments(null);
    setIsPlayingFullStoryboard(false);
    setPreviewSegment(null);
    setSegmentVideos({});
    const result = await onGenerateScript(theme, city);
    if (result) setScriptSegments(result);
  };

  const generateVideoForSegment = async (segment: ScriptSegment): Promise<'SUCCESS' | 'FAILED' | 'QUOTA'> => {
       // Check if we already have it
       if (segmentVideos[segment.seq]) return 'SUCCESS';

       try {
            // Key Selection Logic
            if (typeof window !== 'undefined' && 'aistudio' in window && (window as any).aistudio) {
                const studio = (window as any).aistudio;
                const hasKey = await studio.hasSelectedApiKey();
                if (!hasKey) await studio.openSelectKey();
            }
            
            // Re-instantiate AI to get latest key if environment injected it
            const apiKey = getApiKey();
            if (!apiKey) {
                alert("⚠️ API Key missing. Please set GEMINI_API_KEY in App Runner environment variables.");
                return 'FAILED';
            }
            const ai = new GoogleGenAI({ apiKey });
            
            const prompt = `Cinematic video: ${segment.visual}. High quality, photorealistic, 4k. No text on screen, no typography, clean video footage only. Indian context, empathetic lighting.`;
            
            let operation = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: prompt,
                config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
            });
            
            // Polling - FAST VIDEO OPTIMIZATION
            // Reduced to 2s polling for faster responsiveness
            let retries = 0;
            while (!operation.done && retries < 150) { // 5 minutes max (150 * 2s)
                await new Promise(r => setTimeout(r, 2000));
                operation = await ai.operations.getVideosOperation({operation});
                retries++;
            }
            
            const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (uri) {
                // Ensure key is present for fetch
                if (!apiKey) throw new Error("API Key missing for video download");

                const res = await fetch(`${uri}&key=${apiKey}`);
                if (!res.ok) throw new Error(`Video fetch failed: ${res.statusText}`);
                
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setSegmentVideos(prev => ({...prev, [segment.seq]: url}));
                return 'SUCCESS';
            }
            return 'FAILED';
       } catch (e: any) {
           console.error("Video Gen Error", e);
           
           // Check for quota error
           const errString = JSON.stringify(e);
           if (errString.includes('429') || errString.includes('RESOURCE_EXHAUSTED')) {
               alert("⚠️ Video Generation Quota Exceeded.\n\nPlease wait a minute before trying again, or check your billing plan.");
               return 'QUOTA';
           }
           
           return 'FAILED';
       }
  };

  const handleGenerateSegmentVideo = async (segment: ScriptSegment) => {
    setGeneratingSegments(prev => ({ ...prev, [segment.seq]: true }));
    await generateVideoForSegment(segment);
    setGeneratingSegments(prev => ({ ...prev, [segment.seq]: false }));
  };

  const handleGenerateAllAndPlay = async () => {
    if (!scriptSegments) return;
    setIsGeneratingAll(true);
    
    // Process sequentially to respect rate limits if needed, or parallel if quota allows
    // We'll do sequential to be safer with standard quotas
    for (const seg of scriptSegments) {
        if (!segmentVideos[seg.seq]) {
            setGeneratingSegments(prev => ({ ...prev, [seg.seq]: true }));
            const status = await generateVideoForSegment(seg);
            setGeneratingSegments(prev => ({ ...prev, [seg.seq]: false }));
            
            if (status === 'QUOTA') {
                setIsGeneratingAll(false);
                return; // Stop processing rest of queue
            }
        }
    }
    setIsGeneratingAll(false);
    setIsPlayingFullStoryboard(true);
  };

  // Compile playlist
  const fullPlaylist: PlaylistItem[] = scriptSegments?.map(seg => ({
      segment: seg,
      url: segmentVideos[seg.seq]
  })).filter(item => item.url) || [];

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* 1. Input Section */}
      <div className="bg-white rounded-2xl p-8 border border-pink-100 shadow-sm flex flex-col gap-6">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
             <div className="flex-1 w-full">
                <label className="block text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">
                   <MapPin size={16} className="text-pink-500"/> Target region
                </label>
                <div className="relative">
                   <input 
                     type="text" 
                     value={typeof city === 'string' ? city : ''}
                     onChange={(e) => setCity(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                     placeholder="e.g. Jaipur, Patna, Indore..."
                     className="w-full text-xl font-bold text-slate-800 placeholder-slate-300 bg-slate-50 border-2 border-slate-100 rounded-xl px-6 py-4 focus:outline-none focus:border-pink-500 focus:bg-white transition-all"
                   />
                   <div className="absolute right-4 top-1/2 -translate-y-1/2">
                     {isLoading && !themes && !scriptSegments ? <Loader2 className="animate-spin text-pink-500" /> : <Command size={20} className="text-slate-300" />}
                   </div>
                </div>
             </div>
             
             <div className="flex-1 w-full">
                <label className="block text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">
                   <Lightbulb size={16} className="text-amber-500"/> Any additional strategy to benchmark? (optional)
                </label>
                <div className="relative">
                   <input 
                     type="text" 
                     value={typeof strategy === 'string' ? strategy : ''}
                     onChange={(e) => setStrategy(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                     placeholder="e.g. Focus on low cost, donor cycles, or new center launch..."
                     className="w-full text-xl font-bold text-slate-800 placeholder-slate-300 bg-slate-50 border-2 border-slate-100 rounded-xl px-6 py-4 focus:outline-none focus:border-pink-500 focus:bg-white transition-all"
                   />
                </div>
             </div>
         </div>
         
         <button 
           onClick={handleSearch}
           disabled={isLoading || !city.trim()}
           className="w-full px-8 py-5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold rounded-xl shadow-lg shadow-pink-200 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
         >
            <Sparkles size={20} /> Generate Video Strategy
         </button>
      </div>

      {/* 2. Themes Grid */}
      {themes && !scriptSegments && !isLoading && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
           <ThemesWidget themes={themes} logic={selectionLogic} onThemeSelect={handleThemeSelect} />
        </div>
      )}

      {/* Loading Script State */}
      {isLoading && themes && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 size={40} className="animate-spin text-pink-500 mb-4" />
              <p className="font-medium animate-pulse">Crafting script segments & visual storyboard...</p>
          </div>
      )}

      {/* 3. Script Breakdown & Stitching */}
      {scriptSegments && selectedTheme && (
          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between">
                  <div>
                      <button onClick={() => setScriptSegments(null)} className="text-xs font-bold text-slate-400 hover:text-pink-600 mb-1 flex items-center gap-1">
                          <ArrowUpRight size={12} className="rotate-180" /> Back to Themes
                      </button>
                      <h2 className="text-2xl font-bold text-slate-800">Storyboard: <span className="text-pink-600">{selectedTheme.title}</span></h2>
                  </div>
                  
                  {/* Generate All / Play All Button */}
                  <div className="flex gap-2">
                    {fullPlaylist.length < scriptSegments.length ? (
                         <button 
                            onClick={handleGenerateAllAndPlay}
                            disabled={isGeneratingAll}
                            className="px-6 py-3 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-70"
                          >
                             {isGeneratingAll ? <Loader2 size={18} className="animate-spin" /> : <Film size={18} />}
                             {isGeneratingAll ? `Generating Scenes...` : "Generate All Scenes"}
                          </button>
                    ) : (
                         <button 
                            onClick={() => setIsPlayingFullStoryboard(true)}
                            className="px-6 py-3 bg-pink-600 text-white font-bold rounded-xl shadow-lg hover:bg-pink-700 transition-all active:scale-95 flex items-center gap-2"
                          >
                             <PlayCircle size={18} />
                             Play Full Storyboard
                          </button>
                    )}
                  </div>
              </div>

              {/* End-to-End Player Modal */}
              {isPlayingFullStoryboard && fullPlaylist.length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200" onClick={() => setIsPlayingFullStoryboard(false)}>
                   <div className="w-full max-w-5xl" onClick={e => e.stopPropagation()}>
                      <SimulatedPlayer 
                         title={selectedTheme.title}
                         subtitle={`End-to-End Storyboard • ${city} Edition • Veo 3 Generated`}
                         playlist={fullPlaylist}
                         onClose={() => setIsPlayingFullStoryboard(false)}
                         autoPlay={true}
                      />
                   </div>
                </div>
              )}

              {/* Individual Scene Player Modal */}
              {previewSegment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setPreviewSegment(null)}>
                   <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
                      <SimulatedPlayer 
                         title={`Scene ${previewSegment.seq}`}
                         subtitle={`Single Scene Preview • ${selectedTheme.title}`}
                         playlist={[{ url: segmentVideos[previewSegment.seq], segment: previewSegment }]}
                         onClose={() => setPreviewSegment(null)}
                         autoPlay={true}
                      />
                   </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {scriptSegments.map((seg) => (
                      <div key={seg.seq} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col group hover:shadow-md transition-all relative">
                          
                          {/* Thumbnail Area with Preview Button */}
                          <div className="h-32 bg-slate-100 relative flex items-center justify-center border-b border-slate-100 group-hover:bg-slate-50 transition-colors overflow-hidden">
                              {/* Thumbnail simulation */}
                              <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300">
                                  {/* Abstract shapes to look like video thumbnail */}
                                  <div className="absolute top-1/2 left-1/4 w-20 h-20 bg-pink-500/10 rounded-full blur-xl"></div>
                                  <div className="absolute bottom-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-xl"></div>
                              </div>
                              
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center z-10">
                                  <button 
                                    onClick={() => {
                                        if (segmentVideos[seg.seq]) setPreviewSegment(seg);
                                        else handleGenerateSegmentVideo(seg);
                                    }}
                                    disabled={generatingSegments[seg.seq]}
                                    className="opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 transition-all bg-white/90 text-pink-600 rounded-full p-3 shadow-lg hover:bg-white disabled:opacity-70 disabled:cursor-wait"
                                  >
                                     {generatingSegments[seg.seq] ? <Loader2 size={24} className="animate-spin" /> : <Play size={24} fill="currentColor" />}
                                  </button>
                              </div>
                              
                              <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/50 text-white text-[10px] font-bold rounded backdrop-blur-sm z-20">
                                  {seg.duration}
                              </div>
                              <div className="absolute top-2 right-2 px-2 py-0.5 bg-pink-600 text-white text-[10px] font-bold rounded shadow-sm z-20">
                                  Seq {seg.seq}
                              </div>
                          </div>

                          <div className="p-4 flex flex-col gap-3 flex-1">
                              <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Visual Scene</p>
                                  <p className="text-xs text-slate-700 font-medium leading-relaxed line-clamp-3" title={seg.visual}>{seg.visual}</p>
                              </div>
                              <div className="pt-3 border-t border-slate-50 mt-auto">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Audio / VO</p>
                                  <p className="text-xs text-slate-600 italic leading-relaxed line-clamp-2">"{seg.audio}"</p>
                              </div>
                              <button 
                                 onClick={() => {
                                    if(segmentVideos[seg.seq]) setPreviewSegment(seg);
                                    else handleGenerateSegmentVideo(seg);
                                 }}
                                 disabled={generatingSegments[seg.seq]}
                                 className={`mt-2 w-full py-2 text-xs font-bold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-70
                                     ${segmentVideos[seg.seq] ? 'bg-pink-100 text-pink-700 hover:bg-pink-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                                 `}
                              >
                                 {generatingSegments[seg.seq] ? (
                                     <><Loader2 size={12} className="animate-spin" /> Generating Veo Video...</>
                                 ) : (
                                     <><Play size={12} /> {segmentVideos[seg.seq] ? "Play Clip" : "Generate Clip"}</>
                                 )}
                              </button>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

// ============================================
// Authentication API Client
// ============================================
const API_BASE = '/api';

interface AuthUser {
  email: string;
  role: 'admin' | 'user';
  createdAt?: string;
  lastLogin?: string;
  mustChangePassword?: boolean;
}

interface User {
  _id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLogin?: string;
  accessibleFiles?: string[];
  fileCount?: number;
}

interface CSVFile {
  _id?: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy?: string;
  isActive: boolean;
  dataCollection?: string;
  rowCount?: number;
}

// API Functions
const authAPI = {
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      // Check if response is actually JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response. Make sure the Express server is running on port ${DEV_BACKEND_PORT}. Response: ${text.substring(0, 200)}`);
      }
      
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(error.error || 'Login failed');
      }
      
      return await res.json();
    } catch (err: any) {
      if (err.message && err.message.includes('JSON')) {
        
        throw new Error(`Cannot connect to server. Please make sure the Express server is running on port ${DEV_BACKEND_PORT}. Run: npm run dev:server`);
      }
      throw err;
    }
  },

  async getCurrentUser(): Promise<AuthUser> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('auth_token');
        throw new Error('Session expired');
      }
      const error = await res.json();
      throw new Error(error.error || 'Failed to get user');
    }
    return res.json();
  },

  async logout(): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) {
        // Ignore errors on logout
      }
    }
    localStorage.removeItem('auth_token');
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to change password');
    return data.user;
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async logPrompt(prompt: string): Promise<string | null> {
    const token = localStorage.getItem('auth_token');
    if (!token || !prompt?.trim()) return null;
    try {
      const res = await fetch(`${API_BASE}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: prompt.trim() })
      });
      const data = await res.json().catch(() => ({}));
      return data?.id ?? null;
    } catch {
      return null;
    }
  },

  async updateLogResponse(logId: string, response: string): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token || !logId) return;
    try {
      await fetch(`${API_BASE}/logs/${encodeURIComponent(logId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ response })
      });
    } catch {
      // Non-blocking
    }
  },

  async reportUsage(usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      await fetch(`${API_BASE}/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(usage)
      });
    } catch {
      // Non-blocking; ignore failures
    }
  },

  async getUsageAdmin(): Promise<{ totalTokens: number; byUser: { email: string; totalTokens: number; promptTokens: number; completionTokens: number; lastUsed: string | null }[] }> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/admin/usage`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch usage');
    }
    const data = await res.json();
    return {
      totalTokens: data.totalTokens ?? 0,
      byUser: (data.byUser ?? []).map((u: { email: string; totalTokens: number; promptTokens?: number; completionTokens?: number; lastUsed?: string | null }) => ({
        email: u.email,
        totalTokens: u.totalTokens ?? 0,
        promptTokens: u.promptTokens ?? 0,
        completionTokens: u.completionTokens ?? 0,
        lastUsed: u.lastUsed ?? null
      }))
    };
  },

  async getLogsListAdmin(): Promise<{ email: string; lastLogAt: string; count: number }[]> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/admin/logs`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch logs list');
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  async getUserLogsAdmin(email: string): Promise<{ prompt: string; createdAt: string; response?: string; _id?: string }[]> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}/admin/logs/${encodeURIComponent(email)}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch user logs');
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  async getAllUsers(): Promise<User[]> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to get users');
    }
    return res.json();
  },

  async addUser(email: string, password: string, role: 'admin' | 'user' = 'user', accessibleFiles: string[] = []): Promise<User> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, role, accessibleFiles })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to add user');
    }
    return res.json();
  },

  async deleteUser(email: string): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete user');
    }
  },

  async updateUserRole(email: string, role: 'admin' | 'user'): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(email)}/role`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to update user role');
    }
  },

  async getAllFiles(): Promise<CSVFile[]> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/files`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to load files');
    }
    return res.json();
  },

  async uploadFile(file: File): Promise<CSVFile> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch(`${API_BASE}/admin/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to upload file');
    }
    return res.json();
  },

  async deleteFile(fileName: string): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${API_BASE}/admin/files/${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to delete file');
    }
  },

  async getUserFiles(email: string): Promise<string[]> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(email)}/files`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to load user files');
    }
    return res.json();
  },

  async updateUserFiles(email: string, fileNames: string[]): Promise<void> {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(email)}/files`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fileNames })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to update user files');
    }
  },

  async getUserAccessibleFiles(): Promise<string[]> {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return [];
      
      const res = await fetch(`${API_BASE}/user/files`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        // If endpoint doesn't exist or user is admin, return empty array (all files accessible)
        return [];
      }
      
      const files = await res.json();
      // Handle both array of strings and array of objects
      if (Array.isArray(files)) {
        return files.map((f: any) => typeof f === 'string' ? f : (f.fileName || f.name || f));
      }
      return [];
    } catch (err) {
      console.error('Error fetching accessible files:', err);
      return [];
    }
  }
};

// ============================================
// Logo Component (Reusable)
// ============================================
// ============================================
// Login Logo Component (with Brain icon fallback)
// ============================================
const LoginLogo = () => {
  const [logoError, setLogoError] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);

  // Check if image is already loaded (cached)
  useEffect(() => {
    if (imgRef.current) {
      if (imgRef.current.complete && imgRef.current.naturalHeight !== 0) {
        hasLoadedRef.current = true;
        setLogoLoaded(true);
        setLogoError(false);
      }
    }
    
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  if (logoError && !hasLoadedRef.current) {
    return (
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-pink-500 to-rose-600 rounded-2xl">
        <Brain className="w-8 h-8 text-white" />
      </div>
    );
  }

  return (
    <img 
      ref={imgRef}
      src="/assets/Logo.png" 
      alt="INDIRA IVF FERTILITY & IVF CENTRE" 
      className="h-16 md:h-20 object-contain object-left"
      onError={(e) => {
        if (hasLoadedRef.current) return;
        
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
        }
        
        const img = e.target as HTMLImageElement;
        if (img.complete && img.naturalHeight > 0) {
          hasLoadedRef.current = true;
          setLogoLoaded(true);
          setLogoError(false);
        } else {
          errorTimeoutRef.current = setTimeout(() => {
            if (imgRef.current && !hasLoadedRef.current) {
              if (!imgRef.current.complete || imgRef.current.naturalHeight === 0) {
                setLogoError(true);
              }
            }
          }, 300);
        }
      }}
      onLoad={() => {
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = null;
        }
        hasLoadedRef.current = true;
        setLogoLoaded(true);
        setLogoError(false);
      }}
    />
  );
};

// ============================================
// Logo Component (Reusable)
// ============================================
const IndiraLogo = ({ className = "h-12", showFallback = true }: { className?: string; showFallback?: boolean }) => {
  const [logoError, setLogoError] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);

  // Check if image is already loaded (cached)
  useEffect(() => {
    if (imgRef.current) {
      // If image is already loaded (cached), mark as loaded immediately
      if (imgRef.current.complete && imgRef.current.naturalHeight !== 0) {
        hasLoadedRef.current = true;
        setLogoLoaded(true);
        setLogoError(false);
      }
    }
    
    // Cleanup timeout on unmount
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  // Only show fallback if error occurred AND image never loaded
  if (logoError && !hasLoadedRef.current && showFallback) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-col leading-none">
          <span className="text-2xl font-bold text-[#9D174D] tracking-tight">INDIRA</span>
          <span className="text-sm font-semibold text-slate-600 tracking-wider">FERTILITY & IVF CENTRE</span>
        </div>
        <div className="h-10 w-px bg-pink-200 mx-2"></div>
        <div className="text-xl font-bold text-[#BE185D]">GPT</div>
      </div>
    );
  }

  return (
    <img 
      ref={imgRef}
      src="/assets/Logo.png" 
      alt="INDIRA IVF FERTILITY & IVF CENTRE" 
      className={className + " object-contain object-left"}
      onError={(e) => {
        // If image already loaded successfully, ignore error
        if (hasLoadedRef.current) {
          return;
        }
        
        // Clear any pending timeout
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
        }
        
        // Only set error if image truly failed (not just loading)
        const img = e.target as HTMLImageElement;
        // Double-check: if image is complete and has height, it actually loaded
        if (img.complete && img.naturalHeight > 0) {
          // Image actually loaded, don't show error
          hasLoadedRef.current = true;
          setLogoLoaded(true);
          setLogoError(false);
        } else {
          // Delay error state to prevent race conditions - longer delay
          errorTimeoutRef.current = setTimeout(() => {
            // Final check before showing error - only if still not loaded
            if (imgRef.current && !hasLoadedRef.current) {
              if (!imgRef.current.complete || imgRef.current.naturalHeight === 0) {
                setLogoError(true);
              }
            }
          }, 300); // Increased delay to 300ms
        }
      }}
      onLoad={() => {
        // Clear any pending error timeout
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = null;
        }
        
        // Image loaded successfully - mark as loaded permanently
        hasLoadedRef.current = true;
        setLogoLoaded(true);
        setLogoError(false);
      }}
    />
  );
};

// ============================================
// Login Component
// ============================================
const LoginPage = ({ onLogin }: { onLogin: (user: AuthUser) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { token, user } = await authAPI.login(email, password);
      localStorage.setItem('auth_token', token);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const openForgotModal = () => {
    setShowForgotModal(true);
    setForgotEmail(email);
    setForgotSuccess(false);
    setForgotError('');
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotError('');
    setForgotLoading(true);
    try {
      await authAPI.forgotPassword(forgotEmail);
      setForgotSuccess(true);
    } catch (err: any) {
      setForgotError(err.message || 'Failed to send email');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col bg-gradient-to-br from-pink-50 via-white to-rose-50 p-4">
      {/* Logo in left corner */}
      <div className="absolute top-4 left-4 md:top-6 md:left-6 z-10">
        <LoginLogo />
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-pink-100">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">INDIRA GPT</h1>
          <p className="text-sm text-gray-600">Strategy & Empathy Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-pink-500 to-rose-600 text-white py-3 rounded-lg font-semibold hover:from-pink-600 hover:to-rose-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {error && (
            <div className="text-center">
              <button
                type="button"
                onClick={openForgotModal}
                className="text-sm text-pink-600 hover:text-pink-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>

        {showForgotModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForgotModal(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Forgot password</h3>
              <p className="text-sm text-slate-600 mb-4">Enter your email. We’ll send a temporary password to log in; you’ll then set a new password.</p>
              {forgotSuccess ? (
                <>
                  <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                    If an account exists for this email, a temporary password has been sent. Check your inbox (and spam), then log in with it. You’ll be asked to set a new password.
                  </p>
                  <button onClick={() => setShowForgotModal(false)} className="w-full py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium">Close</button>
                </>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  {forgotError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{forgotError}</div>
                  )}
                  <div>
                    <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      id="forgot-email"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowForgotModal(false)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={forgotLoading} className="flex-1 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                      {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Send temporary password
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// ============================================
// Change Password (first-time login) Component
// ============================================
const ChangePasswordPage = ({
  currentUser,
  onSuccess,
  onLogout
}: {
  currentUser: AuthUser;
  onSuccess: (updatedUser: AuthUser) => void;
  onLogout: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    setLoading(true);
    try {
      const updatedUser = await authAPI.changePassword(currentPassword, newPassword);
      onSuccess(updatedUser);
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col bg-gradient-to-br from-pink-50 via-white to-rose-50 p-4">
      {/* Logo in left corner */}
      <div className="absolute top-4 left-4 md:top-6 md:left-6 z-10">
        <LoginLogo />
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-pink-100">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Set your password</h1>
          <p className="text-sm text-gray-600">
            You are logging in for the first time. Please choose a new password to continue.
          </p>
          <p className="text-xs text-slate-500 mt-2">{currentUser.email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-2">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-2">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-2">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-pink-500 to-rose-600 text-white py-3 rounded-lg font-semibold hover:from-pink-600 hover:to-rose-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Updating...
              </>
            ) : (
              'Update password'
            )}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full text-sm text-slate-500 hover:text-slate-700 py-2"
          >
            Log out instead
          </button>
        </form>
      </div>
      </div>
    </div>
  );
};

// ============================================
// Admin Panel Component
// ============================================
const AdminPanel = ({ currentUser, onLogout, onBack }: { currentUser: AuthUser; onLogout: () => void; onBack: () => void }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<CSVFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [newUserFiles, setNewUserFiles] = useState<string[]>([]);
  const [addingUser, setAddingUser] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string>('');
  const [usageData, setUsageData] = useState<{ totalTokens: number; byUser: { email: string; totalTokens: number; promptTokens: number; completionTokens: number; lastUsed: string | null }[] } | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsList, setLogsList] = useState<{ email: string; lastLogAt: string; count: number }[]>([]);
  const [selectedLogEmail, setSelectedLogEmail] = useState<string | null>(null);
  const [userLogs, setUserLogs] = useState<{ prompt: string; createdAt: string; response?: string; _id?: string }[]>([]);
  const [selectedLogDetail, setSelectedLogDetail] = useState<{ prompt: string; createdAt: string; response?: string } | null>(null);
  const [loadingLogsList, setLoadingLogsList] = useState(false);
  const [loadingUserLogs, setLoadingUserLogs] = useState(false);
  const [showManageFiles, setShowManageFiles] = useState(false);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [userList, fileList] = await Promise.all([
        authAPI.getAllUsers(),
        authAPI.getAllFiles()
      ]);
      setUsers(userList);
      setFiles(fileList);
      setLastSync(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      setLoadingUsage(true);
      const data = await authAPI.getUsageAdmin();
      setUsageData(data);
    } catch {
      setUsageData(null);
    } finally {
      setLoadingUsage(false);
    }
  };

  const openLogsModal = async () => {
    setShowLogsModal(true);
    setSelectedLogEmail(null);
    setUserLogs([]);
    try {
      setLoadingLogsList(true);
      const list = await authAPI.getLogsListAdmin();
      setLogsList(list);
    } catch {
      setLogsList([]);
    } finally {
      setLoadingLogsList(false);
    }
  };

  const selectLogUser = async (email: string) => {
    setSelectedLogEmail(email);
    try {
      setLoadingUserLogs(true);
      const logs = await authAPI.getUserLogsAdmin(email);
      setUserLogs(logs);
    } catch {
      setUserLogs([]);
    } finally {
      setLoadingUserLogs(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray: File[] = Array.from(files);
    const invalidFiles = fileArray.filter((file: File) => !file.name.endsWith('.csv'));
    if (invalidFiles.length > 0) {
      setError(`Only CSV files are allowed. Invalid files: ${invalidFiles.map((f: File) => f.name).join(', ')}`);
      return;
    }

    const totalFiles = fileArray.length;

    try {
      setUploadingFile(true);
      setError('');
      setUploadProgress({ current: 0, total: totalFiles });
      
      for (let i = 0; i < fileArray.length; i++) {
        try {
          await authAPI.uploadFile(fileArray[i]);
          setUploadProgress({ current: i + 1, total: totalFiles });
        } catch (err: any) {
          console.error(`Failed to upload ${fileArray[i].name}:`, err);
          // Continue with other files even if one fails
        }
      }
      
      await loadData();
      setLastSync(new Date().toLocaleTimeString());
      setUploadProgress(null);
      
      // Trigger data reload in main app
      localStorage.setItem('dataNeedsReload', 'true');
      window.dispatchEvent(new Event('reloadData'));
    } catch (err: any) {
      setError(err.message || 'Failed to upload files');
      setUploadProgress(null);
    } finally {
      setUploadingFile(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAddingUser(true);

    try {
      await authAPI.addUser(newUserEmail, newUserPassword, newUserRole, newUserFiles);
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      setNewUserFiles([]);
      setShowAddUser(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleUserSelect = async (user: User) => {
    setSelectedUser(user);
    try {
      const userFiles = await authAPI.getUserFiles(user.email);
      setSelectedUser({ ...user, accessibleFiles: userFiles });
    } catch (err: any) {
      setError(err.message || 'Failed to load user files');
    }
  };

  const handleFileToggle = async (fileName: string) => {
    if (!selectedUser) return;
    
    const currentFiles = selectedUser.accessibleFiles || [];
    const newFiles = currentFiles.includes(fileName)
      ? currentFiles.filter(f => f !== fileName)
      : [...currentFiles, fileName];

    try {
      await authAPI.updateUserFiles(selectedUser.email, newFiles);
      setSelectedUser({ ...selectedUser, accessibleFiles: newFiles });
      setUsers((prev) =>
        prev.map((u) =>
          u.email === selectedUser.email
            ? { ...u, accessibleFiles: newFiles, fileCount: newFiles.length }
            : u
        )
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update file access');
    }
  };

  const handleDeleteUser = async (email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return;

    try {
      await authAPI.deleteUser(email);
      if (selectedUser?.email === email) {
        setSelectedUser(null);
      }
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  const handleDeleteFile = async (fileName: string) => {
    const confirmed = confirm(
      `Delete "${fileName}"?\n\nThis removes all parsed rows from MongoDB and revokes access for all users. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeletingFileName(fileName);
      setError('');
      await authAPI.deleteFile(fileName);
      if (selectedUser?.accessibleFiles?.includes(fileName)) {
        setSelectedUser({
          ...selectedUser,
          accessibleFiles: selectedUser.accessibleFiles.filter((f) => f !== fileName),
        });
      }
      await loadData();
      setLastSync(new Date().toLocaleTimeString());
      localStorage.setItem('dataNeedsReload', 'true');
      window.dispatchEvent(new Event('reloadData'));
    } catch (err: any) {
      setError(err.message || 'Failed to delete file');
    } finally {
      setDeletingFileName(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleUpdateRole = async (email: string, newRole: 'admin' | 'user') => {
    try {
      await authAPI.updateUserRole(email, newRole);
      await loadData();
      if (selectedUser?.email === email) {
        setSelectedUser({ ...selectedUser, role: newRole });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update user role');
    }
  };

  const handleLogout = async () => {
    await authAPI.logout();
    onLogout();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-pink-50">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-lg transition mr-2"
              title="Back to main dashboard"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="p-2 bg-pink-500 rounded-lg">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Access Lifecycle</h1>
              <p className="text-xs text-slate-500">CREDENTIAL GOVERNANCE</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-500">Logged in as</p>
              <p className="text-sm font-semibold text-slate-900">{currentUser.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Strategic Knowledge Base Banner */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl shadow-xl p-8 mb-8 text-white">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-3xl font-bold mb-3">Strategic Knowledge Base</h2>
              <p className="text-slate-300 text-lg mb-2">
                Upload master CSV layers to update the system-wide strategic brain. All regional queries leverage this synchronized repository.
              </p>
              <p className="text-slate-400 text-sm">LAST SYNC: {lastSync}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploadingFile}
                />
                <div className={`px-6 py-3 bg-white text-slate-900 rounded-lg font-semibold hover:bg-slate-50 transition flex items-center gap-2 ${uploadingFile ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  {uploadingFile ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {uploadProgress ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...` : 'Uploading...'}
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Sync Knowledge Map
                    </>
                  )}
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* API Token Usage (admin only) */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900">API Token Usage</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={openLogsModal}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Logs
              </button>
              <button
                onClick={loadUsage}
                disabled={loadingUsage}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center gap-2"
              >
                {loadingUsage ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Refresh
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-500 mb-4">LLM tokens consumed (Claude chat + Gemini/Veo where used). Visible to admin only.</p>
          {loadingUsage && !usageData ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
          ) : usageData ? (
            <>
              <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-sm text-slate-600">Total tokens used (all users): </span>
                <span className="text-xl font-bold text-slate-900">{usageData.totalTokens.toLocaleString()}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="py-2 pr-4">User</th>
                      <th className="py-2 pr-4">Total tokens</th>
                      <th className="py-2 pr-4">Prompt</th>
                      <th className="py-2 pr-4">Completion</th>
                      <th className="py-2">Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.byUser.map((u) => (
                      <tr key={u.email} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-800">{u.email}</td>
                        <td className="py-2 pr-4 text-slate-700">{u.totalTokens.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-slate-600">{u.promptTokens.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-slate-600">{u.completionTokens.toLocaleString()}</td>
                        <td className="py-2 text-slate-500">{u.lastUsed ? new Date(u.lastUsed).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500 py-4">Could not load usage data.</p>
          )}
        </div>

        {/* Logs modal (admin only) */}
        {showLogsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setShowLogsModal(false); setSelectedLogDetail(null); }}>
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedLogDetail ? 'Question & Answer' : selectedLogEmail ? `Logs: ${selectedLogEmail}` : 'Prompt logs'}
                </h3>
                <div className="flex items-center gap-2">
                  {selectedLogDetail ? (
                    <button
                      onClick={() => setSelectedLogDetail(null)}
                      className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Back
                    </button>
                  ) : selectedLogEmail && (
                    <button
                      onClick={() => { setSelectedLogEmail(null); setUserLogs([]); setSelectedLogDetail(null); }}
                      className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Back
                    </button>
                  )}
                  <button onClick={() => { setShowLogsModal(false); setSelectedLogDetail(null); }} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {selectedLogDetail ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Question</p>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg border border-slate-100">{selectedLogDetail.prompt}</p>
                      <p className="text-xs text-slate-400 mt-2">{new Date(selectedLogDetail.createdAt).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Answer</p>
                      <div className="text-sm text-slate-700 prose prose-sm max-w-none bg-white p-3 rounded-lg border border-slate-100">
                        {selectedLogDetail.response ? (
                          <div className="markdown-body" dangerouslySetInnerHTML={safeRenderMarkdown(selectedLogDetail.response)} />
                        ) : (
                          <p className="text-slate-500 italic">No response stored for this log.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : !selectedLogEmail ? (
                  loadingLogsList ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
                  ) : logsList.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6">No logs yet. User prompts will appear here.</p>
                  ) : (
                    <ul className="space-y-2">
                      {logsList.map((u) => (
                        <li key={u.email}>
                          <button
                            onClick={() => selectLogUser(u.email)}
                            className="w-full text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-between"
                          >
                            <span className="font-medium text-slate-800">{u.email}</span>
                            <span className="text-xs text-slate-500">{u.count} log{u.count !== 1 ? 's' : ''} · Last: {u.lastLogAt ? new Date(u.lastLogAt).toLocaleString() : '—'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  loadingUserLogs ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
                  ) : userLogs.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6">No logs for this user.</p>
                  ) : (
                    <ul className="space-y-4">
                      {userLogs.map((log, i) => {
                        const d = new Date(log.createdAt);
                        const dateStr = d.toLocaleDateString();
                        const timeStr = d.toLocaleTimeString();
                        const dayStr = d.toLocaleDateString(undefined, { weekday: 'long' });
                        return (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => setSelectedLogDetail({ prompt: log.prompt, createdAt: log.createdAt, response: log.response })}
                              className="w-full text-left p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                            >
                              <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                                <span>{dayStr}</span>
                                <span>{dateStr}</span>
                                <span>{timeStr}</span>
                              </div>
                              <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{log.prompt}</p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: User List */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">Users</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowManageFiles(true);
                    setShowAddUser(false);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition flex items-center gap-2 text-sm font-medium"
                >
                  <FolderOpen className="w-4 h-4" />
                  Manage Files
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUser(!showAddUser);
                    setShowManageFiles(false);
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-lg hover:from-pink-600 hover:to-rose-700 transition flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add User
                </button>
              </div>
            </div>

            {showManageFiles && (
              <div className="bg-slate-50 rounded-lg p-6 mb-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">Manage Files</h4>
                    <p className="text-xs text-slate-500 mt-1">
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowManageFiles(false)}
                    className="p-2 hover:bg-slate-200 rounded-lg text-slate-600"
                    title="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {files.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">No files uploaded yet. Use Sync Knowledge Map above.</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2">
                    {files.map((file) => (
                      <div
                        key={file.fileName}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 truncate">{file.fileName}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {formatFileSize(file.fileSize)}
                            {file.rowCount != null && file.rowCount > 0 ? ` · ${file.rowCount.toLocaleString()} rows` : ''}
                            {file.dataCollection ? ` · ${file.dataCollection}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(file.fileName)}
                          disabled={deletingFileName === file.fileName}
                          className="flex-shrink-0 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                          title={`Delete ${file.fileName}`}
                        >
                          {deletingFileName === file.fileName ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showAddUser && (
              <div className="bg-slate-50 rounded-lg p-6 mb-6 border border-slate-200">
                <h4 className="text-lg font-semibold mb-4">Provision Regional Lead</h4>
                <p className="text-xs text-slate-500 mb-4">HQ STRATEGIC AUTHORIZATION</p>
                <form onSubmit={handleAddUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">FULL IDENTITY</label>
                    <input
                      type="text"
                      value={newUserEmail.split('@')[0]}
                      onChange={(e) => setNewUserEmail(e.target.value + '@indira.com')}
                      placeholder="Ex: Dr. Anjali Sharma"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">SYSTEM EMAIL</label>
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="lead@indira.com"
                      required
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ACCESS KEY</label>
                    <input
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Password"
                      required
                      minLength={6}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">INITIAL INTELLIGENCE ASSIGNMENT</label>
                    <p className="text-xs text-slate-500 mb-2">F. CUSTOM INTELLIGENCE (UPLOADED)</p>
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-2">
                      {files.map((file) => (
                        <label key={file.fileName} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded">
                          <input
                            type="checkbox"
                            checked={newUserFiles.includes(file.fileName)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserFiles([...newUserFiles, file.fileName]);
                              } else {
                                setNewUserFiles(newUserFiles.filter(f => f !== file.fileName));
                              }
                            }}
                            className="rounded border-slate-300 text-pink-500 focus:ring-pink-500"
                          />
                          <span className="text-sm text-slate-700">{file.fileName}</span>
                        </label>
                      ))}
                      {files.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-4">No files uploaded yet. Upload CSV files first.</p>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={addingUser}
                    className="w-full px-4 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-50 font-semibold flex items-center justify-center gap-2"
                  >
                    {addingUser ? 'Creating...' : 'Finalize Regional Provisioning'}
                  </button>
                </form>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <div
                    key={user._id}
                    onClick={() => handleUserSelect(user)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                      selectedUser?.email === user.email
                        ? 'border-pink-500 bg-pink-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{user.email.split('@')[0]}</p>
                        <p className="text-sm text-slate-500">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: User Details & File Access */}
          {selectedUser && (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{selectedUser.email.split('@')[0]}</h3>
                  <p className="text-sm text-slate-500">{selectedUser.fileCount || selectedUser.accessibleFiles?.length || 0} layers assigned</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleUpdateRole(selectedUser.email, selectedUser.role === 'admin' ? 'user' : 'admin')}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 ${
                      selectedUser.role === 'admin'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {selectedUser.role === 'admin' ? 'ADMIN' : 'ACTIVE'}
                  </button>
                  <button
                    onClick={() => handleDeleteUser(selectedUser.email)}
                    disabled={selectedUser.email === currentUser.email}
                    className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-semibold"
                  >
                    <Trash2 className="w-4 h-4" />
                    DELETE PROFILE PERMANENTLY
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-slate-900 rounded-full"></div>
                  <h4 className="font-semibold text-slate-900">F. CUSTOM INTELLIGENCE</h4>
                </div>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {files.map((file) => {
                    const isSelected = selectedUser.accessibleFiles?.includes(file.fileName) || false;
                    return (
                      <label
                        key={file.fileName}
                        className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition ${
                          isSelected
                            ? 'border-slate-900 bg-white'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <span className={`text-sm ${isSelected ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
                          {file.fileName}
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-slate-900" />}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleFileToggle(file.fileName)}
                          className="hidden"
                        />
                      </label>
                    );
                  })}
                  {files.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-8">No files available. Upload CSV files to assign access.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!selectedUser && (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 flex items-center justify-center min-h-[400px]">
              <div className="text-center text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Select a user to manage file access</p>
              </div>
            </div>
          )}
        </div>
        </div>
      </main>
    </div>
  );
};

// Helper function to get API key from runtime-injected values first, then fallback to build-time
  // Expose API key diagnostic to window for debugging
  if (typeof window !== 'undefined') {
    (window as any).checkApiKey = () => {
      const sources = {
        'window.__GEMINI_API_KEY__': (window as any).__GEMINI_API_KEY__,
        'window.process.env.GEMINI_API_KEY': window.process?.env?.GEMINI_API_KEY,
        'window.process.env.API_KEY': window.process?.env?.API_KEY,
        'process.env.API_KEY (build-time)': process.env.API_KEY,
        'process.env.GEMINI_API_KEY (build-time)': process.env.GEMINI_API_KEY,
      };
      
      const activeKey = getApiKey();
      const activeSource = Object.entries(sources).find(([_, value]) => value === activeKey)?.[0] || 'Unknown';
      
      console.log('🔑 API Key Diagnostic:');
      console.log('Active Key:', activeKey ? `${activeKey.substring(0, 10)}... (length: ${activeKey.length})` : 'None');
      console.log('Active Source:', activeSource);
      console.log('All Sources:', sources);
      
      return {
        activeKey: activeKey ? `${activeKey.substring(0, 10)}... (length: ${activeKey.length})` : null,
        activeSource,
        allSources: Object.fromEntries(
          Object.entries(sources).map(([key, value]) => [
            key,
            value ? `${String(value).substring(0, 10)}... (length: ${String(value).length})` : 'Not set'
          ])
        )
      };
    };
  }

  const getApiKey = (): string | null => {
  // Helper to validate API key (not empty, not "undefined" string)
  const isValidKey = (key: any): key is string => {
    return typeof key === 'string' && 
           key !== 'undefined' && 
           key.trim() !== '' && 
           key.length > 10; // Basic validation - API keys are usually longer
  };

  // Check runtime-injected values first (from server.js - for production/Docker)
  if (typeof window !== 'undefined') {
    // Check window.__GEMINI_API_KEY__ (injected by server)
    const runtimeKey = (window as any).__GEMINI_API_KEY__;
    if (isValidKey(runtimeKey)) {
      return runtimeKey;
    }
    // Check window.process.env (injected by server)
    if (window.process?.env?.GEMINI_API_KEY && isValidKey(window.process.env.GEMINI_API_KEY)) {
      return window.process.env.GEMINI_API_KEY;
    }
    if (window.process?.env?.API_KEY && isValidKey(window.process.env.API_KEY)) {
      return window.process.env.API_KEY;
    }
  }
  
  // Fallback to build-time values (for local development with Vite)
  // Vite replaces process.env at build time, so these work in dev mode
  const buildTimeKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (isValidKey(buildTimeKey)) {
    return buildTimeKey;
  }
  
  return null;
};

type ChatUiMsg = { role: 'user' | 'model' | 'error'; text: string; type?: 'text' | 'simulation' };

function isPlaceholderAssistantText(t: string): boolean {
  const s = (t || '').trim();
  if (!s) return true;
  if (s === '_🔍 Fetching data from SQL Table..._') return true;
  if (s.startsWith('_🔍 Fetching')) return true;
  return false;
}

/** Build Claude messages for main chat + Mongo follow-ups (messageIndex = assistant reply row). */
function buildAnthropicMessagesForChat(
  arr: ChatUiMsg[],
  messageIndex: number,
  prompt: string
): { role: 'user' | 'assistant'; content: string }[] {
  let i = 0;
  while (i < arr.length && (arr[i].role === 'error' || arr[i].role === 'model')) {
    i++;
  }
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  const slot = arr[messageIndex];
  const firstCall = !slot || slot.role !== 'model' || isPlaceholderAssistantText(slot.text);
  const endIdx = firstCall ? messageIndex - 2 : messageIndex - 1;
  for (let j = i; j <= endIdx; j++) {
    const m = arr[j];
    if (m.role === 'error') continue;
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'model') out.push({ role: 'assistant', content: m.text });
  }
  if (!firstCall && slot?.role === 'model' && !isPlaceholderAssistantText(slot.text)) {
    out.push({ role: 'assistant', content: slot.text });
  }
  out.push({ role: 'user', content: prompt });
  return out;
}

/** Theme/script helpers: full visible chat + new user prompt (drops trailing user row if present). */
function buildAnthropicSidecarMessages(
  arr: ChatUiMsg[],
  prompt: string
): { role: 'user' | 'assistant'; content: string }[] {
  let i = 0;
  while (i < arr.length && (arr[i].role === 'error' || arr[i].role === 'model')) {
    i++;
  }
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let j = i; j < arr.length; j++) {
    const m = arr[j];
    if (m.role === 'error') continue;
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'model') out.push({ role: 'assistant', content: m.text });
  }
  while (out.length > 0 && out[out.length - 1].role === 'user') {
    out.pop();
  }
  out.push({ role: 'user', content: prompt });
  return out;
}

type LlmProvider = 'claude' | 'gemini';

async function streamLlmChat(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onTextDelta: (fullSoFar: string) => void,
  phase: 1 | 2 = 2,
  provider: LlmProvider = 'gemini'
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const token = localStorage.getItem('auth_token');
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ system, messages, phase, provider }),
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      errMsg = (j && j.error) || errMsg;
    } catch {
      try {
        errMsg = await res.text();
      } catch {
        /* ignore */
      }
    }
    throw new Error(errMsg || 'Chat stream failed');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as {
          type?: string;
          text?: string;
          message?: string;
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
        if (evt.type === 'text' && evt.text) {
          streamedText += evt.text;
          onTextDelta(streamedText);
        }
        if (evt.type === 'usage') {
          usage = {
            promptTokens: Number(evt.promptTokens) || 0,
            completionTokens: Number(evt.completionTokens) || 0,
            totalTokens: Number(evt.totalTokens) || 0,
          };
        }
        if (evt.type === 'error') {
          throw new Error(evt.message || 'Stream error');
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      const evt = JSON.parse(tail) as {
        type?: string;
        message?: string;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      if (evt.type === 'usage') {
        usage = {
          promptTokens: Number(evt.promptTokens) || 0,
          completionTokens: Number(evt.completionTokens) || 0,
          totalTokens: Number(evt.totalTokens) || 0,
        };
      }
      if (evt.type === 'error') throw new Error(evt.message || 'Stream error');
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
  }
  if (usage.totalTokens <= 0 && streamedText.length > 0) {
    const promptLen = JSON.stringify(messages).length + system.length;
    usage = {
      promptTokens: Math.ceil(promptLen / 4),
      completionTokens: Math.ceil(streamedText.length / 4),
      totalTokens: Math.ceil((promptLen + streamedText.length) / 4),
    };
  }
  return { text: streamedText, usage };
}

async function completeLlmChat(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  phase: 1 | 2 = 2,
  provider: LlmProvider = 'gemini'
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const token = localStorage.getItem('auth_token');
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ system, messages, phase, provider }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    text?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return {
    text: data.text || '',
    usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

const App = () => {
  // ============================================
  // ALL HOOKS MUST BE AT THE TOP (React Rules of Hooks)
  // ============================================
  
  // Authentication State
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  // App Navigation State
  const [activeTab, setActiveTab] = usePersistentState<'dashboard' | 'city_studio'>('app_active_tab', 'dashboard');

  // Data States
  const [layerData, setLayerData] = usePersistentState<Record<string, string>>('app_layer_data', {});
  
  // Chat States
  // `artifact` carries the downloadable-deliverable handle (when the model emits a
  // ```artifact``` block and the backend successfully renders the file). The raw
  // JSON block is stripped from `text` — exactly as ```mongodb``` blocks are —
  // and replaced with a Download button in the rendered message.
  const [messages, setMessages] = usePersistentState<Array<{role: 'user' | 'model' | 'error', text: string, type?: 'text' | 'simulation', artifact?: { downloadId: string; fileName: string }}>>('chat_messages', [
    { role: 'model', text: "Namaste. I am INDIRA GPT, your performance & strategy partner for Indira IVF.\n\n📊 **MIS Pre-loaded**: Centre & cluster Footfall, ICSI, Revenue, Pharmacy and Collections data is loaded and ready. Ask me about revenue, conversion, cluster performance, or centre highlights.", type: 'text' }
  ]);
  const [input, setInput] = useState('');
  const [simInput, setSimInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const messagesRef = useRef<Array<{ role: 'user' | 'model' | 'error'; text: string; type?: 'text' | 'simulation'; artifact?: { downloadId: string; fileName: string } }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Chat File Upload State
  const [chatAttachments, setChatAttachments] = useState<Attachment[]>([]);
  const [sqlTables, setSqlTables] = useState<string[]>([]);
  const [tableSchemas, setTableSchemas] = useState<Record<string, CollectionSchema>>({});
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [userAccessibleFiles, setUserAccessibleFiles] = useState<string[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [dataEngine, setDataEngine] = useState<'mongo' | 'sql'>('mongo');
  const [queryContract, setQueryContract] = useState<'mongodb' | 'sql'>('mongodb');
  const llmProvider: LlmProvider = 'gemini';
  const [geminiModelLabel, setGeminiModelLabel] = useState('gemini-3-flash-preview');
  const [activeFocusCollection, setActiveFocusCollection] = useState<string | null>(null);
  const isLoadingRef = useRef(false);
  const reloadInProgressRef = useRef(false);

  // Check authentication on mount and load accessible files
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const currentUser = await authAPI.getCurrentUser();
          setUser(currentUser);
          
          // Load user's accessible files
          const accessibleFiles = await authAPI.getUserAccessibleFiles();
          setUserAccessibleFiles(accessibleFiles);
          setFilesLoaded(true);

          const backendUrl = getBackendBaseUrl();
          try {
            const cfgRes = await fetch(`${backendUrl}/api/config`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (cfgRes.ok) {
              const cfg = await cfgRes.json() as {
                dataEngine?: string;
                queryContract?: string;
                geminiModel?: string;
                providers?: { claude?: boolean; gemini?: boolean };
              };
              if (cfg.dataEngine === 'sql') setDataEngine('sql');
              if (cfg.queryContract === 'sql') setQueryContract('sql');
              if (cfg.geminiModel) setGeminiModelLabel(cfg.geminiModel);
            }
          } catch {
            /* keep defaults */
          }
        } else {
          setFilesLoaded(true); // No auth, but mark as loaded to prevent blocking
        }
      } catch (err) {
        // Not authenticated or token expired
        localStorage.removeItem('auth_token');
        setUser(null);
        setUserAccessibleFiles([]);
        setFilesLoaded(true);
      } finally {
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Clean corrupted messages (null/undefined or missing text) from persisted state on mount
  useEffect(() => {
    setMessages(prev => {
      if (!Array.isArray(prev)) return [{ role: 'model', text: "Namaste. I am INDIRA GPT, your performance & strategy partner for Indira IVF.\n\n📊 **MIS Pre-loaded**: Centre & cluster Footfall, ICSI, Revenue, Pharmacy and Collections data is loaded and ready. Ask me about revenue, conversion, cluster performance, or centre highlights.", type: 'text' as const }];
      const cleaned = prev.filter(msg => msg != null && typeof (msg as { text?: unknown }).text === 'string');
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, []);

  // ============================================
  // EVENT HANDLERS
  // ============================================
  
  const handleLogin = (loggedInUser: AuthUser) => {
    setUser(loggedInUser);
    setShowAdmin(false);
  };

  const handleLogout = async () => {
    await authAPI.logout();
    setUser(null);
    setShowAdmin(false);
  };

  const handleLayerDataChange = (layerId: string, files: Record<string, string>) => {
      // Aggregate text from all files in this layer
      const aggregated = Object.entries(files)
          .map(([name, content]) => `--- FILE: ${name} (Layer: ${layerId}) ---\n${content}\n--- END ---`)
          .join('\n\n');
      
      setLayerData(prev => {
          const newData = { ...prev, [layerId]: aggregated };
          return newData;
      });
  };

  // ... [File Handling Code] ...
  const handleChatFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;

    setIsTyping(true);
    
    const newFiles: Attachment[] = [];
    const newTables: string[] = [];

    for (const file of files) {
        try {
            if (file.name.toLowerCase().endsWith('.zip')) {
                if (typeof JSZip !== 'undefined') {
                    const zip = await new JSZip().loadAsync(file);
                    for (const filename of Object.keys(zip.files)) {
                        const zipEntry = zip.files[filename];
                        if (!zipEntry.dir && !filename.startsWith('__MACOSX') && !filename.startsWith('.')) {
                             const text = await zipEntry.async("string");
                             await processSingleFile(filename, text, newFiles, newTables);
                        }
                    }
                }
            } else {
                const text = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string || '');
                    reader.onerror = reject;
                    reader.readAsText(file);
                });
                await processSingleFile(file.name, text, newFiles, newTables);
            }
        } catch (err) {
            console.error("Error reading file:", file.name, err);
        }
    }

    setChatAttachments(prev => [...prev, ...newFiles]);
    setSqlTables(prev => [...new Set([...prev, ...newTables])]);
    newFiles.forEach(file => {
      if (file.isCsv && file.collectionName && file.headers && file.rowCount) {
        setTableSchemas(prev => ({
          ...prev,
          [file.collectionName!]: {
            columns: file.headers!,
            rowCount: file.rowCount!,
            fileName: file.name
          }
        }));
      }
    });
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    setIsTyping(false); 
  };

  // Helper function to detect if content is HTML instead of CSV
  const isHTMLContent = (content: string): boolean => {
    if (!content || content.trim().length === 0) return true;
    const trimmed = content.trim().toLowerCase();
    // Check for common HTML tags
    if (trimmed.startsWith('<!doctype html') || 
        trimmed.startsWith('<html') || 
        trimmed.includes('<html>') ||
        trimmed.includes('</html>') ||
        trimmed.includes('<head>') ||
        trimmed.includes('<body>') ||
        trimmed.includes('<script') ||
        trimmed.includes('<!DOCTYPE')) {
      return true;
    }
    // Check if content has too many HTML-like patterns
    const htmlTagPattern = /<[a-z][\s\S]*>/i;
    const htmlTagCount = (content.match(htmlTagPattern) || []).length;
    // If more than 2 HTML tags, likely HTML
    if (htmlTagCount > 2) return true;
    return false;
  };

  // Helper function to validate CSV data quality
  const isValidCSVData = (parsed: any): boolean => {
    if (!parsed || !parsed.data || !Array.isArray(parsed.data) || parsed.data.length === 0) {
      return false;
    }
    
    // Check if headers are valid (not HTML tags)
    const headers = parsed.meta?.fields || Object.keys(parsed.data[0] || {});
    if (headers.length === 0) return false;
    
    // Check if any header looks like HTML
    const hasHTMLHeaders = headers.some((h: string) => 
      typeof h === 'string' && (h.trim().startsWith('<') || h.trim().toLowerCase().includes('<!doctype'))
    );
    if (hasHTMLHeaders) return false;
    
    // Check first few rows for HTML content
    const sampleRows = parsed.data.slice(0, Math.min(3, parsed.data.length));
    const hasHTMLInRows = sampleRows.some((row: any) => {
      if (typeof row === 'object' && row !== null) {
        return Object.values(row).some((val: any) => {
          if (typeof val === 'string') {
            const valLower = val.trim().toLowerCase();
            return valLower.startsWith('<!doctype') || 
                   valLower.startsWith('<html') || 
                   valLower.includes('<html>') ||
                   (valLower.includes('<') && valLower.includes('>') && valLower.length > 50);
          }
          return false;
        });
      }
      return false;
    });
    
    return !hasHTMLInRows;
  };

  const processSingleFile = async (name: string, content: string, newFiles: Attachment[], newTables: string[]) => {
      const isCsv = name.toLowerCase().endsWith('.csv');
      const isLarge = content.length > MAX_TEXT_PAYLOAD_SIZE; 
      
      let collectionName = '';
      let headers: string[] = [];
      let rowCount = 0;

      if (isCsv) {
          if (isHTMLContent(content)) {
              console.warn(`⚠️ Skipping ${name}: File contains HTML content instead of CSV data`);
              return;
          }
          
          // Derive collection name (matches server-side getCollectionName)
          collectionName = 'data_' + name.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
          
          // Parse headers from first line of CSV
          try {
              const lines = content.split('\n').filter(l => l.trim());
              if (lines.length < 2) {
                  console.warn(`⚠️ Skipping ${name}: Not enough data rows`);
                  return;
              }
              
              // Simple CSV header parsing (handle quoted fields)
              const headerLine = lines[0];
              headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
              rowCount = lines.length - 1; // Approximate
              
              if (headers.length === 0 || headers.every(h => !h)) {
                  console.warn(`⚠️ Skipping ${name}: No valid headers found`);
                  return;
              }
              
              newTables.push(collectionName);
              setTableSchemas(prev => ({
                  ...prev,
                  [collectionName]: {
                      columns: headers,
                      rowCount: rowCount,
                      fileName: name
                  }
              }));
          } catch(e) {
              console.error(`Failed to parse ${name}:`, e);
              return;
          }
      }

      if (!isCsv || (isCsv && collectionName && headers.length > 0 && rowCount > 0)) {
          newFiles.push({ 
              name, 
              content: content, 
              isCsv,
              isLarge,
              collectionName: isCsv ? collectionName : undefined,
              headers: headers.length > 0 ? headers : undefined,
              rowCount: rowCount > 0 ? rowCount : undefined
          });
      }
  };

  const removeAttachment = (index: number) => {
    setChatAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Load data schemas from MongoDB via server API (no CSV downloading needed)
  const loadDataFolderFiles = async (forceReload: boolean = false) => {
    if (!forceReload && dataLoaded) {
      return;
    }

    if (!filesLoaded || !user) {
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.warn('⚠️ No auth token, skipping data load');
        setDataLoaded(true);
        return;
      }
      
      const backendUrl = getBackendBaseUrl();
      
      if (forceReload) {
        setSqlTables([]);
        setTableSchemas({});
        setChatAttachments([]);
      }
      
      console.log(`📊 Fetching data schemas from server...`);
      
      const res = await fetch(`${backendUrl}/api/data/schemas`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch schemas: ${res.status} ${res.statusText}`);
      }
      
      const schemas: Array<{
        fileName: string;
        collectionName: string;
        columns: string[];
        columnTypes: Record<string, string>;
        rowCount: number;
        parseQuality?: Array<{ column: string; inferred: 'numeric' | 'text' | 'mixed'; coercedPct: number }>;
      }> = await res.json();
      
      console.log(`✓ Fetched ${schemas.length} data schemas from server`);
      
      const newFiles: Attachment[] = [];
      const newTables: string[] = [];
      
      for (const schema of schemas) {
        const collectionName = schema.collectionName;
        newTables.push(collectionName);
        
        setTableSchemas(prev => ({
          ...prev,
          [collectionName]: {
            columns: schema.columns,
            rowCount: schema.rowCount,
            fileName: schema.fileName,
            parseQuality: schema.parseQuality
          }
        }));
        
        newFiles.push({
          name: schema.fileName,
          content: '', // No raw CSV content needed
          isCsv: true,
          isLarge: schema.rowCount > 1000,
          collectionName,
          headers: schema.columns,
          columnTypes: schema.columnTypes,
          rowCount: schema.rowCount
        });
        
        console.log(`✓ Schema loaded: ${schema.fileName} → ${collectionName} (${schema.rowCount} rows, ${schema.columns.length} cols)`);
      }
      
      if (newFiles.length > 0) {
        setChatAttachments(prev => {
          if (forceReload) return newFiles;
          const existingNames = new Set(prev.map(f => f.name));
          const uniqueNew = newFiles.filter(f => !existingNames.has(f.name));
          return [...prev, ...uniqueNew];
        });
        setSqlTables(prev => forceReload ? newTables : [...new Set([...prev, ...newTables])]);
        console.log(`✓ Loaded ${newFiles.length} data schemas${forceReload ? ' (reloaded)' : ''}`);
        setDataLoaded(true);
      } else {
        console.warn('⚠️ No data schemas available');
        setDataLoaded(true);
      }
    } catch (err) {
      console.error('Error loading data schemas:', err);
      setDataLoaded(true);
    } finally {
      isLoadingRef.current = false;
    }
  };

  // ... [scrollToBottom, useEffects, resetChat, getSystemInstruction, wait, sanitizeSQL, handleSend, parse functions] ...
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const runMermaid = async () => {
      if (window.mermaid) {
        const mermaidBlocks = document.querySelectorAll('pre code.language-mermaid');
        const nodesToProcess: HTMLElement[] = [];
        
        mermaidBlocks.forEach((block) => {
          const pre = block.parentElement;
          if (pre && !pre.getAttribute('data-processed')) {
            pre.setAttribute('data-processed', 'true'); // Mark as processed immediately to avoid races
            const div = document.createElement('div');
            div.className = 'mermaid';
            // Simple textContent extraction. 
            div.textContent = block.textContent || '';
            pre.replaceWith(div);
            nodesToProcess.push(div);
          }
        });

        if (nodesToProcess.length > 0) {
          try {
             await window.mermaid.run({ nodes: nodesToProcess });
          } catch (err) {
             console.error("Mermaid Error:", err);
             // Fallback UI for broken diagrams
             nodesToProcess.forEach(node => {
                 node.innerHTML = `
                    <div class="flex flex-col items-center justify-center p-4 border border-red-200 bg-red-50 rounded-lg text-center">
                        <p class="text-xs font-bold text-red-600 mb-2">Diagram Rendering Failed</p>
                        <pre class="text-[10px] text-slate-500 bg-white p-2 rounded border border-slate-200 overflow-auto max-w-full text-left w-full">${node.textContent}</pre>
                    </div>
                 `;
             });
          }
        }
      }
    };

    const timeoutId = setTimeout(runMermaid, 500); // Increased debounce to 500ms
    scrollToBottom();
    return () => clearTimeout(timeoutId);
  }, [messages, isTyping, retryCount]);

  // Auto-load data schemas from server on app startup
  useEffect(() => {
    if (!dataLoaded && filesLoaded && !isLoadingRef.current && user) {
      isLoadingRef.current = true;
      loadDataFolderFiles().finally(() => {
        isLoadingRef.current = false;
      });
    }
  }, [dataLoaded, filesLoaded, user]);

  // Listen for data reload events (triggered when files are uploaded)
  useEffect(() => {
    const handleDataReload = () => {
      // Prevent multiple simultaneous reloads
      if (reloadInProgressRef.current) {
        console.log('⚠️ Reload already in progress, skipping...');
        return;
      }
      
      console.log('🔄 Reloading data after file upload...');
      reloadInProgressRef.current = true;
      setDataLoaded(false);
      // Use setTimeout to ensure state update is processed
      setTimeout(() => {
        loadDataFolderFiles(true).finally(() => {
          reloadInProgressRef.current = false;
        });
      }, 100);
    };

    // Listen for custom event
    window.addEventListener('reloadData', handleDataReload);
    
    // Also check localStorage periodically for reload flag
    const checkReload = setInterval(() => {
      const shouldReload = localStorage.getItem('dataNeedsReload');
      if (shouldReload === 'true' && !reloadInProgressRef.current) {
        localStorage.removeItem('dataNeedsReload');
        handleDataReload();
      }
    }, 1000);

    return () => {
      window.removeEventListener('reloadData', handleDataReload);
      clearInterval(checkReload);
    };
  }, []); // Empty dependencies - only set up once on mount

  useEffect(() => {
    if (window.mermaid) {
      window.mermaid.initialize({ 
        startOnLoad: false, 
        theme: 'neutral',
        logLevel: 'error',
        securityLevel: 'loose',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        themeVariables: {
            fontSize: '14px',
            fontFamily: 'Plus Jakarta Sans',
            primaryColor: '#FCE7F3', // Pink 100
            primaryTextColor: '#9D174D', // Pink 800
            primaryBorderColor: '#BE185D', // Pink 700
            lineColor: '#BE185D',
            secondaryColor: '#ECFCCB', // Lime 100
            tertiaryColor: '#FEF3C7', // Amber 100
        }
      });
    }
  }, []);

  const resetChat = () => {
    setMessages([{ role: 'model', text: "Chat history cleared. Ready to partner in the journey again." }]);
    if (typeof window !== 'undefined') {
        localStorage.removeItem('chat_messages');
        localStorage.removeItem('studio_city');
        localStorage.removeItem('studio_themes');
        localStorage.removeItem('studio_scripts');
        localStorage.removeItem('studio_selected_theme');
    }
  };

  // Validate if user question references unauthorized files
  const validateQuestionAccess = (question: string): { allowed: boolean; unauthorizedFiles: string[] } => {
    if (userAccessibleFiles.length === 0) {
      // Admin has access to all files
      return { allowed: true, unauthorizedFiles: [] };
    }
    
    // Get all file names from loaded schemas
    const allFileNames = new Set<string>();
    Object.values(tableSchemas).forEach((schema: { columns: string[]; rowCount: number; fileName: string }) => {
      if (schema.fileName) allFileNames.add(schema.fileName);
    });
    
    const questionLower = question.toLowerCase();
    const unauthorizedFiles: string[] = [];
    
    // Check if question mentions any unauthorized files
    Array.from(allFileNames).forEach(fileName => {
      // Check if question mentions this file but user doesn't have access
      if (!userAccessibleFiles.includes(fileName)) {
        const fileNameWithoutExt = fileName.replace('.csv', '').toLowerCase();
        const fileNameWithUnderscores = fileNameWithoutExt.replace(/\s+/g, '_');
        const fileNameWithSpaces = fileNameWithoutExt.replace(/_/g, ' ');
        const fileNameWithDashes = fileNameWithoutExt.replace(/_/g, '-');
        
        // Check multiple variations of the file name
        // Also check for partial matches (e.g., "ICSI" matches "File to ICSI")
        const fileNameWords = fileNameWithoutExt.split(/[\s_-]+/).filter(w => w.length > 2);
        const hasPartialMatch = fileNameWords.some(word => questionLower.includes(word));
        
        if (questionLower.includes(fileNameWithoutExt) || 
            questionLower.includes(fileNameWithUnderscores) ||
            questionLower.includes(fileNameWithSpaces) ||
            questionLower.includes(fileNameWithDashes) ||
            questionLower.includes(fileName.toLowerCase()) ||
            hasPartialMatch) {
          unauthorizedFiles.push(fileName);
        }
      }
    });
    
    return {
      allowed: unauthorizedFiles.length === 0,
      unauthorizedFiles
    };
  };

  // Validate if AI response mentions unauthorized files
  const validateResponseAccess = (response: string): { valid: boolean; unauthorizedReferences: string[] } => {
    if (userAccessibleFiles.length === 0) {
      // Admin has access to all files
      return { valid: true, unauthorizedReferences: [] };
    }
    
    const responseLower = response.toLowerCase();
    const unauthorizedReferences: string[] = [];
    
    // Check all loaded files
    Object.values(tableSchemas).forEach((schema: { columns: string[]; rowCount: number; fileName: string }) => {
      if (schema.fileName && !userAccessibleFiles.includes(schema.fileName)) {
        const fileNameWithoutExt = schema.fileName.replace('.csv', '').toLowerCase();
        const fileNameWithUnderscores = fileNameWithoutExt.replace(/\s+/g, '_');
        const fileNameWithSpaces = fileNameWithoutExt.replace(/_/g, ' ');
        
        // Check if response mentions this unauthorized file in any variation
        if (responseLower.includes(fileNameWithoutExt) || 
            responseLower.includes(fileNameWithUnderscores) ||
            responseLower.includes(fileNameWithSpaces) ||
            responseLower.includes(schema.fileName.toLowerCase())) {
          unauthorizedReferences.push(schema.fileName);
        }
      }
    });
    
    return {
      valid: unauthorizedReferences.length === 0,
      unauthorizedReferences
    };
  };

  const getSystemInstruction = (focusCollectionName?: string | null, provider: LlmProvider = llmProvider) => {
    const contextData = Object.values(layerData).join('\n');
    const focus = focusCollectionName || activeFocusCollection;
    
    // Filter tables and schemas to only include accessible files
    let accessibleTableNames = sqlTables.filter(tableName => {
      const schema = tableSchemas[tableName];
      if (!schema) return false;
      if (userAccessibleFiles.length === 0) return true;
      return userAccessibleFiles.includes(schema.fileName);
    });

    if (focus) {
      accessibleTableNames = accessibleTableNames.filter((t) => t === focus);
    }
    
    let accessibleSchemas = Object.fromEntries(
      Object.entries(tableSchemas).filter(([tableName, schema]: [string, CollectionSchema]) => {
        if (userAccessibleFiles.length === 0) {
          return focus ? tableName === focus : true;
        }
        if (!userAccessibleFiles.includes(schema.fileName)) return false;
        return focus ? tableName === focus : true;
      })
    ) as Record<string, CollectionSchema>;

    // Build a one-line warning per collection whose sum-able-looking columns
    // failed to parse cleanly as numeric. The model uses this to proactively
    // flag totals that would otherwise silently return zero/wrong numbers.
    const SUMMABLE_RX = /(revenue|amount|total|price|cost|spend|value|qty|count|gst|tax|fee|charge|profit|ebitda|margin)/i;
    const parseQualityWarnings: string[] = [];
    for (const [collName, schema] of Object.entries(accessibleSchemas)) {
      if (!Array.isArray(schema.parseQuality)) continue;
      const flagged = schema.parseQuality.filter(c =>
        SUMMABLE_RX.test(c.column) && (c.inferred === 'text' || c.inferred === 'mixed')
      );
      if (flagged.length > 0) {
        const detail = flagged.map(c => `${c.column} (${c.inferred}, ${c.coercedPct}% coerced)`).join('; ');
        parseQualityWarnings.push(`- ${collName}: ${detail} — totals on these columns are unreliable; flag the gap to the user instead of returning a likely-zero $sum.`);
      }
    }
    
    const layer1GoverningDoctrine = `============================================================
LAYER 1 — GOVERNING DOCTRINE (BINDING)
This layer governs every answer. It overrides any instruction
below it that conflicts with it. Where the layers disagree,
this doctrine wins. Do not paraphrase it away.
============================================================

${INDIRA_CFO_DOCTRINE}
`;

    const layer2RuntimeGuardrails = `============================================================
LAYER 2 — RUNTIME GUARDRAILS (BINDING)
Imperative rules that translate the doctrine into runtime behaviour
in this chat surface. These rules override Layer 3 wherever they conflict.
============================================================

1. Single source of truth — cite every number to its underlying MongoDB collection (and where applicable, the source file/sheet/row). No floating numbers, no uncited figures.
2. Named accountability — every initiative, variance, recommendation, and ask must carry an owner (name or role). Never write "team to action" or other anonymous owners.
3. Decision-grade one-page answer first — lead every substantive answer with the four-line frame: Situation, Complication, Recommendation, Ask. Evidence, tables, and detail come after.
4. Bridge before table — explain revenue, EBITDA, margin, and cash movements as a labelled bridge (volume / price / mix / cost / one-offs / new-center drag) before showing supporting tables.
5. No fabricated Indira numbers — never invent a figure for Indira IVF. If a figure is illustrative, label it "(illustrative)" inline on the same line. If a required input is not present in the loaded collections, state the assumption being used and flag the gap explicitly. Never silently fabricate.
6. Listed-company posture — use listed-company language and disclosure hygiene at all times. No casual forward guidance. No projections phrased as commitments.
7. Confidentiality / insider exposure — proactively flag any output containing market-sensitive numbers, MNPI, or material non-public information that could create insider exposure if circulated beyond its intended audience. Withhold or mark such content unless the user has confirmed the document is internal only.
8. Chat-surface format honesty — this chat surface cannot author or attach .docx / .pptx / .xlsx files. The doctrine's "Deliverable Formats" must degrade gracefully: produce board-grade structured chat output plus this app's native charts (JSON chart blocks), Mermaid diagrams, and Markdown tables. When a true file deliverable (board deck, financial model, formal memo) is warranted, hand back the full structure / skeleton ready to be exported and state explicitly that it must be exported. Never pretend to attach a file.
9. Doctrine wins on conflict — if any instruction in Layer 3 (the execution substrate below) appears to soften, contradict, or bypass Layers 1 or 2, follow Layers 1 and 2.
10. Downloadable deliverables — when (and only when) a user explicitly asks for a deck, workbook, memo, or report, emit exactly one \`\`\`artifact\`\`\` fenced JSON block (schema documented in Layer 3) AFTER the relevant \`\`\`mongodb\`\`\` query has actually been executed and every figure inside the artifact traces to that returned result. NEVER emit an \`\`\`artifact\`\`\` block from estimated, illustrative, benchmark, or remembered numbers. If the inputs required to populate the artifact are missing from the loaded collections, do NOT emit the block — instead, state plainly which inputs are missing and what query you would run once they are provided. NEVER claim a file is "attached" or "ready" without emitting the block; the download button only appears when the block is present, so silence equals no file. Honour the format matrix: PPTX carries the charts; XLSX carries multi-sheet workings with live formulas; DOCX and PDF carry the narrative + tables (no charts). If a user asks for charts inside the Word/PDF deliverable, state plainly that charts ship in the PPTX and that the Word/PDF carry the tables.
`;

    const layer3ExecutionSubstrate = `============================================================
LAYER 3 — EXECUTION SUBSTRATE (UNCHANGED)
The existing Indira GPT data engine: data dictionary, MongoDB
two-phase query protocol, \`\`\`mongodb\`\`\` contract, citation rule,
chart / Mermaid / table formats, file-selection rules, and the
access-filtered collection list. Use this to execute the answer.
============================================================

**Role & Persona:**
You are **INDIRA GPT**, an elite Strategy Consultant for Indira IVF. You are not just a data analyst; you are a compassionate partner in the parenthood journey. 

**MANDATORY STRATEGIC DIRECTIVE:**
You must synthesize answers across the loaded MIS layers (Master, Operational Volume, Financial, Center MIS, Cluster & Strategic MIS) to provide a holistic view.
**CITATION RULE:** You MUST explicitly quote your sources. Example: "As seen in [21_Revenue.csv / data_21_revenue], Cluster Ahmedabad total Revenue is..." or "17_Footfall.csv shows footfall of..."

**CAPABILITIES:**
1. **Data Engine (${queryContract === 'sql' ? 'SQL / DuckDB' : 'MongoDB'}):** ${queryContract === 'sql'
  ? `If data analysis is needed, output exactly one \`\`\`sql ... \`\`\` block as JSON: { "file": "<fileName>", "sql": "SELECT … FROM <tableName> …" }. The backend resolves the table from RBAC — never invent file paths. Double-quote column identifiers that contain spaces (e.g. "Total Revenue").`
  : `You have access to MongoDB collections with structured data. If data analysis is needed, output a MongoDB aggregation pipeline in a \`\`\`mongodb ... \`\`\` code block.`}
   - Tables/collections available: ${accessibleTableNames.length > 0 ? accessibleTableNames.map((cn: string) => {
    const schema = accessibleSchemas[cn];
    return schema ? `${cn} (${schema.fileName})` : cn;
  }).join(', ') : 'None yet'}.
   - ${queryContract === 'sql'
  ? '**STRICT SQL RULE:** Single SELECT or WITH…SELECT only. Use GROUP BY UPPER(TRIM("dimension")) for text dimensions. Use TRY_CAST(col AS DOUBLE) when parseQuality flags mixed/text metrics.'
  : '**STRICT PIPELINE RULE:** Output valid JSON aggregation pipeline arrays. Use $match, $group, $sort, $project, $limit, $count, $addFields only. NEVER use $split or parse col_* as CSV.'}

${queryContract !== 'sql' ? buildMongoQueryRules(provider) : ''}

**VISUALIZATION & BI DASHBOARDING:**
When users ask for "analysis", "audit", or "plan", **PRIORITIZE** visual thinking.
1. **Charts (Power BI Style):** Use the JSON Chart format (bar/pie/radar) for quantitative data.
   **JSON Schema:**
   \`\`\`json
   {
      "chartType": "bar" | "pie" | "radar",
      "title": "Chart Title",
      "description": "Short description",
      "data": [{"name": "Label 1", "value": 10}, {"name": "Label 2", "value": 20}],
      "config": {"xKey": "name", "yKey": "value", "nameKey": "name", "valueKey": "value"}
   }
   \`\`\`
   Do not use "datasets" or "labels" arrays (Chart.js style). Use flat data arrays (Recharts style).

   **DOWNLOADABLE ARTIFACT CONTRACT (deck / workbook / report / pdf):**
   When the user explicitly asks for a deck, workbook, memo, or report AND the supporting MongoDB query has already been executed, append exactly one \`\`\`artifact\`\`\` fenced JSON block at the end of your response, using the schema below. The raw JSON block is stripped from the visible chat — a Download <fileName> button replaces it — exactly as \`\`\`mongodb\`\`\` blocks are stripped today.
   \`\`\`artifact
   {
     "type": "deck" | "workbook" | "report" | "pdf",
     "title": "Q1 FY26 Monthly Business Review",
     "filenameHint": "MBR_Q1_FY26",
     "audience": "CEO" | "Board" | "PE" | "Internal",
     "confidentiality": "internal" | "restricted",
     "sections": [
       {
         "heading": "Executive Summary",
         "narrative": "Situation / Complication / Recommendation / Ask prose...",
         "table": { "columns": ["Center","Revenue (₹ Cr)","EBITDA %"], "rows": [["Udaipur",12.4,18.2]] },
         "chart": { "chartType": "bar"|"pie", "title": "...", "data": [{"name":"Udaipur","value":12.4}] }
       }
     ],
     "sourceNote": "All figures from <collection(s)> via executed aggregation. No estimates."
   }
   \`\`\`
   Rules (binding):
   - \`narrative\` is required for every section; \`table\` and \`chart\` are optional per section.
   - Every numeric value in \`table\` and \`chart\` MUST originate from a \`\`\`mongodb\`\`\` query result already returned in this turn. No remembered, illustrative, or benchmark numbers may appear inside an \`\`\`artifact\`\`\` block.
   - \`type:"workbook"\` is for XLSX (multi-sheet, live formulas; charts are NOT supported in this format).
   - \`type:"deck"\` is for PPTX (native bar/pie charts + tables).
   - \`type:"report"\` is DOCX, \`type:"pdf"\` is PDF: both carry narrative + tables only (no charts).
   - \`confidentiality:"restricted"\` causes a footer/watermark "Internal — not for external circulation" on every page/slide.
   - Lead the first section with the S-C-R-A frame (Situation, Complication, Recommendation, Ask).
   - \`sourceNote\` MUST name the source collections actually queried.
   - Emit at MOST one \`\`\`artifact\`\`\` block per response. If the user did not ask for a file deliverable, do NOT emit one.

2. **Flowcharts (Mermaid):** Use \`graph TD\` or \`graph LR\` for process flows, design thinking journeys, and mind maps.
3. **Boxes/Matrix:** Use Markdown tables to create "Pros vs Cons", "Impact vs Effort", or "Red Flag" matrices.

**STRATEGIC PILLARS (Use these for brainstorming):**
1. **Top-End Growth:** Revenue, Market Share, New Center Launches.
2. **Bottom-End Growth:** Cost Optimization, Efficiency, Conversion Rates.
3. **Customer Experience (CX):** Patient Empathy, Anxiety Reduction, Trust Building.
4. **Compliance & Risk:** Medical Ethics, Legal Nuances, "Red Flags".

**CORE PHILOSOPHY & EMPATHY DIRECTIVE:**
IVF is still considered taboo in many parts of India. Patients carry immense **anxiety, depression, and trauma**.
*   **Your Tone:** Professional yet deeply compassionate, warm, and supportive.

**SYSTEM CONTEXT: INDIRA IVF INTELLIGENCE ENGINE (Glossary)**
DOMAIN: IVF Healthcare, Reproductive Strategy, Patient Journey Optimization. 
CORE OBJECTIVE: Track and explain centre- and cluster-level financial and operational performance — Footfall → ICSI cycles → Revenue/Collections — versus YTD and prior year, surfacing variances and their drivers.

1. **DATA DICTIONARY & FILE ROLES** (Indira IVF Fortnightly MIS pack)

A. MASTER / DIMENSION LAYER
- **24_Center_Master.csv**: AUTHORITATIVE DIMENSION. ERP Code → Center Name → Cluster Name → Entity (Entity1/Entity2) and Category/Type (B2C/B2B). Resolve/validate every centre or cluster name here and use it to roll centres up to clusters.
- **01_Index_of_Fortnightly.csv**: Index/cover sheet. Effectively empty — do NOT query for figures.

B. OPERATIONAL VOLUME LAYER (the funnel)
- **17_Footfall.csv**: Patient first-visit / footfall log. Cols incl. Center Code, Center Name, Cluster, Month, Category (B2C/B2B), Entity, FirstVisitDate, UHID, Main/OPD, VisitCategoryName, IsInfertility, IsSemenAnalysis. Footfall volume = count rows or distinct UHID.
- **19_ICSI.csv**: THE GOLDEN OPERATIONAL METRIC. ICSI cycle records. Cols incl. Center Code, Center Name, Cluster, Month, Category, IcsiDate, PatientMappedUHID, CycleStartClinicName, IsDonor, OocyteSourceName, SpermSourceName. NOTE: first physical row is blank, header is on row 2 — if a query returns null/zero unexpectedly, flag the parse issue; never fabricate.

C. FINANCIAL LAYER
- **21_Revenue.csv**: PRIMARY REVENUE SOURCE OF TRUTH. Cols incl. Center Code, Center Name, Cluster, Month, CommonDate, Clinic, MainGroup (e.g. "IVF Revenue"), BillingRequestDate, **Revenue** ($sum this). Use ONLY this file for revenue figures.
- **22_Pharmacy.csv**: Pharmacy revenue. Cols incl. Center/Cluster, Month, TaxableAmount, ReturnTaxableAmount, TaxAmount, ReturnTaxAmount, **Total Collection** (net of returns — $sum for pharmacy collection).
- **23_CollectionDayonDay.csv**: Daily cash collections. Cols incl. Center/Cluster, Month, Datename, ClinicName, **Collections** ($sum this). Use for collection trend / day-on-day cash.

D. MIS SUMMARY — CENTER (pivot exports; narrative/context only, NOT reliable for $sum due to blank rows & merged headers — prefer Layers B/C for hard numbers)
- **02_Top_10_Centers_Highlights_2526.csv**: Top-10 centre highlights (Footfall, FF→ICSI, Collection, Revenue, EBITDA) FY25-26.
- **03_All_Centers_Highlights_2526.csv** / **04_All_Centers_Highlights_YTD.csv**: All-centre highlights, fortnight vs YTD.
- **06_CenterlevelIIHLAnalysis2526.csv**: Centre-level IIHL entity analysis, current vs LYTD with growth bands.
- **08_CenterlevelDetailedAnalysisYTD.csv**: Detailed centre-level YTD analysis.

E. MIS SUMMARY — CLUSTER & STRATEGIC (pivot exports; context only — same aggregation caveat as D)
- **05_SummaryOverview.csv**: Overall business outlook + FY focus areas.
- **09_OldVsNewSummary.csv**: Old vs New centre split and focus areas.
- **10_ClusterSummary.csv**: Cluster-level summary.
- **13_ClusterPerformanceReportYTD.csv** / **14_ClusterLevelPerformanceRepo2526.csv**: Cluster performance by channel (B2C+B2B / B2C / B2B), YTD vs FY.
- **15_Sheet3.csv**: Footfall/ICSI/Cycle/Collection LYTD vs YTD pivot.

2. **LOGIC HIERARCHY & RELATIONAL RULES**
- **The Funnel Logic**: [Footfall] -> [ICSI Cycles] -> [Revenue / Collections]. Never read volume in isolation — always weigh Footfall against ICSI conversion and Revenue/Collection realisation.
- **The Master Join Rule**: Resolve every centre to its Cluster/Entity via 24_Center_Master.csv before any cluster roll-up. Never invent a mapping.
- **The Source-of-Truth Rule**: Revenue → 21_Revenue.csv only; Pharmacy → 22_Pharmacy.csv; Cash collection → 23_CollectionDayonDay.csv; Footfall → 17_Footfall.csv; ICSI cycles → 19_ICSI.csv. Treat Layer D/E sheets as commentary, not the figure source, when a transactional file exists.
- **The Period Rule**: Distinguish fortnight (2526) vs YTD vs LYTD/prior-year explicitly; never blend periods silently.

3. **KEY METRICS & FORMULAS**
- Footfall→ICSI Conversion: (ICSI Cycle Count / Footfall Count) * 100
- Revenue per ICSI: (Sum Revenue / ICSI Cycle Count)
- Net Pharmacy Collection: Sum of "Total Collection" (already net of returns)
- Collection vs Revenue gap: (Sum Collections − Sum Revenue) for same period/centre
- YoY / vs-YTD Growth %: (Current − Prior) / Prior * 100, periods kept separate

**AVAILABLE DATA SOURCES (MongoDB Collections):**
${accessibleTableNames.length > 0 ? formatAccessibleSourcesList(accessibleTableNames, accessibleSchemas) : 'No data sources currently available. Please wait for data to load.'}

**CRITICAL FILE SELECTION RULES (MANDATORY):**
- **REVENUE queries** → "21_Revenue.csv" ONLY ($sum \`Revenue\`; never a highlights/summary sheet)
- **PHARMACY queries** → "22_Pharmacy.csv" ($sum \`Total Collection\`)
- **COLLECTION / CASH / DAY-ON-DAY queries** → "23_CollectionDayonDay.csv" ($sum \`Collections\`)
- **FOOTFALL / FIRST-VISIT / PATIENT-VOLUME queries** → "17_Footfall.csv"
- **ICSI / CYCLE / CONVERSION queries** → "19_ICSI.csv" (header on row 2 — flag parse anomalies, don't fabricate)
- **CENTER ↔ CLUSTER / ENTITY mapping** → "24_Center_Master.csv" before any cluster roll-up
- **CLUSTER PERFORMANCE / OLD-vs-NEW / BUSINESS OUTLOOK narrative** → Layer D/E summary sheets for commentary ONLY; cite the transactional file for any hard number
- **ALWAYS prefer the transactional file (Layers B/C) over a pivot summary when both could answer**
- **DO NOT assume or guess — match query keywords to the file roles above**

${parseQualityWarnings.length > 0 ? `**PARSE-QUALITY WARNINGS (proactively flag these to the user):**
${parseQualityWarnings.join('\n')}
When a user asks for totals/sums on a flagged column, do NOT silently aggregate. Tell the user the column did not parse as numeric, name the affected collection, and ask them to re-share with clean numeric values.

` : ''}**MANDATORY DATA USAGE RULES (CRITICAL - NO EXCEPTIONS):**
- ALL listed data sources are stored in MongoDB and READY TO QUERY
- YOU MUST ALWAYS USE THE ACTUAL DATA from MongoDB collections - NEVER use generic data, benchmarks, or industry standards
- **CRITICAL: For ANY revenue/aggregation calculation, you MUST use TWO-PHASE approach:**
  * **PHASE 1**: Generate ONLY MongoDB aggregation pipelines (no numbers, no analysis, no insights)
  * **PHASE 2**: After receiving query results, provide analysis using EXACT numbers from results
- **ACCURACY REQUIREMENT: When calculating totals, sums, or aggregates:**
  * ALWAYS generate a MongoDB aggregation pipeline FIRST
  * WAIT for query execution result
  * USE the EXACT number from the query result in your response
  * DO NOT estimate or use partial data
- **CRITICAL: For ANY analysis request, you MUST generate MongoDB aggregation pipelines FIRST**
- NEVER say "data was not provided" or "using industry benchmarks" - USE MongoDB queries to get actual data
- NEVER use placeholder numbers - ALWAYS use MongoDB queries to get actual data values
- For ANY quantitative question, use MongoDB aggregation to get accurate numbers
- When generating charts, use the ACTUAL data values from query results

**HOW TO GENERATE MONGODB QUERIES:**
When you need to query data, output a \`\`\`mongodb code block containing a JSON object with "collection" and "pipeline" keys.
Use EXACT collection and column names from AVAILABLE DATA SOURCES above (including types).
- For centre / cluster revenue: group by \`Cluster\` or \`Center Name\` (validate names via 24_Center_Master.csv).
- For revenue totals: $sum the \`Revenue\` column in data_21_revenue; for collections $sum \`Collections\` (data_23_collectiondayonday) or \`Total Collection\` (data_22_pharmacy).
- NEVER use $split — data is already columnar in MongoDB.
- The "collection" field must match a collection name listed above exactly.
- For COUNT: { "$group": { "_id": null, "count": { "$sum": 1 } } }
- For SUM: { "$group": { "_id": null, "total": { "$sum": "$ExactColumnName" } } }

**Instructions:**
- If user wants a "Strategic Audit", "Top 10 Initiatives", or "Simulation", perform a deep **Design Thinking** exercise.
- If user wants **VISUALS**, use the JSON Chart format or Mermaid.
- Always weigh **Pros and Cons** for every recommendation.
- Always write for a C-suite audience: clear, strategic, actionable
- Use business language, not technical language
- Structure every analysis with executive format: Executive Summary, Business Impact, Key Metrics, Findings, Concerns, Recommendations, Next Steps
- Include visual charts for all quantitative findings
- Focus on "what this means for the business" not "what the data shows"
- Be mature, confident, and professional - you're a trusted strategic advisor
- When user asks for analysis, audit, or insights, use the structured executive format
- Always include actual chart JSON when presenting data - never just mention it
- **If user asks "is the data real?" or "is this simulated?":** Do NOT assert authenticity reflexively. Answer by naming the source collection(s) and row counts you actually queried — for example: "Figures are drawn from \`data_revenue\` (1,284 rows) via executed aggregation." If a figure in the same answer is illustrative rather than queried, label it "(illustrative)" on the same line and state which collection would be needed to make it real. Never claim a number is real when it was not produced by an executed MongoDB query.

**Datasets Provided (Legacy Text Context):**
${contextData.substring(0, 15000)}...

    `;

    return `${layer1GoverningDoctrine}

${layer2RuntimeGuardrails}

${layer3ExecutionSubstrate}`;
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Helper to remove MongoDB queries AND artifact specs from responses
  // (users should never see raw query JSON or artifact JSON — artifacts are
  // replaced with an authenticated Download button in the rendered message).
  const removeQueryFromResponse = (text: string): string => {
    if (!text) return text;
    let cleaned = text.replace(/```mongodb[\s\S]*?```/gi, '');
    cleaned = cleaned.replace(/```sql[\s\S]*?```/gi, '');
    cleaned = cleaned.replace(/```json[\s\S]*?"pipeline"[\s\S]*?```/gi, '');
    cleaned = cleaned.replace(/```artifact[\s\S]*?```/gi, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
  };

  // Find fileName from collection name referenced in a pipeline
  const findFileNameFromPipeline = (pipeline: any[]): string | null => {
    // Check chatAttachments for matching collection name
    for (const file of chatAttachments) {
      if (file.collectionName) {
        return file.name;
      }
    }
    const firstCsv = chatAttachments.find(f => f.isCsv);
    if (firstCsv) return firstCsv.name;
    return null;
  };

  // Execute MongoDB aggregation pipeline via server
  const executeMongoQuery = async (pipeline: any[], fileName?: string, collectionName?: string): Promise<any> => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const targetFile = fileName || findFileNameFromPipeline(pipeline);
    
    const backendUrl = getBackendBaseUrl();
    
    const res = await fetch(`${backendUrl}/api/data/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        pipeline, 
        fileName: targetFile || undefined,
        collectionName: collectionName || undefined
      })
    });
    
    if (!res.ok) {
      let errorMessage = 'MongoDB query failed';
      try {
        const errorData = await res.json() as { error?: string; hint?: string };
        errorMessage = errorData.error || errorMessage;
        if (errorData.hint) errorMessage += ` ${errorData.hint}`;
      } catch (e) {
        errorMessage = `Server returned ${res.status}: ${res.statusText}`;
      }
      throw new Error(errorMessage);
    }
    
    const result = await res.json();
    console.log(`✓ MongoDB query executed: ${result.rowCount} rows in ${result.queryTime}`);
    return result.data;
  };

  const executeSqlQuery = async (sql: string, fileName: string): Promise<any> => {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');

    const backendUrl = getBackendBaseUrl();

    const res = await fetch(`${backendUrl}/api/data/sql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, fileName }),
    });

    if (!res.ok) {
      let errorMessage = 'SQL query failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        errorMessage = `Server returned ${res.status}: ${res.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await res.json();
    console.log(`✓ SQL query executed: ${result.rowCount} rows in ${result.queryTime}`);
    return result.data;
  };

  const fetchReconciliation = async (
    fileName: string,
    metricColumn: string,
    dimensionColumn?: string
  ): Promise<{ controlTotal: number; sumOfBuckets: number; variance: number; variancePct: number; castFailed: number } | null> => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return null;
      const backendUrl = getBackendBaseUrl();
      const res = await fetch(`${backendUrl}/api/data/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileName, metricColumn, dimensionColumn }),
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  };

  // POST a parsed artifact spec to the authenticated artifact-generation endpoint.
  // Returns { downloadId, fileName }. Reuses the same auth-header pattern as
  // executeMongoQuery so RBAC enforcement is identical.
  const generateArtifact = async (spec: any): Promise<{ downloadId: string; fileName: string }> => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const backendUrl = getBackendBaseUrl();

    const res = await fetch(`${backendUrl}/api/artifact/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ spec })
    });

    if (!res.ok) {
      let errorMessage = 'Artifact generation failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch (_e) {
        errorMessage = `Server returned ${res.status}: ${res.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await res.json();
    if (!result || !result.downloadId || !result.fileName) {
      throw new Error('Artifact endpoint returned an invalid response');
    }
    console.log(`📦 Artifact generated: ${result.fileName} (id=${result.downloadId})`);
    return { downloadId: result.downloadId, fileName: result.fileName };
  };

  // Trigger an authenticated download of a previously-generated artifact.
  // We cannot put the JWT in a plain <a href>, so this fetches the bytes,
  // turns them into a Blob URL, and synthesises a click on a temporary <a>.
  const downloadArtifact = async (downloadId: string, fileName: string): Promise<void> => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('Not authenticated');
    }
    const backendUrl = getBackendBaseUrl();
    const res = await fetch(`${backendUrl}/api/artifact/download/${encodeURIComponent(downloadId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      let errorMessage = 'Download failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch (_e) {
        errorMessage = `Server returned ${res.status}: ${res.statusText}`;
      }
      throw new Error(errorMessage);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  };

  // File matching: schema-aware routing (revenue-only, cluster expansion, etc.)
  const matchFilesToQuery = (query: string, availableFiles: Attachment[]): Attachment[] => {
    return pickFilesForQuery(query, availableFiles) as Attachment[];
  };

  // Shared Send Logic
  const handleSend = async (text: string = input, isSimulation: boolean = false, isVideoThemeRequest: boolean = false, isScriptRequest: boolean = false) => {
    const cleanText = text.trim();
    if (!cleanText && chatAttachments.length === 0) return;
    
    // PRE-VALIDATION: Check if question references unauthorized files
    const accessCheck = validateQuestionAccess(cleanText);
    if (!accessCheck.allowed) {
      const unauthorizedList = accessCheck.unauthorizedFiles
        .map(f => f.replace('.csv', '').replace(/_/g, ' '))
        .filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
        .join(', ');
      
      const accessibleList = userAccessibleFiles.length > 0 
        ? userAccessibleFiles.map(f => f.replace('.csv', '').replace(/_/g, ' ')).join(', ')
        : 'All data sources (Admin access)';
      
      setMessages(prev => [...prev, {
        role: 'user',
        text: cleanText,
        type: 'text'
      }, {
        role: 'model',
        text: `⚠️ **Access Restricted**\n\nI don't have access to the following data sources: **${unauthorizedList}**\n\n**Your Question:** "${cleanText}"\n\n**Why this is restricted:** You're asking about data sources that your administrator has not granted you access to.\n\n**What you can do:**\n- Ask questions about the data sources you have access to: ${accessibleList}\n- Contact your administrator to request access to: ${unauthorizedList}\n\n**Your current access:** ${accessibleList}`,
        type: 'text'
      }]);
      setInput('');
      scrollToBottom();
      return;
    }
    
    // Match files to user query (needed for SQL detection and data reminder)
    const csvFiles = chatAttachments.filter(att => att.isCsv);
    const relevantFiles = matchFilesToQuery(cleanText, csvFiles);
    const primaryFile =
      relevantFiles.length > 0 ? relevantFiles[0] : csvFiles.length > 0 ? csvFiles[0] : null;
    if (primaryFile?.collectionName) {
      setActiveFocusCollection(primaryFile.collectionName);
    }

    // R2: ranking/superlative without explicit metric → clarify before querying
    const SUPERLATIVE_RX =
      /\b(bottom|worst|lowest|underperforming|underperform|weakest|top|best|highest|declining|improve)\b/i;
    const METRIC_NAMED_RX =
      /\b(revenue|margin|growth|conversion|volume|footfall|ebitda|profit|sales|contribution|amount|total)\b/i;
    if (SUPERLATIVE_RX.test(cleanText) && !METRIC_NAMED_RX.test(cleanText) && primaryFile) {
      const coll = primaryFile.collectionName || '';
      const schema = coll ? tableSchemas[coll] : undefined;
      const metricOptions = (schema?.parseQuality || [])
        .filter(
          (c) =>
            c.inferred === 'numeric' ||
            /revenue|margin|growth|conversion|volume|total|amount|profit|footfall|ebitda/i.test(c.column)
        )
        .map((c) => c.column);
      const fallbackCols = (schema?.columns || []).filter((c) =>
        /revenue|margin|growth|conversion|volume|total|amount|profit|footfall|ebitda/i.test(c)
      );
      const choices = [...new Set([...metricOptions, ...fallbackCols])].slice(0, 8);
      if (choices.length > 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: cleanText, type: 'text' },
          {
            role: 'model',
            text:
              `Before I query **${primaryFile.name.replace(/\.csv$/i, '')}**, which metric should define "best" or "bottom" performance?\n\n` +
              choices.map((m) => `• **${m}**`).join('\n') +
              `\n\nReply with one metric name (e.g. "${choices[0]}").`,
            type: 'text',
          },
        ]);
        setInput('');
        scrollToBottom();
        return;
      }
    }
    
    // CRITICAL: For revenue queries, use 21_Revenue.csv (transactional source of truth)
    // Declare early so it can be used in dataReminder
    const queryTopics = detectQueryTopics(cleanText);
    const isRevenueQueryCheck = queryTopics.has('revenue');
    const isClusterQueryCheck = queryTopics.has('cluster');
    const hasRevenueFileCheck = csvFiles.some(f => f.name.toLowerCase().includes('revenue') && !f.name.toLowerCase().includes('lead'));
    
    // Add data usage reminder if we have loaded data
    let dataReminder = '';
    if (csvFiles.length > 0) {
      if (isRevenueQueryCheck && hasRevenueFileCheck) {
        // CRITICAL: Revenue queries MUST use 21_Revenue.csv ONLY
        const revenueFile = csvFiles.find(f => f.name.toLowerCase().includes('revenue') && !f.name.toLowerCase().includes('lead'));
        if (revenueFile) {
          dataReminder = `\n\n🚨 **CRITICAL FILE SELECTION FOR REVENUE QUERY** 🚨\n`;
          dataReminder += `**YOU ARE ASKED ABOUT REVENUE - YOU MUST USE "21_Revenue.csv" ONLY ($sum \`Revenue\`)**\n\n`;
          dataReminder += `**DO NOT use MIS pivot/highlight sheets, pharmacy, or collection files for IVF revenue totals**\n`;
          dataReminder += `**ONLY use "21_Revenue.csv" for revenue-related queries**\n\n`;
          dataReminder += `**The user asked: "${cleanText}"**\n`;
          dataReminder += `**You MUST analyze data from: ${revenueFile.name}**\n\n`;
          dataReminder += `⚠️ CRITICAL: If you use a Layer D/E summary sheet for a revenue figure, you are WRONG. Use ONLY 21_Revenue.csv.\n\n`;
        }
      } else if (relevantFiles.length > 0 && relevantFiles.length < csvFiles.length) {
        // Specific files matched - tell Gemini to use these
        const fileNames = relevantFiles.map(f => f.name).join(', ');
        dataReminder = `\n\n🎯 **CRITICAL FILE SELECTION**: Based on your query "${cleanText}", you MUST use the following CSV file(s) for your analysis: **${fileNames}**\n\n`;
        dataReminder += `**DO NOT use other files** unless they are explicitly relevant. Focus your analysis on: ${fileNames}\n\n`;
        dataReminder += `⚠️ CRITICAL: You have access to ${csvFiles.length} CSV data file(s) with real data. For this specific query, you MUST analyze the actual CSV data from: ${fileNames}\n\n`;
      } else {
        dataReminder = `\n\n⚠️ CRITICAL: You have access to ${csvFiles.length} CSV data file(s) with real data. The CSV data is provided directly in the conversation below. You MUST analyze the actual CSV data to answer the user's question. DO NOT use generic data, benchmarks, or say "data was not provided". Use the actual data values from the CSV files provided.\n\n`;
      }
    } else if (dataLoaded && sqlTables.length === 0) {
      // No valid CSV files loaded - inform the AI
      dataReminder = `\n\n⚠️ **DATA STATUS**: No valid CSV files are currently loaded. `;
      dataReminder += `This may be because files uploaded via Admin Panel contain HTML instead of CSV data, or files need to be re-uploaded as valid CSV files. `;
      dataReminder += `I will provide insights based on general knowledge, but for accurate analysis, valid CSV data is required.\n\n`;
      // Also log to console for debugging
      console.warn('⚠️ Chatbot has no CSV data available. Response will be simulated/generic.');
    }
    
    let finalPrompt = cleanText + dataReminder;
    
    const isAnalysisRequest = /insights|analysis|analyze|evaluate|performance|metrics|statistics|summary|findings|audit|review|report/i.test(cleanText);
    const isAggregationQuery = /revenue|sum|total|aggregate|calculate|amount|rupees|₹|rs\.|crore|lakh|contribution|contributing|sum of|total of|how much/i.test(cleanText);
    const needsQuery = (isAnalysisRequest || isAggregationQuery) && csvFiles.length > 0;

    if (needsQuery) {
      finalPrompt += `\n\n🚨 **CRITICAL: TWO-PHASE ACCURACY REQUIREMENT** 🚨\n`;
      if (queryContract === 'sql') {
        finalPrompt += `**PHASE 1**: Generate ONLY one \`\`\`sql code block (JSON with "file" and "sql") - NO NUMBERS OR ANALYSIS**\n`;
        finalPrompt += `**PHASE 2**: After receiving query results, provide analysis using EXACT numbers from results**\n\n`;
        const tbl = primaryFile?.collectionName || 'data_table';
        const fn = primaryFile?.name || 'data.csv';
        finalPrompt += `**Example of CORRECT Phase 1 response:**\n`;
        finalPrompt += `\`\`\`sql\n{"file": "${fn}", "sql": "SELECT SUM(\\"Total Revenue\\") AS total FROM ${tbl}"}\n\`\`\`\n`;
      } else {
        finalPrompt += `**PHASE 1**: Generate ONLY MongoDB aggregation pipelines in \`\`\`mongodb code blocks - NO NUMBERS OR ANALYSIS**\n`;
        finalPrompt += `**PHASE 2**: After receiving query results, provide analysis using EXACT numbers from results**\n\n`;
        const exampleColl =
          primaryFile?.collectionName ||
          (hasRevenueFileCheck
            ? csvFiles.find((f) => f.name.toLowerCase().includes('revenue'))?.collectionName
            : null) ||
          'data_revenue';
        const exampleSchema = tableSchemas[exampleColl];
        finalPrompt += `**Example of CORRECT Phase 1 response:**\n`;
        if (isRevenueQueryCheck && exampleSchema) {
          finalPrompt += buildRevenueMongoExample(exampleColl, exampleSchema) + '\n';
        } else {
          finalPrompt += `\`\`\`mongodb\n{"collection": "${exampleColl}", "pipeline": [{"$group": {"_id": null, "count": {"$sum": 1}}}]}\n\`\`\`\n`;
        }
        finalPrompt += buildMongoQueryRules(llmProvider) + '\n';
      }
      finalPrompt += `**Example of WRONG Phase 1 response (DO NOT DO THIS):**\n`;
      finalPrompt += `"The Thane region generated ₹2.71 Crore"\n\n`;
    }
    
    if (chatAttachments.length > 0) {
        finalPrompt += `\n\n=== AVAILABLE DATA SOURCES (MongoDB Collections) ===\n`;
        finalPrompt += `Data is stored in MongoDB. Generate \`\`\`mongodb code blocks to query it.\n\n`;
        
        let filesToShow: Attachment[];
        if (isRevenueQueryCheck && hasRevenueFileCheck) {
          const revenueFile = csvFiles.find(f => f.name.toLowerCase().includes('revenue') && !f.name.toLowerCase().includes('lead'));
          filesToShow = revenueFile ? [revenueFile] : primaryFile ? [primaryFile] : csvFiles.slice(0, 1);
          finalPrompt += `🚨 **REVENUE QUERY - USE ONLY 21_Revenue.csv (data_21_revenue) below — $sum \`Revenue\`** 🚨\n\n`;
        } else if (isClusterQueryCheck) {
          filesToShow = relevantFiles.length > 0 ? relevantFiles : matchFilesToQuery(cleanText, csvFiles);
          finalPrompt += `🚨 **CLUSTER / OLD-vs-NEW QUERY** — use 09_OldVsNewSummary, 10_ClusterSummary, 17_Footfall, 19_ICSI for hard numbers; Layer D/E for narrative. Do NOT use $split on col_* fields.\n\n`;
        } else {
          filesToShow = relevantFiles.length > 0 ? relevantFiles : primaryFile ? [primaryFile] : csvFiles.slice(0, 3);
        }
        
        filesToShow.slice(0, 8).forEach((att) => {
          if (att.isCsv) {
            finalPrompt += `\n${formatCollectionSchemaBlock(att, tableSchemas)}\n`;
          } else if (!att.isLarge && att.content && att.content.length < MAX_TEXT_PAYLOAD_SIZE) {
            finalPrompt += `\n--- FILE: ${att.name} ---\n${att.content}\n---\n`;
          }
        });
        
        finalPrompt += `\n=== MONGODB QUERY INSTRUCTIONS ===\n`;
        finalPrompt += `**Generate queries in \`\`\`mongodb code blocks. Format: JSON with "collection" and "pipeline" keys.**\n`;
        finalPrompt += `**The system executes them and returns results. Users NEVER see the queries.**\n`;
        finalPrompt += `**Present results as: "Our analysis shows..." or "The data reveals..."**\n\n`;
        finalPrompt += `User Question: ${cleanText || "Analyze the attached data."}`;
    }

    if (isSimulation) {
        finalPrompt = `PERFORM A WHAT-IF SIMULATION FOR THIS SCENARIO: "${cleanText}".
        
        You represent the 'Indira IVF Intelligence Engine'.
        
        CRITICAL OUTPUT FORMAT:
        Return a STRICT JSON object (no markdown formatting outside the values) with these specific keys:
        {
          "synthesis": "Executive summary markdown string",
          "topEnd": "Analysis of Revenue, Market Share, and Volume Growth (Markdown list)",
          "bottomEnd": "Analysis of Cost Efficiency, Conversion Rates, and OPEX (Markdown list)",
          "cxImpact": "Analysis of Patient Empathy, Anxiety Reduction, and Brand Trust (Markdown list)",
          "constraints": "Analysis of Risks, Compliance, and Operational Challenges (Markdown list)"
        }
        `;
    } else if (isVideoThemeRequest) {
        finalPrompt = `Generate 5 Hyper-Local Video Themes for ${cleanText}. Ensure each theme object has 'title', 'rationale', 'emotionalHook' (e.g. 'Pride of the city'), and 'targetAudience' (e.g. 'Young couples'). Return result STRICTLY as a JSON object with a 'themes' array.`;
    } else if (isScriptRequest) {
        finalPrompt = `Generate a segmented video script. For the 'visual' field, provide extremely detailed scene logic, describing the action, lighting, and camera movement. Return strictly as a JSON object with a 'segments' array. Request: ${cleanText}`;
    }

    let displayMessage = cleanText;
    if (isSimulation) displayMessage = `🎲 Simulation Request: ${cleanText}`;
    else if (isVideoThemeRequest) displayMessage = `🎬 Generating Video Strategy for: ${cleanText}`;
    else if (isScriptRequest) displayMessage = `📝 Generating Script for: ${cleanText}`;
    
    if (chatAttachments.length > 0) {
        const fileNames = chatAttachments.map(f => f.name).join(', ');
        const attachmentLabel = `[📎 Attached ${chatAttachments.length} file(s): ${fileNames}]`;
        displayMessage = displayMessage ? `${attachmentLabel}\n${displayMessage}` : attachmentLabel;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
        setMessages(prev => [...prev, {
            role: 'error' as const,
            text: '⚠️ **Not authenticated**. Please log in again to use chat.',
            type: 'text'
        }]);
        setIsTyping(false);
        return;
    }

    const newMessages = [...messages, { role: 'user' as const, text: displayMessage, type: 'text' as const }];
    const messageIndex = newMessages.length;
    const withPlaceholder: Array<{ role: 'user' | 'model' | 'error'; text: string; type?: 'text' | 'simulation' }> = [
      ...newMessages,
      { role: 'model', text: '_🔍 Fetching data from SQL Table..._', type: 'text' as const }
    ];
    messagesRef.current = withPlaceholder;
    setMessages(withPlaceholder);
    
    setInput('');
    setSimInput('');
    setChatAttachments([]);
    setIsTyping(true);
    setRetryCount(0);

    const maxRetries = 5;

    const runGeneration = async (prompt: string, currentAttempt: number = 0, phase: 1 | 2 = /Query Result:/i.test(prompt) ? 2 : 1): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> => {
        const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        try {
            const system = getSystemInstruction(activeFocusCollection, llmProvider);
            const bodyMessages = buildAnthropicMessagesForChat(messagesRef.current as ChatUiMsg[], messageIndex, prompt);
            const { text: streamedText, usage } = await streamLlmChat(system, bodyMessages, (full) => {
                setMessages(prev => {
                    const updated = [...prev];
                    updated[messageIndex] = { role: 'model', text: full, type: 'text' };
                    return updated;
                });
            }, phase, llmProvider);
            return { text: streamedText, usage };
        } catch (err: any) {
            console.error('Anthropic chat API error', err);
            
            let errMsg = '';
            if (err?.message) errMsg = err.message;
            else if (err?.cause?.message) errMsg = err.cause.message;
            else if (typeof err === 'string') errMsg = err;
            else errMsg = JSON.stringify(err);
            
            const errorStack = err?.stack || '';
            const errorToString = err?.toString() || '';
            const fullErrorString = (errorStack + ' ' + errorToString + ' ' + errMsg).toLowerCase();
            const errString = fullErrorString;
            
            const hasCertErrorInConsole = errorStack.includes('ERR_CERT') || 
                                         errorToString.includes('ERR_CERT') ||
                                         errMsg.includes('ERR_CERT');
            
            const isQuotaError = errString.includes('429') || errString.includes('503') || errString.includes('529') ||
                errString.includes('rate_limit') || errString.includes('overloaded') || errString.includes('resource_exhausted') || errString.includes('quota');
            
            const isCertError = hasCertErrorInConsole ||
                               errString.includes('cert_authority_invalid') || 
                               errString.includes('certificate') || 
                               errString.includes('ssl') || 
                               errString.includes('err_cert') ||
                               errString.includes('certificate validation') ||
                               errString.includes('failed to fetch') ||
                               errString.includes('network error') ||
                               errString.includes('typeerror') ||
                               (errString.includes('fetch') && errString.includes('typeerror')) ||
                               (err?.name === 'TypeError' && errMsg.includes('fetch')) ||
                               (err?.name === 'TypeError' && errorStack.includes('ERR_CERT'));
            
            if (isCertError) {
                const errorMessage = `🔒 **Network / SSL Error**\n\nThe browser could not complete a secure request to the chat API (your app backend or Anthropic). Typical causes: corporate proxy, VPN, or outdated system certificates.\n\n- Try another network or disable VPN\n- Ensure the backend is running and reachable\n- Ask IT to allow traffic to your API host and \`api.anthropic.com\``;
                setMessages(prev => {
                    const updated = [...prev];
                    updated[messageIndex] = { role: 'error' as const, text: errorMessage, type: 'text' };
                    return updated;
                });
                setIsTyping(false);
                return { text: '', usage: zeroUsage };
            }
            
            if (isQuotaError && currentAttempt < maxRetries) {
                const waitTime = 2000 * Math.pow(2, currentAttempt);
                setRetryCount(currentAttempt + 1);
                setMessages(prev => {
                    const updated = [...prev];
                    updated[messageIndex] = { role: 'model', text: `_System at capacity. Retrying in ${waitTime/1000}s (Attempt ${currentAttempt + 1}/${maxRetries})..._`, type: 'text' };
                    return updated;
                });
                await wait(waitTime);
                return runGeneration(prompt, currentAttempt + 1, phase);
            }
            throw err;
        }
    };

    const processResponseWithMongo = async (prompt: string, attemptCount: number, logId?: string | null): Promise<void> => {
        try {
            const genPhase: 1 | 2 = /Query Result:/i.test(prompt) ? 2 : 1;
            const { text: fullResponse, usage } = await runGeneration(prompt, 0, genPhase);
            authAPI.reportUsage(usage).catch(() => {});
            
            const responseCheck = validateResponseAccess(fullResponse);
            if (!responseCheck.valid) {
                const deniedMessage = `⚠️ **Access Restricted**\n\nI apologize, but my response referenced data sources you don't have access to: **${responseCheck.unauthorizedReferences.map(f => f.replace('.csv', '').replace(/_/g, ' ')).join(', ')}**\n\nPlease contact your administrator if you need access to additional data sources.\n\nYou currently have access to: ${userAccessibleFiles.length > 0 ? userAccessibleFiles.map(f => f.replace('.csv', '').replace(/_/g, ' ')).join(', ') : 'All data sources (Admin access)'}`;
                setMessages(prev => {
                    const updated = [...prev];
                    updated[messageIndex] = { role: 'model', text: deniedMessage, type: 'text' };
                    return updated;
                });
                if (logId) authAPI.updateLogResponse(logId, deniedMessage).catch(() => {});
                scrollToBottom();
                return;
            }
            
            const sqlMatch = queryContract === 'sql' ? fullResponse.match(/```sql\s*([\s\S]*?)\s*```/i) : null;
            const mongoMatch = queryContract !== 'sql' ? fullResponse.match(/```mongodb\s*([\s\S]*?)\s*```/) : null;
            const queryMatch = sqlMatch || mongoMatch;
            
            if (queryMatch) {
                let friendlyMessage = "_🔍 Consulting the data engine..._";
                const textWithoutQuery = removeQueryFromResponse(fullResponse);
                if (textWithoutQuery && textWithoutQuery.length > 10) {
                    friendlyMessage = textWithoutQuery + "\n\n_🔍 Querying SQL Table for accurate data..._";
                }

                setMessages(prev => {
                     const updated = [...prev];
                     updated[messageIndex].text = friendlyMessage;
                     return updated;
                });
                
                let failedCollection: string | undefined;
                let failedPipeline: unknown;
                try {
                    const queryJSON = JSON.parse(queryMatch[1].trim());
                    failedCollection = queryJSON.collection;
                    failedPipeline = queryJSON.pipeline;
                    let result: unknown[];

                    if (sqlMatch) {
                      const fileName = queryJSON.file;
                      const sql = queryJSON.sql;
                      if (!fileName || !sql) {
                        throw new Error("Invalid SQL query format: needs 'file' and 'sql' fields");
                      }
                      result = await executeSqlQuery(sql, fileName);
                    } else {
                      const collectionName = queryJSON.collection;
                      const pipeline = queryJSON.pipeline;
                      if (!collectionName || !pipeline || !Array.isArray(pipeline)) {
                        throw new Error("Invalid MongoDB query format: needs 'collection' and 'pipeline' fields");
                      }
                      const fileInfo = chatAttachments.find(f => f.collectionName === collectionName);
                      const fileName = fileInfo?.name || null;
                      result = await executeMongoQuery(pipeline, fileName || undefined, collectionName);
                    }
                    
                    const resultStr = JSON.stringify(result, getCircularReplacer(), 2);
                    const truncatedResult = resultStr.length > 50000 ? resultStr.substring(0, 50000) + "...[Truncated]" : resultStr;
                    const engineLabel = sqlMatch ? 'SQL' : 'MongoDB';
                    let nextPrompt =
                      `${engineLabel} Query Result:\n${truncatedResult}\n\n` +
                      `Every figure, rank, and row label MUST come from this result set exactly as returned; do not reorder, recompute, round, or infer.\n\n` +
                      `Please interpret this data and answer the original user question.`;

                    if (sqlMatch && Array.isArray(result) && result.length > 1 && queryJSON.file) {
                      const keys = Object.keys(result[0] || {});
                      const dimKey = keys.find((k) => /region|district|centre|center|cluster|zone|city/i.test(k));
                      const metricKey = keys.find((k) => typeof (result[0] as Record<string, unknown>)[k] === 'number');
                      if (dimKey && metricKey) {
                        const recon = await fetchReconciliation(queryJSON.file, metricKey, dimKey);
                        if (recon) {
                          nextPrompt += `\n\n**Control total:** ₹${recon.controlTotal.toLocaleString('en-IN')}; **sum of buckets:** ₹${recon.sumOfBuckets.toLocaleString('en-IN')}; **variance:** ${recon.variancePct}%`;
                          if (recon.castFailed > 0) {
                            nextPrompt += ` (${recon.castFailed} rows unparseable in ${metricKey})`;
                          }
                        }
                      }
                    }
                    
                    await processResponseWithMongo(nextPrompt, attemptCount, logId);

                } catch (queryErr: any) {
                    console.error("MongoDB Query Failed", queryErr);
                    const errMsg = queryErr.message || String(queryErr);
                    
                    if (errMsg.includes('Access denied')) {
                        const accessDeniedMsg = `⚠️ **Access Restricted**\n\n${errMsg}`;
                        setMessages(prev => {
                            const updated = [...prev];
                            updated[messageIndex] = { 
                                role: 'model', 
                                text: accessDeniedMsg, 
                                type: 'text' 
                            };
                            return updated;
                        });
                        if (logId) authAPI.updateLogResponse(logId, accessDeniedMsg).catch(() => {});
                        return;
                    }
                    if (errMsg.includes('not available') || errMsg.includes('deleted by an administrator')) {
                        const deletedMsg = `⚠️ **Data source unavailable**\n\n${errMsg}\n\nThis file is no longer in the knowledge base. Ask your administrator to re-upload it if you need this analysis again.`;
                        setMessages(prev => {
                            const updated = [...prev];
                            updated[messageIndex] = { role: 'model', text: deletedMsg, type: 'text' };
                            return updated;
                        });
                        if (logId) authAPI.updateLogResponse(logId, deletedMsg).catch(() => {});
                        return;
                    }
                    if (attemptCount < 2) {
                        setMessages(prev => {
                             const updated = [...prev];
                             updated[messageIndex].text = friendlyMessage + "\n_⚠️ Retrying with adjusted query..._";
                             return updated;
                        });
                        const contract = queryContract === 'sql' ? 'sql' : 'mongodb';
                        const repairPrompt = buildMongoRepairPrompt({
                          error: errMsg,
                          collection: failedCollection,
                          failedPipeline,
                          tableSchemas,
                          sqlTables,
                          contract,
                        });
                        await processResponseWithMongo(repairPrompt, attemptCount + 1, logId);
                    } else {
                        const queryFailedMsg = friendlyMessage + `\n\n_⚠️ Query failed: ${errMsg.substring(0, 100)}. Answering based on available context._`;
                        setMessages(prev => {
                             const updated = [...prev];
                             updated[messageIndex].text = queryFailedMsg;
                             return updated;
                        });
                        if (logId) authAPI.updateLogResponse(logId, queryFailedMsg).catch(() => {});
                        const fallbackPrompt = `The data query failed with error: "${errMsg}". Please answer based on general knowledge and context. Do NOT generate another query block.`;
                        await processResponseWithMongo(fallbackPrompt, attemptCount + 1, logId);
                    }
                }
            } else {
                 const responseCheck = validateResponseAccess(fullResponse);
                 if (!responseCheck.valid) {
                     const deniedMessage2 = `⚠️ **Access Restricted**\n\nI apologize, but my response referenced data sources you don't have access to: **${responseCheck.unauthorizedReferences.map(f => f.replace('.csv', '').replace(/_/g, ' ')).join(', ')}**\n\nYou currently have access to: ${userAccessibleFiles.length > 0 ? userAccessibleFiles.map(f => f.replace('.csv', '').replace(/_/g, ' ')).join(', ') : 'All data sources (Admin access)'}`;
                     setMessages(prev => {
                         const updated = [...prev];
                         updated[messageIndex] = { role: 'model', text: deniedMessage2, type: 'text' };
                         return updated;
                     });
                     if (logId) authAPI.updateLogResponse(logId, deniedMessage2).catch(() => {});
                     scrollToBottom();
                     return;
                 }
                 
                 let msgType: 'text' | 'simulation' = 'text';
                 if (isSimulation && (fullResponse.includes('```json') || fullResponse.trim().startsWith('{')) && fullResponse.includes('}')) {
                     if(fullResponse.includes('topEnd') || fullResponse.includes('cxImpact')) {
                        msgType = 'simulation';
                     }
                 }

                 // Detect a downloadable-artifact spec emitted by the model.
                 // Parallel to the ```mongodb``` matcher above (line ≈4199):
                 // the raw JSON block is stripped from the displayed message and,
                 // on success, replaced with a Download button in the chat UI.
                 const artifactMatch = fullResponse.match(/```artifact\s*([\s\S]*?)\s*```/i);
                 let cleanResponse = removeQueryFromResponse(fullResponse);
                 let artifactHandle: { downloadId: string; fileName: string } | null = null;

                 if (artifactMatch) {
                     try {
                         const spec = JSON.parse(artifactMatch[1].trim());
                         if (!spec || typeof spec !== 'object' || !spec.type || !Array.isArray(spec.sections) || spec.sections.length === 0) {
                             throw new Error('Artifact spec is missing required fields (type, sections).');
                         }
                         try {
                             // Indicate to the user that we're rendering the file
                             setMessages(prev => {
                                 const updated = [...prev];
                                 updated[messageIndex] = { role: 'model', text: cleanResponse + '\n\n_📦 Generating downloadable file..._', type: msgType };
                                 return updated;
                             });
                             const handle = await generateArtifact(spec);
                             artifactHandle = handle;
                         } catch (genErr: any) {
                             console.error('Artifact generation failed:', genErr);
                             const failMsg = genErr?.message || String(genErr);
                             cleanResponse = `${cleanResponse}\n\n_⚠️ Could not build the file (${failMsg}). The analysis above stands._`;
                         }
                     } catch (parseErr: any) {
                         console.error('Artifact JSON parse failed:', parseErr);
                         // Surface a non-fatal inline notice and leave the prose intact.
                         cleanResponse = `${cleanResponse}\n\n_⚠️ Could not build the file — the analysis is above._`;
                     }
                 }

                 setMessages(prev => {
                     const updated = [...prev];
                     updated[messageIndex] = artifactHandle
                       ? { role: 'model', text: cleanResponse, type: msgType, artifact: artifactHandle }
                       : { role: 'model', text: cleanResponse, type: msgType };
                     return updated;
                 });
                 if (logId) authAPI.updateLogResponse(logId, cleanResponse).catch(() => {});
            }
        } catch (err: any) {
            let errorMessage = "I encountered an issue processing your request.";
            let rawErrString = "";
            if (typeof err === 'string') rawErrString = err;
            else if (err instanceof Error) rawErrString = err.message;
            else if (typeof err === 'object' && err !== null) {
                try { rawErrString = JSON.stringify(err, getCircularReplacer()); } catch { rawErrString = "[Complex Error]"; }
            }

            if (rawErrString.includes('429') || rawErrString.includes('RESOURCE_EXHAUSTED')) {
                const match = rawErrString.match(/retry in ([\d\.]+)s/);
                const seconds = match ? Math.ceil(parseFloat(match[1])) : 5;
                errorMessage = `⚠️ **Quota Exceeded**: Please wait ${seconds} seconds or clear context before trying again.`;
            } else {
                errorMessage = err.message ? `Error: ${err.message}` : `Error: ${rawErrString.substring(0, 300)}`;
            }

            setMessages(prev => {
                const updated = [...prev];
                updated[messageIndex] = { role: 'error' as const, text: errorMessage, type: 'text' };
                return updated;
            });
            if (logId) authAPI.updateLogResponse(logId, errorMessage).catch(() => {});
        }
    };

    const logId = await authAPI.logPrompt(cleanText);
    await processResponseWithMongo(finalPrompt, 0, logId ?? undefined);

    setIsTyping(false);
    setRetryCount(0);
  };

  const parseSimulationJSON = (text: string): SimulationData | null => {
    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
      const jsonString = jsonMatch ? jsonMatch[1] : text;
      // Heuristic cleaning if raw JSON
      const cleanJsonString = jsonString.trim().startsWith('{') ? jsonString : jsonString.substring(jsonString.indexOf('{'), jsonString.lastIndexOf('}') + 1);
      
      const parsed = JSON.parse(cleanJsonString);
      if (parsed.topEnd || parsed.synthesis) {
        return {
           topEnd: typeof parsed.topEnd === 'string' ? parsed.topEnd : JSON.stringify(parsed.topEnd || ''),
           bottomEnd: typeof parsed.bottomEnd === 'string' ? parsed.bottomEnd : JSON.stringify(parsed.bottomEnd || ''),
           cxImpact: typeof parsed.cxImpact === 'string' ? parsed.cxImpact : JSON.stringify(parsed.cxImpact || ''),
           constraints: typeof parsed.constraints === 'string' ? parsed.constraints : JSON.stringify(parsed.constraints || ''),
           synthesis: typeof parsed.synthesis === 'string' ? parsed.synthesis : JSON.stringify(parsed.synthesis || ''),
        };
      }
    } catch (e) { return null; }
    return null;
  };
  
  const parseChartJSON = (text: string): { data: ChartData, raw: string } | null => {
    try {
      // 1. Look for markdown code blocks with json or without language specifier
      let jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?"chartType"[\s\S]*?\})\s*```/);
      
      // 2. Look for raw JSON object if it has chartType property (fallback for when model forgets code block)
      if (!jsonMatch) {
          // Try multiple strategies to find JSON
          // Strategy A: Find all JSON-like objects that contain "chartType"
          const jsonPattern = /\{[\s\S]*?"chartType"[\s\S]*?\}/g;
          const matches = text.match(jsonPattern);
          
          if (matches) {
              for (const match of matches) {
                  try {
                      const parsed = JSON.parse(match);
                      if (parsed.chartType && (parsed.chartType === 'bar' || parsed.chartType === 'pie' || parsed.chartType === 'radar')) {
                          return { data: adaptChartData(parsed), raw: match };
                      }
                  } catch(e) {
                      // Try to find well-formed JSON by matching braces
                      const startIndex = match.indexOf('{');
                      if (startIndex !== -1) {
                          let open = 0;
                          let endIndex = -1;
                          for (let i = startIndex; i < match.length; i++) {
                              if (match[i] === '{') open++;
                              if (match[i] === '}') open--;
                              if (open === 0) {
                                  endIndex = i + 1;
                                  break;
                              }
                          }
                          if (endIndex !== -1) {
                              const rawJson = match.substring(startIndex, endIndex);
                              try {
                                  const parsed = JSON.parse(rawJson);
                                  if (parsed.chartType && (parsed.chartType === 'bar' || parsed.chartType === 'pie' || parsed.chartType === 'radar')) {
                                      return { data: adaptChartData(parsed), raw: rawJson };
                                  }
                              } catch(e2) {}
                          }
                      }
                  }
              }
          }
          
          // Strategy B: Find JSON object starting with { and containing chartType
          const startIndex = text.indexOf('{');
          if (startIndex !== -1 && text.includes('"chartType"')) {
             // Find the matching closing brace more carefully
             let open = 0;
             let endIndex = -1;
             let inString = false;
             let escapeNext = false;
             
             for (let i = startIndex; i < text.length; i++) {
                 const char = text[i];
                 
                 if (escapeNext) {
                     escapeNext = false;
                     continue;
                 }
                 
                 if (char === '\\') {
                     escapeNext = true;
                     continue;
                 }
                 
                 if (char === '"' && !escapeNext) {
                     inString = !inString;
                     continue;
                 }
                 
                 if (!inString) {
                     if (char === '{') open++;
                     if (char === '}') {
                         open--;
                 if (open === 0) {
                     endIndex = i + 1;
                     break;
                 }
             }
                 }
             }
             
             if (endIndex !== -1) {
                 const rawJson = text.substring(startIndex, endIndex);
                 try {
                     const parsed = JSON.parse(rawJson);
                     if (parsed.chartType && (parsed.chartType === 'bar' || parsed.chartType === 'pie' || parsed.chartType === 'radar')) {
                         return { data: adaptChartData(parsed), raw: rawJson };
                     }
                 } catch(e) {}
             }
          }
      } else {
          // Found in code block
          const jsonString = jsonMatch[1];
          try {
          const parsed = JSON.parse(jsonString);
              if (parsed.chartType) {
          return { data: adaptChartData(parsed), raw: jsonMatch[0] };
      }
          } catch(e) {}
      }
    } catch (e) { 
      console.error('Chart parsing error:', e);
      return null; 
    }
    return null;
  };

  const adaptChartData = (parsed: any): ChartData => {
      // --- ADAPTER: Convert Chart.js style to Recharts style if needed ---
      if ((parsed.type === 'GPT' || parsed.type) && parsed.data && parsed.data.datasets) {
         // It looks like Chart.js format
         const labels = parsed.data.labels || [];
         const datasets = parsed.data.datasets || [];
         const transformedData = labels.map((label: string, i: number) => {
            const row: any = { name: label };
            datasets.forEach((ds: any) => {
               row[ds.label || 'Value'] = ds.data[i];
            });
            return row;
         });
         
         const chartType = parsed.type === 'GPT' ? 'bar' : (parsed.type === 'bar' ? 'bar' : parsed.type === 'pie' || parsed.type === 'doughnut' ? 'pie' : 'radar');

         return {
            title: parsed.options?.plugins?.title?.text || parsed.title || "Analysis Chart",
            description: parsed.description || parsed.options?.plugins?.subtitle?.text,
            chartType: chartType,
            data: transformedData,
            config: {
               xKey: "name",
               yKey: datasets[0]?.label || 'Value', // Default to first dataset
               nameKey: "name",
               valueKey: datasets[0]?.label || 'Value',
               colors: datasets.map((d: any) => d.backgroundColor || d.borderColor).flat()
            }
         };
      }
      
      // Handle direct format (already in Recharts format)
      // Ensure config has proper defaults
      if (parsed.chartType && parsed.data && Array.isArray(parsed.data)) {
          return {
              title: parsed.title || "Analysis Chart",
              description: parsed.description,
              chartType: parsed.chartType,
              data: parsed.data,
              config: {
                  xKey: parsed.config?.xKey || (parsed.data[0] ? Object.keys(parsed.data[0])[0] : 'name'),
                  yKey: parsed.config?.yKey || (parsed.data[0] ? Object.keys(parsed.data[0])[1] : 'value'),
                  nameKey: parsed.config?.nameKey || parsed.config?.xKey || (parsed.data[0] ? Object.keys(parsed.data[0])[0] : 'name'),
                  valueKey: parsed.config?.valueKey || parsed.config?.yKey || (parsed.data[0] ? Object.keys(parsed.data[0])[1] : 'value'),
                  colors: parsed.config?.colors || CHART_COLORS
              }
          };
      }
      
      return parsed as ChartData;
  }

  const parseThemesJSON = (text: string): { themes: VideoTheme[], selectionLogic?: string, raw: string } | null => {
    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
      if (!jsonMatch) {
          // Fallback for raw Themes JSON
          if (text.includes('"themes"') && text.includes('[')) {
             try {
                 const start = text.indexOf('{');
                 const end = text.lastIndexOf('}') + 1;
                 const raw = text.substring(start, end);
                 const parsed = JSON.parse(raw);
                 if (parsed.themes && Array.isArray(parsed.themes)) return { themes: parsed.themes, selectionLogic: parsed.selectionLogic, raw };
             } catch(e){}
          }
          return null;
      }
      const jsonString = jsonMatch[1] || jsonMatch[0];
      const raw = jsonMatch[0];
      const parsed = JSON.parse(jsonString);
      if (parsed.themes && Array.isArray(parsed.themes) && parsed.themes.length > 0) {
          return { themes: parsed.themes, selectionLogic: parsed.selectionLogic, raw };
      }
    } catch (e) { return null; }
    return null;
  };

  const handleGenerateThemes = async (city: string, strategy: string, dataContext: string): Promise<{ themes: VideoTheme[], selectionLogic?: string } | null> => {
      const prompt = `Generate 5 Hyper-Local Video Themes for ${city}. \n\nStrategic Context: "${strategy || "None provided."}" \n\nData Context: ${dataContext || "No specific data provided."}\n\nCRITICAL INSTRUCTION: You MUST use the provided Data Context points to identify regional nuances for ${city}. Return STRICTLY as a JSON object with a 'themes' array and a 'selectionLogic' string explaining why these themes were chosen based on the data. Ensure each theme object has 'title', 'rationale', 'emotionalHook', 'targetAudience', and a 'shortTag' (2-3 words summarizing the core anxiety/driver, e.g. "Cost Barriers").`;
      const token = localStorage.getItem('auth_token');
      if (!token) {
          console.error('Not authenticated — cannot generate themes');
          return null;
      }
      try {
          const system = getSystemInstruction(null, llmProvider);
          const msgs = buildAnthropicSidecarMessages(messagesRef.current as ChatUiMsg[], prompt);
          const { text: response, usage } = await completeLlmChat(system, msgs, 2, llmProvider);
          authAPI.reportUsage(usage).catch(() => {});
          const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/```\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
              return { themes: parsed.themes, selectionLogic: parsed.selectionLogic };
          }
      } catch (e) { console.error(e); }
      return null;
  };

  const handleGenerateScript = async (theme: VideoTheme, city: string): Promise<ScriptSegment[] | null> => {
      const prompt = `Write a segmented video script for theme: "${theme.title}". City: ${city}. Context: ${theme.rationale}. Keep it empathetic. \n\nCRITICAL: Provide detailed scene logic for 'visual'. Ensure each segment has a UNIQUE and distinct visual description to create a varied storyboard. The VO for 'audio' must be Indian accent, mixing English and Hindi. Return strictly as JSON object with 'segments' array.`;
      const token = localStorage.getItem('auth_token');
      if (!token) {
          console.error('Not authenticated — cannot generate script');
          return null;
      }
      try {
          const system = getSystemInstruction(null, llmProvider);
          const msgs = buildAnthropicSidecarMessages(messagesRef.current as ChatUiMsg[], prompt);
          const { text: response, usage } = await completeLlmChat(system, msgs, 2, llmProvider);
          authAPI.reportUsage(usage).catch(() => {});
          const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/```\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
              return parsed.segments;
          }
      } catch (e) { console.error(e); }
      return null;
  };
  
  const handleThemeSelect = (theme: VideoTheme) => {
    const prompt = `Generate a script for the theme: "${theme.title}". \nRationale: ${theme.rationale}\nAudience: ${theme.targetAudience}`;
    handleSend(prompt, false, false, true);
  };

  // ============================================
  // CONDITIONAL RENDERING (after all hooks)
  // ============================================
  
  // Show loading spinner while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-white to-rose-50">
        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // First-time login: must change password before using the app
  if (user.mustChangePassword) {
    return (
      <ChangePasswordPage
        currentUser={user}
        onSuccess={(updatedUser) => setUser(updatedUser)}
        onLogout={handleLogout}
      />
    );
  }

  // Show admin panel if admin and showAdmin is true
  if (user.role === 'admin' && showAdmin) {
    return <AdminPanel currentUser={user} onLogout={handleLogout} onBack={() => {
      setShowAdmin(false);
      // Trigger data reload when returning from admin panel (in case files were uploaded)
      setTimeout(() => {
        localStorage.setItem('dataNeedsReload', 'true');
        window.dispatchEvent(new Event('reloadData'));
      }, 300);
    }} />;
  }

  // ============================================
  // MAIN APP RENDERING
  // ============================================

  return (
    <div className="h-full min-h-screen bg-pink-50/20 font-sans text-slate-900 flex flex-col overflow-hidden selection:bg-pink-100 selection:text-pink-900">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-pink-100 shadow-sm transition-all">
        <div className="w-full max-w-[1920px] mx-auto px-6 h-20 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {/* Official INDIRA IVF Logo */}
              <IndiraLogo className="h-24" />
            </div>
            <div className="hidden md:flex bg-pink-50/50 p-1 rounded-xl border border-pink-100 ml-8">
               <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'dashboard' ? 'bg-white text-pink-700 shadow-sm border border-pink-100' : 'text-slate-500 hover:text-pink-600'}`}>Strategic Dashboard</button>
               <button onClick={() => setActiveTab('city_studio')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'city_studio' ? 'bg-white text-pink-700 shadow-sm border border-pink-100' : 'text-slate-500 hover:text-pink-600'}`}><Clapperboard size={14} /> City Content Studio</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50"
              title={`Answering with ${geminiModelLabel}`}
            >
              <span className="text-[11px] font-semibold tracking-wide text-blue-600">
                Gemini · {geminiModelLabel}
              </span>
            </div>
            <button 
              onClick={() => handleSend("Generate a 'Data Input Summary'. List all active datasets, categorize them by layer (Master, Operational Volume, Financial, Center MIS, Cluster & Strategic MIS), and identify any critical missing data based on the Data Dictionary.")}
              className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all active:scale-95 border border-slate-200 hover:border-pink-200 hover:text-pink-700"
            >
               <FileSearch size={16} />
               <span>Input Summary</span>
            </button>
            <button onClick={resetChat} className="group flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-pink-700 hover:bg-pink-50 transition-all active:scale-95 border border-pink-100 hover:border-pink-200"><RefreshCw size={16} className="group-hover:rotate-180 transition-transform duration-500" /><span>Reset Context</span></button>
            {user.role === 'admin' && (
              <button 
                onClick={() => setShowAdmin(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-blue-700 hover:bg-blue-50 transition-all active:scale-95 border border-blue-100 hover:border-blue-200"
              >
                <Users size={16} />
                <span>Admin</span>
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-2 rounded-full text-sm text-gray-600 border border-gray-200 bg-gray-50">
              <User size={14} />
              <span className="hidden md:inline">{user.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-red-600 hover:bg-red-50 transition-all active:scale-95 border border-red-100 hover:border-red-200"
            >
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-6 pt-6 pb-2 flex flex-col gap-6 min-h-0 overflow-hidden">
        {activeTab === 'city_studio' ? (
           <CityContentStudio 
              onGenerateThemes={handleGenerateThemes}
              onGenerateScript={handleGenerateScript}
              isLoading={isTyping}
              dataContext={Object.values(layerData).join('\n').substring(0, 10000)}
           />
        ) : (
           <div className="grid grid-cols-1 xl:grid-cols-12 grid-rows-1 gap-6 h-full min-h-0 flex-1 animate-in fade-in duration-500">
              {/* Strategic Nexus & Chat (full width) */}
              <div className="xl:col-span-12 flex flex-col gap-3 h-full min-h-0 overflow-hidden flex-1">
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="p-2 bg-purple-100 rounded-lg text-purple-700"><Compass size={20} /></div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 leading-none">Strategic Nexus</h2>
                        <p className="text-xs text-slate-500 font-medium mt-1 flex items-center gap-2 flex-wrap">
                          AI-Driven Insights & Simulation
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                            {geminiModelLabel}
                          </span>
                        </p>
                    </div>
                  </div>

                  {/* Main Chat Interface */}
                  <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative w-full">
                      
                      {/* Chat Messages */}
                      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 bg-slate-50/30 scrollbar-hide">
                          {(messages || []).filter((msg): msg is { role: 'user' | 'model' | 'error'; text: string; type?: 'text' | 'simulation'; artifact?: { downloadId: string; fileName: string } } => msg != null && typeof (msg as { text?: unknown })?.text === 'string').map((msg, idx) => {
                              // Parsing data once
                              const chartData = parseChartJSON(msg.text);
                              const themesData = parseThemesJSON(msg.text);
                              
                              // Clean text logic: Remove raw JSON blocks if widgets are found
                              let displayContent = msg.text;
                              if (chartData && chartData.raw) {
                                  // Remove JSON from display - handle both code blocks and raw JSON
                                  displayContent = displayContent.replace(chartData.raw, '');
                                  // Also remove markdown code blocks if present
                                  displayContent = displayContent.replace(/```(?:json)?\s*\{[\s\S]*?"chartType"[\s\S]*?\}\s*```/g, '');
                                  // Clean up any extra whitespace/newlines
                                  displayContent = displayContent.replace(/\n{3,}/g, '\n\n').trim();
                              }
                              if (themesData && themesData.raw) {
                                  displayContent = displayContent.replace(themesData.raw, '');
                              }

                              return (
                              <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                                 <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-gradient-to-br from-slate-700 to-slate-900 text-white' : (msg.role === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gradient-to-br from-pink-500 to-rose-600 text-white')}`}>
                                     {msg.role === 'user' ? <User size={16} /> : (msg.role === 'error' ? <AlertTriangle size={16} /> : <Bot size={16} />)}
                                 </div>
                                 <div className={`flex flex-col max-w-[95%] gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                     <div className={`rounded-2xl p-5 shadow-sm 
                                        ${msg.role === 'user' 
                                            ? 'bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-tr-sm shadow-md' 
                                            : (msg.role === 'error' 
                                                ? 'bg-red-50 text-red-900 border border-red-200 rounded-tl-sm' 
                                                : 'bg-white/95 border border-pink-100/50 text-slate-700 rounded-tl-sm ring-1 ring-slate-900/5 backdrop-blur-sm')
                                        }
                                     `}>
                                         {msg.type === 'simulation' ? (
                                             parseSimulationJSON(msg.text) ? (
                                                 <SimulationWidget data={parseSimulationJSON(msg.text)!} />
                                             ) : (
                                                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={safeRenderMarkdown(msg.text)} />
                                             )
                                         ) : (
                                             <>
                                                <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert text-slate-100' : ''}`} dangerouslySetInnerHTML={safeRenderMarkdown(displayContent)} />
                                                {/* Check for Charts */}
                                                {chartData && (
                                                    <div className="mt-6 w-full max-w-3xl mx-auto animate-in fade-in duration-500">
                                                        <BiChartsWidget data={chartData.data} />
                                                    </div>
                                                )}
                                                {/* Check for Themes */}
                                                {themesData && (
                                                    <div className="mt-6 w-full animate-in fade-in duration-500">
                                                        <ThemesWidget 
                                                            themes={themesData.themes} 
                                                            logic={themesData.selectionLogic}
                                                            onThemeSelect={(t) => handleThemeSelect(t)}
                                                        />
                                                    </div>
                                                )}
                                                {/* Downloadable artifact (deck/workbook/report/pdf). Replaces the
                                                    raw ```artifact``` JSON which was stripped from the message text. */}
                                                {msg.artifact && (
                                                    <div className="mt-4 animate-in fade-in duration-500">
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    await downloadArtifact(msg.artifact!.downloadId, msg.artifact!.fileName);
                                                                } catch (e: any) {
                                                                    alert(`Download failed: ${e?.message || e}`);
                                                                }
                                                            }}
                                                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 shadow-md shadow-pink-200 transition-all active:scale-95"
                                                            title={`Download ${msg.artifact.fileName}`}
                                                        >
                                                            <Download size={16} />
                                                            <span>Download {msg.artifact.fileName}</span>
                                                        </button>
                                                    </div>
                                                )}
                                             </>
                                         )}
                                     </div>
                                 </div>
                              </div>
                          )})}
                          {isTyping && (
                              <div className="flex gap-4 animate-pulse">
                                  <div className="w-8 h-8 rounded-full bg-pink-50 text-pink-400 flex items-center justify-center"><Bot size={16} /></div>
                                  <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-6 py-4 text-slate-400 text-xs font-medium flex items-center gap-2 shadow-sm">
                                      <Loader2 size={14} className="animate-spin" /> 
                                      {retryCount > 0 ? `Retrying connection (Attempt ${retryCount})...` : "Processing 5-Layer Intelligence..."}
                                  </div>
                              </div>
                          )}
                          <div ref={messagesEndRef} />
                      </div>

                      {/* Simulation Bar (Embedded in Chat) */}
                      <div className="flex-shrink-0 px-6 pb-2 pt-2 bg-gradient-to-b from-transparent to-white border-t border-slate-50 w-full">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-2 px-1">
                              <Zap size={12} className="text-amber-400" />
                              <span>Simulation Mode</span>
                          </div>
                          <div className="relative group">
                             <div className="absolute inset-0 bg-gradient-to-r from-amber-200 to-amber-100 rounded-xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
                             <input 
                                type="text" 
                                value={simInput}
                                onChange={(e) => setSimInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && simInput.trim() && handleSend(simInput, true)}
                                placeholder="What if we increased ad spend in Pune by 20%? (Analyzes: Top/Bottom Growth, CX, Risks)"
                                className="w-full relative bg-white border border-slate-200 text-slate-700 text-sm rounded-xl px-4 py-4 pr-32 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/10 transition-all shadow-sm placeholder-slate-400 font-medium"
                             />
                             <button 
                                onClick={() => handleSend(simInput, true)}
                                disabled={!simInput.trim() && !isTyping}
                                className="absolute right-2 top-2 bottom-2 px-4 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1 disabled:opacity-50 shadow-md shadow-amber-200"
                             >
                                Simulate
                             </button>
                          </div>
                      </div>

                      {/* Main Input Area */}
                      <div className="flex-shrink-0 p-4 bg-white border-t border-slate-100 w-full">
                          <div className="flex gap-3 items-end">
                              <button 
                                 onClick={() => chatFileInputRef.current?.click()}
                                 className="p-4 text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-xl transition-all border border-slate-100 hover:border-pink-100"
                                 title="Attach Ad-hoc Files"
                              >
                                 <Paperclip size={20} />
                              </button>
                              <input type="file" multiple ref={chatFileInputRef} className="hidden" onChange={handleChatFileSelect} />
                              
                              <div className="flex-1 relative">
                                <textarea
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder="Ask a strategic question about your data layers..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 pr-12 focus:outline-none focus:border-pink-500 focus:bg-white transition-all placeholder-slate-400 text-sm resize-none min-h-[56px] max-h-[120px]"
                                    rows={1}
                                />
                              </div>
                              
                              <button 
                                  onClick={() => handleSend()}
                                  disabled={!input.trim() && chatAttachments.length === 0}
                                  className="p-4 bg-gradient-to-r from-pink-600 to-rose-600 text-white rounded-xl hover:shadow-lg hover:shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                              >
                                  <Send size={20} />
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
           </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);