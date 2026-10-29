// Simula el proveedor en el proceso hijo de la prueba del comando.
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  if (calls === 2) return new Response("error simulado", { status: 503 });
  return new Response(JSON.stringify({ status: "Success", data: [[]] }), { status: 200 });
};
