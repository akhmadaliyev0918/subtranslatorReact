export interface ParsedSubtitle {
  id?: string;
  timestamp?: string; // For SRT/VTT
  text: string;
  isHeader?: boolean;
  isMalformed?: boolean;
}

export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'error';

export interface FileItem {
  id: string;
  file: File;
  status: ProcessingStatus;
  originalText: string;
  translatedText: string | null;
  error: string | null;
  wordCount: number;
}

export interface TranslationHistoryItem {
  id: string;
  filename: string;
  from: string;
  to: string;
  date: string;
}

export enum AppStep {
  UPLOAD = 1,
  SETTINGS = 2,
  RESULTS = 3
}

export const LANGUAGES = [
  { code: 'Uzbek', label: "O'zbek" },
  { code: 'English', label: "Ingliz" },
  { code: 'Russian', label: "Rus" },
  { code: 'Spanish', label: "Ispan" },
  { code: 'French', label: "Fransuz" },
  { code: 'German', label: "Nemis" },
  { code: 'Turkish', label: "Turk" },
  { code: 'Korean', label: "Koreys" },
  { code: 'Japanese', label: "Yapon" },
  { code: 'Chinese', label: "Xitoy" },
];