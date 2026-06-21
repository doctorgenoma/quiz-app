/* ============================================================
   play.js — vista del concursante
   ============================================================ */

const app = document.getElementById("app");
const slug = getQueryParam("c");

const state = {
  jugador: null,        // {concursanteId, nombre}
  ultimaPreguntaId: null,
  pollTimer: null
};

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function keyJugador() { return "qa_player_" + slug; }
function keyRespuestas() { return "qa_answers_" + slug; }

function cargarJugador() {
  const raw = localStorage.getItem(keyJugador());
  state.jugador = raw ? JSON.parse(raw) : null;
}
function guardarJugador(j) {
  state.jugador = j;
  localStorage.setItem(keyJugador(), JSON.stringify(j));
}
function respuestasGuardadas() {
  return JSON.parse(localStorage.getItem(keyRespuestas()) || "{}");
}
function guardarRespuesta(preguntaId, opcion) {
  const r = respuestasGuardadas();
  r[preguntaId] = opcion;
  localStorage.setItem(keyRespuestas(), JSON.stringify(r));
}

function detenerPoll() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

function cabeceraConcurso(nombre, logoUrl) {
  return `<div class="concurso-header">
    ${logoUrl ? `<img class="concurso-header__logo" src="${logoUrl}" alt="" />` : ""}
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
  if (!slug) { shell(`<div class="errorbox">Falta el enlace del concurso. Pide al anfitrión el enlace correcto.</div>`); return; }
  cargarJugador();
  if (!state.jugador) return mostrarUnirse();
  empezarPoll();
}

/* ---------------- unirse ---------------- */

async function mostrarUnirse() {
  const r = await apiGet("estadoPublico", { slug });
  if (!r.ok) { shell(`<div class="errorbox">${escapeHtml(r.error)}</div>`); return; }
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <p class="muted">Escribe tu nombre para unirte al concurso.</p>
    <form id="f-unirse" class="card">
      <label>Tu nombre</label>
      <input type="text" id="ju-nombre" maxlength="40" required autofocus />
      <div id="ju-error"></div>
      <button class="btn btn--gold btn--block" style="margin-top:16px;" type="submit">Unirme</button>
    </form>`);

  document.getElementById("f-unirse").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById("ju-nombre").value.trim();
    const errBox = document.getElementById("ju-error");
    if (!nombre) return;
    const rr = await apiPost("registrarConcursante", { slug, nombre });
    if (!rr.ok) { errBox.innerHTML = `<div class="errorbox">${escapeHtml(rr.error)}</div>`; return; }
    guardarJugador({ concursanteId: rr.concursanteId, nombre: rr.nombre });
    empezarPoll();
  });
}

/* ---------------- bucle de juego ---------------- */

function empezarPoll() {
  pintarEstado();
  state.pollTimer = setInterval(pintarEstado, 2000);
}

async function pintarEstado() {
  const r = await apiGet("estadoPublico", { slug });
  if (!r.ok) { shell(`<div class="errorbox">${escapeHtml(r.error)}</div>`); detenerPoll(); return; }

  if (r.estado === "borrador") return pintarEspera(r);
  if (r.estado === "finalizado") { detenerPoll(); return pintarFinal(); }
  return pintarPregunta(r);
}

function pintarEspera(r) {
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <p>Hola, <strong>${escapeHtml(state.jugador.nombre)}</strong> 👋</p>
    <p class="pulse">Esperando a que el anfitrión empiece el concurso…</p>`);
}

function pintarPregunta(r) {
  const p = r.pregunta;
  if (!p) { shell(`<p class="pulse">Preparando la siguiente pregunta…</p>`); return; }

  const respuestas = respuestasGuardadas();
  const yaRespondida = respuestas[p.id] !== undefined;

  shell(`
    <div class="row small muted"><span>${r.logoUrl ? `<img class="logo-mini-inline" src="${r.logoUrl}" alt="" />` : ""}Pregunta ${r.indicePregunta + 1} / ${r.totalPreguntas}</span><span>${state.jugador.nombre}</span></div>
    <h2 style="margin-top:10px;">${escapeHtml(p.texto)}</h2>
    <div class="opciones" id="opciones">
      ${["A","B","C","D"].map(L => `
        <button class="opcion ${yaRespondida && respuestas[p.id] === L ? "opcion--elegida" : ""}" data-letra="${L}" ${yaRespondida ? "disabled" : ""}>
          <span class="opcion__letra">${L}</span><span>${escapeHtml(p["opcion" + L])}</span>
        </button>`).join("")}
    </div>
    ${yaRespondida
      ? `<div class="okbox" style="margin-top:16px;">Respuesta enviada. Esperando la siguiente pregunta…</div>`
      : `<p class="muted small" style="margin-top:14px;">Elige una opción. Solo cuenta tu primera respuesta.</p>`}
  `);

  if (!yaRespondida) {
    document.querySelectorAll("#opciones .opcion").forEach(btn => btn.addEventListener("click", async () => {
      document.querySelectorAll("#opciones .opcion").forEach(b => b.disabled = true);
      const opcion = btn.dataset.letra;
      const rr = await apiPost("enviarRespuesta", { slug, concursanteId: state.jugador.concursanteId, preguntaId: p.id, opcion });
      if (!rr.ok) {
        // si el servidor dice que ya estaba respondida o la pregunta cambió, simplemente resincroniza
        guardarRespuesta(p.id, opcion);
        pintarEstado();
        return;
      }
      guardarRespuesta(p.id, opcion);
      pintarEstado();
    }));
  }
}

async function pintarFinal() {
  const r = await apiGet("resultadosPublicos", { slug });
  if (!r.ok || !r.disponible) { shell(`<p class="muted">El concurso ha finalizado. Calculando resultados…</p>`); return; }
  const miNombre = state.jugador?.nombre;
  let yaContado = false;
  shell(`
    ${cabeceraConcurso(r.nombre, r.logoUrl)}
    <h2>Resultados finales</h2>
    <table class="ranking">
      <thead><tr><th>#</th><th>Concursante</th><th>Puntos</th></tr></thead>
      <tbody>
        ${r.ranking.map((f, i) => {
          const esYo = !yaContado && f.nombre === miNombre;
          if (f.nombre === miNombre) yaContado = true;
          return `<tr class="${esYo ? "yo" : ""}"><td>${i + 1}</td><td>${escapeHtml(f.nombre)}</td><td>${f.puntos}</td></tr>`;
        }).join("") || `<tr><td colspan="3" class="muted">Nadie ha participado.</td></tr>`}
      </tbody>
    </table>`);
}

iniciar();
