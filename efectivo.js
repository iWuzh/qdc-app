// ---------- Contar efectivo ----------
// Calculadora rápida de billetes y monedas dominicanos: se escribe cuántos hay
// de cada uno y da el total al momento, comparado con la caja del sistema
// (la misma de "caja" en el bot). No guarda nada en el Sheet: lo que se lleva
// contado queda en el teléfono hasta que se toque "Empezar de nuevo".
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

function contarEfectivo() {
  header("Contar efectivo", "Billetes y monedas", true);
  const c = leer("efectivo", {});              // { "2000": "12", ... } (texto, como se escribió)
  const cant = d => Math.max(0, Math.floor(num(c[d.v])));
  const total = DENOMINACIONES.reduce((a, d) => a + cant(d) * d.v, 0);
  const sistema = S.cuentas && S.cuentas.caja ? S.cuentas.caja.efectivo : null;
  const dif = sistema == null ? null : Math.round((total - sistema) * 100) / 100;
  const billetes = DENOMINACIONES.filter(d => d.tipo === "billete").reduce((a, d) => a + cant(d), 0);
  const fila = d => `<label class="ef-fila">
      <span class="ef-den ${d.tipo}" style="${d.c ? "--bill:" + d.c : ""}">${d.v.toLocaleString("en-US")}</span>
      <span class="ef-x">×</span>
      <input class="qty ef-q" id="ef${d.v}" inputmode="numeric" enterkeyhint="next" placeholder="0" value="${esc(c[d.v] || "")}" data-ef="${d.v}" aria-label="Cantidad de ${d.tipo === "billete" ? "billetes" : "monedas"} de ${d.v}">
      <span class="ef-sub">${cant(d) ? fmt(cant(d) * d.v) : ""}</span>
    </label>`;
  $("#screen").innerHTML = `
    <div class="ef-tot">
      <div class="k">Total contado</div>
      <div class="v">${fmt(total)}</div>
      ${sistema == null ? `<div class="hint">Sin la caja del sistema (hace falta señal una vez).</div>`
        : !total ? `<div class="hint">El sistema dice <b>${fmt(sistema)}</b>.</div>`
        : `<div class="ef-dif ${Math.abs(dif) < 0.5 ? "ok" : "bad"}">${Math.abs(dif) < 0.5 ? "✓ Cuadra con el sistema"
            : dif < 0 ? `Faltan <b>${fmt(-dif)}</b> · el sistema dice ${fmt(sistema)}` : `Sobran <b>${fmt(dif)}</b> · el sistema dice ${fmt(sistema)}`}</div>`}
    </div>
    <div class="label">Billetes${billetes ? " · " + billetes : ""}</div>
    <div class="ef-lista">${DENOMINACIONES.filter(d => d.tipo === "billete").map(fila).join("")}</div>
    <div class="label">Monedas</div>
    <div class="ef-lista">${DENOMINACIONES.filter(d => d.tipo === "moneda").map(fila).join("")}</div>
    <div class="btns"><button class="go alt" id="efLimpiar" ${total ? "" : "disabled"}>Empezar de nuevo</button><button class="go" id="efCompartir" ${total ? "" : "disabled"}>Compartir</button></div>`;
  $$("[data-ef]").forEach(inp => {
    inp.oninput = () => { c[inp.dataset.ef] = inp.value.replace(/[^0-9]/g, ""); guardar("efectivo", c); conFoco(contarEfectivo); };
    // Enter pasa a la siguiente denominación: se cuenta un paquete, se escribe y se sigue.
    inp.onkeydown = e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const i = DENOMINACIONES.findIndex(d => String(d.v) === inp.dataset.ef), sig = DENOMINACIONES[i + 1];
      if (sig) document.getElementById("ef" + sig.v).focus(); else inp.blur();
    };
  });
  $("#efLimpiar").onclick = () => { guardar("efectivo", {}); contarEfectivo(); window.scrollTo(0, 0); };
  $("#efCompartir").onclick = () => {
    const hoy = new Date();
    const txt = [`💵 Efectivo contado ${hoy.getDate()} ${MESES[hoy.getMonth()]}: *${fmt(total)}*`]
      .concat(DENOMINACIONES.filter(cant).map(d => `${cant(d)} × ${d.v.toLocaleString("en-US")} = ${fmt(cant(d) * d.v)}`))
      .concat(dif == null ? [] : [Math.abs(dif) < 0.5 ? "✓ Cuadra con el sistema" : dif < 0 ? `Faltan ${fmt(-dif)} (sistema: ${fmt(sistema)})` : `Sobran ${fmt(dif)} (sistema: ${fmt(sistema)})`])
      .join("\n");
    if (navigator.share) navigator.share({ text: txt }).catch(() => {});
    else navigator.clipboard.writeText(txt).then(() => toast("Copiado: pégalo en WhatsApp"), () => toast("No se pudo copiar"));
  };
}
