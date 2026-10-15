import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { en } from "./en";
import { zh } from "./zh";

export type Lang = "zh" | "en";

function detect(): Lang {
  try {
    const saved = localStorage.getItem("folio.lang");
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: detect(),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language === "zh" ? "zh-CN" : "en";

export function setLang(lang: Lang) {
  i18n.changeLanguage(lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  try {
    localStorage.setItem("folio.lang", lang);
  } catch {}
}

export function currentLang(): Lang {
  return i18n.language === "en" ? "en" : "zh";
}

export { useTranslation };
export default i18n;
