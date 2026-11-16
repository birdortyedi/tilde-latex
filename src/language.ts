import { withoutComment } from './latex';
import type { ProjectFile } from './projects';

// The language a document is written in, from babel or polyglossia, so the
// browser's spell checker can use it. As a language code like "de" or "en-GB".

const CODES: Record<string, string> = {
  english: 'en', american: 'en-US', USenglish: 'en-US', usenglish: 'en-US', british: 'en-GB', UKenglish: 'en-GB', ukenglish: 'en-GB',
  canadian: 'en-CA', australian: 'en-AU', newzealand: 'en-NZ',
  german: 'de', ngerman: 'de', naustrian: 'de-AT', austrian: 'de-AT', nswissgerman: 'de-CH', swissgerman: 'de-CH',
  french: 'fr', francais: 'fr', acadian: 'fr-CA', canadien: 'fr-CA',
  spanish: 'es', catalan: 'ca', galician: 'gl', basque: 'eu', italian: 'it', portuguese: 'pt', portuges: 'pt', brazil: 'pt-BR',
  brazilian: 'pt-BR', dutch: 'nl', afrikaans: 'af', danish: 'da', swedish: 'sv', norsk: 'nb', norwegian: 'nb', nynorsk: 'nn',
  finnish: 'fi', icelandic: 'is', estonian: 'et', latvian: 'lv', lithuanian: 'lt', polish: 'pl', czech: 'cs', slovak: 'sk',
  slovene: 'sl', slovenian: 'sl', croatian: 'hr', serbian: 'sr', bulgarian: 'bg', russian: 'ru', ukrainian: 'uk', belarusian: 'be',
  greek: 'el', turkish: 'tr', hungarian: 'hu', magyar: 'hu', romanian: 'ro', albanian: 'sq', irish: 'ga', welsh: 'cy',
  hebrew: 'he', arabic: 'ar', persian: 'fa', farsi: 'fa', hindi: 'hi', indonesian: 'id', bahasa: 'id', malay: 'ms',
  vietnamese: 'vi', thai: 'th', japanese: 'ja', korean: 'ko', chinese: 'zh', esperanto: 'eo', latin: 'la',
};

const code = (file: ProjectFile): string =>
  (typeof file.content === 'string' ? file.content : '').split('\n').map(withoutComment).join('\n');

// The last option of a list that names a language: babel's main language is the last one.
function lastLanguage(options: string): string | null {
  const names = options.split(',').map((o) => o.trim());
  const main = names.map((o) => /^main\s*=\s*(\w+)$/.exec(o)?.[1]).find(Boolean);
  if (main && CODES[main]) return CODES[main];
  for (const name of names.reverse()) if (CODES[name]) return CODES[name];
  return null;
}

export function documentLanguage(files: ProjectFile[]): string | null {
  const sources = files.filter((f) => /\.(tex|sty|cls)$/.test(f.path)).map(code);
  for (const source of sources) {
    const polyglossia = /\\set(?:main|default)language\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}/.exec(source);
    if (polyglossia) {
      const variant = /variant\s*=\s*(\w+)/.exec(polyglossia[1] ?? '')?.[1];
      return (variant && CODES[variant]) || CODES[polyglossia[2]] || null;
    }
  }
  for (const source of sources) {
    for (const [, options, names] of source.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g)) {
      if (!names.split(',').some((n) => n.trim() === 'babel')) continue;
      const own = options ? lastLanguage(options) : null;
      if (own) return own;
      // \documentclass[ngerman]{article} and then \usepackage{babel}: babel takes the class's options.
      const global = sources.map((s) => /\\documentclass\s*\[([^\]]*)\]/.exec(s)?.[1]).find(Boolean);
      return global ? lastLanguage(global) : null;
    }
  }
  return null;
}
