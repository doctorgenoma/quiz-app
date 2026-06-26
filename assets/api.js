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
 * cache: "no-store"  — impide que el navegador devuelva una respuesta
 * cacheada del poll anterior (causa de que el jugador se quedara
 * bloqueado en la pregunta anterior sin poder avanzar).
 * El parámetro _t es un sello de tiempo adicional por si algún proxy
 * intermedio ignora la cabecera Cache-Control.
 */
async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("_t", Date.now());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store"
  });
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
