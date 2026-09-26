// Correcciones — pantallas. El servidor es AppCorrecciones.js: edita la fila
// original (sin líneas negativas) y guarda antes/después en "Correcciones".
// Pedidos: desde "¿Quién tomó cada pedido?" (lista de compras).
// Cobros y pagos: desde Cuentas → histórico → el pago.
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
