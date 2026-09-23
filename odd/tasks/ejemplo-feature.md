---
ramas: ["docs/odd-ejemplo-feature", "feat/ejemplo-feature*"]
---

# Notificaciones por correo de pedidos nuevos

## Tareas

- [x] **T1 — Enviar el correo al crear un pedido**: dispara un correo al equipo de ventas apenas se confirma un pedido nuevo, con el detalle de los ítems y el total.
- [ ] **T2 — Reintentos ante fallas del proveedor de correo**: si el envío falla, reintentar con backoff y registrar el error sin bloquear la confirmación del pedido.
- [ ] **QA1 — Prueba manual del flujo completo**: crear un pedido de prueba y verificar que el correo llega con el formato esperado, incluidos los casos de fallo simulado del proveedor.
