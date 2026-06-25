/* ============================================================
   play.js — vista del concursante
   ============================================================ */

const app  = document.getElementById("app");
const slug = getQueryParam("c");

const state = {
  jugador:          null,   // {concursanteId, nombre}
  ultimoEstado:     null,   // snapshot del último render para detectar cambios
  pollTimer:        null,
  errorCount:       0       // para backoff en fallos de red
};

const POLL_NORMAL_MS  = 2500;
const POLL_ERROR_BASE = 4000;
const POLL_ERROR_MAX  = 20000;

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function keyJugador()    { return "qa_player_"  + slug; }
function keyRespuestas() { return "qa_answers_" + slug; }

function cargarJugador()  { const r = localStorage.getItem(keyJugador()); state.jugador = r ? JSON.parse(r) : null; }
function guardarJugador(j){ state.jugador = j; localStorage.setItem(keyJugador(), JSON.stringify(j)); }
function respuestasGuardadas() { return JSON.parse(localStorage.getItem(keyRespuestas()) || "{}"); }
function guardarRespuesta(preguntaId, opcion) {
  const r = respuestasGuardadas(); r[preguntaId] = opcion;
  localStorage.setItem(keyRespuestas(), JSON.stringify(r));
}

function detenerPoll() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

/* ============================================================
   WALLPAPER — gestiona #bg-wall y #bg-vignette en el DOM
   ============================================================ */

let _wallUrl = null; // url activa para evitar reasignar si no cambió

function setWallpaper(url) {
  if (!url) { clearWallpaper(); return; }

  // Crear los divs la primera vez
  let wall = document.getElementById("bg-wall");
  if (!wall) {
    wall = document.createElement("div");
    wall.id = "bg-wall";
    document.body.prepend(wall);
  }
  let vig = document.getElementById("bg-vignette");
  if (!vig) {
    vig = document.createElement("div");
    vig.id = "bg-vignette";
    document.body.prepend(vig);
  }

  // Solo actualiza la imagen si cambió (evita reflow innecesario)
  if (_wallUrl !== url) {
    _wallUrl = url;
    // Precargar antes de mostrar para evitar parpadeo
    const img = new Image();
    img.onload = () => {
      wall.style.backgroundImage = `url("${url}")`;
      requestAnimationFrame(() => {
        wall.classList.add("visible");
        vig.classList.add("visible");
      });
    };
    img.src = url;
  }

  document.body.classList.add("has-wall");
}

function clearWallpaper() {
  _wallUrl = null;
  document.body.classList.remove("has-wall");
  const wall = document.getElementById("bg-wall");
  const vig  = document.getElementById("bg-vignette");
  if (wall) { wall.classList.remove("visible"); }
  if (vig)  { vig.classList.remove("visible"); }
}

function cabeceraConcurso(nombre, logoUrl) {
  return `<div class="concurso-header">
    ${logoUrl ? `<img class="concurso-header__logo" src="${escapeHtml(logoUrl)}" alt="" />` : ""}
    <h1>${escapeHtml(nombre)}</h1>
  </div>`;
}

function shell(contenido) {
  app.innerHTML = `
    <div class="brand"><span class="brand__mark">QUIZ EN VIVO</span><span class="brand__sub">Concursante</span></div>
    ${contenido}
    <footer class="foot">QUIZ EN VIVO</footer>`;
}

/* ---------------- arranque ---------------- */

async function iniciar() {
  if (!slug) { shell(`<div class="errorbox">Falta el enlace del concurso.</div>`); return; }
  cargarJugador();
  if (!state.jugador) return mostrarUnirse();
  empezarPoll();
}

/* ---------------- unirse ---------------- */

async function mostrarUnirse() {
  const r = await apiGet("estadoPublico", { slug });
  if (!r.ok) { shell(`<div class="errorbox">${escapeHtml(r.error)}</div>`); return; }

  setWallpaper(r.logoUrl);
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <p class="muted">Escribe tu nombre para unirte al concurso.</p>
    <form id="f-unirse" class="card">
      <label>Tu nombre</label>
      <input type="text" id="ju-nombre" maxlength="40" required autofocus />
      <div id="ju-error"></div>
      <button class="btn btn--gold btn--block" style="margin-top:16px;" type="submit">Unirme</button>
    </form>`);

  document.getElementById("f-unirse").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nombre = document.getElementById("ju-nombre").value.trim();
    const errBox = document.getElementById("ju-error");
    if (!nombre) return;
    const rr = await apiPost("registrarConcursante", { slug, nombre });
    if (!rr.ok) { errBox.innerHTML = `<div class="errorbox">${escapeHtml(rr.error)}</div>`; return; }
    guardarJugador({ concursanteId: rr.concursanteId, nombre: rr.nombre });
    if (rr.reconectado) {
      errBox.innerHTML = `<div class="okbox">¡Bienvenido de vuelta, ${escapeHtml(rr.nombre)}! Reconectando…</div>`;
      setTimeout(empezarPoll, 900);
    } else {
      empezarPoll();
    }
  });
}

/* ============================================================
   BUCLE DE JUEGO — con skip de render si nada cambió
   ============================================================ */

function empezarPoll() {
  pintarEstado();
  state.pollTimer = setInterval(pintarEstado, POLL_NORMAL_MS);
}

function claveEstado(r) {
  // Cadena mínima que identifica si la pantalla debe cambiar
  if (!r) return "";
  const pid = r.pregunta ? r.pregunta.id : "null";
  const ya  = r.pregunta ? (respuestasGuardadas()[r.pregunta.id] !== undefined ? "1" : "0") : "0";
  return `${r.estado}|${r.indicePregunta}|${pid}|${ya}`;
}

async function pintarEstado() {
  let r;
  try {
    r = await apiGet("estadoPublico", { slug });
  } catch (e) {
    // Error de red: backoff exponencial, no tocar la UI
    state.errorCount++;
    detenerPoll();
    const delay = Math.min(POLL_ERROR_BASE * state.errorCount, POLL_ERROR_MAX);
    state.pollTimer = setTimeout(pintarEstado, delay);
    return;
  }

  if (!r.ok) {
    clearWallpaper();
    shell(`<div class="errorbox">${escapeHtml(r.error)}</div>`);
    detenerPoll();
    return;
  }

  state.errorCount = 0;

  // ── Skip si la pantalla no necesita cambiar ──
  const clave = claveEstado(r);
  if (clave === state.ultimoEstado) return;
  state.ultimoEstado = clave;

  if (r.estado === "borrador")    return pintarEspera(r);
  if (r.estado === "finalizado")  { detenerPoll(); return pintarFinal(); }
  pintarPregunta(r);
}

/* ---------------- pantallas individuales ---------------- */

function pintarEspera(r) {
  setWallpaper(r.logoUrl);
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <p>Hola, <strong>${escapeHtml(state.jugador.nombre)}</strong> 👋</p>
    <p class="pulse">Esperando a que el anfitrión empiece el concurso…</p>`);
}

function pintarPregunta(r) {
  const p           = r.pregunta;
  if (!p) { shell(`<p class="pulse">Preparando la siguiente pregunta…</p>`); return; }

  setWallpaper(r.logoUrl);

  const respuestas   = respuestasGuardadas();
  const yaRespondida = respuestas[p.id] !== undefined;

  // Calcular tiempo restante para mostrar la barra (solo lectura local, sin llamadas extra)
  const timerSegs = Number(r.timerSegundos) || 0;
  const mostrarTimer = timerSegs > 0 && r.preguntaIniciadaEn && !yaRespondida;

  shell(`
    <div class="row small muted">
      <span>${r.logoUrl ? `<img class="logo-mini-inline" src="${escapeHtml(r.logoUrl)}" alt="" />` : ""}
            Pregunta ${r.indicePregunta + 1} / ${r.totalPreguntas}</span>
      <span>${escapeHtml(state.jugador.nombre)}</span>
    </div>
    ${mostrarTimer ? `
    <div class="timer-track" style="margin:10px 0 4px;">
      <div class="timer-bar" id="play-barra"></div>
    </div>
    <div class="row" style="margin-bottom:6px;">
      <span></span><span class="muted small" id="play-segs"></span>
    </div>` : ""}
    <h2 style="margin-top:6px;">${escapeHtml(p.texto)}</h2>
    <div class="opciones" id="opciones">
      ${["A","B","C","D"].map(L => `
        <button class="opcion ${yaRespondida && respuestas[p.id] === L ? "opcion--elegida" : ""}"
                data-letra="${L}" ${yaRespondida ? "disabled" : ""}>
          <span class="opcion__letra">${L}</span>
          <span>${escapeHtml(p["opcion" + L])}</span>
        </button>`).join("")}
    </div>
    ${yaRespondida
      ? `<div class="okbox" style="margin-top:16px;">Respuesta enviada. Esperando la siguiente pregunta…</div>`
      : `<p class="muted small" style="margin-top:14px;">Elige una opción. Solo cuenta tu primera respuesta.</p>`}`);

  // Cuenta regresiva local en MM:SS (sin llamadas extra al servidor)
  if (mostrarTimer) {
    const fin = new Date(r.preguntaIniciadaEn).getTime() + timerSegs * 1000;
    const barra  = document.getElementById("play-barra");
    const segsEl = document.getElementById("play-segs");
    const tick = setInterval(() => {
      const restante  = Math.max(0, fin - Date.now());
      const totalSegs = Math.ceil(restante / 1000);
      const mm  = String(Math.floor(totalSegs / 60)).padStart(2, "0");
      const ss  = String(totalSegs % 60).padStart(2, "0");
      const pct = (restante / (timerSegs * 1000)) * 100;
      if (barra) {
        barra.style.width = pct + "%";
        barra.className   = "timer-bar" +
          (pct < 10 ? " timer-bar--urgent" : pct < 30 ? " timer-bar--warning" : "");
      }
      if (segsEl) segsEl.textContent = mm + ":" + ss;
      if (restante <= 0) clearInterval(tick);
    }, 500);
    const observer = new MutationObserver(() => { clearInterval(tick); observer.disconnect(); });
    observer.observe(document.getElementById("app"), { childList: true });
  }

  if (!yaRespondida) {
    document.querySelectorAll("#opciones .opcion").forEach(btn => btn.addEventListener("click", async () => {
      document.querySelectorAll("#opciones .opcion").forEach(b => b.disabled = true);
      const opcion = btn.dataset.letra;
      guardarRespuesta(p.id, opcion);
      state.ultimoEstado = null;

      const rr = await apiPost("enviarRespuesta",
        { slug, concursanteId: state.jugador.concursanteId, preguntaId: p.id, opcion });
      if (!rr.ok && !/ya has respondido/i.test(rr.error)) {
        console.warn("enviarRespuesta:", rr.error);
      }
      pintarEstado();
    }));
  }
}

async function pintarFinal() {
  const r = await apiGet("resultadosPublicos", { slug });
  if (!r.ok || !r.disponible) {
    shell(`<p class="muted">El concurso ha finalizado. Calculando resultados…</p>`);
    // Reintentar en 4s por si el admin aún no cerró el concurso
    state.pollTimer = setTimeout(pintarFinal, 4000);
    return;
  }

  const miNombre = state.jugador?.nombre;
  let yaContado  = false;
  setWallpaper(r.logoUrl);
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <h2>Resultados finales</h2>
    <table class="ranking">
      <thead><tr><th>#</th><th>Concursante</th><th>Puntos</th></tr></thead>
      <tbody>
        ${r.ranking.map((f, i) => {
          const esYo = !yaContado && f.nombre === miNombre;
          if (esYo) yaContado = true;
          return `<tr class="${esYo ? "yo" : ""}">
            <td>${i + 1}</td><td>${escapeHtml(f.nombre)}</td><td>${f.puntos}</td></tr>`;
        }).join("") || `<tr><td colspan="3" class="muted">Nadie ha participado.</td></tr>`}
      </tbody>
    </table>`);
}

iniciar();
