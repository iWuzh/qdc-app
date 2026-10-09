// ---------- Contar efectivo ----------
// Calculadora rápida de billetes y monedas dominicanos: se escribe cuántos hay
// de cada uno y da el total al momento. Dos usos:
//  - "caja" (Inicio → Caja → Contar efectivo): compara con la caja del sistema
//    (la misma de "caja" en el bot) y, si no cuadra, "Aplicar a la caja" deja
//    la caja del sistema en lo contado (ajuste en Pagos, con quién y por qué).
//  - "monto" (botón 💵 en Cobrar / Pagar / Gasto): arma el monto contando los
//    billetes y lo devuelve al formulario con "Usar RD$X".
// Lo contado queda en el teléfono (un borrador para cada uso) hasta que se
// use o se toque "Empezar de nuevo".
// Colores aproximados de los billetes de la serie actual, para encontrarlos sin leer.
const DENOMINACIONES = [
  { v: 2000, tipo: "billete", c: "#6E63C9" },
  { v: 1000, tipo: "billete", c: "#C24A3F" },
  { v: 500, tipo: "billete", c: "#23877F" },
  { v: 200, tipo: "billete", c: "#B84A7C" },
  { v: 100, tipo: "billete", c: "#D9822B" },
  { v: 50, tipo: "billete", c: "#8B5BB5" },
  { v: 20, tipo: "billete", c: "#9A7646" },
  { v: 25, tipo: "moneda" },
  { v: 10, tipo: "moneda" },
  { v: 5, tipo: "moneda" }
];
const PARA_TXT = { cobro: "el cobro", pago: "el pago", gasto: "el gasto" };

function contarEfectivo() {
  const v = S.vista, esMonto = v.contar === "monto";
  const clave = esMonto ? "efectivoMonto" : "efectivo";
  const para = v.para || {};
  header(esMonto ? "Contar billetes" : "Contar efectivo",
    esMonto ? "Para " + (PARA_TXT[para.rapido] || "el monto") + (para.quien ? " · " + para.quien : "") : "La caja contra el sistema", true);
  const c = leer(clave, {});              // { "2000": "12", ... } (texto, como se escribió)
  const cant = d => Math.max(0, Math.floor(num(c[d.v])));
  const enMano = DENOMINACIONES.reduce((a, d) => a + cant(d) * d.v, 0);
  // Cuenta de banco (solo en "caja"): el sistema lleva una sola caja y no sabe
  // qué entró en efectivo y qué por transferencia, así que se cuadra la suma.
  // El saldo no se borra con "Empezar de nuevo": cambia poco entre conteos.
  const bancoTxt = esMonto ? "" : leer("efectivoBanco", "");
  const banco = Math.max(0, Math.round(num(bancoTxt) * 100) / 100);
  const total = Math.round((enMano + banco) * 100) / 100;
  const sistema = !esMonto && S.cuentas && S.cuentas.caja ? S.cuentas.caja.efectivo : null;
  const dif = sistema == null ? null : Math.round((total - sistema) * 100) / 100;
  const cuadra = dif != null && Math.abs(dif) < 0.5;
  const billetes = DENOMINACIONES.filter(d => d.tipo === "billete").reduce((a, d) => a + cant(d), 0);
  const fila = d => `<label class="ef-fila">
      <span class="ef-den ${d.tipo}" style="${d.c ? "--bill:" + d.c : ""}">${d.v.toLocaleString("en-US")}</span>
      <span class="ef-x">×</span>
      <input class="qty ef-q" id="ef${d.v}" inputmode="numeric" enterkeyhint="next" placeholder="0" value="${esc(c[d.v] || "")}" data-ef="${d.v}" aria-label="Cantidad de ${d.tipo === "billete" ? "billetes" : "monedas"} de ${d.v}">
      <span class="ef-sub">${cant(d) ? fmt(cant(d) * d.v) : ""}</span>
    </label>`;
  const comparacion = esMonto ? ""
    : sistema == null ? `<div class="hint">Sin la caja del sistema (hace falta señal una vez).</div>`
    : !total ? `<div class="hint">El sistema dice <b>${fmt(sistema)}</b>.</div>`
    : `<div class="ef-dif ${cuadra ? "ok" : "bad"}">${cuadra ? "✓ Cuadra con el sistema"
        : dif < 0 ? `Faltan <b>${fmt(-dif)}</b> · el sistema dice ${fmt(sistema)}` : `Sobran <b>${fmt(dif)}</b> · el sistema dice ${fmt(sistema)}`}</div>`;
  // Aplicar a la caja: solo si no cuadra; pide el motivo (queda en el Sheet).
  const aplicar = esMonto || sistema == null || !total || cuadra ? "" : v.aplicando
    ? `<div class="panel">
        <div>La caja del sistema pasa de <b>${fmt(sistema)}</b> a <b>${fmt(total)}</b> (${dif < 0 ? "faltan " + fmt(-dif) : "sobran " + fmt(dif)}).</div>
        <div class="field"><label for="efMotivo">¿Por qué no cuadraba?</label><input class="txt" id="efMotivo" placeholder="Ej: cobro de Rafa sin anotar, vuelto mal dado…" value="${esc(v.motivo)}"></div>
        <div class="hint">Queda anotado en el Sheet como ajuste de caja, con tu nombre y el motivo. El bot dirá lo mismo en <b>caja</b>.</div>
        <div class="btns"><button class="go alt" id="efNo">Cancelar</button><button class="go" id="efSi" ${(v.motivo || "").trim() ? "" : "disabled"}>Ajustar caja a ${fmt(total)}</button></div>
      </div>`
    : `<button class="go alt" id="efAplicar">Aplicar este conteo a la caja</button>`;
  $("#screen").innerHTML = `
    <div class="ef-tot">
      <div class="k">${esMonto ? "Total" : "Total contado"}</div>
      <div class="v">${fmt(total)}</div>
      ${banco ? `<div class="k">Efectivo ${fmt(enMano)} · Banco ${fmt(banco)}</div>` : ""}
      ${comparacion}
    </div>
    <div class="label">Billetes${billetes ? " · " + billetes : ""}</div>
    <div class="ef-lista">${DENOMINACIONES.filter(d => d.tipo === "billete").map(fila).join("")}</div>
    <div class="label">Monedas</div>
    <div class="ef-lista">${DENOMINACIONES.filter(d => d.tipo === "moneda").map(fila).join("")}</div>
    ${esMonto ? "" : `<div class="label">Cuenta de banco</div>
    <div class="field"><label for="efBanco">Saldo en la cuenta</label><input class="txt" id="efBanco" inputmode="decimal" placeholder="0" value="${esc(bancoTxt)}"></div>
    <div class="hint">Se suma al efectivo para comparar con el sistema, que no separa efectivo de transferencias.</div>`}
    ${aplicar}
    <div class="btns"><button class="go alt" id="efLimpiar" ${enMano ? "" : "disabled"}>Empezar de nuevo</button>
      ${esMonto ? `<button class="go" id="efUsar" ${total ? "" : "disabled"}>Usar ${fmt(total)}</button>` : `<button class="go" id="efCompartir" ${total ? "" : "disabled"}>Compartir</button>`}</div>`;
  $$("[data-ef]").forEach(inp => {
    inp.oninput = () => { c[inp.dataset.ef] = inp.value.replace(/[^0-9]/g, ""); guardar(clave, c); conFoco(contarEfectivo); };
    // Enter pasa a la siguiente denominación: se cuenta un paquete, se escribe y se sigue.
    inp.onkeydown = e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const i = DENOMINACIONES.findIndex(d => String(d.v) === inp.dataset.ef), sig = DENOMINACIONES[i + 1];
      if (sig) document.getElementById("ef" + sig.v).focus(); else inp.blur();
    };
  });
  const ba = $("#efBanco"); if (ba) ba.oninput = () => { guardar("efectivoBanco", ba.value.replace(/[^0-9.]/g, "")); conFoco(contarEfectivo); };
  $("#efLimpiar").onclick = () => { guardar(clave, {}); v.aplicando = false; contarEfectivo(); window.scrollTo(0, 0); };
  const ap = $("#efAplicar"); if (ap) ap.onclick = () => { v.aplicando = true; contarEfectivo(); setTimeout(() => $("#efMotivo") && $("#efMotivo").focus(), 0); };
  const no = $("#efNo"); if (no) no.onclick = () => { v.aplicando = false; contarEfectivo(); };
  const mo = $("#efMotivo"); if (mo) mo.oninput = e => { v.motivo = e.target.value; conFoco(contarEfectivo); };
  const si = $("#efSi"); if (si) si.onclick = () => {
    encolar({ tipo: "ajuste_caja", contado: total, motivo: v.motivo.trim() });
    toast(`✅ Caja ajustada a ${fmt(total)}`);
    ir("inicio");
  };
  const usar = $("#efUsar"); if (usar) usar.onclick = () => {
    guardar(clave, {});
    ir("inicio", Object.assign({}, para, { monto: String(total) }));
  };
  const co = $("#efCompartir"); if (co) co.onclick = () => {
    const hoy = new Date();
    const txt = [`💵 ${banco ? "Caja contada" : "Efectivo contado"} ${hoy.getDate()} ${MESES[hoy.getMonth()]}: *${fmt(total)}*`]
      .concat(DENOMINACIONES.filter(cant).map(d => `${cant(d)} × ${d.v.toLocaleString("en-US")} = ${fmt(cant(d) * d.v)}`))
      .concat(banco ? [`Efectivo: ${fmt(enMano)}`, `🏦 Banco: ${fmt(banco)}`] : [])
      .concat(dif == null ? [] : [cuadra ? "✓ Cuadra con el sistema" : dif < 0 ? `Faltan ${fmt(-dif)} (sistema: ${fmt(sistema)})` : `Sobran ${fmt(dif)} (sistema: ${fmt(sistema)})`])
      .join("\n");
    if (navigator.share) navigator.share({ text: txt }).catch(() => {});
    else navigator.clipboard.writeText(txt).then(() => toast("Copiado: pégalo en WhatsApp"), () => toast("No se pudo copiar"));
  };
}
