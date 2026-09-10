import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zh from './locales/zh.json';

i18n
  .use(LanguageDetector) // Automatically detects user browser language
  .use(initReactI18next) 
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh }
    },
    fallbackLng: 'en', // Use English if a translation is missing
    interpolation: { escapeValue: false } 
  });

export default i18n;