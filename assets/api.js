/* ============================================================
   api.js — cliente para el backend (Google Apps Script)
   ============================================================ */

// ⚠️ Pega aquí la URL de tu despliegue de Apps Script (acaba en /exec)
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbxhhvUurI9HkOVdeTsnysuYmItIqmVHUcEUL3TajS6L6vIB5XWqQoDw3wKPFVjVOTAp/exec"
};

/**
 * Llama a una acción de solo lectura (GET, sin token).
 *
 * - _t=Date.now() cambia la URL en cada llamada: el navegador nunca
 *   devuelve una respuesta cacheada aunque no enviemos cabeceras extra.
 * - NO usamos cache:"no-store" porque en peticiones cross-origin Chrome
 *   y Firefox añaden una cabecera Cache-Control que activa un preflight
 *   CORS, y Apps Script no responde a OPTIONS → fallo silencioso.
 * - NUNCA lanza excepción: si algo falla devuelve { ok:false, error }.
 */
async function apiGet(action, params = {}) {
  try {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("_t", Date.now());
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: "GET" });
    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, error: "Error de red (" + err.message + "). Comprueba tu conexión." };
  }
}

/**
 * Llama a una acción que escribe datos o requiere token (POST).
 * Content-Type: text/plain evita el preflight CORS de Apps Script.
 * NUNCA lanza excepción: si algo falla devuelve { ok:false, error }.
 */
async function apiPost(action, payload = {}) {
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, error: "Error de red (" + err.message + "). Comprueba tu conexión." };
  }
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
