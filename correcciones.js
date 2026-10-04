// Correcciones — pantallas. El servidor es AppCorrecciones.js: edita la fila
// original (sin líneas negativas) y guarda antes/después en "Correcciones".
// Pedidos: desde "¿Quién tomó cada pedido?" (lista de compras).
// Cobros y pagos: desde Cuentas → histórico → el pago.
// Entregas: desde Cuentas → cliente → la entrega → ✏️ Corregir esta entrega
// (el servidor ajusta también su factura QDC y, si salió de un stock, el stock).
"use strict";

// ---------- Pedido de un cliente (todas sus filas de la semana) ----------
function corrPedido() {
  const v = S.vista, l = S.compras && S.compras.lista;
  const c = l && (l.quien || []).flatMap(s => s.clientes).find(x => x.cliente === v.corr);
  header("Corregir pedido", v.corr || "", true);
  if (!c || !c.filas) { $("#screen").innerHTML = `<div class="hint">No encontré ese pedido. Actualiza y vuelve a intentar.</div>`; return; }
  v.nuevo = v.nuevo || {};      // fila -> cantidad (texto) | "anular"
  const cambios = c.filas.filter(f => v.nuevo[f.fila] !== undefined && (v.nuevo[f.fila] === "anular" || num(v.nuevo[f.fila]) !== f.q));
  $("#screen").innerHTML = `
    <div class="hint">Cambia la cantidad o anula la línea. Se corrige el pedido original (no se agrega nada en negativo) y queda anotado quién lo cambió y por qué.</div>
    <div class="rows">${c.filas.map(f => { const n = v.nuevo[f.fila], anul = n === "anular"; return `<div class="row" style="display:block;${anul ? "opacity:.55" : ""}">
      <div class="line"><b style="${anul ? "text-decoration:line-through" : ""}">${esc(pdfNombre(f.d))}</b><span class="hint">${fecha(f.fecha)} · era ${f.q}${f.porLibra ? " barra" + (f.q === 1 ? "" : "s") : ""}</span></div>
      <div class="line" style="align-items:center;margin-top:8px">
        ${anul ? `<span class="hint bad">Se anula</span>` : `<div class="step"><button data-cm="${f.fila}">−</button><input class="qty" id="cq${f.fila}" inputmode="decimal" value="${esc(n === undefined ? f.q : n)}" data-cq="${f.fila}"><button data-cp="${f.fila}">+</button></div>`}
        <button class="chip sm" data-an="${f.fila}" aria-pressed="${anul}">${anul ? "Deshacer" : "Anular"}</button></div></div>`; }).join("")}</div>
    <div class="field"><label for="corrMot">¿Por qué? (opcional)</label><input class="txt" id="corrMot" placeholder="Ej: el cliente cambió el pedido" value="${esc(v.motivo || "")}"></div>
    <div class="btns"><button class="go" id="corrOk" ${cambios.length ? "" : "disabled"}>Guardar ${cambios.length ? cambios.length + " cambio" + (cambios.length > 1 ? "s" : "") : ""}</button></div>`;
  const fil = n => c.filas.find(f => f.fila === +n);
  const cur = f => v.nuevo[f.fila] === undefined ? f.q : num(v.nuevo[f.fila]);
  $$("[data-cp]").forEach(b => b.onclick = () => { const f = fil(b.dataset.cp); v.nuevo[f.fila] = String(cur(f) + 1); corrPedido(); });
  $$("[data-cm]").forEach(b => b.onclick = () => { const f = fil(b.dataset.cm); v.nuevo[f.fila] = String(Math.max(0, cur(f) - 1)); corrPedido(); });
  $$("[data-cq]").forEach(i => i.oninput = () => { v.nuevo[i.dataset.cq] = i.value.replace(/[^0-9.,]/g, ""); conFoco(corrPedido); });
  $$("[data-an]").forEach(b => b.onclick = () => { const f = fil(b.dataset.an); v.nuevo[f.fila] = v.nuevo[f.fila] === "anular" ? undefined : "anular"; corrPedido(); });
  $("#corrMot").oninput = e => { v.motivo = e.target.value; };
  $("#corrOk").onclick = () => {
    encolar({ tipo: "correccion", hoja: "Pedidos", motivo: (v.motivo || "").trim(),
      cambios: cambios.map(f => v.nuevo[f.fila] === "anular" || num(v.nuevo[f.fila]) === 0 ? { fila: f.fila, firma: f.firma, anular: true } : { fila: f.fila, firma: f.firma, cantidad: num(v.nuevo[f.fila]) }) });
    toast(`✏️ Pedido de ${v.corr} corregido`);
    ir("recibir", { lista: true, verQuien: true });
  };
}

// ---------- Cobro / pago: corregir monto o anular ----------
function bloqueCorregirPago(p, cobrar) {
  if (!p.fila || p.local) return p.local ? `<div class="hint">Todavía no se ha enviado: no se puede corregir hasta que llegue al servidor.</div>` : "";
  const v = S.vista;
  if (!v.corrPago) return `<div class="btns"><button class="go alt" id="corrPagoAbrir">✏️ Corregir o anular este ${cobrar ? "cobro" : "pago"}</button></div>`;
  const m = num(v.corrMonto);
  return `<div class="panel">
    <div class="k" style="font-weight:700">Corregir ${cobrar ? "cobro" : "pago"} de ${fmt(p.monto)}</div>
    <label class="monto"><span>RD$</span><input id="corrMonto" inputmode="decimal" placeholder="Monto correcto" value="${esc(v.corrMonto || "")}"></label>
    <div class="field"><label for="corrMotP">¿Por qué? (opcional)</label><input class="txt" id="corrMotP" placeholder="Ej: se anotó de más" value="${esc(v.motivo || "")}"></div>
    <div class="btns"><button class="go alt" id="corrAnular">Anular ${cobrar ? "cobro" : "pago"}</button><button class="go" id="corrGuardar" ${m > 0 && Math.abs(m - p.monto) > 0.005 ? "" : "disabled"}>Guardar monto</button></div>
    <button class="add" id="corrCancelar">Cancelar</button></div>`;
}
function cablearCorregirPago(p, cobrar, redibujar) {
  const v = S.vista, hoja = cobrar ? "Cobros" : "Pagos";
  const ab = $("#corrPagoAbrir"); if (ab) ab.onclick = () => { v.corrPago = true; v.corrMonto = String(p.monto); redibujar(); };
  const mo = $("#corrMonto"); if (mo) mo.oninput = e => { v.corrMonto = e.target.value.replace(/[^0-9.,]/g, ""); conFoco(redibujar); };
  const mt = $("#corrMotP"); if (mt) mt.oninput = e => { v.motivo = e.target.value; };
  const ca = $("#corrCancelar"); if (ca) ca.onclick = () => { v.corrPago = false; redibujar(); };
  const enviar = cambio => {
    encolar({ tipo: "correccion", hoja, motivo: (v.motivo || "").trim(), cambios: [Object.assign({ fila: p.fila, firma: p.firma }, cambio)] });
    // Se ve al momento; el servidor manda los números buenos al sincronizar.
    const c = cobrar ? S.cuentas.cobrar.find(x => x.cliente === v.quien) : S.cuentas.pagar.find(x => x.proveedor === v.quien);
    if (c) {
      const nuevo = cambio.anular ? 0 : cambio.monto, dif = nuevo - p.monto;
      c.pagado += dif; c.debe -= dif;
      if (cambio.anular) c.pagos.splice(c.pagos.indexOf(p), 1); else { p.monto = nuevo; p.local = true; }
      if (S.cuentas.caja) S.cuentas.caja.efectivo += cobrar ? dif : -dif;
      guardar("cuentas", S.cuentas);
    }
    toast(cambio.anular ? "✏️ Anulado" : "✏️ Corregido");
    ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "hist" });
  };
  const an = $("#corrAnular"); if (an) an.onclick = () => enviar({ anular: true });
  const gu = $("#corrGuardar"); if (gu) gu.onclick = () => enviar({ monto: num(v.corrMonto) });
}

// ---------- Entrega: cambiar cantidades o anular líneas ----------
// La cantidad nueva se cobra al MISMO precio por unidad que tenía la línea.
function corrEntrega(c, d) {
  const v = S.vista;
  header("Corregir entrega", v.quien + " · " + d.d.n, true);
  const its = d.d.items.filter(it => it.fila && !it.ajuste);
  v.nuevo = v.nuevo || {};
  const cur = it => v.nuevo[it.fila] === undefined ? it.q : num(v.nuevo[it.fila]);
  const anul = it => v.nuevo[it.fila] === "anular";
  const cambios = its.filter(it => v.nuevo[it.fila] !== undefined && (anul(it) || Math.abs(cur(it) - it.q) > 0.0005));
  const nuevoTotal = it => anul(it) ? 0 : it.q ? Math.round(it.total * cur(it) / it.q * 100) / 100 : it.total;
  const dif = cambios.reduce((a, it) => a + nuevoTotal(it) - it.total, 0);
  $("#screen").innerHTML = `
    <div class="hint">Cambia lo que de verdad se entregó, o anula la línea. Se corrige la entrega original al mismo precio, su factura y, si salió del stock de un socio, ese stock. Queda anotado quién lo cambió y por qué.</div>
    <div class="rows">${its.map(it => { const a = anul(it); return `<div class="row" style="display:block;${a ? "opacity:.55" : ""}">
      <div class="line"><b style="${a ? "text-decoration:line-through" : ""}">${esc(pdfNombre(it.d))}</b><span class="hint">era ${cantTxt(it)} · ${fmt(it.total)}</span></div>
      <div class="line" style="align-items:center;margin-top:8px">
        ${a ? `<span class="hint bad">Se anula</span>` : `<div class="step"><button data-em="${it.fila}">−</button><input class="qty" id="eq${it.fila}" inputmode="decimal" value="${esc(v.nuevo[it.fila] === undefined ? it.q : v.nuevo[it.fila])}" data-eq="${it.fila}"><button data-ep="${it.fila}">+</button></div>
          <span class="hint">${fmt(nuevoTotal(it))}</span>`}
        <button class="chip sm" data-ea="${it.fila}" aria-pressed="${a}">${a ? "Deshacer" : "Anular"}</button></div></div>`; }).join("")}</div>
    ${cambios.length ? `<div class="efecto">La entrega ${dif < 0 ? "baja" : "sube"} <b>${fmt(Math.abs(dif))}</b>: ${esc(v.quien)} queda debiendo <b>${fmt(c.debe + dif)}</b>.</div>` : ""}
    <div class="field"><label for="corrMotE">¿Por qué? (opcional)</label><input class="txt" id="corrMotE" placeholder="Ej: se anotaron 20 y fueron 15" value="${esc(v.motivo || "")}"></div>
    <div class="btns"><button class="go alt" id="corrEntNo">Cancelar</button><button class="go" id="corrEntOk" ${cambios.length ? "" : "disabled"}>Guardar ${cambios.length ? cambios.length + " cambio" + (cambios.length > 1 ? "s" : "") : ""}</button></div>`;
  const fil = n => its.find(it => it.fila === +n);
  const paso = it => it.u ? 0.5 : 1;
  $$("[data-ep]").forEach(b => b.onclick = () => { const it = fil(b.dataset.ep); v.nuevo[it.fila] = String(Math.round((cur(it) + paso(it)) * 100) / 100); corrEntrega(c, d); });
  $$("[data-em]").forEach(b => b.onclick = () => { const it = fil(b.dataset.em); v.nuevo[it.fila] = String(Math.max(0, Math.round((cur(it) - paso(it)) * 100) / 100)); corrEntrega(c, d); });
  $$("[data-eq]").forEach(i => i.oninput = () => { v.nuevo[i.dataset.eq] = i.value.replace(/[^0-9.,]/g, ""); conFoco(() => corrEntrega(c, d)); });
  $$("[data-ea]").forEach(b => b.onclick = () => { const it = fil(b.dataset.ea); v.nuevo[it.fila] = anul(it) ? undefined : "anular"; corrEntrega(c, d); });
  $("#corrMotE").oninput = e => { v.motivo = e.target.value; };
  $("#corrEntNo").onclick = () => { v.corrEnt = false; ctaDet(); };
  $("#corrEntOk").onclick = () => {
    encolar({ tipo: "correccion", hoja: "Entregas", motivo: (v.motivo || "").trim(),
      cambios: cambios.map(it => anul(it) || cur(it) === 0 ? { fila: it.fila, firma: it.firma, anular: true } : { fila: it.fila, firma: it.firma, cantidad: cur(it) }) });
    // Se ve al momento; el servidor manda los números buenos al sincronizar.
    const orig = c.docs.flatMap(x => x.items);
    cambios.forEach(it => {
      const t = nuevoTotal(it), o = orig.find(x => x.fila === it.fila);
      c.facturado += t - it.total; c.debe += t - it.total;
      if (o) { o.q = anul(it) ? 0 : cur(it); o.total = t; o.fila = null; }   // sin fila: no se re-corrige hasta sincronizar
    });
    c.docs.forEach(x => { x.items = x.items.filter(o => o.q > 0 || o.ajuste); });
    c.docs = c.docs.filter(x => x.items.length);
    guardar("cuentas", S.cuentas);
    toast("✏️ Entrega corregida");
    ir("cuentas", { lado: v.lado, quien: v.quien, nivel: "hist" });
  };
}
