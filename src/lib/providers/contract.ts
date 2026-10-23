/**
 * Contrato de providers de descubrimiento y enriquecimiento.
 *
 * Todos los providers son externos y sin credenciales obligatorias: la app debe
 * funcionar sin API keys. Si el usuario pega una key (p.ej. Hunter), el provider
 * la usa; si no, sigue funcionando con las fuentes abiertas.
 *
 * Implementaciones en ./discovery/, ./enrichment/ y ./llm.ts
 */

export type DiscoveryQuery = {
  /** Texto libre en lenguaje natural, p.ej. "fisioterapeutas en Madrid". */
  query: string;
  /** Categoría OSM ya resuelta, p.ej. "physiotherapist". */
  category?: string;
  /** Radio en km alrededor del centro. */
  radiusKm?: number;
  /** Centro de búsqueda (lat/lng) o nombre de ciudad a geocodificar. */
  location?: string;
  latitude?: number;
  longitude?: number;
  /** Tope de resultados. */
  limit?: number;
  /** País ISO para filtrar (default ES). */
  country?: string;
  /** Solo negocios con web. */
  requireWebsite?: boolean;
};

export type DiscoveredBusiness = {
  /** Clave estable para deduplicar (p.ej. osm id). */
  sourceRef: string;
  source: string;
  name: string;
  website: string | null;
  domain: string | null;
  phoneNumber: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  address: string | null;
  /** Texto extra: descripción, etiquetas, etc. */
  raw: Record<string, unknown>;
};

export type DiscoveryResult = {
  businesses: DiscoveredBusiness[];
  /** Descripción de cómo se resolvió la query (para explicarle al usuario). */
  interpretation: string;
  warnings: string[];
  provider: string;
};

export interface DiscoveryProvider {
  readonly name: string;
  /** true si no necesita ninguna credencial. */
  readonly requiresKey: boolean;
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
}

export type WebsiteContactResult = {
  website: string | null;
  domain: string | null;
  emails: string[];
  phoneNumbers: string[];
  contactPageUrl: string | null;
  teamMembers: { name: string; role: string | null; page?: string }[];
  description: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  /** Señales de "necesita agenda online". */
  signals: string[];
};

export interface WebsiteCrawler {
  readonly name: string;
  crawl(website: string): Promise<WebsiteContactResult>;
}

export type EmailCandidate = {
  email: string;
  source: string;
  confidence: number;
};

export type EmailVerifyResult = {
  email: string;
  status: "verified" | "unverified" | "invalid" | "catch_all" | "risky";
  confidence: number;
  reason: string;
};

export interface EmailProvider {
  readonly name: string;
  /** Descubre emails candidatos para un dominio/persona. */
  discover(input: {
    domain: string;
    fullName?: string | null;
    website?: string | null;
    knownEmails?: string[];
  }): Promise<EmailCandidate[]>;
  /** Verifica que el buzón existe (SMTP RCPT TO, sin enviar nada). */
  verify(email: string): Promise<EmailVerifyResult>;
}

export type LeadScoreInput = {
  lead: {
    jobTitle?: string | null;
    department?: string | null;
    seniority?: string | null;
    city?: string | null;
    region?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    linkedinUrl?: string | null;
    website?: string | null;
    fullName?: string | null;
    enrichment?: Record<string, unknown>;
  };
  company: {
    name?: string | null;
    industry?: string | null;
    description?: string | null;
    city?: string | null;
    region?: string | null;
    employees?: number | null;
    website?: string | null;
    size?: string | null;
    tags?: string[];
  } | null;
};

export type LeadScore = {
  score: number;
  reason: string;
  matched: string[];
  missed: string[];
};

export interface Scorer {
  readonly name: string;
  score(input: LeadScoreInput, criteria: unknown[]): Promise<LeadScore>;
}

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmClient {
  readonly name: string;
  complete(messages: LlmMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string>;
}
