import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { openDatabase } = await import('./db.js');
const { hashPassword } = await import('./auth.js');
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('Demo seeding is disabled in production.');
// The Vercel development environment shares the production database; never seed it by accident.
if (process.env.DATABASE_URL && process.env.SEED_REMOTE_DATABASE !== 'yes') {
  throw new Error('DATABASE_URL points to a remote database. Unset it to seed the local database, or set SEED_REMOTE_DATABASE=yes.');
}

const db = await openDatabase();
const DAY_MS = 86_400_000;
const HEALTHY = ['None', '', 'None', '', 'None', '', 'Not applicable', 'Not applicable'];

async function hospital(name, registration, city, state, pincode, status) {
  const found = await db.prepare('SELECT id FROM hospitals WHERE lower(registration_number)=lower(?)').get(registration);
  if (found) return found.id;
  return (await db.prepare('INSERT INTO hospitals(name,registration_number,city,state,pincode,phone,email,status) VALUES(?,?,?,?,?,?,?,?) RETURNING id')
    .get(name, registration, city, state, pincode, '0000000000', `${registration.toLowerCase()}@example.test`, status)).id;
}
async function account({ first, email, password, role = 'member', blood = 'O+', dob = '1995-05-12', address, hospitalId = null }) {
  const found = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
  if (found) return found.id;
  const staff = role === 'hospital';
  return (await db.prepare('INSERT INTO users(first_name,last_name,dob,blood_group,gender,email,password_hash,phone,address,zip,role,hospital_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
    .get(first, 'Demo', staff ? null : dob, staff ? null : blood, staff ? null : 'Prefer not to say', email, await hashPassword(password), '0000000000', address, '000000', role, hospitalId)).id;
}
async function organRequest(userId, { organ, blood, hospitalId, patientDob, address, urgency = 'Emergency', priority = null, clinicalScore = 0, verifiedDaysAgo = null }) {
  const verification = priority ? 'verified' : 'pending';
  const verifiedAt = priority ? new Date(Date.now() - verifiedDaysAgo * DAY_MS).toISOString() : null;
  const existing = await db.prepare('SELECT id, hospital_id FROM requests WHERE user_id=? AND organ=? ORDER BY id LIMIT 1').get(userId, organ);
  if (existing?.hospital_id) return;
  if (existing) {
    // Requests seeded before hospitals existed: attach them to a hospital.
    await db.prepare('UPDATE requests SET hospital_id=?, patient_dob=?, verification=?, priority=?, clinical_score=?, verified_at=?::timestamptz WHERE id=?').run(hospitalId, patientDob, verification, priority, clinicalScore, verifiedAt, existing.id);
    return;
  }
  await db.prepare('INSERT INTO requests(user_id,organ,blood_group,quantity,urgency,address,zip,phone,note,patient_dob,hospital_id,verification,priority,clinical_score,verified_at) VALUES(?,?,?,1,?,?,?,?,?,?,?,?,?,?,?::timestamptz)')
    .run(userId, organ, blood, urgency, address, '000000', '0000000000', 'Sample request for exploring the application. This is fictional demo data.', patientDob, hospitalId, verification, priority, clinicalScore, verifiedAt);
}
async function pledge(userId, { organ, donorType, city, state }) {
  if (await db.prepare("SELECT id FROM pledges WHERE user_id=? AND organ=? AND status<>'withdrawn'").get(userId, organ)) return;
  await db.prepare('INSERT INTO pledges(user_id,organ,donor_type,city,state,height,weight,bmi,last_donation,operation_type,operation_desc,disease_type,disease_desc,accident_type,accident_desc,pregnant,menstruation) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)')
    .run(userId, organ, donorType, city, state, 172, 68, 22.99, ...HEALTHY);
}

const mumbai = await hospital('Demo City Hospital', 'DEMO-MH-MUM', 'Mumbai', 'Maharashtra', '400001', 'verified');
const pune = await hospital('Demo General Hospital', 'DEMO-MH-PUN', 'Pune', 'Maharashtra', '411001', 'verified');
const bengaluru = await hospital('Demo Heart and Liver Institute', 'DEMO-KA-BLR', 'Bengaluru', 'Karnataka', '560001', 'verified');
const delhi = await hospital('Demo Care Centre', 'DEMO-DL-DEL', 'New Delhi', 'Delhi', '110001', 'pending');

await account({ first: 'Admin', email: 'admin@organdonation.local', password: 'DemoAdmin123!', role: 'admin', address: 'Demo coordination office' });
await account({ first: 'Mumbai', email: 'hospital@organdonation.local', password: 'DemoHospital123!', role: 'hospital', address: 'Mumbai, Maharashtra', hospitalId: mumbai });
await account({ first: 'Pune', email: 'pune.hospital@example.test', password: 'DemoHospital123!', role: 'hospital', address: 'Pune, Maharashtra', hospitalId: pune });
await account({ first: 'Bengaluru', email: 'bengaluru.hospital@example.test', password: 'DemoHospital123!', role: 'hospital', address: 'Bengaluru, Karnataka', hospitalId: bengaluru });
await account({ first: 'Delhi', email: 'pending.hospital@example.test', password: 'DemoHospital123!', role: 'hospital', address: 'New Delhi, Delhi', hospitalId: delhi });

const aarav = await account({ first: 'Aarav', email: 'demo@organdonation.local', password: 'DemoDonor123!', address: 'Pune, Maharashtra' });
const sana = await account({ first: 'Sana', email: 'sana@example.test', password: 'DemoMember123!', blood: 'O-', address: 'Bengaluru, Karnataka' });
const vikram = await account({ first: 'Vikram', email: 'vikram@example.test', password: 'DemoMember123!', blood: 'A+', address: 'Mumbai, Maharashtra' });
const meera = await account({ first: 'Meera', email: 'meera@example.test', password: 'DemoMember123!', address: 'Mumbai, Maharashtra' });
const kabir = await account({ first: 'Kabir', email: 'kabir@example.test', password: 'DemoMember123!', blood: 'A+', address: 'Bengaluru, Karnataka' });
const ananya = await account({ first: 'Ananya', email: 'ananya@example.test', password: 'DemoMember123!', blood: 'B+', address: 'New Delhi, Delhi' });
const riya = await account({ first: 'Riya', email: 'riya@example.test', password: 'DemoMember123!', blood: 'B+', address: 'Pune, Maharashtra' });

await organRequest(meera, { organ: 'Kidney', blood: 'O+', hospitalId: mumbai, patientDob: '1978-03-02', address: 'Mumbai, Maharashtra', priority: 'critical', verifiedDaysAgo: 60 });
await organRequest(riya, { organ: 'Kidney', blood: 'B+', hospitalId: pune, patientDob: '2014-06-10', address: 'Pune, Maharashtra', priority: 'urgent', verifiedDaysAgo: 90 });
await organRequest(kabir, { organ: 'Liver', blood: 'A+', hospitalId: bengaluru, patientDob: '1985-11-20', address: 'Bengaluru, Karnataka', urgency: 'Not Emergency', priority: 'urgent', clinicalScore: 22, verifiedDaysAgo: 120 });
await organRequest(ananya, { organ: 'Heart', blood: 'B+', hospitalId: bengaluru, patientDob: '1990-07-14', address: 'New Delhi, Delhi' });

await pledge(aarav, { organ: 'Kidney', donorType: 'living', city: 'Pune', state: 'Maharashtra' });
await pledge(sana, { organ: 'Liver', donorType: 'living', city: 'Bengaluru', state: 'Karnataka' });
await pledge(vikram, { organ: 'Heart', donorType: 'deceased', city: 'Mumbai', state: 'Maharashtra' });

await db.close();
console.log('Demo data ready (existing accounts were preserved). All data is fictional.');
console.log('Member (kidney donor):  demo@organdonation.local / DemoDonor123!');
console.log('Hospital (Mumbai):      hospital@organdonation.local / DemoHospital123!');
console.log('Hospital (pending):     pending.hospital@example.test / DemoHospital123!');
console.log('Admin:                  admin@organdonation.local / DemoAdmin123!');
