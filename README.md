# App QDC — pantallas

App instalable (PWA) de Quesos Don Carlos. Solo pantallas: **aquí no hay datos ni
claves**. Todo pasa por el servidor (Apps Script del bot, `Api.js`) con un PIN por
persona.

- `config.js` — a qué servidor habla (prueba o producción).
- `sw.js` — guarda las pantallas en el teléfono para abrir sin señal. Al cambiar
  cualquier archivo, subir `VERSION`.
- Los registros sin señal esperan en una cola en el teléfono y se mandan solos
  cuando vuelve la señal; el servidor no los duplica.

Documentación completa: wiki `concepts/app-qdc.md` (Second Brain).
