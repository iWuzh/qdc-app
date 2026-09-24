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
    S.enviando = false; pintarSync(); pintar();
  }
}

async function refrescar() {
  try {
    const [cu, ru] = await Promise.all([llamar({ accion: "cuentas" }), llamar({ accion: "ruta" })]);
    if (cu.ok) { S.cuentas = { cobrar: cu.cobrar, pagar: cu.pagar }; guardar("cuentas", S.cuentas); }
    if (ru.ok) { S.ruta = ru.ruta; guardar("ruta", S.ruta); }
    const hoy = hoyIso();
    if (!S.catalogo || leer("catalogoDia", "") !== hoy) {
      const ca = await llamar({ accion: "catalogo" });
      if (ca.ok) { S.catalogo = ca.catalogo; guardar("catalogo", S.catalogo); guardar("catalogoDia", hoy); }
    }
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
  ({ inicio, pedido, ruta, cuentas })[S.tab]();
}

// ---------- Login ----------
function login() {
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
        S.catalogo = r.catalogo; guardar("catalogo", S.catalogo); guardar("catalogoDia", hoyIso());
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
      <button class="act" data-go="cuentas" style="grid-column:1/-1;min-height:0;flex-direction:row;align-items:center"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg><div><div class="t">Cuentas</div><div class="d">Cobros y deudas pendientes</div></div></button>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Nos deben</div><div class="v">${S.cuentas ? fmt(nosDeben) : "—"}</div></div>
      <div class="stat"><div class="k">Le debemos</div><div class="v">${S.cuentas ? fmt(debemos) : "—"}</div></div>
    </div>
    <div class="hint">${actualizadoTxt()}${window.QDC_CONFIG.AMBIENTE === "prueba" ? " · Ambiente de PRUEBA (copia del Sheet)" : ""}</div>
    <button class="add" id="salir">Salir (cambiar de persona)</button>`;
  $$("[data-go]").forEach(b => b.onclick = () => ir(b.dataset.go));
  $$("[data-rap]").forEach(b => b.onclick = () => { v.rapido = v.rapido === b.dataset.rap ? null : b.dataset.rap; v.quien = null; v.monto = ""; v.desc = ""; inicio(); });
  const ve = $("#verErr"); if (ve) ve.onclick = () => ir("inicio", { errores: true });
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
  return `${{ pedido: "Pedido", venta: "Venta", entrega: "Entrega" }[r.tipo]} de ${r.cliente}: ` + (r.items || []).map(i => `${i.cantidad} ${i.producto}`).join(", ");
}

// ---------- Catálogo ----------
const prodCat = n => (S.catalogo.productos || []).find(p => p.nombre === n);
function precioDe(producto, presentacion, dist) {
  const p = prodCat(producto); if (!p) return 0;
  const pr = presentacion ? (p.presentaciones.find(x => x.nombre === presentacion) || {}) : p;
  return (dist ? pr.distribucion : pr.contado) || 0;
}
const descLinea = l => [l.producto, l.presentacion, l.sabor].filter(Boolean).join(" · ");

// ---------- Pedido ----------
function pedido() {
  if (!S.catalogo) { header("Nuevo pedido", "", true); $("#screen").innerHTML = `<div class="hint">Hace falta señal una vez para bajar la lista de productos.</div>`; return; }
  const v = S.vista; v.lineas = v.lineas || []; v.pick = v.pick || {};
  header("Nuevo pedido", "Guárdalo para la ruta, o entrégalo ya", true);
  const clientes = S.catalogo.clientes;
  const dist = !v.otro && !!v.cliente;
  let total = 0, faltaPeso = false, sinPeso = false;
  for (const l of v.lineas) {
    const q = num(l.cantidad); if (!q) continue;
    const p = prodCat(l.producto);
    if (p && p.porLibra) { const lb = num(l.libras); if (lb > 0) total += lb * precioDe(l.producto, l.presentacion, dist); else { faltaPeso = true; sinPeso = true; } }
    else total += q * precioDe(l.producto, l.presentacion, dist);
  }
  const hay = v.lineas.some(l => num(l.cantidad) > 0);
  const quien = v.otro ? ((v.ref || "").trim() || "Contado") : v.cliente;
  $("#screen").innerHTML = `
    <div class="label">Cliente</div>
    <div class="chips">
      ${clientes.map(c => `<button class="chip" data-c="${esc(c)}" aria-pressed="${!v.otro && v.cliente === c}">${esc(c)}</button>`).join("")}
      <button class="chip otro" id="otro" aria-pressed="${!!v.otro}">+ Otro</button>
    </div>
    ${v.otro ? `<div class="field"><label for="ref">Nombre o referencia (opcional)</label><input class="txt" id="ref" placeholder="Ej: señora del colmado" value="${esc(v.ref)}"></div>` : ""}
    ${quien ? `<div>${dist ? `<span class="tag dist">Distribución</span> <span class="hint">está en la lista de clientes</span>` : `<span class="tag cont">Contado</span> <span class="hint">no está en la lista de clientes</span>`}</div>` : ""}
    <div class="label">Productos</div>
    <div class="prods">
      ${S.catalogo.productos.map(p => {
        const mias = v.lineas.map((l, i) => [l, i]).filter(([l]) => l.producto === p.nombre);
        const pk = v.pick[p.nombre] || {};
        const opc = p.presentaciones.length || p.sabores;
        const listo = (!p.presentaciones.length || pk.presentacion) && (!p.sabores || pk.sabor);
        return `<div class="prod ${mias.length ? "on" : ""}">
          <div class="ph"><div><div class="n">${esc(p.nombre)}</div><div class="p">${p.porLibra ? "Por libra" : p.presentaciones.length ? "Según presentación" : fmt(dist ? p.distribucion : p.contado) + " c/u"}</div></div>
            ${!opc && !mias.length ? `<button class="add" data-add="${esc(p.nombre)}">+ Agregar</button>` : ""}</div>
          ${p.presentaciones.length ? `<div class="opt"><div class="k">Presentación</div><div class="chips">${p.presentaciones.map(x => `<button class="chip sm" data-pv="${esc(p.nombre)}|${esc(x.nombre)}" aria-pressed="${pk.presentacion === x.nombre}">${esc(x.nombre)}</button>`).join("")}</div></div>` : ""}
          ${p.sabores ? `<div class="opt"><div class="k">Sabor</div><div class="chips">${S.catalogo.sabores.map(s => `<button class="chip sm" data-ps="${esc(p.nombre)}|${esc(s)}" aria-pressed="${pk.sabor === s}">${esc(s)}</button>`).join("")}</div></div>` : ""}
          ${opc ? `<button class="add" data-add="${esc(p.nombre)}" ${listo ? "" : "disabled"}>${listo ? "+ Agregar " + esc([pk.presentacion, pk.sabor].filter(Boolean).join(" · ")) : (p.presentaciones.length && p.sabores ? "Elige presentación y sabor" : p.sabores ? "Elige el sabor" : "Elige presentación")}</button>` : ""}
          ${mias.map(([l, i]) => lineaHTML(l, i, p, dist)).join("")}
        </div>`;
      }).join("")}
    </div>
    ${sinPeso ? `<div class="hint">⚖️ Los quesos por libra sin peso no entran en el total. Para <b>Entregar pedido</b> hace falta el peso.</div>` : ""}
    <div class="hint">El total es una guía: el precio final lo pone el servidor (incluye precios especiales por cliente).</div>
    <div class="confirm">
      <div class="tot"><span class="k">Total estimado</span><span class="v">${fmt(total)}</span></div>
      <div class="btns">
        <button class="go alt" id="guardar" ${hay && quien ? "" : "disabled"}>Guardar pedido</button>
        <button class="go" id="entregar" ${hay && quien && !faltaPeso ? "" : "disabled"}>${faltaPeso && hay ? "Falta el peso" : "Entregar pedido"}</button>
      </div>
    </div>`;
  $$("[data-c]").forEach(b => b.onclick = () => { v.cliente = b.dataset.c; v.otro = false; pedido(); });
  $("#otro").onclick = () => { v.otro = true; v.cliente = null; pedido(); setTimeout(() => $("#ref") && $("#ref").focus(), 0); };
  const ref = $("#ref"); if (ref) ref.oninput = e => { v.ref = e.target.value; conFoco(pedido); };
  $$("[data-pv]").forEach(b => b.onclick = () => { const [n, x] = b.dataset.pv.split("|"); v.pick[n] = Object.assign({}, v.pick[n], { presentacion: x }); pedido(); });
  $$("[data-ps]").forEach(b => b.onclick = () => { const [n, x] = b.dataset.ps.split("|"); v.pick[n] = Object.assign({}, v.pick[n], { sabor: x }); pedido(); });
  $$("[data-add]").forEach(b => b.onclick = () => {
    const n = b.dataset.add, pk = v.pick[n] || {};
    const ex = v.lineas.find(l => l.producto === n && l.presentacion === pk.presentacion && l.sabor === pk.sabor);
    if (ex) ex.cantidad = num(ex.cantidad) + 1; else v.lineas.push({ producto: n, presentacion: pk.presentacion, sabor: pk.sabor, cantidad: 1, libras: "" });
    v.pick[n] = {}; pedido();
  });
  cablearLineas(v.lineas, pedido, true);
  const fin = tipo => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const it = { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: num(l.cantidad) };
      if (prodCat(l.producto) && prodCat(l.producto).porLibra && num(l.libras) > 0) it.libras = num(l.libras);
      return it;
    });
    encolar({ tipo, cliente: quien, items });
    toast(tipo === "venta" ? `✅ Entregado a ${quien}` : `✅ Pedido de ${quien} guardado`);
    ir("inicio");
  };
  $("#guardar").onclick = () => fin("pedido");
  $("#entregar").onclick = () => fin("venta");
}

function lineaHTML(l, i, p, dist) {
  const lb = p && p.porLibra, falta = lb && !(num(l.libras) > 0);
  return `<div class="ln">
    <div><div class="d">${esc([l.presentacion, l.sabor].filter(Boolean).join(" · ") || l.producto)}</div><div class="x">${lb ? fmt(precioDe(l.producto, l.presentacion, dist)) + "/lb" : fmt(precioDe(l.producto, l.presentacion, dist)) + " c/u"}</div></div>
    <div class="ctl">
      <div class="step"><button data-m="${i}" aria-label="Menos">−</button><input class="qty" id="q${i}" inputmode="decimal" value="${esc(l.cantidad)}" data-q="${i}" aria-label="Cantidad"><button data-p="${i}" aria-label="Más">+</button></div>
      ${lb ? `<label class="lb"><input id="lb${i}" class="${falta ? "need" : ""}" inputmode="decimal" placeholder="0.0" value="${esc(l.libras)}" data-lb="${i}" aria-label="Libras"><span>lb</span></label>` : ""}
    </div></div>`;
}

function cablearLineas(lineas, redibujar, quitarEnCero) {
  $$("[data-p]").forEach(b => b.onclick = () => { const l = lineas[+b.dataset.p]; l.cantidad = num(l.cantidad) + 1; redibujar(); });
  $$("[data-m]").forEach(b => b.onclick = () => { const i = +b.dataset.m, l = lineas[i]; l.cantidad = Math.max(0, num(l.cantidad) - 1); if (!l.cantidad && quitarEnCero) lineas.splice(i, 1); redibujar(); });
  $$("[data-q]").forEach(inp => inp.oninput = () => { lineas[+inp.dataset.q].cantidad = inp.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); });
  $$("[data-lb]").forEach(inp => inp.oninput = () => { lineas[+inp.dataset.lb].libras = inp.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); });
}

// ---------- Entregas (ruta del domingo) ----------
function ruta() {
  const v = S.vista;
  if (!S.ruta) { header("Ruta de entrega", "", true); $("#screen").innerHTML = `<div class="hint">Hace falta señal una vez para bajar la ruta.</div>`; return; }
  if (v.cliente) return entrega();
  const cl = S.ruta.clientes, hechos = cl.filter(c => c.entregado).length;
  header("Ruta de entrega", S.ruta.etiqueta, true);
  $("#screen").innerHTML = `
    <div class="hint">${hechos} de ${cl.length} entregados. ${actualizadoTxt()}.</div>
    <div class="rows">${cl.length ? cl.map((c, i) => `
      <button class="row ${c.entregado ? "done" : ""}" data-i="${i}">
        <div><div class="nm" style="font-weight:700">${esc(c.cliente)}</div><div class="s">${c.items.map(it => it.cantidad + " " + esc(descLinea(it).toLowerCase())).join(" · ")}</div></div>
        <div class="r">${c.entregado ? `<span class="pill">Entregado</span>` : `<span class="pill w">Pendiente</span>`} ›</div>
      </button>`).join("") : `<div class="row">No hay pedidos para esta ruta.</div>`}</div>`;
  $$("[data-i]").forEach(b => b.onclick = () => {
    const c = cl[+b.dataset.i];
    if (c.entregado) { toast(`${c.cliente} ya tiene entrega esta semana`); return; }
    ir("ruta", { cliente: c.cliente, lineas: c.items.map(it => ({ producto: it.producto, presentacion: it.presentacion, sabor: it.sabor, cantidad: it.cantidad, libras: "", pedido: it.cantidad })) });
  });
}

function entrega() {
  const v = S.vista, dist = S.catalogo && S.catalogo.clientes.includes(v.cliente);
  header("Entregar a " + v.cliente, "Lo que pidió la semana pasada", true);
  let total = 0, faltaPeso = false;
  for (const l of v.lineas) {
    const p = prodCat(l.producto);
    if (p && p.porLibra) { if (num(l.cantidad) > 0) { const lb = num(l.libras); if (lb > 0) total += lb * precioDe(l.producto, l.presentacion, dist); else faltaPeso = true; } }
    else total += num(l.cantidad) * precioDe(l.producto, l.presentacion, dist);
  }
  const hay = v.lineas.some(l => num(l.cantidad) > 0);
  $("#screen").innerHTML = `
    <div class="hint">Ajusta si dejaste más o menos: con ➖/➕ o escribiendo el número.</div>
    <div class="prods">${v.lineas.map((l, i) => `<div class="prod on"><div class="n">${esc(l.producto)}</div>${lineaHTML(l, i, prodCat(l.producto), dist)}</div>`).join("")}</div>
    ${faltaPeso ? `<div class="hint warn">⚖️ Escribe las libras que marcó la balanza. El precio sale del peso, no de las barras.</div>` : ""}
    <div class="confirm">
      <div class="tot"><span class="k">Factura estimada</span><span class="v">${fmt(total)}</span></div>
      <div class="btns"><button class="go" id="conf" ${hay && !faltaPeso ? "" : "disabled"}>${faltaPeso ? "Falta el peso" : "Confirmar entrega"}</button></div>
    </div>`;
  cablearLineas(v.lineas, entrega, false);
  $("#conf").onclick = () => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const p = prodCat(l.producto);
      // En la entrega, un queso por libra se registra por las LIBRAS (así cobra el bot).
      return { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: p && p.porLibra ? num(l.libras) : num(l.cantidad) };
    });
    encolar({ tipo: "entrega", cliente: v.cliente, items });
    toast(`✅ Entrega de ${v.cliente} guardada`);
    ir("ruta");
  };
}

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
  if (!S.cuentas) { header("Cuentas", "", true); $("#screen").innerHTML = `<div class="hint">Hace falta señal una vez para bajar las cuentas.</div>`; return; }
  if (v.quien) return ({ deuda: ctaDeuda, hist: ctaHist, det: ctaDet })[v.nivel || "deuda"]();
  const cobrar = v.lado === "cobrar";
  const filas = cobrar ? S.cuentas.cobrar.map(c => ({ n: c.cliente, c })) : S.cuentas.pagar.map(p => ({ n: p.proveedor, c: p }));
  const conDeuda = filas.filter(x => x.c.debe > 0.005).sort((a, b) => b.c.debe - a.c.debe);
  const alDia = filas.filter(x => x.c.debe <= 0.005);
  const total = conDeuda.reduce((a, x) => a + x.c.debe, 0);
  header(cobrar ? "Cobros pendientes" : "Deudas pendientes", actualizadoTxt(), true);
  $("#screen").innerHTML = `
    <div class="seg"><button data-lado="cobrar" aria-pressed="${cobrar}">Cobros pendientes</button><button data-lado="pagar" aria-pressed="${!cobrar}">Deudas pendientes</button></div>
    <div class="stat"><div class="k">${cobrar ? "Total por cobrar" : "Total por pagar"}</div><div class="v">${fmt(total)}</div></div>
    <div class="rows">${conDeuda.map(x => { const a = analizar(docsDe(x.c, cobrar), x.c.pagos); return `
      <button class="row" data-q="${esc(x.n)}"><div><div style="font-weight:700">${esc(x.n)}</div><div class="s">${a.abiertas.length} factura${a.abiertas.length === 1 ? "" : "s"} abierta${a.abiertas.length === 1 ? "" : "s"}${a.abiertas.length ? " · la más vieja " + diasTxt(a.dias) : ""}</div></div><div class="r">${fmt(x.c.debe)} ›</div></button>`; }).join("") || `<div class="row">${cobrar ? "Nadie nos debe nada 🎉" : "No le debemos nada a nadie 🎉"}</div>`}</div>
    ${!cobrar ? S.cuentas.pagar.filter(p => p.sinFactura.length).map(p => `<div class="banner">📦 A ${esc(p.proveedor)}: recibido sin factura todavía ${fmt(p.sinFactura.reduce((a, s) => a + s.total, 0))} (${p.sinFactura.map(s => "semana del " + fecha(s.semana)).join(", ")}). No suma a la deuda hasta que llegue la factura.</div>`).join("") : ""}
    ${alDia.length ? `<details><summary class="hint">${cobrar ? "Clientes" : "Proveedores"} al día (${alDia.length})</summary><div class="rows" style="margin-top:8px">${alDia.map(x => `<button class="row" data-qh="${esc(x.n)}"><div style="font-weight:700">${esc(x.n)}</div><div class="r"><span class="pill">Al día</span> ›</div></button>`).join("")}</div></details>` : ""}`;
  $$("[data-lado]").forEach(b => b.onclick = () => ir("cuentas", { lado: b.dataset.lado }));
  $$("[data-q]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: b.dataset.q, nivel: "deuda" }));
  $$("[data-qh]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: b.dataset.qh, nivel: "hist" }));
}
function cuentaSel() { const v = S.vista; return v.lado === "cobrar" ? S.cuentas.cobrar.find(c => c.cliente === v.quien) : S.cuentas.pagar.find(p => p.proveedor === v.quien); }
function docsDe(c, cobrar) {
  return cobrar ? c.docs.map(d => ({ fecha: d.fecha, n: "Entrega del " + fecha(d.fecha), items: d.items.map(it => ({ d: it.d, q: it.q, u: it.u, total: it.total })) }))
                : c.docs.map(d => ({ fecha: d.fecha, n: "Factura del " + fecha(d.fecha), total: d.total, items: d.items }));
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
    <div class="rows">${a.abiertas.map(d => `<button class="row" data-det="${d.i}"><div><div style="font-weight:700">${esc(d.d.n)}</div><div class="s">Total ${fmt(d.total)}${d.pagado > 0.005 ? " · abonado " + fmt(d.pagado) : ""}</div></div><div class="r">${pillEstado(d.estado)} ${fmt(d.pend)} ›</div></button>`).join("")}</div>`;
  const py = $("#pagarYa"); if (py) py.onclick = () => { v.pagando = true; v.quien2 = v.quien; v.monto = ""; ctaDeuda(); };
  const vh = $("#verHist"); if (vh) vh.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "hist" });
  $$("[data-det]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", doc: +b.dataset.det, desde: "deuda" }));
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
    ${cobrar ? "" : `<div class="hint">Desde el punto de partida (${fecha(c.desde)}).</div>`}
    <div class="rows">${filas.map(x => x.d ? `
      <button class="row" data-det="${x.d.i}"><div><div style="font-weight:700">${fecha(x.f)}</div><div class="s">${cobrar ? "Entrega" : "Factura"} · ${x.d.d.items.length} producto${x.d.d.items.length === 1 ? "" : "s"}</div></div><div class="r">${pillEstado(x.d.estado)} ${fmt(x.d.total)} ›</div></button>` : `
      <button class="row" data-pag="${x.p.i}"><div><div style="font-weight:700">${fecha(x.f)}</div><div class="s">${cobrar ? "Pago recibido" : "Pago hecho"}${x.p.p.por ? " · " + esc(x.p.p.por) : ""}${x.p.p.local ? " · ⏳ sin enviar" : ""}</div></div><div class="r" style="color:var(--ok)">−${fmt(x.p.p.monto)} ›</div></button>`).join("")}</div>`;
  $$("[data-det]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", doc: +b.dataset.det, desde: "hist" }));
  $$("[data-pag]").forEach(b => b.onclick = () => ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "det", pago: +b.dataset.pag, desde: "hist" }));
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
  header(d.d.n, v.quien, true);
  $("#screen").innerHTML = `
    <div class="card"><div style="overflow-x:auto"><table class="tabla">
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
      ${d.d.items.map(it => `<tr><td>${esc(it.d)}</td><td>${cantTxt(it)}</td><td>${it.q ? fmt(it.total / it.q) + (it.u ? "/" + it.u : "") : ""}</td><td>${fmt(it.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="hint">Sin detalle de productos.</td></tr>`}
      ${!cobrar && d.d.items.length && Math.abs(d.d.items.reduce((s, it) => s + it.total, 0) - d.total) > 1 ? `<tr class="sum"><td>Recibido a costo</td><td></td><td></td><td>${fmt(d.d.items.reduce((s, it) => s + it.total, 0))}</td></tr>` : ""}
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
