/**
 * Catálogo de campos del ICP: la ÚNICA fuente de verdad.
 *
 * Antes el formulario de Playbook offertaba un vocabulario (jobTitle, email,
 * phoneNumber, website, company.size...) que es el de los filtros de campaña,
 * no el del scoring. Como el scorer nunca ha entendido esos nombres, cada
 * criterio se evaluaba contra "undefined" y siempre salía falso.
 *
 * Aquí se listan exactamente los campos que `scoring.ts` sabe leer, con el
 * tipo de valor que espera cada uno. El formulario los pinta; el scorer los
 * evalúa. Si se añade un campo aquí, hay que añadirlo también en el `raw()`
 * de `scoring.ts` (y al revés).
 */

/** Cómo se introduce el valor del criterio en el formulario. */
export type IcpFieldKind = "bool" | "number" | "text";

export type IcpField = {
  /** Nombre interno: es lo que se guarda y lo que lee el scorer. */
  value: string;
  /** Lo que ve el usuario. */
  label: string;
  kind: IcpFieldKind;
  /** Explicación corta de qué mide el campo. */
  hint?: string;
};

export const ICP_FIELDS: IcpField[] = [
  // --- Perfil del profesional ---
  { value: "title", label: "Cargo o puesto", kind: "text", hint: "Texto del cargo (p. ej. «Dueño de la clínica»)." },
  { value: "sectorMatch", label: "Es del sector salud", kind: "bool", hint: "Se deduce del cargo, la empresa o su sector." },
  { value: "company", label: "Nombre de la empresa", kind: "text" },
  { value: "industry", label: "Sector de la empresa", kind: "text" },
  { value: "city", label: "Ciudad", kind: "text" },
  { value: "region", label: "Provincia", kind: "text" },
  { value: "employees", label: "Nº de empleados de la empresa", kind: "number" },
  { value: "teamSize", label: "Nº de profesionales de la consulta", kind: "number" },

  // --- Señales detectadas en la web (lo que más pesa en el encaje) ---
  { value: "soloPractice", label: "Consulta privada de un solo profesional", kind: "bool" },
  { value: "soloWithoutReception", label: "Atiende sin recepción ni personal de apoyo", kind: "bool" },
  { value: "homeVisits", label: "Trabaja a domicilio", kind: "bool" },
  { value: "manualAgenda", label: "Gestiona las citas a mano (sin software)", kind: "bool" },
  { value: "usesExternalBooking", label: "Usa una agenda externa", kind: "bool" },
  { value: "hasCrm", label: "Ya usa CRM o software de pacientes", kind: "bool" },
  { value: "chainLike", label: "Es una cadena o policlínica", kind: "bool" },
  { value: "isPlatform", label: "Es una plataforma de citas", kind: "bool" },

  // --- Contactabilidad ---
  { value: "hasEmail", label: "Tiene email de contacto", kind: "bool" },
  { value: "hasPhone", label: "Tiene teléfono", kind: "bool" },
  { value: "hasLinkedIn", label: "Tiene LinkedIn", kind: "bool" },
  { value: "hasWebsite", label: "Tiene web", kind: "bool" },
  { value: "noWebsite", label: "No tiene web", kind: "bool" },

  // --- Demanda demostrable (sólo si el negocio viene de Google Maps) ---
  { value: "mapsReviews", label: "Nº de reseñas en Google Maps", kind: "number" },
  { value: "mapsRating", label: "Valoración media en Google Maps (0-5)", kind: "number" },

  // --- Texto libre ---
  { value: "signals", label: "Señales detectadas (texto libre)", kind: "text", hint: "Todas las señales de la web unidas en un texto." },
];

const FIELD_BY_VALUE = new Map(ICP_FIELDS.map((field) => [field.value, field]));

export function getIcpField(value: string): IcpField | undefined {
  return FIELD_BY_VALUE.get(value);
}

export function isKnownIcpField(value: string): boolean {
  return FIELD_BY_VALUE.has(value);
}

/** Operaciones que tienen sentido según el tipo del campo. */
export const OPS_BY_KIND: Record<IcpFieldKind, string[]> = {
  bool: ["equals", "not_equals"],
  number: ["equals", "not_equals", "gt", "gte", "lt", "lte"],
  text: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "in",
    "not_in",
    "regex",
    "exists",
    "not_exists",
  ],
};
