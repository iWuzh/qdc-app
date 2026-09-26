// Reportes — pestaña de la app. Los números los calcula el servidor
// (AppReportes.js, solo lee el Sheet); aquí solo se dibujan.
// Gráficos en SVG propio (sin librerías, funciona sin señal). Reglas de la guía
// de visualización: una sola escala, líneas de 2px, marcas finas, rejilla
// tenue, leyenda siempre con 2+ series, el texto nunca en el color de la serie,
// toque/hover con línea que marca la semana, y la tabla con todos los números
// debajo de cada gráfico. Colores validados contra el fondo #0F1339.
"use strict";

const REP_COLOR = { vendido: "#3987e5", ganancia: "#5AA84F" };
// Antigüedad de lo que se debe: colores de estado (siempre con su texto al lado).
const REP_TRAMOS = [
  { k: "0-7", t: "0–7 días", c: "var(--ok)" },
  { k: "8-14", t: "8–14 días", c: "var(--warn)" },
  { k: "15-30", t: "15–30 días", c: "#E8864A" },
  { k: "31+", t: "Más de 30 días", c: "var(--bad)" }
];

const repMonto = n => "RD$" + Math.round(Number(n)).toLocaleString("en-US");
const repCorto = n => { const a = Math.abs(n); return (n < 0 ? "−" : "") + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(Math.round(a))); };
const repSem = iso => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MESES[d.getMonth()]}`; };

// ---------- Gráfico de líneas (una escala, N series) ----------
// series: [{ nombre, color, valores: [n|null] }]; etiquetas: textos del eje X.
function repLineas(id, etiquetas, series, fmtY) {
  const W = 340, H = 190, L = 40, R = 10, T = 14, B = 24;
  const vals = series.flatMap(s => s.valores).filter(v => v != null);
  if (!vals.length) return `<div class="hint">Todavía no hay datos.</div>`;
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const paso = repPasoLindo((hi - lo) / 4 || 1);
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso || paso;
  const n = etiquetas.length;
  const x = i => L + (n === 1 ? 0 : i * (W - L - R) / (n - 1));
  const y = v => T + (hi - v) * (H - T - B) / (hi - lo);
  let g = "";
  for (let v = lo; v <= hi + paso / 2; v += paso) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.5 : 1}"/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="rep-eje">${fmtY(v)}</text>`;
  }
  // Etiquetas del eje X contadas desde la ÚLTIMA semana (la que más importa),
  // para que nunca se monten dos al final.
  const cada = Math.ceil(n / 5);
  etiquetas.forEach((e, i) => {
    if ((n - 1 - i) % cada) return;
    const ancla = i === n - 1 ? "end" : i === 0 ? "start" : "middle";
    g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${ancla}" class="rep-eje">${esc(e)}</text>`;
  });
  for (const s of series) {
    let d = "", pluma = false;
    s.valores.forEach((v, i) => { if (v == null) { pluma = false; return; } d += (pluma ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pluma = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    // Punto final (con anillo del color del fondo); un punto suelto entre huecos también se ve.
    s.valores.forEach((v, i) => {
      const suelto = v != null && s.valores[i - 1] == null && s.valores[i + 1] == null;
      const ultimo = v != null && s.valores.slice(i + 1).every(w => w == null);
      if (suelto || ultimo) g += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });
  }
  g += `<line id="${id}-cruz" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
  g += series.map((s, k) => `<circle id="${id}-p${k}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`).join("");
  const leyenda = series.length > 1 ? `<div class="rep-ley">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join("")}</div>` : "";
  REP_GRAF[id] = { etiquetas, series, x, y, W, L, R };
  return `${leyenda}<div class="rep-lectura" id="${id}-lee" aria-live="polite">Toca el gráfico para ver cada semana</div>
    <svg class="rep-svg" id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.nombre).join(" y "))} por semana">${g}</svg>`;
}
const REP_GRAF = {};
function repPasoLindo(bruto) {
  const e = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
// Toque/hover: la línea vertical busca la semana más cercana; la lectura
// (arriba del gráfico) dice los valores de TODAS las series en esa semana.
function repCablearLineas(id, fmtV) {
  const svg = document.getElementById(id), gr = REP_GRAF[id];
  if (!svg || !gr) return;
  const mover = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * gr.W / r.width;
    let i = 0, mejor = Infinity;
    gr.etiquetas.forEach((_, k) => { const dx = Math.abs(gr.x(k) - px); if (dx < mejor) { mejor = dx; i = k; } });
    const cruz = document.getElementById(id + "-cruz");
    cruz.setAttribute("x1", gr.x(i)); cruz.setAttribute("x2", gr.x(i)); cruz.setAttribute("visibility", "visible");
    gr.series.forEach((s, k) => {
      const p = document.getElementById(id + "-p" + k), v = s.valores[i];
      if (v == null) { p.setAttribute("visibility", "hidden"); return; }
      p.setAttribute("cx", gr.x(i)); p.setAttribute("cy", gr.y(v)); p.setAttribute("visibility", "visible");
    });
    const lee = document.getElementById(id + "-lee");
    lee.textContent = "";
    const b = document.createElement("b"); b.textContent = gr.etiquetas[i]; lee.appendChild(b);
    gr.series.forEach(s => {
      const sp = document.createElement("span");
      const k = document.createElement("i"); k.style.background = s.color; sp.appendChild(k);
      sp.appendChild(document.createTextNode(`${s.nombre} ${s.valores[i] == null ? "sin datos" : fmtV(s.valores[i])}`));
      lee.appendChild(sp);
    });
  };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
}

// ---------- Pantalla ----------
function reportes() {
  const v = S.vista; v.sec = v.sec || "semanas";
  header("Reportes", S.reportes ? "Datos de las " + new Date(S.reportesHora).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" }) : "", false);
  if (!S.reportes && !S.cargandoRep) cargarReportes();
  if (!S.reportes) { $("#screen").innerHTML = `<div class="hint">${S.cargandoRep ? "Calculando reportes… (unos segundos)" : "Hace falta señal una vez para bajar los reportes."}</div>`; return; }
  const secs = [["semanas", "Semanas"], ["cobros", "Cobros"], ["productos", "Productos"], ["clientes", "Clientes"]];
  $("#screen").innerHTML = `
    <div class="seg rep-seg">${secs.map(([k, t]) => `<button data-sec="${k}" aria-pressed="${v.sec === k}">${t}</button>`).join("")}</div>
    <div id="repCuerpo"></div>
    <button class="add" id="repAct">${S.cargandoRep ? "Actualizando…" : "Actualizar reportes"}</button>`;
  $$("[data-sec]").forEach(b => b.onclick = () => { v.sec = b.dataset.sec; reportes(); });
  $("#repAct").onclick = () => { if (!S.cargandoRep) { cargarReportes(); reportes(); } };
  ({ semanas: repSemanas, cobros: repCobros, productos: repProductos, clientes: repClientes })[v.sec](S.reportes);
}

async function cargarReportes() {
  S.cargandoRep = true;
  try {
    const r = await llamar({ accion: "reportes" });
    if (r.ok) { S.reportes = r.reportes; S.reportesHora = new Date().toISOString(); guardar("reportes", S.reportes); guardar("reportesHora", S.reportesHora); }
    else toast(r.error || "No se pudieron calcular los reportes.");
  } catch (e) { toast("Sin señal: se muestran los últimos reportes guardados."); }
  S.cargandoRep = false;
  if (S.tab === "reportes") repintar();
}

function repTile(k, valor, delta, bueno) {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${valor}</div>${delta || ""}</div>`;
}
function repDelta(actual, previo, subirEsBueno, fmtD) {
  if (previo == null || actual == null) return "";
  const d = actual - previo;
  if (Math.abs(d) < 0.5) return `<div class="hint">Igual que la semana anterior</div>`;
  const bien = (d > 0) === subirEsBueno;
  return `<div class="hint" style="color:${bien ? "var(--ok)" : "var(--bad)"}">${d > 0 ? "▲" : "▼"} ${fmtD(Math.abs(d))} vs. semana anterior</div>`;
}

function repSemanas(r) {
  // Semanas sin nada anotado (el bot estuvo caído) van como hueco, no como cero.
  const sem = r.semanas.map(s => ({ ...s, vacia: !s.vendido && !s.cobrado && !s.gastos }));
  const et = sem.map(s => repSem(s.semana));
  const act = sem[sem.length - 1], ant = sem[sem.length - 2];
  $("#repCuerpo").innerHTML = `
    <div class="stats">
      ${repTile("Vendido esta semana", repMonto(act.vendido), repDelta(act.vendido, ant && !ant.vacia ? ant.vendido : null, true, repMonto))}
      ${repTile("Ganancia esta semana", repMonto(act.ganancia), repDelta(act.ganancia, ant && !ant.vacia ? ant.ganancia : null, true, repMonto))}
    </div>
    <div class="hint">La semana en curso (desde el dom ${repSem(act.semana)}) todavía no ha cerrado.</div>
    <div class="card">
      <div class="k" style="font-weight:700">Vendido y ganancia por semana</div>
      ${repLineas("gSem", et, [
        { nombre: "Vendido", color: REP_COLOR.vendido, valores: sem.map(s => s.vacia ? null : s.vendido) },
        { nombre: "Ganancia", color: REP_COLOR.ganancia, valores: sem.map(s => s.vacia ? null : s.ganancia) }
      ], repCorto)}
      <div class="hint">Los huecos son semanas sin nada anotado (el bot estuvo caído).</div>
    </div>
    <details><summary class="hint">Ver la tabla de todas las semanas</summary>
      <div style="overflow-x:auto;margin-top:8px"><table class="tabla">
        <thead><tr><th>Semana</th><th>Vendido</th><th>Costo</th><th>Gastos</th><th>Ganancia</th><th>Cobrado</th></tr></thead><tbody>
        ${sem.slice().reverse().map(s => `<tr><td>${repSem(s.semana)}</td>${s.vacia ? `<td colspan="5" class="hint">sin datos</td>` : `<td>${repMonto(s.vendido)}</td><td>${repMonto(s.costo)}</td><td>${repMonto(s.gastos)}</td><td>${repMonto(s.ganancia)}</td><td>${repMonto(s.cobrado)}</td>`}</tr>`).join("")}
      </tbody></table></div></details>
    <div class="hint">Ganancia = vendido − costo − gastos. El costo usa el precio de compra de hoy. Lo entregado a los socios (stock) no cuenta como venta todavía. "Cobrado" no incluye los ajustes de pagos viejos.</div>`;
  repCablearLineas("gSem", repMonto);
}

function repCobros(r) {
  const c = r.cobranza, total = c.debe || 0;
  const semanas = c.porSemana.slice(0, -1);   // la semana en curso todavía no ha tenido tiempo de cobrarse
  $("#repCuerpo").innerHTML = `
    <div class="stat"><div class="k">Tardamos en cobrar</div>
      <div class="v rep-hero">${c.dias == null ? "—" : c.dias}<small> ${c.dias === 1 ? "día" : "días"}</small></div>
      <div class="hint">Promedio desde el corte (${c.desde ? fecha(c.desde) : "todo el histórico"}): desde que se entrega hasta que se termina de pagar, pesado por monto.</div></div>
    <div class="card">
      <div class="k" style="font-weight:700">Lo que se debe hoy: ${repMonto(total)}</div>
      <div class="hint">Según cuánto tiempo lleva sin pagarse</div>
      <div class="rep-barra">${REP_TRAMOS.filter(t => c.antiguedad[t.k] > 0.5).map(t => `<span style="flex:${c.antiguedad[t.k]};background:${t.c}" title="${t.t}: ${repMonto(c.antiguedad[t.k])}"></span>`).join("")}</div>
      ${REP_TRAMOS.map(t => `<div class="line"><span><i class="rep-sw" style="background:${t.c}"></i>${t.t}</span><span>${repMonto(c.antiguedad[t.k] || 0)} · ${total ? Math.round(100 * (c.antiguedad[t.k] || 0) / total) : 0}%</span></div>`).join("")}
    </div>
    ${semanas.length > 1 ? `<div class="card"><div class="k" style="font-weight:700">Días para cobrar, por semana de entrega</div>
      ${repLineas("gDias", semanas.map(s => repSem(s.semana)), [{ nombre: "Días para cobrar", color: REP_COLOR.vendido, valores: semanas.map(s => s.dias) }], n => String(Math.round(n)))}</div>` : ""}
    <div class="label">Quién debe (lo más viejo primero)</div>
    <div class="rows">${c.deudores.map(d => `<button class="row" data-cli="${esc(d.cliente)}"><div><div style="font-weight:700">${esc(d.cliente)}</div>
      <div class="s"><b>${total ? Math.round(100 * d.debe / total) : 0}%</b> de lo que nos deben · ${d.dias == null ? "no ha pagado nada desde el corte" : `tarda ${d.dias} día${d.dias === 1 ? "" : "s"} en pagar`}${d.vencido > 0.5 ? ` · <span style="color:var(--bad);font-weight:700">⚠️ ${repMonto(d.vencido)} con más de 14 días</span>` : ""}</div></div>
      <div class="r">${repMonto(d.debe)} ›</div></button>`).join("") || `<div class="row">Nadie debe nada 🎉</div>`}</div>
    <div class="hint">Cuenta desde el punto de partida (${c.desde ? fecha(c.desde) : "todo el histórico"}); antes de esa fecha todo está en cero. Los pagos se aplican a la entrega más vieja.</div>`;
  $$("[data-cli]").forEach(b => b.onclick = () => ir("cuentas", { lado: "cobrar", quien: b.dataset.cli, nivel: "deuda" }));
  repCablearLineas("gDias", n => n + " días");
}

// Productos agrupados (pedido de Marcos, 26 sep): el yogur en LITROS y cada
// queso en barra en LIBRAS, con desplegable por presentación. Bolas y
// mantequilla quedan solas. Medidas de EE. UU. para el yogur.
const REP_LITROS = { "10oz": 0.2957, "litro": 1, "medio galon": 1.8927, "galon": 3.7854 };
function repAgruparProductos(ps) {
  const grupos = {}, orden = [];
  for (const p of ps) {
    const [base, pres] = p.producto.split(" · ");
    const k = norm(base);
    if (!grupos[k]) { grupos[k] = { base, hijos: [], vendido: 0, margen: 0, ventaSemana: 0, cant: 0, porSemana: 0, unidad: "", sinCosto: false }; orden.push(k); }
    const g = grupos[k];
    g.hijos.push(Object.assign({ pres: pres || "" }, p));
    g.vendido += p.vendido; g.margen += p.margen; g.ventaSemana += p.ventaSemana || 0; g.sinCosto = g.sinCosto || p.sinCosto;
    if (k === "yogur") {
      const l = REP_LITROS[norm(pres)] || 0;
      g.cant += p.q * l; g.porSemana += (p.porSemana || 0) * l; g.unidad = "L";
    } else if (p.u === "lb") { g.cant += p.q; g.porSemana += p.porSemana || 0; g.unidad = "lb"; }
    else { g.cant += p.q; g.porSemana += p.porSemana || 0; }
  }
  return orden.map(k => grupos[k]).sort((a, b) => b.vendido - a.vendido);
}

function repFilaProducto(p, r, max, titulo, unidad) {
  const u = unidad === "L" ? " L" : unidad === "lb" || p.u === "lb" ? " lb" : "";
  return `<div class="line"><b>${titulo}</b><b>${Math.round((p.porSemana || 0) * 10) / 10}${u}<small class="hint" style="font-weight:400"> /sem</small></b></div>
      <div class="line"><span class="hint">${repMonto(p.ventaSemana || 0)} por semana</span><span class="hint">${repMonto(p.vendido)} en ${r.semanasDetalle} sem</span></div>
      <div class="line"><span class="hint">${Math.round((p.cant != null ? p.cant : p.q) * 10) / 10}${u} en total · margen ${p.vendido ? Math.round(100 * p.margen / p.vendido) : 0}%</span><span style="${p.margen < 0 ? "color:var(--bad);font-weight:700" : ""}">${p.margen < 0 ? "Pérdida " : ""}${repMonto(p.margen)}</span></div>
      <div class="rep-marg"><span style="width:${Math.max(2, 100 * Math.abs(p.margen) / max)}%;background:${p.margen < 0 ? "var(--bad)" : REP_COLOR.ganancia}"></span></div>
      ${p.sinCosto ? `<div class="hint warn">Sin precio de compra para parte de esto: el margen sale de más.</div>` : ""}`;
}

function repProductos(r) {
  const gs = repAgruparProductos(r.productos);
  const max = Math.max(1, ...gs.map(g => Math.abs(g.margen)));
  const tot = gs.reduce((a, g) => ({ v: a.v + g.vendido, m: a.m + g.margen }), { v: 0, m: 0 });
  S.vista.abiertos = S.vista.abiertos || {};
  $("#repCuerpo").innerHTML = `
    <div class="stats">
      ${repTile("Vendido (" + (r.semanasDetalle || 4) + " semanas)", repMonto(tot.v))}
      ${repTile("Margen", repMonto(tot.m), `<div class="hint">${tot.v ? Math.round(100 * tot.m / tot.v) : 0}% de lo vendido</div>`)}
    </div>
    <div class="hint">Desde el dom ${repSem(r.detalleDesde)}${r.semanasDetalle ? ` (${r.semanasDetalle} semanas)` : ""}. Arriba a la derecha: <b>cuánto se vende por semana</b>. El yogur va en <b>litros</b> y los quesos en barra en <b>libras</b>: tócalos para verlos por presentación. Margen = vendido − costo (precio de compra de hoy).</div>
    <div class="rows">${gs.map(g => g.hijos.length > 1 || g.unidad
      ? `<details class="row rep-grupo" style="display:block" data-g="${esc(g.base)}" ${S.vista.abiertos[g.base] ? "open" : ""}>
          <summary style="list-style:none;cursor:pointer">${repFilaProducto(g, r, max, esc(pdfNombre(g.base)) + ` <small class="hint" style="font-weight:400">${S.vista.abiertos[g.base] ? "▾" : "▸"} ${g.hijos.length} presentaci${g.hijos.length === 1 ? "ón" : "ones"}</small>`, g.unidad)}</summary>
          <div class="rep-hijos">${g.hijos.map(h => `<div class="rep-hijo">${repFilaProducto(h, r, max, esc(pdfNombre(h.pres || "sin presentación")), h.u === "lb" ? "lb" : "")}</div>`).join("")}</div>
        </details>`
      : `<div class="row" style="display:block">${repFilaProducto(g.hijos[0], r, max, esc(pdfNombre(g.base)), "")}</div>`).join("") || `<div class="row">Sin ventas en estas semanas.</div>`}</div>`;
  $$(".rep-grupo").forEach(d => d.addEventListener("toggle", () => { S.vista.abiertos[d.dataset.g] = d.open; const s = d.querySelector("summary small"); if (s) s.textContent = s.textContent.replace(/^[▸▾]/, d.open ? "▾" : "▸"); }));
}

// ---------- Gráfico de clientes: venta promedio por semana desde el corte ----------
// Los 6 más grandes + "Otros" (el resto junto). Tocar "Otros" enseña solo a
// esos; tocar un cliente abre su cuenta. Mismos números que "Clientes al día"
// (Cuentas): total entregado desde el corte ÷ todas las semanas desde el corte.
const REP_TOP = 6;
function repVolumenClientes() {
  if (!S.cuentas) return [];
  const corte = (S.reportes && S.reportes.cobranza && S.reportes.cobranza.desde) || "2026-08-30";
  const semanas = Math.max(1, Math.ceil((Date.now() - new Date(corte + "T00:00:00")) / (7 * 864e5)));
  return S.cuentas.cobrar.map(c => {
    const tot = c.docs.filter(d => d.fecha >= corte).reduce((a, d) => a + d.items.reduce((s, it) => s + it.total, 0), 0);
    return { cliente: c.cliente, tot, prom: tot / semanas };
  }).filter(x => x.tot > 0.5).sort((a, b) => b.prom - a.prom);
}
// Distribución (en la lista de Clientes) va uno por uno: los 6 más grandes +
// "Otros". Los de Contado (no están en la lista: "+ Otro", de paso) van juntos
// en "Al contado". Tocar un grupo enseña solo a los suyos.
function repBarrasClientes(v) {
  const todos = repVolumenClientes();
  if (!todos.length) return "";
  const lista = new Set(((S.catalogo && S.catalogo.clientes) || []).map(norm));
  const dist = todos.filter(x => lista.has(norm(x.cliente))), contado = todos.filter(x => !lista.has(norm(x.cliente)));
  const grupos = { otros: dist.slice(REP_TOP), contado };
  const suma = xs => xs.reduce((a, x) => a + x.prom, 0);
  const g = v.grupo && grupos[v.grupo] && grupos[v.grupo].length ? v.grupo : "";
  let filas;
  if (g) filas = grupos[g].map(x => ({ n: x.cliente, prom: x.prom }));
  else {
    filas = dist.slice(0, REP_TOP).map(x => ({ n: x.cliente, prom: x.prom }));
    if (grupos.otros.length) filas.push({ n: "Otros", prom: suma(grupos.otros), grupo: "otros", cuantos: grupos.otros.length });
    if (contado.length) filas.push({ n: "Al contado", prom: suma(contado), grupo: "contado", cuantos: contado.length });
  }
  const max = Math.max(...filas.map(f => f.prom), 1);
  const total = suma(todos);
  const titulo = { otros: `Otros de Distribución (${grupos.otros.length})`, contado: `Clientes al contado (${contado.length})` }[g] || "Venta promedio por semana";
  const nota = { otros: "Los de la lista de clientes que no están entre los 6 más grandes.", contado: "Los que no están en la lista de clientes (pagan Contado)." }[g]
    || "Toca \"Otros\" o \"Al contado\" para verlos por separado.";
  return `<div class="card">
    <div class="k" style="font-weight:700">${titulo}</div>
    <div class="hint">Desde el corte. ${nota}</div>
    ${g ? `<button class="chip sm" id="repTodos" style="align-self:flex-start">‹ Todos los clientes</button>` : ""}
    <div class="rep-barras">${filas.map(f => `
      <button class="rep-bar" ${f.grupo ? `data-grupo="${f.grupo}"` : `data-cli="${esc(f.n)}"`} title="${esc(f.n)}: ${repMonto(f.prom)} por semana">
        <span class="rep-bar-n">${f.grupo ? `<u>${f.n}</u> <small>(${f.cuantos})</small>` : esc(f.n)}</span>
        <span class="rep-bar-t"><i style="width:${Math.max(1.5, 100 * f.prom / max)}%;background:${f.grupo ? "var(--ink-2)" : REP_COLOR.vendido}"></i></span>
        <span class="rep-bar-v">${repMonto(f.prom)}<small> · ${Math.round(100 * f.prom / total)}%</small></span>
      </button>`).join("")}</div>
  </div>`;
}

function repClientes(r) {
  const cs = r.clientes, v = S.vista;
  $("#repCuerpo").innerHTML = `
    ${repBarrasClientes(v)}
    <div class="hint">Últimas 4 semanas (desde el dom ${repSem(r.detalleDesde)}), ordenado por lo que más compra. "Tarda" = días promedio para pagar.</div>
    <div class="rows">${cs.map(c => `<button class="row" data-cli="${esc(c.cliente)}" style="display:block;text-align:left">
      <div class="line"><b>${esc(c.cliente)}</b><span>${repMonto(c.vendido)}</span></div>
      <div class="line"><span class="hint">margen ${repMonto(c.margen)} (${c.vendido ? Math.round(100 * c.margen / c.vendido) : 0}%)</span>
        <span class="hint">${c.debe > 0.5 ? "debe " + repMonto(c.debe) : "al día"}${c.dias != null ? " · tarda " + c.dias + "d" : ""}</span></div>
      ${c.vencido > 0.5 ? `<div class="hint bad">⚠️ ${repMonto(c.vencido)} con más de 14 días</div>` : ""}</button>`).join("") || `<div class="row">Sin ventas en estas semanas.</div>`}</div>`;
  $$("[data-cli]").forEach(b => b.onclick = () => ir("cuentas", { lado: "cobrar", quien: b.dataset.cli, nivel: "hist" }));
  $$("[data-grupo]").forEach(b => b.onclick = () => { v.grupo = b.dataset.grupo; reportes(); });
  const td = $("#repTodos"); if (td) td.onclick = () => { v.grupo = ""; reportes(); };
}
