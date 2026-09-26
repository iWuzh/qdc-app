// App QDC — pantallas. El servidor es el Apps Script del bot (Api.js).
// Todo lo que se registra entra primero a una COLA en el teléfono y se manda
// cuando hay señal. Cada registro lleva un id: si se reintenta, el servidor lo
// reconoce y no lo escribe dos veces. Ver wiki concepts/app-qdc.md.
"use strict";

const API = window.QDC_CONFIG.API_URL;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = n => "RD$" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DIAS = ["dom","lun","mar","mié","jue","vie","sáb"];
const fecha = iso => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`; };
const hoyIso = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- Guardado en el teléfono ----------
const guardar = (k, v) => { try { localStorage.setItem("qdc." + k, JSON.stringify(v)); } catch (e) {} };
const leer = (k, def) => { try { const v = localStorage.getItem("qdc." + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };

const S = {
  sesion: leer("sesion", null),          // {pin, nombre}
  catalogo: leer("catalogo", null),
  ruta: leer("ruta", null),
  cuentas: leer("cuentas", null),
  compras: leer("compras", null),
  reportes: leer("reportes", null),
  stock: leer("stock", null),            // stock con responsable (Fase 3)      // se bajan al abrir la pestaña (tardan unos segundos)
  reportesHora: leer("reportesHora", null),        // lo pedido al proveedor, para precargar Recibir
  cola: leer("cola", []),                // registros sin enviar
  errores: leer("errores", []),          // registros que el servidor rechazó
  actualizado: leer("actualizado", null),
  enLinea: navigator.onLine,
  enviando: false,
  tab: "inicio",
  vista: {},                             // estado de la pantalla actual
};

// ---------- Servidor ----------
async function llamar(datos) {
  const r = await fetch(API, { method: "POST", body: JSON.stringify(Object.assign({ pin: S.sesion && S.sesion.pin }, datos)) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ---------- Cola sin señal ----------
function encolar(reg) {
  reg.id = nuevoId();
  reg.creado = new Date().toISOString();
  S.cola.push(reg); guardar("cola", S.cola);
  aplicarLocal(reg);
  pintarSync();
  sincronizar();
}

// Refleja el registro en lo que se ve, sin esperar al servidor.
function aplicarLocal(reg) {
  if ((reg.tipo === "cobro") && S.cuentas) {
    const c = S.cuentas.cobrar.find(x => x.cliente === reg.cliente);
    if (c) { c.pagos.push({ fecha: hoyIso(), monto: reg.monto, por: S.sesion.nombre, local: true }); c.pagado += reg.monto; c.debe -= reg.monto; }
  }
  if (reg.tipo === "pago" && S.cuentas) {
    const p = S.cuentas.pagar.find(x => x.proveedor === reg.proveedor);
    if (p) { p.pagos.push({ fecha: hoyIso(), monto: reg.monto, por: S.sesion.nombre, local: true }); p.pagado += reg.monto; p.debe -= reg.monto; }
  }
  if (reg.tipo === "factura" && S.cuentas) {
    const p = S.cuentas.pagar.find(x => x.proveedor === reg.proveedor);
    if (p) {
      const i = p.sinFactura.findIndex(x => x.semana === reg.semana);
      const sem = i >= 0 ? p.sinFactura.splice(i, 1)[0] : { items: [], total: 0 };
      p.docs.push({ fecha: hoyIso(), semana: reg.semana, total: reg.monto, proyectado: sem.total, items: sem.items, avisos: avisosFactura(sem, reg.monto), local: true });
      p.facturado += reg.monto; p.debe += reg.monto;
    }
  }
  // Bolas entregadas sin recepción anotada: se ajusta al momento, sin esperar
  // al servidor (una entrega sube lo que falta; una recepción lo baja).
  if (S.compras && ["entrega", "venta", "recepcion"].includes(reg.tipo)) {
    const q = (reg.items || []).filter(i => norm(i.producto) === "bolas de queso").reduce((a, i) => a + num(i.cantidad), 0);
    if (q) {
      const b = S.compras.bolas || { faltan: 0 };
      b.faltan += reg.tipo === "recepcion" ? -q : q;
      S.compras.bolas = b.faltan > 0 ? b : null;
      guardar("compras", S.compras);
    }
  }
  if (reg.tipo === "stock" && S.stock) moverLocal(reg.socio, reg.items, reg.movimiento === "entrada" ? 1 : -1);
  if (reg.desdeStock && S.stock) moverLocal(reg.desdeStock, (reg.items || []).map(i => Object.assign({}, i, { cantidad: i.libras != null ? i.libras : i.cantidad })), -1);
  if (reg.tipo === "conteo" && S.stock) {
    const s = socioStock(reg.socio);
    if (s) { s.items = reg.items.map(i => ({ producto: i.producto, variante: i.presentacion || "", sabor: i.sabor || "", u: "", cantidad: i.cantidad })); s.conteo = hoyIso(); s.movimientos = []; guardar("stock", S.stock); }
  }
  if (reg.tipo === "entrega" && S.ruta) {
    const c = S.ruta.clientes.find(x => x.cliente === reg.cliente);
    if (c) c.entregado = true;
  }
  guardar("cuentas", S.cuentas); guardar("ruta", S.ruta);
}

async function sincronizar() {
  if (S.enviando || !S.sesion) return;
  S.enviando = true; pintarSync();
  try {
    while (S.cola.length) {
      const reg = S.cola[0];
      let r;
      try { r = await llamar(Object.assign({ accion: "registrar" }, reg)); }
      catch (e) { S.enLinea = false; break; }          // sin señal: se reintenta después
      S.enLinea = true;
      // PIN vencido (lo cambiaron en el servidor): el registro SE QUEDA en la
      // cola y se pide el PIN otra vez. Nunca se bota una venta por esto.
      if (r.pinInvalido) { S.sesion.pinVencido = true; guardar("sesion", S.sesion); S.vista = {}; break; }
      // Bloqueo por intentos: se queda en la cola y se reintenta más tarde.
      if (r.bloqueado) break;
      if (!r.ok) { S.errores.push({ reg, error: r.error || "El servidor no lo aceptó." }); }
      S.cola.shift(); guardar("cola", S.cola); guardar("errores", S.errores);
    }
    if (!S.cola.length && S.enLinea) await refrescar();
  } finally {
    S.enviando = false; pintarSync(); repintar();
  }
}

const repintar = () => { const a = document.activeElement; if (!a || a.tagName !== "INPUT") pintar(); };
async function refrescar() {
  try {
    // Las consultas van a la vez; cada una pinta apenas llega.
    const hoy = hoyIso();
    const pedirCatalogo = !S.catalogo || leer("catalogoDia", "") !== hoy;
    await Promise.all([
      pedirCatalogo && llamar({ accion: "catalogo" }).then(ca => { if (ca.ok) { S.catalogo = ca.catalogo; guardar("catalogo", S.catalogo); guardar("catalogoDia", hoy); repintar(); } }),
      llamar({ accion: "ruta" }).then(ru => { if (ru.ok) { S.ruta = ru.ruta; guardar("ruta", S.ruta); repintar(); } }),
      llamar({ accion: "cuentas" }).then(cu => { if (cu.ok) { S.cuentas = { cobrar: cu.cobrar, pagar: cu.pagar }; guardar("cuentas", S.cuentas); repintar(); } }),
      llamar({ accion: "compras" }).then(co => { if (co.ok) { S.compras = co.compras; guardar("compras", S.compras); repintar(); } }),
      llamar({ accion: "stock" }).then(st => { if (st.ok) { S.stock = st.stock; guardar("stock", S.stock); repintar(); } })
    ]);
    S.actualizado = new Date().toISOString(); guardar("actualizado", S.actualizado);
    S.enLinea = true;
  } catch (e) { S.enLinea = false; }
}

function pintarSync() {
  const b = $("#sync");
  if (!S.sesion) { b.hidden = true; return; }
  b.hidden = false;
  b.className = "sync";
  if (S.cola.length) { b.classList.add("pend"); b.textContent = (S.enviando ? "↻ " : "⏳ ") + S.cola.length + " sin enviar"; }
  else if (!S.enLinea) { b.classList.add("off"); b.textContent = "📴 Sin señal"; }
  else b.textContent = S.enviando ? "↻ Actualizando" : "✓ Al día";
}

// ---------- Utilidades de pantalla ----------
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2800); }
function header(t, s, back) { $("#title").textContent = t; $("#subtitle").textContent = s || ""; $("#back").hidden = !back; }
function ir(tab, vista) { S.tab = tab; S.vista = vista || {}; pintar(); window.scrollTo(0, 0); }
function conFoco(fn) {
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  fn();
  if (id) { const el = document.getElementById(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}
const actualizadoTxt = () => S.actualizado ? "Datos de las " + new Date(S.actualizado).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" }) : "Sin datos todavía";

function pintar() {
  $("#tabs").hidden = !S.sesion;
  $$("#tabs button").forEach(b => b.dataset.tab === S.tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (!S.sesion || S.sesion.pinVencido) { $("#tabs").hidden = true; return login(); }
  ({ inicio, pedido, ruta, recibir, cuentas, reportes, stock })[S.tab]();
}

// ---------- Login ----------
// Google "duerme" el servidor cuando no se usa y despertarlo tarda 5-25 s. Se
// despierta apenas aparece la pantalla del PIN, mientras la persona escribe.
let despertado = false;
function login() {
  if (!despertado) { despertado = true; fetch(API).catch(() => {}); }
  header("Quesos Don Carlos", window.QDC_CONFIG.AMBIENTE === "prueba" ? "Ambiente de PRUEBA" : "", false);
  const v = S.vista; v.pin = v.pin || "";
  $("#screen").innerHTML = `
    <img class="logo" src="icon-192.png" alt="">
    ${S.sesion && S.sesion.pinVencido ? `<div class="banner">Tu PIN ya no es válido (¿lo cambiaron?). Escríbelo de nuevo.${S.cola.length ? ` Hay <b>${S.cola.length}</b> registro${S.cola.length > 1 ? "s" : ""} esperando: se mandan solos al entrar.` : ""}</div>` : ""}
    <div class="hint" style="text-align:center">${v.verificando ? "Verificando…" : "Escribe tu PIN"}</div>
    <div class="pindots">${[0,1,2,3].map(i => `<span class="${i < v.pin.length ? "on" : ""}"></span>`).join("")}</div>
    ${v.error ? `<div class="hint bad" style="text-align:center">${esc(v.error)}</div>` : ""}
    <div class="pinpad" style="${v.verificando ? "opacity:.4" : ""}">${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k => k === "" ? "<span></span>" : `<button data-k="${k}" ${v.verificando ? "disabled" : ""}>${k}</button>`).join("")}</div>`;
  $$("[data-k]").forEach(b => b.onclick = async () => {
    // Mientras se verifica, el teclado no hace nada: antes se podía seguir
    // borrando y se guardaba el PIN a medio borrar (24 sep, "PIN incorrecto"
    // en la primera venta de Marcos).
    if (v.verificando) return;
    const k = b.dataset.k;
    if (k === "⌫") v.pin = v.pin.slice(0, -1); else if (v.pin.length < 8) v.pin += k;
    v.error = "";
    if (v.pin.length === 4) {
      const pin = v.pin;                 // el PIN que se manda es el que se guarda
      v.verificando = true; login();
      try {
        const r = await fetch(API, { method: "POST", body: JSON.stringify({ accion: "login", pin }) }).then(x => x.json());
        v.verificando = false;
        if (!r.ok) { v.error = r.error; v.pin = ""; return login(); }
        S.sesion = { pin, nombre: r.nombre }; guardar("sesion", S.sesion);
        // Entra de una: catálogo, cuentas y ruta se bajan detrás (sincronizar).
        S.enLinea = true; ir("inicio"); pintarSync(); sincronizar();
      } catch (e) { v.verificando = false; v.error = "Sin señal. Para entrar la primera vez hace falta internet."; v.pin = ""; login(); }
      return;
    }
    login();
  });
}

// ---------- Inicio ----------
function inicio() {
  const nombre = S.sesion.nombre.split(" ")[0];
  header("Quesos Don Carlos", "Hola, " + nombre, false);
  const v = S.vista;
  const deben = S.cuentas ? S.cuentas.cobrar.filter(c => c.debe > 0.005) : [];
  const nosDeben = deben.reduce((a, c) => a + c.debe, 0);
  const debemos = S.cuentas ? S.cuentas.pagar.reduce((a, p) => a + Math.max(p.debe, 0), 0) : 0;
  const pend = S.ruta ? S.ruta.clientes.filter(c => !c.entregado).length : 0;
  const avisos = avisosProveedor();
  $("#screen").innerHTML = `
    ${S.errores.length ? `<div class="banner bad">⚠️ ${S.errores.length} registro${S.errores.length > 1 ? "s" : ""} no se pudo guardar. <button class="add" id="verErr" style="margin-top:6px">Ver</button></div>` : ""}
    <div class="quick">
      <button class="qbtn" data-rap="cobro" aria-pressed="${v.rapido === "cobro"}">Cobrar<small>Me pagaron</small></button>
      <button class="qbtn" data-rap="pago" aria-pressed="${v.rapido === "pago"}">Pagar<small>A proveedor</small></button>
      <button class="qbtn" data-rap="gasto" aria-pressed="${v.rapido === "gasto"}">Gasto<small>Gasolina, etc.</small></button>
    </div>
    ${v.rapido ? panelRapido(v, deben) : ""}
    <div class="big">
      <button class="act primary" data-go="pedido"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><div><div class="t">Nuevo pedido</div><div class="d">Guardar o entregar</div></div></button>
      <button class="act" data-go="ruta"><svg viewBox="0 0 24 24"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7"/></svg><div><div class="t">Entregar</div><div class="d">${S.ruta ? pend + " pendientes en ruta" : "Ruta del domingo"}</div></div></button>
      <button class="act" data-go="recibir"><svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/></svg><div><div class="t">Recibir</div><div class="d">Compras, mercancía y factura de Ligui</div></div></button>
      <button class="act" data-go="cuentas"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg><div><div class="t">Cuentas</div><div class="d">Cobros y deudas pendientes</div></div></button>
    </div>
    ${S.compras && S.compras.bolas ? `<button class="banner bad" id="bolasSinRec" style="text-align:left;border:0;width:100%;cursor:pointer">⚠️ Van <b>${S.compras.bolas.faltan}</b> bola${S.compras.bolas.faltan === 1 ? "" : "s"} entregada${S.compras.bolas.faltan === 1 ? "" : "s"} esta semana sin recepción anotada. ¿Falta anotar lo que llegó? Toca para recibir ›</button>` : ""}
    ${avisoSinResponsable()}
    ${avisos.length ? `<button class="banner" id="verAvisos" style="text-align:left;border:0;width:100%;cursor:pointer">⚠️ ${avisos.length} aviso${avisos.length > 1 ? "s" : ""} con el proveedor: ${esc(avisos[0])} ›</button>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">Nos deben</div><div class="v">${S.cuentas ? fmt(nosDeben) : "—"}</div></div>
      <div class="stat"><div class="k">Le debemos</div><div class="v">${S.cuentas ? fmt(debemos) : "—"}</div></div>
    </div>
    <div class="hint">${actualizadoTxt()}${window.QDC_CONFIG.AMBIENTE === "prueba" ? " · Ambiente de PRUEBA (copia del Sheet)" : ""}</div>
    <button class="add" id="salir">Salir (cambiar de persona)</button>`;
  $$("[data-go]").forEach(b => b.onclick = () => ir(b.dataset.go));
  $$("[data-rap]").forEach(b => b.onclick = () => { v.rapido = v.rapido === b.dataset.rap ? null : b.dataset.rap; v.quien = null; v.monto = ""; v.desc = ""; inicio(); });
  const ve = $("#verErr"); if (ve) ve.onclick = () => ir("inicio", { errores: true });
  const va = $("#verAvisos"); if (va) va.onclick = () => ir("cuentas", { lado: "pagar" });
  const bs = $("#bolasSinRec"); if (bs) bs.onclick = () => ir("recibir", { modoInicial: "bolas" });
  cablearSinResponsable();
  $("#salir").onclick = () => {
    if (S.cola.length) { toast("Hay registros sin enviar. Espera a tener señal antes de salir."); return; }
    S.sesion = null; guardar("sesion", null); ir("inicio");
  };
  if (v.rapido) cablearRapido(v);
  if (v.errores) pintarErrores();
}

function panelRapido(v, deben) {
  const m = num(v.monto);
  if (v.rapido === "gasto") return `<div class="panel">
    <div class="field"><label for="gDesc">¿En qué?</label><input class="txt" id="gDesc" placeholder="Ej: gasolina ruta" value="${esc(v.desc)}"></div>
    <label class="monto"><span>RD$</span><input id="pgMonto" inputmode="decimal" placeholder="Monto" value="${esc(v.monto)}"></label>
    <div class="btns"><button class="go alt" id="pgCancelar">Cancelar</button><button class="go" id="pgOk" ${m > 0 && (v.desc || "").trim() ? "" : "disabled"}>Registrar gasto</button></div></div>`;
  const esCobro = v.rapido === "cobro";
  const lista = esCobro ? deben.map(c => ({ n: c.cliente, debe: c.debe })) : (S.cuentas ? S.cuentas.pagar.map(p => ({ n: p.proveedor, debe: p.debe })) : (S.catalogo ? S.catalogo.proveedores.map(n => ({ n, debe: null })) : []));
  const sel = lista.find(x => x.n === v.quien);
  return `<div class="panel">
    <div class="opt"><div class="k">${esCobro ? "¿Quién pagó?" : "¿A quién le pagaste?"}</div>
      <div class="chips">${lista.map(x => `<button class="chip sm" data-quien="${esc(x.n)}" aria-pressed="${v.quien === x.n}">${esc(x.n)}${x.debe != null ? " · " + fmt(x.debe) : ""}</button>`).join("") || `<span class="hint">${esCobro ? "Nadie debe nada 🎉" : "Sin proveedores"}</span>`}</div></div>
    ${v.quien ? `<div class="chips" style="align-items:center">
        ${sel && sel.debe > 0 ? `<button class="chip sm" id="pgTodo" aria-pressed="${m === sel.debe}">Todo · ${fmt(sel.debe)}</button>` : ""}
        <label class="monto"><span>RD$</span><input id="pgMonto" inputmode="decimal" placeholder="Otro monto" value="${esc(v.monto)}"></label></div>
      ${m > 0 && sel && sel.debe != null ? `<div class="efecto">${m >= sel.debe ? "Queda <b>al día</b>." : `Abono. ${esCobro ? "Queda debiendo" : "Le seguimos debiendo"} <b>${fmt(sel.debe - m)}</b>.`}</div>` : ""}
      <div class="btns"><button class="go alt" id="pgCancelar">Cancelar</button><button class="go" id="pgOk" ${m > 0 ? "" : "disabled"}>${esCobro ? "Registrar cobro" : "Registrar pago"}</button></div>` : ""}
  </div>`;
}

function cablearRapido(v, redibujar) {
  redibujar = redibujar || inicio;
  $$("[data-quien]").forEach(b => b.onclick = () => { v.quien = b.dataset.quien; v.monto = ""; redibujar(); });
  const t = $("#pgTodo"); if (t) t.onclick = () => { const x = (v.rapido === "cobro" ? S.cuentas.cobrar.find(c => c.cliente === v.quien) : S.cuentas.pagar.find(p => p.proveedor === v.quien)); v.monto = String(Math.round(x.debe * 100) / 100); redibujar(); };
  const mo = $("#pgMonto"); if (mo) mo.oninput = e => { v.monto = e.target.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); };
  const de = $("#gDesc"); if (de) de.oninput = e => { v.desc = e.target.value; conFoco(redibujar); };
  const ca = $("#pgCancelar"); if (ca) ca.onclick = () => { v.rapido = null; v.pagando = false; redibujar(); };
  const ok = $("#pgOk"); if (ok) ok.onclick = () => {
    const monto = num(v.monto);
    if (v.rapido === "gasto") { encolar({ tipo: "gasto", descripcion: v.desc.trim(), monto }); toast("✅ Gasto guardado"); }
    else if (v.rapido === "cobro") { encolar({ tipo: "cobro", cliente: v.quien, monto }); toast(`✅ Cobro de ${v.quien} · ${fmt(monto)}`); }
    else { encolar({ tipo: "pago", proveedor: v.quien, monto }); toast(`✅ Pago a ${v.quien} · ${fmt(monto)}`); }
    v.rapido = null; v.pagando = false; redibujar();
  };
}

function pintarErrores() {
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `<div class="k" style="font-weight:700">No se guardaron (revísalos y vuelve a registrarlos):</div>` +
    S.errores.map((e, i) => `<div class="card"><div>${esc(describir(e.reg))}</div><div class="hint bad">${esc(e.error)}</div>
      <div class="btns"><button class="go" data-reint="${i}">Reintentar</button><button class="go alt" data-desc="${i}">Descartar</button></div></div>`).join("");
  $("#screen").prepend(box);
  const quitar = i => { const e = S.errores.splice(i, 1)[0]; guardar("errores", S.errores); return e; };
  $$("[data-reint]").forEach(b => b.onclick = () => {
    const e = quitar(+b.dataset.reint);
    S.cola.push(e.reg); guardar("cola", S.cola);   // mismo id: si ya hubiera entrado, el servidor no lo duplica
    toast("Reintentando…"); ir("inicio", S.errores.length ? { errores: true } : {}); sincronizar();
  });
  $$("[data-desc]").forEach(b => b.onclick = () => { quitar(+b.dataset.desc); ir("inicio", S.errores.length ? { errores: true } : {}); });
}
function describir(r) {
  if (r.tipo === "cobro") return `Cobro de ${r.cliente} · ${fmt(r.monto)}`;
  if (r.tipo === "pago") return `Pago a ${r.proveedor} · ${fmt(r.monto)}`;
  if (r.tipo === "gasto") return `Gasto ${r.descripcion} · ${fmt(r.monto)}`;
  if (r.tipo === "factura") return `Factura de ${r.proveedor} (semana del ${fecha(r.semana)}) · ${fmt(r.monto)}`;
  if (r.tipo === "stock") return `${(MOV[r.movimiento] || {}).t || r.movimiento} · ${r.socio}: ` + (r.items || []).map(i => `${i.cantidad} ${i.producto}`).join(", ");
  if (r.tipo === "conteo") return `Conteo de ${r.socio}`;
  if (r.tipo === "recepcion") return "Recibido: " + (r.items || []).map(i => `${i.cantidad} ${i.producto}`).join(", ");
  return `${{ pedido: "Pedido", venta: "Venta", entrega: "Entrega" }[r.tipo]} de ${r.cliente}: ` + (r.items || []).map(i => `${i.cantidad} ${i.producto}`).join(", ");
}

// ---------- Catálogo ----------
const prodCat = n => (S.catalogo.productos || []).find(p => norm(p.nombre) === norm(n));
function precioDe(producto, presentacion, dist) {
  const p = prodCat(producto); if (!p) return 0;
  const pr = presentacion ? (p.presentaciones.find(x => norm(x.nombre) === norm(presentacion)) || {}) : p;
  // dist: true = Distribución, false = Contado, "compra" = costo (Recibir).
  return (dist === "compra" ? pr.compra : dist ? pr.distribucion : pr.contado) || 0;
}
const descLinea = l => [l.producto, l.presentacion, l.sabor].filter(Boolean).join(" · ");

// ---------- Selector de productos (Pedido y Entregas) ----------
// Cada combinación producto + presentación + sabor tiene su propio ➖/➕. El
// yogur: se elige la presentación y debajo salen TODOS los sabores, cada uno
// con su cantidad (varios sabores en el mismo pedido sin repetir pasos).
// En Entregas se ve lo que pidió el cliente y se puede agregar lo que no pidió.
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const mismaLinea = (l, p, pr, s) => norm(l.producto) === norm(p) && norm(l.presentacion) === norm(pr) && norm(l.sabor) === norm(s);
const idDe = k => "q" + Array.from(k).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

function totalLineas(lineas, dist) {
  let total = 0, faltaPeso = false;
  for (const l of lineas) {
    const q = num(l.cantidad); if (!q) continue;
    const p = prodCat(l.producto);
    if (p && p.porLibra) { const lb = num(l.libras); if (lb > 0) total += lb * precioDe(l.producto, l.presentacion, dist); else faltaPeso = true; }
    else total += q * precioDe(l.producto, l.presentacion, dist);
  }
  return { total, faltaPeso, hay: lineas.some(l => num(l.cantidad) > 0) };
}

function selector(v, dist, esEntrega) {
  v.abierto = v.abierto || {};
  const filas = [];   // para cablear después
  const fila = (p, pr, s, etiqueta) => {
    const l = v.lineas.find(x => mismaLinea(x, p.nombre, pr, s));
    const q = l ? l.cantidad : "";
    const k = [p.nombre, pr, s].join("|");
    const id = idDe(k);
    filas.push({ k, p: p.nombre, pr, s, id });
    const precio = precioDe(p.nombre, pr, dist);
    const falta = p.porLibra && num(q) > 0 && !(num(l && l.libras) > 0);
    return `<div class="ln" style="${num(q) > 0 ? "" : "opacity:.85"}">
      <div><div class="d">${esc(etiqueta)}</div><div class="x">${precio ? fmt(precio) + (p.porLibra ? "/lb" : " c/u") : ""}${l && l.nota ? ` · ${esc(l.nota)}` : esEntrega && l && l.pedido ? ` · pidió ${l.pedido}` : ""}</div></div>
      <div class="ctl">
        <div class="step"><button data-menos="${esc(k)}" aria-label="Menos">−</button><input class="qty" id="${id}" inputmode="decimal" placeholder="0" value="${esc(num(q) ? q : "")}" data-cant="${esc(k)}" aria-label="Cantidad"><button data-mas="${esc(k)}" aria-label="Más">+</button></div>
        ${p.porLibra && num(q) > 0 ? `<label class="lb"><input id="${id}lb" class="${falta ? "need" : ""}" inputmode="decimal" placeholder="0.0" value="${esc(l.libras)}" data-lbs="${esc(k)}" aria-label="Libras"><span>lb</span></label>` : ""}
      </div></div>`;
  };
  const html = S.catalogo.productos.map(p => {
    const mias = v.lineas.filter(l => norm(l.producto) === norm(p.nombre) && num(l.cantidad) > 0);
    const cuantos = mias.reduce((a, l) => a + num(l.cantidad), 0);
    let cuerpo = "";
    if (p.sabores && p.presentaciones.length) {
      const conCant = pr => v.lineas.filter(l => norm(l.producto) === norm(p.nombre) && norm(l.presentacion) === norm(pr) && num(l.cantidad) > 0).reduce((a, l) => a + num(l.cantidad), 0);
      const abierta = v.abierto[p.nombre] || (p.presentaciones.find(x => conCant(x.nombre)) || p.presentaciones[0]).nombre;
      cuerpo = `<div class="chips">${p.presentaciones.map(x => { const c = conCant(x.nombre); return `<button class="chip sm" data-abrir="${esc(p.nombre)}|${esc(x.nombre)}" aria-pressed="${norm(abierta) === norm(x.nombre)}">${esc(x.nombre)}${c ? " · " + c : ""}</button>`; }).join("")}</div>
        <div class="lines">${S.catalogo.sabores.map(s => fila(p, abierta, s, s)).join("")}</div>`;
    } else if (p.presentaciones.length) {
      cuerpo = `<div class="lines">${p.presentaciones.map(x => fila(p, x.nombre, "", x.nombre)).join("")}</div>`;
    } else {
      cuerpo = `<div class="lines">${fila(p, "", "", "Cantidad")}</div>`;
    }
    return `<div class="prod ${cuantos ? "on" : ""}">
      <div class="ph"><div><div class="n">${esc(p.nombre)}</div><div class="p">${cuantos ? "Llevas " + cuantos + (p.porLibra ? " (el precio sale de las libras)" : "") : p.porLibra ? "Por libra" : ""}</div></div></div>
      ${cuerpo}</div>`;
  }).join("");
  // Lo que pidió el cliente pero ya no está en el catálogo (raro): se muestra igual.
  const huerfanas = v.lineas.filter(l => !prodCat(l.producto) && !S.catalogo.productos.some(p => norm(p.nombre) === norm(l.producto)));
  const extra = huerfanas.length ? `<div class="prod on"><div class="n">Otros</div><div class="lines">${huerfanas.map(l => fila({ nombre: l.producto, porLibra: false }, l.presentacion || "", l.sabor || "", descLinea(l))).join("")}</div></div>` : "";
  return { html: `<div class="prods">${html}${extra}</div>`, filas };
}

function cablearSelector(v, filas, redibujar, esEntrega) {
  const buscar = k => filas.find(f => f.k === k);
  const linea = (f, crear) => {
    let l = v.lineas.find(x => mismaLinea(x, f.p, f.pr, f.s));
    if (!l && crear) { l = { producto: f.p, presentacion: f.pr, sabor: f.s, cantidad: 0, libras: "" }; v.lineas.push(l); }
    return l;
  };
  const limpiar = l => { if (l && !num(l.cantidad) && !(esEntrega && l.pedido)) v.lineas.splice(v.lineas.indexOf(l), 1); };
  $$("[data-mas]").forEach(b => b.onclick = () => { const l = linea(buscar(b.dataset.mas), true); l.cantidad = num(l.cantidad) + 1; redibujar(); });
  $$("[data-menos]").forEach(b => b.onclick = () => { const l = linea(buscar(b.dataset.menos), false); if (!l) return; l.cantidad = Math.max(0, num(l.cantidad) - 1); limpiar(l); redibujar(); });
  $$("[data-cant]").forEach(inp => inp.oninput = () => { const l = linea(buscar(inp.dataset.cant), true); l.cantidad = inp.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); });
  $$("[data-cant]").forEach(inp => inp.onblur = () => { const l = linea(buscar(inp.dataset.cant), false); if (l && !num(l.cantidad)) { limpiar(l); redibujar(); } });
  $$("[data-lbs]").forEach(inp => inp.oninput = () => { const l = linea(buscar(inp.dataset.lbs), true); l.libras = inp.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); });
  $$("[data-abrir]").forEach(b => b.onclick = () => { const [p, pr] = b.dataset.abrir.split("|"); v.abierto[p] = pr; redibujar(); });
}

// ---------- Pedido ----------
function pedido() {
  if (!S.catalogo) { header("Nuevo pedido", "", true); $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando lista de productos…" : "Hace falta señal una vez para bajar la lista de productos."}</div>`; return; }
  const v = S.vista; v.lineas = v.lineas || [];
  header("Nuevo pedido", "Guárdalo para la ruta, o entrégalo ya", true);
  const clientes = S.catalogo.clientes;
  const dist = !v.otro && !!v.cliente;
  const { total, faltaPeso, hay } = totalLineas(v.lineas, dist);
  const quien = v.otro ? ((v.ref || "").trim() || "Contado") : v.cliente;
  const sel = selector(v, dist, false);
  $("#screen").innerHTML = `
    <div class="label">Cliente</div>
    <div class="chips">
      ${clientes.map(c => `<button class="chip" data-c="${esc(c)}" aria-pressed="${!v.otro && v.cliente === c}">${esc(c)}</button>`).join("")}
      <button class="chip otro" id="otro" aria-pressed="${!!v.otro}">+ Otro</button>
    </div>
    ${v.otro ? `<div class="field"><label for="ref">Nombre o referencia (opcional)</label><input class="txt" id="ref" placeholder="Ej: señora del colmado" value="${esc(v.ref)}"></div>` : ""}
    ${quien ? `<div>${dist ? `<span class="tag dist">Distribución</span> <span class="hint">está en la lista de clientes</span>` : `<span class="tag cont">Contado</span> <span class="hint">no está en la lista de clientes</span>`}</div>` : ""}
    <div class="label">Productos</div>
    ${sel.html}
    ${faltaPeso ? `<div class="hint">⚖️ Los quesos por libra sin peso no entran en el total. Para <b>Entregar pedido</b> hace falta el peso.</div>` : ""}
    <div class="hint">El total es una guía: el precio final lo pone el servidor (incluye precios especiales por cliente).</div>
    ${hay && quien ? bloqueDesde(v) : ""}
    <div class="confirm">
      <div class="tot"><span class="k">Total estimado</span><span class="v">${fmt(total)}</span></div>
      <div class="btns">
        <button class="go alt" id="guardar" ${hay && quien ? "" : "disabled"}>Guardar pedido</button>
        <button class="go" id="entregar" ${hay && quien && !faltaPeso && !(v.desde && faltaEnStock(v)) ? "" : "disabled"}>${faltaPeso && hay ? "Falta el peso" : "Entregar pedido"}</button>
      </div>
    </div>`;
  $$("[data-c]").forEach(b => b.onclick = () => { v.cliente = b.dataset.c; v.otro = false; pedido(); });
  $("#otro").onclick = () => { v.otro = true; v.cliente = null; pedido(); setTimeout(() => $("#ref") && $("#ref").focus(), 0); };
  const ref = $("#ref"); if (ref) ref.oninput = e => { v.ref = e.target.value; conFoco(pedido); };
  cablearSelector(v, sel.filas, pedido, false);
  cablearDesde(v, pedido);
  const fin = tipo => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const it = { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: num(l.cantidad) };
      if (prodCat(l.producto) && prodCat(l.producto).porLibra && num(l.libras) > 0) it.libras = num(l.libras);
      return it;
    });
    // "Guardar pedido" no saca nada del stock: solo la entrega al momento.
    encolar(Object.assign({ tipo, cliente: quien, items }, tipo === "venta" && v.desde ? { desdeStock: v.desde } : {}));
    toast(tipo === "venta" ? `✅ Entregado a ${quien}${v.desde ? " (del stock de " + v.desde + ")" : ""}` : `✅ Pedido de ${quien} guardado`);
    ir("inicio");
  };
  $("#guardar").onclick = () => fin("pedido");
  $("#entregar").onclick = () => fin("venta");
}

// ---------- Entregas (ruta del domingo) ----------
function ruta() {
  const v = S.vista;
  if (!S.ruta) { header("Ruta de entrega", "", true); $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando ruta…" : "Hace falta señal una vez para bajar la ruta."}</div>`; return; }
  if (v.cliente) return entrega();
  const cl = S.ruta.clientes, hechos = cl.filter(c => c.entregado).length;
  header("Ruta de entrega", S.ruta.etiqueta, true);
  if (hechos) prepararFactura().catch(() => {});
  $("#screen").innerHTML = `
    <div class="hint">${hechos} de ${cl.length} entregados. ${actualizadoTxt().replace(/.$/, "")}.${hechos ? " Toca un entregado para compartir su factura." : ""}</div>
    <div class="rows">${cl.length ? cl.map((c, i) => `
      <button class="row ${c.entregado ? "done" : ""}" data-i="${i}">
        <div><div class="nm" style="font-weight:700">${esc(c.cliente)}</div><div class="s">${c.items.map(it => it.cantidad + " " + esc(descLinea(it).toLowerCase())).join(" · ")}</div></div>
        <div class="r">${c.entregado ? `<span class="pill">${facturaRuta(c.cliente) ? "🧾 Factura" : "Entregado"}</span>` : `<span class="pill w">Pendiente</span>`} ›</div>
      </button>`).join("") : `<div class="row">No hay pedidos para esta ruta.</div>`}</div>`;
  $$("[data-i]").forEach(b => b.onclick = () => {
    const c = cl[+b.dataset.i];
    if (c.entregado) {
      const f = facturaRuta(c.cliente);
      if (f) compartirFacturaCliente(c.cliente, f);
      else toast(S.cola.length ? "La factura sale cuando se envíe la entrega (hace falta señal)." : `${c.cliente} ya tiene entrega esta semana`);
      return;
    }
    ir("ruta", { cliente: c.cliente, lineas: c.items.map(it => ({ producto: it.producto, presentacion: it.presentacion, sabor: it.sabor, cantidad: it.cantidad, libras: "", pedido: it.cantidad })) });
  });
}

// La factura de la semana de esta ruta (una por cliente por semana).
const facturaRuta = cliente => S.ruta && facturasDe(cliente).find(f => f.semana === S.ruta.domingo);

function entrega() {
  const v = S.vista, dist = S.catalogo && S.catalogo.clientes.includes(v.cliente);
  header("Entregar a " + v.cliente, "Ya viene con lo que pidió: ajusta o agrega", true);
  if (!S.catalogo) { $("#screen").innerHTML = `<div class="hint">Cargando lista de productos…</div>`; return; }
  const { total, faltaPeso, hay } = totalLineas(v.lineas, dist);
  const sel = selector(v, dist, true);
  $("#screen").innerHTML = `
    <div class="hint">Lo que pidió ya viene cargado ("pidió N"). Cambia cantidades con ➖/➕ o escribiéndolas, y agrega lo que no pidió.</div>
    ${sel.html}
    ${faltaPeso ? `<div class="hint warn">⚖️ Escribe las libras que marcó la balanza. El precio sale del peso, no de las barras.</div>` : ""}
    ${hay ? bloqueDesde(v) : ""}
    <div class="confirm">
      <div class="tot"><span class="k">Factura estimada</span><span class="v">${fmt(total)}</span></div>
      <div class="btns"><button class="go" id="conf" ${hay && !faltaPeso && !(v.desde && faltaEnStock(v)) ? "" : "disabled"}>${faltaPeso ? "Falta el peso" : "Confirmar entrega"}</button></div>
    </div>`;
  cablearSelector(v, sel.filas, entrega, true);
  cablearDesde(v, entrega);
  $("#conf").onclick = () => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const p = prodCat(l.producto);
      // En la entrega, un queso por libra se registra por las LIBRAS (así cobra el bot).
      return { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: p && p.porLibra ? num(l.libras) : num(l.cantidad) };
    });
    encolar(Object.assign({ tipo: "entrega", cliente: v.cliente, items }, v.desde ? { desdeStock: v.desde } : {}));
    toast(`✅ Entrega de ${v.cliente} guardada${v.desde ? " (del stock de " + v.desde + ")" : ""}`);
    ir("ruta");
  };
}

// ---------- Recibir (mercancía del proveedor) ----------
// Lo que llega esta semana (domingo + jueves) es lo que se pidió la semana
// anterior. Viene precargado con lo que falta por llegar (pedido − ya
// recibido); se corrige lo que llegó distinto. Se guarda con el mismo comando
// "recibido …" del bot, a precio de compra. Quien recibe = el del PIN.
function recibir() {
  const v = S.vista;
  if (v.factura) return factura();
  if (v.lista) return listaCompras();
  if (!S.catalogo) { header("Recibir", "", true); $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando lista de productos…" : "Hace falta señal una vez para bajar la lista de productos."}</div>`; return; }
  if (!v.lineas) precargarRecibir(v, v.modoInicial || "todo");
  header("Recibir mercancía", "Lo recibe " + S.sesion.nombre.split(" ")[0], true);
  const { total, faltaPeso, hay } = totalLineas(v.lineas, "compra");
  const sel = selector(v, "compra", true);
  const sinFac = S.cuentas ? S.cuentas.pagar.reduce((a, p) => a + p.sinFactura.length, 0) : 0;
  $("#screen").innerHTML = `
    <button class="act" id="irLista" style="min-height:0;flex-direction:row;align-items:center;width:100%"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 11h11L21 7H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg><div><div class="t" style="font-size:17px">Lista de compras</div><div class="d">Lo pedido esta semana, para mandarlo por WhatsApp</div></div></button>
    <div class="seg"><button data-modo="todo" aria-pressed="${v.modo === "todo"}">Todo lo pedido</button><button data-modo="bolas" aria-pressed="${v.modo === "bolas"}">Solo bolas (jueves)</button></div>
    <div class="hint">${S.compras ? `Viene cargado con lo que falta por llegar de lo pedido la semana del ${fecha(S.compras.pedidosDe)}. Corrige lo que llegó distinto y agrega lo que no se pidió.` : "Sin la lista de lo pedido (hace falta señal una vez). Anota lo que llegó."}</div>
    ${sel.html}
    ${faltaPeso ? `<div class="hint warn">⚖️ Los quesos por libra se reciben por las libras de la balanza, no por las barras.</div>` : ""}
    <div class="confirm">
      <div class="tot"><span class="k">Costo estimado</span><span class="v">${fmt(total)}</span></div>
      <div class="btns"><button class="go" id="guardarRec" ${hay && !faltaPeso ? "" : "disabled"}>${faltaPeso && hay ? "Falta el peso" : "Guardar recepción"}</button></div>
    </div>
    <button class="act" id="irFactura" style="min-height:0;flex-direction:row;align-items:center;width:100%;margin-top:12px"><svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg><div><div class="t" style="font-size:17px">Anotar factura de Ligui</div><div class="d">${sinFac ? sinFac + " semana" + (sinFac > 1 ? "s" : "") + " esperando factura" : "Llega el domingo después del jueves"}</div></div></button>`;
  $$("[data-modo]").forEach(b => b.onclick = () => { precargarRecibir(v, b.dataset.modo); recibir(); });
  cablearSelector(v, sel.filas, recibir, true);
  $("#irFactura").onclick = () => ir("recibir", { factura: true });
  $("#irLista").onclick = () => ir("recibir", { lista: true });
  $("#guardarRec").onclick = () => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const p = prodCat(l.producto);
      // Por libra: se recibe por las LIBRAS (así calcula el costo el bot).
      return { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: p && p.porLibra ? num(l.libras) : num(l.cantidad) };
    });
    encolar({ tipo: "recepcion", items });
    toast("✅ Recepción guardada");
    ir("inicio");
  };
}

function precargarRecibir(v, modo) {
  v.modo = modo;
  const items = (S.compras ? S.compras.items : []).filter(it => modo === "todo" || norm(it.producto) === "bolas de queso");
  v.lineas = items.map(it => {
    const p = prodCat(it.producto), lb = p && p.porLibra;
    // Por libra se pide en barras y se recibe en libras: no se puede restar.
    const falta = lb ? (it.recibido > 0 ? 0 : it.pedido) : Math.max(0, Math.round((it.pedido - it.recibido) * 100) / 100);
    const ya = Math.round(it.recibido * 100) / 100;
    return { producto: it.producto, presentacion: it.presentacion, sabor: it.sabor, cantidad: falta, libras: "", pedido: it.pedido,
             nota: `pidieron ${it.pedido}${ya ? " · ya llegó " + ya + (lb ? " lb" : "") : ""}` };
  }).filter(l => l.cantidad > 0 || modo === "bolas");
  if (modo === "bolas" && !v.lineas.length) v.lineas = [{ producto: "Bolas de queso", presentacion: "", sabor: "", cantidad: 0, libras: "", pedido: 1, nota: "" }];
}

// ---------- Lista de compras (WhatsApp) ----------
// La misma lista que "lista de compras" del bot (appListaCompras en Api.js):
// lo pedido esta semana, que se compra el sábado. Se copia o se comparte como
// texto de WhatsApp (*negrita*), con los nombres bien escritos.
function textoListaCompras(l) {
  const a = new Date(l.semana + "T12:00:00"), b = new Date(a); b.setDate(b.getDate() + 6);
  const cant = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  let t = `*🛒 Lista de compras · Quesos Don Carlos*\nPedidos del ${a.getDate()}${a.getMonth() === b.getMonth() ? "" : " " + MESES[a.getMonth()]} al ${b.getDate()} ${MESES[b.getMonth()]}\n`;
  for (const it of l.items) {
    t += `\n*${pdfNombre([it.producto, it.presentacion.toLowerCase()].filter(Boolean).join(" "))}:* ${cant(it.total)}`;
    for (const s of it.sabores) t += `\n   • ${s.sabor}: ${cant(s.cantidad)}`;
  }
  return t;
}

function listaCompras() {
  const l = S.compras && S.compras.lista;
  header("Lista de compras", l ? "Pedidos de la semana del " + fecha(l.semana) : "", true);
  if (!l) { $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando lista…" : "Hace falta señal una vez para bajar la lista."}</div>`; return; }
  // El texto del bot tal cual (la plantilla que ya usan). El armado propio
  // queda solo de respaldo si el servidor todavía no lo manda.
  const texto = l.items.length ? (l.texto || textoListaCompras(l)) : "";
  $("#screen").innerHTML = `
    <div class="hint">La misma lista que <b>lista de compras</b> del bot: lo pedido esta semana (sin las ventas al momento). ${actualizadoTxt()}.</div>
    ${l.items.length ? `<div class="card"><pre style="white-space:pre-wrap;font:15px/1.5 var(--body);margin:0">${esc(texto.replace(/\*/g, ""))}</pre></div>
    <div class="btns"><button class="go" id="copiar">Copiar para WhatsApp</button><button class="go alt" id="compartirLista">Compartir</button></div>`
    : `<div class="row">Todavía no hay pedidos esta semana.</div>`}`;
  const co = $("#copiar"); if (co) co.onclick = async () => {
    try { await navigator.clipboard.writeText(texto); toast("✅ Copiada: pégala en WhatsApp"); }
    catch (e) { toast("No se pudo copiar. Usa Compartir."); }
  };
  const sh = $("#compartirLista"); if (sh) sh.onclick = async () => {
    if (navigator.share) { try { await navigator.share({ text: texto }); } catch (e) { /* canceló */ } }
    else { try { await navigator.clipboard.writeText(texto); toast("✅ Copiada: pégala en WhatsApp"); } catch (e) { toast("No se pudo compartir."); } }
  };
}

// ---------- Factura del proveedor ----------
// Nadie dice qué semana cubre: de domingo a miércoles es la semana que cerró
// (la factura llega el domingo después del jueves); de jueves a sábado, la
// semana en curso. Misma regla que semanaCubiertaPorFactura (Facturas.js).
// La semana viaja con el registro: si se manda días después sin señal, no cambia.
function semanaDeFactura(d) {
  d = d || new Date();
  const dom = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  if (d.getDay() < 4) dom.setDate(dom.getDate() - 7);
  const p = n => String(n).padStart(2, "0");
  return `${dom.getFullYear()}-${p(dom.getMonth() + 1)}-${p(dom.getDate())}`;
}
// Mismo margen que el servidor: RD$500 o 1%, lo que sea mayor.
const margenFactura = m => Math.max(500, Math.abs(m) * 0.01);
function avisosFactura(sem, monto) {
  const av = (sem.avisos || []).filter(t => !/Falta la factura/.test(t));
  if (monto > 0 && Math.abs(sem.total - monto) > margenFactura(monto))
    av.push(`La factura no cuadra: ${fmt(Math.abs(sem.total - monto))} ${monto > sem.total ? "más" : "menos"} que lo proyectado. Si Bululú cambió un precio, hay que actualizar el Precio Compra.`);
  return av;
}

function factura() {
  const v = S.vista;
  const provs = S.cuentas ? S.cuentas.pagar : [];
  v.prov = v.prov || (provs[0] && provs[0].proveedor);
  const p = provs.find(x => x.proveedor === v.prov);
  const semana = semanaDeFactura();
  const dom = new Date(semana + "T12:00:00"), jue = new Date(dom); jue.setDate(jue.getDate() + 4);
  header("Factura de " + (v.prov || "proveedor"), `Semana del ${fecha(semana)} (dom ${dom.getDate()} + jue ${jue.getDate()})`, true);
  if (!p) { $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando cuentas…" : "Hace falta señal una vez para bajar las cuentas."}</div>`; return; }
  const yaTiene = p.docs.find(d => d.semana === semana);
  const sem = p.sinFactura.find(x => x.semana === semana) || { semana, items: [], total: 0, avisos: [] };
  const m = num(v.monto);
  const avisos = avisosFactura(sem, m);
  if (!sem.items.length && !yaTiene) avisos.unshift(`No hay nada recibido en la semana del ${fecha(semana)}. Anota primero lo que llegó.`);
  $("#screen").innerHTML = `
    ${provs.length > 1 ? `<div class="chips">${provs.map(x => `<button class="chip sm" data-prov="${esc(x.proveedor)}" aria-pressed="${x.proveedor === v.prov}">${esc(x.proveedor)}</button>`).join("")}</div>` : ""}
    ${yaTiene ? `<div class="banner bad">Ya hay una factura de ${fmt(yaTiene.total)} para esta semana (anotada el ${fecha(yaTiene.fecha)}). Si esta es otra, revísalo antes de guardar.</div>` : ""}
    <div class="card"><div style="overflow-x:auto"><table class="tabla">
      <thead><tr><th>Recibido</th><th>Cant.</th><th>Subtotal</th></tr></thead><tbody>
      ${sem.items.map(it => `<tr><td>${esc(it.d)}</td><td>${cantTxt(it)}</td><td>${fmt(it.total)}</td></tr>`).join("") || `<tr><td colspan="3" class="hint">Nada recibido esta semana.</td></tr>`}
      <tr class="tot"><td>Proyectado</td><td></td><td>${fmt(sem.total)}</td></tr></tbody></table></div></div>
    <div class="label">Monto de la factura</div>
    <label class="monto"><span>RD$</span><input id="facMonto" inputmode="decimal" placeholder="Lo que dice la factura" value="${esc(v.monto)}"></label>
    ${m > 0 ? `<div class="efecto">${Math.abs(sem.total - m) < 0.005 ? "✅ Cuadra exacto con lo proyectado." : sem.total > m ? `🟢 Facturaron ${fmt(sem.total - m)} menos de lo proyectado.` : `🔴 Facturaron ${fmt(m - sem.total)} más de lo proyectado.`}</div>` : ""}
    ${avisos.map(t => `<div class="banner">⚠️ ${esc(t)}</div>`).join("")}
    <div class="hint">La diferencia no bloquea: se guarda igual y el aviso queda para revisarlo. Buena práctica: manda la foto de la factura de Bululú al grupo.</div>
    <div class="btns"><button class="go" id="facOk" ${m > 0 ? "" : "disabled"}>Guardar factura</button></div>`;
  $$("[data-prov]").forEach(b => b.onclick = () => { v.prov = b.dataset.prov; factura(); });
  $("#facMonto").oninput = e => { v.monto = e.target.value.replace(/[^0-9.,]/g, ""); conFoco(factura); };
  $("#facOk").onclick = () => {
    encolar({ tipo: "factura", proveedor: v.prov, monto: m, semana });
    toast(`✅ Factura de ${v.prov} · ${fmt(m)}`);
    ir("cuentas", { lado: "pagar" });
  };
}

// Avisos abiertos con el proveedor (facturas que no cuadran, recepciones que
// faltan, semanas sin factura). Los calcula el servidor; aquí solo se muestran.
// Solo las últimas 3 semanas: lo más viejo lo revisa el chequeo del lunes, y
// lo que se decide ignorar se cierra allá con su conclusión.
function avisosProveedor() {
  if (!S.cuentas) return [];
  const desde = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const p of S.cuentas.pagar) {
    for (const d of p.docs) if ((d.semana || d.fecha) >= desde) for (const t of d.avisos || []) out.push(`Factura de la semana del ${fecha(d.semana)}: ${t}`);
    for (const s of p.sinFactura) if (s.semana >= desde) for (const t of s.avisos || []) out.push(`Semana del ${fecha(s.semana)}: ${t}`);
  }
  return out;
}

// ---------- Facturas del cliente (PDF, ver factura.js) ----------
function facturasDe(cliente) {
  const c = S.cuentas && S.cuentas.cobrar.find(x => norm(x.cliente) === norm(cliente));
  return (c && c.facturas) || [];
}
function bloqueFacturas(cliente) {
  const fs = facturasDe(cliente).slice().sort((a, b) => b.semana.localeCompare(a.semana));
  if (!fs.length) return "";
  prepararFactura().catch(() => {});
  return `<div class="label">Facturas para compartir</div>
    <div class="rows">${fs.map((f, i) => `<button class="row" data-pdf="${i}"><div><div style="font-weight:700">🧾 ${esc(f.num)}</div><div class="s">${esc(fecha(f.semana))} · ${f.items.length} producto${f.items.length === 1 ? "" : "s"}</div></div><div class="r">${fmt(f.total)} · PDF ›</div></button>`).join("")}</div>`;
}
function cablearFacturas(cliente) {
  const fs = facturasDe(cliente).slice().sort((a, b) => b.semana.localeCompare(a.semana));
  $$("[data-pdf]").forEach(b => b.onclick = () => compartirFacturaCliente(cliente, fs[+b.dataset.pdf]));
}
// Balance para el pie de la factura, con los mismos números de Cuentas:
// anterior = entregado ANTES de esa semana − todo lo pagado hasta hoy;
// pagar = entregado hasta el final de esa semana − todo lo pagado.
// (Una factura vieja no suma lo entregado en semanas después de ella.)
function saldoFactura(cliente, semana) {
  const c = S.cuentas && S.cuentas.cobrar.find(x => norm(x.cliente) === norm(cliente));
  if (!c) return null;
  const fin = new Date(semana + "T12:00:00"); fin.setDate(fin.getDate() + 6);
  const finIso = fin.toISOString().slice(0, 10);
  const totalDoc = d => d.items.reduce((a, it) => a + it.total, 0);
  const antes = c.docs.filter(d => d.fecha < semana).reduce((a, d) => a + totalDoc(d), 0);
  const hasta = c.docs.filter(d => d.fecha <= finIso).reduce((a, d) => a + totalDoc(d), 0);
  const pagado = c.pagos.reduce((a, p) => a + p.monto, 0);
  const r = n => Math.round(n * 100) / 100;
  return { anterior: r(antes - pagado), pagar: r(hasta - pagado) };
}
const compartirFacturaCliente = (cliente, f) => compartirFactura(Object.assign({}, f, { saldo: saldoFactura(cliente, f.semana) }));

// ---------- Cuentas: 4 niveles, pagos FIFO ----------
function analizar(docs, pagos) {
  const D = docs.map((d, i) => ({ i, d, total: d.total != null ? d.total : d.items.reduce((a, it) => a + it.total, 0), pagado: 0, aplicados: [] }))
    .sort((a, b) => a.d.fecha.localeCompare(b.d.fecha) || a.i - b.i);
  const P = pagos.map((p, i) => ({ i, p, aplica: [] })).sort((a, b) => a.p.fecha.localeCompare(b.p.fecha) || a.i - b.i);
  for (const p of P) {
    let resto = p.p.monto;
    for (const d of D) { if (resto <= 0.005) break; const falta = d.total - d.pagado; if (falta <= 0.005) continue;
      const usa = Math.min(falta, resto); d.pagado += usa; resto -= usa; p.aplica.push({ d, monto: usa }); d.aplicados.push({ p, monto: usa }); }
    p.aFavor = resto;
  }
  const hoy = new Date();
  for (const d of D) { d.pend = d.total - d.pagado; d.estado = d.pend <= 0.005 ? "Pagada" : d.pagado > 0.005 ? "Parcial" : "Pendiente"; d.dias = Math.round((hoy - new Date(d.d.fecha + "T12:00:00")) / 864e5); }
  const abiertas = D.filter(d => d.pend > 0.005);
  return { D, P, abiertas, dias: abiertas.length ? abiertas[0].dias : 0 };
}
const pillEstado = e => `<span class="pill ${e === "Pagada" ? "" : e === "Parcial" ? "w" : "r"}">${e}</span>`;
const diasTxt = d => d > 14 ? `<span style="color:var(--bad);font-weight:700">hace ${d} días</span>` : `hace ${d} días`;
const cantTxt = it => (Number.isInteger(it.q) ? it.q : Number(it.q).toFixed(2).replace(/\.?0+$/, "")) + (it.u ? " " + it.u : "");

function cuentas() {
  const v = S.vista; v.lado = v.lado || "cobrar";
  if (!S.cuentas) { header("Cuentas", "", true); $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando cuentas…" : "Hace falta señal una vez para bajar las cuentas."}</div>`; return; }
  if (v.quien) return ({ deuda: ctaDeuda, hist: ctaHist, det: ctaDet })[v.nivel || "deuda"]();
  const cobrar = v.lado === "cobrar";
  const filas = cobrar ? S.cuentas.cobrar.map(c => ({ n: c.cliente, c })) : S.cuentas.pagar.map(p => ({ n: p.proveedor, c: p }));
  const conDeuda = filas.filter(x => x.c.debe > 0.005).sort((a, b) => b.c.debe - a.c.debe);
  // Al día, de mayor a menor venta promedio por semana desde el corte (el
  // total se divide entre TODAS las semanas desde el corte, no solo las que
  // compró: el que compra seguido va arriba). Proveedores: como estaban.
  const corte = (S.reportes && S.reportes.cobranza && S.reportes.cobranza.desde) || "2026-08-30";
  const semanasCorte = Math.max(1, Math.ceil((Date.now() - new Date(corte + "T00:00:00")) / (7 * 864e5)));
  const vendidoDesde = c => c.docs.filter(d => d.fecha >= corte).reduce((a, d) => a + d.items.reduce((s, it) => s + it.total, 0), 0);
  // Fuera: los que nunca se facturaron ni pagaron nada ("Dañada", "Inventario":
  // desechos/conteos de junio anotados como entregas a RD$0). Regla, no lista.
  const fantasma = c => !c.pagos.length && c.docs.every(d => d.items.every(it => !(Math.abs(it.total) > 0.005)));
  const alDia = filas.filter(x => x.c.debe <= 0.005 && !(cobrar && fantasma(x.c))).map(x => Object.assign(x, cobrar ? { tot: vendidoDesde(x.c), prom: vendidoDesde(x.c) / semanasCorte } : {}))
    .sort((a, b) => cobrar ? b.prom - a.prom : 0);
  const total = conDeuda.reduce((a, x) => a + x.c.debe, 0);
  header(cobrar ? "Cobros pendientes" : "Deudas pendientes", actualizadoTxt(), true);
  $("#screen").innerHTML = `
    <div class="seg"><button data-lado="cobrar" aria-pressed="${cobrar}">Cobros pendientes</button><button data-lado="pagar" aria-pressed="${!cobrar}">Deudas pendientes</button></div>
    <div class="stat"><div class="k">${cobrar ? "Total por cobrar" : "Total por pagar"}</div><div class="v">${fmt(total)}</div></div>
    <div class="rows">${conDeuda.map(x => { const a = analizar(docsDe(x.c, cobrar), x.c.pagos); return `
      <button class="row" data-q="${esc(x.n)}"><div><div style="font-weight:700">${esc(x.n)}</div><div class="s">${a.abiertas.length} factura${a.abiertas.length === 1 ? "" : "s"} abierta${a.abiertas.length === 1 ? "" : "s"}${a.abiertas.length ? " · la más vieja " + diasTxt(a.dias) : ""}</div></div><div class="r">${fmt(x.c.debe)} ›</div></button>`; }).join("") || `<div class="row">${cobrar ? "Nadie nos debe nada 🎉" : "No le debemos nada a nadie 🎉"}</div>`}</div>
    ${!cobrar ? S.cuentas.pagar.filter(p => p.sinFactura.length).map(p => `<div class="banner">📦 A ${esc(p.proveedor)}: recibido sin factura todavía ${fmt(p.sinFactura.reduce((a, s) => a + s.total, 0))} (${p.sinFactura.map(s => "semana del " + fecha(s.semana)).join(", ")}). No suma a la deuda hasta que llegue la factura.</div>`).join("") : ""}
    ${!cobrar ? avisosProveedor().map(t => `<div class="banner">⚠️ ${esc(t)}</div>`).join("") : ""}
    ${alDia.length ? `<details><summary class="hint">${cobrar ? "Clientes" : "Proveedores"} al día (${alDia.length})</summary><div class="rows" style="margin-top:8px">${cobrar ? `<div class="hint">De mayor a menor venta promedio por semana desde el corte (${fecha(corte)}).</div>` : ""}${alDia.map((x, i) => cobrar
      ? (x.tot > 0.5
        ? `<button class="row" data-qh="${esc(x.n)}"><div><div style="font-weight:700">#${i + 1} ${esc(x.n)}</div><div class="s">${fmt(x.tot)} desde el corte</div></div><div class="r">${fmt(Math.round(x.prom))}/sem <span class="pill">Al día</span> ›</div></button>`
        : `<button class="row" data-qh="${esc(x.n)}"><div><div style="font-weight:700">${esc(x.n)}</div><div class="s">sin compras desde el corte</div></div><div class="r"><span class="pill">Al día</span> ›</div></button>`)
      : `<button class="row" data-qh="${esc(x.n)}"><div style="font-weight:700">${esc(x.n)}</div><div class="r"><span class="pill">Al día</span> ›</div></button>`).join("")}</div></details>` : ""}`;
  $$("[data-lado]").forEach(b => b.onclick = () => ir("cuentas", { lado: b.dataset.lado }));
  $$("[data-q]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: b.dataset.q, nivel: "deuda" }));
  $$("[data-qh]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: b.dataset.qh, nivel: "hist" }));
}
function cuentaSel() { const v = S.vista; return v.lado === "cobrar" ? S.cuentas.cobrar.find(c => c.cliente === v.quien) : S.cuentas.pagar.find(p => p.proveedor === v.quien); }
function docsDe(c, cobrar) {
  return cobrar ? c.docs.map(d => ({ fecha: d.fecha, n: "Entrega del " + fecha(d.fecha), items: d.items.map(it => ({ d: it.d, q: it.q, u: it.u, total: it.total })) }))
                : c.docs.map(d => ({ fecha: d.fecha, n: "Factura del " + fecha(d.fecha), total: d.total, items: d.items, semana: d.semana, avisos: d.avisos || [] }));
}

function ctaDeuda() {
  const v = S.vista, cobrar = v.lado === "cobrar", c = cuentaSel(); if (!c) return ir("cuentas", { lado: v.lado });
  const a = analizar(docsDe(c, cobrar), c.pagos);
  header(v.quien, cobrar ? "Lo que nos debe" : "Lo que le debemos", true);
  const g = {}, orden = [];
  for (const d of a.abiertas) for (const it of d.d.items) { const k = it.d + "|" + it.u + "|" + (it.q ? (it.total / it.q).toFixed(2) : 0); if (!g[k]) { g[k] = { d: it.d, u: it.u, q: 0, total: 0 }; orden.push(k); } g[k].q += it.q; g[k].total += it.total; }
  const sub = a.abiertas.reduce((s, d) => s + d.total, 0), abonos = a.abiertas.reduce((s, d) => s + d.pagado, 0);
  const sinDetalle = a.abiertas.some(d => !d.d.items.length);
  v.rapido = cobrar ? "cobro" : "pago";
  $("#screen").innerHTML = `
    <div class="stat"><div class="k">${cobrar ? "Debe" : "Le debemos"}</div><div class="v" style="color:var(--warn)">${fmt(c.debe)}</div>
      <div class="hint">${a.abiertas.length} factura${a.abiertas.length === 1 ? "" : "s"} abierta${a.abiertas.length === 1 ? "" : "s"}${a.abiertas.length ? " · la más vieja " + diasTxt(a.dias) : ""}</div></div>
    ${v.pagando ? `<div class="panel">${pagoInline(v, c)}</div>` : `<div class="btns"><button class="go" id="pagarYa">${cobrar ? "Registrar cobro" : "Registrar pago"}</button><button class="go alt" id="verHist">Ver histórico</button></div>`}
    <div class="label">Qué se debe, por producto</div>
    <div class="card"><div style="overflow-x:auto"><table class="tabla">
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
      ${orden.map(k => { const it = g[k]; return `<tr><td>${esc(it.d)}</td><td>${cantTxt(it)}</td><td>${it.q ? fmt(it.total / it.q) + (it.u ? "/" + it.u : "") : ""}</td><td>${fmt(it.total)}</td></tr>`; }).join("")}
      ${sinDetalle ? `<tr><td colspan="4" class="hint">Hay facturas sin detalle de productos (la del punto de partida).</td></tr>` : ""}
      ${abonos > 0.005 ? `<tr class="sum"><td>Facturas abiertas</td><td></td><td></td><td>${fmt(sub)}</td></tr><tr class="sum"><td>Abonos ya aplicados</td><td></td><td></td><td>−${fmt(abonos)}</td></tr>` : ""}
      <tr class="tot"><td>Pendiente</td><td></td><td></td><td>${fmt(c.debe)}</td></tr></tbody></table></div></div>
    <div class="label">Facturas abiertas</div>
    <div class="rows">${a.abiertas.map(d => `<button class="row" data-det="${d.i}"><div><div style="font-weight:700">${esc(d.d.n)}</div><div class="s">Total ${fmt(d.total)}${d.pagado > 0.005 ? " · abonado " + fmt(d.pagado) : ""}</div></div><div class="r">${pillEstado(d.estado)} ${fmt(d.pend)} ›</div></button>`).join("")}</div>
    ${cobrar ? bloqueFacturas(v.quien) : ""}`;
  const py = $("#pagarYa"); if (py) py.onclick = () => { v.pagando = true; v.quien2 = v.quien; v.monto = ""; ctaDeuda(); };
  const vh = $("#verHist"); if (vh) vh.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "hist" });
  $$("[data-det]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", doc: +b.dataset.det, desde: "deuda" }));
  if (cobrar) cablearFacturas(v.quien);
  if (v.pagando) cablearPagoInline(v, c, ctaDeuda);
}
function pagoInline(v, c) {
  const m = num(v.monto), cobrar = v.lado === "cobrar";
  return `<div class="k" style="font-weight:700">${cobrar ? `¿Cuánto pagó ${esc(v.quien)}?` : `¿Cuánto le pagaste a ${esc(v.quien)}?`}</div>
    <div class="chips" style="align-items:center"><button class="chip sm" id="pgTodo" aria-pressed="${Math.abs(m - c.debe) < 0.005}">Todo · ${fmt(c.debe)}</button>
    <label class="monto"><span>RD$</span><input id="pgMonto" inputmode="decimal" placeholder="Otro monto" value="${esc(v.monto)}"></label></div>
    ${m > 0 ? `<div class="efecto">${m >= c.debe - 0.005 ? "Queda <b>al día</b>." : `Abono. ${cobrar ? "Queda debiendo" : "Le seguimos debiendo"} <b>${fmt(c.debe - m)}</b>. Se aplica a la factura más vieja primero.`}</div>` : ""}
    <div class="btns"><button class="go alt" id="pgCancelar">Cancelar</button><button class="go" id="pgOk" ${m > 0 ? "" : "disabled"}>${cobrar ? "Registrar cobro" : "Registrar pago"}</button></div>`;
}
function cablearPagoInline(v, c, redibujar) {
  $("#pgTodo").onclick = () => { v.monto = String(Math.round(c.debe * 100) / 100); redibujar(); };
  $("#pgMonto").oninput = e => { v.monto = e.target.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); };
  $("#pgCancelar").onclick = () => { v.pagando = false; redibujar(); };
  $("#pgOk").onclick = () => {
    const monto = num(v.monto);
    if (v.lado === "cobrar") { encolar({ tipo: "cobro", cliente: v.quien, monto }); toast(`✅ Cobro de ${v.quien} · ${fmt(monto)}`); }
    else { encolar({ tipo: "pago", proveedor: v.quien, monto }); toast(`✅ Pago a ${v.quien} · ${fmt(monto)}`); }
    v.pagando = false; redibujar();
  };
}

function ctaHist() {
  const v = S.vista, cobrar = v.lado === "cobrar", c = cuentaSel(); if (!c) return ir("cuentas", { lado: v.lado });
  const a = analizar(docsDe(c, cobrar), c.pagos);
  header("Histórico · " + v.quien, c.debe > 0.005 ? (cobrar ? "Debe " : "Le debemos ") + fmt(c.debe) : "Al día", true);
  const filas = [...a.D.map(d => ({ f: d.d.fecha, d })), ...a.P.map(p => ({ f: p.p.fecha, p }))].sort((x, y) => y.f.localeCompare(x.f));
  $("#screen").innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><div class="k">Facturado</div><div class="v" style="font-size:17px">${fmt(c.facturado)}</div></div>
      <div class="stat"><div class="k">Pagado</div><div class="v" style="font-size:17px">${fmt(c.pagado)}</div></div>
      <div class="stat"><div class="k">${cobrar ? "Debe" : "Debemos"}</div><div class="v" style="font-size:17px;color:${c.debe > 0.005 ? "var(--warn)" : "var(--ok)"}">${fmt(Math.max(c.debe, 0))}</div></div>
    </div>
    ${cobrar ? bloqueFacturas(v.quien) + `<div class="label">Movimientos</div>` : `<div class="hint">Desde el punto de partida (${fecha(c.desde)}).</div>`}
    <div class="rows">${filas.map(x => x.d ? `
      <button class="row" data-det="${x.d.i}"><div><div style="font-weight:700">${fecha(x.f)}</div><div class="s">${cobrar ? "Entrega" : "Factura"} · ${x.d.d.items.length} producto${x.d.d.items.length === 1 ? "" : "s"}</div></div><div class="r">${pillEstado(x.d.estado)} ${fmt(x.d.total)} ›</div></button>` : `
      <button class="row" data-pag="${x.p.i}"><div><div style="font-weight:700">${fecha(x.f)}</div><div class="s">${cobrar ? "Pago recibido" : "Pago hecho"}${x.p.p.por ? " · " + esc(x.p.p.por) : ""}${x.p.p.local ? " · ⏳ sin enviar" : ""}</div></div><div class="r" style="color:var(--ok)">−${fmt(x.p.p.monto)} ›</div></button>`).join("")}</div>`;
  $$("[data-det]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", doc: +b.dataset.det, desde: "hist" }));
  $$("[data-pag]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", pago: +b.dataset.pag, desde: "hist" }));
  if (cobrar) cablearFacturas(v.quien);
}

function ctaDet() {
  const v = S.vista, cobrar = v.lado === "cobrar", c = cuentaSel(); if (!c) return ir("cuentas", { lado: v.lado });
  const a = analizar(docsDe(c, cobrar), c.pagos);
  if (v.pago != null) {
    const p = a.P.find(x => x.i === v.pago);
    header(cobrar ? "Pago recibido" : "Pago hecho", v.quien + " · " + fecha(p.p.fecha), true);
    $("#screen").innerHTML = `
      <div class="stat"><div class="k">Monto</div><div class="v" style="color:var(--ok)">${fmt(p.p.monto)}</div><div class="hint">${p.p.por ? (cobrar ? "Lo recibió " : "Lo pagó ") + esc(p.p.por) : ""}</div></div>
      <div class="label">Se aplicó a</div>
      <div class="rows">${p.aplica.map(ap => `<div class="row"><div><div style="font-weight:700">${esc(ap.d.d.n)}</div><div class="s">total ${fmt(ap.d.total)}</div></div><div class="r">${fmt(ap.monto)}</div></div>`).join("") || `<div class="row">No había facturas abiertas.</div>`}</div>
      ${p.aFavor > 0.005 ? `<div class="hint">Quedaron ${fmt(p.aFavor)} a favor.</div>` : ""}
      <div class="hint">Los pagos se aplican a la factura más vieja primero.</div>`;
    return;
  }
  const d = a.D.find(x => x.i === v.doc);
  header(d.d.n, v.quien + (d.d.semana ? " · cubre la semana del " + fecha(d.d.semana) : ""), true);
  $("#screen").innerHTML = `
    ${(d.d.avisos || []).map(t => `<div class="banner">⚠️ ${esc(t)}</div>`).join("")}
    <div class="card"><div style="overflow-x:auto"><table class="tabla">
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
      ${d.d.items.map(it => `<tr><td>${esc(it.d)}</td><td>${cantTxt(it)}</td><td>${it.q ? fmt(it.total / it.q) + (it.u ? "/" + it.u : "") : ""}</td><td>${fmt(it.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="hint">Sin detalle de productos.</td></tr>`}
      ${!cobrar && d.d.items.length && Math.abs(d.d.items.reduce((s, it) => s + it.total, 0) - d.total) > 1 ? `<tr class="sum"><td>Proyectado (recibido a costo)</td><td></td><td></td><td>${fmt(d.d.items.reduce((s, it) => s + it.total, 0))}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td></td><td></td><td>${fmt(d.total)}</td></tr></tbody></table></div></div>
    <div class="card">
      <div class="line"><b>Estado</b>${pillEstado(d.estado)}</div>
      ${d.aplicados.map(ap => `<div class="line"><span>Pago del ${fecha(ap.p.p.fecha)}${ap.p.p.por ? " · " + esc(ap.p.p.por) : ""}</span><span style="color:var(--ok)">−${fmt(ap.monto)}</span></div>`).join("") || `<div class="hint">Sin pagos todavía.</div>`}
      <div class="line t"><span>Pendiente</span><span>${fmt(Math.max(d.pend, 0))}</span></div>
    </div>`;
}

// ---------- Navegación ----------
$$("#tabs button").forEach(b => b.onclick = () => ir(b.dataset.tab));
$("#back").onclick = () => {
  const v = S.vista;
  if (S.tab === "cuentas" && v.quien) {
    if (v.nivel === "det") return ir("cuentas", { lado: v.lado, quien: v.quien, nivel: v.desde || "deuda" });
    if (v.nivel === "hist" && cuentaSel() && cuentaSel().debe > 0.005) return ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "deuda" });
    return ir("cuentas", { lado: v.lado });
  }
  if (S.tab === "ruta" && v.cliente) return ir("ruta");
  if (S.tab === "recibir" && (v.factura || v.lista)) return ir("recibir");
  if (S.tab === "stock" && (v.mov || v.conteo || v.asignar)) return ir("stock", { socio: v.socio });
  ir("inicio");
};
$("#sync").onclick = () => { if (!S.enviando) { toast("Actualizando…"); sincronizar(); } };
window.addEventListener("online", () => { S.enLinea = true; sincronizar(); });
window.addEventListener("offline", () => { S.enLinea = false; pintarSync(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });
setInterval(() => { if (S.cola.length) sincronizar(); }, 30000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
pintar(); pintarSync();
if (S.sesion) sincronizar();
