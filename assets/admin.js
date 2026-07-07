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

/* ============================================================
   CSV — parseo y generación (todo en cliente, sin librerías)
   ============================================================ */

/**
 * Parsea un CSV robusto: respeta comillas dobles, saltos de línea
 * dentro de campos entrecomillados y distintos separadores (, ; \t).
 * Devuelve array de objetos usando la primera fila como cabeceras.
 */
function parseCsv(text) {
  // Normalizar finales de línea
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // Detectar separador: ; para locales europeos, \t para TSV, , por defecto
  const firstLine = text.split("\n")[0];
  const sep = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";

  const rows  = [];
  let field   = "";
  let row     = [];
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === sep)  { row.push(field.trim()); field = ""; }
      else if (ch === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; }
      else                  { field += ch; }
    }
  }
  // Última celda / fila
  row.push(field.trim());
  if (row.some(c => c !== "")) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : ""; });
    return obj;
  });
}

/**
 * Convierte un array de preguntas en texto CSV listo para descargar.
 * Todas las celdas se entrecomillan para máxima compatibilidad.
 */
function preguntasToCsv(preguntas) {
  const cols = ["texto","opcionA","opcionB","opcionC","opcionD","correcta"];
  const q    = s => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const header = cols.join(",");
  const body   = preguntas.map(p => cols.map(c => q(p[c])).join(",")).join("\n");
  return header + "\n" + body;
}

/** Dispara la descarga de un archivo de texto desde el navegador. */
function descargarTexto(contenido, nombreArchivo, mime) {
  const blob = new Blob(["\uFEFF" + contenido], { type: mime }); // BOM para Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Genera y descarga el CSV de plantilla vacía. */
function descargarPlantilla() {
  const ejemplo = [
    ["¿Cuál es la capital de Francia?","París","Madrid","Roma","Berlín","A"],
    ["¿En qué año llegó el hombre a la Luna?","1959","1969","1979","1989","B"]
  ].map(r => r.map(c => '"' + c + '"').join(",")).join("\n");
  descargarTexto(
    "texto,opcionA,opcionB,opcionC,opcionD,correcta\n" + ejemplo,
    "plantilla-preguntas.csv",
    "text/csv;charset=utf-8"
  );
}

/** Convierte un nombre en slug para usarlo como nombre de archivo. */
function slugify_(text) {
  return text.toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    .slice(0, 60) || "concurso";
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
    <div class="card" style="cursor:default;" data-id="${c.id}">
      <div class="row">
        <div class="row card--clickable" style="justify-content:flex-start;gap:12px;flex:1;" data-open="${c.id}">
          ${c.logoUrl
            ? `<img class="concurso-mini-logo" src="${c.logoUrl}" alt="" />`
            : `<div class="concurso-mini-logo concurso-mini-logo--vacio">${escapeHtml((c.nombre[0] || "?").toUpperCase())}</div>`}
          <div>
            <h3 style="margin-bottom:4px;">${escapeHtml(c.nombre)}</h3>
            <span class="muted small">${c.totalPreguntas} pregunta(s) · ${c.totalConcursantes} concursante(s)</span>
          </div>
        </div>
        <div class="row" style="gap:6px;flex-shrink:0;">
          ${badgeEstado(c.estado)}
          <button class="btn btn--ghost btn--sm" data-dup="${c.id}" title="Duplicar como plantilla">⧉ Duplicar</button>
          ${c.estado === "finalizado"
            ? `<button class="btn btn--ghost btn--sm btn--del" data-del="${c.id}" title="Eliminar concurso">✕</button>`
            : ""}
        </div>
      </div>
    </div>`).join("");

  // Abrir ficha al pulsar la zona de texto/logo (no los botones)
  cont.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => {
    state.vista = "concurso"; state.concursoId = el.dataset.open; state.pestana = "preguntas";
    render();
  }));

  // Duplicar
  cont.querySelectorAll("[data-dup]").forEach(btn => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const nombre = prompt("Nombre del nuevo concurso (déjalo vacío para usar el original con «— copia»):");
    if (nombre === null) return; // cancelado
    btn.disabled = true;
    btn.textContent = "Copiando…";
    const r = await apiPost("duplicarConcurso", { token: state.token, concursoId: btn.dataset.dup, nombre });
    if (!r.ok) { alert(r.error); btn.disabled = false; btn.textContent = "⧉ Duplicar"; return; }
    // Abrir el nuevo concurso directamente para editarlo
    state.vista = "concurso"; state.concursoId = r.concurso.id; state.pestana = "preguntas";
    render();
  }));

  // Eliminar (solo finalizados)
  cont.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const nombre = state.concursos.find(c => c.id === btn.dataset.del)?.nombre || "este concurso";
    if (!confirm(`¿Eliminar «${nombre}» y todos sus datos? Esta acción no se puede deshacer.`)) return;
    btn.disabled = true;
    const r = await apiPost("eliminarConcurso", { token: state.token, concursoId: btn.dataset.del });
    if (!r.ok) { alert(r.error); btn.disabled = false; return; }
    renderDashboard();
  }));
}

/* ---------------- vista de un concurso ---------------- */

function concursoActual() { return state.concursos.find(c => c.id === state.concursoId); }

async function renderConcurso() {
  await cargarConcursos();
  const c = concursoActual();
  if (!c) { state.vista = "dashboard"; return render(); }

  app.innerHTML = `
    <div class="row" style="margin-bottom:6px;">
      <button class="btn btn--ghost btn--sm" id="b-volver">&larr; Tus concursos</button>
      <div class="row" style="gap:6px;">
        <button class="btn btn--ghost btn--sm" id="b-dup-ficha">⧉ Duplicar</button>
        ${c.estado === "finalizado"
          ? `<button class="btn btn--danger btn--sm" id="b-del-ficha">✕ Eliminar</button>`
          : ""}
      </div>
    </div>
    <div class="row" style="margin-top:8px;">
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

  // Duplicar desde la ficha
  document.getElementById("b-dup-ficha").addEventListener("click", async () => {
    const nombre = prompt("Nombre del nuevo concurso (déjalo vacío para usar el original con «— copia»):");
    if (nombre === null) return;
    const btn = document.getElementById("b-dup-ficha");
    btn.disabled = true; btn.textContent = "Copiando…";
    const r = await apiPost("duplicarConcurso", { token: state.token, concursoId: c.id, nombre });
    if (!r.ok) { alert(r.error); btn.disabled = false; btn.textContent = "⧉ Duplicar"; return; }
    state.vista = "concurso"; state.concursoId = r.concurso.id; state.pestana = "preguntas";
    render();
  });

  // Eliminar desde la ficha (solo aparece si finalizado)
  const bdf = document.getElementById("b-del-ficha");
  if (bdf) bdf.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar «${c.nombre}» y todos sus datos? Esta acción no se puede deshacer.`)) return;
    bdf.disabled = true; bdf.textContent = "Eliminando…";
    const r = await apiPost("eliminarConcurso", { token: state.token, concursoId: c.id });
    if (!r.ok) { alert(r.error); bdf.disabled = false; bdf.textContent = "✕ Eliminar"; return; }
    state.vista = "dashboard";
    render();
  });

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

    <!-- ── Barra de herramientas: exportar / importar ── -->
    <div class="card" style="margin-bottom:14px;">
      <div class="row" style="flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin-bottom:2px;">Preguntas (${preguntas.length})</h3>
          <span class="muted small">Exporta o importa en formato CSV compatible con Excel.</span>
        </div>
        <div class="row" style="gap:8px;flex-shrink:0;flex-wrap:wrap;">
          <button class="btn btn--ghost btn--sm" id="b-plantilla">↓ Plantilla</button>
          ${preguntas.length ? `<button class="btn btn--ghost btn--sm" id="b-exportar">↓ Exportar CSV</button>` : ""}
          ${bloqueado ? "" : `<button class="btn btn--gold btn--sm" id="b-import-btn">↑ Importar CSV</button>`}
        </div>
      </div>
      ${bloqueado ? "" : `
      <div id="import-panel" style="display:none;margin-top:14px;border-top:1px solid var(--panel-edge);padding-top:14px;">
        <label>Archivo CSV</label>
        <input type="file" id="import-file" accept=".csv,.tsv,.txt" />
        <span class="muted small">Primera fila = cabeceras. Columnas requeridas:
          <code>texto, opcionA, opcionB, opcionC, opcionD, correcta</code></span>
        <div id="import-preview" style="margin-top:12px;"></div>
      </div>`}
    </div>

    <!-- ── Lista de preguntas ── -->
    <div id="lista-preguntas" class="stack">
      ${preguntas.map((p, i) => `
        <div class="card">
          <div class="row"><strong>${i + 1}. ${escapeHtml(p.texto)}</strong>
            ${bloqueado ? "" : `<button class="btn btn--ghost btn--sm" data-del="${p.id}">Eliminar</button>`}</div>
          <div class="small muted" style="margin-top:8px;line-height:1.8;">
            ${["A","B","C","D"].map(L =>
              `${L === p.correcta ? "✓" : "·"} ${L}) ${escapeHtml(p["opcion"+L])}`).join("<br/>")}
          </div>
        </div>`).join("") || `<p class="muted">Sin preguntas todavía. Añade una a mano o importa un CSV.</p>`}
    </div>

    ${bloqueado ? "" : `
    <!-- ── Añadir pregunta manualmente ── -->
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
          <option value="A">A</option><option value="B">B</option>
          <option value="C">C</option><option value="D">D</option>
        </select>
        <button class="btn btn--gold" style="margin-top:16px;" type="submit">Guardar pregunta</button>
      </form>
    </div>
    ${preguntas.length ? `
    <div class="card" style="margin-top:14px;">
      <div class="row">
        <div>
          <h3 style="margin-bottom:2px;">Temporizador por pregunta</h3>
          <span class="muted small">El anfitrión podrá avanzar manualmente en cualquier momento.</span>
        </div>
        <select id="sel-timer" style="width:auto;min-width:160px;">
          <option value="0"    ${(c.timerSegundos||0)==0    ?"selected":""}>Manual (sin límite)</option>
          <option value="300"  ${(c.timerSegundos||0)==300  ?"selected":""}>5 minutos</option>
          <option value="600"  ${(c.timerSegundos||0)==600  ?"selected":""}>10 minutos</option>
          <option value="1200" ${(c.timerSegundos||0)==1200 ?"selected":""}>20 minutos</option>
          <option value="1800" ${(c.timerSegundos||0)==1800 ?"selected":""}>30 minutos</option>
          <option value="3600" ${(c.timerSegundos||0)==3600 ?"selected":""}>60 minutos</option>
        </select>
      </div>
    </div>
    <button class="btn btn--gold btn--block" id="b-iniciar" style="margin-top:20px;">Iniciar concurso</button>` : ""}
    `}`;

  /* ── Listeners: barra de herramientas ── */

  document.getElementById("b-plantilla")
    ?.addEventListener("click", descargarPlantilla);

  document.getElementById("b-exportar")
    ?.addEventListener("click", () => {
      descargarTexto(
        preguntasToCsv(preguntas),
        slugify_(c.nombre) + "-preguntas.csv",
        "text/csv;charset=utf-8"
      );
    });

  document.getElementById("b-import-btn")
    ?.addEventListener("click", () => {
      const panel = document.getElementById("import-panel");
      if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
    });

  document.getElementById("import-file")
    ?.addEventListener("change", async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const preview = document.getElementById("import-preview");
      if (!preview) return;

      preview.innerHTML = `<p class="muted small">Leyendo archivo…</p>`;

      const texto = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload  = () => res(rd.result);
        rd.onerror = () => rej(new Error("No se pudo leer el archivo."));
        rd.readAsText(file, "utf-8");
      }).catch(e => { preview.innerHTML = `<div class="errorbox">${escapeHtml(e.message)}</div>`; return null; });
      if (!texto) return;

      const filas = parseCsv(texto);
      if (!filas.length) {
        preview.innerHTML = `<div class="errorbox">El archivo está vacío o no tiene el formato esperado.</div>`; return;
      }

      // Detectar columnas necesarias
      const muestra = filas[0];
      const cols = ["texto","opciona","opcionb","opcionc","opciond","correcta"];
      const cabeceras = Object.keys(muestra).map(k => k.toLowerCase());
      const faltantes = cols.filter(c => !cabeceras.includes(c));
      if (faltantes.length) {
        preview.innerHTML = `<div class="errorbox">Faltan las columnas: <strong>${faltantes.join(", ")}</strong>.<br>
          Descarga la plantilla para ver el formato correcto.</div>`; return;
      }

      // Normalizar claves a capitalización correcta
      const normalizar = f => ({
        texto:    f.texto    || f.Texto    || "",
        opcionA:  f.opciona  || f.opcionA  || f.OpcionA  || "",
        opcionB:  f.opcionb  || f.opcionB  || f.OpcionB  || "",
        opcionC:  f.opcionc  || f.opcionC  || f.OpcionC  || "",
        opcionD:  f.opciond  || f.opcionD  || f.OpcionD  || "",
        correcta: (f.correcta || f.Correcta || "").toUpperCase().trim()
      });
      const normalizadas = filas.map(normalizar);

      // Vista previa de las primeras 3 filas
      const hayExistentes = preguntas.length > 0;
      preview.innerHTML = `
        <p class="muted small">${normalizadas.length} pregunta(s) detectada(s). Vista previa:</p>
        ${normalizadas.slice(0, 3).map((p, i) => `
          <div class="card" style="padding:10px 14px;margin-bottom:8px;">
            <strong class="small">${i+1}. ${escapeHtml(p.texto)}</strong>
            <div class="small muted" style="margin-top:4px;line-height:1.7;">
              ${["A","B","C","D"].map(L =>
                `${p.correcta === L ? "✓" : "·"} ${L}) ${escapeHtml(p["opcion"+L])}`).join(" &nbsp; ")}
            </div>
          </div>`).join("")}
        ${normalizadas.length > 3 ? `<p class="muted small">…y ${normalizadas.length - 3} más.</p>` : ""}
        ${hayExistentes ? `
        <div class="card" style="margin-top:10px;border-color:var(--gold);">
          <p class="small" style="margin:0 0 10px;"><strong>¿Qué hacer con las ${preguntas.length} preguntas existentes?</strong></p>
          <div class="row" style="gap:8px;flex-wrap:wrap;">
            <button class="btn btn--ghost btn--sm" id="b-import-añadir">Añadir al final</button>
            <button class="btn btn--danger btn--sm" id="b-import-reemplazar">Reemplazar todo</button>
          </div>
        </div>` : `
        <button class="btn btn--gold" id="b-import-añadir" style="margin-top:10px;">
          Importar ${normalizadas.length} pregunta(s)
        </button>`}
        <div id="import-resultado" style="margin-top:10px;"></div>`;

      const doImport = async (reemplazar) => {
        const btnA = document.getElementById("b-import-añadir");
        const btnR = document.getElementById("b-import-reemplazar");
        const res  = document.getElementById("import-resultado");
        if (btnA) btnA.disabled = true;
        if (btnR) btnR.disabled = true;
        if (res)  res.innerHTML = `<p class="muted small pulse">Importando…</p>`;

        const rr = await apiPost("importarPreguntas", {
          token: state.token, concursoId: c.id,
          preguntas: normalizadas, reemplazar
        });
        if (!rr.ok) {
          if (res) res.innerHTML = `<div class="errorbox">${escapeHtml(rr.error)}</div>`;
          if (btnA) btnA.disabled = false;
          if (btnR) btnR.disabled = false;
          return;
        }
        // Éxito: recargar la pestaña entera
        renderTabPreguntas(c);
      };

      document.getElementById("b-import-añadir")
        ?.addEventListener("click", () => doImport(false));
      document.getElementById("b-import-reemplazar")
        ?.addEventListener("click", () => {
          if (!confirm(`¿Seguro? Se borrarán las ${preguntas.length} preguntas actuales y se reemplazarán por las ${normalizadas.length} del archivo.`)) return;
          doImport(true);
        });
    });

  /* ── Listeners: lista y formulario ── */

  cont.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("¿Eliminar esta pregunta?")) return;
    const rr = await apiPost("eliminarPregunta", { token: state.token, preguntaId: b.dataset.del });
    if (!rr.ok) return alert(rr.error);
    renderTabPreguntas(c);
  }));

  document.getElementById("sel-timer")
    ?.addEventListener("change", async ev => {
      const rr = await apiPost("configurarTimer", {
        token: state.token, concursoId: c.id, timerSegundos: ev.target.value
      });
      if (!rr.ok) { alert(rr.error); return; }
      c.timerSegundos = rr.timerSegundos;
    });

  document.getElementById("f-pregunta")
    ?.addEventListener("submit", async ev => {
      ev.preventDefault();
      const rr = await apiPost("guardarPregunta", {
        token: state.token, concursoId: c.id,
        texto:    document.getElementById("pq-texto").value.trim(),
        opcionA:  document.getElementById("pq-a").value.trim(),
        opcionB:  document.getElementById("pq-b").value.trim(),
        opcionC:  document.getElementById("pq-c").value.trim(),
        opcionD:  document.getElementById("pq-d").value.trim(),
        correcta: document.getElementById("pq-correcta").value
      });
      if (!rr.ok) return alert(rr.error);
      renderTabPreguntas(c);
    });

  document.getElementById("b-iniciar")
    ?.addEventListener("click", async () => {
      const timer   = c.timerSegundos || 0;
      const minutos = Math.round(timer / 60);
      const msg = timer > 0
        ? `Se iniciará el concurso con ${minutos} minuto${minutos !== 1 ? "s" : ""} por pregunta. ¿Continuar?`
        : "Al iniciar, los concursantes podrán empezar a responder y ya no podrás editar las preguntas. ¿Continuar?";
      if (!confirm(msg)) return;
      const rr = await apiPost("iniciarConcurso", { token: state.token, concursoId: c.id });
      if (!rr.ok) return alert(rr.error);
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

  cont.innerHTML = `
    <div class="flap-row" style="margin-bottom:18px;">
      <div class="flap"><div class="flap__value" id="fl-pregunta">-</div><div class="flap__label">Pregunta</div></div>
      <div class="flap"><div class="flap__value" id="fl-concursantes">-</div><div class="flap__label">Concursantes</div></div>
      <div class="flap"><div class="flap__value" id="fl-respuestas">-</div><div class="flap__label">Han respondido</div></div>
      <div class="flap" id="fl-timer-wrap" style="display:none;">
        <div class="flap__value" id="fl-timer">-</div>
        <div class="flap__label">Segundos</div>
      </div>
    </div>
    <div id="cl-barra-wrap" style="display:none;margin-bottom:18px;">
      <div class="timer-track"><div class="timer-bar" id="cl-barra"></div></div>
    </div>
    <div id="cl-pregunta-card"></div>
    <div id="cl-acciones"></div>`;

  let anteriorIdx    = null;
  let anteriorEstado = null;
  let cuentaTimer    = null; // setInterval local para la cuenta regresiva
  let avanzando      = false; // evitar doble avance simultáneo

  function detenerCuenta() {
    if (cuentaTimer) { clearInterval(cuentaTimer); cuentaTimer = null; }
  }

  function actualizarFlap(id, val) {
    const el = document.getElementById(id);
    if (!el || el.textContent === String(val)) return;
    el.textContent = val;
    el.parentElement.classList.remove("flap--update");
    void el.parentElement.offsetWidth;
    el.parentElement.classList.add("flap--update");
  }

  async function avanzarPregunta() {
    if (avanzando) return;
    avanzando = true;
    detenerCuenta();
    const btn = document.getElementById("b-siguiente");
    if (btn) btn.disabled = true;
    const rr = await apiPost("siguientePregunta", { token: state.token, concursoId: c.id });
    avanzando = false;
    if (!rr.ok) { alert(rr.error); if (btn) btn.disabled = false; return; }
    anteriorIdx = null;
    pintar();
  }

  function arrancarCuenta(timerSegundos, iniciadaEn) {
    detenerCuenta();
    const timerWrap = document.getElementById("fl-timer-wrap");
    const barraWrap = document.getElementById("cl-barra-wrap");
    const barra     = document.getElementById("cl-barra");
    if (!timerWrap) return;

    timerWrap.style.display = "";
    barraWrap.style.display = "";

    // Cambiar la etiqueta del flap a MM:SS
    const labelEl = timerWrap.querySelector(".flap__label");
    if (labelEl) labelEl.textContent = "Restante";

    const fin = new Date(iniciadaEn).getTime() + timerSegundos * 1000;

    cuentaTimer = setInterval(() => {
      const restante = Math.max(0, fin - Date.now());
      const totalSegs = Math.ceil(restante / 1000);
      const mm  = String(Math.floor(totalSegs / 60)).padStart(2, "0");
      const ss  = String(totalSegs % 60).padStart(2, "0");
      const pct = (restante / (timerSegundos * 1000)) * 100;

      actualizarFlap("fl-timer", mm + ":" + ss);
      if (barra) {
        barra.style.width = pct + "%";
        barra.className   = "timer-bar" +
          (pct < 10 ? " timer-bar--urgent" : pct < 30 ? " timer-bar--warning" : "");
      }
      if (restante <= 0) avanzarPregunta();
    }, 500);
  }

  const pintar = async () => {
    const r = await apiPost("estadoAdmin", { token: state.token, slug: c.slug });
    if (!r.ok) return;

    const numPregunta = r.estado === "finalizado" ? r.totalPreguntas : r.indicePregunta + 1;
    actualizarFlap("fl-pregunta",     numPregunta + "/" + r.totalPreguntas);
    actualizarFlap("fl-concursantes", r.totalConcursantes);
    actualizarFlap("fl-respuestas",   r.respuestasActual);

    if (r.indicePregunta !== anteriorIdx) {
      anteriorIdx = r.indicePregunta;
      const card = document.getElementById("cl-pregunta-card");
      if (card) card.innerHTML = r.pregunta ? `
        <div class="card">
          <h3>${escapeHtml(r.pregunta.texto)}</h3>
          <div class="small muted" style="margin-top:10px;line-height:1.8;">
            ${["A","B","C","D"].map(L => `${L}) ${escapeHtml(r.pregunta["opcion"+L])}`).join("<br/>")}
          </div>
        </div>` : "";

      // Arrancar o detener la cuenta regresiva según configuración
      if (r.timerSegundos > 0 && r.preguntaIniciadaEn && r.estado === "activo") {
        arrancarCuenta(r.timerSegundos, r.preguntaIniciadaEn);
      } else {
        detenerCuenta();
        const timerWrap = document.getElementById("fl-timer-wrap");
        const barraWrap = document.getElementById("cl-barra-wrap");
        if (timerWrap) timerWrap.style.display = "none";
        if (barraWrap) barraWrap.style.display = "none";
      }
    }

    if (r.estado !== anteriorEstado) {
      anteriorEstado = r.estado;
      const acc = document.getElementById("cl-acciones");
      if (!acc) return;
      if (r.estado === "activo") {
        const esUltima = r.indicePregunta + 1 >= r.totalPreguntas;
        const minutos  = r.timerSegundos > 0 ? Math.round(r.timerSegundos / 60) : 0;
        const etiqAuto = minutos > 0 ? ` (auto · ${minutos} min)` : "";
        acc.innerHTML = `
          <button class="btn btn--gold btn--block" id="b-siguiente" style="margin-top:18px;">
            ${esUltima ? "Finalizar y revelar resultados" : "Siguiente pregunta" + etiqAuto}
          </button>
          <button class="btn btn--ghost btn--block" id="b-finalizar" style="margin-top:10px;">Finalizar concurso ahora</button>`;
        document.getElementById("b-siguiente").addEventListener("click", avanzarPregunta);
        document.getElementById("b-finalizar").addEventListener("click", async () => {
          if (!confirm("¿Finalizar el concurso ahora mismo?")) return;
          detenerCuenta();
          await apiPost("finalizarConcurso", { token: state.token, concursoId: c.id });
          pintar();
        });
      } else {
        detenerCuenta();
        acc.innerHTML = `<div class="okbox" style="margin-top:18px;">Concurso finalizado. Mira la pestaña Resultados.</div>`;
        detenerPoll();
      }
    }
  };

  await pintar();
  state.pollTimer = setInterval(pintar, 3000);
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
