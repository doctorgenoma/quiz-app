/* ============================================================
   play.js — vista del concursante
   ============================================================ */

const app  = document.getElementById("app");
const slug = getQueryParam("c");

const state = {
  jugador:          null,   // {concursanteId, nombre}
  ultimoEstado:     null,   // snapshot del último render para detectar cambios
  ultimaPreguntaId: null,   // ID de la pregunta actualmente renderizada
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
  // Mostrar algo inmediatamente para que la pantalla nunca quede oscura
  // mientras se espera la primera respuesta del servidor
  shell(`<p class="pulse" style="margin-top:40px;text-align:center;">Conectando…</p>`);
  pintarEstado();
  state.pollTimer = setInterval(pintarEstado, POLL_NORMAL_MS);
}

function claveEstado(r) {
  if (!r) return "";
  const pid = r.pregunta ? r.pregunta.id : "null";
  const ya  = r.pregunta ? (respuestasGuardadas()[r.pregunta.id] !== undefined ? "1" : "0") : "0";
  // Incluir preguntaIniciadaEn para que el render se fuerce cuando cambia la pregunta
  const ts  = r.preguntaIniciadaEn ? r.preguntaIniciadaEn.slice(0, 19) : "";
  return `${r.estado}|${r.indicePregunta}|${pid}|${ya}|${ts}`;
}

async function pintarEstado() {
  const r = await apiGet("estadoPublico", { slug });

  if (!r.ok) {
    state.errorCount++;
    // Si es el primer fallo y la pantalla está vacía, mostramos mensaje
    if (!state.ultimoEstado) {
      shell(`
        <div class="errorbox">
          No se pudo conectar con el concurso.<br>
          <span class="small">${escapeHtml(r.error)}</span>
        </div>
        <button class="btn btn--gold btn--block" style="margin-top:16px;"
          onclick="location.reload()">Reintentar</button>`);
    }
    // Backoff exponencial para los reintentos automáticos
    detenerPoll();
    const delay = Math.min(POLL_ERROR_BASE * state.errorCount, POLL_ERROR_MAX);
    state.pollTimer = setTimeout(pintarEstado, delay);
    return;
  }

  state.errorCount = 0;

  // Si la pregunta cambió, forzar render limpio para que nunca quede
  // el highlight de la respuesta anterior visible en la nueva pregunta.
  const nuevaPreguntaId = r.pregunta?.id ?? null;
  if (nuevaPreguntaId !== state.ultimaPreguntaId) {
    state.ultimoEstado    = null;
    state.ultimaPreguntaId = nuevaPreguntaId;
  }

  // ── Skip si la pantalla no necesita cambiar ──
  const clave = claveEstado(r);
  if (clave === state.ultimoEstado) return;
  state.ultimoEstado = clave;

  if (r.estado === "borrador")   return pintarEspera(r);
  if (r.estado === "finalizado") { detenerPoll(); return pintarFinal(); }
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
  const p = r.pregunta;
  if (!p) { shell(`<p class="pulse">Preparando la siguiente pregunta…</p>`); return; }

  setWallpaper(r.logoUrl);

  const respuestas   = respuestasGuardadas();
  const yaRespondida = respuestas[p.id] !== undefined;
  const timerSegs    = Number(r.timerSegundos) || 0;
  const hayTimer     = timerSegs > 0 && !!r.preguntaIniciadaEn;

  shell(`
    <div class="row small muted" style="margin-bottom:8px;">
      <span>${r.logoUrl ? `<img class="logo-mini-inline" src="${escapeHtml(r.logoUrl)}" alt="" />` : ""}
            Pregunta ${r.indicePregunta + 1} / ${r.totalPreguntas}</span>
      <span>${escapeHtml(state.jugador.nombre)}</span>
    </div>

    ${hayTimer ? `
    <div style="margin-bottom:6px;">
      <div class="timer-track"><div class="timer-bar" id="play-barra"></div></div>
      <div style="text-align:right;margin-top:3px;">
        <span class="muted small" id="play-mmss" style="font-family:var(--f-mono);">--:--</span>
      </div>
    </div>` : ""}

    <h2 style="margin-top:${hayTimer ? "4px" : "10px"};">${escapeHtml(p.texto)}</h2>

    <div class="opciones" id="opciones">
      ${["A","B","C","D"].map(L => `
        <button class="opcion ${yaRespondida && respuestas[p.id] === L ? "opcion--elegida" : ""}"
                data-letra="${L}" ${yaRespondida ? "disabled" : ""}>
          <span class="opcion__letra">${L}</span>
          <span>${escapeHtml(p["opcion" + L])}</span>
        </button>`).join("")}
    </div>

    ${yaRespondida ? `
      <div class="okbox" style="margin-top:16px;">
        ✓ Respuesta enviada
        ${hayTimer ? `
        <div class="countdown-box">
          <div class="countdown-label">Próxima pregunta en</div>
          <div class="countdown-display" id="play-mmss-grande">--:--</div>
        </div>` : `<br><span class="muted small">Esperando la siguiente pregunta…</span>`}
      </div>` :
      `<p class="muted small" style="margin-top:14px;">Elige una opción. Solo cuenta tu primera respuesta.</p>`}
  `);

  // ── Cuenta regresiva local ──────────────────────────────────────
  if (hayTimer) {
    const fin = new Date(r.preguntaIniciadaEn).getTime() + timerSegs * 1000;

    const tick = setInterval(() => {
      const restante  = Math.max(0, fin - Date.now());
      const totalSegs = Math.ceil(restante / 1000);
      const mm  = String(Math.floor(totalSegs / 60)).padStart(2, "0");
      const ss  = String(totalSegs % 60).padStart(2, "0");
      const txt = mm + ":" + ss;
      const pct = (restante / (timerSegs * 1000)) * 100;
      const cls = "timer-bar" + (pct < 10 ? " timer-bar--urgent" : pct < 30 ? " timer-bar--warning" : "");

      const barra      = document.getElementById("play-barra");
      const mmssSmall  = document.getElementById("play-mmss");
      const mmssGrande = document.getElementById("play-mmss-grande");

      if (barra)      { barra.style.width = pct + "%"; barra.className = cls; }
      if (mmssSmall)  mmssSmall.textContent  = txt;
      if (mmssGrande) mmssGrande.textContent = txt;

      if (restante <= 0) clearInterval(tick);
    }, 500);

    const observer = new MutationObserver(() => { clearInterval(tick); observer.disconnect(); });
    observer.observe(document.getElementById("app"), { childList: true });
  }

  if (!yaRespondida) {
    document.querySelectorAll("#opciones .opcion").forEach(btn => btn.addEventListener("click", () => {
      const opcion = btn.dataset.letra;

      // 1. INMEDIATO: guardar localmente y re-renderizar sin esperar la red.
      //    El usuario ve el resultado en < 16 ms (un frame de pantalla).
      guardarRespuesta(p.id, opcion);
      state.ultimoEstado    = null;
      state.ultimaPreguntaId = p.id; // ya sabemos la pregunta, evitar reset innecesario
      pintarPregunta(r);             // re-render síncrono: muestra opción marcada + countdown

      // 2. BACKGROUND: enviar al servidor sin bloquear la UI.
      //    Si falla, la respuesta ya está en localStorage y el servidor
      //    la rechazará como duplicada cuando se reintente.
      apiPost("enviarRespuesta", {
        slug,
        concursanteId: state.jugador.concursanteId,
        preguntaId:    p.id,
        opcion
      }).then(rr => {
        if (!rr.ok && !/ya has respondido/i.test(rr.error)) {
          console.warn("enviarRespuesta:", rr.error);
        }
      });
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
