/* ============================================================
   api.js — cliente para el backend (Google Apps Script)
   ============================================================ */

// ⚠️ Pega aquí la URL de tu despliegue de Apps Script (acaba en /exec)
const CONFIG = {
  API_URL: "PEGA_AQUI_LA_URL_DE_TU_APPS_SCRIPT_/exec"
};

/**
 * Llama a una acción de solo lectura (GET, sin token).
 *
 * El parámetro _t (timestamp) cambia en cada llamada, haciendo que la URL
 * sea única y el navegador nunca encuentre una respuesta cacheada.
 * No usamos cache:"no-store" porque en peticiones cross-origin algunos
 * navegadores añaden una cabecera Cache-Control que convierte la petición
 * en una preflight CORS — y Apps Script no responde a OPTIONS.
 */
async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("_t", Date.now());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: "GET" });
  return res.json();
}

/**
 * Llama a una acción que escribe datos o requiere token (POST).
 * Se usa Content-Type: text/plain a propósito para evitar el
 * preflight CORS que Apps Script no sabe responder.
 */
async function apiPost(action, payload = {}) {
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
