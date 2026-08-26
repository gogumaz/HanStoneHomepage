export const CONSULTATION_PRIVACY_VERSION = "consultation-privacy-v1";

export const CONSULTATION_CATEGORIES = [
  "바둑학원",
  "방과후학교",
  "학교",
  "기관·단체",
] as const;

export type ConsultationInput = {
  category: string;
  organizationName: string;
  contactName: string;
  phone: string;
  email: string | null;
  expectedStudents: number;
  title: string;
  content: string;
};
