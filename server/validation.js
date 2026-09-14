import { z } from 'zod';
import { ORGANS, BLOOD_GROUPS, URGENCIES, LIVING_ORGANS, DONOR_TYPES, PRIORITIES, STATES } from '../shared/options.js';

const text = (max = 150) => z.string().trim().min(1, 'This field is required.').max(max);
const note = z.string().trim().max(1500).default('');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.').refine((v) => {
  const parsed = new Date(v);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v && v <= new Date().toISOString().slice(0, 10) && v >= '1900-01-01';
}, 'Enter a valid date in the past or today.');
const phone = z.string().trim().regex(/^[+\d\s().-]{7,25}$/, 'Enter a valid phone number.');
const contact = { address: text(300), zip: text(16), phone };
const email = z.email().max(254).transform((v) => v.toLowerCase());
const password = z.string().min(8, 'Use at least 8 characters.').max(128);
const id = z.coerce.number().int().positive();
const passwordsMatch = [(v) => v.password === v.confirm_password, { message: 'Passwords do not match.', path: ['confirm_password'] }];

export const registerSchema = z.object({
  first_name: text(80), last_name: text(80), dob: date,
  gender: z.enum(['Male', 'Female', 'Other', 'Prefer not to say']),
  blood_group: z.enum(BLOOD_GROUPS), email, password,
  confirm_password: z.string(), consent: z.literal(true), ...contact,
}).refine(...passwordsMatch);
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const hospitalRegisterSchema = z.object({
  hospital_name: text(150), registration_number: z.string().trim().min(3, 'Enter the hospital registration number.').max(50),
  city: text(100), state: z.enum(STATES), pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit PIN code.'), hospital_phone: phone,
  first_name: text(80), last_name: text(80), phone, email, password, confirm_password: z.string(), consent: z.literal(true),
}).refine(...passwordsMatch);

export const requestSchema = z.object({
  organ: z.enum(ORGANS), blood_group: z.enum(BLOOD_GROUPS), quantity: z.coerce.number().int().min(1).max(7),
  urgency: z.enum(URGENCIES), patient_dob: date, hospital_id: id, note, ...contact,
});
export const requestUpdateSchema = requestSchema.partial().extend({ status: z.enum(['open', 'closed']).optional() }).strict();
export const recordSchema = z.object({ organ: z.enum(ORGANS), blood_group: z.enum(BLOOD_GROUPS), quantity: z.coerce.number().int().min(1).max(7), donated_on: date, note });

export const pledgeSchema = z.object({
  organ: z.enum(ORGANS), donor_type: z.enum(DONOR_TYPES), city: text(100), state: z.enum(STATES),
  height: z.coerce.number().min(50).max(260), weight: z.coerce.number().min(10).max(500),
  last_donation: z.union([date, z.literal('')]).default(''),
  operation_type: z.enum(['None', 'Minor', 'Major']), operation_desc: note,
  disease_type: z.enum(['None', 'Acute', 'Chronic']), disease_desc: note,
  accident_type: z.enum(['None', 'Minor', 'Critical']), accident_desc: note,
  pregnant: z.enum(['Yes', 'No', 'Not applicable', 'Prefer not to say']),
  menstruation: z.enum(['Yes', 'No', 'Not applicable', 'Prefer not to say']), consent: z.literal(true),
}).refine((v) => v.donor_type === 'deceased' || LIVING_ORGANS.includes(v.organ), { message: 'This organ can only be pledged for donation after death.', path: ['donor_type'] });
export const pledgeStatusSchema = z.object({ status: z.enum(['active', 'withdrawn']) });

export const verificationSchema = z.object({
  decision: z.enum(['verified', 'rejected']), priority: z.enum(PRIORITIES).optional(),
  clinical_score: z.coerce.number().int().min(0).max(40).default(0), note,
})
  .refine((v) => v.decision === 'rejected' || v.priority, { message: 'Choose the verified priority.', path: ['priority'] })
  .refine((v) => v.decision === 'verified' || v.note.length >= 5, { message: 'Explain why the request is rejected.', path: ['note'] });
export const proposalSchema = z.object({ request_id: id, pledge_id: id, override_reason: note });
export const matchDecisionSchema = z.object({ status: z.enum(['confirmed', 'declined']), reason: note })
  .refine((v) => v.status === 'confirmed' || v.reason.length >= 5, { message: 'Explain why the match is declined.', path: ['reason'] });
export const donorResponseSchema = z.object({ response: z.enum(['accepted', 'declined']), reason: note });
export const hospitalStatusSchema = z.object({ status: z.enum(['pending', 'verified', 'suspended']) });
