// Stock con responsable (Fase 3) — pantallas. El servidor es AppStock.js.
// Cada socio ve lo suyo primero. Salidas: Vendió / se lo quedó (paga Contado o
// el precio real), Se perdió (paga al costo), Desecho, Promo. Conteo: la
// diferencia se explica o no se guarda. Todo pasa por la cola (sin señal
// también), y el saldo se ajusta en el teléfono al momento.
"use strict";

const MOV = {
  se_quedo: { t: "Vendió / se lo quedó", d: "Paga a precio Contado (o lo que cobró)" },
  perdida: { t: "Se perdió", d: "Paga al costo" },
  desecho: { t: "Desecho", d: "Se dañó · no se cobra" },
  promo: { t: "Promo", d: "Se regaló · no se cobra" }
};

const stockSocios = () => (S.stock && S.stock.socios) || [];
function miSocio() {
  const partes = norm(S.sesion && S.sesion.nombre).split(/\s+/);
  const s = stockSocios().find(x => partes.includes(norm(x.socio)));
  return s ? s.socio : "";
}
const socioStock = n => stockSocios().find(x => norm(x.socio) === norm(n));
const itemsDe = n => ((socioStock(n) || {}).items || []).filter(it => it.cantidad > 0.005);
const descItem = it => pdfNombre([it.producto, it.variante || it.presentacion, it.sabor].filter(Boolean).join(" · "));
const mismoItem = (a, b) => norm(a.producto) === norm(b.producto) && norm(a.variante || a.presentacion) === norm(b.variante || b.presentacion) && norm(a.sabor) === norm(b.sabor);
const cantTxt2 = (q, u) => (Number.isInteger(q) ? q : Math.round(q * 100) / 100) + (u ? " lb" : "");
function saldoDe(socio, it) { const x = itemsDe(socio).find(y => mismoItem(y, it)); return x ? x.cantidad : 0; }
function precioUnit(it, tipo) {
  const p = prodCat(it.producto); if (!p) return 0;
  const pr = (it.variante || it.presentacion) ? (p.presentaciones.find(x => norm(x.nombre) === norm(it.variante || it.presentacion)) || {}) : p;
  return (tipo === "costo" ? pr.compra : pr.contado) || 0;
}

// Ajuste local del saldo (sin esperar al servidor). signo: -1 sale, +1 entra.
function moverLocal(socio, items, signo) {
  const s = socioStock(socio); if (!s) return;
  for (const it of items) {
    let x = s.items.find(y => mismoItem(y, it));
    if (!x) { x = { producto: it.producto, variante: it.presentacion || "", sabor: it.sabor || "", u: "", cantidad: 0 }; s.items.push(x); }
    x.cantidad = Math.round((x.cantidad + signo * num(it.cantidad)) * 100) / 100;
  }
  guardar("stock", S.stock);
}

// ---------- Pestaña Stock ----------
function stock() {
  const v = S.vista;
  if (v.mov) return stockMovimiento();
  if (v.conteo) return stockConteo();
  if (v.asignar) return stockAsignar();
  header("Stock", S.stock && S.stock.activo ? "Desde el conteo del " + fecha(S.stock.inicio) : "", false);
  if (!S.stock) { $("#screen").innerHTML = `<div class="hint">${S.enviando ? "Cargando stock…" : "Hace falta señal una vez para bajar el stock."}</div>`; return; }
  if (!S.stock.activo) { $("#screen").innerHTML = `<div class="hint">El stock con responsable arranca con el conteo físico inicial. Todavía no está anotado.</div>`; return; }
  v.socio = v.socio || miSocio() || stockSocios()[0].socio;
  const s = socioStock(v.socio), its = itemsDe(v.socio), esMio = norm(v.socio) === norm(miSocio());
  const conAlgo = stockSocios().filter(x => itemsDe(x.socio).length || norm(x.socio) === norm(miSocio()));
  $("#screen").innerHTML = `
    ${avisoSinResponsable()}
    <div class="chips">${conAlgo.map(x => `<button class="chip" data-soc="${esc(x.socio)}" aria-pressed="${x.socio === v.socio}">${esc(x.socio)}${norm(x.socio) === norm(miSocio()) ? " (tú)" : ""}</button>`).join("")}</div>
    <div class="card">
      <div class="k" style="font-weight:700">${esMio ? "Lo que tienes" : "Lo que tiene " + esc(v.socio)}${s.conteo ? ` <span class="hint">· contado el ${fecha(s.conteo)}</span>` : ""}</div>
      ${its.map(it => `<div class="line"><span>${esc(descItem(it))}</span><b>${cantTxt2(it.cantidad, it.u)}</b></div>`).join("") || `<div class="hint">Nada en stock.</div>`}
    </div>
    ${its.length ? `<div class="label">¿Qué pasó?</div>
    <div class="big">${Object.keys(MOV).map(k => `<button class="act" data-mov="${k}" style="min-height:0;gap:4px"><div class="t" style="font-size:17px">${MOV[k].t}</div><div class="d">${MOV[k].d}</div></button>`).join("")}</div>` : ""}
    <button class="go ${its.length ? "alt" : ""}" id="contar">Contar ${esMio ? "mi" : "el"} stock${esMio ? "" : " de " + esc(v.socio)}</button>
    <div class="hint">Para entregarle a un cliente de la lista desde este stock: en <b>Entregas</b> o <b>Entregar pedido</b>, elige "Del stock de ${esc(v.socio)}". El cliente queda debiendo.</div>
    ${s.movimientos && s.movimientos.length ? `<div class="label">Desde el último conteo</div>
      <div class="rows">${s.movimientos.map(m => `<div class="row"><div><div style="font-weight:700">${esc(m.tipo === "Se quedo" ? "Vendió / se lo quedó" : m.tipo === "Perdida" ? "Se perdió" : m.tipo === "Promocion" ? "Promo" : m.tipo)}</div><div class="s">${fecha(m.fecha)} · ${esc(pdfNombre(m.d))}${m.nota ? " · " + esc(m.nota) : ""}</div></div><div class="r">${m.tipo === "Entrada" ? "+" : "−"}${cantTxt2(m.q)}</div></div>`).join("")}</div>` : ""}`;
  $$("[data-soc]").forEach(b => b.onclick = () => ir("stock", { socio: b.dataset.soc }));
  cablearSinResponsable();
  $$("[data-mov]").forEach(b => b.onclick = () => ir("stock", { socio: v.socio, mov: b.dataset.mov, lineas: [] }));
  $("#contar").onclick = () => ir("stock", { socio: v.socio, conteo: true });
}

// ---------- Salida (vendió / se perdió / desecho / promo) ----------
function stockMovimiento() {
  const v = S.vista, m = MOV[v.mov], its = itemsDe(v.socio);
  header(m.t, v.socio, true);
  const linea = it => v.lineas.find(l => mismoItem(l, it));
  let total = 0, lista = 0, excede = false;
  for (const it of its) {
    const l = linea(it); if (!l || !num(l.cantidad)) continue;
    if (num(l.cantidad) > it.cantidad + 0.005) excede = true;
    if (v.mov === "se_quedo") { const pu = l.precio !== "" && l.precio != null ? num(l.precio) : precioUnit(it, "contado"); total += pu * num(l.cantidad); lista += precioUnit(it, "contado") * num(l.cantidad); }
    if (v.mov === "perdida") total += precioUnit(it, "costo") * num(l.cantidad);
  }
  const hay = v.lineas.some(l => num(l.cantidad) > 0);
  $("#screen").innerHTML = `
    <div class="rows">${its.map((it, i) => { const l = linea(it) || {}; return `<div class="row" style="display:block">
      <div class="line"><b>${esc(descItem(it))}</b><span class="hint">tiene ${cantTxt2(it.cantidad, it.u)}</span></div>
      <div class="ctl" style="margin-top:8px"><div class="step"><button data-menos="${i}">−</button><input class="qty" id="mq${i}" inputmode="decimal" placeholder="0" value="${esc(num(l.cantidad) ? l.cantidad : "")}" data-q="${i}"><button data-mas="${i}">+</button></div>
      ${v.mov === "se_quedo" && num(l.cantidad) ? `<label class="monto" style="margin-top:8px"><span>RD$ c/u</span><input id="mp${i}" inputmode="decimal" value="${esc(l.precio != null && l.precio !== "" ? l.precio : precioUnit(it, "contado"))}" data-p="${i}"></label>` : ""}</div></div>`; }).join("")}</div>
    ${excede ? `<div class="banner bad">No puede salir más de lo que ${esc(v.socio)} tiene.</div>` : ""}
    ${hay && !excede ? `<div class="efecto">${v.mov === "se_quedo" ? `${esc(v.socio)} queda debiendo <b>${fmt(total)}</b>${total < lista - 0.005 ? ` (descuento de ${fmt(lista - total)} sobre el precio Contado)` : ""}.`
      : v.mov === "perdida" ? `${esc(v.socio)} queda debiendo <b>${fmt(total)}</b> (al costo).` : "No se cobra. Queda anotado a nombre de " + esc(v.socio) + "."}</div>` : ""}
    <div class="btns"><button class="go" id="movOk" ${hay && !excede ? "" : "disabled"}>Guardar</button></div>`;
  const get = i => { let l = linea(its[i]); if (!l) { l = { producto: its[i].producto, presentacion: its[i].variante, sabor: its[i].sabor, cantidad: 0, precio: "" }; v.lineas.push(l); } return l; };
  $$("[data-mas]").forEach(b => b.onclick = () => { const l = get(+b.dataset.mas); l.cantidad = Math.min(its[+b.dataset.mas].cantidad, num(l.cantidad) + 1); stockMovimiento(); });
  $$("[data-menos]").forEach(b => b.onclick = () => { const l = get(+b.dataset.menos); l.cantidad = Math.max(0, num(l.cantidad) - 1); stockMovimiento(); });
  $$("[data-q]").forEach(inp => inp.oninput = () => { get(+inp.dataset.q).cantidad = inp.value.replace(/[^0-9.,]/g, ""); conFoco(stockMovimiento); });
  $$("[data-p]").forEach(inp => inp.oninput = () => { get(+inp.dataset.p).precio = inp.value.replace(/[^0-9.,]/g, ""); conFoco(stockMovimiento); });
  $("#movOk").onclick = () => {
    const items = v.lineas.filter(l => num(l.cantidad) > 0).map(l => {
      const it = { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: num(l.cantidad) };
      if (v.mov === "se_quedo" && l.precio !== "" && l.precio != null) it.precio = num(l.precio);
      return it;
    });
    encolar({ tipo: "stock", movimiento: v.mov, socio: v.socio, items });
    toast(`✅ ${m.t} · ${v.socio}`);
    ir("stock", { socio: v.socio });
  };
}

// ---------- Conteo ----------
function stockConteo() {
  const v = S.vista;
  header("Conteo", v.socio, true);
  v.cuenta = v.cuenta || {};   // clave -> contado (texto)
  v.expl = v.expl || {};       // clave -> { se_quedo, perdida, desecho, promo, nota }
  const its = itemsDe(v.socio).slice();
  // Siempre se pueden contar bolas aunque el sistema diga 0 (por si aparecen).
  if (!its.some(it => norm(it.producto) === "bolas de queso")) its.push({ producto: "Bolas de queso", variante: "", sabor: "", u: "", cantidad: 0 });
  const key = it => [it.producto, it.variante, it.sabor].map(norm).join("|");
  let listo = true, debe = 0;
  const filas = its.map((it, i) => {
    const k = key(it), c = v.cuenta[k];
    const contado = c === undefined || c === "" ? null : num(c);
    const e = v.expl[k] || (v.expl[k] = { se_quedo: "", perdida: "", desecho: "", promo: "", nota: "" });
    let det = "";
    if (contado === null) listo = false;
    else {
      const dif = Math.round((it.cantidad - contado) * 100) / 100;
      if (dif > 0) {
        const exp = ["se_quedo", "perdida", "desecho", "promo"].reduce((a, m) => a + num(e[m]), 0);
        const ok = Math.abs(exp - dif) < 0.005;
        if (!ok) listo = false;
        debe += num(e.se_quedo) * precioUnit(it, "contado") + num(e.perdida) * precioUnit(it, "costo");
        det = `<div class="banner ${ok ? "" : "bad"}" style="margin-top:8px">${ok ? "✅" : "⚠️"} Faltan ${cantTxt2(dif, it.u)}. ¿Qué pasó? ${ok ? "(explicado)" : `(van ${cantTxt2(exp)} de ${cantTxt2(dif)})`}</div>
          ${["se_quedo", "perdida", "desecho", "promo"].map(m => `<div class="line" style="align-items:center;margin-top:6px"><span>${MOV[m].t}</span><input class="qty" style="width:80px" inputmode="decimal" placeholder="0" value="${esc(e[m])}" data-ex="${i}|${m}"></div>`).join("")}
          <div class="hint">Si lo entregó a un cliente de la lista y no se anotó, anota esa entrega primero (desde su stock) y vuelve a contar.</div>`;
      } else if (dif < 0) {
        det = `<div class="banner" style="margin-top:8px">Sobran ${cantTxt2(-dif, it.u)}. ¿De dónde salieron?</div>
          <input class="txt" style="margin-top:6px" placeholder="Ej: estaban en la otra nevera" value="${esc(e.nota)}" data-nota="${i}">`;
        if (!(e.nota || "").trim()) listo = false;
      } else det = `<div class="hint" style="margin-top:6px">✅ Cuadra</div>`;
    }
    return `<div class="row" style="display:block">
      <div class="line"><b>${esc(descItem(it))}</b><span class="hint">sistema: ${cantTxt2(it.cantidad, it.u)}</span></div>
      <div class="line" style="align-items:center;margin-top:8px"><span>Contaste</span><input class="qty" style="width:90px" id="cc${i}" inputmode="decimal" placeholder="?" value="${esc(c == null ? "" : c)}" data-c="${i}"></div>${det}</div>`;
  });
  $("#screen").innerHTML = `
    <div class="hint">Cuenta lo que ${norm(v.socio) === norm(miSocio()) ? "tienes" : "tiene " + esc(v.socio)} en la mano. Si no cuadra, di qué pasó: sin eso no se guarda.</div>
    <div class="rows">${filas.join("")}</div>
    ${debe > 0.005 ? `<div class="efecto">${esc(v.socio)} queda debiendo <b>${fmt(debe)}</b>.</div>` : ""}
    <div class="btns"><button class="go" id="conOk" ${listo ? "" : "disabled"}>Guardar conteo</button></div>`;
  $$("[data-c]").forEach(inp => inp.oninput = () => { v.cuenta[key(its[+inp.dataset.c])] = inp.value.replace(/[^0-9.,]/g, ""); conFoco(stockConteo); });
  $$("[data-ex]").forEach(inp => inp.oninput = () => { const [i, m] = inp.dataset.ex.split("|"); v.expl[key(its[+i])][m] = inp.value.replace(/[^0-9.,]/g, ""); conFoco(stockConteo); });
  $$("[data-nota]").forEach(inp => inp.oninput = () => { v.expl[key(its[+inp.dataset.nota])].nota = inp.value; conFoco(stockConteo); });
  $("#conOk").onclick = () => {
    const items = [], explicaciones = [];
    its.forEach(it => {
      const k = key(it), contado = num(v.cuenta[k]), dif = Math.round((it.cantidad - contado) * 100) / 100;
      const base = { producto: it.producto, presentacion: it.variante || "", sabor: it.sabor || "" };
      if (contado > 0) items.push(Object.assign({ cantidad: contado }, base));
      if (dif > 0) ["se_quedo", "perdida", "desecho", "promo"].forEach(m => { if (num(v.expl[k][m]) > 0) explicaciones.push(Object.assign({ motivo: m, cantidad: num(v.expl[k][m]) }, base)); });
      if (dif < 0) explicaciones.push(Object.assign({ motivo: "entrada", cantidad: -dif, nota: v.expl[k].nota }, base));
    });
    encolar({ tipo: "conteo", socio: v.socio, items, explicaciones });
    toast(`✅ Conteo de ${v.socio} guardado`);
    ir("stock", { socio: v.socio });
  };
}

// ---------- Bolas sin responsable (cierre de la semana) ----------
// Recibidas − entregadas − dadas a socios. Lo del jueves va sin lista de
// compras, por eso el control es al cerrar la semana. Se asigna a quien las
// tiene y entran a su stock (servidor: stockBolasSinResponsable).
function avisoSinResponsable() {
  const sr = S.stock && S.stock.sinResponsable;
  if (!sr) return "";
  return `<button class="banner bad" id="sinResp" style="text-align:left;border:0;width:100%;cursor:pointer">⚠️ Quedaron <b>${cantTxt2(sr.sobran)} bolas</b> de la semana del ${fecha(sr.semana)} sin responsable (${cantTxt2(sr.recibidas)} recibidas, ${cantTxt2(sr.entregadas)} entregadas, ${cantTxt2(sr.aSocios)} a socios). ¿Quién las tiene? ›</button>`;
}
function cablearSinResponsable() { const b = $("#sinResp"); if (b) b.onclick = () => ir("stock", { asignar: true }); }
function stockAsignar() {
  const v = S.vista, sr = S.stock && S.stock.sinResponsable;
  header("¿Quién las tiene?", sr ? `${cantTxt2(sr.sobran)} bolas · semana del ${fecha(sr.semana)}` : "", true);
  if (!sr) { $("#screen").innerHTML = `<div class="hint">No hay bolas sin responsable. ✅</div>`; return; }
  v.quien = v.quien || miSocio();
  $("#screen").innerHTML = `
    <div class="hint">En la semana entraron ${cantTxt2(sr.recibidas)} bolas, se entregaron ${cantTxt2(sr.entregadas)} a clientes y ${cantTxt2(sr.aSocios)} a socios. Las ${cantTxt2(sr.sobran)} que faltan están en la mano de alguien: pasan a su stock y responde por ellas.</div>
    <div class="chips">${stockSocios().map(x => `<button class="chip" data-quien="${esc(x.socio)}" aria-pressed="${v.quien === x.socio}">${esc(x.socio)}</button>`).join("")}</div>
    <div class="hint">Si en realidad se entregaron y no se anotó, anota esas entregas y el aviso baja solo.</div>
    <div class="btns"><button class="go" id="asigOk" ${v.quien ? "" : "disabled"}>Las tiene ${esc(v.quien || "…")}</button></div>`;
  $$("[data-quien]").forEach(b => b.onclick = () => { v.quien = b.dataset.quien; stockAsignar(); });
  $("#asigOk").onclick = () => {
    encolar({ tipo: "stock", movimiento: "entrada", socio: v.quien, nota: sr.nota, items: [{ producto: "Bolas de queso", presentacion: "", sabor: "", cantidad: sr.sobran }] });
    S.stock.sinResponsable = null; guardar("stock", S.stock);
    toast(`✅ ${cantTxt2(sr.sobran)} bolas al stock de ${v.quien}`);
    ir("stock", { socio: v.quien });
  };
}

// ---------- "¿De dónde sale?" en Entregas / Entregar pedido ----------
function bloqueDesde(v) {
  if (!S.stock || !S.stock.activo) return "";
  const con = stockSocios().filter(x => itemsDe(x.socio).length);
  if (!con.length) return "";
  const falta = v.desde ? faltaEnStock(v) : "";
  return `<div class="label">¿De dónde sale?</div>
    <div class="chips"><button class="chip sm" data-desde="" aria-pressed="${!v.desde}">De lo recibido</button>
      ${con.map(x => `<button class="chip sm" data-desde="${esc(x.socio)}" aria-pressed="${v.desde === x.socio}">Stock de ${esc(x.socio)}</button>`).join("")}</div>
    ${falta ? `<div class="banner bad">${esc(falta)}</div>` : ""}`;
}
function faltaEnStock(v) {
  for (const l of v.lineas.filter(l => num(l.cantidad) > 0)) {
    const p = prodCat(l.producto), q = p && p.porLibra ? num(l.libras) : num(l.cantidad);
    const hay = saldoDe(v.desde, l);
    if (q > hay + 0.005) return `${v.desde} solo tiene ${cantTxt2(hay)} de ${descItem(l)}.`;
  }
  return "";
}
function cablearDesde(v, redibujar) { $$("[data-desde]").forEach(b => b.onclick = () => { v.desde = b.dataset.desde || ""; redibujar(); }); }

// ---------- Lo que sobra al recibir ----------
function sobrantesRecibir(v) {
  return v.lineas.filter(l => num(l.cantidad) > 0 && !(prodCat(l.producto) || {}).porLibra).map(l => {
    const sobra = Math.round((num(l.cantidad) - (l.falta || 0)) * 100) / 100;
    return sobra > 0 ? { producto: l.producto, presentacion: l.presentacion || "", sabor: l.sabor || "", cantidad: sobra } : null;
  }).filter(Boolean);
}
function bloqueSobrantes(v) {
  if (!S.stock || !S.stock.activo) return "";
  const so = sobrantesRecibir(v);
  if (!so.length) return "";
  v.sobraA = v.sobraA || miSocio() || (stockSocios()[0] || {}).socio;
  return `<div class="card"><div class="k" style="font-weight:700">Sobró de lo pedido</div>
    ${so.map(s => `<div class="line"><span>${esc(descItem(s))}</span><b>${cantTxt2(s.cantidad)}</b></div>`).join("")}
    <div class="hint">¿Quién se lo lleva? Queda en su stock y responde por eso.</div>
    <div class="chips">${stockSocios().map(x => `<button class="chip sm" data-sobra="${esc(x.socio)}" aria-pressed="${v.sobraA === x.socio}">${esc(x.socio)}</button>`).join("")}</div></div>`;
}
function cablearSobrantes(v, redibujar) { $$("[data-sobra]").forEach(b => b.onclick = () => { v.sobraA = b.dataset.sobra; redibujar(); }); }
