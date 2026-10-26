/**
 * Tipos de la API REST (contrato con src/app/api).
 * Todos los DTO son serializables: las fechas llegan como ISO strings.
 */

export type LeadStatus =
  | "new"
  | "researched"
  | "contacted"
  | "replied"
  | "qualified"
  | "unsubscribed"
  | "bounced"
  | "do_not_contact";

export type LeadEmailStatus =
  | "verified"
  | "unverified"
  | "invalid"
  | "catch_all"
  | "risky";

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type CampaignChannel = "email" | "linkedin" | "mixed";

export type StepType =
  | "email"
  | "linkedin_connect"
  | "linkedin_message"
  | "linkedin_like"
  | "call"
  | "wait"
  | "condition";

export type RecipientStatus =
  | "pending"
  | "sending"
  | "sent"
  | "replied"
  | "failed"
  | "booked"
  | "skipped";

export type Channel = "email" | "linkedin" | "call" | "note";

export type LeadEmailDTO = {
  email: string;
  status: string;
  source: string;
  confidence: number;
};

export type LeadDTO = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  website: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: LeadStatus;
  score: number;
  profile?: string;
  scoreReason: string | null;
  fitNotes: string | null;
  source: string;
  aiSummary: string | null;
  notes: string | null;
  enrichment: Record<string, unknown>;
  companyId: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyDomain: string | null;
  emails: LeadEmailDTO[];
  listIds: string[];
  lastContactedAt: string | null;
  createdAt: string;
};

export type ConversationRecord = {
  id: string;
  leadId: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  status: string;
  read: boolean;
  createdAt: string;
  aiSummary?: string | null;
};

export type LeadDetailDTO = LeadDTO & {
  lists: { id: string; name: string }[];
  conversations: ConversationRecord[];
  campaigns: { id: string; name: string; status: string }[];
};

export type ListDTO = {
  id: string;
  name: string;
  description: string | null;
  icp: string | null;
  count: number;
  avgScore: number;
  createdAt: string;
};

export type ListDetailDTO = {
  id: string;
  name: string;
  description: string | null;
  icp: string | null;
  createdAt: string;
};

export type CompanyDTO = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  phoneNumber: string | null;
  linkedinUrl: string | null;
  size: string | null;
  employees: number | null;
  source: string;
  score: number;
  tags: string[];
  leadCount: number;
  createdAt: string;
};

export type CampaignStepDTO = {
  id: string;
  order: number;
  type: string;
  name: string | null;
  delayDays: number;
  delayHours: number;
  subject: string | null;
  body: string | null;
  aiEnabled: boolean;
  stopOnReply: boolean;
  settings: Record<string, unknown>;
};

export type CampaignDTO = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: CampaignStatus;
  channel: CampaignChannel;
  dailyLimit: number;
  autoSend: boolean;
  createdAt: string;
  steps: CampaignStepDTO[];
  recipients: number;
  stats: Record<string, number>;
};

export type RecipientDTO = {
  id: string;
  leadId: string;
  status: RecipientStatus;
  currentStep: number;
  sentCount: number;
  lastSentAt: string | null;
  repliedAt: string | null;
  error: string | null;
  lead: {
    id: string;
    fullName: string | null;
    email: string | null;
    jobTitle?: string | null;
    score: number;
    status: LeadStatus;
    company?: { name: string } | null;
  };
};

export type CampaignDetailDTO = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: CampaignStatus;
  channel: CampaignChannel;
  dailyLimit: number;
  autoSend: boolean;
  createdAt: string;
  steps: CampaignStepDTO[];
  recipients: RecipientDTO[];
};

export type ConversationDTO = {
  id: string;
  leadId: string | null;
  leadName: string | null;
  leadCompany: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  status: string;
  read: boolean;
  createdAt: string;
};

export type TaskDTO = {
  id: string;
  channel: string;
  subject: string | null;
  body: string | null;
  status: string;
  createdAt: string;
  lead: {
    id: string;
    fullName: string | null;
    email: string | null;
    jobTitle: string | null;
    phoneNumber: string | null;
    linkedinUrl: string | null;
    company: { name: string | null; website: string | null } | null;
  } | null;
};

export type IcpCriterionDTO = {
  field: string;
  op: string;
  value?: string | number | boolean | string[];
  weight?: number;
  label?: string;
};

export type PlaybookDTO = {
  ourCompany: string;
  ourOffer: string | null;
  ourValue: string | null;
  icpSummary: string | null;
  icpCriteria: IcpCriterionDTO[];
  disqualified: string[];
  proofPoints: string[];
  tone: string;
  language: string;
  cta: string | null;
  signature: string | null;
};

export type IdentityDTO = {
  id: string;
  name: string;
  email: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  hasPassword: boolean;
  smtpSecure: boolean;
  linkedinUrl: string | null;
  dailyLimit: number;
  isDefault: boolean;
};

export type AnalyticsDTO = {
  totals: {
    leads: number;
    companies: number;
    lists: number;
    campaigns: number;
    conversations: number;
    replies: number;
    sent: number;
    pendingTasks: number;
    avgScore: number;
  };
  leadsByStatus: Record<string, number>;
  campaigns: {
    id: string;
    name: string;
    status: string;
    recipients: number;
  }[];
  activity: { id: string; type: string; subject: string | null; createdAt: string }[];
};

export type FinderResult = {
  interpretation: string;
  warnings: string[];
  /** Fuentes que han aportado resultados. */
  sources: string[];
  found: number;
  companies: number;
  leads: number;
  enriched: number;
  leadIds: string[];
  listId: string | null;
};

export type PreviewMessage = {
  leadId: string;
  leadName: string | null;
  companyName: string | null;
  subject: string;
  body: string;
  source: string;
};

export type RunSummary = {
  processed: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  messages: { leadName: string; subject: string; body: string; channel: string }[];
  errors: string[];
};
