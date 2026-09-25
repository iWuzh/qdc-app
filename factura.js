// Factura del cliente en PDF — se arma en el teléfono, sin servidor ni permisos
// nuevos (ver wiki concepts/app-qdc.md). Es la MISMA factura que el bot: una
// por cliente por semana de entrega, con el número QDC-### de FacturasCliente.
// Los datos vienen en S.cuentas.cobrar[].facturas (appFacturasCliente, Api.js).
//
// Compartir (a WhatsApp) tiene que pasar dentro del toque del botón: por eso
// la librería y el logo se preparan ANTES (prepararFactura) y armar el PDF es
// instantáneo. Si todavía no está listo, el primer toque lo prepara y avisa.
"use strict";

const PDF = { listo: false, preparando: null, logo: null };

const COL = { verde: [60, 117, 50], oscuro: [48, 82, 31], crema: [252, 245, 210], azul: [15, 19, 57], gris: [110, 110, 110], linea: [226, 220, 190] };
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function prepararFactura() {
  if (PDF.listo) return Promise.resolve();
  if (PDF.preparando) return PDF.preparando;
  const lib = window.jspdf ? Promise.resolve() : new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "vendor/jspdf.umd.min.js"; s.onload = ok; s.onerror = () => mal(new Error("No cargó jsPDF"));
    document.head.appendChild(s);
  });
  // Logo achicado a 360 px: el original pesa 110 KB y el PDF sale liviano para WhatsApp.
  const logo = new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 360;
      c.getContext("2d").drawImage(img, 0, 0, 360, 360);
      PDF.logo = c.toDataURL("image/jpeg", 0.85); ok();
    };
    img.onerror = () => ok();     // sin logo igual se arma la factura
    img.src = "logo.jpg";
  });
  PDF.preparando = Promise.all([lib, logo]).then(() => { PDF.listo = true; }).catch(e => { PDF.preparando = null; throw e; });
  return PDF.preparando;
}

// El Sheet guarda "pina", "Galon", "freir": en la factura del cliente van bien escritos.
const PDF_BONITO = [[/\bpina\b/gi, "Piña"], [/\bgalon\b/gi, "galón"], [/\bfreir\b/gi, "freír"], [/\bdanes\b/gi, "danés"],
  [/\bazucar\b/gi, "azúcar"], [/\bmozarella\b/gi, "mozzarella"]];
function pdfNombre(d) {
  const partes = String(d).split(" · ").map(x => {
    let t = x.trim();
    for (const [re, v] of PDF_BONITO) t = t.replace(re, v);
    return t.charAt(0).toUpperCase() + t.slice(1);
  });
  return partes.join(" · ");
}
const pdfMonto = n => "RD$" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pdfCant = it => (Number.isInteger(it.q) ? String(it.q) : Number(it.q).toFixed(2).replace(/\.?0+$/, "")) + (it.u ? " " + it.u : "");
function pdfSemana(iso) {
  const a = new Date(iso + "T12:00:00"), b = new Date(a); b.setDate(b.getDate() + 6);
  return a.getMonth() === b.getMonth()
    ? `Semana del ${a.getDate()} al ${b.getDate()} de ${MESES_L[b.getMonth()]} ${b.getFullYear()}`
    : `Semana del ${a.getDate()} de ${MESES_L[a.getMonth()]} al ${b.getDate()} de ${MESES_L[b.getMonth()]} ${b.getFullYear()}`;
}

// f = { num, semana, cliente, items:[{d,q,u,total}], total }
function armarFacturaPDF(f) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a5" });           // 148 × 210
  const W = 148, M = 10, hoy = new Date();
  // Bordes DERECHOS de Cant., Precio y Subtotal (todo alineado a la derecha).
  const col = { prod: M + 3, cant: 74, precio: 103, sub: W - M - 3 };

  const encabezado = primera => {
    doc.setFillColor(...COL.crema); doc.rect(0, 0, W, primera ? 40 : 22, "F");
    if (PDF.logo && primera) doc.addImage(PDF.logo, "JPEG", M, 5, 30, 30);
    const x = primera ? M + 36 : M;
    doc.setTextColor(...COL.verde); doc.setFont("helvetica", "bold"); doc.setFontSize(primera ? 22 : 14);
    doc.text("FACTURA", x, primera ? 16 : 11);
    doc.setTextColor(...COL.azul); doc.setFontSize(primera ? 13 : 10);
    doc.text(f.num + (primera ? "" : " (continuación)"), x, primera ? 24 : 18);
    if (primera) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...COL.gris);
      doc.text(pdfSemana(f.semana), x, 31);
      doc.text(`Emitida el ${hoy.getDate()} de ${MESES_L[hoy.getMonth()]} ${hoy.getFullYear()}`, x, 36);
    }
    return primera ? 40 : 22;
  };
  const cabeceraTabla = y => {
    doc.setFillColor(...COL.verde); doc.rect(M, y, W - 2 * M, 8, "F");
    doc.setTextColor(...COL.crema); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Producto", col.prod, y + 5.4);
    doc.text("Cant.", col.cant, y + 5.4, { align: "right" });
    doc.text("Precio", col.precio, y + 5.4, { align: "right" });
    doc.text("Subtotal", col.sub, y + 5.4, { align: "right" });
    return y + 8;
  };

  let y = encabezado(true) + 8;
  doc.setTextColor(...COL.gris); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text("CLIENTE", M, y);
  doc.setTextColor(...COL.azul); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(f.cliente, M, y + 6.5);
  y = cabeceraTabla(y + 11);

  const FIN_FILAS = 184;           // hasta aquí caben filas; debajo va el pie
  f.items.forEach((it, i) => {
    const nombre = doc.setFont("helvetica", "normal").setFontSize(9.5).splitTextToSize(pdfNombre(it.d), col.cant - col.prod - 11);
    const alto = Math.max(7, nombre.length * 4.2 + 2.8);
    if (y + alto > FIN_FILAS) { doc.addPage(); y = cabeceraTabla(encabezado(false) + 6); }
    if (i % 2) { doc.setFillColor(252, 250, 238); doc.rect(M, y, W - 2 * M, alto, "F"); }
    doc.setTextColor(...COL.azul); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(nombre, col.prod, y + 5);
    doc.text(pdfCant(it), col.cant, y + 5, { align: "right" });
    doc.text(it.q ? pdfMonto(it.total / it.q) + (it.u ? "/" + it.u : "") : "", col.precio, y + 5, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(pdfMonto(it.total), col.sub, y + 5, { align: "right" });
    y += alto;
    doc.setDrawColor(...COL.linea); doc.setLineWidth(0.2); doc.line(M, y, W - M, y);
  });

  y += 4;
  if (y + 13 > 186) { doc.addPage(); y = encabezado(false) + 8; }
  doc.setFillColor(...COL.oscuro); doc.roundedRect(W - M - 70, y, 70, 13, 2, 2, "F");
  doc.setTextColor(...COL.crema); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("TOTAL", W - M - 66, y + 8.4);
  doc.setFontSize(14); doc.text(pdfMonto(f.total), W - M - 4, y + 8.8, { align: "right" });

  doc.setTextColor(...COL.verde); doc.setFont("helvetica", "bolditalic"); doc.setFontSize(12);
  doc.text("¡Gracias por su compra!", W / 2, 192, { align: "center" });
  doc.setTextColor(...COL.gris); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text("Quesos Don Carlos · Hecho en Nagua", W / 2, 198, { align: "center" });
  return doc;
}

// Arma el PDF y abre el menú de compartir del teléfono (WhatsApp, etc.). Si el
// teléfono no puede compartir archivos, lo descarga.
async function compartirFactura(f) {
  if (!PDF.listo) {
    try { await prepararFactura(); } catch (e) { toast("No se pudo preparar el PDF. Revisa la señal y prueba otra vez."); return; }
    toast("Factura lista: toca otra vez para compartir"); return;
  }
  const nombre = `Factura ${f.num} - ${f.cliente}.pdf`.replace(/[\\/:*?"<>|]/g, "");
  const archivo = new File([armarFacturaPDF(f).output("blob")], nombre, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: `Factura ${f.num}` }); } catch (e) { /* canceló */ }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(archivo); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
