/* ============================================================
   admin.js — panel del administrador
   ============================================================ */

const state = {
  token: localStorage.getItem("qa_token") || null,
  usuario: localStorage.getItem("qa_user") || null,
  concursos: [],
  vista: "dashboard",     // dashboard | concurso
  concursoId: null,
  pestana: "preguntas",   // preguntas | control | resultados
  pollTimer: null,
  estadoLive: null
};

const app = document.getElementById("app");

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function leerArchivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function subirLogoSiHay(inputId, concursoId) {
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { alert("El logo debe ser una imagen (PNG, JPG…)."); return; }
  if (file.size > 2 * 1024 * 1024) { alert("El logo no puede superar 2 MB."); return; }
  const datos = await leerArchivoComoBase64(file);
  const r = await apiPost("subirLogo", { token: state.token, concursoId, datos, tipo: file.type, nombreArchivo: file.name });
  if (!r.ok) alert("El concurso se creó, pero el logo no se pudo subir: " + r.error);
}

function detenerPoll() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function linkConcursante(slug) {
  return location.origin + location.pathname.replace(/admin\.html$/, "play.html") + "?c=" + slug;
}

function cerrarSesion() {
  localStorage.removeItem("qa_token");
  localStorage.removeItem("qa_user");
  state.token = null;
  detenerPoll();
  render();
}

/* ---------------- render raíz ---------------- */

function render() {
  detenerPoll();
  if (!state.token) return renderLogin();
  if (state.vista === "concurso") return renderConcurso();
  return renderDashboard();
}

/* ---------------- login ---------------- */

function renderLogin() {
  app.innerHTML = `
    <div class="brand"><span class="brand__mark">QUIZ EN VIVO</span><span class="brand__sub">Panel admin</span></div>
    <div class="card" style="max-width:380px;margin:40px auto 0;">
      <h2>Acceso del administrador</h2>
      <p class="muted small">Crea y dirige tus concursos en directo.</p>
      <form id="f-login">
        <label>Usuario</label>
        <input type="text" id="li-user" autocomplete="username" required />
        <label>Contraseña</label>
        <input type="password" id="li-pass" autocomplete="current-password" required />
        <div id="li-error"></div>
        <button class="btn btn--gold btn--block" style="margin-top:18px;" type="submit">Entrar</button>
      </form>
    </div>`;

  document.getElementById("f-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const usuario = document.getElementById("li-user").value.trim();
    const clave = document.getElementById("li-pass").value;
    const errBox = document.getElementById("li-error");
    errBox.innerHTML = "";
    const r = await apiPost("login", { usuario, clave });
    if (!r.ok) { errBox.innerHTML = `<div class="errorbox">${escapeHtml(r.error)}</div>`; return; }
    state.token = r.token;
    state.usuario = usuario;
    localStorage.setItem("qa_token", r.token);
    localStorage.setItem("qa_user", usuario);
    render();
  });
}

/* ---------------- dashboard ---------------- */

async function cargarConcursos() {
  const r = await apiPost("listarConcursos", { token: state.token });
  if (!r.ok) { if (/sesi[oó]n/i.test(r.error)) cerrarSesion(); return []; }
  state.concursos = r.concursos;
  return r.concursos;
}

function badgeEstado(estado) {
  const txt = { borrador: "Borrador", activo: "En directo", finalizado: "Finalizado" }[estado] || estado;
  return `<span class="badge badge--${estado}">${txt}</span>`;
}

async function renderDashboard() {
  app.innerHTML = `
    <div class="row">
      <div class="brand"><span class="brand__mark">QUIZ EN VIVO</span><span class="brand__sub">Panel admin</span></div>
      <button class="btn btn--ghost btn--sm" id="b-logout">Cerrar sesión</button>
    </div>
    <div class="card">
      <h3>Nuevo concurso</h3>
      <form id="f-nuevo">
        <div class="field-row" style="align-items:flex-end;">
          <div>
            <label>Nombre del concurso</label>
            <input type="text" id="nc-nombre" placeholder="P. ej. Concurso de cultura general" required />
          </div>
          <button class="btn btn--gold" type="submit">Crear</button>
        </div>
        <label>Logotipo (opcional)</label>
        <input type="file" id="nc-logo" accept="image/*" />
        <span class="muted small">PNG o JPG, máx. 2 MB. Se mostrará a los concursantes.</span>
      </form>
    </div>
    <h3 style="margin-top:26px;">Tus concursos</h3>
    <div id="lista-concursos" class="stack"><p class="muted">Cargando…</p></div>
    <footer class="foot">QUIZ EN VIVO · panel de administración</footer>`;

  document.getElementById("b-logout").addEventListener("click", cerrarSesion);
  document.getElementById("f-nuevo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById("nc-nombre").value.trim();
    if (!nombre) return;
    const r = await apiPost("crearConcurso", { token: state.token, nombre });
    if (!r.ok) { alert(r.error); return; }
    await subirLogoSiHay("nc-logo", r.concurso.id);
    state.vista = "concurso"; state.concursoId = r.concurso.id; state.pestana = "preguntas";
    render();
  });

  const concursos = await cargarConcursos();
  const cont = document.getElementById("lista-concursos");
  if (!concursos.length) { cont.innerHTML = `<p class="muted">Todavía no has creado ningún concurso.</p>`; return; }
  cont.innerHTML = concursos.map(c => `
    <div class="card card--clickable" data-id="${c.id}">
      <div class="row">
        <div class="row" style="justify-content:flex-start;gap:12px;">
          ${c.logoUrl
            ? `<img class="concurso-mini-logo" src="${c.logoUrl}" alt="" />`
            : `<div class="concurso-mini-logo concurso-mini-logo--vacio">${escapeHtml((c.nombre[0] || "?").toUpperCase())}</div>`}
          <div>
            <h3 style="margin-bottom:4px;">${escapeHtml(c.nombre)}</h3>
            <span class="muted small">${c.totalPreguntas} pregunta(s) · ${c.totalConcursantes} concursante(s)</span>
          </div>
        </div>
        ${badgeEstado(c.estado)}
      </div>
    </div>`).join("");
  cont.querySelectorAll(".card").forEach(el => el.addEventListener("click", () => {
    state.vista = "concurso"; state.concursoId = el.dataset.id; state.pestana = "preguntas";
    render();
  }));
}

/* ---------------- vista de un concurso ---------------- */

function concursoActual() { return state.concursos.find(c => c.id === state.concursoId); }

async function renderConcurso() {
  await cargarConcursos();
  const c = concursoActual();
  if (!c) { state.vista = "dashboard"; return render(); }

  app.innerHTML = `
    <button class="btn btn--ghost btn--sm" id="b-volver">&larr; Tus concursos</button>
    <div class="row" style="margin-top:14px;">
      <div class="concurso-header">
        ${c.logoUrl ? `<img class="concurso-header__logo" src="${c.logoUrl}" alt="" />` : ""}
        <h1 style="font-size:30px;">${escapeHtml(c.nombre)}</h1>
      </div>
      ${badgeEstado(c.estado)}
    </div>
    <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <div class="logo-preview">
        ${c.logoUrl
          ? `<img src="${c.logoUrl}" alt="" />`
          : `<div class="concurso-mini-logo concurso-mini-logo--vacio">${escapeHtml((c.nombre[0] || "?").toUpperCase())}</div>`}
      </div>
      <div class="stack" style="gap:6px;flex:1;min-width:200px;">
        <label style="margin:0;">Logotipo del concurso</label>
        <div class="row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap;">
          <input type="file" id="lg-input" accept="image/*" style="max-width:230px;" />
          ${c.logoUrl ? `<button class="btn btn--ghost btn--sm" id="b-quitar-logo">Quitar</button>` : ""}
        </div>
        <span class="muted small">PNG o JPG, máx. 2 MB. Se muestra a los concursantes.</span>
      </div>
    </div>
    <div class="copybox" style="margin-bottom:18px;">
      <span style="flex:1;">${linkConcursante(c.slug)}</span>
      <button class="btn btn--ghost btn--sm" id="b-copiar">Copiar</button>
    </div>
    <div class="row" style="gap:8px;border-bottom:1px solid var(--panel-edge);padding-bottom:10px;justify-content:flex-start;">
      <button class="btn btn--sm ${state.pestana === "preguntas" ? "btn--gold" : "btn--ghost"}" data-tab="preguntas">Preguntas</button>
      <button class="btn btn--sm ${state.pestana === "control" ? "btn--gold" : "btn--ghost"}" data-tab="control">Control en vivo</button>
      <button class="btn btn--sm ${state.pestana === "resultados" ? "btn--gold" : "btn--ghost"}" data-tab="resultados">Resultados</button>
    </div>
    <div id="tab-content" style="margin-top:18px;"></div>`;

  document.getElementById("b-volver").addEventListener("click", () => { state.vista = "dashboard"; render(); });
  document.getElementById("b-copiar").addEventListener("click", () => {
    navigator.clipboard?.writeText(linkConcursante(c.slug));
  });
  document.getElementById("lg-input").addEventListener("change", async () => {
    await subirLogoSiHay("lg-input", c.id);
    renderConcurso();
  });
  const bq = document.getElementById("b-quitar-logo");
  if (bq) bq.addEventListener("click", async () => {
    if (!confirm("¿Quitar el logotipo de este concurso?")) return;
    const r = await apiPost("eliminarLogo", { token: state.token, concursoId: c.id });
    if (!r.ok) return alert(r.error);
    renderConcurso();
  });
  app.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
    state.pestana = btn.dataset.tab; renderConcurso();
  }));

  if (state.pestana === "preguntas") renderTabPreguntas(c);
  else if (state.pestana === "control") renderTabControl(c);
  else renderTabResultados(c);
}

/* --- tab preguntas --- */

async function renderTabPreguntas(c) {
  const cont = document.getElementById("tab-content");
  cont.innerHTML = `<p class="muted">Cargando preguntas…</p>`;
  const r = await apiPost("listarPreguntas", { token: state.token, concursoId: c.id });
  if (!r.ok) { cont.innerHTML = `<div class="errorbox">${escapeHtml(r.error)}</div>`; return; }
  const preguntas = r.preguntas;
  const bloqueado = c.estado !== "borrador";

  cont.innerHTML = `
    ${bloqueado ? `<div class="okbox">El concurso ya se ha iniciado: las preguntas quedan fijas.</div>` : ""}
    <div id="lista-preguntas" class="stack">
      ${preguntas.map((p, i) => `
        <div class="card">
          <div class="row"><strong>${i + 1}. ${escapeHtml(p.texto)}</strong>
            ${bloqueado ? "" : `<button class="btn btn--ghost btn--sm" data-del="${p.id}">Eliminar</button>`}</div>
          <div class="small muted" style="margin-top:8px;line-height:1.8;">
            ${["A","B","C","D"].map(L => `${L === p.correcta ? "✓" : "·"} ${L}) ${escapeHtml(p["opcion"+L])}`).join("<br/>")}
          </div>
        </div>`).join("") || `<p class="muted">Sin preguntas todavía.</p>`}
    </div>
    ${bloqueado ? "" : `
    <div class="card" style="margin-top:18px;">
      <h3>Añadir pregunta</h3>
      <form id="f-pregunta">
        <label>Pregunta</label>
        <textarea id="pq-texto" required></textarea>
        <div class="field-row">
          <div><label>Opción A</label><input type="text" id="pq-a" required /></div>
          <div><label>Opción B</label><input type="text" id="pq-b" required /></div>
        </div>
        <div class="field-row">
          <div><label>Opción C</label><input type="text" id="pq-c" required /></div>
          <div><label>Opción D</label><input type="text" id="pq-d" required /></div>
        </div>
        <label>Respuesta correcta</label>
        <select id="pq-correcta">
          <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
        </select>
        <button class="btn btn--gold" style="margin-top:16px;" type="submit">Guardar pregunta</button>
      </form>
    </div>
    ${preguntas.length ? `<button class="btn btn--gold btn--block" id="b-iniciar" style="margin-top:20px;">Iniciar concurso</button>` : ""}
    `}`;

  cont.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("¿Eliminar esta pregunta?")) return;
    const r = await apiPost("eliminarPregunta", { token: state.token, preguntaId: b.dataset.del });
    if (!r.ok) return alert(r.error);
    renderTabPreguntas(c);
  }));

  const fp = document.getElementById("f-pregunta");
  if (fp) fp.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const r = await apiPost("guardarPregunta", {
      token: state.token, concursoId: c.id,
      texto: document.getElementById("pq-texto").value.trim(),
      opcionA: document.getElementById("pq-a").value.trim(),
      opcionB: document.getElementById("pq-b").value.trim(),
      opcionC: document.getElementById("pq-c").value.trim(),
      opcionD: document.getElementById("pq-d").value.trim(),
      correcta: document.getElementById("pq-correcta").value
    });
    if (!r.ok) return alert(r.error);
    renderTabPreguntas(c);
  });

  const bi = document.getElementById("b-iniciar");
  if (bi) bi.addEventListener("click", async () => {
    if (!confirm("Al iniciar, los concursantes podrán empezar a responder y ya no podrás editar las preguntas. ¿Continuar?")) return;
    const r = await apiPost("iniciarConcurso", { token: state.token, concursoId: c.id });
    if (!r.ok) return alert(r.error);
    state.pestana = "control";
    render();
  });
}

/* --- tab control en vivo --- */

async function renderTabControl(c) {
  const cont = document.getElementById("tab-content");

  if (c.estado === "borrador") {
    cont.innerHTML = `<p class="muted">Inicia el concurso desde la pestaña "Preguntas" para abrir el control en vivo.</p>`;
    return;
  }

  cont.innerHTML = `<div id="control-live">Cargando…</div>`;
  const pintar = async () => {
    const r = await apiGet("estadoPublico", { slug: c.slug });
    if (!r.ok) return;
    state.estadoLive = r;
    const live = document.getElementById("control-live");
    if (!live) return;

    const numPregunta = r.estado === "finalizado" ? r.totalPreguntas : r.indicePregunta + 1;
    live.innerHTML = `
      <div class="flap-row">
        <div class="flap"><div class="flap__value">${numPregunta}/${r.totalPreguntas}</div><div class="flap__label">Pregunta</div></div>
        <div class="flap"><div class="flap__value">${r.totalConcursantes}</div><div class="flap__label">Concursantes</div></div>
        <div class="flap"><div class="flap__value">${r.respuestasActual}</div><div class="flap__label">Han respondido</div></div>
      </div>
      ${r.pregunta ? `
        <div class="card" style="margin-top:18px;">
          <h3>${escapeHtml(r.pregunta.texto)}</h3>
          <div class="small muted" style="margin-top:10px;line-height:1.8;">
            ${["A","B","C","D"].map(L => `${L}) ${escapeHtml(r.pregunta["opcion"+L])}`).join("<br/>")}
          </div>
        </div>` : ""}
      ${r.estado === "activo" ? `
        <button class="btn btn--gold btn--block" id="b-siguiente" style="margin-top:18px;">
          ${r.indicePregunta + 1 >= r.totalPreguntas ? "Finalizar y revelar resultados" : "Siguiente pregunta"}
        </button>
        <button class="btn btn--ghost btn--block" id="b-finalizar" style="margin-top:10px;">Finalizar concurso ahora</button>
      ` : `<div class="okbox" style="margin-top:18px;">Concurso finalizado. Mira la pestaña Resultados.</div>`}`;

    const bs = document.getElementById("b-siguiente");
    if (bs) bs.addEventListener("click", async () => {
      bs.disabled = true;
      const rr = await apiPost("siguientePregunta", { token: state.token, concursoId: c.id });
      if (!rr.ok) { alert(rr.error); bs.disabled = false; return; }
      pintar();
    });
    const bf = document.getElementById("b-finalizar");
    if (bf) bf.addEventListener("click", async () => {
      if (!confirm("¿Finalizar el concurso ahora mismo?")) return;
      await apiPost("finalizarConcurso", { token: state.token, concursoId: c.id });
      pintar();
    });
  };

  await pintar();
  state.pollTimer = setInterval(pintar, 2500);
}

/* --- tab resultados --- */

async function renderTabResultados(c) {
  const cont = document.getElementById("tab-content");
  if (c.estado !== "finalizado") {
    cont.innerHTML = `<p class="muted">Los resultados se mostrarán cuando el concurso finalice.</p>`;
    return;
  }
  cont.innerHTML = `<p class="muted">Cargando…</p>`;
  const r = await apiPost("resultadosAdmin", { token: state.token, concursoId: c.id });
  if (!r.ok) { cont.innerHTML = `<div class="errorbox">${escapeHtml(r.error)}</div>`; return; }
  cont.innerHTML = `
    <table class="ranking">
      <thead><tr><th>#</th><th>Concursante</th><th>Aciertos</th><th>Fallos</th><th>Puntos</th></tr></thead>
      <tbody>
        ${r.ranking.map((f, i) => `
          <tr><td>${i + 1}</td><td>${escapeHtml(f.nombre)}</td><td>${f.correctas}</td><td>${f.incorrectas}</td><td>${f.puntos}</td></tr>
        `).join("") || `<tr><td colspan="5" class="muted">Nadie ha participado.</td></tr>`}
      </tbody>
    </table>`;
}

render();
