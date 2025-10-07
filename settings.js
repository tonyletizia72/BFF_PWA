// settings.js — Boxing for Fitness (Production)
window.SETTINGS = {
  // Webhook for your live Apps Script deployment (public /exec URL)
  WEBHOOK_URL:
    "https://script.google.com/macros/s/AKfycbxd7Do-Rqa_Lfp4LZNQlUZRqCVn2hOHTygm87HNkds5BSZw9953s-2OQV7hnHumZfIXGQ/exec",

  // Must match SECRET in your Code.gs
  SECRET: "BFF"
};

console.log("[BFF] SETTINGS loaded:", window.SETTINGS.WEBHOOK_URL);
