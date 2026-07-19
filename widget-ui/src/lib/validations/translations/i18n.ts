import { de } from './validations.de';
import { en } from './validations.en'
import { es } from './validations.es';
import { fr } from './validations.fr';
import { it } from './validations.it';
import { nl } from './validations.nl';

const catalogs = { "EN": en, "NL": nl, "FR": fr, "DE": de, "ES": es, "IT": it };
let currentLang: keyof typeof catalogs = "NL";

export function setPersistentValidationsLanguage(lang: "EN" | "NL" | "FR" | "DE" | "IT" | "ES") {
  currentLang = lang;
}

function get(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

export function t(key: string, params?: Record<string, any>): string {
  const template = get(catalogs[currentLang], key);
  if (typeof template !== "string") return key;

  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}
