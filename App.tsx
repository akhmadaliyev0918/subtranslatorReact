import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { UploadSection } from './components/UploadSection';
import { SettingsSection } from './components/SettingsSection';
import { ResultsSection } from './components/ResultsSection';
import { PreviewModal } from './components/PreviewModal';
import { HistoryModal } from './components/HistoryModal';
import { FileItem, AppStep, TranslationHistoryItem, ParsedSubtitle } from './types';
import { readFileAsText, parseSubtitles, reconstructSubtitles } from './services/subtitleUtils';
import { translateBatch } from './services/geminiService';

const App: React.FC = () => {
  // --- State ---
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  
  // Settings State
  const [sourceLang, setSourceLang] = useState('English');
  const [targetLang, setTargetLang] = useState('Uzbek');
  const [prompt, setPrompt] = useState('');
  const [removeSDH, setRemoveSDH] = useState(false);

  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingFile, setCurrentProcessingFile] = useState('');
  
  // Modals
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);

  // --- Effects ---
  useEffect(() => {
    // Theme
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    // History
    const savedHistory = localStorage.getItem('translationHistory');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const newVal = !prev;
      if (newVal) {
        document.documentElement.classList.add('dark');
        localStorage.theme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.theme = 'light';
      }
      return newVal;
    });
  };

  const addToHistory = (file: FileItem) => {
    const newItem: TranslationHistoryItem = {
      id: Date.now().toString(),
      filename: file.file.name,
      from: sourceLang,
      to: targetLang,
      date: new Date().toLocaleString()
    };
    const newHistory = [newItem, ...history].slice(0, 20);
    setHistory(newHistory);
    localStorage.setItem('translationHistory', JSON.stringify(newHistory));
  };

  // --- Logic ---
  const handleStartProcessing = async () => {
    if (files.length === 0) return;
    if (sourceLang === targetLang) {
      alert("Manba va maqsad tillari bir xil bo'lmasligi kerak");
      return;
    }

    setStep(AppStep.RESULTS);
    setIsProcessing(true);
    setProgress(0);

    const totalFiles = files.length;

    // Process each file sequentially
    for (let i = 0; i < totalFiles; i++) {
      const fileItem = files[i];
      setCurrentProcessingFile(fileItem.file.name);
      
      // Update local file status to processing
      setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'processing' } : f));

      try {
        // 1. Read File
        const text = await readFileAsText(fileItem.file);
        
        // 2. Parse
        let parsed: ParsedSubtitle[] = parseSubtitles(text);
        
        // 3. Optional: Remove SDH
        if (removeSDH) {
           parsed.forEach(p => {
               if(p.text) {
                   p.text = p.text.replace(/\[.*?\]|\(.*?\)/g, '').trim();
               }
           });
        }

        // 4. Translate Chunks (Concurrent Batching)
        // Gemini 3 Flash is fast and has large context.
        // We can use a larger batch size and run multiple requests in parallel.
        const BATCH_SIZE = 100; 
        const CONCURRENT_LIMIT = 5; // Number of parallel requests

        const validSubtitles = parsed.filter(p => !p.isHeader && !p.isMalformed && p.text.trim().length > 0);
        
        // Prepare all batches first
        const batches: ParsedSubtitle[][] = [];
        for (let j = 0; j < validSubtitles.length; j += BATCH_SIZE) {
            batches.push(validSubtitles.slice(j, j + BATCH_SIZE));
        }

        let completedSubtitlesCount = 0;
        
        // Helper to process a single batch
        const processBatch = async (batch: ParsedSubtitle[]) => {
             const batchTexts = batch.map(s => s.text);
             try {
                 const translatedBatch = await translateBatch(batchTexts, sourceLang, targetLang, prompt);
                 batch.forEach((sub, idx) => {
                     sub.text = translatedBatch[idx] || sub.text; 
                 });
             } catch (error) {
                 console.error("Batch translation failed, keeping original", error);
             } finally {
                 completedSubtitlesCount += batch.length;
                 // Calculate progress: 
                 const fileProgress = completedSubtitlesCount / validSubtitles.length;
                 // Overall progress calculation
                 const globalProgress = ((i + fileProgress) / totalFiles) * 100;
                 setProgress(Math.min(globalProgress, 99)); // Cap at 99 until done
             }
        };

        // Execute batches with concurrency control
        for (let k = 0; k < batches.length; k += CONCURRENT_LIMIT) {
             const chunk = batches.slice(k, k + CONCURRENT_LIMIT);
             // Run 'chunk' size requests in parallel and wait for them to finish
             await Promise.all(chunk.map(batch => processBatch(batch)));
        }

        // 5. Reconstruct
        const finalText = reconstructSubtitles(parsed, fileItem.file.name);
        
        // 6. Update State & History
        const updatedItem: FileItem = {
            ...fileItem,
            status: 'done',
            originalText: text,
            translatedText: finalText,
            wordCount: finalText.split(/\s+/).length
        };

        setFiles(prev => prev.map(f => f.id === fileItem.id ? updatedItem : f));
        addToHistory(updatedItem);

      } catch (e: any) {
        console.error(e);
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'error', error: e.message } : f));
      }
    }

    setIsProcessing(false);
    setProgress(100);
  };

  // --- Render ---
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar 
        isDarkMode={isDarkMode} 
        toggleTheme={toggleTheme} 
        onHistoryClick={() => setHistoryOpen(true)}
      />

      <main className="flex-grow container mx-auto px-4 py-8 max-w-5xl">
        <div className="bg-white dark:bg-dark-card rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700 transition-colors duration-300">
          
          {/* Steps Indicator */}
          <div className="bg-gray-50 dark:bg-gray-800/50 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center text-sm font-medium">
             {[1, 2, 3].map(s => (
                <React.Fragment key={s}>
                    <div className={`flex items-center gap-2 ${step >= s ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        <span className={`w-6 h-6 flex items-center justify-center rounded-full ${step >= s ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-200 dark:bg-gray-700'}`}>
                            {s}
                        </span>
                        <span className="hidden sm:inline">
                            {s === 1 ? 'Yuklash' : s === 2 ? 'Sozlamalar' : 'Natija'}
                        </span>
                    </div>
                    {s < 3 && <div className="h-px w-8 sm:w-12 bg-gray-300 dark:bg-gray-600"></div>}
                </React.Fragment>
             ))}
          </div>

          <div className="p-6 md:p-8">
            {step === AppStep.UPLOAD && (
                <UploadSection 
                    files={files} 
                    setFiles={setFiles} 
                    onNext={() => setStep(AppStep.SETTINGS)} 
                />
            )}
            
            {step === AppStep.SETTINGS && (
                <SettingsSection 
                    onBack={() => setStep(AppStep.UPLOAD)}
                    onStart={handleStartProcessing}
                    sourceLang={sourceLang} setSourceLang={setSourceLang}
                    targetLang={targetLang} setTargetLang={setTargetLang}
                    prompt={prompt} setPrompt={setPrompt}
                    removeSDH={removeSDH} setRemoveSDH={setRemoveSDH}
                />
            )}

            {step === AppStep.RESULTS && (
                <ResultsSection 
                    files={files}
                    progress={progress}
                    currentFile={currentProcessingFile}
                    isProcessing={isProcessing}
                    onRestart={() => {
                        setFiles([]);
                        setStep(AppStep.UPLOAD);
                    }}
                    onPreview={setPreviewFile}
                />
            )}
          </div>
        </div>

        <footer className="text-center mt-8 text-sm text-gray-500">
            <p>&copy; 2025 AI Subtitle Pro. Powered by Google Gemini 3 Flash.</p>
        </footer>
      </main>

      <PreviewModal 
        file={previewFile} 
        onClose={() => setPreviewFile(null)} 
      />

      <HistoryModal 
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        onClear={() => {
            setHistory([]);
            localStorage.removeItem('translationHistory');
        }}
      />
    </div>
  );
};

export default App;